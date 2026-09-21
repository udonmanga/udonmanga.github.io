#!/usr/bin/env python3
"""Build data/catalog.json from UMD-Cubari + Progress sheet release dates."""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BOT_ROOT = ROOT.parent
OUT = ROOT / "data" / "catalog.json"
SITE_OUT = ROOT / "data" / "site.json"

OWNER = "yk1512"
REPO = "UMD-Cubari"
BRANCH = "main"

DEFAULT_SITE = {
    "name": "UMD",
    "subtitle": "Type-Moon manga translations. Read on Cubari.",
    "discord_url": "",
    "recruitment_url": "",
    "accent": "#c45c26",
    "hub_url": "https://forums.nrvnqsr.com/showthread.php/10069-UMD-Translations-Hub",
}

# Sheet Series → distinctive needles used to match Cubari JSON titles
SHEET_TITLE_NEEDLES: dict[str, tuple[str, ...]] = {
    "Avalon Tale": ("avalontale",),
    "Case Files": ("casefiles", "lordmelloi", "el-melloi", "elmelloi"),
    "Dotsuki Manzai": ("dotsukimanzai",),
    "Heaven's Feel": ("heavensfeel",),
    "Hollow Ataraxia": ("hollowataraxia",),
    "Mahoyo DNA 1": ("nurseryrhyme",),
    "Mahoyo DNA 2": ("witchcraft",),
    "Mahoyo Nursery": ("nurseryrhyme",),
    "Mahoyo Witchcraft": ("witchcraft",),
    "Mahoyo Hobby": ("witchontheholynight", "mahoyo"),
    "Medorism": ("medorism",),
    "Melty Back Alley Nightmare": ("backalleynightmare",),
    "Melty Piece in Paradise": ("pieceinparadise",),
    "Mortalis Stella": ("mortalisstella", "mortalis"),
    "Mugetsu Anthology": ("mugetsu",),
    "Prisma Illya": ("prismaillya", "3rei"),
    "Saber Wars II": ("saberwars",),
    "Samurai Remnant": ("samurairemnant",),
    "Seraph": ("seraph", "cyberparadise"),
    "Shimousa": ("shimousa",),
    "Shinjuku": ("shinjuku",),
    "Strange Fake": ("strangefake",),
    "Tsukire Comic Star": ("comicstar", "anthologycomicstar"),
    "Tsukire Moon Phase": ("moonphase",),
    "Tsukire a la Carte": ("alacarte", "acomicalacarte"),
    "Turas Realta": ("turasrealta", "turas"),
    "Unlimited Blade Works": ("unlimitedbladeworks",),
    "Zero": ("fatezero",),
    "FGO Showdown 1": ("showdown",),
    "FGO Showdown 2": ("showdown",),
    "FGO Showdown 3": ("showdown",),
    "Tsukihime": ("tsukihime",),
}


def cubari_url(json_name: str) -> str:
    raw = f"raw/{OWNER}/{REPO}/{BRANCH}/{json_name}"
    b64 = base64.b64encode(raw.encode()).decode().rstrip("=")
    return f"https://cubari.moe/read/gist/{b64}/"


def norm_text(t: str) -> str:
    t = (t or "").lower().replace("—", "-").replace("–", "-").replace("／", "/")
    return re.sub(r"[^a-z0-9]+", "", t)


def chapter_sort_key(k: str) -> float:
    try:
        return float(k)
    except ValueError:
        return -1.0


def norm_chapter(raw: object) -> str:
    text = str(raw or "").strip()
    if not text:
        return ""
    try:
        f = float(text)
    except ValueError:
        return text
    if f == int(f):
        return str(int(f))
    return f"{f:.10f}".rstrip("0").rstrip(".")


def display_date(ts: int) -> str:
    if not ts:
        return ""
    return datetime.fromtimestamp(ts).strftime("%B %-d, %Y")


def split_people(s: object) -> list[str]:
    text = str(s or "").strip()
    if not text or text.lower() in {"unknown", "n/a", "none"}:
        return []
    return [p for p in re.split(r"\s*(?:,|/|&| and )\s*", text) if p]


def parse_sheet_timestamp(raw: str) -> datetime | None:
    """Parse Progress released_at, including concatenated legacy cells."""
    text = (raw or "").strip()
    if not text:
        return None
    formats = (
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
        "%m/%d/%Y %H:%M",
        "%m/%d/%Y %H:%M:%S",
        "%m/%d/%Y",
    )
    for fmt in formats:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    # Single-digit hour: 2026-09-20 9:43
    m = re.match(r"^(\d{4}-\d{2}-\d{2}) (\d{1,2}):(\d{2})(?::(\d{2}))?$", text)
    if m:
        hh = int(m.group(2))
        ss = m.group(4) or "00"
        try:
            return datetime.strptime(
                f"{m.group(1)} {hh:02d}:{m.group(3)}:{ss}", "%Y-%m-%d %H:%M:%S"
            )
        except ValueError:
            pass
    # Concatenated legacy: 7/25/2023 19:00:002026-07-25 19:17
    m = re.search(r"(20\d{2}-\d{2}-\d{2} \d{1,2}:\d{2})(?::\d{2})?", text)
    if m:
        return parse_sheet_timestamp(m.group(1))
    m = re.search(r"(\d{1,2}/\d{1,2}/20\d{2} \d{1,2}:\d{2})", text)
    if m:
        return parse_sheet_timestamp(m.group(1))
    return None


def fetch_json(url: str) -> object:
    req = urllib.request.Request(url, headers={"User-Agent": "umd-catalogue-gen"})
    with urllib.request.urlopen(req, timeout=90) as resp:
        return json.load(resp)


def list_json_names() -> list[str]:
    api = f"https://api.github.com/repos/{OWNER}/{REPO}/contents/"
    listing = fetch_json(api)
    assert isinstance(listing, list)
    return [f["name"] for f in listing if str(f.get("name", "")).endswith(".json")]


def fetch_series(name: str) -> tuple[str, dict]:
    url = (
        f"https://raw.githubusercontent.com/{OWNER}/{REPO}/{BRANCH}/"
        f"{urllib.parse.quote(name)}"
    )
    data = fetch_json(url)
    assert isinstance(data, dict)
    return name, data


def latest_chapter_from_cubari(chapters: dict) -> tuple[int, str, str] | None:
    best: tuple[int, float, str, str] | None = None
    for k, v in (chapters or {}).items():
        if not isinstance(v, dict):
            continue
        try:
            lu = int(v.get("last_updated") or 0)
        except (TypeError, ValueError):
            lu = 0
        item = (lu, chapter_sort_key(str(k)), str(k), str(v.get("title") or "").strip())
        if best is None or item[:2] > best[:2]:
            best = item
    if best is None:
        return None
    return best[0], best[2], best[3]


def cubari_cover(data: dict) -> str:
    """Exact Cubari cover field; empty means Cubari has no cover either."""
    return str(data.get("cover") or "").strip()


def match_sheet_to_title(
    sheet_series: str, titles: list[dict]
) -> dict | None:
    needles = SHEET_TITLE_NEEDLES.get(sheet_series)
    sn = norm_text(sheet_series)
    scored: list[tuple[int, dict]] = []
    for t in titles:
        tn = norm_text(t["title"])
        score = 0
        if sn and sn in tn:
            score = 50 + min(len(sn), 40)
        if needles:
            for n in needles:
                nn = norm_text(n)
                if nn and nn in tn:
                    score = max(score, 80 + min(len(nn), 20))
        if score:
            scored.append((score, t))
    if not scored:
        return None
    scored.sort(key=lambda x: (-x[0], -(x[1].get("last_updated") or 0)))
    return scored[0][1]


def load_sheet_releases() -> list[dict]:
    """Return released Progress rows with parsed timestamps."""
    sys.path.insert(0, str(BOT_ROOT))
    from dotenv import load_dotenv
    from src.sheet.client import SheetClient

    load_dotenv(BOT_ROOT / ".env")
    key = os.environ.get("GOOGLE_KEY_PATH") or ""
    sheet_name = os.environ.get("SHEET_NAME") or ""
    if not key or not sheet_name:
        raise RuntimeError("GOOGLE_KEY_PATH / SHEET_NAME missing from .env")
    key_path = Path(key)
    if not key_path.is_file():
        key_path = BOT_ROOT / key
    client = SheetClient(str(key_path), sheet_name)
    out: list[dict] = []
    for row in client.get_progress_records():
        raw = str(row.get("released_at") or "").strip()
        if not raw:
            continue
        dt = parse_sheet_timestamp(raw)
        if not dt:
            continue
        series = str(row.get("Series") or "").strip()
        chapter = norm_chapter(row.get("Chapter"))
        if not series or not chapter:
            continue
        out.append(
            {
                "series": series,
                "chapter": chapter,
                "released_at": int(dt.timestamp()),
                "released_display": dt.strftime("%B %-d, %Y"),
                "release_link": str(row.get("release_link") or "").strip(),
                "chapter_title": "",
            }
        )
    out.sort(key=lambda r: -r["released_at"])
    return out


def build_cubari_titles() -> list[dict]:
    names = list_json_names()
    rows: list[dict] = []
    with ThreadPoolExecutor(max_workers=12) as pool:
        futs = [pool.submit(fetch_series, n) for n in names]
        for fut in as_completed(futs):
            name, data = fut.result()
            chapters = data.get("chapters") if isinstance(data.get("chapters"), dict) else {}
            latest = latest_chapter_from_cubari(chapters)
            lu = latest[0] if latest else 0
            ck = latest[1] if latest else ""
            ct = latest[2] if latest else ""
            series_url = cubari_url(name)
            cover = cubari_cover(data)
            title = str(data.get("title") or Path(name).stem).strip()
            rows.append(
                {
                    "_file": name,
                    "_nbytes": len(json.dumps(data, ensure_ascii=False)),
                    "_nchapters": len(chapters),
                    "_has_cover": 1 if cover else 0,
                    "_chapters": chapters,
                    "id": Path(name).stem.lower(),
                    "title": title,
                    "original_title": "",
                    "alt_titles": [],
                    "authors": split_people(data.get("author")),
                    "artists": split_people(data.get("artist")),
                    "cover": cover or "assets/placeholder-cover.svg",
                    "status": "ongoing",
                    "latest_chapter_number": ck,
                    "latest_chapter_title": ct,
                    "released_at": lu,
                    "released_display": display_date(lu),
                    "last_updated": lu,
                    "last_updated_display": display_date(lu),
                    "cubari_series_url": series_url,
                    "cubari_latest_url": (
                        f"{series_url.rstrip('/')}/{ck}/" if ck else series_url
                    ),
                    "_cubari_cover": cover,
                }
            )

    by: dict[str, dict] = {}
    for row in rows:
        key = norm_text(row["title"]) or row["id"]
        prev = by.get(key)
        if prev is None:
            by[key] = row
            continue
        # Prefer more chapters, then has Cubari cover, then newer, then larger JSON
        score = (
            row["_nchapters"],
            row["_has_cover"],
            row["last_updated"],
            row["_nbytes"],
        )
        prev_score = (
            prev["_nchapters"],
            prev["_has_cover"],
            prev["last_updated"],
            prev["_nbytes"],
        )
        if score > prev_score:
            by[key] = row
    return list(by.values())


def apply_sheet_dates(titles: list[dict], releases: list[dict]) -> tuple[list[dict], list[dict]]:
    """Override title latest fields + build latest_releases from sheet when possible."""
    # Map sheet series → cubari title
    series_map: dict[str, dict] = {}
    for rel in releases:
        s = rel["series"]
        if s in series_map:
            continue
        matched = match_sheet_to_title(s, titles)
        if matched:
            series_map[s] = matched

    # Per-title: newest sheet release
    latest_by_title_id: dict[str, dict] = {}
    for rel in releases:
        t = series_map.get(rel["series"])
        if not t:
            continue
        tid = t["id"]
        prev = latest_by_title_id.get(tid)
        if prev is None or rel["released_at"] > prev["released_at"]:
            latest_by_title_id[tid] = rel

    for t in titles:
        rel = latest_by_title_id.get(t["id"])
        if not rel:
            continue
        t["released_at"] = rel["released_at"]
        t["released_display"] = rel["released_display"]
        t["last_updated"] = rel["released_at"]
        t["last_updated_display"] = rel["released_display"]
        t["latest_chapter_number"] = rel["chapter"]
        # Prefer chapter title from Cubari JSON if present
        chapters = t.get("_chapters") or {}
        ch_meta = None
        for key, val in chapters.items():
            if norm_chapter(key) == rel["chapter"] and isinstance(val, dict):
                ch_meta = val
                break
        t["latest_chapter_title"] = (
            str((ch_meta or {}).get("title") or "").strip() or rel.get("chapter_title") or ""
        )
        if rel["release_link"]:
            t["cubari_latest_url"] = rel["release_link"]
        else:
            t["cubari_latest_url"] = (
                f"{t['cubari_series_url'].rstrip('/')}/{rel['chapter']}/"
            )

    latest_releases: list[dict] = []
    for rel in releases:
        if len(latest_releases) >= 10:
            break
        t = series_map.get(rel["series"])
        cover = (t.get("cover") if t else None) or "assets/placeholder-cover.svg"
        # Always prefer Cubari series cover field when we have a match
        if t and t.get("_cubari_cover"):
            cover = t["_cubari_cover"]
        series_title = t["title"] if t else rel["series"]
        series_id = t["id"] if t else norm_text(rel["series"]) or "unknown"
        cubari = rel["release_link"]
        if not cubari and t:
            cubari = f"{t['cubari_series_url'].rstrip('/')}/{rel['chapter']}/"
        if not cubari:
            continue
        chapter_title = ""
        if t:
            for key, val in (t.get("_chapters") or {}).items():
                if norm_chapter(key) == rel["chapter"] and isinstance(val, dict):
                    chapter_title = str(val.get("title") or "").strip()
                    break
        latest_releases.append(
            {
                "series_id": series_id,
                "series_title": series_title,
                "chapter_number": rel["chapter"],
                "chapter_title": chapter_title,
                "released_at": rel["released_at"],
                "released_display": rel["released_display"],
                "cover": cover,
                "cubari_url": cubari,
            }
        )

    # Fall back to Cubari-only latest if sheet yielded nothing
    if not latest_releases:
        cubari_events: list[dict] = []
        for t in titles:
            for key, val in (t.get("_chapters") or {}).items():
                if not isinstance(val, dict):
                    continue
                try:
                    lu = int(val.get("last_updated") or 0)
                except (TypeError, ValueError):
                    lu = 0
                if not lu:
                    continue
                cover = t.get("_cubari_cover") or t.get("cover") or "assets/placeholder-cover.svg"
                cubari_events.append(
                    {
                        "series_id": t["id"],
                        "series_title": t["title"],
                        "chapter_number": str(key),
                        "chapter_title": str(val.get("title") or "").strip(),
                        "released_at": lu,
                        "released_display": display_date(lu),
                        "cover": cover,
                        "cubari_url": f"{t['cubari_series_url'].rstrip('/')}/{key}/",
                    }
                )
        cubari_events.sort(key=lambda x: -x["released_at"])
        latest_releases = cubari_events[:10]

    clean: list[dict] = []
    for t in titles:
        t = dict(t)
        for k in (
            "_file",
            "_nbytes",
            "_nchapters",
            "_has_cover",
            "_chapters",
            "_cubari_cover",
        ):
            t.pop(k, None)
        # Expose Cubari cover as-is when present; placeholder only when Cubari has none
        clean.append(t)

    clean.sort(
        key=lambda x: (-(x.get("released_at") or x.get("last_updated") or 0), x["title"].lower())
    )
    return clean, latest_releases


def build_catalog(site: dict) -> dict:
    titles = build_cubari_titles()
    try:
        releases = load_sheet_releases()
        print(f"Sheet releases loaded: {len(releases)}")
    except Exception as exc:
        print(f"WARNING: could not load sheet dates ({exc}); using Cubari timestamps")
        releases = []
    titles, latest_releases = apply_sheet_dates(titles, releases)
    return {
        "generated_at": int(time.time()),
        "site": site,
        "latest_releases": latest_releases,
        "titles": titles,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site-json", type=Path, default=SITE_OUT)
    args = parser.parse_args()

    site = dict(DEFAULT_SITE)
    if args.site_json.is_file():
        existing = json.loads(args.site_json.read_text(encoding="utf-8"))
        if isinstance(existing, dict):
            site.update({k: v for k, v in existing.items() if v is not None})

    catalog = build_catalog(site)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    SITE_OUT.write_text(json.dumps(site, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote {OUT} ({len(catalog['titles'])} titles, "
        f"{len(catalog['latest_releases'])} latest releases)"
    )
    print("Latest:")
    for r in catalog["latest_releases"][:5]:
        print(f"  {r['released_display']} | {r['series_title']} Ch.{r['chapter_number']}")


if __name__ == "__main__":
    main()

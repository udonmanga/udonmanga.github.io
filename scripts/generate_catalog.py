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

# Alias / mangled JSON copies that duplicate a canonical Cubari file.
SKIP_CUBARI_FILES = {
    "Fate_Grand_Order_Epic_of_Remnant_Deep_Sea_Cyber_Paradise_SERAPH.json",
    "Fate_Grand_Order__Cempasúchil.json",
    "Fate_Grand_Order__Christopher_Columbus__Interlude_Him.json",
    "Fate_Grand_Order__Edward_Teach_s_Interlude_A_Man_s_Battle.json",
    "Fate_Grand_Order__In_Search_of_the_Perfect_Wine_and_Pickles_Pairing.json",
    "Fate_Grand_Order__Kama_s_Interlude_Love_Depravity_Is_Ever_by_Your_Side.json",
    "Fate_Grand_Order__Nikitich_s_Interlude_Cooking_Nikitich.json",
    "Fate_Grand_Order__Penthesilea_s_Interlude_The_Phantom_of_Troia.json",
    "Fate_Grand_Order__Qin_Shi_Huang_s_Interlude_The_Melancholy_of_a_Ruler.json",
    "Fate_Grand_Order__Tomoe_s_Way_of_the_Gamer.json",
    "Fate_Samurai_Remnant.json",
    "Fate_Samurai_Remnant__Prologue.json",
    "Fate_Type_Redline.json",
    "Fate_Unlimited_Codes__Illya_s_Melancholy.json",
    "Fate_Zero_Kiritsugu.json",
    "Fate_Zero_Kotomine.json",
    "Medorism__Fate_Short_Works.json",
    "The_Man_Known_as_Tsukiji_Tobimaru.json",
}

DEFAULT_SITE = {
    "name": "Udon Mango D",
    "subtitle": "Translations of Type-Moon Works",
    "discord_url": "",
    "recruitment_url": "",
    "accent": "#c45c26",
    "hub_url": "",
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
    "Seraph": ("seraph", "cyberparadise", "seraph"),
    "Shimousa": ("shimousa",),
    "Shinjuku": ("shinjuku",),
    "Strange Fake": ("strangefake",),
    "Tsukire Comic Star": ("blueglassmoonanthologycomicstar", "anthologycomicstar"),
    "Tsukire Moon Phase": ("blueglassmoonmoonphase", "moonphase"),
    "Tsukire a la Carte": ("blueglassmooncomiclacarte", "tsukihimecomiclacarte"),
    "Turas Realta": ("turasrealta", "turas"),
    "Unlimited Blade Works": ("unlimitedbladeworks",),
    "Zero": ("fatezero",),
    "FGO Showdown 1": ("showdown",),
    "FGO Showdown 2": ("showdown",),
    "FGO Showdown 3": ("showdown",),
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


def resolve_chapter_key(chapters: dict | None, chapter: object) -> str | None:
    """Map a sheet/chapter number to the exact Cubari JSON chapter key.

    Cubari keys are often zero-padded (029.5); sheet links usually are not (29.5).
    """
    target = norm_chapter(chapter)
    if not target or not isinstance(chapters, dict):
        return None
    matches = [k for k in chapters if norm_chapter(k) == target]
    if not matches:
        return None
    # Prefer the canonical stored key (usually the zero-padded one).
    matches.sort(key=lambda k: (len(k), k))
    return matches[-1]


def chapter_cubari_url(series_url: str, chapter_key: str) -> str:
    return f"{series_url.rstrip('/')}/{chapter_key}/"


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
    return [
        f["name"]
        for f in listing
        if str(f.get("name", "")).endswith(".json")
        and f["name"] not in SKIP_CUBARI_FILES
    ]


def fetch_series(name: str) -> tuple[str, dict]:
    url = (
        f"https://raw.githubusercontent.com/{OWNER}/{REPO}/{BRANCH}/"
        f"{urllib.parse.quote(name)}"
    )
    data = fetch_json(url)
    assert isinstance(data, dict)
    return name, data


def latest_chapter_from_cubari(chapters: dict) -> tuple[int, str, str] | None:
    """Pick the highest Cubari chapter key (by number), not last_updated.

    last_updated is often stale or out of order vs the actual newest chapter.
    """
    best: tuple[float, int, str, str] | None = None
    for k, v in (chapters or {}).items():
        if not isinstance(v, dict):
            continue
        try:
            lu = int(v.get("last_updated") or 0)
        except (TypeError, ValueError):
            lu = 0
        # Chapter number first; last_updated only breaks ties.
        item = (chapter_sort_key(str(k)), lu, str(k), str(v.get("title") or "").strip())
        if best is None or item[:2] > best[:2]:
            best = item
    if best is None:
        return None
    return best[1], best[2], best[3]


def cubari_cover(data: dict) -> str:
    """Exact Cubari cover field; empty means Cubari has no cover either."""
    return str(data.get("cover") or "").strip()


_CATEGORY_BY_ID: dict[str, str] | None = None


def load_category_by_id() -> dict[str, str]:
    path = ROOT / "data" / "categories.json"
    if not path.is_file():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    by_id = payload.get("by_id") or {}
    return {str(k): str(v) for k, v in by_id.items()}


_LOCAL_COVERS: dict[str, str] | None = None


def load_local_covers() -> dict[str, str]:
    """title id → local assets/covers/... path."""
    path = ROOT / "data" / "local_covers.json"
    if not path.is_file():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    return {str(k): str(v) for k, v in (payload.get("by_id") or {}).items()}


def prefer_local_cover(title_id: str, remote: str) -> str:
    global _LOCAL_COVERS
    if _LOCAL_COVERS is None:
        _LOCAL_COVERS = load_local_covers()
    return _LOCAL_COVERS.get(title_id) or remote


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
    scored.sort(key=lambda x: (-x[0], -(x[1].get("_nchapters") or 0)))
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
            title_id = Path(name).stem.lower()
            display_cover = prefer_local_cover(title_id, cover) or "assets/placeholder-cover.svg"
            title = str(data.get("title") or Path(name).stem).strip()
            rows.append(
                {
                    "_file": name,
                    "_nbytes": len(json.dumps(data, ensure_ascii=False)),
                    "_nchapters": len(chapters),
                    "_has_cover": 1 if cover or display_cover.startswith("assets/covers/") else 0,
                    "_chapters": chapters,
                    "_cubari_latest_ts": lu,
                    "id": title_id,
                    "title": title,
                    "original_title": "",
                    "alt_titles": [],
                    "authors": split_people(data.get("author")),
                    "artists": split_people(data.get("artist")),
                    "cover": display_cover,
                    "category": series_category(title_id),
                    "latest_chapter_number": ck,
                    "latest_chapter_title": ct,
                    # Dates ONLY from Progress.released_at
                    "released_at": 0,
                    "released_display": "",
                    "cubari_series_url": series_url,
                    "cubari_latest_url": (
                        f"{series_url.rstrip('/')}/{ck}/" if ck else series_url
                    ),
                    "_cubari_cover": display_cover,
                }
            )

    by: dict[str, dict] = {}
    for row in rows:
        key = norm_text(row["title"]) or row["id"]
        prev = by.get(key)
        if prev is None:
            by[key] = row
            continue
        score = (
            row["_nchapters"],
            row["_has_cover"],
            row.get("_cubari_latest_ts") or 0,
            row["_nbytes"],
        )
        prev_score = (
            prev["_nchapters"],
            prev["_has_cover"],
            prev.get("_cubari_latest_ts") or 0,
            prev["_nbytes"],
        )
        if score > prev_score:
            by[key] = row
    return list(by.values())


def apply_sheet_dates(titles: list[dict], releases: list[dict]) -> tuple[list[dict], list[dict]]:
    """Apply Progress.released_at only. Never Cubari or sheet last_updated."""
    series_map: dict[str, dict] = {}
    for rel in releases:
        s = rel["series"]
        if s in series_map:
            continue
        matched = match_sheet_to_title(s, titles)
        if matched:
            series_map[s] = matched
        else:
            print(f"WARNING: no Cubari match for sheet series {s!r}")

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
        t["released_at"] = 0
        t["released_display"] = ""
        rel = latest_by_title_id.get(t["id"])
        if not rel:
            continue
        # Sheet supplies release *dates* only. Latest chapter always stays Cubari's.
        t["released_at"] = rel["released_at"]
        t["released_display"] = rel["released_display"]

    latest_releases: list[dict] = []
    for rel in releases:
        if len(latest_releases) >= 10:
            break
        t = series_map.get(rel["series"])
        cover = "assets/placeholder-cover.svg"
        if t and t.get("_cubari_cover"):
            cover = t["_cubari_cover"]
        elif t and t.get("cover"):
            cover = t["cover"]
        series_title = t["title"] if t else rel["series"]
        series_id = t["id"] if t else norm_text(rel["series"]) or "unknown"
        chapters = (t.get("_chapters") or {}) if t else {}
        ch_key = resolve_chapter_key(chapters, rel["chapter"]) if t else None
        chapter_title = ""
        if ch_key and isinstance(chapters.get(ch_key), dict):
            chapter_title = str(chapters[ch_key].get("title") or "").strip()
        if t and ch_key:
            cubari = chapter_cubari_url(t["cubari_series_url"], ch_key)
        elif t:
            cubari = t["cubari_series_url"]
        else:
            cubari = rel["release_link"]
        if not cubari:
            continue
        latest_releases.append(
            {
                "series_id": series_id,
                "series_title": series_title,
                "chapter_number": ch_key or rel["chapter"],
                "chapter_title": chapter_title,
                "released_at": rel["released_at"],
                "released_display": rel["released_display"],
                "cover": cover,
                "cubari_url": cubari,
            }
        )

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
            "_cubari_latest_ts",
        ):
            t.pop(k, None)
        clean.append(t)

    clean.sort(
        key=lambda x: (
            0 if (x.get("released_at") or 0) else 1,
            -(x.get("released_at") or 0),
            x["title"].lower(),
        )
    )
    return clean, latest_releases


def apply_mangadex_cache(titles: list[dict]) -> int:
    """Fill blank released_at from data/mangadex_dates.json (MangaDex lookups)."""
    path = ROOT / "data" / "mangadex_dates.json"
    if not path.is_file():
        return 0
    payload = json.loads(path.read_text(encoding="utf-8"))
    cache = payload.get("titles") or {}
    filled = 0
    for t in titles:
        if t.get("released_at"):
            continue
        row = cache.get(t["id"])
        if not row:
            continue
        ra = int(row.get("released_at") or 0)
        if not ra:
            continue
        t["released_at"] = ra
        t["released_display"] = str(row.get("released_display") or display_date(ra))
        filled += 1
    titles.sort(
        key=lambda x: (
            0 if (x.get("released_at") or 0) else 1,
            -(x.get("released_at") or 0),
            x["title"].lower(),
        )
    )
    return filled


def build_catalog(site: dict) -> dict:
    titles = build_cubari_titles()
    try:
        releases = load_sheet_releases()
        print(f"Sheet releases loaded: {len(releases)}")
    except Exception as exc:
        print(f"WARNING: could not load sheet dates ({exc}); dates will be blank")
        releases = []
    titles, latest_releases = apply_sheet_dates(titles, releases)
    filled = apply_mangadex_cache(titles)
    if filled:
        print(f"MangaDex date cache filled: {filled}")
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

# UMD Cubari catalogue

Static GitHub Pages site (§12): searchable group catalogue that links into Cubari. No reader, tags, MangaDex, or ImageChest stats.

## Local preview

```bash
cd catalogue
python3 -m http.server 8765
# open http://127.0.0.1:8765
```

## Refresh series data

Pulls Cubari JSON from `yk1512/UMD-Cubari` (covers = Cubari `cover` field) and release dates from the Progress sheet (`released_at`). Rebuilds `latest_releases` (top 10 by sheet date):

```bash
# use the bot venv (needs gspread + .env)
/home/udon/umd-bot/.venv/bin/python scripts/generate_catalog.py
```

Edit `data/site.json` for Discord / recruitment links (kept on regenerate). Public statuses default to `ongoing`; set per title in `data/catalog.json` when you know them (`ongoing`, `completed`, `indefinite-hiatus`, `stalled`).

## Deploy

**GitHub Pages on the free plan requires a public repository.** Private Pages need GitHub Pro/Team. The catalogue JSON has no secrets (Cubari links + covers only), so public is fine.

1. Create a public repo (e.g. `umd-translations.github.io` or `UMD-Catalogue`).
2. Push this `catalogue/` folder as the repo root (or set Pages to `/catalogue` if monorepo).
3. Settings → Pages → Deploy from branch → `main` → `/ (root)`.

Live URL will be `https://<user-or-org>.github.io/<repo>/` (or the `.github.io` root repo URL).

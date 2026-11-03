# UMD Cubari catalogue

Static GitHub Pages site: searchable group catalogue that links into Cubari.

Source lives in the bot repo at `umd-bot/catalogue/`. The public site is the root of `udonmanga/udonmanga.github.io`.

## Local preview

From this folder (`umd-bot/catalogue`):

```bash
python3 -m http.server 8765
# open http://127.0.0.1:8765
```

## Refresh series data

`scripts/generate_catalog.py` pulls Cubari JSON from `yk1512/UMD-Cubari` and release dates from the Progress sheet (`released_at`). It rebuilds `data/catalog.json`, `data/progress.json`, and stamps asset `?v=` hashes in `index.html` / `assets/site.css`.

Run it with the bot venv (needs gspread + `.env`):

```bash
/home/udon/umd-bot/.venv/bin/python scripts/generate_catalog.py
```

Working directory must be `umd-bot/catalogue` (or pass paths relative to that tree). The Pages repo alone cannot regenerate data — it has no sheet credentials.

### Automatic refresh after Cubari releases

When `ENABLE_CATALOGUE_REFRESH=true` (default) and the Discord bot finishes a Cubari publish, it:

1. Waits a few seconds for GitHub raw CDN
2. Runs `generate_catalog.py`
3. Commits + pushes to `udonmanga/udonmanga.github.io`

Uses the Kaguya `github.txt` token (or `CATALOGUE_GITHUB_TOKEN`). Manual one-shot from the bot root:

```bash
/home/udon/umd-bot/.venv/bin/python -c "from src.catalogue import refresh_catalogue; print(refresh_catalogue(settle_seconds=0))"
```

Edit `data/site.json` for Discord / recruitment links (kept on regenerate). Categories live in `data/categories.json`.

## Deploy

GitHub Pages on the free plan requires a public repository. Private Pages need GitHub Pro/Team. The catalogue JSON has no secrets (Cubari links + covers only), so public is fine.

Live site: https://udonmanga.github.io/

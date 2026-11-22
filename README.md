# ryōgae 両替

A tiny, offline-capable web app for converting between **NIS (₪), USD ($), EUR (€), KRW (₩) and JPY (¥)**.

- **Type** in any currency — the other three update instantly.
- **Point your camera** at a price tag — no photo needed. The app reads the number inside the frame live and shows it converted. Currency is auto-detected from symbols (¥ 円 ₩ 원 ₪ $ €) or you can pick it.
- Rates come from [open.er-api.com](https://open.er-api.com) (falls back to ECB via frankfurter.app) and are cached for offline use.
- Installable: Chrome/Android show an Install button; on iPhone use Share → Add to Home Screen.

Text recognition uses the browser's built-in `TextDetector` when available, otherwise [Tesseract.js](https://tesseract.projectnaptha.com/) loaded on first camera use.

## Deploy

Every push to `main` deploys `site/` to GitHub Pages via `.github/workflows/pages.yml`.
If the first run fails at "configure-pages", open **Settings → Pages** and set **Source** to **GitHub Actions**, then re-run the workflow.

## Run locally

```sh
cd site && python3 -m http.server 8000
```

Camera access needs HTTPS or `localhost`.

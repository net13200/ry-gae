# ryōgae 両替

A tiny, offline-capable web app for converting between **NIS (₪), USD ($), EUR (€), SGD (S$), KRW (₩) and JPY (¥)**.

- **Type** in any currency — the other three update instantly.
- **Point your camera** at a price tag — no photo needed. The app reads the number inside the frame live and shows it converted. Currency is auto-detected from symbols (¥ 円 ₩ 원 ₪ $ € S$) or you can pick it.
- **Freeze & find prices** — freeze the camera frame (kept in memory only, never saved) and the app finds every price in it; tap one to see it converted.
- **Prices on websites** — a bookmarklet (built at `bookmarklet.html` with your home currency and current rates) tags every price on a web page (₩, 원, 만원, $, €, ¥/円, ₪, S$) with its home-currency value; run it again to remove.
- Text reading runs entirely on the phone and works offline after first use.
- Rates come from [open.er-api.com](https://open.er-api.com) (falls back to ECB via frankfurter.app) and are cached for offline use.
- Installable: Chrome/Android show an Install button; on iPhone use Share → Add to Home Screen.

Text recognition uses the browser's built-in `TextDetector` when available, otherwise [Tesseract.js](https://tesseract.projectnaptha.com/) 5.1.1 (Apache-2.0), self-hosted in `site/vendor/tesseract/` and cached by the service worker on first camera use.

## Deploy

Every push to `main` deploys `site/` to GitHub Pages via `.github/workflows/pages.yml`.
If the first run fails at "configure-pages", open **Settings → Pages** and set **Source** to **GitHub Actions**, then re-run the workflow.

## Run locally

```sh
cd site && python3 -m http.server 8000
```

Camera access needs HTTPS or `localhost`.

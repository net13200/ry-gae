'use strict';

// ---------- Currencies ----------
const CURRENCIES = [
  { code: 'ILS', name: 'Israeli shekel', flag: '🇮🇱', symbol: '₪', digits: 2 },
  { code: 'USD', name: 'US dollar',      flag: '🇺🇸', symbol: '$', digits: 2 },
  { code: 'KRW', name: 'Korean won',     flag: '🇰🇷', symbol: '₩', digits: 0 },
  { code: 'JPY', name: 'Japanese yen',   flag: '🇯🇵', symbol: '¥', digits: 0 },
];
const BY_CODE = Object.fromEntries(CURRENCIES.map((c) => [c.code, c]));

// Rough fallback (USD base) so the app works on very first offline launch.
const FALLBACK = { base: 'USD', rates: { USD: 1, ILS: 3.7, KRW: 1400, JPY: 150 }, time: 0, source: 'built-in estimate' };
const RATES_KEY = 'ryogae.rates';
const STATE_KEY = 'ryogae.state';
const STALE_MS = 6 * 60 * 60 * 1000;

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

let rates = store.get(RATES_KEY) || FALLBACK;
const state = Object.assign({ active: 'USD', amount: 100, scanSrc: 'auto', lastScanSrc: 'JPY', zoom: 1 }, store.get(STATE_KEY) || {});
const saveState = () => store.set(STATE_KEY, state);

function convert(amount, from, to) {
  return (amount / rates.rates[from]) * rates.rates[to];
}

function fmt(value, code, withSymbol = false) {
  if (!isFinite(value)) return '';
  const c = BY_CODE[code];
  let digits = c.digits;
  if (digits === 2 && Math.abs(value) >= 10000) digits = 0;
  if (digits === 0 && Math.abs(value) < 1 && value !== 0) digits = 2;
  const s = new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
  return withSymbol ? c.symbol + s : s;
}

function rateStr(r) {
  return r >= 100 ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(r) : String(+r.toPrecision(4));
}

function parseInput(str) {
  const n = parseFloat(String(str).replace(/[^\d.]/g, ''));
  return isFinite(n) ? n : NaN;
}

// ---------- Rates ----------
async function fetchRates() {
  const sources = [
    async () => {
      const r = await fetch('https://open.er-api.com/v6/latest/USD', { cache: 'no-store' });
      const j = await r.json();
      if (j.result !== 'success') throw new Error('bad response');
      return { base: 'USD', rates: pick(j.rates), time: j.time_last_update_unix * 1000, source: 'open.er-api.com' };
    },
    async () => {
      const r = await fetch('https://api.frankfurter.app/latest?from=USD&to=ILS,KRW,JPY', { cache: 'no-store' });
      const j = await r.json();
      return { base: 'USD', rates: pick({ USD: 1, ...j.rates }), time: Date.parse(j.date), source: 'ECB (frankfurter.app)' };
    },
  ];
  for (const s of sources) {
    try {
      const data = await s();
      data.fetched = Date.now();
      return data;
    } catch (e) { console.warn('rate source failed', e); }
  }
  throw new Error('All rate sources failed');
}
function pick(all) {
  const out = {};
  for (const c of CURRENCIES) {
    if (!all[c.code]) throw new Error('missing ' + c.code);
    out[c.code] = all[c.code];
  }
  return out;
}

const refreshBtn = document.getElementById('refresh');
const ratesTime = document.getElementById('rates-time');

function showRatesTime() {
  if (!rates.time) { ratesTime.textContent = 'Offline estimate'; return; }
  const d = new Date(rates.time);
  ratesTime.textContent = 'Rates ' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

async function updateRates(force = false) {
  if (!force && rates.fetched && Date.now() - rates.fetched < STALE_MS) return;
  refreshBtn.classList.add('spin');
  try {
    rates = await fetchRates();
    store.set(RATES_KEY, rates);
    render();
  } catch {
    ratesTime.textContent = 'Offline — using saved rates';
    refreshBtn.classList.remove('spin');
    return;
  }
  refreshBtn.classList.remove('spin');
  showRatesTime();
}
refreshBtn.addEventListener('click', () => updateRates(true));

// ---------- Converter ----------
const conv = document.getElementById('converter');
const inputs = {};
const rateLabels = {};

for (const c of CURRENCIES) {
  const row = document.createElement('label');
  row.className = 'row';
  row.dataset.code = c.code;
  row.innerHTML = `
    <span class="cur"><span class="flag">${c.flag}</span>
      <span><div class="code">${c.code} <span style="color:var(--muted);font-weight:500">${c.symbol}</span></div>
      <div class="name">${c.name}</div></span></span>
    <input type="text" inputmode="decimal" autocomplete="off" placeholder="0" aria-label="${c.name} amount">
    <span class="rate"></span>`;
  const input = row.querySelector('input');
  input.addEventListener('focus', () => {
    state.active = c.code;
    const v = parseInput(input.value);
    input.value = isFinite(v) && v !== 0 ? String(+v.toFixed(c.digits === 0 ? 0 : 2)) : '';
    markActive();
    requestAnimationFrame(() => input.select());
  });
  input.addEventListener('input', () => {
    // allow digits, one dot (commas treated as dots for European keyboards)
    let s = input.value.replace(/,/g, '.').replace(/[^\d.]/g, '');
    const i = s.indexOf('.');
    if (i !== -1) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '');
    if (s !== input.value) input.value = s;
    state.active = c.code;
    state.amount = parseInput(s) || 0;
    saveState();
    render(true);
  });
  input.addEventListener('blur', () => render());
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  conv.appendChild(row);
  inputs[c.code] = input;
  rateLabels[c.code] = row.querySelector('.rate');
}

function markActive() {
  for (const row of conv.children) row.classList.toggle('active', row.dataset.code === state.active);
}

function render(skipActive = false) {
  for (const c of CURRENCIES) {
    rateLabels[c.code].textContent = c.code === state.active ? '' :
      `1 ${state.active} = ${rateStr(convert(1, state.active, c.code))} ${c.code}`;
    if (skipActive && c.code === state.active) continue;
    const v = c.code === state.active ? state.amount : convert(state.amount, state.active, c.code);
    inputs[c.code].value = state.amount ? fmt(v, c.code) : '';
  }
  markActive();
}

// ---------- Camera scanner ----------
const scanner = document.getElementById('scanner');
const video = document.getElementById('video');
const reticle = document.getElementById('reticle');
const statusEl = document.getElementById('scan-status');
const amountEl = document.getElementById('scan-amount');
const convEl = document.getElementById('scan-conv');
const freezeBtn = document.getElementById('freeze');
const useBtn = document.getElementById('use-value');
const torchBtn = document.getElementById('torch');
const picker = document.getElementById('src-picker');

let stream = null;
let running = false;
let paused = false;
let ocrWorker = null;
let ocrLoading = null;
let textDetector = null;
let current = null;          // { amount, code }
let history = [];
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

// Currency picker for scanned prices
for (const code of ['auto', ...CURRENCIES.map((c) => c.code)]) {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('role', 'radio');
  b.dataset.code = code;
  b.textContent = code === 'auto' ? 'Auto' : code;
  b.addEventListener('click', () => {
    state.scanSrc = code;
    if (code !== 'auto') state.lastScanSrc = code;
    saveState();
    updatePicker();
    if (current) showScan(current.amount, current.detected);
  });
  picker.appendChild(b);
}
function updatePicker() {
  for (const b of picker.children) b.setAttribute('aria-checked', String(b.dataset.code === state.scanSrc));
}

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

async function initOcr() {
  if ('TextDetector' in window) {
    try {
      textDetector = new window.TextDetector();
      // Probe: some browsers expose it but throw on use.
      await textDetector.detect(canvas.width ? canvas : (canvas.width = canvas.height = 8, canvas));
      return;
    } catch { textDetector = null; }
  }
  if (ocrWorker) return;
  if (!ocrLoading) {
    ocrLoading = (async () => {
      statusEl.textContent = 'Loading text reader (first time only)…';
      await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
      const w = await Tesseract.createWorker('eng', 1);
      await w.setParameters({
        tessedit_char_whitelist: '0123456789.,$¥₩₪',
        tessedit_pageseg_mode: '6', // uniform block — copes with a stray partial line
      });
      ocrWorker = w;
    })();
  }
  await ocrLoading;
}

async function openScanner() {
  scanner.hidden = false;
  updatePicker();
  current = null; history = [];
  amountEl.textContent = ''; convEl.innerHTML = ''; useBtn.disabled = true;
  paused = false; freezeBtn.textContent = 'Pause';
  statusEl.textContent = 'Starting camera…';
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
  } catch (e) {
    statusEl.textContent = 'Camera unavailable: ' + (e.message || e.name) + '. Allow camera access and try again.';
    return;
  }
  video.srcObject = stream;
  await video.play().catch(() => {});
  const track = stream.getVideoTracks()[0];
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  torchBtn.hidden = !caps.torch;
  if (caps.focusMode && caps.focusMode.includes('continuous')) {
    track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
  }
  hwZoom = caps.zoom && caps.zoom.max > caps.zoom.min ? caps.zoom : null;
  setZoom(state.zoom || 1);
  try { await initOcr(); } catch {
    statusEl.textContent = 'Could not load the text reader. Check your connection.';
    return;
  }
  statusEl.textContent = 'Fit just the price inside the box';
  running = true;
  loop();
}

function closeScanner() {
  running = false;
  scanner.hidden = true;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  torchBtn.classList.remove('on');
}

// ---------- Zoom ----------
// Uses the camera's optical/hardware zoom when the browser exposes it (sharper text for OCR);
// otherwise, or beyond the hardware range, enlarges the preview. The OCR crop follows the
// on-screen box either way, since it is computed from the transformed video rect.
const zoomEl = document.getElementById('zoom');
const MAX_DIGITAL = 6;
let hwZoom = null;
let zoomLevel = 1;
let hwPending = null;

function maxZoom() { return Math.max(MAX_DIGITAL, hwZoom ? hwZoom.max : 0); }

function setZoom(z) {
  zoomLevel = Math.min(maxZoom(), Math.max(1, z));
  let digital = zoomLevel;
  if (hwZoom && stream) {
    const hw = Math.min(hwZoom.max, Math.max(hwZoom.min, zoomLevel));
    digital = zoomLevel / hw;
    // Coalesce rapid pinch updates into one constraint call at a time.
    hwPending = hw;
    if (!setZoom.busy) {
      setZoom.busy = true;
      (async () => {
        while (hwPending !== null) {
          const v = hwPending; hwPending = null;
          try { await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ zoom: v }] }); } catch {}
        }
        setZoom.busy = false;
      })();
    }
  }
  video.style.transform = digital > 1.001 ? `scale(${digital})` : '';
  for (const b of zoomEl.children) b.classList.toggle('on', Math.abs(+b.dataset.z - zoomLevel) < 0.05);
  const custom = ![1, 2, 4].some((v) => Math.abs(v - zoomLevel) < 0.05);
  zoomEl.lastElementChild.textContent = custom && zoomLevel > 2 ? zoomLevel.toFixed(1) + '×' : '4×';
  if (custom && zoomLevel > 2) zoomEl.lastElementChild.classList.add('on');
  state.zoom = zoomLevel;
  history = []; // old readings were taken at a different framing
}

zoomEl.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  setZoom(+b.dataset.z);
  saveState();
});

// Pinch to zoom anywhere on the camera view.
let pinch = null;
const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
scanner.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) pinch = { d: dist(e.touches), z: zoomLevel };
}, { passive: true });
scanner.addEventListener('touchmove', (e) => {
  if (!pinch || e.touches.length !== 2) return;
  e.preventDefault();
  setZoom(pinch.z * dist(e.touches) / pinch.d);
}, { passive: false });
scanner.addEventListener('touchend', (e) => {
  if (pinch && e.touches.length < 2) { pinch = null; saveState(); }
});
// iOS Safari: stop the page itself from zooming.
for (const ev of ['gesturestart', 'gesturechange']) scanner.addEventListener(ev, (e) => e.preventDefault());

// Crop the reticle area from the video frame (accounting for object-fit: cover).
function grabReticle() {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return false;
  const vr = video.getBoundingClientRect();
  const rr = reticle.getBoundingClientRect();
  const scale = Math.max(vr.width / vw, vr.height / vh);
  const offX = (vr.width - vw * scale) / 2;
  const offY = (vr.height - vh * scale) / 2;
  const sx = (rr.left - vr.left - offX) / scale;
  const sy = (rr.top - vr.top - offY) / scale;
  const sw = rr.width / scale;
  const sh = rr.height / scale;
  if (textDetector) {
    // Native detector works best on the untouched image.
    const outW = Math.min(1000, sw);
    canvas.width = outW; canvas.height = Math.round(outW * sh / sw);
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  } else {
    binarize(video, sx, sy, sw, sh, 500);
  }
  return true;
}

// Prepare a frame for Tesseract: scale to a fixed width, adaptive (Bradley) threshold
// so uneven lighting / shadows on paper don't wash out digits, then add a white margin.
function binarize(src, sx, sy, sw, sh, W) {
  const H = Math.max(1, Math.round(W * sh / sw));
  const pad = Math.round(Math.min(W, H) * 0.15) + 8;
  canvas.width = W + pad * 2; canvas.height = H + pad * 2;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, sx, sy, sw, sh, pad, pad, W, H);
  const img = ctx.getImageData(pad, pad, W, H), px = img.data, n = W * H;
  const g = new Uint8Array(n);
  for (let i = 0; i < n; i++) g[i] = (px[i * 4] * 77 + px[i * 4 + 1] * 150 + px[i * 4 + 2] * 29) >> 8;
  const ii = new Float64Array((W + 1) * (H + 1)); // integral image
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) { row += g[y * W + x]; ii[(y + 1) * (W + 1) + x + 1] = ii[y * (W + 1) + x + 1] + row; }
  }
  const half = Math.max(7, Math.round(Math.max(W, H) / 16));
  const on = new Uint8Array(n);
  let dark = 0;
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - half), y1 = Math.min(H, y + half + 1);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - half), x1 = Math.min(W, x + half + 1);
      const sum = ii[y1 * (W + 1) + x1] - ii[y0 * (W + 1) + x1] - ii[y1 * (W + 1) + x0] + ii[y0 * (W + 1) + x0];
      const v = g[y * W + x] * (x1 - x0) * (y1 - y0) < sum * 0.85;
      on[y * W + x] = v; dark += v;
    }
  }
  const invert = dark > n / 2; // light text on a dark background
  for (let i = 0; i < n; i++) px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = (on[i] ^ invert) ? 0 : 255;
  ctx.putImageData(img, pad, pad);
}

async function readText() {
  if (textDetector) {
    const blocks = await textDetector.detect(canvas);
    // Prefer the tallest text (prices are usually the biggest).
    blocks.sort((a, b) => b.boundingBox.height - a.boundingBox.height);
    return blocks.map((b) => b.rawValue).join('\n');
  }
  const { data } = await ocrWorker.recognize(canvas);
  return data.text;
}

// Pull the most price-like number from OCR text.
function parsePrice(text) {
  const t = text.replace(/(?<=\d)[Oo]|[Oo](?=\d)/g, '0');
  const re = /([$¥₩₪]|円|원|NIS|USD|JPY|KRW|ILS)?\s*(\d[\d,.\s]*\d|\d)\s*(円|원|₪|NIS|USD|JPY|KRW|ILS|yen|won)?/gi;
  let best = null;
  let m;
  while ((m = re.exec(t))) {
    const raw = m[2].replace(/\s+/g, '');
    const value = normalizeNumber(raw);
    if (!isFinite(value) || value <= 0) continue;
    const digits = raw.replace(/\D/g, '').length;
    const detected = symbolToCode(m[1] || m[3] || '');
    if (digits < 2 && !detected) continue; // stray "3", "7"… are almost always noise
    const score = digits + (detected ? 3 : 0);
    if (!best || score > best.score) best = { value, detected, score };
  }
  return best;
}

function normalizeNumber(raw) {
  const lastSep = Math.max(raw.lastIndexOf('.'), raw.lastIndexOf(','));
  if (lastSep === -1) return parseFloat(raw);
  const after = raw.length - lastSep - 1;
  // "1,280" / "12.500" → thousands; "12.50" / "3,9" → decimals
  if (after === 3) return parseFloat(raw.replace(/[.,]/g, ''));
  const intPart = raw.slice(0, lastSep).replace(/[.,]/g, '');
  return parseFloat(intPart + '.' + raw.slice(lastSep + 1));
}

function symbolToCode(s) {
  s = s.toLowerCase();
  if (s === '$' || s === 'usd') return 'USD';
  if (s === '¥' || s === '円' || s === 'jpy' || s === 'yen') return 'JPY';
  if (s === '₩' || s === '원' || s === 'krw' || s === 'won') return 'KRW';
  if (s === '₪' || s === 'nis' || s === 'ils') return 'ILS';
  return null;
}

function scanCode(detected) {
  if (state.scanSrc !== 'auto') return state.scanSrc;
  return detected || state.lastScanSrc || 'JPY';
}

function showScan(amount, detected) {
  const code = scanCode(detected);
  current = { amount, detected, code };
  amountEl.textContent = fmt(amount, code, true) + ' ' + code;
  convEl.innerHTML = CURRENCIES.filter((c) => c.code !== code).map((c) =>
    `<div><small>${c.flag} ${c.code}</small><b>${fmt(convert(amount, code, c.code), c.code, true)}</b></div>`).join('');
  useBtn.disabled = false;
  if (state.scanSrc === 'auto') {
    statusEl.textContent = detected ? `Detected ${BY_CODE[detected].name}` : `Assuming ${BY_CODE[code].name} — tap a currency above to change`;
  } else {
    statusEl.textContent = 'Reading live — hold steady';
  }
}

async function loop() {
  while (running) {
    if (!paused && grabReticle()) {
      try {
        const found = parsePrice(await readText());
        if (found) {
          // Vote over recent frames: OCR is noisy (e.g. ¥ misread as 4), the true price repeats.
          // Reads where the currency symbol was recognised are more trustworthy, so they count double.
          history.push(found);
          history = history.slice(-8);
          // A "¥" is often misread as a leading 4 or 7 ("41,670" for "¥1,670"): if the reading minus
          // that digit was also seen recently, count it as the shorter value.
          const seen = new Set(history.map((h) => h.value));
          const canon = (v) => { const t = String(v); const u = Number(t.slice(1)); return /^[47]/.test(t) && seen.has(u) ? u : v; };
          const score = new Map();
          for (const h of history) { const v = canon(h.value); score.set(v, (score.get(v) || 0) + (h.detected ? 2 : 1)); }
          let bestVal = null, bestS = 0;
          for (const [v, sc] of score) if (sc > bestS) { bestS = sc; bestVal = v; }
          const curS = current ? (score.get(current.amount) || 0) : 0;
          // Hysteresis: a new value must clearly beat the one on screen.
          const switchTo = !current ? bestS >= 3 : (bestVal !== current.amount && bestS >= 4 && bestS > curS);
          const det = (v) => (history.find((h) => h.value === v && h.detected) || {}).detected || null;
          if (switchTo) {
            showScan(bestVal, det(bestVal));
            reticle.classList.add('hit');
            setTimeout(() => reticle.classList.remove('hit'), 400);
          } else if (current && !current.detected && det(current.amount)) {
            showScan(current.amount, det(current.amount)); // upgrade "Assuming…" to "Detected…"
          }
        } else if (!current) {
          statusEl.textContent = 'Fit just the price inside the box';
        }
      } catch (e) { console.warn(e); }
    }
    await new Promise((r) => setTimeout(r, textDetector ? 150 : 250));
  }
}

document.getElementById('open-camera').addEventListener('click', openScanner);
document.getElementById('close-camera').addEventListener('click', closeScanner);
freezeBtn.addEventListener('click', () => {
  paused = !paused;
  freezeBtn.textContent = paused ? 'Resume' : 'Pause';
  if (paused) video.pause(); else video.play();
});
useBtn.addEventListener('click', () => {
  if (!current) return;
  state.active = current.code;
  state.amount = current.amount;
  saveState();
  closeScanner();
  render();
});
torchBtn.addEventListener('click', async () => {
  const track = stream && stream.getVideoTracks()[0];
  if (!track) return;
  const on = !torchBtn.classList.contains('on');
  try { await track.applyConstraints({ advanced: [{ torch: on }] }); torchBtn.classList.toggle('on', on); } catch {}
});
document.addEventListener('visibilitychange', () => { if (document.hidden && running) closeScanner(); });

// ---------- Boot ----------
render();
showRatesTime();
updateRates();

// ---------- Install ----------
const installBox = document.getElementById('install');
const installBtn = document.getElementById('install-btn');
const installText = document.getElementById('install-text');
let deferredPrompt = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const dismissed = () => store.get('ryogae.installDismissed');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (!isStandalone() && !dismissed()) { installBtn.hidden = false; installBox.hidden = false; }
});
installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice.catch(() => {});
  deferredPrompt = null;
  installBox.hidden = true;
});
window.addEventListener('appinstalled', () => { installBox.hidden = true; });
document.getElementById('install-close').addEventListener('click', () => {
  installBox.hidden = true;
  store.set('ryogae.installDismissed', true);
});
// iOS Safari has no install prompt — show instructions instead.
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (isIOS && !isStandalone() && !dismissed()) {
  installText.textContent = 'Tap the Share button, then “Add to Home Screen”.';
  installBtn.hidden = true;
  installBox.hidden = false;
}

if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    // Installed apps can stay open for days: look for a new version whenever it's brought back.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
  // A new version took over: reload once so it's used right away (not mid-scan).
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    if (!running) location.reload();
  });
}

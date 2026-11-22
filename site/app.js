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
const state = Object.assign({ active: 'USD', amount: 100, scanSrc: 'auto', lastScanSrc: 'JPY' }, store.get(STATE_KEY) || {});
const saveState = () => store.set(STATE_KEY, state);

function convert(amount, from, to) {
  return (amount / rates.rates[from]) * rates.rates[to];
}

function fmt(value, code, withSymbol = false) {
  if (!isFinite(value)) return '';
  const c = BY_CODE[code];
  let digits = c.digits;
  if (digits === 2 && Math.abs(value) >= 10000) digits = 0;
  if (digits === 0 && Math.abs(value) < 10 && value !== 0) digits = 2;
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
        tessedit_pageseg_mode: '7', // single line of text
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
  try { await initOcr(); } catch {
    statusEl.textContent = 'Could not load the text reader. Check your connection.';
    return;
  }
  statusEl.textContent = 'Aim the box at a price';
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
  const outW = Math.min(1000, Math.max(500, sw));
  const outH = Math.round(outW * (sh / sw));
  canvas.width = outW; canvas.height = outH;
  ctx.filter = 'grayscale(1) contrast(1.6)';
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, outW, outH);
  ctx.filter = 'none';
  return true;
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
          // Require two matching consecutive reads to avoid flicker.
          history.push(found.value);
          history = history.slice(-3);
          const agree = history.filter((v) => v === found.value).length >= 2;
          if (agree && (!current || current.amount !== found.value || current.detected !== found.detected)) {
            showScan(found.value, found.detected);
            reticle.classList.add('hit');
            setTimeout(() => reticle.classList.remove('hit'), 400);
          }
        } else if (!current) {
          statusEl.textContent = 'Aim the box at a price';
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
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

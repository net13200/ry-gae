/* ryōgae — convert prices on any web page into your home currency.
   Built into a bookmarklet by bookmarklet.html: __CONFIG__ is replaced with { home, rates, time }.
   Rules for this file: no line comments, always end statements with semicolons (lines get joined). */
(function () {
  if (window.__ryogae) { window.__ryogae.off(); return; }
  var CFG = __CONFIG__;
  var CUR = {
    ILS: { s: '₪', d: 2 }, USD: { s: '$', d: 2 }, EUR: { s: '€', d: 2 },
    SGD: { s: 'S$', d: 2 }, KRW: { s: '₩', d: 0 }, JPY: { s: '¥', d: 0 }
  };
  var ORDER = ['ILS', 'USD', 'EUR', 'SGD', 'KRW', 'JPY'];
  var rates = CFG.rates, ratesTime = CFG.time, home = CFG.home;
  var badges = [], seen = new WeakSet(), observer = null, timer = null, busy = false;

  var MARK = { '$': 'USD', 'us$': 'USD', 'usd': 'USD', '€': 'EUR', 'eur': 'EUR', 'euro': 'EUR', 'euros': 'EUR',
    's$': 'SGD', 'sgd': 'SGD', '₩': 'KRW', '￦': 'KRW', '원': 'KRW', 'krw': 'KRW', 'won': 'KRW',
    '¥': 'JPY', '￥': 'JPY', '円': 'JPY', '엔': 'JPY', 'jpy': 'JPY', 'yen': 'JPY', '₪': 'ILS', 'ils': 'ILS', 'nis': 'ILS' };
  var D = '[0-9\\uff10-\\uff19]', SEP = '[,.\\uff0c\\uff0e\\u00a0 ]', DEC = '[.,\\uff0c\\uff0e]';
  var NUM = '(' + D + '{1,3}(?:' + SEP + D + '{3})+(?:' + DEC + D + '{1,2})?|' + D + '+(?:' + DEC + D + '{1,2})?)';
  var PRE = '(S\\$|US\\$|\\$|€|₩|￦|¥|￥|₪|(?:KRW|USD|EUR|JPY|ILS|SGD|NIS)(?![A-Za-z]))';
  var POST = '(원|円|엔|₩|￦|€|₪|(?:KRW|USD|EUR|JPY|ILS|SGD|NIS|won|yen|euros?)(?![A-Za-z]))';
  var MAN = '(\\d+(?:[.,]\\d+)?)\\s?만(?:\\s?(\\d+)\\s?천)?\\s?원|(\\d+)\\s?천\\s?원';
  var KC = '[〇○零一二三四五六七八九十百千万萬億0-9\\uff10-\\uff19,\\uff0c]';
  var KAN = '(?:[¥￥]\\s?)?(' + KC + '*[〇○零一二三四五六七八九十百千万萬億]' + KC + '*)\\s?円';
  var RE = new RegExp(MAN + '|' + PRE + '\\s?' + NUM + '|' + NUM + '\\s?' + POST + '|' + KAN, 'gi');
  var FULL = new RegExp('^(?:' + MAN + '|' + PRE + '\\s?' + NUM + '|' + NUM + '\\s?' + POST + '|' + KAN + ')$', 'i');
  var KD = { '〇': 0, '○': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  var KU = { '十': 10, '百': 100, '千': 1000 }, KB = { '万': 1e4, '萬': 1e4, '億': 1e8 };
  var DIGITISH = /[0-9０-９〇一二三四五六七八九十百千万]/;
  function wide(t) {
    return t.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xfee0); })
      .replace(/，/g, ',').replace(/．/g, '.');
  }
  function kanji(s) {
    s = wide(s).replace(/,/g, '');
    var i, ch, total = 0, section = 0, num = null, d = '';
    if (!/[十百千万萬億]/.test(s)) {
      for (i = 0; i < s.length; i++) { ch = s.charAt(i); d += (ch in KD) ? KD[ch] : ch; }
      return /^[0-9]+$/.test(d) ? +d : NaN;
    }
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i);
      if (/[0-9]/.test(ch)) { num = (num || 0) * 10 + (+ch); }
      else if (ch in KD) { num = (num || 0) * 10 + KD[ch]; }
      else if (ch in KU) { section += (num === null ? 1 : num) * KU[ch]; num = null; }
      else if (ch in KB) { total += (section + (num || 0)) * KB[ch]; section = 0; num = null; }
      else { return NaN; }
    }
    return total + section + (num || 0);
  }

  function toNumber(raw) {
    raw = wide(raw).replace(/[  ]/g, '');
    var last = Math.max(raw.lastIndexOf('.'), raw.lastIndexOf(','));
    if (last === -1) { return parseFloat(raw); }
    if (raw.length - last - 1 === 3) { return parseFloat(raw.replace(/[.,]/g, '')); }
    return parseFloat(raw.slice(0, last).replace(/[.,]/g, '') + '.' + raw.slice(last + 1));
  }
  function fromMatch(m) {
    if (m[1] !== undefined) { return { v: parseFloat(m[1].replace(',', '.')) * 10000 + (m[2] ? +m[2] * 1000 : 0), c: 'KRW' }; }
    if (m[3] !== undefined) { return { v: +m[3] * 1000, c: 'KRW' }; }
    if (m[8] !== undefined) { return { v: kanji(m[8]), c: 'JPY' }; }
    if (m[4] !== undefined) { return { v: toNumber(m[5]), c: MARK[m[4].toLowerCase()] }; }
    return { v: toNumber(m[6]), c: MARK[m[7].toLowerCase()] };
  }
  function fmt(v, c) {
    var d = CUR[c].d;
    if (d === 2 && Math.abs(v) >= 10000) { d = 0; }
    if (d === 0 && Math.abs(v) < 1 && v !== 0) { d = 2; }
    return CUR[c].s + new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  }
  function conv(v, from, to) { return v / rates[from] * rates[to]; }

  function makeBadge(p) {
    var b = document.createElement('span');
    b.setAttribute('data-ryogae', '1');
    b.style.cssText = 'display:inline-block!important;margin:0 0 0 4px!important;padding:0 6px!important;border-radius:999px!important;' +
      'background:#c2410c!important;color:#fff!important;font:600 11px/1.65 system-ui,-apple-system,sans-serif!important;' +
      'vertical-align:middle!important;white-space:nowrap!important;cursor:pointer!important;text-decoration:none!important;' +
      'letter-spacing:0!important;text-transform:none!important;position:static!important;opacity:1!important;' +
      'max-width:none!important;width:auto!important;height:auto!important;float:none!important;';
    b._p = p; b._open = false;
    b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); b._open = !b._open; paint(b); }, true);
    paint(b);
    badges.push(b);
    return b;
  }
  function paint(b) {
    var p = b._p, others = [];
    for (var i = 0; i < ORDER.length; i++) { if (ORDER[i] !== p.c) { others.push(fmt(conv(p.v, p.c, ORDER[i]), ORDER[i])); } }
    b.title = fmt(p.v, p.c) + ' ≈ ' + others.join(' · ');
    b.textContent = b._open ? '≈ ' + others.join(' · ') : '≈ ' + fmt(conv(p.v, p.c, home), home);
  }

  var SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|INPUT|SELECT|OPTION|CODE|PRE|SVG|CANVAS|IFRAME|TITLE)$/;
  function skippable(el) {
    for (; el && el !== document.body; el = el.parentElement) {
      if (SKIP.test(el.nodeName.toUpperCase()) || el.isContentEditable || (el.getAttribute && el.getAttribute('data-ryogae'))) { return true; }
    }
    return false;
  }
  function usable(p) { return p && isFinite(p.v) && p.v > 0 && p.c && rates[p.c] && p.c !== home; }

  function scanText(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), nodes = [], n;
    while ((n = walker.nextNode())) { if (DIGITISH.test(n.nodeValue) && !seen.has(n)) { nodes.push(n); } }
    var count = 0;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!node.parentNode || skippable(node.parentElement)) { continue; }
      var text = node.nodeValue, m, hits = [];
      RE.lastIndex = 0;
      while ((m = RE.exec(text))) { var p = fromMatch(m); if (usable(p)) { hits.push({ end: m.index + m[0].length, p: p }); } }
      for (var j = hits.length - 1; j >= 0; j--) {
        var rest = node.splitText(hits[j].end);
        seen.add(rest);
        node.parentNode.insertBefore(makeBadge(hits[j].p), rest);
        count++;
      }
      seen.add(node);
    }
    return count;
  }

  function ownText(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim(); }
  function scanSplit(root) {
    var els = root.querySelectorAll ? root.querySelectorAll('*') : [], count = 0;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (seen.has(el) || !el.childElementCount || el.childElementCount > 5 || el.querySelector('[data-ryogae]')) { continue; }
      var t = ownText(el);
      if (t.length > 32 || !DIGITISH.test(t)) { continue; }
      var m = t.match(FULL);
      if (!m) { continue; }
      var inner = false;
      for (var k = 0; k < el.children.length; k++) { if (FULL.test(ownText(el.children[k]))) { inner = true; } }
      if (inner || skippable(el)) { continue; }
      var p = fromMatch(m);
      if (!usable(p)) { continue; }
      seen.add(el);
      el.appendChild(makeBadge(p));
      count++;
    }
    return count + scanPairs(els);
  }

  /* Number and currency in two neighbouring elements with no wrapper of their own:
     <span>三〇八〇</span><span>円</span> or <i>₩</i><b>12,000</b>. */
  function scanPairs(els) {
    var count = 0;
    for (var i = 0; i < els.length; i++) {
      var a = els[i], b = a.nextElementSibling;
      if (!b || a.childElementCount || b.childElementCount || seen.has(a) || seen.has(b) || seen.has(a.parentNode)) { continue; }
      var ta = ownText(a), tb = ownText(b);
      if (!ta || !tb || !((ta.length <= 20 && tb.length <= 4) || (ta.length <= 4 && tb.length <= 20))) { continue; }
      var joined = ta + tb;
      if (joined.length > 24 || !DIGITISH.test(joined) || FULL.test(ta) || FULL.test(tb)) { continue; }
      var m = joined.match(FULL);
      if (!m || skippable(a)) { continue; }
      var p = fromMatch(m);
      if (!usable(p)) { continue; }
      seen.add(a); seen.add(b);
      b.parentNode.insertBefore(makeBadge(p), b.nextSibling);
      count++;
    }
    return count;
  }

  function scan(root) {
    busy = true;
    var c = 0;
    try { c = scanText(root) + scanSplit(root); } catch (e) { }
    if (observer) { observer.takeRecords(); }
    busy = false;
    return c;
  }

  var toast = null;
  function say(msg) {
    if (!toast) {
      toast = document.createElement('div');
      toast.setAttribute('data-ryogae', '1');
      toast.style.cssText = 'position:fixed!important;z-index:2147483647!important;left:50%!important;bottom:16px!important;transform:translateX(-50%)!important;' +
        'background:#1c1917!important;color:#fff!important;font:500 13px/1.4 system-ui,-apple-system,sans-serif!important;padding:10px 14px!important;' +
        'border-radius:12px!important;box-shadow:0 4px 16px rgba(0,0,0,.3)!important;max-width:90vw!important;text-align:center!important;';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { if (toast) { toast.remove(); toast = null; } }, 4500);
  }
  function ageText() {
    var d = new Date(ratesTime);
    return isFinite(d) && ratesTime ? 'rates ' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'estimated rates';
  }

  var total = scan(document.body);
  say('ryōgae 両替 · ' + total + ' price' + (total === 1 ? '' : 's') + ' → ' + home + ' · ' + ageText() + ' · run again to remove');

  observer = new MutationObserver(function (muts) {
    if (busy) { return; }
    var roots = [];
    for (var i = 0; i < muts.length; i++) {
      for (var j = 0; j < muts[i].addedNodes.length; j++) {
        var a = muts[i].addedNodes[j];
        if (a.nodeType === 1 && a.getAttribute('data-ryogae')) { continue; }
        roots.push(a.nodeType === 3 ? a.parentNode : a);
      }
      if (muts[i].type === 'characterData' && muts[i].target.parentNode) { seen.delete(muts[i].target); roots.push(muts[i].target.parentNode); }
    }
    if (!roots.length) { return; }
    clearTimeout(timer);
    timer = setTimeout(function () {
      for (var k = 0; k < roots.length; k++) { if (roots[k] && roots[k].isConnected) { scan(roots[k]); } }
    }, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  try {
    var ctl = new AbortController();
    setTimeout(function () { ctl.abort(); }, 4000);
    fetch('https://open.er-api.com/v6/latest/USD', { signal: ctl.signal }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || j.result !== 'success') { return; }
      for (var i = 0; i < ORDER.length; i++) { if (!j.rates[ORDER[i]]) { return; } }
      var fresh = {};
      for (var k = 0; k < ORDER.length; k++) { fresh[ORDER[k]] = j.rates[ORDER[k]]; }
      rates = fresh; ratesTime = j.time_last_update_unix * 1000;
      for (var b = 0; b < badges.length; b++) { paint(badges[b]); }
    }).catch(function () { });
  } catch (e) { }

  window.__ryogae = {
    off: function () {
      if (observer) { observer.disconnect(); }
      clearTimeout(timer);
      var parents = [];
      for (var i = 0; i < badges.length; i++) { var p = badges[i].parentNode; if (p) { parents.push(p); p.removeChild(badges[i]); } }
      for (var j = 0; j < parents.length; j++) { try { parents[j].normalize(); } catch (e) { } }
      if (toast) { toast.remove(); toast = null; }
      delete window.__ryogae;
      say('ryōgae 両替 · removed');
    }
  };
})();

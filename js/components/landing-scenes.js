// Line-art city for the landing hero (skyline, phones with mini routes, clouds, a road with a bus that stops at the
// route's collection points) and the closing call-to-action backdrop. Both are drawn as SVG strings from a fixed seed,
// so they look the same on every load. The animation is driven by requestAnimationFrame.
import { esc, raw } from '../core/dom.js';
import { t } from '../core/i18n.js';

const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function rng(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let x = Math.imul(seed ^ seed >>> 15, 1 | seed);
    x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x;
    return ((x ^ x >>> 14) >>> 0) / 4294967296;
  };
}

function phone(px, py) {
  const P = [[24, 206], [52, 206], [80, 178], [80, 150], [104, 126]].map(([x, y]) => [px + x, py + y]);
  const dd = P.map((q, k) => `${k ? 'L' : 'M'}${q[0]} ${q[1]}`).join('');
  return `<rect x="${px}" y="${py}" width="140" height="250" rx="22"/><rect x="${px + 56}" y="${py + 10}" width="28" height="6" rx="3"/><rect x="${px + 50}" y="${py + 236}" width="40" height="4" rx="2"/>`
    + `<path d="M${px + 16} ${py + 60}h108M${px + 16} ${py + 92}h50M${px + 98} ${py + 92}h26M${px + 16} ${py + 224}h70M${px + 40} ${py + 60}v32M${px + 100} ${py + 140}v60" opacity=".55"/>`
    + `<g class="city-tl"><path d="${dd}"/>${P.slice(0, 4).map((q) => `<circle cx="${q[0]}" cy="${q[1]}" r="4.5"/>`).join('')}`
    + (REDUCE ? '' : `<circle class="city-mv" r="4"><animateMotion dur="7s" repeatCount="indefinite" path="${dd}"/></circle>`) + '</g>'
    + `<path class="city-pin" transform="translate(${P[4][0]} ${P[4][1]}) scale(.5)" d="M0 0c-22-26-30-40-30-58a30 30 0 1 1 60 0c0 18-8 32-30 58z"/>`;
}

function build(W, H, seed, maxH, full) {
  const r = rng(seed);
  let x = -10, d = `M0 ${H - 1}H${W}`, out = '', hall = null, clock = null;
  const lm = full ? [{ t: 'hall', x: W * .3 }, { t: 'clock', x: W * .66 }] : [];
  if (full) {
    [.1, .5, .9].forEach((f, i) => { out += phone(W * f - 70, H - 300 - (i === 1 ? 26 : 0)); });
    [[40, 60, 130, 0], [60, 200, 150, -80], [34, 320, 170, -30]].forEach((c) => {
      out += `<g class="city-cloud" style="--d:${c[2]}s;--dl:${c[3]}s"><path transform="translate(0 ${c[1]})" d="M10 34h86a16 16 0 000-32 22 22 0 00-42-6 16 16 0 00-30 8A15 15 0 0010 34z"/></g>`;
    });
  }
  while (x < W) {
    const w = 50 + r() * 80, h = 70 + r() * (maxH - 70), tt = r(), y = H - h;
    const l = lm.filter((q) => q.x >= x && q.x < x + w + 40)[0];
    if (l) {
      if (l.t === 'hall') {
        hall = x + 80;
        d += `M${x} ${H - 1}V${H - 110}H${x + 160}V${H - 1}M${x - 8} ${H - 110}L${x + 80} ${H - 160}L${x + 168} ${H - 110}`;
        for (let c = 14; c < 160; c += 22) d += `M${x + c} ${H - 100}V${H - 1}`;
        x += 180;
      } else {
        clock = x + 32;
        d += `M${x} ${H - 1}V${H - 250}L${x + 32} ${H - 310}L${x + 64} ${H - 250}V${H - 1}M${x + 48} ${H - 210}a16 16 0 1 0-32 0 16 16 0 1 0 32 0M${x + 32} ${H - 210}v-10M${x + 32} ${H - 210}l8 4M${x + 18} ${H - 150}h8v14h-8zM${x + 38} ${H - 150}h8v14h-8z`;
        x += 84;
      }
      lm.splice(lm.indexOf(l), 1);
      continue;
    }
    d += `M${x} ${H - 1}V${y}h${w}V${H - 1}`;
    if (tt > .7) d += `M${x + w / 2} ${y}v-${14 + r() * 18}`;
    else if (tt > .4) d += `M${x + 10} ${y}v-${22 + r() * 24}h${w - 20}v${22 + r() * 24}`;
    for (let yy = y + 14; yy < H - 26; yy += 24) for (let xx = x + 10; xx < x + w - 16; xx += 18) d += `M${xx} ${yy}h8v12h-8z`;
    x += w + 6 + r() * 14;
    if (r() < .4) { d += `M${x} ${H - 1}v-26M${x - 12} ${H - 38}a12 12 0 1 0 24 0 12 12 0 1 0-24 0`; x += 26; }
  }
  return { ln: `${out}<path d="${d}"/>`, hall, clock };
}

const SCENE = build(1600, 360, 11, 240, true);
const SLOTS = [160, SCENE.hall || 520, 800, SCENE.clock || 1090, 1440];

function stationsFor(stops) {
  const list = (stops || []).filter((s) => s && s.name);
  if (!list.length) return [];
  const n = Math.min(5, list.length);
  return Array.from({ length: n }, (_, k) => ({
    x: SLOTS[n === 1 ? 2 : Math.round(k * 4 / (n - 1))],
    name: list[n === list.length ? k : Math.round(k * (list.length - 1) / (n - 1))].name,
  }));
}

const BUS = (code) => `
  <ellipse cx="130" cy="106" rx="120" ry="4" fill="#000" opacity=".16"/>
  <rect x="6" y="14" width="244" height="74" rx="16" fill="var(--brand)"/>
  <path d="M6 62h244v10a16 16 0 01-16 16H22A16 16 0 016 72z" fill="#0F1B2D" opacity=".85"/>
  <rect x="6" y="56" width="244" height="4" fill="#8DB4F8"/>
  ${[0, 1, 2, 3, 4].map((k) => `<rect x="${22 + k * 36}" y="26" width="29" height="26" rx="5" fill="#CFE0FB"/>`).join('')}
  <path d="M214 26h22a10 10 0 0110 10v16h-32z" fill="#CFE0FB"/>
  <rect x="200" y="16" width="36" height="8" rx="3" fill="#0F1B2D"/>
  <text class="bus-code" x="218" y="22.5" font-size="7" font-weight="700" fill="#8DB4F8" text-anchor="middle" font-family="IBM Plex Mono, monospace">${esc(code || 'R1')}</text>
  <rect x="244" y="66" width="8" height="8" rx="3" fill="#FFE9A8"/>
  ${[58, 196].map((cx) => `<g><circle cx="${cx}" cy="88" r="19" fill="var(--canvas)"/><circle cx="${cx}" cy="88" r="16" fill="#0F1B2D" stroke="#8DB4F8" stroke-width="2"/><g class="city-spin"><circle cx="${cx}" cy="88" r="7" fill="#8DB4F8"/><path d="M${cx - 5} 88h10M${cx} 83v10" stroke="#0F1B2D" stroke-width="2"/></g></g>`).join('')}`;

/** Mounts the animated scene into `el` (a data-static element). Returns { update(stops, busNo, code), destroy() }. */
export function createCity(el) {
  el.innerHTML = `<svg class="city-svg" viewBox="0 0 1600 420" preserveAspectRatio="xMidYMax slice" focusable="false">
    <g class="city-ln">${SCENE.ln}</g>
    <rect class="city-rd" x="0" y="360" width="1600" height="60"/>
    <g class="city-tl"><path class="city-rt" d="M0 384H1600"/><g class="stn-dots"></g></g>
    <g class="stn-labels"></g>
    <g class="city-bus" transform="translate(-300 308) scale(.9)">${BUS('R1')}</g>
    <g class="city-tag">
      <rect x="-96" y="0" width="192" height="42" rx="10"/><path d="M-7 42L0 51L7 42z"/>
      <text class="t1" x="0" y="18" text-anchor="middle"></text><text class="t2" x="0" y="34" text-anchor="middle"></text>
    </g></svg>`;
  const g = el.querySelector('.city-bus'), tg = el.querySelector('.city-tag'), a = tg.querySelector('.t1'), b = tg.querySelector('.t2');
  const dots = el.querySelector('.stn-dots'), labels = el.querySelector('.stn-labels'), codeEl = el.querySelector('.bus-code');
  const live = { st: [], busNo: null, reset: false, sig: '' };
  let c = -140, v = 0, i = 0, dwell = 0, last = 0, vis = true, raf = 0, io = null;
  const place = (tm) => g.setAttribute('transform', `translate(${c - 117} ${308 + (v > 8 ? Math.sin(tm * 18) * .8 : 0)}) scale(.9)`);
  const show = (k) => {
    const S = live.st;
    a.textContent = S[k].name;
    b.textContent = live.busNo ? t('Bus {n} · boarding now', { n: live.busNo }) : t('Boarding now');
    tg.setAttribute('transform', `translate(${S[k].x} 252)`);
    tg.classList.add('on');
  };
  const frame = (ms) => {
    const dt = Math.min(.05, (ms - last) / 1000); last = ms;
    const S = live.st;
    if (live.reset) { live.reset = false; c = -140; v = 0; i = 0; dwell = 0; tg.classList.remove('on'); }
    if (vis) {
      if (dwell > 0) { dwell -= dt; v = 0; if (dwell <= 0) tg.classList.remove('on'); }
      else {
        const tgt = i < S.length ? S[i].x : 1800, dist = tgt - c;
        const want = Math.min(130, Math.sqrt(2 * 60 * Math.max(0, dist)) + 6);
        v = Math.min(want, v + 80 * dt); c += v * dt;
        if (i < S.length && c >= tgt - 1.5) { c = tgt; v = 0; dwell = 2.8; show(i); i++; }
        else if (i >= S.length && c >= 1800) { c = -140; i = 0; v = 0; }
      }
      place(ms / 1000);
      g.classList.toggle('stopped', dwell > 0);
    }
    raf = requestAnimationFrame(frame);
  };
  if (!REDUCE) {
    if ('IntersectionObserver' in window) { io = new IntersectionObserver((e) => { vis = e[0].isIntersecting; }); io.observe(el); }
    raf = requestAnimationFrame(frame);
  } else place(0);

  return {
    update(stops, busNo, code) {
      const st = stationsFor(stops);
      live.st = st; live.busNo = busNo;
      const sig = st.map((s) => s.name).join('|');
      if (sig !== live.sig) {
        live.sig = sig; live.reset = true;
        dots.innerHTML = st.map((s) => `<circle cx="${s.x}" cy="384" r="8"/>`).join('');
        labels.innerHTML = st.map((s) => `<text class="city-stn" x="${s.x}" y="414" text-anchor="middle">${esc(s.name)}</text>`).join('');
        if (REDUCE) {
          if (st.length) { const k = Math.floor(st.length / 2); c = st[k].x; show(k); } else c = 800;
          place(0);
        }
      }
      codeEl.textContent = code || 'R1';
    },
    destroy() { cancelAnimationFrame(raf); io?.disconnect(); },
  };
}

// ---------------------------------------------------------------- closing call-to-action scene
const SKYLINE = (() => {
  const r = rng(9), W = 1600, H = 200;
  let d = `M0 ${H - 31}H${W}`, x = -10;
  while (x < W) {
    const w = 50 + r() * 80, h = 40 + r() * 100, y = H - 32 - h, tt = r();
    d += `M${x} ${H - 32}V${y}h${w}V${H - 32}`;
    if (tt > .7) d += `M${x + w / 2} ${y}v-${10 + r() * 14}`;
    for (let yy = y + 12; yy < H - 52; yy += 22) for (let xx = x + 10; xx < x + w - 16; xx += 18) d += `M${xx} ${yy}h8v11h-8z`;
    x += w + 6 + r() * 14;
    if (r() < .35) { d += `M${x} ${H - 32}v-22M${x - 10} ${H - 54}a10 10 0 1 0 20 0 10 10 0 1 0-20 0`; x += 24; }
  }
  return d;
})();

export const finalScene = () => raw(`<div class="fin-scene" aria-hidden="true">
  <svg viewBox="0 0 1600 200" preserveAspectRatio="xMidYMax slice" focusable="false">
    <path class="fin-ln" d="${SKYLINE}"/><rect class="fin-rd" x="0" y="168" width="1600" height="32"/><path class="fin-rl" d="M0 184H1600"/>
  </svg>
  <div class="fin-bus"><svg viewBox="0 0 260 110" focusable="false">
    <rect x="6" y="14" width="244" height="74" rx="16" fill="#2B63D9"/>
    <path d="M6 62h244v10a16 16 0 01-16 16H22A16 16 0 016 72z" fill="#0a1322" opacity=".85"/>
    <rect x="6" y="56" width="244" height="4" fill="#8DB4F8"/>
    ${[0, 1, 2, 3, 4].map((i) => `<rect x="${22 + i * 36}" y="26" width="29" height="26" rx="5" fill="#CFE0FB"/>`).join('')}
    <path d="M214 26h22a10 10 0 0110 10v16h-32z" fill="#CFE0FB"/><rect x="244" y="66" width="8" height="8" rx="3" fill="#FFE9A8"/>
    ${[58, 196].map((cx) => `<g><circle cx="${cx}" cy="88" r="16" fill="#0a1322" stroke="#8DB4F8" stroke-width="2"/><circle cx="${cx}" cy="88" r="6" fill="#8DB4F8"/></g>`).join('')}
  </svg></div></div>`);

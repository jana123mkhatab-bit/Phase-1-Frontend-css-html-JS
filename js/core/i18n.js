import AR, { AR_PLURALS, AR_UNITS, SERVER } from './ar.js';

/**
 * Tiny dependency-free i18n. English source strings are the keys; Arabic lives in ar.js.
 *  - t('Text {x}', { x })      UI strings
 *  - tn(n, 'seat', 'seats')    plurals (Arabic has one/two/few/many forms)
 *  - td(text)                  text produced by the server (names, notifications, ETA bases…)
 * Arabic is the default; the choice is remembered in localStorage.
 */
const KEY = 'lang';
let lang = 'ar';
try { const s = localStorage.getItem(KEY); if (s === 'en' || s === 'ar') lang = s; } catch { /* ignore */ }

const subs = new Set();
function apply() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}
apply();

export const getLang = () => lang;
export const isAr = () => lang === 'ar';
export function setLang(l) {
  if (l === lang) return;
  lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  apply();
  subs.forEach((f) => f());
}
/** Called when the language changes (the router re-renders the whole screen). */
export const onLangChange = (f) => { subs.add(f); return () => subs.delete(f); };

/** Date/time locale: Arabic month and day names, but Western digits (matches the rest of the UI). */
export const dateLocale = () => (lang === 'ar' ? 'ar-EG-u-nu-latn' : undefined);

function unit(u, n) {
  const f = AR_UNITS[u];
  const num = Number(n);
  if (!f || !Number.isInteger(num)) return `${n}`;
  return f[num === 1 ? 0 : num === 2 ? 1 : num >= 3 && num <= 10 ? 2 : 3].replace('{n}', num);
}
// "{n}" is a plain value; "{n#min}" is the value plus a correctly inflected Arabic unit noun
const fill = (s, vars) => (vars ? s.replace(/\{(\w+)(?:#(\w+))?\}/g, (_, k, u) => (vars[k] == null ? `{${k}}` : u ? unit(u, vars[k]) : vars[k])) : s);

// Server-formatted text ("Bus 12 is about 4 min away") is matched against SERVER patterns, most specific first.
const PATTERN = { n: '(\\S*\\d\\S*)', m: '(\\d+)', w: '(\\d+)', time: '(\\d{1,2}:\\d{2})' };
const templates = Object.keys(SERVER).map((k) => {
  const names = [];
  const src = k.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, (_, n) => { names.push(n); return PATTERN[n] ?? '(.+?)'; });
  return [new RegExp(`^${src}$`), names, SERVER[k], k.replace(/\{\w+\}/g, '').length];
}).sort((a, b) => b[3] - a[3]);

export function t(en, vars) {
  if (typeof en !== 'string') return en;
  const s = lang === 'ar' && AR[en] != null ? AR[en] : en;
  return fill(s, vars);
}

export function tn(n, one, other) {
  if (lang !== 'ar') return fill(n === 1 ? one : other, { n });
  const f = AR_PLURALS[other];
  if (!f) return fill(n === 1 ? one : other, { n });
  const i = n === 1 ? 0 : n === 2 ? 1 : n >= 3 && n <= 10 ? 2 : 3;
  return fill(f[i], { n });
}

export function td(text) {
  if (lang !== 'ar' || typeof text !== 'string' || !text) return text;
  if (AR[text] != null && !text.includes('{')) return AR[text];
  for (const [re, names, ar] of templates) {
    const m = text.match(re);
    if (m) return fill(ar, Object.fromEntries(names.map((n, i) => [n, td(m[i + 1])])));
  }
  return text;
}

const SERVER_KEYS = new Set(['name', 'area', 'route_name', 'stop_name', 'basis', 'where', 'title', 'body', 'error', 'detail', 'status_note']);
/** Translate the display strings inside an API response (only known keys, only exact/pattern matches). */
export function localize(v, key) {
  if (lang !== 'ar') return v;
  if (typeof v === 'string') return key && SERVER_KEYS.has(key) ? td(v) : v;
  if (Array.isArray(v)) return v.map((x) => (key === 'problems' ? td(x) : localize(x, key)));
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = localize(v[k], k);
    return out;
  }
  return v;
}

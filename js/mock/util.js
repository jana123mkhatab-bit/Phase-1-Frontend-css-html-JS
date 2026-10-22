// Small helpers shared by the mock backend (dates are local time, like the real API's APP_TZ).
export class MockError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
export const bad = (m, code) => new MockError(400, m, code);
export const notFound = (m = 'Not found') => new MockError(404, m);
export const conflict = (m, code) => new MockError(409, m, code);
export const forbidden = (m = 'Forbidden') => new MockError(403, m);

export const MIN = 60000;
export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const dayKey = (d = new Date()) => DAYS[d.getDay()];
export const iso = (ms) => new Date(ms).toISOString();
export const nowIso = () => new Date().toISOString();
export const hmOf = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12, 0, 0, 0); };
export function localToMs(date, hhmm) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}
const EPOCH = new Date(2020, 0, 1, 12).getTime();
export const dayNo = (date) => Math.round((parseYmd(date).getTime() - EPOCH) / 86400000);
export const dateOfDayNo = (n) => ymd(new Date(EPOCH + n * 86400000));
export const hash = (n) => { let h = Math.imul(n | 0, 2654435761) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; return h >>> 0; };

// ---- validation, same messages as the real API ----
export function str(v, name, { min = 1, max = 200, optional = false } = {}) {
  if (v === undefined || v === null || v === '') { if (optional) return null; throw bad(`${name} is required`); }
  if (typeof v !== 'string') throw bad(`${name} must be text`);
  const t = v.trim();
  if (t.length < min) throw bad(`${name} is required`);
  if (t.length > max) throw bad(`${name} must be at most ${max} characters`);
  return t;
}
export function int(v, name, { min = -Infinity, max = Infinity, optional = false } = {}) {
  if (v === undefined || v === null || v === '') { if (optional) return null; throw bad(`${name} is required`); }
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (!Number.isInteger(n)) throw bad(`${name} must be a whole number`);
  if (n < min || n > max) throw bad(`${name} must be between ${min} and ${max}`);
  return n;
}
export function num(v, name, { min = -Infinity, max = Infinity, optional = false } = {}) {
  if (v === undefined || v === null || v === '') { if (optional) return null; throw bad(`${name} is required`); }
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw bad(`${name} must be a number`);
  if (n < min || n > max) throw bad(`${name} must be between ${min} and ${max}`);
  return n;
}
export function oneOf(v, name, list, { optional = false } = {}) {
  if ((v === undefined || v === null || v === '') && optional) return null;
  if (!list.includes(v)) throw bad(`${name} must be one of: ${list.join(', ')}`);
  return v;
}
export const bool = (v) => (v === true || v === 1 || v === 'true' || v === '1' ? 1 : 0);
export function hhmm(v, name) {
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw bad(`${name} must be HH:MM (24h)`);
  return v;
}
export const median = (xs) => {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

// Place helpers for the errand planner (name matching in Arabic and English, opening hours).
import { dayKey, pad } from './util.js';

export const CATEGORY_DEFAULTS = { bank: 20, pharmacy: 10, printing: 10, food: 20, registrar: 15, library: 30, clinic: 20, worship: 15, building: 10, shop: 15, other: 15 };
export const CATEGORIES = Object.keys(CATEGORY_DEFAULTS);

export function normalise(s) {
  return String(s ?? '').toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[^a-z0-9؀-ۿ ]/g, ' ')
    .split(/\s+/).filter(Boolean).map((w) => (w.length > 3 && w.startsWith('ال') ? w.slice(2) : w)).join(' ');
}

const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
/** Unknown hours count as open (we never claim a place is closed without data). */
export function isOpenAt(place, ms) {
  const d = new Date(ms);
  if (place.closed_days && String(place.closed_days).split(',').includes(dayKey(d))) return false;
  if (place.opens && place.closes) {
    const m = d.getHours() * 60 + d.getMinutes();
    const a = minutesOf(place.opens); const b = minutesOf(place.closes);
    return a <= b ? m >= a && m < b : m >= a || m < b;
  }
  return true;
}
export const hm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export const placeView = (p) => p && ({ id: p.id, name_en: p.name_en, name_ar: p.name_ar, area: p.area, category: p.category, default_stay_min: p.default_stay_min, has_coords: p.lat != null && p.lng != null, opens: p.opens, closes: p.closes, closed_days: p.closed_days });

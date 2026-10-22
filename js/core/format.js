import { t, tn, dateLocale } from './i18n.js';

export const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' }) : '—');
export const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString(dateLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(dateLocale(), { weekday: 'short', month: 'short', day: 'numeric' }) : '—');
export const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function fmtMins(sec) {
  if (sec == null) return '—';
  const m = Math.round(sec / 60);
  if (m < 1) return t('<1 min');
  if (m < 60) return t('{n} min', { n: m });
  return t('{h} h {m} min', { h: Math.floor(m / 60), m: m % 60 });
}
export function ago(sec) {
  if (sec == null) return '';
  if (sec < 60) return t('{n}s ago', { n: sec });
  return t('{n} min ago', { n: Math.round(sec / 60) });
}
// English source labels; always pass them through t() when rendering (the language can change at runtime).
export const BUS_STATUS = {
  active: 'Active', waiting: 'Waiting at university', on_trip: 'On a trip', delayed: 'Delayed', out_of_service: 'Out of service',
};
export const TRIP_STATUS = {
  scheduled: 'Scheduled', preparing: 'Preparing to leave', departed: 'On the road', completed: 'Completed', cancelled: 'Cancelled',
};
export const UPDATE_KIND = { delay: 'Delay', route_change: 'Route change', cancellation: 'Cancellation', breakdown: 'Breakdown', temporary: 'Temporary change' };
/** Label lookups that translate on read. */
export const busStatusLabel = (s) => (BUS_STATUS[s] ? t(BUS_STATUS[s]) : s);
export const tripStatusLabel = (s) => (TRIP_STATUS[s] ? t(TRIP_STATUS[s]) : s);
export const updateKindLabel = (k) => (UPDATE_KIND[k] ? t(UPDATE_KIND[k]) : k);
const TRIP_VERB = { preparing: 'Trip marked as preparing', departed: 'Trip marked as departed', completed: 'Trip marked as completed', cancelled: 'Trip cancelled' };
export const tripVerb = (s) => t(TRIP_VERB[s] || s);
export { tn };
// ---------- CSV ----------
/** One CSV cell: quotes/commas/newlines escaped, and text starting with = + - @ neutralised against spreadsheet formula injection. */
export function csvCell(v) {
  if (v == null) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
/** Download text as a UTF-8 CSV (with BOM so Excel reads accents correctly). */
export function downloadCsv(filename, text) {
  const blob = new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export const ROUTE_COLORS = ['#2B63D9', '#0F1B2D', '#5C86D6', '#8A97AB', '#1E4BAE', '#8DB4F8'];
/** route id -> colour, assigned in route-code order like the original map legend. */
export const colorMap = (routes) => Object.fromEntries([...routes].sort((a, b) => a.code.localeCompare(b.code)).map((r, i) => [r.id, ROUTE_COLORS[i % ROUTE_COLORS.length]]));

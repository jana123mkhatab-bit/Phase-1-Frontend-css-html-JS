import { raw } from './dom.js';

const P = {
  bus: 'M5 17V8a3 3 0 013-3h8a3 3 0 013 3v9M5 13h14M8 20v-3M16 20v-3M5 17h14',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
  pin: 'M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11zM12 12a2 2 0 100-4 2 2 0 000 4z',
  bell: 'M6 9a6 6 0 1112 0c0 6 2 7 2 7H4s2-1 2-7zM10 20a2 2 0 004 0',
  seat: 'M7 4h6a2 2 0 012 2v7H7V6a2 2 0 012-2zM5 13h14v3a2 2 0 01-2 2H7a2 2 0 01-2-2v-3zM8 18v2M16 18v2',
  clock: 'M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z',
  history: 'M3 12a9 9 0 109-9 9 9 0 00-7 3.4M3 4v4h4M12 8v4l3 2',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  route: 'M6 19a2 2 0 100-4 2 2 0 000 4zM18 9a2 2 0 100-4 2 2 0 000 4zM8 17h6a3 3 0 003-3V9M6 15V9a3 3 0 013-3h1',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  wrench: 'M14 6a4 4 0 005 5l-9 9a2 2 0 01-3-3l9-9a4 4 0 01-2-2z',
  alert: 'M12 3l10 18H2L12 3zM12 10v5M12 18v.01',
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  users: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20a6 6 0 0112 0M17 11a3 3 0 100-6M21 20a6 6 0 00-4-5.6',
  cal: 'M4 7h16M7 3v4M17 3v4M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1zM8 12h3',
  logout: 'M15 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4M10 16l-4-4 4-4M6 12h10',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M18 6L6 18M6 6l12 12',
  chevleft: 'M15 6l-6 6 6 6',
  chevright: 'M9 6l6 6-6 6',
  check: 'M5 12l5 5 9-10',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  mic: 'M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3zM6 11a6 6 0 0012 0M12 17v4M9 21h6',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z',
  walk: 'M13 5a2 2 0 100-4 2 2 0 000 4zM9 22l2-7-2.5-2.5 1-5 3 1.5 2.5 3M12 15l3 2.5 1 4.5',
  taxi: 'M5 16v-5l2-5h10l2 5v5M3 16h18M7 19v-3M17 19v-3M9 6V4h6v2',
  car: 'M5 17h14M5 17v-5l2-5h10l2 5v5M7 17v2M17 17v2M7.5 12h9',
  transit: 'M7 3h10a2 2 0 012 2v10a3 3 0 01-3 3H8a3 3 0 01-3-3V5a2 2 0 012-2zM5 11h14M9 21l-2 1M15 21l2 1M9 15h.01M15 15h.01',
  lock: 'M7 11V8a5 5 0 0110 0v3M5 11h14v10H5z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
};

/** Inline SVG icon (returns safe HTML for use inside html`` templates). */
export function icon(name, size = 20) {
  return raw(`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${P[name] || P.bus}"/></svg>`);
}

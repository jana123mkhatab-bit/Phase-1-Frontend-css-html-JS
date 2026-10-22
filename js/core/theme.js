/** Theme choice: 'auto' (follow the OS, live), 'light' or 'dark'. Stored in localStorage; lang-init.js applies it before first paint. */
const KEY = 'theme';
let mode = 'auto';
try { const s = localStorage.getItem(KEY); if (s === 'light' || s === 'dark') mode = s; } catch { /* ignore */ }

function apply() {
  const el = document.documentElement;
  if (mode === 'auto') el.removeAttribute('data-theme'); else el.setAttribute('data-theme', mode);
}
apply();

export const getTheme = () => mode;
export function setTheme(m) {
  if (m === mode) return;
  mode = m;
  try { if (m === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, m); } catch { /* ignore */ }
  apply();
  // update every theme switch on screen without re-rendering the page
  document.querySelectorAll('.theme-seg [data-theme-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-theme-mode') === mode)));
}

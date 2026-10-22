import { html, bool } from '../core/dom.js';
import { t, getLang } from '../core/i18n.js';
import { getTheme } from '../core/theme.js';

/** Shows the language you would switch TO, in that language. */
export function langSwitch(className = 'btn sm secondary') {
  const next = getLang() === 'ar' ? 'en' : 'ar';
  return html`<button type="button" class="${className}" data-lang-switch="${next}" lang="${next}" aria-label="${t('Switch language')}" title="${t('Switch language')}">${next === 'en' ? 'English' : 'العربية'}</button>`;
}

const OPTIONS = [['light', 'Light'], ['dark', 'Dark']];
/** Light / Dark switch. Until one is chosen the OS preference applies, and that one shows as pressed. */
export function themeSwitch() {
  const saved = getTheme();
  const mode = saved === 'auto' ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : saved;
  return html`<div class="seg theme-seg" role="group" aria-label="${t('Theme')}">${OPTIONS.map(([k, label]) => html`<button type="button" data-theme-mode="${k}" aria-pressed="${bool(mode === k)}">${t(label)}</button>`)}</div>`;
}

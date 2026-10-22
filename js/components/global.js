// Document-level handlers for things that appear on many screens: language / theme switches,
// "Why?" dialogs, smooth in-page scrolling and keyboard activation of role="button" elements.
import { html } from '../core/dom.js';
import { setLang, t, getLang, tn } from '../core/i18n.js';
import { setTheme } from '../core/theme.js';
import { etaWhyModal, openModal, aiSentence } from '../core/ui.js';
import { api } from '../core/api.js';
import { navigate } from '../core/router.js';

export function crowdWhyModal({ tripId, samples, pct }) {
  openModal({
    title: t('How this is worked out'),
    setup: (view, modal) => {
      if (tripId) view.load('ai', async () => { const r = await api.get(`/api/student/trips/${tripId}/crowd-explain?lang=${getLang()}`); return r?.ai ? r.sentence : null; });
      return {
        render: () => html`${aiSentence(view.state.ai)}
          <p>${t('Across {n} past trips at this time, about {p}% of the seats were usually booked.', { n: samples, p: pct })}</p>
          <p class="small muted">${t('This counts seat reservations only. Students who board without reserving are not counted, so the bus may be fuller than this.')} ${tn(samples, 'trip', 'trips') && ''}</p>`,
        footer: () => html`<button class="btn" data-click="close">${t('Close')}</button>`,
        actions: { close: () => modal.close() },
      };
    },
  });
}

export function installGlobalHandlers() {
  document.addEventListener('click', (e) => {
    const el = e.target instanceof Element ? e.target : null;
    if (!el) return;
    const ls = el.closest('[data-lang-switch]');
    if (ls) { setLang(ls.getAttribute('data-lang-switch')); return; }
    const th = el.closest('[data-theme-mode]');
    if (th) { setTheme(th.getAttribute('data-theme-mode')); return; }
    const why = el.closest('[data-eta-why]');
    if (why) { etaWhyModal(JSON.parse(why.getAttribute('data-eta-why'))); return; }
    const cw = el.closest('[data-crowd-why]');
    if (cw) { crowdWhyModal(JSON.parse(cw.getAttribute('data-crowd-why'))); return; }
    const sc = el.closest('[data-scroll]');
    if (sc) {
      e.preventDefault();
      const target = document.getElementById(sc.getAttribute('data-scroll'));
      if (target) {
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
        if (target.hasAttribute('tabindex')) target.focus({ preventScroll: true });
      }
      return;
    }
    const nv = el.closest('[data-nav]');
    if (nv) { e.preventDefault(); navigate(nv.getAttribute('data-nav')); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target instanceof Element ? e.target : null;
    if (el && el.getAttribute('role') === 'button' && el.tagName !== 'BUTTON' && (el.hasAttribute('data-click') || el.hasAttribute('data-eta-why'))) {
      e.preventDefault();
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  });
}

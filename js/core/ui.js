// Shared UI kit: toasts, modal, confirm dialog, status badges, ETA / seat widgets.
// Every function returns safe HTML (use inside html`` templates) unless noted.
import { html, raw, esc, cls } from './dom.js';
import { mountView } from './view.js';
import { t, td, getLang } from './i18n.js';
import { fmtMins, fmtTime, ago, busStatusLabel, updateKindLabel } from './format.js';
import { api } from './api.js';
import { icon } from './icons.js';

// ---------- toasts (shown only AFTER the server confirms) ----------
let toastBox = null;
export function toast(message, kind = 'ok') {
  if (!toastBox) {
    toastBox = document.createElement('div');
    toastBox.className = 'toasts';
    toastBox.setAttribute('role', 'status');
    toastBox.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastBox);
  }
  const el = document.createElement('div');
  el.className = `toast ${kind === 'error' ? 'error' : ''}`;
  el.textContent = message;
  toastBox.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

// ---------- modal / confirm ----------
const openModals = new Set();
export function closeAllModals() { [...openModals].forEach((m) => m.close()); }

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let modalSeq = 0;

/**
 * openModal({ title, setup, onClose })
 *   setup(view, modal) -> { render(): html (the body), footer?(): html, actions? }
 *   Esc closes, Tab is trapped inside, focus returns to the opener on close.
 */
export function openModal({ title, setup, onClose }) {
  const prev = document.activeElement;
  const back = document.createElement('div');
  back.className = 'modal-back';
  document.body.appendChild(back);
  const titleId = `modal-title-${++modalSeq}`;
  let closed = false;
  const modal = { view: null, close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', key);
    openModals.delete(modal);
    modal.view?.destroy();
    back.remove();
    prev?.focus?.();
    onClose?.();
  } };
  const box = () => back.querySelector('.modal');
  function key(e) {
    if (e.key === 'Escape') { if (modal.canClose?.() !== false) modal.close(); return; }
    if (e.key !== 'Tab' || !box()) return;
    const f = [...box().querySelectorAll(FOCUSABLE)];
    if (!f.length) { e.preventDefault(); box().focus(); return; }
    const first = f[0], last = f[f.length - 1], a = document.activeElement;
    if (e.shiftKey && (a === first || a === box())) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
    else if (!box().contains(a)) { e.preventDefault(); first.focus(); }
  }
  document.addEventListener('keydown', key);
  back.addEventListener('mousedown', (e) => { if (e.target === back && modal.canClose?.() !== false) modal.close(); });
  openModals.add(modal);
  modal.view = mountView(back, (view) => {
    const spec = setup(view, modal) || {};
    return {
      actions: spec.actions || {},
      after: spec.after,
      render: () => html`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1" data-key="modal-box">
        <h2 id="${titleId}">${typeof title === 'function' ? title() : title}</h2>
        ${spec.render()}
        ${spec.footer ? html`<div class="foot">${spec.footer()}</div>` : ''}
      </div>`,
    };
  });
  // focus the dialog (or its first field) once it is on screen
  setTimeout(() => { const b = box(); if (b && !b.contains(document.activeElement)) (b.querySelector('[autofocus], input, select, textarea') || b).focus(); }, 0);
  return modal;
}

/** confirmDialog({ title, body, danger, confirmLabel, onConfirm }) */
export function confirmDialog(opts) {
  return openModal({
    title: t(opts.title),
    setup: (view, modal) => {
      view.state.busy = false;
      modal.canClose = () => !view.state.busy;
      return {
        render: () => html`<p>${opts.body}</p>`,
        footer: () => html`${opts.hideCancel ? '' : html`<button class="btn secondary" data-click="no" ${view.state.busy ? 'disabled' : ''}>${t('Keep it')}</button>`}
          <button class="btn ${opts.danger ? 'danger' : ''}" data-click="yes" ${view.state.busy ? 'disabled' : ''}>${view.state.busy ? t('Working…') : t(opts.confirmLabel || 'Confirm')}</button>`,
        actions: {
          no: () => modal.close(),
          yes: async () => {
            view.set({ busy: true });
            try { await opts.onConfirm(); modal.close(); } catch (e) { view.set({ busy: false }); toast(e.message, 'error'); }
          },
        },
      };
    },
  });
}

// ---------- basics ----------
export const loading = (label) => html`<div class="loading" role="status"><span class="spinner"></span>${label ?? t('Loading…')}</div>`;
export const errorBox = (error, retryKey) => (error ? html`<div class="alert error" role="alert"><div style="flex:1">${error.message}</div>${retryKey ? html`<button class="btn sm secondary" data-retry="${retryKey}">${t('Retry')}</button>` : ''}</div>` : '');
export const empty = (title, children = '') => html`<div class="empty"><b>${title}</b>${children}</div>`;
export const pageHead = (title, sub, actions) => html`<div class="page-head"><div><h1>${title}</h1>${sub ? html`<p>${sub}</p>` : ''}</div>${actions ? html`<div class="row">${actions}</div>` : ''}</div>`;

export function field({ label, hint, error, id }, inner) {
  return html`<div class="field ${error ? 'invalid' : ''}">
    <label for="${id || ''}">${label}</label>
    ${inner}
    ${hint && !error ? html`<span class="hint">${hint}</span>` : ''}
    ${error ? html`<span class="field-error" id="${id ? `${id}-err` : ''}" role="alert">${error}</span>` : ''}
  </div>`;
}

/** Password input wrapped with show/hide toggle. */
export function passwordInput({ id, value = '', bind, autocomplete = 'current-password', required = false, visible = false, toggleAction = 'toggle-pw', key = '' }) {
  const isVis = !!visible;
  const ariaLabel = isVis ? t('Hide password') : t('Show password');
  return html`<div class="password-wrap" data-key="wrap-${id || key}">
    <input id="${id}" type="${isVis ? 'text' : 'password'}" class="input" ${bind ? raw(`data-bind="${esc(bind)}"`) : ''} value="${value}" autocomplete="${autocomplete}" ${required ? 'required' : ''}>
    <button type="button" class="pw-toggle" data-click="${toggleAction}" ${key ? raw(`data-pw-key="${esc(key)}"`) : ''} aria-label="${ariaLabel}" title="${ariaLabel}" tabindex="0">
      ${icon(isVis ? 'eyeOff' : 'eye', 18)}
    </button>
  </div>`;
}

/** Data view with loading / error / empty handled consistently. `st` is view.state[key], `key` the loader key. */
export function asyncBlock(st, key, children, { empty: isEmpty } = {}) {
  if (!st || (st.loading && !st.data)) return loading();
  if (st.error && !st.data) return errorBox(st.error, key);
  if (!st.data) return '';
  return html`${st.error ? errorBox(st.error, key) : ''}${isEmpty && isEmpty(st.data) ? '' : children(st.data)}`;
}

// ---------- domain widgets ----------
export function busStatusBadge(status) {
  const c = { delayed: 'warn', out_of_service: 'crit', on_trip: 'live', active: 'sky' }[status] || '';
  return html`<span class="badge ${c}">${busStatusLabel(status)}</span>`;
}
export function tripStatusBadge(trip) {
  const { status } = trip;
  if (status === 'cancelled') return html`<span class="badge crit">${t('Cancelled')}</span>`;
  if (status === 'departed') return html`<span class="badge live"><span class="dot"></span>${trip.delay_minutes > 0 ? t('On the road · +{n} min', { n: trip.delay_minutes }) : t('On the road')}</span>`;
  if (status === 'preparing') return html`<span class="badge sky">${t('Preparing to leave')}</span>`;
  if (status === 'completed') return html`<span class="badge">${t('Completed')}</span>`;
  if (trip.delay_minutes > 0) return html`<span class="badge warn">${t('Delayed {n} min', { n: trip.delay_minutes })}</span>`;
  if (trip.overdue_minutes > 0) return html`<span class="badge warn">${t('{n} min past schedule · not reported', { n: trip.overdue_minutes })}</span>`;
  return html`<span class="badge">${t('Scheduled {time}', { time: fmtTime(trip.scheduled_departure) })}</span>`;
}

// ---------- AI status / sentences ----------
let aiStatus = null;
/** Whether the (demo) server has AI enabled; fetched once. Screens use their manual path unless it is true. */
export async function aiEnabled() {
  if (aiStatus === null) {
    try { aiStatus = Boolean((await api.get('/api/student/ai/status')).ai); } catch { aiStatus = false; }
  }
  return aiStatus;
}
/** Shows an AI-written sentence with a visible label, or a short waiting note while it is being written. */
export function aiSentence(state, className = '') {
  if (!state) return '';
  if (state.loading) return html`<p class="small muted ${className}" role="status">${t('Asking the AI to explain… this can take a few seconds.')}</p>`;
  if (!state.data) return '';
  return html`<p class="${className}"><span class="badge navy" style="margin-inline-end:8px">${t('AI-written')}</span>${state.data}</p>`;
}

/** ETA with an honest label of how it was derived. The "Why?" button is handled globally (see global.js). */
export function etaView(eta, { big = true, tripId = null, stopId = null } = {}) {
  if (!eta) return '';
  const pred = eta.kind === 'live' ? eta.predicted : null;
  const label = t({ live: 'Live', scheduled: 'Scheduled estimate', estimate: 'Estimate', stale: 'Paused', overdue: 'No ETA', passed: 'Passed', unavailable: 'No ETA' }[eta.kind]);
  const text = pred ? fmtMins(pred.seconds) : eta.seconds != null ? fmtMins(eta.seconds) : eta.kind === 'passed' ? t('Passed') : '—';
  const pct = pred ? Math.round(Math.abs(pred.factor - 1) * 100) : 0;
  const why = pred ? JSON.stringify({ tripId, stopId, pct, factor: pred.factor, samples: pred.samples, basis: eta.predicted_basis }) : '';
  return html`<div class="eta" aria-live="polite">
    <div class="row" style="gap:8px">
      <span class="badge ${eta.kind === 'live' ? 'live' : eta.kind === 'stale' || eta.kind === 'overdue' ? 'warn' : ''}">${eta.kind === 'live' ? html`<span class="dot"></span>` : ''}${label}</span>
      ${pred ? html`<span class="badge sky">${t('Predicted')}</span>` : ''}
      ${(pred?.arrival || eta.arrival) ? html`<span class="small muted mono" dir="ltr">≈ ${fmtTime(pred?.arrival ?? eta.arrival)}</span>` : ''}
    </div>
    <div class="${big ? 'big' : ''}" style="${big ? '' : 'font-weight:800;color:var(--ink)'}">${text}</div>
    ${pred ? html`<div class="small">${t('GPS only: {x}', { x: fmtMins(eta.seconds) })} <button type="button" class="btn sm ghost" aria-haspopup="dialog" data-eta-why="${why}">${t('Why?')}</button></div>` : ''}
    <div class="basis">${pred ? td(eta.predicted_basis) : td(eta.basis)}</div>
  </div>`;
}
export function etaWhyModal(info) {
  const { tripId, stopId, pct, factor, samples, basis } = info;
  openModal({
    title: t('Why this time?'),
    setup: (view, modal) => {
      if (tripId && stopId) view.load('ai', async () => { const r = await api.get(`/api/student/eta/explain?trip_id=${tripId}&stop_id=${stopId}&lang=${getLang()}`); return r?.ai ? r.sentence : null; });
      return {
        render: () => html`<p>${pct < 3 ? t('Based on {n} earlier trips at this time, this stop is usually about as fast as the GPS suggests.', { n: samples })
          : factor > 1 ? t('Based on {n} earlier trips at this time, this stop is usually {p}% slower than GPS suggests.', { n: samples, p: pct })
            : t('Based on {n} earlier trips at this time, this stop is usually {p}% faster than GPS suggests.', { n: samples, p: pct })}</p>
          ${aiSentence(view.state.ai)}
          <p class="small muted">${td(basis)}. ${t('The GPS-only figure is always shown next to it.')}</p>`,
        footer: () => html`<button class="btn" data-click="close">${t('Close')}</button>`,
        actions: { close: () => modal.close() },
      };
    },
  });
}

export function seatBar(seats) {
  const pct = seats.capacity ? Math.min(100, (seats.reserved / seats.capacity) * 100) : 0;
  return html`<div>
    <div class="row between small"><b>${t('{a} of {c} seats free', { a: seats.available, c: seats.capacity })}</b><span class="muted">${t('{n} reserved', { n: seats.reserved })}</span></div>
    <div class="seatbar ${seats.available === 0 ? 'full' : ''}" role="img" aria-label="${t('{r} of {c} seats reserved', { r: seats.reserved, c: seats.capacity })}"><i style="width:${pct}%"></i></div>
  </div>`;
}

export function gpsNote(trip) {
  if (!trip.position) return trip.status === 'departed' ? html`<span class="small muted">${t('No GPS received yet')}</span>` : '';
  const p = trip.position;
  return html`<span class="small muted">${p.fresh ? t('GPS') : t('GPS silent')} · ${t('updated {when}', { when: ago(p.age_sec) })} · ${p.source === 'demo' ? t('simulated') : t('device')}</span>`;
}

// The demo-data banner was removed on request; callers still invoke it, so it stays as a no-op.
const SVC = { delay: ['warn', 'clock'], route_change: ['warn', 'route'], cancellation: ['crit', 'alert'], breakdown: ['crit', 'wrench'], temporary: ['info', 'bell'] };
/** A service update (delay, cancellation, ...) as a clear alert: severity colour, icon, what happened, who it affects, and how long ago. */
export function serviceAlert(u) {
  const [tone, ic] = SVC[u.kind] ?? ['info', 'bell'];
  const posted = u.created_at ? Math.max(0, Math.round((Date.now() - new Date(u.created_at).getTime()) / 1000)) : null;
  return html`<article class="svc-alert ${tone}" role="${tone === 'crit' ? 'alert' : 'status'}" data-key="svc-${u.id}">
    <span class="svc-ico" aria-hidden="true">${icon(ic, 20)}</span>
    <div class="svc-body">
      <div class="svc-top"><span class="svc-kind">${updateKindLabel(u.kind)}</span>
        ${u.route_code ? html`<span class="badge navy">${u.route_code} ${td(u.route_name ?? '')}</span>` : html`<span class="badge">${t('All routes')}</span>`}
        ${u.bus_number ? html`<span class="badge">${t('Bus {n}', { n: u.bus_number })}</span>` : ''}
        ${u.delay_minutes ? html`<span class="badge warn">+${t('{n} min', { n: u.delay_minutes })}</span>` : ''}
        ${posted != null ? html`<span class="small muted svc-time">${ago(posted)}</span>` : ''}</div>
      <b class="svc-title">${td(u.title)}</b>
      <p class="svc-msg">${td(u.message)}</p>
    </div>
  </article>`;
}

export function simBanner() {
  return '';
}

export { html, raw, esc, cls, icon };

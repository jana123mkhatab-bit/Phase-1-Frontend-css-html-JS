import { html } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { fmtDateTime, UPDATE_KIND, updateKindLabel } from '../../core/format.js';
import { asyncBlock, pageHead, empty, toast, confirmDialog } from '../../core/ui.js';
import { openForm } from '../../components/form-modal.js';

export default function updates(view, ctx) {
  ctx.setTitle('Service updates');
  const ups = view.load('ups', () => api.get('/api/admin/updates'), { ms: 10000 });
  view.load('routes', () => api.get('/api/admin/routes'));
  view.load('buses', () => api.get('/api/admin/buses'));
  const draft = ctx.state?.draft ?? null;

  function add() {
    openForm({
      title: t('New service update'), submitLabel: t('Send to students'),
      fields: [
        { key: 'kind', label: t('Type'), type: 'select', noBlank: true, options: Object.entries(UPDATE_KIND).map(([value, label]) => ({ value, label: t(label) })) },
        { key: 'route_id', label: t('Affects route'), type: 'select-number', blank: t('All routes'), options: (view.state.routes.data?.routes ?? []).map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` })) },
        { key: 'bus_id', label: t('Bus (optional)'), type: 'select-number', options: (view.state.buses.data?.buses ?? []).map((b) => ({ value: b.id, label: t('Bus {n}', { n: b.number }) })) },
        { key: 'delay_minutes', label: t('Delay in minutes (optional)'), type: 'number', int: true, min: 0, max: 240, hint: t('0 to 240') },
        { key: 'title', label: t('Headline'), required: true, minLength: 3, max: 100, wide: true },
        { key: 'message', label: t('Message to students'), type: 'textarea', required: true, minLength: 5, max: 500, hint: t('Up to 500 characters') },
      ],
      initial: draft ? { kind: draft.kind, route_id: draft.route_id ?? '', title: draft.title, message: draft.body } : { kind: 'delay' },
      onSubmit: async (v) => { const r = await api.post('/api/admin/updates', v); toast(t('Update sent to {n} student(s)', { n: r.notified })); ups.reload(); },
    });
  }
  if (draft) view.timeout(add, 0);

  return {
    render: () => html`${pageHead(t('Delays & service updates'), t('Tell students about delays, route changes, cancellations, breakdowns or temporary changes. Updates are sent to the affected route (or everyone) and show on their dashboard until resolved.'), html`<button class="btn" data-click="add">${t('New update')}</button>`)}
      <div class="alert info small"><div>${t('Posting an update informs students. To actually delay or cancel a specific trip, use')} <b>${t('Schedules & trips')}</b>${t(', which also notifies students and frees reserved seats.')}</div></div>
      ${draft?.ai ? html`<div class="alert info small" role="note"><div>${t('The wording of this draft was written by AI from what the monitoring system found. Check it before you send it.')}</div></div>` : ''}
      ${asyncBlock(view.state.ups, 'ups', (d) => html`<div class="stack">${d.updates.map((u) => html`<article class="card" data-key="u-${u.id}" style="${!u.active ? 'opacity:.7' : ''}">
        <div class="row between"><div class="row"><span class="badge ${u.active ? 'warn' : ''}">${updateKindLabel(u.kind)}</span><h3>${u.title}</h3></div>${u.active ? html`<button class="btn sm secondary" data-click="resolve" data-id="${u.id}">${t('Resolve')}</button>` : html`<span class="badge">${t('Resolved')}</span>`}</div>
        <p style="margin:8px 0">${u.message}</p>
        <div class="small muted">${u.route_code ? t('Route {code}', { code: u.route_code }) : t('All routes')}${u.bus_number ? ` · ${t('Bus {n}', { n: u.bus_number })}` : ''}${u.delay_minutes != null ? ` · ${t('{n} min', { n: u.delay_minutes })}` : ''} · ${fmtDateTime(u.created_at)} · ${u.author ?? t('system')}</div>
      </article>`)}</div>`, { empty: (d) => d.updates.length === 0 })}
      ${view.state.ups.data?.updates.length === 0 ? empty(t('No service updates yet')) : ''}`,
    actions: {
      add,
      resolve: (el) => confirmDialog({ title: t('Mark as resolved?'), body: t('Students are notified that this issue is resolved and the banner is removed.'), confirmLabel: t('Resolve'),
        onConfirm: async () => { try { await api.patch(`/api/admin/updates/${el.dataset.id}/resolve`); toast(t('Update resolved')); ups.reload(); } catch (e) { toast(e.message, 'error'); } } }),
    },
  };
}

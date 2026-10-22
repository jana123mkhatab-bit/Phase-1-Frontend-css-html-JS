import { html, bool } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { fmtDateTime } from '../../core/format.js';
import { asyncBlock, pageHead, empty, toast } from '../../core/ui.js';
import { openForm } from '../../components/form-modal.js';

const CAT = { bus: 'Bus', collection_point: 'Collection point', route: 'Route', service: 'Service', other: 'Other' };
const ST = { open: 'Open', in_review: 'In review', resolved: 'Resolved', dismissed: 'Dismissed' };

export default function issues(view, ctx) {
  ctx.setTitle('Student issues');
  view.state.status = 'open';
  const list = view.load('list', () => api.get(`/api/admin/issues${view.state.status === 'all' ? '' : `?status=${view.state.status}`}`), { ms: 10000 });
  return {
    render: () => {
      const { status } = view.state;
      return html`${pageHead(t('Student issue reports'), t('Problems reported by students about buses, collection points, routes and the service. Your reply is sent back to the student.'))}
      <div class="seg" role="group" aria-label="${t('Filter')}">${['open', 'in_review', 'resolved', 'dismissed', 'all'].map((s) => html`<button aria-pressed="${bool(status === s)}" data-click="status" data-s="${s}">${s === 'all' ? t('All') : t(ST[s])}</button>`)}</div>
      ${asyncBlock(view.state.list, 'list', (d) => html`<div class="stack">${d.issues.map((i) => html`<article class="card" data-key="i-${i.id}">
        <div class="row between"><div class="row"><span class="badge navy">${t(CAT[i.category])}</span><span class="badge ${i.status === 'open' ? 'warn' : ''}">${t(ST[i.status])}</span>${i.bus_number ? html`<span class="bus-chip">${i.bus_number}</span>` : ''}${i.stop_name ? html`<span class="badge">${i.stop_name}</span>` : ''}${i.route_code ? html`<span class="badge">${i.route_code}</span>` : ''}</div>
          <button class="btn sm" data-click="review" data-id="${i.id}">${t('Review')}</button></div>
        <p style="margin:10px 0">${i.description}</p>
        ${i.admin_note ? html`<div class="alert info small"><div><b>${t('Your reply')}</b><br>${i.admin_note}</div></div>` : ''}
        <div class="small muted">${i.student_name} · ${i.student_email} · ${fmtDateTime(i.created_at)}</div>
      </article>`)}</div>`, { empty: (d) => d.issues.length === 0 })}
      ${view.state.list.data?.issues.length === 0 ? empty(t('Nothing here'), html`<p>${t('No reports match this filter.')}</p>`) : ''}`;
    },
    actions: {
      status: (el) => { view.state.status = el.dataset.s; list.reload(); },
      review: (el) => {
        const e = view.state.list.data.issues.find((i) => i.id === Number(el.dataset.id));
        openForm({
          title: t('Review report'), initial: { status: e.status, admin_note: e.admin_note ?? '' },
          fields: [{ key: 'status', label: t('Status'), type: 'select', noBlank: true, options: Object.entries(ST).map(([value, label]) => ({ value, label: t(label) })) }, { key: 'admin_note', label: t('Reply to the student'), type: 'textarea', max: 500, hint: t('Optional, up to 500 characters. Sent to the student.') }],
          onSubmit: async (v) => { await api.patch(`/api/admin/issues/${e.id}`, v); toast(t('Report updated, student notified')); list.reload(); },
        });
      },
    },
  };
}

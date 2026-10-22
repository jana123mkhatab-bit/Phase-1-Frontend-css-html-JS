import { html, bool } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { BUS_STATUS } from '../../core/format.js';
import { asyncBlock, pageHead, empty, busStatusBadge, toast, confirmDialog } from '../../core/ui.js';
import { openForm } from '../../components/form-modal.js';

export default function buses(view, ctx) {
  ctx.setTitle('Buses');
  const buses = view.load('buses', () => api.get('/api/admin/buses'), { ms: 10000 });
  view.load('drivers', () => api.get('/api/admin/drivers'));
  view.load('routes', () => api.get('/api/admin/routes'));
  view.state.filter = 'all';

  function edit(b) {
    const fields = [
      { key: 'number', label: t('Bus number'), required: true, max: 20, pattern: /^[A-Za-z0-9][A-Za-z0-9 -]*$/, patternMsg: t('Bus number may contain letters, digits, spaces and dashes only'),
        validate: (val) => ((view.state.buses.data?.buses ?? []).some((x) => x.id !== b.id && x.number.toLowerCase() === String(val).trim().toLowerCase()) ? t('Bus {n} already exists', { n: String(val).trim() }) : '') },
      { key: 'plate', label: t('Plate'), max: 20 },
      { key: 'capacity', label: t('Capacity (seats)'), type: 'number', int: true, min: 1, max: 120, required: true, hint: t('1 to 120') },
      { key: 'status', label: t('Status'), type: 'select', noBlank: true, options: Object.entries(BUS_STATUS).map(([value, label]) => ({ value, label: t(label) })) },
      { key: 'route_id', label: t('Assigned route'), type: 'select-number', options: (view.state.routes.data?.routes ?? []).map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` })) },
      { key: 'driver_id', label: t('Assigned driver'), type: 'select-number', options: (view.state.drivers.data?.drivers ?? []).filter((d) => d.active).map((d) => ({ value: d.id, label: d.name })) },
      { key: 'status_note', label: t('Status note'), wide: true, max: 200, hint: t('Shown to students, e.g. the reason a bus is out of service.') },
    ];
    openForm({
      title: b.id ? t('Edit bus {n}', { n: b.number }) : t('Add bus'), fields, initial: b,
      onSubmit: async (v) => {
        if (b.id) await api.put(`/api/admin/buses/${b.id}`, v); else await api.post('/api/admin/buses', v);
        toast(b.id ? t('Bus {n} updated', { n: v.number }) : t('Bus {n} added', { n: v.number })); buses.reload();
      },
    });
  }

  return {
    render: () => {
      const { filter } = view.state;
      const rows = (view.state.buses.data?.buses ?? []).filter((b) => filter === 'all' || b.status === filter);
      return html`${pageHead(t('Buses'), t('Bus number, capacity, assigned driver and route, and operating status.'), html`<button class="btn" data-click="add">${t('Add bus')}</button>`)}
      <div class="seg" role="group" aria-label="${t('Filter by status')}">
        <button aria-pressed="${bool(filter === 'all')}" data-click="filter" data-k="all">${t('All')}</button>
        ${Object.entries(BUS_STATUS).map(([k, v]) => html`<button aria-pressed="${bool(filter === k)}" data-click="filter" data-k="${k}">${t(v)}</button>`)}
      </div>
      ${asyncBlock(view.state.buses, 'buses', () => (rows.length ? html`<div class="table-wrap"><table class="t"><thead><tr><th>${t('Bus')}</th><th>${t('Plate')}</th><th>${t('Capacity')}</th><th>${t('Route')}</th><th>${t('Driver')}</th><th>${t('Status')}</th><th></th></tr></thead><tbody>
        ${rows.map((b) => html`<tr data-key="b-${b.id}"><td><span class="bus-chip">${b.number}</span></td><td class="mono">${b.plate ?? '—'}</td><td>${b.capacity}</td><td>${b.route_code ? `${b.route_code} · ${b.route_name}` : '—'}</td><td>${b.driver_name ?? html`<span class="muted">${t('Unassigned')}</span>`}</td>
          <td>${busStatusBadge(b.status)}${b.status_note ? html`<div class="small muted">${b.status_note}</div>` : ''}</td>
          <td class="actions"><button class="btn sm secondary" data-click="edit" data-id="${b.id}">${t('Edit')}</button>
            <button class="btn sm danger outline" data-click="del" data-id="${b.id}">${t('Delete')}</button></td></tr>`)}
      </tbody></table></div>` : empty(t('No buses match'), html`<p>${t('Add a bus or change the filter.')}</p>`)))}`;
    },
    actions: {
      add: () => edit({}),
      filter: (el) => view.set({ filter: el.dataset.k }),
      edit: (el) => edit(view.state.buses.data.buses.find((b) => b.id === Number(el.dataset.id))),
      del: (el) => {
        const b = view.state.buses.data.buses.find((x) => x.id === Number(el.dataset.id));
        confirmDialog({ title: t('Delete bus {n}?', { n: b.number }), body: t('Only buses without any trip history can be deleted. Otherwise mark the bus out of service.'), confirmLabel: t('Delete'), danger: true,
          onConfirm: async () => { try { await api.del(`/api/admin/buses/${b.id}`); toast(t('Bus {n} deleted', { n: b.number })); buses.reload(); } catch (e) { toast(e.message, 'error'); } } });
      },
    },
  };
}

import { html } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { asyncBlock, pageHead, empty, toast, confirmDialog } from '../../core/ui.js';
import { openForm } from '../../components/form-modal.js';

export default function drivers(view, ctx) {
  ctx.setTitle('Drivers');
  const drivers = view.load('drivers', () => api.get('/api/admin/drivers'));
  const buses = view.load('buses', () => api.get('/api/admin/buses'));
  view.load('routes', () => api.get('/api/admin/routes'));
  const find = (el) => view.state.drivers.data.drivers.find((x) => x.id === Number(el.dataset.id));

  function edit(d) {
    openForm({
      title: d.id ? t('Edit driver') : t('Add driver'), initial: d,
      fields: [
        { key: 'name', label: t('Full name'), required: true, minLength: 2, max: 80 },
        { key: 'phone', label: t('Phone'), type: 'tel', max: 30, pattern: /^\+?[0-9][0-9 ()-]{5,}$/, patternMsg: t('Phone must be digits, optionally starting with + (at least 6 digits)'), hint: t('e.g. +20 100 123 4567') },
        {
          key: 'license_no', label: t('License number'), max: 30,
          validate: (val) => {
            const raw = typeof val === 'string' ? val.trim() : '';
            if (!raw) return '';
            const norm = raw.toLowerCase();
            const list = view.state.drivers?.data?.drivers ?? [];
            const clash = list.some((x) => x.id !== d.id && typeof x.license_no === 'string' && x.license_no.trim().toLowerCase() === norm);
            return clash ? t('This license number is already assigned to another driver. Please enter a unique license number.') : '';
          },
        },
        { key: 'active', label: t('Active driver'), type: 'checkbox' },
      ],
      onSubmit: async (v) => {
        if (d.id) await api.put(`/api/admin/drivers/${d.id}`, v); else await api.post('/api/admin/drivers', v);
        toast(d.id ? t('Driver updated') : t('Driver added')); drivers.reload();
      },
    });
  }
  function assign(d) {
    openForm({
      title: t('Assign {name}', { name: d.name }), submitLabel: t('Assign'), note: t('This sets the driver on the bus and on its upcoming trips. A bus that is on a trip cannot change driver until it finishes.'),
      fields: [
        { key: 'bus_id', label: t('Bus'), type: 'select-number', required: true, blank: t('Choose a bus…'), options: (view.state.buses.data?.buses ?? []).map((b) => ({ value: b.id, label: `${t('Bus {n}', { n: b.number })}${b.driver_name ? ` ${t('(now {name})', { name: b.driver_name })}` : ''}` })) },
        { key: 'route_id', label: t('Route (optional)'), type: 'select-number', blank: t('Keep the bus’s route'), options: (view.state.routes.data?.routes ?? []).filter((r) => r.active).map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` })) },
      ],
      onSubmit: async (v) => { await api.post(`/api/admin/drivers/${d.id}/assign`, v); toast(t('Driver assigned')); drivers.reload(); buses.reload(); },
    });
  }

  return {
    render: () => html`${pageHead(t('Drivers'), t('Driver details and assignments. A trip’s responsible driver is shown to students and admins.'), html`<button class="btn" data-click="add">${t('Add driver')}</button>`)}
      ${asyncBlock(view.state.drivers, 'drivers', (d) => html`<div class="table-wrap"><table class="t"><thead><tr><th>${t('Name')}</th><th>${t('Phone')}</th><th>${t('License')}</th><th>${t('Assigned bus')}</th><th>${t('Route')}</th><th>${t('Status')}</th><th></th></tr></thead><tbody>
        ${d.drivers.map((x) => html`<tr data-key="d-${x.id}"><td><b>${x.name}</b></td><td class="mono" dir="ltr">${x.phone ?? '—'}</td><td class="mono">${x.license_no ?? '—'}</td><td>${x.buses ?? html`<span class="muted">${t('Unassigned')}</span>`}</td><td>${x.routes ?? '—'}</td><td>${x.active ? t('Active') : html`<span class="badge">${t('Inactive')}</span>`}</td>
          <td class="actions"><button class="btn sm" ${!x.active ? 'disabled' : ''} data-click="assign" data-id="${x.id}">${t('Assign')}</button><button class="btn sm secondary" data-click="edit" data-id="${x.id}">${t('Edit')}</button>
            <button class="btn sm danger outline" data-click="del" data-id="${x.id}">${t('Delete')}</button></td></tr>`)}
      </tbody></table></div>`, { empty: (d) => d.drivers.length === 0 })}
      ${view.state.drivers.data?.drivers.length === 0 ? empty(t('No drivers yet')) : ''}`,
    actions: {
      add: () => edit({ active: true }),
      edit: (el) => edit(find(el)),
      assign: (el) => assign(find(el)),
      del: (el) => {
        const x = find(el);
        confirmDialog({ title: t('Delete {name}?', { name: x.name }), body: t('Drivers with trip history cannot be deleted. Deactivate them instead.'), confirmLabel: t('Delete'), danger: true,
          onConfirm: async () => { try { await api.del(`/api/admin/drivers/${x.id}`); toast(t('Driver deleted')); drivers.reload(); } catch (e) { toast(e.message, 'error'); } } });
      },
    },
  };
}

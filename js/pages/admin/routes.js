import { html, bool } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { asyncBlock, pageHead, empty, toast, confirmDialog, openModal } from '../../core/ui.js';
import { openForm } from '../../components/form-modal.js';
import { transitMap } from '../../components/transit-map.js';

export default function routesAdmin(view, ctx) {
  ctx.setTitle('Routes & stops');
  const data = view.load('data', () => api.get('/api/admin/routes'));
  view.state.tab = 'routes';
  const D = () => view.state.data.data;

  function editRoute(r) {
    openForm({
      title: r.id ? t('Edit route {code}', { code: r.code }) : t('Add route'), initial: r,
      fields: [
        { key: 'code', label: t('Code'), required: true, max: 12, hint: t('e.g. R5'), pattern: /^[A-Za-z0-9-]+$/, patternMsg: t('Code may contain letters, digits and dashes only'),
          validate: (val) => ((D()?.routes ?? []).some((x) => x.id !== r.id && x.code.toLowerCase() === String(val).trim().toLowerCase()) ? t('Route {code} already exists', { code: String(val).trim().toUpperCase() }) : '') },
        { key: 'name', label: t('Name'), required: true, max: 60 },
        { key: 'area', label: t('Area'), max: 60, hint: t('e.g. New Cairo, Heliopolis') },
        { key: 'avg_speed_kmh', label: t('Average speed (km/h)'), type: 'number', min: 5, max: 90, required: true, hint: t('5 to 90. Used for scheduled ETA estimates.') },
        { key: 'active', label: t('Route is running'), type: 'checkbox' },
      ],
      onSubmit: async (v) => {
        if (r.id) await api.put(`/api/admin/routes/${r.id}`, v); else await api.post('/api/admin/routes', v);
        toast(r.id ? t('Route updated') : t('Route created')); data.reload();
      },
    });
  }
  function editStop(s) {
    openForm({
      title: s.id ? t('Edit collection point') : t('Add collection point'), initial: s,
      fields: [
        { key: 'name', label: t('Name'), required: true, max: 80 }, { key: 'area', label: t('Area'), max: 60 },
        { key: 'lat', label: t('Latitude'), type: 'number', step: 'any', min: -90, max: 90, required: true, hint: t('Decimal degrees, e.g. 30.0444') },
        { key: 'lng', label: t('Longitude'), type: 'number', step: 'any', min: -180, max: 180, required: true, hint: t('e.g. 31.2357') },
        { key: 'active', label: t('Active'), type: 'checkbox' },
      ],
      validate: (v) => (v.lat !== '' && v.lng !== '' && Number(v.lat) === 0 && Number(v.lng) === 0 ? { lat: t('Latitude and longitude cannot both be 0') } : {}),
      onSubmit: async (v) => {
        if (s.id) await api.put(`/api/admin/stops/${s.id}`, v); else await api.post('/api/admin/stops', v);
        toast(s.id ? t('Collection point updated') : t('Collection point added')); data.reload();
      },
    });
  }
  function editOrder(route) {
    const m = openModal({
      title: t('Stops for {code} · {name}', { code: route.code, name: route.name }),
      setup: (v) => {
        v.state.ids = route.stops.map((s) => s.id);
        const stopById = (id) => D().stops.find((s) => s.id === id);
        return {
          render: () => html`<p class="small muted">${t('Order is the pickup order after leaving the campus. The bus returns to the campus after the last stop.')}</p>
            <ol class="stack-sm" style="padding-inline-start:20px">${v.state.ids.map((id, i) => html`<li data-key="o-${id}"><div class="row between"><b>${stopById(id)?.name}</b><span class="row" style="gap:4px">
              <button class="btn sm secondary" ${i === 0 ? 'disabled' : ''} data-click="up" data-i="${i}" aria-label="${t('Move {name} up', { name: stopById(id)?.name })}">↑</button>
              <button class="btn sm secondary" ${i === v.state.ids.length - 1 ? 'disabled' : ''} data-click="down" data-i="${i}" aria-label="${t('Move {name} down', { name: stopById(id)?.name })}">↓</button>
              <button class="btn sm danger outline" data-click="rm" data-i="${i}">${t('Remove')}</button></span></div></li>`)}</ol>
            <div class="field" style="margin-top:12px"><label for="addstop">${t('Add a collection point')}</label>
              <select id="addstop" class="input" data-change="add"><option value="">${t('Choose…')}</option>${D().stops.filter((s) => !s.is_campus && s.active && !v.state.ids.includes(s.id)).map((s) => html`<option value="${s.id}">${s.name}</option>`)}</select></div>`,
          footer: () => html`<button class="btn secondary" data-click="cancel">${t('Cancel')}</button><button class="btn" data-click="save">${t('Save order')}</button>`,
          actions: {
            up: (el) => swap(Number(el.dataset.i), -1), down: (el) => swap(Number(el.dataset.i), 1),
            rm: (el) => v.set({ ids: v.state.ids.filter((_, j) => j !== Number(el.dataset.i)) }),
            add: (el) => { if (el.value) v.set({ ids: [...v.state.ids, Number(el.value)] }); el.value = ''; },
            cancel: () => m.close(),
            save: async () => {
              try { await api.put(`/api/admin/routes/${route.id}/stops`, { stop_ids: v.state.ids }); toast(t('Stop order saved')); m.close(); data.reload(); } catch (e) { toast(e.message, 'error'); }
            },
          },
        };
        function swap(i, d) { const ids = [...v.state.ids]; const j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; v.set({ ids }); }
      },
    });
  }

  return {
    render: () => {
      const { tab } = view.state;
      return html`${pageHead(t('Routes & collection points'), t('Define each route and the order of its collection points. Every trip starts and ends at the campus automatically.'), html`<button class="btn secondary" data-click="add-stop">${t('Add collection point')}</button><button class="btn" data-click="add-route">${t('Add route')}</button>`)}
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected="${bool(tab === 'routes')}" data-click="tab" data-k="routes">${t('Routes')}</button>
        <button role="tab" aria-selected="${bool(tab === 'stops')}" data-click="tab" data-k="stops">${t('All collection points')}</button>
      </div>
      ${asyncBlock(view.state.data, 'data', (d) => {
        const campus = d.stops.find((s) => s.is_campus);
        return tab === 'routes' ? html`<div class="split">
          <div class="stack">${d.routes.map((r) => html`<section class="card" data-key="r-${r.id}">
            <div class="card-head"><div><h3>${r.code} · ${r.name}</h3><span class="small muted">${r.area ?? '—'} · ${t('{n} km/h avg', { n: r.avg_speed_kmh })}</span></div>
              <div class="row"><span class="badge ${r.active ? 'sky' : 'crit'}">${r.active ? t('Running') : t('Inactive')}</span>
                <button class="btn sm secondary" data-click="edit-route" data-id="${r.id}">${t('Edit')}</button>
                <button class="btn sm secondary" data-click="order" data-id="${r.id}">${t('Stops & order')}</button>
                <button class="btn sm danger outline" data-click="del-route" data-id="${r.id}">${t('Delete')}</button></div></div>
            ${r.stops.length ? html`<ol class="journey"><li><span class="pip" style="border-color:var(--ink)"></span><span class="muted">${t('{name} (start)', { name: campus?.name })}</span><span></span></li>${r.stops.map((s) => html`<li data-key="rs-${s.id}"><span class="pip"></span><b>${s.name}</b><span class="small mono muted" dir="ltr">${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}</span></li>`)}</ol>` : empty(t('No collection points yet'), html`<p>${t('Use “Stops & order” to add some.')}</p>`)}
          </section>`)}</div>
          ${transitMap({ campus, routes: d.routes, trips: [] })}
        </div>` : html`<div class="table-wrap"><table class="t"><thead><tr><th>${t('Name')}</th><th>${t('Area')}</th><th>${t('Coordinates')}</th><th>${t('Used by')}</th><th>${t('Status')}</th><th></th></tr></thead><tbody>
          ${d.stops.map((s) => html`<tr data-key="s-${s.id}"><td><b>${s.name}</b>${s.is_campus ? html`<span class="badge navy" style="margin-inline-start:8px">${t('Campus')}</span>` : ''}</td><td>${s.area ?? '—'}</td><td class="mono small" dir="ltr">${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}</td><td>${s.is_campus ? t('All routes') : t('{n} route(s)', { n: s.route_count })}</td><td>${s.active ? t('Active') : t('Inactive')}</td>
            <td class="actions"><button class="btn sm secondary" data-click="edit-stop" data-id="${s.id}">${t('Edit')}</button>${!s.is_campus ? html`<button class="btn sm danger outline" data-click="del-stop" data-id="${s.id}">${t('Delete')}</button>` : ''}</td></tr>`)}
        </tbody></table></div>`;
      })}`;
    },
    actions: {
      tab: (el) => view.set({ tab: el.dataset.k }),
      'add-stop': () => editStop({ active: true }),
      'add-route': () => editRoute({ active: true, avg_speed_kmh: 28 }),
      'edit-route': (el) => editRoute(D().routes.find((r) => r.id === Number(el.dataset.id))),
      'edit-stop': (el) => editStop(D().stops.find((s) => s.id === Number(el.dataset.id))),
      order: (el) => editOrder(D().routes.find((r) => r.id === Number(el.dataset.id))),
      'del-route': (el) => {
        const r = D().routes.find((x) => x.id === Number(el.dataset.id));
        confirmDialog({ title: t('Delete route {code}?', { code: r.code }), body: t('Routes used by buses, schedules or trips cannot be deleted. Deactivate them instead.'), confirmLabel: t('Delete'), danger: true,
          onConfirm: async () => { try { await api.del(`/api/admin/routes/${r.id}`); toast(t('Route deleted')); data.reload(); } catch (e) { toast(e.message, 'error'); } } });
      },
      'del-stop': (el) => {
        const s = D().stops.find((x) => x.id === Number(el.dataset.id));
        confirmDialog({ title: t('Delete {name}?', { name: s.name }), body: t('Collection points still on a route cannot be deleted.'), confirmLabel: t('Delete'), danger: true,
          onConfirm: async () => { try { await api.del(`/api/admin/stops/${s.id}`); toast(t('Collection point deleted')); data.reload(); } catch (e) { toast(e.message, 'error'); } } });
      },
    },
  };
}

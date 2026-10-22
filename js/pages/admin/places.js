import { html } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { asyncBlock, pageHead, empty, toast, confirmDialog } from '../../core/ui.js';
import { openForm } from '../../components/form-modal.js';

const CATS = ['bank', 'pharmacy', 'printing', 'food', 'registrar', 'library', 'clinic', 'worship', 'building', 'shop', 'other'];
const CAT_LABEL = { bank: 'Bank', pharmacy: 'Pharmacy', printing: 'Printing', food: 'Food', registrar: 'Registrar', library: 'Library', clinic: 'Clinic', worship: 'Place of worship', building: 'Building', shop: 'Shop', other: 'Other' };
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const num = (v) => (v === '' || v == null ? '' : Number(v));

export default function places(view, ctx) {
  ctx.setTitle('Places');
  const list = view.load('list', () => api.get('/api/admin/places'));

  function edit(p) {
    const isNew = !p;
    openForm({
      title: isNew ? t('Add place') : t('Edit place'), submitLabel: t('Save'),
      initial: isNew ? { area: 'off_campus', category: 'other', default_stay_min: 15, active: true } : { ...p, active: !!p.active, closed_days: p.closed_days ?? '', lat: p.lat ?? '', lng: p.lng ?? '', walk_min_from_campus_stop: p.walk_min_from_campus_stop ?? '', opens: p.opens ?? '', closes: p.closes ?? '' },
      fields: [
        { key: 'name_en', label: t('English name'), required: true, max: 80 },
        { key: 'name_ar', label: t('Arabic name'), max: 80 },
        { key: 'area', label: t('Area'), type: 'select', noBlank: true, options: [{ value: 'off_campus', label: t('Outside campus') }, { value: 'campus', label: t('On campus') }] },
        { key: 'category', label: t('Category'), type: 'select', noBlank: true, options: CATS.map((c) => ({ value: c, label: t(CAT_LABEL[c]) })) },
        { key: 'paste', label: t('Paste coordinates'), hint: t('From a map: "30.0444, 31.2357". Fills latitude and longitude.'), validate: (v) => (!v || /^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/.test(v) ? '' : t('Use the form "latitude, longitude"')) },
        { key: 'lat', label: t('Latitude'), type: 'number', min: -90, max: 90, step: 'any' },
        { key: 'lng', label: t('Longitude'), type: 'number', min: -180, max: 180, step: 'any' },
        { key: 'walk_min_from_campus_stop', label: t('Walk from the campus stop (min)'), type: 'number', int: true, min: 0, max: 60 },
        { key: 'default_stay_min', label: t('Usual time spent here (min)'), type: 'number', int: true, min: 1, max: 240, required: true },
        { key: 'opens', label: t('Opens (HH:MM)'), pattern: HHMM, placeholder: '09:00' },
        { key: 'closes', label: t('Closes (HH:MM)'), pattern: HHMM, placeholder: '17:00' },
        { key: 'closed_days', label: t('Closed days'), hint: t('Comma separated, for example fri,sat'), validate: (v) => (!v || String(v).split(',').map((x) => x.trim()).filter(Boolean).every((d) => DAYS.includes(d)) ? '' : t('Use sun, mon, tue, wed, thu, fri, sat')) },
        { key: 'active', label: t('Available to students'), type: 'checkbox' },
      ],
      onSubmit: async (v) => {
        let { lat, lng } = v;
        if (v.paste && (lat == null || lng == null || lat === '' || lng === '')) { const [a, b] = v.paste.split(',').map((x) => Number(x.trim())); lat = a; lng = b; }
        const body = {
          name_en: v.name_en, name_ar: v.name_ar, area: v.area, category: v.category, lat: num(lat), lng: num(lng),
          walk_min_from_campus_stop: num(v.walk_min_from_campus_stop), default_stay_min: Number(v.default_stay_min),
          opens: v.opens || '', closes: v.closes || '', closed_days: String(v.closed_days || '').split(',').map((x) => x.trim()).filter(Boolean), active: v.active,
        };
        if (isNew) await api.post('/api/admin/places', body); else await api.put(`/api/admin/places/${p.id}`, body);
        toast(t('Place saved')); list.reload();
      },
    });
  }

  return {
    render: () => html`${pageHead(t('Places'), t('Places the errand planner can use. Campus places come from the campus map. Add off-campus places yourself: nothing is invented, and a place without coordinates cannot get a travel-time estimate.'), html`<button class="btn" data-click="add">${t('Add place')}</button>`)}
      ${asyncBlock(view.state.list, 'list', (d) => html`<div class="table-wrap"><table class="t"><thead><tr><th>${t('Name')}</th><th>${t('Area')}</th><th>${t('Category')}</th><th>${t('Coordinates')}</th><th>${t('Hours')}</th><th></th></tr></thead><tbody>
        ${d.places.map((p) => html`<tr data-key="p-${p.id}" style="${!p.active ? 'opacity:.6' : ''}">
          <td><b>${p.name_en}</b>${p.name_ar ? html`<div class="small muted">${p.name_ar}</div>` : ''}</td>
          <td><span class="badge ${p.area === 'campus' ? 'sky' : 'navy'}">${p.area === 'campus' ? t('On campus') : t('Outside campus')}</span></td>
          <td>${t(CAT_LABEL[p.category] ?? 'Other')}</td>
          <td class="mono small" dir="ltr">${p.lat != null ? `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}` : html`<span class="muted" dir="auto">${t('Not set')}</span>`}</td>
          <td class="small">${p.opens && p.closes ? `${p.opens}–${p.closes}` : t('Not set')}${p.closed_days ? ` · ${t('closed')} ${p.closed_days}` : ''}</td>
          <td class="actions"><div class="row-actions">
            <button class="btn sm secondary" data-click="edit" data-id="${p.id}">${t('Edit')}</button>
            <button class="btn sm danger" data-click="del" data-id="${p.id}">${t('Delete')}</button>
          </div></td>
        </tr>`)}
      </tbody></table></div>`, { empty: (d) => d.places.length === 0 })}
      ${view.state.list.data?.places.length === 0 ? empty(t('No places yet')) : ''}`,
    actions: {
      add: () => edit(null),
      edit: (el) => edit(view.state.list.data.places.find((p) => p.id === Number(el.dataset.id))),
      del: (el) => {
        const p = view.state.list.data.places.find((x) => x.id === Number(el.dataset.id));
        confirmDialog({ title: 'Delete place', danger: true, confirmLabel: 'Delete', body: t('Delete {name}? Plans that use it will stop working.', { name: p.name_en }),
          onConfirm: async () => { await api.del(`/api/admin/places/${p.id}`); toast(t('Place deleted')); list.reload(); } });
      },
    },
  };
}

import { html } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { fmtDateTime } from '../../core/format.js';
import { asyncBlock, pageHead, field, empty, toast } from '../../core/ui.js';

const CATS = { bus: 'A bus', collection_point: 'A collection point', route: 'A route', service: 'The transport service', other: 'Something else' };
const ST = { open: 'Open', in_review: 'Being reviewed', resolved: 'Resolved', dismissed: 'Closed' };

export default function report(view, ctx) {
  ctx.setTitle('Report an issue');
  view.load('cat', () => api.get('/api/student/catalog'));
  view.load('live', () => api.get('/api/student/live'));
  const mine = view.load('mine', () => api.get('/api/student/issues'));
  Object.assign(view.state, { f: { category: 'bus', bus_id: '', stop_id: '', route_id: '', description: '' }, err: '', busy: false });

  return {
    render: () => {
      const { f, err, busy, cat, live } = view.state;
      const buses = [...new Map((live.data?.trips ?? []).map((x) => [x.bus.id, x.bus])).values()];
      const stops = (cat.data?.routes ?? []).flatMap((r) => r.stops.map((s) => ({ ...s, key: `${r.id}-${s.id}`, route: r.code })));
      const sel = (id, key, label, opts) => field({ label, id }, html`<select id="${id}" class="input" data-bind="f.${key}">${opts}</select>`);
      return html`${pageHead(t('Report an issue'), t('Tell the transport team about a problem with a bus, collection point, route or the service. Administrators review every report.'))}
        <div class="split">
          <form class="card stack" data-submit="submit" novalidate>
            ${sel('cat', 'category', t('What is it about?'), Object.entries(CATS).map(([k, v]) => html`<option value="${k}" ${f.category === k ? 'selected' : ''}>${t(v)}</option>`))}
            ${f.category === 'bus' ? sel('bus', 'bus_id', t('Which bus?'), html`<option value="">${t('Not sure / not listed')}</option>${buses.map((b) => html`<option value="${b.id}" ${String(f.bus_id) === String(b.id) ? 'selected' : ''}>${t('Bus {n}', { n: b.number })}</option>`)}`) : ''}
            ${f.category === 'collection_point' ? sel('stp', 'stop_id', t('Which collection point?'), html`<option value="">${t('Not sure')}</option>${stops.map((s) => html`<option value="${s.id}" ${String(f.stop_id) === String(s.id) ? 'selected' : ''}>${s.name} (${s.route})</option>`)}`) : ''}
            ${f.category === 'route' ? sel('rt', 'route_id', t('Which route?'), html`<option value="">${t('Not sure')}</option>${(cat.data?.routes ?? []).map((r) => html`<option value="${r.id}" ${String(f.route_id) === String(r.id) ? 'selected' : ''}>${r.code} · ${r.name}</option>`)}`) : ''}
            ${field({ label: t('What happened?'), id: 'desc', error: err, hint: t('Include what you saw, where and roughly when.') }, html`<textarea id="desc" class="input" data-bind="f.description" maxlength="1000">${f.description}</textarea>`)}
            <button class="btn" ${busy ? 'disabled' : ''}>${busy ? t('Sending…') : t('Send report')}</button>
          </form>
          <div class="stack"><h2>${t('My reports')}</h2>
            ${asyncBlock(view.state.mine, 'mine', (d) => d.issues.map((i) => html`<article class="card" data-key="is-${i.id}">
              <div class="row between"><b>${t(CATS[i.category])}</b><span class="badge ${i.status === 'resolved' ? 'sky' : i.status === 'open' ? 'warn' : ''}">${t(ST[i.status])}</span></div>
              <p style="margin:8px 0">${i.description}</p>
              ${i.admin_note ? html`<div class="alert info small"><div><b>${t('Reply from the transport team')}</b><br>${i.admin_note}</div></div>` : ''}
              <div class="small muted">${fmtDateTime(i.created_at)}</div>
            </article>`), { empty: (d) => d.issues.length === 0 })}
            ${view.state.mine.data?.issues.length === 0 ? empty(t('No reports yet')) : ''}
          </div>
        </div>`;
    },
    actions: {
      submit: async () => {
        const { f } = view.state;
        view.state.err = '';
        if (f.description.trim().length < 10) { view.set({ err: t('Please describe the problem in at least 10 characters.') }); return; }
        view.set({ busy: true });
        try {
          await api.post('/api/student/issues', { category: f.category, description: f.description, bus_id: f.bus_id ? Number(f.bus_id) : undefined, stop_id: f.stop_id ? Number(f.stop_id) : undefined, route_id: f.route_id ? Number(f.route_id) : undefined });
          toast(t('Report sent to the transport team')); view.set({ f: { ...f, description: '' } }); mine.reload();
        } catch (e) { view.state.err = e.message; } finally { view.set({ busy: false }); }
      },
    },
  };
}

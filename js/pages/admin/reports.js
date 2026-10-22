import { html, raw, bool } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { todayStr, toCsv, downloadCsv } from '../../core/format.js';
import { asyncBlock, pageHead, field, toast } from '../../core/ui.js';
import { syncWidgets, widgetHost } from '../../core/widgets.js';
import { WIDGETS } from '../../components/widgets.js';

const daysAgo = (n) => { const d = new Date(Date.now() - n * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const KIND = { delay: 'Delays', route_change: 'Route changes', cancellation: 'Cancellations', breakdown: 'Breakdowns', temporary: 'Temporary changes' };
const QUICK = [['Today', 0], ['7 days', 6], ['14 days', 13], ['30 days', 29]];

function bars(rows, label, value) {
  const m = Math.max(1, ...rows.map(value));
  return html`<div class="chart">${rows.map((r) => html`<div class="hbar" data-key="hb-${label(r)}"><span>${label(r)}</span><div class="bar" aria-hidden="true"><i style="width:${(value(r) / m) * 100}%"></i></div><b>${value(r)}</b></div>`)}</div>`;
}

function reportCsv(r, labels) {
  const s = r.summary;
  return toCsv([
    [t('Campus in Motion transportation report')],
    [t('From'), r.range.from], [t('To'), r.range.to], [t('Route'), labels.route], [t('Bus'), labels.bus], [],
    [t('Summary')], [t('Trips'), s.trips], [t('Completed'), s.completed], [t('Cancelled'), s.cancelled], [t('Delayed trips'), s.delayed_trips], [t('Average delay (min)'), s.avg_delay_min ?? ''],
    [t('Active reservations'), s.reservations_active], [t('Cancelled reservations'), s.reservations_cancelled], [t('Student reports'), s.issues], [],
    [t('Daily')], [t('Date'), t('Trips'), t('Cancelled'), t('Delayed'), t('Reservations')], ...r.daily.map((d) => [d.date, d.trips, d.cancelled ?? 0, d.delayed ?? 0, d.reservations]), [],
    [t('Routes')], [t('Code'), t('Name'), t('Trips'), t('Completed'), t('Cancelled'), t('Delayed trips'), t('Average delay (min)'), t('Reservations')],
    ...r.routes.map((x) => [x.code, x.name, x.trips, x.completed ?? 0, x.cancelled ?? 0, x.delayed_trips ?? 0, x.avg_delay_min ?? '', x.reservations]), [],
    [t('Buses')], [t('Bus'), t('Capacity'), t('Trips'), t('Completed'), t('Cancelled'), t('Delayed trips'), t('Seats reserved'), t('Utilisation %')],
    ...r.buses.map((b) => [b.number, b.capacity, b.trips, b.completed ?? 0, b.cancelled ?? 0, b.delayed_trips ?? 0, b.seats_reserved, b.utilisation_pct ?? '']),
  ]);
}

export default function reports(view, ctx) {
  ctx.setTitle('Reports');
  Object.assign(view.state, { range: { from: daysAgo(13), to: todayStr() }, routeId: '', busId: '' });
  view.load('routes', () => api.get('/api/admin/routes'));
  view.load('buses', () => api.get('/api/admin/buses'));
  const rangeBad = () => view.state.range.from > view.state.range.to;
  const rep = view.load('rep', () => {
    if (rangeBad()) return Promise.resolve(null);
    const { range, routeId, busId } = view.state;
    return api.get(`/api/admin/reports?from=${range.from}&to=${range.to}${routeId ? `&route_id=${routeId}` : ''}${busId ? `&bus_id=${busId}` : ''}`);
  });

  return {
    render: () => {
      const { range, routeId, busId } = view.state;
      const bad = rangeBad();
      const filtered = routeId || busId || range.from !== daysAgo(13) || range.to !== todayStr();
      const r0 = view.state.rep;
      return html`${pageHead(t('Transportation reports'), t('Usage, capacity, trips, delays and route performance for the chosen period. Figures come from recorded trips and reservations.'))}
      <div class="card stack" role="search" aria-label="${t('Report filters')}">
        <div class="form-grid">
          ${field({ label: t('From'), id: 'rf' }, html`<input id="rf" type="date" class="input" value="${range.from}" max="${todayStr()}" data-change="range" data-k="from">`)}
          ${field({ label: t('To'), id: 'rt', error: bad ? t('The start date must be on or before the end date') : '' }, html`<input id="rt" type="date" class="input" value="${range.to}" min="${range.from}" data-change="range" data-k="to" ${bad ? raw('aria-invalid="true" aria-describedby="rt-err"') : ''}>`)}
          ${field({ label: t('Route'), id: 'rr' }, html`<select id="rr" class="input" data-bind="routeId" data-change="refetch"><option value="">${t('All routes')}</option>${(view.state.routes.data?.routes ?? []).map((r) => html`<option value="${r.id}" ${String(routeId) === String(r.id) ? 'selected' : ''}>${r.code} · ${r.name}</option>`)}</select>`)}
          ${field({ label: t('Bus'), id: 'rb' }, html`<select id="rb" class="input" data-bind="busId" data-change="refetch"><option value="">${t('All buses')}</option>${(view.state.buses.data?.buses ?? []).map((b) => html`<option value="${b.id}" ${String(busId) === String(b.id) ? 'selected' : ''}>${t('Bus {n}', { n: b.number })}</option>`)}</select>`)}
        </div>
        <div class="row">
          <div class="seg" role="group" aria-label="${t('Quick ranges')}">${QUICK.map(([l, n]) => html`<button data-click="quick" data-n="${n}" aria-pressed="${bool(range.from === daysAgo(n) && range.to === todayStr())}">${t(l)}</button>`)}</div>
          ${filtered ? html`<button class="btn sm ghost" data-click="reset">${t('Reset filters')}</button>` : ''}
          <button class="btn secondary" style="margin-inline-start:auto" ${!r0.data || r0.loading || bad ? 'disabled' : ''} data-click="export">${t('Export CSV')}</button>
        </div>
        ${busId ? html`<p class="small muted">${t('Service updates and student reports are not tied to a single bus, so they are left out while a bus filter is on.')}</p>` : ''}
      </div>
      ${!bad ? asyncBlock(r0, 'rep', (r) => {
        if (!r) return '';
        const s = r.summary;
        const occupied = r.daily.length ? Math.max(1, ...r.daily.map((d) => d.trips)) : 1;
        return html`
          <div class="grid g4">
            ${[['Trips', s.trips], ['Completed', s.completed], ['Cancelled', s.cancelled], ['Delayed trips', s.delayed_trips], ['Avg delay', s.avg_delay_min != null ? t('{n} min', { n: s.avg_delay_min }) : '—'], ['Reservations', s.reservations_active], ['Cancelled reservations', s.reservations_cancelled], ['Student reports', s.issues]].map(([l, v]) => html`<div class="card stat" data-key="st-${l}"><b>${v}</b><span>${t(l)}</span></div>`)}
          </div>
          ${s.trips === 0 ? html`<div class="alert info" role="status">${t('No trips match these filters in this period.')}</div>` : ''}
          <div class="grid g2">
            <section class="card"><div class="card-head"><h2>${t('Trips per day')}</h2></div>
              ${r.daily.length ? html`<div class="cols" role="img" aria-label="${t('Trips and reservations per day')}">${r.daily.map((d) => html`<div data-key="dc-${d.date}" title="${t('{date}: {trips} trips, {res} reservations', { date: d.date, trips: d.trips, res: d.reservations })}"><i style="height:${(d.trips / occupied) * 100}%"></i><span>${d.date.slice(5)}</span></div>`)}</div>` : html`<p class="muted">${t('No trips in this period.')}</p>`}</section>
            <section class="card"><div class="card-head"><h2>${t('Reservations per route')}</h2></div>${bars(r.routes, (x) => `${x.code} ${x.name}`, (x) => x.reservations)}</section>
          </div>
          <section class="stack-sm"><h2>${t('Routes')}</h2><div class="table-wrap"><table class="t"><thead><tr><th>${t('Route')}</th><th>${t('Trips')}</th><th>${t('Completed')}</th><th>${t('Cancelled')}</th><th>${t('Delayed')}</th><th>${t('Avg delay')}</th><th>${t('Reservations')}</th></tr></thead><tbody>
            ${r.routes.map((x) => html`<tr data-key="rr-${x.id}"><td><b>${x.code}</b> ${x.name}</td><td>${x.trips}</td><td>${x.completed ?? 0}</td><td>${x.cancelled ?? 0}</td><td>${x.delayed_trips ?? 0}</td><td>${x.avg_delay_min != null ? t('{n} min', { n: x.avg_delay_min }) : '—'}</td><td>${x.reservations}</td></tr>`)}</tbody></table></div></section>
          <section class="stack-sm"><h2>${t('Buses & capacity')}</h2><div class="table-wrap"><table class="t"><thead><tr><th>${t('Bus')}</th><th>${t('Capacity')}</th><th>${t('Trips')}</th><th>${t('Completed')}</th><th>${t('Cancelled')}</th><th>${t('Delayed')}</th><th>${t('Seats reserved')}</th><th>${t('Utilisation')}</th></tr></thead><tbody>
            ${r.buses.map((b) => html`<tr data-key="bb-${b.id}"><td class="mono"><b>${b.number}</b></td><td>${b.capacity}</td><td>${b.trips}</td><td>${b.completed ?? 0}</td><td>${b.cancelled ?? 0}</td><td>${b.delayed_trips ?? 0}</td><td>${b.seats_reserved}</td>
              <td>${b.utilisation_pct == null ? '—' : html`<div class="row" style="gap:8px;flex-wrap:nowrap"><div class="bar" role="progressbar" aria-valuenow="${Math.min(100, b.utilisation_pct)}" aria-valuemin="0" aria-valuemax="100" aria-label="${t('Utilisation of bus {n}', { n: b.number ?? '' }).trim()}" style="width:90px"><i style="width:${Math.min(100, b.utilisation_pct)}%"></i></div>${b.utilisation_pct}%</div>`}</td></tr>`)}</tbody></table></div>
            <p class="small muted">${t('Utilisation = reserved seats ÷ seats offered on non-cancelled trips. It reflects reservations only; walk-on riders are not counted.')}</p></section>
          ${r.updates.length > 0 ? html`<section class="card"><h2 style="margin-bottom:10px">${t('Service updates posted')}</h2>${bars(r.updates, (x) => t(KIND[x.kind]), (x) => x.count)}</section>` : ''}`;
      }) : ''}
      ${widgetHost('etaAccuracy')}`;
    },
    after: () => syncWidgets(view, WIDGETS),
    actions: {
      range: (el) => { if (!el.value) return view.update(); view.state.range = { ...view.state.range, [el.dataset.k]: el.value }; view.update(); rep.reload(); },
      refetch: () => rep.reload(),
      quick: (el) => { view.state.range = { from: daysAgo(Number(el.dataset.n)), to: todayStr() }; view.update(); rep.reload(); },
      reset: () => { view.set({ range: { from: daysAgo(13), to: todayStr() }, routeId: '', busId: '' }); rep.reload(); },
      export: () => {
        const { routeId, busId } = view.state; const d = view.state.rep.data;
        const route = view.state.routes.data?.routes.find((y) => String(y.id) === String(routeId));
        const bus = view.state.buses.data?.buses.find((y) => String(y.id) === String(busId));
        const labels = { route: route ? `${route.code} ${route.name}` : t('All routes'), bus: bus ? t('Bus {n}', { n: bus.number }) : t('All buses') };
        downloadCsv(`transport-report-${d.range.from}_${d.range.to}.csv`, reportCsv(d, labels));
        toast(t('Report downloaded'));
      },
    },
  };
}

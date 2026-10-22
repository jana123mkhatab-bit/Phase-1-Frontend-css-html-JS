import { html, bool, attr } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { t, tn } from '../../core/i18n.js';
import { fmtTime, updateKindLabel, tripVerb } from '../../core/format.js';
import { asyncBlock, pageHead, busStatusBadge, tripStatusBadge, simBanner, gpsNote, toast, confirmDialog } from '../../core/ui.js';
import { syncWidgets, widgetHost } from '../../core/widgets.js';
import { WIDGETS } from '../../components/widgets.js';
import { transitMap } from '../../components/transit-map.js';

export default function monitor(view, ctx) {
  ctx.setTitle('Live monitor');
  const mon = view.load('mon', () => api.get('/api/admin/monitor'), { ms: 4000 });
  view.load('ov', () => api.get('/api/admin/overview'), { ms: 10000 });
  view.load('pub', () => api.get('/api/public/overview'), { ms: 60000 });
  view.load('cat', () => api.get('/api/public/catalog'));
  Object.assign(view.state, { sel: null, onlyProblems: false });

  const act = async (tripId, status) => {
    try { await api.patch(`/api/admin/trips/${tripId}/status`, { status }); toast(tripVerb(status)); mon.refresh(); } catch (e) { toast(e.message, 'error'); }
  };

  return {
    render: () => {
      const { sel, onlyProblems } = view.state;
      const ov = view.state.ov.data;
      const countOf = (s) => ov?.buses.find((b) => b.status === s)?.count ?? 0;
      const trips = (view.state.mon.data?.buses ?? []).map((b) => b.trip).filter(Boolean);
      const cat = view.state.cat.data;
      return html`${pageHead(t('Live monitor'), t('Where every bus is, what it is doing, and what needs attention. Refreshes every few seconds.'))}
      ${simBanner(view.state.pub.data?.data_mode)}
      <div class="grid g4">
        <div class="card stat"><b>${ov?.live ?? '–'}</b><span>${t('Buses on the road')}</span></div>
        <div class="card stat"><b>${countOf('waiting') + countOf('active')}</b><span>${t('Waiting / active')}</span></div>
        <div class="card stat"><b>${countOf('delayed')}</b><span>${t('Delayed')}</span></div>
        <div class="card stat"><b>${countOf('out_of_service')}</b><span>${t('Out of service')}</span></div>
        <div class="card stat"><b>${ov?.reservations_today ?? '–'}</b><span>${t('Seats reserved today')}</span></div>
        <div class="card stat"><b>${ov?.active_updates ?? '–'}</b><span>${t('Active service updates')}</span></div>
        <div class="card stat"><b>${ov?.open_issues ?? '–'}</b><span>${t('Open student reports')}</span></div>
        <div class="card stat"><b>${ov?.trips_today ?? '–'}</b><span>${t('Trips today')}</span></div>
      </div>
      ${widgetHost('anomalyPanel')}
      ${asyncBlock(view.state.mon, 'mon', (d) => {
        const flagged = d.buses.filter((b) => b.problems.length);
        const kinds = {};
        flagged.forEach((b) => b.problems.forEach((p) => { kinds[p] = (kinds[p] || 0) + 1; }));
        const rows = onlyProblems && flagged.length ? flagged : d.buses;
        const row = d.buses.find((b) => b.trip?.id === sel);
        return html`
          ${d.updates.length > 0 ? html`<div class="alert warn" role="status"><div><b>${tn(d.updates.length, '{n} active service update', '{n} active service updates')}:</b> ${d.updates.map((u) => `${updateKindLabel(u.kind)} – ${u.title}`).join(' · ')}</div></div>` : ''}
          ${flagged.length ? html`<section class="alert warn" role="status" aria-label="Problem flags">
              <div style="flex:1">
                <b>${flagged.length === 1 ? t('{a} of {c} buses needs attention', { a: flagged.length, c: d.buses.length }) : t('{a} of {c} buses need attention', { a: flagged.length, c: d.buses.length })}</b>
                <div class="row" style="gap:6px;margin-top:6px">${Object.entries(kinds).map(([p, n]) => html`<span class="badge">⚠ ${p} · ${n}</span>`)}</div>
              </div>
              <button class="btn sm secondary" aria-pressed="${bool(onlyProblems)}" data-click="toggle-problems">${onlyProblems ? t('Show all buses') : t('Show only these')}</button>
            </section>` : html`<div class="alert info small" role="status"><div>${t('No problems flagged. Every bus is reporting as expected.')}</div></div>`}
          <div class="split">
            ${cat ? transitMap({ campus: cat.campus, routes: cat.routes, trips, selectedTripId: sel }) : ''}
            <div class="card" style="padding:0">
              <div class="card-head" style="padding:14px 16px 0"><h2>${t('Fleet')}</h2>${onlyProblems && flagged.length ? html`<span class="badge warn">${t('Needs attention only')}</span>` : ''}</div>
              <div class="table-wrap" style="border:0"><table class="t"><thead><tr><th>${t('Bus')}</th><th>${t('Where')}</th><th>${t('Status')}</th><th>${t('Attention')}</th></tr></thead><tbody>
                ${rows.map(({ bus, trip, where, problems }) => html`<tr data-key="fb-${bus.id}" ${trip ? attr`data-click="sel-row" data-trip="${trip.id}"` : ''} style="cursor:${trip ? 'pointer' : 'default'};${trip && trip.id === sel ? 'background:var(--tint)' : ''}">
                  <td><span class="bus-chip">${bus.number}</span><div class="small muted">${bus.route_code ?? t('no route')} · ${bus.driver_name ?? t('no driver')}</div></td>
                  <td>${where}${trip ? html`<div class="small muted">${fmtTime(trip.expected_departure)} · ${trip.route.name}</div>` : ''}</td>
                  <td>${busStatusBadge(bus.status)}${trip ? html`<div style="margin-top:4px">${tripStatusBadge(trip)}</div>` : ''}</td>
                  <td>${problems.length ? problems.map((p) => html`<div class="small" style="color:var(--brand-ink);font-weight:700">⚠ ${p}</div>`) : html`<span class="small muted">${t('OK')}</span>`}${trip ? html`<div>${gpsNote(trip)}</div>` : ''}</td>
                </tr>`)}
              </tbody></table></div>
            </div>
          </div>
          <section class="card" aria-label="${t('Selected trip controls')}">
            ${!row ? html`<p class="muted">${t('Select a bus on the map or in the fleet table to see its trip and controls.')}</p>` : (() => {
              const tr = row.trip;
              return html`<div class="stack">
                <div class="row between"><h2>${t('Bus {n}', { n: row.bus.number })}: ${tr.route.name}</h2>${tripStatusBadge(tr)}</div>
                <dl class="meta">
                  <div><dt>${t('Driver')}</dt><dd>${tr.driver?.name ?? '—'}</dd></div>
                  <div><dt>${t('Scheduled')}</dt><dd>${fmtTime(tr.scheduled_departure)}</dd></div>
                  <div><dt>${t('Actual departure')}</dt><dd>${tr.actual_departure ? fmtTime(tr.actual_departure) : t('Not departed')}</dd></div>
                  <div><dt>${t('Seats')}</dt><dd>${t('{r}/{c} reserved', { r: tr.seats.reserved, c: tr.seats.capacity })}</dd></div>
                  <div><dt>${t('Progress')}</dt><dd>${Math.round(tr.progress * 100)}%</dd></div>
                </dl>
                <div class="row">
                  ${tr.status === 'scheduled' ? html`<button class="btn sm secondary" data-click="act" data-trip="${tr.id}" data-s="preparing">${t('Mark preparing to leave')}</button>` : ''}
                  ${['scheduled', 'preparing'].includes(tr.status) ? html`<button class="btn sm" data-click="act" data-trip="${tr.id}" data-s="departed">${t('Mark departed')}</button>` : ''}
                  ${tr.status === 'departed' ? html`<button class="btn sm" data-click="act" data-trip="${tr.id}" data-s="completed">${t('Mark completed')}</button>` : ''}
                  ${!['completed', 'cancelled'].includes(tr.status) ? html`<button class="btn sm danger outline" data-click="cancel-trip" data-trip="${tr.id}">${t('Cancel trip')}</button>` : ''}
                </div>
              </div>`;
            })()}
          </section>`;
      })}`;
    },
    after: () => syncWidgets(view, WIDGETS),
    actions: {
      'toggle-problems': () => view.set({ onlyProblems: !view.state.onlyProblems }),
      'sel-row': (el) => view.set({ sel: Number(el.dataset.trip) }),
      'map-bus': (el) => view.set({ sel: Number(el.dataset.trip) }),
      act: (el) => act(Number(el.dataset.trip), el.dataset.s),
      'cancel-trip': (el) => {
        const row = view.state.mon.data.buses.find((b) => b.trip?.id === Number(el.dataset.trip));
        const tr = row.trip;
        confirmDialog({ title: t('Cancel this trip?'), body: t('Bus {n} ({time}) will be cancelled, every reservation released and students on the route notified.', { n: row.bus.number, time: fmtTime(tr.scheduled_departure) }), confirmLabel: t('Cancel trip'), danger: true, onConfirm: () => act(tr.id, 'cancelled') });
      },
    },
  };
}

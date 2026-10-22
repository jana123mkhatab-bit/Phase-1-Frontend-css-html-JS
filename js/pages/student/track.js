import { html } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { getUser } from '../../core/auth.js';
import { t } from '../../core/i18n.js';
import { fmtTime } from '../../core/format.js';
import { asyncBlock, pageHead, tripStatusBadge, busStatusBadge, etaView, seatBar, gpsNote, empty, field } from '../../core/ui.js';
import { setQuery } from '../../core/router.js';
import { transitMap } from '../../components/transit-map.js';
import { journeyList } from '../../components/trip.js';
import { crowdBadge } from '../../components/widgets.js';

export default function track(view, ctx) {
  ctx.setTitle('Track my bus');
  const user0 = getUser('student');
  view.load('live', () => api.get('/api/student/live'), { ms: 4000 });
  view.load('cat', () => api.get('/api/student/catalog'));
  Object.assign(view.state, { q: '', stopId: user0.stop_id, wanted: Number(ctx.query.trip) || 0 });
  let lastTripId = null;

  const pick = () => {
    const user = getUser('student');
    const trips = view.state.live.data?.trips ?? [];
    const trip = trips.find((x) => x.id === view.state.wanted) || trips.find((x) => x.route.id === user.route_id) || trips[0];
    return { user, trips, trip };
  };

  return {
    render: () => {
      const { user, trips, trip } = pick();
      const { stopId, live: lv, cat } = view.state;
      const mine = trip?.stops.find((s) => s.id === stopId);
      return html`${pageHead(t('Track my bus'), t('Live position, arrival time at your collection point and progress along the route.'))}
        ${asyncBlock(lv, 'live', () => '')}
        ${lv.data && trips.length === 0 ? empty(t('No buses to track right now'), t('When a bus is scheduled soon, preparing or on the road it will appear here.')) : ''}
        ${trips.length > 0 && trip ? html`
          ${(() => {
            const needle = (view.state.q || '').trim().toLowerCase();
            const found = trips.filter((x) => !needle || [x.bus.number, x.route.code, x.route.name, fmtTime(x.expected_departure)].some((v) => String(v ?? '').toLowerCase().includes(needle)));
            return html`<div class="card stack-sm" role="search">
              <input class="input" type="search" autocomplete="off" placeholder="${t('Search by bus number or route…')}" aria-label="${t('Choose a bus')}" value="${view.state.q}" data-bind="q">
              ${needle ? '' : html`<p class="small muted" style="margin:0">${t('Showing')} <b class="mono">${t('Bus {n}', { n: trip.bus.number })}</b> · ${trip.route.code} ${trip.route.name}</p>`}
              <div class="bus-results" role="listbox" aria-label="${t('Choose a bus')}" ${needle ? '' : 'hidden'}>
                ${found.length === 0 ? html`<p class="small muted" style="padding:10px 12px;margin:0">${t('No buses match your search.')}</p>` : found.map((x) => html`<button type="button" role="option" class="bus-result" aria-selected="${String(x.id === trip.id)}" data-click="pick-trip" data-id="${x.id}">
                  <b class="mono">${t('Bus {n}', { n: x.bus.number })}</b><span class="muted small">· ${x.route.code} ${x.route.name}${x.route.id === user.route_id ? ' ★' : ''}</span><span class="small muted" style="margin-inline-start:auto">${fmtTime(x.expected_departure)}</span>
                </button>`)}
              </div>
            </div>`;
          })()}
          <div class="split">
            <div class="stack">
              ${cat.data ? transitMap({ campus: cat.data.campus, routes: cat.data.routes, trips: [trip], selectedTripId: trip.id, highlightStopId: stopId, routeFilter: trip.route.id, onSelectStop: true }) : ''}
              <div class="card">
                <div class="card-head"><h2>${t('Trip progress')}</h2>${gpsNote(trip)}</div>
                <div class="bar" role="progressbar" aria-valuenow="${Math.round(trip.progress * 100)}" aria-valuemin="0" aria-valuemax="100" aria-label="${t('Trip progress')}"><i style="width:${trip.progress * 100}%"></i></div>
                <p class="small muted" style="margin-top:6px">${trip.status === 'departed' ? t('{n}% of the round trip (university → collection points → university)', { n: Math.round(trip.progress * 100) }) : t('The trip has not started yet.')}</p>
                ${trip.off_route ? html`<div class="alert warn" style="margin-top:10px">${t('The bus appears to be away from its usual route line, so the ETA may be less accurate.')}</div>` : ''}
              </div>
            </div>
            <div class="stack">
              <div class="card tint">
                <div class="card-head"><h2>${t('Arrival at')}</h2></div>
                ${field({ label: t('Collection point'), id: 'stop' }, html`<select id="stop" class="input" data-change="stop">
                  <option value="" ${stopId == null ? 'selected' : ''}>${t('Select a collection point…')}</option>
                  ${trip.stops.map((s) => html`<option value="${s.id}" ${s.id === stopId ? 'selected' : ''}>${s.name}${s.id === user.stop_id ? ` ${t('(my stop)')}` : ''}</option>`)}
                </select>`)}
                <div style="margin-top:14px">${mine ? etaView(mine.eta, { tripId: trip.id, stopId }) : html`<p>${t('Choose a collection point to see when this bus arrives there.')}</p>`}</div>
              </div>
              <div class="card stack">
                <div class="card-head"><h2>${t('Bus & driver')}</h2>${tripStatusBadge(trip)}</div>
                ${crowdBadge(trip.crowd, trip.seats, { tripId: trip.id })}
                <dl class="meta">
                  <div><dt>${t('Bus number')}</dt><dd class="mono">${trip.bus.number}</dd></div>
                  <div><dt>${t('Plate')}</dt><dd class="mono">${trip.bus.plate ?? '—'}</dd></div>
                  <div><dt>${t('Route')}</dt><dd>${trip.route.code} · ${trip.route.name}</dd></div>
                  <div><dt>${t('Driver')}</dt><dd>${trip.driver?.name ?? t('Not assigned')}</dd></div>
                  <div><dt>${t('Driver phone')}</dt><dd>${trip.driver?.phone ?? '—'}</dd></div>
                  <div><dt>${t('Bus status')}</dt><dd>${busStatusBadge(trip.bus.status)}</dd></div>
                  <div><dt>${t('Scheduled')}</dt><dd>${fmtTime(trip.scheduled_departure)}</dd></div>
                  <div><dt>${trip.actual_departure ? t('Left at') : t('Expected')}</dt><dd>${fmtTime(trip.actual_departure || trip.expected_departure)}</dd></div>
                </dl>
                ${trip.bus.status_note ? html`<p class="small muted">${t('Note:')} ${trip.bus.status_note}</p>` : ''}
                ${trip.status !== 'departed' && trip.status !== 'completed' ? html`${seatBar(trip.seats)}<a class="btn sm secondary" href="#/student/reserve">${t('Reserve a seat')}</a>` : ''}
              </div>
              <div class="card"><div class="card-head"><h2>${t('Journey')}</h2></div>${journeyList(trip, stopId)}</div>
            </div>
          </div>` : ''}`;
    },
    after: () => {
      // when the selected bus changes, fall back to the user's own stop if the old stop is not on this trip
      const { user, trip } = pick();
      if (trip && trip.id !== lastTripId) {
        lastTripId = trip.id;
        const { stopId } = view.state;
        if (!trip.stops.some((s) => s.id === stopId)) view.set({ stopId: trip.route.id === user.route_id ? user.stop_id : null });
      }
    },
    actions: {
      'pick-trip': (el) => { view.set({ wanted: Number(el.dataset.id), q: '' }); setQuery({ trip: el.dataset.id }); },
      stop: (el) => view.set({ stopId: Number(el.value) || null }),
      'map-stop': (el) => {
        const { trip } = pick();
        const id = Number(el.dataset.stop);
        if (trip && trip.stops.some((x) => x.id === id)) view.set({ stopId: id });
      },
    },
  };
}

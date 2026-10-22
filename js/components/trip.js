import { html } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { fmtTime } from '../core/format.js';
import { tripStatusBadge, busStatusBadge, etaView, seatBar, gpsNote } from '../core/ui.js';
import { crowdBadge } from './widgets.js';

export function journeyList(trip, myStopId) {
  const passedAll = trip.status === 'completed';
  return html`<ol class="journey" aria-label="${t('Collection points in order')}">
    ${trip.stops.map((s) => {
      const passed = passedAll || s.eta.kind === 'passed';
      return html`<li class="${passed ? 'passed' : ''} ${s.id === myStopId ? 'mine' : ''}" data-key="j-${s.id}">
        <span class="pip"></span>
        <span><b>${s.name}</b>${s.id === myStopId ? html`<span class="badge sky" style="margin-left:8px">${t('Your stop')}</span>` : ''}</span>
        <span class="small mono">${passed ? t('passed') : s.eta.seconds != null ? t('{n} min', { n: Math.max(1, Math.round(s.eta.seconds / 60)) }) : '—'}</span>
      </li>`;
    })}
  </ol>`;
}

export function tripCard(trip, to, myStopId) {
  const mine = trip.stops.find((s) => s.id === myStopId);
  return html`<article class="card trip-card" data-key="trip-${trip.id}" aria-label="${t('Bus {n}', { n: trip.bus.number })} ${trip.route.name}">
    <div class="trip-top">
      <div class="row" style="gap:10px"><span class="bus-chip">${trip.bus.number}</span><div><h3>${trip.route.name}</h3><span class="small muted">${t('Route {code}', { code: trip.route.code })}</span></div></div>
      ${tripStatusBadge(trip)}
    </div>
    <dl class="meta">
      <div><dt>${t('Driver')}</dt><dd>${trip.driver?.name ?? t('Not assigned')}</dd></div>
      <div><dt>${t('Departure')}</dt><dd>${trip.actual_departure ? `${fmtTime(trip.actual_departure)} ${t('(left)')}` : `${fmtTime(trip.expected_departure)}${trip.delay_minutes ? ` ${t('(delayed)')}` : ''}`}</dd></div>
      <div><dt>${t('Bus')}</dt><dd>${busStatusBadge(trip.bus.status)}</dd></div>
    </dl>
    ${trip.status === 'departed' ? html`<div><div class="bar" role="progressbar" aria-valuenow="${Math.round(trip.progress * 100)}" aria-valuemin="0" aria-valuemax="100" aria-label="${t('Trip progress')}"><i style="width:${trip.progress * 100}%"></i></div><div class="row between small muted" style="margin-top:4px"><span>${t('Trip progress {n}%', { n: Math.round(trip.progress * 100) })}</span>${gpsNote(trip)}</div></div>` : ''}
    ${mine ? etaView(mine.eta, { big: false, tripId: trip.id, stopId: myStopId }) : ''}
    ${trip.status !== 'departed' ? seatBar(trip.seats) : ''}
    ${trip.status !== 'departed' ? crowdBadge(trip.crowd, null, { tripId: trip.id }) : ''}
    ${to ? html`<div class="row"><a class="btn sm" href="#${to}">${t('Track on map')}</a>${['scheduled', 'preparing'].includes(trip.status) ? html`<a class="btn sm secondary" href="#/student/reserve">${t('Reserve a seat')}</a>` : ''}</div>` : ''}
  </article>`;
}

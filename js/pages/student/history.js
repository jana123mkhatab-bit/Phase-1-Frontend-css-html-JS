import { html } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { fmtDateTime, fmtTime, tripStatusLabel } from '../../core/format.js';
import { asyncBlock, pageHead, empty } from '../../core/ui.js';

const RES = {
  confirmed: { label: 'Reserved', cls: 'sky' },
  cancelled: { label: 'Cancelled', cls: 'crit' },
  completed: { label: 'Completed', cls: 'live' },
  no_show: { label: 'No show', cls: 'warn' },
};

export default function history(view, ctx) {
  ctx.setTitle('Trip history');
  view.state.q = '';
  view.load('h', () => api.get('/api/student/history'));
  const matches = (needle, ...fields) => !needle || fields.some((f) => String(f ?? '').toLowerCase().includes(needle));
  return {
    render: () => html`${pageHead(t('Trip history'), t('Your reservations and recent service record on your university route.'))}
      ${asyncBlock(view.state.h, 'h', (d) => {
        const needle = view.state.q.trim().toLowerCase();
        const totalRes = d.reservations.length;
        const activeRes = d.reservations.filter((r) => r.status === 'confirmed').length;
        const totalService = d.route_service.length;
        const reservations = d.reservations.filter((r) => matches(needle, r.bus_number, r.route_code, r.route_name, r.stop_name, RES[r.status]?.label ?? r.status, r.trip_status, fmtDateTime(r.scheduled_departure)));
        const service = d.route_service.filter((x) => matches(needle, x.bus_number, x.route_name, x.status, fmtDateTime(x.scheduled_departure)));
        return html`<div class="stack" style="gap:24px">
          <div class="grid g3">
            <div class="card stat"><span>${t('Total bookings')}</span><b>${totalRes}</b></div>
            <div class="card stat"><span>${t('Active reservations')}</span><b>${activeRes}</b></div>
            <div class="card stat"><span>${t('Recent trips logged')}</span><b>${totalService}</b></div>
          </div>

          <input class="input" type="search" autocomplete="off" style="max-width:480px" placeholder="${t('Search by bus, route, stop, date or status…')}" aria-label="${t('Search trip history')}" value="${view.state.q}" data-bind="q">

          <section class="stack-sm">
            <div class="row between"><h2>${t('My reservations')}</h2>${totalRes > 0 ? html`<span class="small muted">${needle ? t('{n} of {m}', { n: reservations.length, m: totalRes }) : t('{n} total', { n: totalRes })}</span>` : ''}</div>
            ${reservations.length ? html`<div class="table-wrap"><table class="t">
              <thead><tr><th>${t('Date & departure')}</th><th>${t('Bus')}</th><th>${t('Route')}</th><th>${t('Boarding point')}</th><th>${t('Reservation status')}</th><th>${t('Trip progress')}</th></tr></thead>
              <tbody>${reservations.map((r) => {
                const badgeInfo = RES[r.status] || { label: r.status, cls: '' };
                return html`<tr>
                  <td><div style="font-weight:600">${fmtDateTime(r.scheduled_departure)}</div></td>
                  <td><span class="bus-chip" style="height:28px;font-size:.8rem">${r.bus_number}</span></td>
                  <td><div style="font-weight:700">${r.route_code} · ${r.route_name}</div>${r.outside_route ? html`<span class="small muted" style="display:block">${t('Outside my usual route')}</span>` : ''}</td>
                  <td>${r.stop_name ?? html`<span class="muted">—</span>`}</td>
                  <td><span class="badge ${badgeInfo.cls}">${t(badgeInfo.label)}</span></td>
                  <td><span class="badge ${r.trip_status === 'completed' ? 'live' : r.trip_status === 'cancelled' ? 'crit' : 'navy'}">${tripStatusLabel(r.trip_status)}</span></td>
                </tr>`;
              })}</tbody></table></div>` : needle ? empty(t('No matching reservations')) : empty(t('No reservations yet'), t('Seats you reserve will be listed here.'))}
          </section>

          <section class="stack-sm">
            <h2>${t('Recent service on my route')}</h2>
            <p class="small muted">${t('Authoritative record of university service performance on your assigned route.')}</p>
            ${service.length ? html`<div class="table-wrap"><table class="t">
              <thead><tr><th>${t('Scheduled')}</th><th>${t('Bus')}</th><th>${t('Route')}</th><th>${t('Actual departure')}</th><th>${t('Completed')}</th><th>${t('Performance outcome')}</th></tr></thead>
              <tbody>${service.map((x) => html`<tr>
                <td>${fmtDateTime(x.scheduled_departure)}</td>
                <td><span class="bus-chip" style="height:28px;font-size:.8rem">${x.bus_number}</span></td>
                <td>${x.route_name}</td>
                <td>${fmtTime(x.actual_departure)}</td>
                <td>${fmtTime(x.completed_at)}</td>
                <td><span class="badge ${x.status === 'cancelled' ? 'crit' : 'live'}">${tripStatusLabel(x.status)}</span>${x.delay_minutes > 0 ? html`<span class="badge warn" style="margin-left:6px">${t('+{n} min delay', { n: x.delay_minutes })}</span>` : ''}</td>
              </tr>`)}</tbody></table></div>` : needle ? empty(t('No matching trips')) : empty(t('No completed trips yet'))}
          </section>
        </div>`;
      })}`,
  };
}

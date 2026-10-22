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
  view.load('h', () => api.get('/api/student/history'));
  return {
    render: () => html`${pageHead(t('Trip history'), t('Your reservations and recent service record on your university route.'))}
      ${asyncBlock(view.state.h, 'h', (d) => {
        const totalRes = d.reservations.length;
        const activeRes = d.reservations.filter((r) => r.status === 'confirmed').length;
        const totalService = d.route_service.length;
        return html`<div class="stack" style="gap:24px">
          <div class="grid g3">
            <div class="card stat"><span>${t('Total bookings')}</span><b>${totalRes}</b></div>
            <div class="card stat"><span>${t('Active reservations')}</span><b>${activeRes}</b></div>
            <div class="card stat"><span>${t('Recent trips logged')}</span><b>${totalService}</b></div>
          </div>

          <section class="stack-sm">
            <div class="row between"><h2>${t('My reservations')}</h2>${totalRes > 0 ? html`<span class="small muted">${t('{n} total', { n: totalRes })}</span>` : ''}</div>
            ${d.reservations.length ? html`<div class="table-wrap"><table class="t">
              <thead><tr><th>${t('Date & departure')}</th><th>${t('Bus')}</th><th>${t('Route')}</th><th>${t('Boarding point')}</th><th>${t('Reservation status')}</th><th>${t('Trip progress')}</th></tr></thead>
              <tbody>${d.reservations.map((r) => {
                const badgeInfo = RES[r.status] || { label: r.status, cls: '' };
                return html`<tr>
                  <td><div style="font-weight:600">${fmtDateTime(r.scheduled_departure)}</div></td>
                  <td><span class="bus-chip" style="height:28px;font-size:.8rem">${r.bus_number}</span></td>
                  <td><div style="font-weight:700">${r.route_code} · ${r.route_name}</div>${r.outside_route ? html`<span class="small muted" style="display:block">${t('Outside my usual route')}</span>` : ''}</td>
                  <td>${r.stop_name ?? html`<span class="muted">—</span>`}</td>
                  <td><span class="badge ${badgeInfo.cls}">${t(badgeInfo.label)}</span></td>
                  <td><span class="badge ${r.trip_status === 'completed' ? 'live' : r.trip_status === 'cancelled' ? 'crit' : 'navy'}">${tripStatusLabel(r.trip_status)}</span></td>
                </tr>`;
              })}</tbody></table></div>` : empty(t('No reservations yet'), t('Seats you reserve will be listed here.'))}
          </section>

          <section class="stack-sm">
            <h2>${t('Recent service on my route')}</h2>
            <p class="small muted">${t('Authoritative record of university service performance on your assigned route.')}</p>
            ${d.route_service.length ? html`<div class="table-wrap"><table class="t">
              <thead><tr><th>${t('Scheduled')}</th><th>${t('Bus')}</th><th>${t('Route')}</th><th>${t('Actual departure')}</th><th>${t('Completed')}</th><th>${t('Performance outcome')}</th></tr></thead>
              <tbody>${d.route_service.map((x) => html`<tr>
                <td>${fmtDateTime(x.scheduled_departure)}</td>
                <td><span class="bus-chip" style="height:28px;font-size:.8rem">${x.bus_number}</span></td>
                <td>${x.route_name}</td>
                <td>${fmtTime(x.actual_departure)}</td>
                <td>${fmtTime(x.completed_at)}</td>
                <td><span class="badge ${x.status === 'cancelled' ? 'crit' : 'live'}">${tripStatusLabel(x.status)}</span>${x.delay_minutes > 0 ? html`<span class="badge warn" style="margin-left:6px">${t('+{n} min delay', { n: x.delay_minutes })}</span>` : ''}</td>
              </tr>`)}</tbody></table></div>` : empty(t('No completed trips yet'))}
          </section>
        </div>`;
      })}`,
  };
}

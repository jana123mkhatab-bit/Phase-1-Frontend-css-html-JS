import { html } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { getUser } from '../../core/auth.js';
import { t } from '../../core/i18n.js';
import { updateKindLabel } from '../../core/format.js';
import { asyncBlock, pageHead, simBanner, etaView, tripStatusBadge, empty } from '../../core/ui.js';
import { syncWidgets, widgetHost } from '../../core/widgets.js';
import { transitMap } from '../../components/transit-map.js';
import { tripCard } from '../../components/trip.js';
import { WIDGETS } from '../../components/widgets.js';

export default function dashboard(view, ctx) {
  ctx.setTitle('Live dashboard');
  view.load('live', () => api.get('/api/student/live'), { ms: 5000 });
  view.load('mode', () => api.get('/api/public/overview'), { ms: 60000 });
  view.load('cat', () => api.get('/api/student/catalog'));
  let trips = [];

  return {
    render: () => {
      const user = getUser('student');
      return html`${pageHead(t('Hello, {name}', { name: user.name.split(' ')[0] }), t('Buses operating or waiting at the university right now. Updates every few seconds.'))}
      ${simBanner(view.state.mode.data?.data_mode)}
      ${asyncBlock(view.state.live, 'live', (d) => {
        trips = d.trips;
        const moving = d.trips.filter((x) => x.status === 'departed');
        const waiting = d.trips.filter((x) => x.status === 'preparing');
        const soon = d.trips.filter((x) => x.status === 'scheduled');
        const mine = d.trips.find((x) => x.route.id === user.route_id);
        const cat = view.state.cat.data;
        const idle = [...waiting, ...soon];
        return html`
          ${d.updates.length > 0 ? html`<section class="stack-sm" aria-label="${t('Service updates')}">
            ${d.updates.map((u) => html`<div class="alert warn" role="status"><div><b>${updateKindLabel(u.kind)}${u.route_code ? ` · ${u.route_code}` : ''}: ${u.title}</b><div>${u.message}</div></div></div>`)}
          </section>` : ''}
          ${widgetHost('suggestionCard')}
          ${widgetHost('favoritesStrip')}
          <div class="split">
            <div class="stack">
              <div class="card tint">
                <div class="card-head"><h2>${t('My bus')}</h2>${user.route_id ? html`<a class="btn sm" href="#/student/track">${t('Open tracker')}</a>` : html`<a class="btn sm" href="#/student/settings">${t('Choose route')}</a>`}</div>
                ${!user.route_id ? html`<p>${t('Pick your route and collection point in settings to see your own arrival time and get smart alerts.')}</p>`
                  : !mine ? html`<p>${t('No bus on your route is operating or due soon.')}</p>`
                    : html`<div class="row between"><div><b class="mono">${t('Bus {n}', { n: mine.bus.number })}</b> · ${mine.route.name}<div class="small">${tripStatusBadge(mine)}</div></div>${user.stop_id ? etaView(mine.stops.find((s) => s.id === user.stop_id)?.eta) : html`<span class="small">${t('Choose your collection point in settings for an arrival time.')}</span>`}</div>`}
              </div>
              ${cat ? transitMap({ campus: cat.campus, routes: cat.routes, trips: d.trips, highlightStopId: user.stop_id }) : ''}
            </div>
            <div class="stack">
              <h2>${t('On the road ({n})', { n: moving.length })}</h2>
              ${moving.length ? moving.map((x) => tripCard(x, `/student/track?trip=${x.id}`, x.route.id === user.route_id ? user.stop_id : null)) : empty(t('No bus is on the road'), t('Buses appear here once they depart.'))}
              <h2>${t('At the university ({n})', { n: idle.length })}</h2>
              ${idle.length ? idle.map((x) => tripCard(x, `/student/track?trip=${x.id}`, x.route.id === user.route_id ? user.stop_id : null)) : empty(t('Nothing waiting'), t('No buses are waiting or due in the next hours.'))}
            </div>
          </div>`;
      })}`;
    },
    after: () => syncWidgets(view, WIDGETS, { favoritesStrip: { trips } }),
  };
}

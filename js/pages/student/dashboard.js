import { html } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { getUser } from '../../core/auth.js';
import { t } from '../../core/i18n.js';
import { updateKindLabel } from '../../core/format.js';
import { asyncBlock, pageHead, simBanner, serviceAlert, etaView, tripStatusBadge, empty, icon } from '../../core/ui.js';
import { fmtTime } from '../../core/format.js';
import { syncWidgets, widgetHost } from '../../core/widgets.js';
import { transitMap } from '../../components/transit-map.js';
import { WIDGETS } from '../../components/widgets.js';

const mins = (sec) => Math.max(1, Math.round(sec / 60));

// Stop-by-stop progress line: filled up to the last stop the bus has passed, your stop ringed.
function stopLine(mine, myStopId) {
  const done = (s) => mine.status === 'completed' || s.eta?.kind === 'passed';
  return html`<ol class="mb-line" aria-label="${t('Stops on your route')}">
    ${mine.stops.map((s) => html`<li class="${done(s) ? 'done' : ''} ${s.id === myStopId ? 'you' : ''}" data-key="ml-${s.id}"><span>${s.name}</span></li>`)}
  </ol>`;
}

function myBusCard(user, mine) {
  const stop = mine && user.stop_id ? mine.stops.find((s) => s.id === user.stop_id) : null;
  const sec = stop?.eta?.seconds;
  const passed = stop?.eta?.kind === 'passed';
  return html`<article class="card navy my-bus" aria-label="${t('My bus')}">
    <div class="my-bus-top"><span class="my-bus-label">${t('My bus')}</span>${mine ? html`<span class="my-bus-route">${t('Route {code}', { code: mine.route.code })} · ${mine.route.name}</span>` : ''}</div>
    ${!user.route_id ? html`<p>${t('Pick your route and collection point in settings to see your own arrival time and get smart alerts.')}</p><a class="btn sm" href="#/student/settings">${t('Choose route')}</a>`
      : !mine ? html`<p>${t('No bus on your route is operating or due soon.')}</p><a class="btn sm" href="#/student/track">${t('Open tracker')}</a>`
        : html`<div class="my-bus-main">
          <div class="my-bus-eta">${sec != null ? html`<b>${mins(sec)}</b><span>${t('min')}</span>` : html`<b class="txt">${passed ? t('Passed') : '—'}</b>`}</div>
          <div class="my-bus-info">
            ${stop ? html`<b class="my-bus-where">${stop.name}</b><span class="my-bus-sub">${t('Collection point')} · ${t('Bus {n}', { n: mine.bus.number })}</span>`
              : html`<b class="my-bus-where">${t('Bus {n}', { n: mine.bus.number })}</b><span class="my-bus-sub">${t('Choose your collection point in settings for an arrival time.')}</span>`}
            <div class="my-bus-badge">${tripStatusBadge(mine)}</div>
          </div>
        </div>
        ${stopLine(mine, user.stop_id)}
        <div class="my-bus-foot">
          ${stop ? html`<div class="my-bus-eta-note">${etaView(stop.eta, { big: false })}</div>` : ''}
          <a class="btn" href="#/student/track?trip=${mine.id}">${t('Track on map')}</a>
        </div>`}
  </article>`;
}

function busCard(x, user) {
  const mine = x.route.id === user.route_id && user.stop_id ? x.stops.find((s) => s.id === user.stop_id) : null;
  const sec = mine?.eta?.seconds;
  const big = sec != null ? { v: `${mins(sec)} ${t('min')}`, l: t('to your stop') }
    : x.status === 'departed' ? { v: `${Math.round(x.progress * 100)}%`, l: t('Trip progress') }
      : { v: fmtTime(x.expected_departure), l: t('Departs') };
  return html`<a class="bus-card" href="#/student/track?trip=${x.id}" data-key="bc-${x.id}" aria-label="${t('Bus {n}', { n: x.bus.number })} ${x.route.name}">
    <div class="bc-top"><span class="bus-chip">${x.route.code}</span><b>${x.route.name}</b></div>
    <div class="bc-status">${tripStatusBadge(x)}</div>
    <div class="bc-big"><b>${big.v}</b><span>${big.l}</span></div>
    ${x.status === 'departed' ? html`<div class="bar" role="progressbar" aria-valuenow="${Math.round(x.progress * 100)}" aria-valuemin="0" aria-valuemax="100" aria-label="${t('Trip progress')}"><i style="width:${x.progress * 100}%"></i></div>` : html`<div class="bar"><i style="width:0"></i></div>`}
    <div class="bc-foot small muted"><span>${t('Bus {n}', { n: x.bus.number })}</span><span>${x.driver?.name ?? ''}</span></div>
  </a>`;
}

export default function dashboard(view, ctx) {
  ctx.setTitle('Live dashboard');
  view.load('live', () => api.get('/api/student/live'), { ms: 5000 });
  view.load('mode', () => api.get('/api/public/overview'), { ms: 60000 });
  view.load('cat', () => api.get('/api/student/catalog'));
  let trips = [];
  view.state.tab = 'road';
  const railEdges = () => {
    const tr = view.$('.bus-track'); if (!tr) return;
    const [l, r] = view.$$('.rail-btn');
    if (l) l.disabled = tr.scrollLeft <= 2;
    if (r) r.disabled = tr.scrollLeft + tr.clientWidth >= tr.scrollWidth - 2;
  };
  view.listen(view.root, 'scroll', railEdges, true);
  view.listen(document, 'keydown', (e) => { if (e.key === 'Escape' && view.state.mapFull) { view.state.mapFull = false; view.update(); } });
  view.onCleanup(() => document.body.classList.remove('map-full-open'));

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
        const list = view.state.tab === 'road' ? moving : idle;
        return html`
          <div class="dash-main">
          ${cat ? html`<section class="card dash-map ${view.state.mapFull ? 'full' : ''}" aria-label="${t('Live map')}">
            <div class="card-head"><h2>${t('Live map')}</h2><div class="row" style="gap:12px"><span class="small muted">${t('On the road ({n})', { n: moving.length })}</span><button type="button" class="btn sm secondary" data-click="mapFull" aria-pressed="${!!view.state.mapFull}">${view.state.mapFull ? t('Exit full screen') : t('Full screen')}</button></div></div>
            ${d.updates.length > 0 ? html`<div class="map-alerts" aria-label="${t('Service updates')}">${d.updates.map(serviceAlert)}</div>` : ''}
            ${transitMap({ campus: cat.campus, routes: cat.routes, trips: d.trips, highlightStopId: user.stop_id, size: view.state.mapFull ? [Math.max(900, Math.min(window.innerWidth, 1600)), Math.max(500, window.innerHeight - 150)] : [760, 640] })}
          </section>` : ''}
          <div class="dash-top dash-side">
            ${myBusCard(user, mine)}
            ${widgetHost('suggestionCard')}
          </div>
          </div>
          ${widgetHost('favoritesStrip')}
          <section class="bus-rail" aria-label="${t('Buses right now')}">
            <div class="rail-bar">
              <div class="seg" role="tablist">
                <button type="button" role="tab" class="${view.state.tab === 'road' ? 'on' : ''}" aria-selected="${view.state.tab === 'road'}" data-click="tab" data-tab="road">${t('On the road ({n})', { n: moving.length })}</button>
                <button type="button" role="tab" class="${view.state.tab === 'idle' ? 'on' : ''}" aria-selected="${view.state.tab === 'idle'}" data-click="tab" data-tab="idle">${t('At the university ({n})', { n: idle.length })}</button>
              </div>
              <div class="rail-arrows">
                <button type="button" class="rail-btn" data-click="scroll" data-dir="-1" aria-label="${t('Scroll left')}">${icon('chevleft')}</button>
                <button type="button" class="rail-btn" data-click="scroll" data-dir="1" aria-label="${t('Scroll right')}">${icon('chevright')}</button>
              </div>
            </div>
            ${list.length
              ? html`<div class="bus-track" tabindex="0">${list.map((x) => busCard(x, user))}</div>`
              : view.state.tab === 'road' ? empty(t('No bus is on the road'), t('Buses appear here once they depart.')) : empty(t('Nothing waiting'), t('No buses are waiting or due in the next hours.'))}
          </section>`;
      })}`;
    },
    actions: {
      mapFull: () => { view.state.mapFull = !view.state.mapFull; view.update(); },
      tab: (el) => { view.state.tab = el.dataset.tab; view.update(); view.timeout(() => { const tr = view.$('.bus-track'); if (tr) tr.scrollLeft = 0; railEdges(); }, 0); },
      scroll: (el) => {
        const tr = view.$('.bus-track'); if (!tr) return;
        const rtl = getComputedStyle(tr).direction === 'rtl';
        tr.scrollBy({ left: Number(el.dataset.dir) * (rtl ? -1 : 1) * Math.max(300, tr.clientWidth * 0.8), behavior: 'smooth' });
      },
    },
    after: () => { document.body.classList.toggle('map-full-open', !!view.state.mapFull); syncWidgets(view, WIDGETS, { favoritesStrip: { trips } }); railEdges(); },
  };
}

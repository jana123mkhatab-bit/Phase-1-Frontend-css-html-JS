import { html, raw, bool, attr } from '../core/dom.js';
import { api } from '../core/api.js';
import { t } from '../core/i18n.js';
import { ago, colorMap } from '../core/format.js';
import { icon } from '../core/icons.js';
import { loading, errorBox, empty, tripStatusBadge } from '../core/ui.js';
import { syncWidgets, widgetHost } from '../core/widgets.js';
import { langSwitch, themeSwitch } from '../components/switches.js';
import { transitMap } from '../components/transit-map.js';
import { createCity, finalScene } from '../components/landing-scenes.js';
import { overviewBoard, stepsGuide, routesPicker, areasCards } from '../components/landing-sections.js';

const STUDENT = [
  ['pin', 'Track your bus live', 'See the bus on the map with an arrival time for your collection point.'],
  ['route', 'Find routes & stops', 'Browse routes or find the nearest collection point from where you are.'],
  ['bell', 'Smart notifications', '“5 minutes away”, “time to leave”, departure, delay and cancellation alerts.'],
  ['seat', 'Reserve a seat', 'Check capacity and reserve a seat on a bus outside your usual route.'],
  ['bus', 'Live bus dashboard', 'Every bus operating or waiting at the university, with driver and status.'],
  ['history', 'History & reports', 'Your previous trips, plus a way to report problems to the admins.'],
];
const ADMIN = [
  ['bus', 'Buses & drivers', 'Capacity, assignments and operating status.'],
  ['map', 'Routes & collection points', 'Ordered stops for New Cairo, Heliopolis and more.'],
  ['cal', 'Schedules & trips', 'Planned departures compared against what actually happens.'],
  ['pin', 'Live monitoring', 'Travelling, waiting, delayed or in trouble, at a glance.'],
  ['seat', 'Reservations & capacity', 'Seat counts and control over outside-route bookings.'],
  ['alert', 'Delays & service updates', 'Push delays, route changes, cancellations and breakdowns.'],
  ['chart', 'Reports', 'Usage, capacity, delays and route performance.'],
];
const STEPS = [
  ['route', 'Step 1', 'Find your route.', 'Explore university routes and identify the correct collection point.'],
  ['pin', 'Step 2', 'Follow your bus.', 'View its location, trip status, and estimated arrival time.'],
  ['bell', 'Step 3', 'Arrive with confidence.', 'Receive relevant alerts, check available seats, and stay informed about departures.'],
];
const kindLabel = (k) => t({ live: 'Live', scheduled: 'Scheduled estimate', estimate: 'Estimate', stale: 'Paused', overdue: 'No ETA', passed: 'Passed', unavailable: 'No ETA' }[k]);
const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const WIDGETS = { overviewBoard, stepsGuide };

export default function landing(view, ctx) {
  ctx.setTitle('University bus tracking');
  const ov = view.load('ov', () => api.get('/api/public/overview'), { ms: 20000 });
  view.load('cat', () => api.get('/api/public/catalog'));
  const live = view.load('live', () => api.get('/api/public/live'), { ms: 5000 });
  void ov;
  const mq = window.matchMedia('(min-width: 1200px)');
  Object.assign(view.state, { paused: false, nav: false, routeId: null, tripId: null, stopId: null, userLoc: null, locMsg: '', rpSel: null, wide: mq.matches, journeyKey: '' });
  view.listen(mq, 'change', () => view.set({ wide: mq.matches }));
  view.listen(document, 'keydown', (e) => { if (e.key === 'Escape' && view.state.nav) view.set({ nav: false }); });

  // ---- derived selection (mirrors the original component, line for line)
  function derive() {
    const s = view.state;
    const routes = s.cat.data?.routes || [];
    const trips = s.live.data?.trips || [];
    const activeRoutes = routes.filter((r) => r.active !== 0);
    const primary = (rid) => trips.find((x) => x.route?.id === rid && x.status === 'departed') || trips.find((x) => x.route?.id === rid);
    const selTrip = trips.find((x) => x.id === s.tripId) || (s.routeId ? primary(s.routeId) : null) || trips.find((x) => x.status === 'departed') || trips[0] || null;
    const selRouteId = s.routeId ?? selTrip?.route?.id ?? activeRoutes[0]?.id ?? null;
    const selRoute = routes.find((r) => r.id === selRouteId) || null;
    const stopList = selTrip?.stops || selRoute?.stops || [];
    const defaultStop = (selTrip?.stops || []).find((x) => x.eta?.kind !== 'passed') || stopList[stopList.length - 1];
    const selStop = stopList.find((x) => x.id === s.stopId) || defaultStop || null;
    const eta = selTrip?.stops?.find((x) => x.id === selStop?.id)?.eta || null;
    return { routes, trips, activeRoutes, primary, selTrip, selRouteId, selRoute, selStop, eta, colorOf: colorMap(routes) };
  }
  const pickRoute = (rid) => { const d = derive(); view.set({ routeId: rid, tripId: d.primary(rid)?.id ?? null, stopId: null }); };
  const pickStop = (stopId, routeId) => { const d = derive(); if (d.selRouteId !== routeId) pickRoute(routeId); view.set({ stopId }); };

  function findNearest() {
    if (!navigator.geolocation) { view.set({ locMsg: t('Location is not available in this browser.') }); return; }
    view.set({ locMsg: t('Finding your nearest stop…') });
    navigator.geolocation.getCurrentPosition((p) => {
      const me = { lat: p.coords.latitude, lng: p.coords.longitude };
      let best = null;
      derive().activeRoutes.forEach((r) => r.stops.forEach((s) => {
        const d = Math.hypot((s.lat - me.lat) * 111000, (s.lng - me.lng) * 96000);
        if (!best || d < best.d) best = { d, s, r };
      }));
      view.set({ userLoc: me });
      if (!best) { view.set({ locMsg: '' }); return; }
      pickStop(best.s.id, best.r.id);
      view.set({ locMsg: t('Nearest: {name} · {dist} away', { name: best.s.name, dist: best.d < 1000 ? `${Math.round(best.d)} m` : `${(best.d / 1000).toFixed(1)} km` }) });
    }, () => view.set({ locMsg: t('Could not get your location. Check the browser permission.') }), { timeout: 8000 });
  }

  // ---- dotted line from the headline underline to the first collection point on the map
  function journey() {
    const hero = view.$('.hero'); const svg = hero?.querySelector('svg.journey');
    if (!hero || !svg) return;
    const rid = derive().selRouteId;
    const a = hero.querySelector('.jn');
    const b = hero.querySelector(`.map-stop[data-first][data-route="${rid}"] .ring`) || hero.querySelector('.map-stop[data-first] .ring');
    let key = ''; let inner = ''; let vb = '0 0 1 1';
    if (a && b && getComputedStyle(svg).display !== 'none') {
      const h = hero.getBoundingClientRect(), ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const x1 = ra.left + ra.width / 2 - h.left, y1 = ra.top + ra.height / 2 - h.top;
      const x2 = rb.left + rb.width / 2 - h.left, y2 = rb.top + rb.height / 2 - h.top;
      const sgn = x2 >= x1 ? 1 : -1;
      const d = `M${x1} ${y1}C${x1 + 80 * sgn} ${y1 + 6} ${x2 - 90 * sgn} ${y2 - 8} ${x2} ${y2}`;
      key = `${rid}|${Math.round(h.width)}|${d}`;
      vb = `0 0 ${h.width} ${h.height}`;
      inner = `<g><path class="draw" pathLength="1" d="${d}" fill="none" stroke="#8DB4F8" stroke-width="6" stroke-linecap="round"/><path class="fade" d="${d}" fill="none" stroke="#0F1B2D" stroke-width="1.5" stroke-dasharray="2 7" stroke-linecap="round"/>`
        + (REDUCE ? '' : `<circle r="6" fill="#0F1B2D" stroke="#fff" stroke-width="2.5" class="fade late"><animateMotion dur="3s" begin="1s" repeatCount="indefinite" path="${d}"/></circle>`) + '</g>';
    }
    if (key === view.state.journeyKey) return;
    view.state.journeyKey = key;
    svg.setAttribute('viewBox', vb);
    svg.innerHTML = inner;
  }
  view.listen(window, 'resize', journey);
  document.fonts?.ready.then(() => !view.destroyed && journey());

  let city = null;
  view.onCleanup(() => city?.destroy());

  return {
    render: () => {
      const s = view.state;
      const o = s.ov.data;
      const D = derive();
      const { routes, trips, selTrip, selRouteId, selRoute, selStop, eta, colorOf } = D;
      const hour = new Date().getHours();
      const service = hour < 12 ? 'Morning service' : hour < 18 ? 'Afternoon service' : 'Evening service';
      const mins = eta?.seconds != null ? Math.max(1, Math.round(eta.seconds / 60)) : null;
      const sc = selTrip?.seats;
      const cat = s.cat.data;
      const noBus = o && o.trips_live === 0;
      const link = (to, label, attrs = '') => html`<a href="#/${to}" ${raw(attrs)}>${label}</a>`;
      void link;

      return html`<div class="land">
      <a class="skip" href="#/" data-scroll="main">${t('Skip to content')}</a>
      <header class="land-head">
        <div class="land-wrap land-nav">
          <a href="#/" class="brand" aria-label="${t('Campus in Motion, University Transit Network')}">
            <span class="brand-mark navy">${icon('route')}</span>
            <span><span class="brand-name">${t('Campus in Motion')}</span><span class="brand-sub">${t('University Transit Network')}</span></span>
          </a>
          <nav class="land-links" aria-label="${t('Main')}">
            <a href="#/" data-scroll="live">${t('Live Tracking')}</a><a href="#/" data-scroll="routes">${t('Routes')}</a><a href="#/" data-scroll="overview">${t('Schedules')}</a><a href="#/" data-scroll="how">${t('How It Works')}</a>
          </nav>
          <div class="row land-tools" style="gap:10px">
            ${langSwitch('btn sm')}
            ${themeSwitch()}
            <a class="btn sm desk-only" href="#/admin/login">${t('Administrator')}</a>
            <a class="btn sm fill desk-only" href="#/student/login">${t('Get Started')}</a>
            <button class="btn sm secondary mobile-nav-btn" data-click="nav-toggle" aria-expanded="${bool(s.nav)}" aria-controls="land-mobile-nav" aria-label="${t('Toggle navigation menu')}">${icon(s.nav ? 'close' : 'menu', 18)}</button>
          </div>
        </div>
        ${s.nav ? html`<div class="scrim" data-click="nav-close" aria-hidden="true"></div>
          <div class="land-mobile-menu" id="land-mobile-nav" role="dialog" aria-label="${t('Navigation menu')}">
            <div class="land-mobile-menu-head">
              <span class="brand-name">${t('Campus in Motion')}</span>
              <button class="btn sm ghost" data-click="nav-close" aria-label="${t('Close menu')}">${icon('close', 18)}</button>
            </div>
            <nav class="stack" style="gap:6px">
              <a href="#/" data-scroll="live" class="land-mob-link" data-click="nav-close">${icon('pin', 18)}${t('Live Tracking')}</a>
              <a href="#/" data-scroll="routes" class="land-mob-link" data-click="nav-close">${icon('route', 18)}${t('Routes & Stops')}</a>
              <a href="#/" data-scroll="overview" class="land-mob-link" data-click="nav-close">${icon('cal', 18)}${t('Schedules')}</a>
              <a href="#/" data-scroll="how" class="land-mob-link" data-click="nav-close">${icon('check', 18)}${t('How It Works')}</a>
            </nav>
            <hr style="border:0;border-top:1px solid var(--border);margin-block:12px">
            <div class="stack" style="gap:8px">
              <a class="btn fill" href="#/student/login" data-click="nav-close">${t('Get Started as Student')}</a>
              <a class="btn secondary" href="#/admin/login" data-click="nav-close">${t('Administrator Portal')}</a>
            </div>
          </div>` : ''}
      </header>

      <main id="main" tabindex="-1">
        <section class="hero" id="live" aria-labelledby="h">
          <svg class="journey" data-static aria-hidden="true" viewBox="0 0 1 1"></svg>
          <div class="land-wrap hero-grid">
            <div class="hero-copy">
              <p class="live-pill" role="status"><i class="${noBus ? 'off' : ''}"></i>${noBus ? t('No buses running right now') : `${t(service)} · ${t('live now')}`}</p>
              <p class="eyebrow">${t('University transit, reimagined')}</p>
              <h1 id="h"><span class="w">${t('Your campus.')}</span><em><span class="w">${t('In motion.')}</span><svg class="ul" viewBox="0 0 300 16" preserveAspectRatio="none" aria-hidden="true"><path class="draw" pathLength="1" d="M2 9C50 2 90 15 140 8S230 4 296 9" fill="none" stroke="#8DB4F8" stroke-width="7" stroke-linecap="round" vector-effect="non-scaling-stroke"/><path class="fade" d="M2 9C50 2 90 15 140 8S230 4 296 9" fill="none" stroke="#0F1B2D" stroke-width="1.5" stroke-dasharray="2 6" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg><i class="jn"></i></em></h1>
              <p class="lead">${t('Know where your bus is, when it arrives, and when it is ready to leave. Your entire university journey, connected in real time.')}</p>
              <div class="row cta-row">
                <a class="btn-big primary" href="#/student/login">${t('Track My Bus')} <span class="arr">${icon('arrow', 18)}</span></a>
                <a class="btn-big" href="#/" data-scroll="routes">${icon('route', 18)}${t('Explore Routes')}</a>
                <button class="btn-big" type="button" data-click="nearest">${icon('pin', 18)}${t('Nearest stop')}</button>
              </div>
              ${s.locMsg ? html`<p class="small muted loc-msg" role="status">${s.locMsg}</p>` : ''}
              <p class="small muted">${t('Live bus locations · Smarter arrivals · Connected campus routes')}</p>
            </div>

            <div class="map-stage">
              <div class="map-frame">
                <div class="map-art">
                  ${o?.data_mode === 'demo' ? html`<span class="sim-tag"><span class="dot"></span>${t('Simulated data · no live GPS')}</span>` : ''}
                  ${cat ? transitMap({ campus: cat.campus, routes: cat.routes, trips, wide: true, insetRight: s.wide ? 310 : 0, selectedRouteId: selRouteId, selectedTripId: selTrip?.id, highlightStopId: selStop?.id, userLoc: s.userLoc, onSelectTrip: true, onSelectStop: true })
                    : s.cat.error ? errorBox(s.cat.error, 'cat') : loading(t('Loading map…'))}
                  ${selTrip && selStop && mins != null && mins <= 5 ? html`<div class="toast" role="status" data-key="lt-${selTrip.id}-${selStop.id}">
                    <span class="bus-ico">${icon('bell', 16)}</span>
                    <div><b>${t('Bus {n} is {m} min away', { n: selTrip.bus.number, m: mins })}</b><span>${t('Time to leave for {stop}', { stop: selStop.name })}</span></div>
                  </div>` : ''}
                </div>
                <div class="panels">
                  <article class="panel p-net" aria-label="${t('Campus network status')}">
                    <div><b>${String(o?.trips_live ?? 0).padStart(2, '0')}</b><span>${t('Buses active')}</span></div>
                    <div><b>${String(o?.trips_waiting ?? 0).padStart(2, '0')}</b><span>${t('At university')}</span></div>
                    <div><b>${String(o?.updates ?? 0).padStart(2, '0')}</b><span>${t('Service alerts')}</span></div>
                  </article>

                  <article class="panel p-bus" aria-label="${t('Selected bus')}" aria-live="polite">
                    <div class="bus-top">
                      <div class="p-head"><span class="p-label">${t('Selected bus')}</span>${selTrip ? tripStatusBadge(selTrip) : ''}</div>
                      ${selTrip ? html`
                        <div class="bus-title"><span class="bus-ico">${icon('bus', 18)}</span><span class="bus-no">${t('BUS {n}', { n: selTrip.bus.number })}</span></div>
                        <p class="route-line">${t('{route} → University Campus', { route: selTrip.route.name })}</p>
                        <dl class="dl">
                          <div><dt>${t('Next stop')}</dt><dd>${(selTrip.stops.find((x) => x.eta?.kind !== 'passed') || {}).name || t('None')}</dd></div>
                          <div><dt>${t('Seats open')}</dt><dd class="mono">${sc ? t('{a} of {c}', { a: sc.available, c: sc.capacity }) : '—'}</dd></div>
                        </dl>` : html`<p class="small muted">${t('No buses are running or about to leave right now.')}</p>`}
                    </div>
                    <div class="eta" aria-label="${t('Estimated arrival')}">
                      <div class="p-label">${eta ? kindLabel(eta.kind) : t('No ETA')} · ${t('arriving in')}</div>
                      <div class="eta-main">
                        ${mins != null ? html`<span class="eta-num tick" data-key="en-${mins}">${String(mins).padStart(2, '0')}</span><span class="eta-unit">${t('min')}</span>` : html`<span class="eta-num txt">${eta?.kind === 'passed' ? t('Passed') : '—'}</span>`}
                      </div>
                      <div class="eta-stop">${selStop?.name || t('Pick a collection point')}</div>
                      <div class="prog" role="progressbar" aria-label="${t('Trip progress toward the selected stop')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round((selTrip?.progress ?? 0) * 100)}"><i style="width:${(selTrip?.progress ?? 0) * 100}%"></i></div>
                      <small>${selTrip?.position ? `${selTrip.position.fresh ? t('GPS') : t('GPS silent')} · ${ago(selTrip.position.age_sec)}` : (eta?.basis || t('Estimates appear once a bus is assigned to this route.'))}</small>
                    </div>
                  </article>
                </div>
              </div>

              <div class="hero-bar">
                <div class="seg-chips" role="group" aria-label="${t('Choose a route')}">
                  ${routes.map((r) => {
                    const on = r.active !== 0;
                    return html`<button data-key="hc-${r.id}" type="button" class="chip" aria-pressed="${bool(r.id === selRouteId)}" ${on ? '' : 'disabled'} data-click="pick-route" data-id="${r.id}"
                      ${on ? '' : attr`aria-label="${t('Route {code}, {name}, not in service', { code: r.code, name: r.name })}"`}>
                      <span class="sw" style="background:${colorOf[r.id]}"></span>${r.code} ${r.name}
                    </button>`;
                  })}
                </div>
                <div class="feed">
                  <span class="row" style="gap:8px">${s.paused ? html`${icon('alert', 16)}${t('Feed paused')}` : html`<span class="dot"></span>${t('Feed running')}`}</span>
                  <button class="btn sm" type="button" aria-pressed="${bool(s.paused)}" data-click="pause">${s.paused ? t('Resume feed') : t('Pause feed')}</button>
                </div>
              </div>
              ${s.live.error && !s.live.data ? errorBox(s.live.error, 'live') : ''}
            </div>
          </div>
          <div class="city" data-static data-key="city" aria-hidden="true"></div>
        </section>

        <div class="marquee" aria-hidden="true">
          <div class="marquee-track">
            ${[0, 1].map((k) => html`<div class="marquee-set" data-key="ms-${k}">
              ${[...routes.map((r) => `${r.code} · ${r.name}`), t('Live bus locations'), t('Smarter arrivals'), t('Connected campus routes')].map((txt) => html`<span class="marquee-item"><i></i>${txt}</span>`)}
            </div>`)}
          </div>
        </div>

        <section class="section" id="overview" aria-labelledby="ov-h" style="padding-top:clamp(40px, 6vw, 72px)">
          <div class="land-wrap">
            <div class="sec-head"><span class="eyebrow">${t('Live transportation overview')}</span><h2 id="ov-h">${t('Every bus, route and alert in one strip.')}</h2></div>
            ${widgetHost('overviewBoard')}
          </div>
        </section>

        <section class="section" id="how" aria-labelledby="how-h">
          <div class="land-wrap">
            <div class="sec-head"><span class="eyebrow">${t('How it works')}</span><h2 id="how-h">${t('Three steps from the dorm to the door.')}</h2></div>
            ${widgetHost('stepsGuide')}
          </div>
        </section>

        <section class="section" id="routes" aria-labelledby="rt-h" style="padding-top:0">
          <div class="land-wrap">
            <div class="sec-head"><span class="eyebrow">${t('Routes around your campus')}</span><h2 id="rt-h">${t('Pick a route. See it on the map.')}</h2></div>
            ${s.cat.loading && !s.cat.data ? loading() : routes.length === 0 ? empty(t('No routes published yet'), html`<p>${t('Routes appear here once the administrators add them.')}</p>`) : routesPicker({ routes, trips, colorOf, selId: s.rpSel })}
          </div>
        </section>

        <section class="section alt" id="areas" aria-labelledby="acc">
          <div class="land-wrap">
            <div class="sec-head"><span class="eyebrow">${t('Built for students and administrators')}</span><h2 id="acc">${t('One network, two separate areas.')}</h2></div>
            ${areasCards(STUDENT, ADMIN)}
          </div>
        </section>

        <section class="final final-full" aria-labelledby="fin-h">
          <div class="land-wrap fin-in">
            <h2 id="fin-h">${t('Less waiting.')}<span>${t('More moving.')}</span></h2>
            <p>${t('Make every campus journey easier to plan.')}</p>
            <div class="fin-cta">
              <a class="btn-big primary on-dark" href="#/student/login">${t('Get started')} <span class="arr">${icon('check', 18)}</span></a>
              <a class="fin-ghost" href="#/" data-scroll="routes">${icon('route', 18)}${t('Explore routes')}</a>
            </div>
            <div class="fin-perks"><span>${icon('pin', 14)}${t('Live GPS arrivals')}</span><span>${icon('seat', 14)}${t('Seat reservations')}</span><span>${icon('bell', 14)}${t('Delay alerts')}</span></div>
          </div>
          ${finalScene()}
        </section>
      </main>
      <footer class="footer"><div class="land-wrap">${t('Campus in Motion. Arrival times are only shown as “live” when they come from a recent GPS position; otherwise they are labelled as scheduled estimates.')}</div></footer>
      </div>`;
    },
    after: () => {
      const D = derive();
      const s = view.state;
      const cityEl = view.$('.city');
      if (cityEl && !cityEl.__city) { cityEl.__city = true; city = createCity(cityEl); }
      city?.update(D.selRoute?.stops, D.selTrip?.bus?.number, D.selRoute?.code);
      syncWidgets(view, WIDGETS, {
        overviewBoard: { o: s.ov.data, routes: D.routes, trips: D.trips, colorOf: D.colorOf },
        stepsGuide: { steps: STEPS, routes: D.routes, colorOf: D.colorOf, busNo: D.selTrip?.bus?.number, seats: D.selTrip?.seats },
      });
      journey();
    },
    actions: {
      'nav-toggle': () => view.set({ nav: !view.state.nav }),
      'nav-close': () => view.set({ nav: false }),
      nearest: findNearest,
      'pick-route': (el) => pickRoute(Number(el.dataset.id)),
      pause: () => { const p = !view.state.paused; live.pause(p); view.set({ paused: p }); },
      'map-bus': (el) => { const tr = derive().trips.find((x) => x.id === Number(el.dataset.trip)); if (tr) view.set({ tripId: tr.id, routeId: tr.route.id, stopId: null }); },
      'map-stop': (el) => pickStop(Number(el.dataset.stop), Number(el.dataset.route)),
      'rp-pick': (el) => view.set({ rpSel: Number(el.dataset.id) }),
      'show-route': (el) => pickRoute(Number(el.dataset.id)),
    },
  };
}

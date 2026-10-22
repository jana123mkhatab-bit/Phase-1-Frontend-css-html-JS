// Landing page sections that animate or have their own state: the overview board, the three-step guide,
// the route picker and the two area cards.
import { html, raw, bool } from '../core/dom.js';
import { t, tn } from '../core/i18n.js';
import { icon } from '../core/icons.js';

const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const NS = 'http://www.w3.org/2000/svg';

// ---------------------------------------------------------------- overview board (widget)
export function overviewBoard(view) {
  view.state.cnt = { live: null, waiting: null, ra: null, upd: null };
  let raf = 0; let from = { live: 0, waiting: 0, ra: 0, upd: 0 }; let target = '';
  const targets = () => {
    const { o } = view.state.props;
    return { live: o?.trips_live ?? null, waiting: o?.trips_waiting ?? null, ra: o?.routes_active ?? null, upd: o?.updates ?? null };
  };
  function tween() {
    const tg = targets(); const key = JSON.stringify(tg);
    if (key === target) return;
    target = key;
    cancelAnimationFrame(raf);
    const t0 = performance.now(); const start = { ...from };
    if (REDUCE) { view.state.cnt = { ...tg }; from = Object.fromEntries(Object.entries(tg).map(([k, v]) => [k, v ?? 0])); view.update(); return; }
    const f = (now) => {
      const p = Math.min(1, (now - t0) / 800); const e = 1 - (1 - p) ** 3;
      const cnt = {};
      for (const k of Object.keys(tg)) cnt[k] = tg[k] == null ? null : Math.round(start[k] + (tg[k] - start[k]) * e);
      view.state.cnt = cnt; from = Object.fromEntries(Object.entries(cnt).map(([k, v]) => [k, v ?? 0]));
      view.update();
      if (p < 1) raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
  }
  view.onCleanup(() => cancelAnimationFrame(raf));
  const show = (v) => (v == null ? '—' : v);
  return {
    render: () => {
      const { o, routes = [], trips = [], colorOf = {} } = view.state.props;
      const c = view.state.cnt;
      const total = o?.buses_total ?? 0;
      const next = trips.find((x) => x.status !== 'departed');
      const dep = next?.expected_departure ? new Date(next.expected_departure) : null;
      const depOk = dep && !Number.isNaN(dep.getTime());
      const mins = depOk ? Math.round((dep.getTime() - Date.now()) / 60000) : null;
      const off = routes.filter((r) => r.active === 0);
      const live = o?.trips_live ?? null; const upd = o?.updates ?? null;
      return html`<div class="ov-board">
        <div class="ov-top"><span class="ov-live"><i></i>${t('Network live')}</span><span>${t('Refreshes every 20 seconds')}</span></div>
        <div class="ov-cells">
          <article class="ov-cell">
            <div class="ov-h"><span>${t('Buses on the road')}</span>${icon('bus')}</div>
            <div class="ov-num">${show(c.live)}${total > 0 ? html`<small>${t('of {n}', { n: total })}</small>` : ''}</div>
            <div class="ov-viz" aria-hidden="true">${Array.from({ length: Math.min(total, 8) }, (_, i) => html`<i class="ov-pip${i < (live || 0) ? ' on' : ''}"></i>`)}</div>
            <p class="ov-sub">${total > 0 ? t('{a} driving, {b} parked at the university.', { a: live ?? 0, b: Math.max(0, total - (live ?? 0)) }) : t('No buses are in service.')}</p>
          </article>
          <article class="ov-cell">
            <div class="ov-h"><span>${t('Waiting / soon')}</span>${icon('clock')}</div>
            <div class="ov-num">${show(c.waiting)}</div>
            ${next && depOk ? html`<div class="ov-dep">
              <div class="ov-dep-row"><span class="ov-time">${dep.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>${t('Next: {route}', { route: `${next.route.code} ${next.route.name}` })}</div>
              <div class="ov-bar" aria-hidden="true"><i style="width:${Math.max(6, Math.min(100, 100 - Math.max(0, mins) * 3))}%"></i></div>
            </div>` : html`<div class="ov-viz" aria-hidden="true"></div>`}
            <p class="ov-sub">${next && depOk ? (mins > 0 ? t('Departs in {n} min', { n: mins }) : t('Boarding now')) : t('No buses are running or about to leave right now.')}</p>
          </article>
          <article class="ov-cell">
            <div class="ov-h"><span>${t('Routes in operation')}</span>${icon('route')}</div>
            <div class="ov-num">${show(c.ra)}${routes.length > 0 ? html`<small>${t('of {n}', { n: routes.length })}</small>` : ''}</div>
            <div class="ov-viz">${routes.slice(0, 6).map((r) => html`<span data-key="rt-${r.id}" class="ov-rt${r.active === 0 ? ' off' : ''}" style="--c:${colorOf[r.id]}"><i></i>${r.code}</span>`)}</div>
            <p class="ov-sub">${off.length ? t('{codes} not in service.', { codes: off.map((r) => r.code).join(', ') }) : t('Every route is in service.')}</p>
          </article>
          <article class="ov-cell">
            <div class="ov-h"><span>${t('Service updates')}</span>${icon('alert')}</div>
            <div class="ov-num">${show(c.upd)}</div>
            <div class="ov-viz">${upd > 0 ? html`<span class="ov-state warn">${icon('alert', 14)}${t('Check updates')}</span>` : html`<span class="ov-state">${icon('check', 14)}${t('Normal service')}</span>`}</div>
            <p class="ov-sub">${upd > 0 ? tn(upd, '{n} service update is active.', '{n} service updates are active.') : t('No delays or changes right now.')}</p>
          </article>
        </div>
      </div>`;
    },
    after: tween,
  };
}

// ---------------------------------------------------------------- how it works (widget)
const ROAD = 'M24 128L24 96L70 50L142 50L182 90L240 90';
const STEP_MAP = `<g stroke="var(--road)" stroke-width="3" fill="none" stroke-linecap="round"><path d="M-10 120C60 108 130 140 310 118"/><path d="M110 -10C120 50 100 100 124 180"/></g>
  <path d="M222 138q22-12 40 2t-2 26q-24 4-38-8t0-20z" fill="color-mix(in srgb, var(--g3) 24%, var(--map-bg))"/>
  <path class="rd" d="${ROAD}" fill="none" stroke="var(--road)" stroke-width="10" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="${ROAD}" fill="none" stroke="var(--brand)" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"/>
  <g fill="var(--white)" stroke="var(--brand)" stroke-width="3"><circle cx="24" cy="128" r="6"/><circle cx="70" cy="50" r="6"/><circle cx="142" cy="50" r="6"/><circle cx="182" cy="90" r="6"/></g>
  <rect x="228" y="78" width="24" height="24" rx="7" fill="var(--navy)"/><path d="M234 95v-7l6-3 6 3v7M238 95v-4h4v4" stroke="#fff" stroke-width="1.6" fill="none" stroke-linejoin="round"/>
  <g class="stepbus"><circle r="13" fill="var(--white)" stroke="var(--brand)" stroke-width="3.5"/><g transform="translate(-7 -7) scale(.58)" style="color:var(--brand)"><path d="M5 17V8a3 3 0 013-3h8a3 3 0 013 3v9M5 13h14M8 20v-3M16 20v-3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></g></g>`;

export function stepsGuide(view) {
  Object.assign(view.state, { step: 0, auto: !REDUCE, hold: false, pi: 0 });
  const rsOf = () => (view.state.props.routes || []).filter((r) => r.active !== 0).slice(0, 3);
  view.interval(() => { const s = view.state; if (s.auto && !s.hold) view.set({ step: (s.step + 1) % 3 }); }, 4200);
  view.interval(() => { const s = view.state; const n = rsOf().length; if (s.step === 0 && !REDUCE && n >= 2) view.set({ pi: (s.pi + 1) % n }); }, 1700);
  view.listen(view.root, 'mouseenter', () => view.set({ hold: true }));
  view.listen(view.root, 'mouseleave', () => view.set({ hold: false }));
  view.listen(view.root, 'focusin', () => view.set({ hold: true }));
  view.listen(view.root, 'focusout', () => view.set({ hold: false }));

  // the map in step 2 is drawn once; a bus rides the road while that step is showing
  let p = .35; let lastStep = -1; let raf = 0;
  const place = () => {
    const svg = view.$('svg.hw-map'); if (!svg) return;
    const path = svg.querySelector('.rd'); const bus = svg.querySelector('.stepbus');
    if (!path || !bus) return;
    const L = path.getTotalLength(); const q = path.getPointAtLength(L * p);
    bus.setAttribute('transform', `translate(${q.x} ${q.y})`);
    const eta = view.$('.hw-eta b'); if (eta) eta.textContent = Math.max(1, Math.round((1 - p) * 6));
  };
  const loop = () => {
    if (view.state.step !== lastStep) { lastStep = view.state.step; p = .35; place(); }
    if (view.state.step === 1 && !REDUCE) { p += .0016; if (p > .92) p = .05; place(); }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  view.onCleanup(() => cancelAnimationFrame(raf));

  const go = (i) => view.set({ step: i, auto: false });
  return {
    render: () => {
      const { steps = [], routes = [], colorOf = {}, busNo, seats } = view.state.props;
      const { step, auto, pi } = view.state;
      const rs = rsOf();
      const pick = rs[Math.min(pi, Math.max(0, rs.length - 1))];
      const cp = pick ? (pick.stops[1] || pick.stops[0])?.name : null;
      const free = seats?.capacity ? Math.max(0, Math.min(10, Math.round(10 * seats.available / seats.capacity))) : 5;
      void routes;
      return html`<div class="hw">
        <div class="hw-rail" role="group" aria-label="${t('Steps')}">
          <div class="hw-line" style="--p:${step / 2}">
            <div class="hw-fill"></div>
            ${steps.map(([, , ti], i) => html`<button type="button" data-key="n-${i}" class="hw-node${i === step ? ' on' : i < step ? ' done' : ''}" style="--i:${i}" ${i === step ? raw('aria-current="step"') : ''} aria-label="${t('Step {n}', { n: i + 1 })}: ${t(ti)}" data-click="go" data-i="${i}">${i + 1}</button>`)}
            <span class="hw-bus" aria-hidden="true">${icon('bus')}</span>
          </div>
        </div>
        <div class="hw-steps">
          ${steps.map(([, k, ti, d], i) => html`<article data-key="s-${i}" class="hw-step${i === step ? ' on' : ''}" data-click="go" data-i="${i}">
            <div class="hw-art" aria-hidden="true">
              ${i === 0 ? html`${rs.map((r, j) => html`<div data-key="pk-${r.id}" class="hw-pick${j === pi ? ' sel' : ''}"><span class="hw-sw" style="background:${colorOf[r.id]}"></span>${r.code} ${r.name}<em>${tn(r.stops.length, '{n} stop', '{n} stops')}</em></div>`)}${cp ? html`<span class="hw-cp">${icon('pin', 12)}${cp}</span>` : ''}` : ''}
              ${i === 1 ? html`<svg class="hw-map" data-static viewBox="0 0 300 168" preserveAspectRatio="xMidYMid slice"></svg><div class="hw-eta"><b>4</b><span>${t('min')}</span></div>` : ''}
              ${i === 2 ? html`<div class="hw-toast"><span class="ic">${icon('bell', 16)}</span><div><b>${busNo ? t('Bus {n} is {m} min away', { n: busNo, m: 5 }) : t('Your bus is 5 min away')}</b><span>${t('Time to leave for {stop}', { stop: cp || t('your collection point') })}</span></div></div>
                <div class="hw-seats"><div class="dots">${Array.from({ length: 10 }, (_, j) => html`<i class="${j >= 10 - free ? 'f' : ''}" style="--k:${j}"></i>`)}</div><span>${t('{a} of {c} seats open', { a: seats?.available ?? 18, c: seats?.capacity ?? 40 })}</span></div>` : ''}
            </div>
            <span class="hw-label" data-n="${i + 1}">${t(k)}</span><h3>${t(ti)}</h3><p>${t(d)}</p>
          </article>`)}
        </div>
        <div class="hw-ctrl">
          <button type="button" aria-pressed="${bool(auto)}" data-click="toggle">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${auto ? raw('<path d="M8 5v14M16 5v14"/>') : raw('<path d="M7 4l13 8-13 8z"/>')}</svg>
            ${auto ? t('Pause tour') : t('Play tour')}
          </button>
        </div>
      </div>`;
    },
    after: () => {
      const svg = view.$('svg.hw-map');
      if (svg && !svg.firstChild) { svg.innerHTML = STEP_MAP; place(); }
    },
    actions: {
      go: (el) => go(Number(el.dataset.i)),
      toggle: () => view.set({ auto: !view.state.auto }),
    },
  };
}

// ---------------------------------------------------------------- routes picker
export function routesPicker({ routes, trips, colorOf, selId }) {
  const cur = routes.find((x) => x.id === selId) || routes.find((x) => x.active !== 0) || routes[0];
  if (!cur) return '';
  const liveOf = (r) => trips.filter((x) => x.route?.id === r.id && x.status === 'departed').length;
  const on = cur.active !== 0;
  const trip = trips.find((x) => x.route?.id === cur.id && x.status === 'departed') || trips.find((x) => x.route?.id === cur.id);
  const n = cur.stops.length + 1;
  const live = liveOf(cur);
  const etaLabel = (s) => {
    const e = trip?.stops?.find((z) => z.id === s.id)?.eta;
    if (!e) return '';
    if (e.kind === 'passed') return t('Passed');
    return e.seconds != null ? `~${t('{n} min', { n: Math.max(1, Math.round(e.seconds / 60)) })}` : '';
  };
  const p = Math.max(0, Math.min(1, trip?.progress ?? 0));
  return html`<div class="rp-cards" role="group" aria-label="${t('Choose a route')}">
      ${routes.map((r) => {
        const isOn = r.active !== 0; const lv = liveOf(r);
        return html`<button data-key="rc-${r.id}" type="button" class="rp-card${isOn ? '' : ' off'}" aria-pressed="${bool(r.id === cur.id)}" aria-controls="rp-detail" style="--c:${colorOf[r.id]}" data-click="rp-pick" data-id="${r.id}">
          <div class="rp-top">
            <span class="rp-id"><i></i>${r.code}</span>
            ${isOn ? html`<span class="rp-badge">${lv > 0 ? html`<span class="lv"></span>` : ''}${t('In service')}</span>` : html`<span class="rp-badge off">${t('Not in service')}</span>`}
          </div>
          <h3>${r.name}</h3>
          <div class="rp-mini" aria-hidden="true">
            ${Array.from({ length: Math.min(r.stops.length, 6) }, () => html`<i></i>`)}
            <b>${icon('bus', 12)}</b>
            ${lv > 0 ? html`<span class="rp-mbus"></span>` : ''}
          </div>
          <div class="rp-meta"><span>${tn(r.stops.length, '{n} collection point', '{n} collection points')}</span><span>${lv > 0 ? tn(lv, '{n} bus live', '{n} buses live') : isOn ? t('No bus live yet') : ''}</span></div>
        </button>`;
      })}
    </div>
    <div class="rp-detail" id="rp-detail" aria-live="polite">
      <div class="rp-head">
        <div><h3>${t('{route} → University Campus', { route: `${cur.code} · ${cur.name}` })}</h3><p>${on ? t('Collection points in boarding order.') : t('This route is not in service right now.')}</p></div>
        <div class="rp-chips">
          <span class="rp-chip">${tn(cur.stops.length, '{n} stop', '{n} stops')}</span>
          ${live > 0 ? html`<span class="rp-chip">${tn(live, '{n} bus live', '{n} buses live')}</span>` : ''}
          ${on ? html`<a class="rp-show" href="#/" data-scroll="live" data-click="show-route" data-id="${cur.id}">${t('Show on the map')}${icon('arrow', 16)}</a>` : ''}
        </div>
      </div>
      <div class="rp-stops" style="--c:${on ? colorOf[cur.id] : 'var(--border-strong)'};--n:${n}">
        ${cur.stops.map((s, i) => html`<div class="rp-stp" data-key="rs-${s.id}"><i>${i + 1}</i><b>${s.name}</b><span>${i === 0 && !etaLabel(s) ? t('Start') : etaLabel(s)}</span></div>`)}
        <div class="rp-stp end"><i>${icon('bus', 13)}</i><b>${t('University Campus')}</b><span></span></div>
        ${on && trip && trip.status === 'departed' ? html`<span class="rp-sbus" style="--f:${((.5 + p * (n - 1)) / n) * 100}%">${icon('bus', 18)}</span>` : ''}
      </div>
    </div>`;
}

// ---------------------------------------------------------------- student / administrator areas
export function areasCards(student, admin) {
  const feats = (list) => html`<div class="ar-fl">${list.map(([i, ti, d]) => html`<div class="ar-ft"><span class="ico">${icon(i, 18)}</span><h4>${t(ti)}</h4><p>${t(d)}</p></div>`)}</div>`;
  return html`<div class="ar-grid">
    <article class="ar-card">
      <svg class="ar-deco" viewBox="0 0 120 90" aria-hidden="true"><rect x="58" y="6" width="50" height="84" rx="10"/><path d="M76 12h14"/><path d="M66 70h12l6-8v-14l8-8h8"/><circle cx="84" cy="36" r="5" class="f"/></svg>
      <div class="ar-top"><span class="ar-ic">${icon('user', 26)}</span><div><span class="tag">${t('Students')}</span><h3>${t('Student area')}</h3></div></div>
      <p>${t('Track buses, get alerts, reserve seats and report problems. Create an account with your email.')}</p>
      ${feats(student)}
      <div class="ar-foot"><span class="note">${icon('mail', 16)}${t('Sign up in a minute with your email')}</span><a class="btn" href="#/student/login">${t('Student sign in')}</a></div>
    </article>
    <article class="ar-card staff">
      <svg class="ar-deco" viewBox="0 0 120 90" aria-hidden="true"><rect x="20" y="10" width="88" height="62" rx="9"/><path d="M20 26h88"/><path d="M36 62V46M52 62V38M68 62V50M84 62V34"/><circle cx="30" cy="18" r="2" class="f"/></svg>
      <div class="ar-top"><span class="ar-ic">${icon('shield', 26)}</span><div><span class="tag">${t('Staff')}</span><h3>${t('Administrator area')}</h3></div></div>
      <p>${t('Manage buses, drivers, routes, schedules, reservations, service updates and reports. Accounts are created by the university, not self-service.')}</p>
      ${feats(admin)}
      <div class="ar-foot"><span class="note">${icon('lock', 16)}${t('Invite-only access')}</span><a class="btn secondary" href="#/admin/login">${t('Administrator sign in')}</a></div>
    </article>
  </div>`;
}

void NS;

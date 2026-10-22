import { html } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { getUser } from '../../core/auth.js';
import { t } from '../../core/i18n.js';
import { fmtTime, fmtDateTime } from '../../core/format.js';
import { asyncBlock, pageHead, empty, seatBar, tripStatusBadge, toast, confirmDialog, field } from '../../core/ui.js';
import { crowdBadge } from '../../components/widgets.js';

export default function reserve(view, ctx) {
  ctx.setTitle('Reserve a seat');
  const bookable = view.load('bookable', () => api.get('/api/student/bookable'), { ms: 6000 });
  const mine = view.load('mine', () => api.get('/api/student/reservations'));
  Object.assign(view.state, { pick: {}, hl: Number(ctx.query.trip) || null, busy: null, dir: 'all', q: '' });
  let focused = -1;

  const focusTrip = (id) => {
    view.set({ hl: id });
    view.timeout(() => document.getElementById(`trip-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 0);
  };

  function doReserve(trId) {
    const user = getUser('student');
    const tr = view.state.bookable.data.trips.find((x) => x.id === trId);
    if (tr.route.id === user.route_id) {
      confirmDialog({
        title: t('You are already registered on this route'),
        body: t('Route {code} is your assigned route, so you already have a seat on its buses. Reservations are only needed for buses outside your route.', { code: tr.route.code }),
        confirmLabel: t('OK'), hideCancel: true, onConfirm: () => {},
      });
      return;
    }
    const stopId = view.state.pick[tr.id] || (tr.route.id === user.route_id ? user.stop_id : null) || undefined;
    const stop = tr.stops.find((x) => x.id === stopId);
    confirmDialog({
      title: t('Reserve a seat on bus {n}?', { n: tr.bus.number }),
      body: stop
        ? t('This reserves one of the {a} available seats, boarding at {stop}. You can cancel it before the bus leaves.', { a: tr.seats.available, stop: stop.name })
        : t('This reserves one of the {a} available seats. You can cancel it before the bus leaves.', { a: tr.seats.available }),
      confirmLabel: t('Reserve seat'),
      onConfirm: async () => {
        view.set({ busy: tr.id });
        try {
          await api.post('/api/student/reservations', { trip_id: tr.id, stop_id: stopId });
          toast(t('Seat reserved on bus {n}', { n: tr.bus.number }));
          bookable.refresh(); mine.reload();
        } catch (e) { toast(e.message, 'error'); bookable.refresh(); } finally { view.set({ busy: null }); }
      },
    });
  }
  function doCancel(id) {
    const r = view.state.mine.data.reservations.find((x) => x.id === id);
    confirmDialog({
      title: t('Cancel this reservation?'), body: t('Your seat on bus {n} ({time}) will be released for other students.', { n: r.bus_number, time: fmtTime(r.scheduled_departure) }), confirmLabel: t('Cancel reservation'), danger: true,
      onConfirm: async () => { try { await api.del(`/api/student/reservations/${r.id}`); toast(t('Reservation cancelled')); mine.reload(); bookable.refresh(); } catch (e) { toast(e.message, 'error'); } },
    });
  }

  return {
    render: () => {
      const user = getUser('student');
      const { pick, hl, busy, dir, q } = view.state;
      const active = (view.state.mine.data?.reservations ?? []).filter((r) => r.status === 'confirmed');
      return html`${pageHead(t('Reserve a seat'), t('Check how many seats are free and reserve one, especially when you need a bus outside your assigned route. Reservations close when the bus leaves.'))}
      ${active.length > 0 ? html`<section class="card tint" aria-label="${t('My reservations')}">
        <div class="card-head"><h2>${t('My active reservations')}</h2></div>
        <div class="stack-sm">${active.map((r) => html`<div class="row between" data-key="res-${r.id}">
          <div><b>${t('Bus {n}', { n: r.bus_number })}</b> · ${r.route_name} · ${fmtDateTime(r.scheduled_departure)}${r.stop_name ? ` · ${t('from {name}', { name: r.stop_name })}` : ''}${r.outside_route ? html`<span class="badge sky" style="margin-left:8px">${t('Outside my route')}</span>` : ''}</div>
          ${['scheduled', 'preparing'].includes(r.trip_status) ? html`<button class="btn sm danger outline" data-click="cancel" data-id="${r.id}">${t('Cancel')}</button>` : html`<span class="badge">${t('Bus has left')}</span>`}
        </div>`)}</div>
      </section>` : ''}
      <div class="row" style="gap:12px;flex-wrap:wrap;align-items:center">
        <div class="seg" role="group" aria-label="${t('Direction')}">
          ${[['all', 'All trips'], ['to_campus', 'To university'], ['from_campus', 'From university']].map(([k, label]) => html`<button aria-pressed="${String(dir === k)}" data-click="dir" data-d="${k}">${t(label)}</button>`)}
        </div>
        <input class="input" type="search" autocomplete="off" style="flex:1;min-width:220px" placeholder="${t('Search by bus, route or collection point…')}" aria-label="${t('Search trips')}" value="${q}" data-bind="q">
      </div>
      ${asyncBlock(view.state.bookable, 'bookable', (d0) => {
        const needle = q.trim().toLowerCase();
        const d = { ...d0, trips: d0.trips.filter((tr) => (dir === 'all' || (tr.direction ?? 'from_campus') === dir)
          && (!needle || [tr.bus.number, tr.route.code, tr.route.name, ...tr.stops.map((s) => s.name)].some((x) => String(x ?? '').toLowerCase().includes(needle)))) };
        return html`${d.trips.length === 0 && d0.trips.length > 0 ? empty(t('No trips match'), t('Try another direction or a different search.')) : ''}<div class="grid g2">${d.trips.map((tr) => {
        const toCampus = tr.direction === 'to_campus';
        const full = tr.seats.available === 0;
        const outsideBlocked = tr.outside_route && (!tr.allow_outside || tr.seats.outside_reserved >= tr.outside_limit);
        const sel = pick[tr.id] ?? (tr.route.id === user.route_id ? user.stop_id ?? '' : '');
        return html`<article id="trip-${tr.id}" class="card stack" style="${hl === tr.id ? 'outline:3px solid var(--focus)' : ''}" aria-label="${t('Bus {n}', { n: tr.bus.number })}">
          <div class="row between"><div class="row"><span class="bus-chip">${tr.bus.number}</span><div><h3>${tr.route.name}</h3><span class="small muted"><span class="badge ${toCampus ? 'sky' : ''}">${toCampus ? t('To university') : t('From university')}</span> ${t('Departs {time}', { time: fmtTime(tr.expected_departure) })}${tr.delay_minutes ? ` ${t('(delayed {n} min)', { n: tr.delay_minutes })}` : ''}</span></div></div>${tripStatusBadge(tr)}</div>
          ${seatBar(tr.seats)}
          ${crowdBadge(tr.crowd, tr.seats, { showEmpty: true, tripId: tr.id })}
          ${tr.crowd?.quieter_alternative ? html`<div><button type="button" class="btn sm secondary" data-click="quieter" data-id="${tr.crowd.quieter_alternative.trip_id}">${t('Quieter option: {time}', { time: tr.crowd.quieter_alternative.time })}</button></div>` : ''}
          ${tr.outside_route ? html`<div class="alert info small">${t('Outside your assigned route.')} ${tr.allow_outside ? t('{n} seats are open to other routes.', { n: Math.max(0, tr.outside_limit - tr.seats.outside_reserved) }) : t('The admin has closed this trip to other routes.')}</div>` : ''}
          ${field({ label: toCampus ? t('Boarding collection point') : t('Drop-off collection point'), id: `s${tr.id}` }, html`<select id="s${tr.id}" class="input" data-change="pick" data-id="${tr.id}">
            <option value="" ${sel === '' || sel == null ? 'selected' : ''}>${t('Not specified')}</option>
            ${tr.stops.map((s) => html`<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${s.name}</option>`)}
          </select>`)}
          ${tr.reserved_by_me ? html`<span class="badge live">${t('You have a seat')}</span>`
            : html`<button class="btn" data-click="reserve" data-id="${tr.id}" ${full || outsideBlocked || busy === tr.id ? 'disabled' : ''}>${full ? t('Bus is full') : outsideBlocked ? t('Not available for your route') : busy === tr.id ? t('Reserving…') : t('Reserve a seat')}</button>`}
        </article>`;
      })}</div>`; }, { empty: (d) => d.trips.length === 0 })}
      ${view.state.bookable.data?.trips.length === 0 ? empty(t('No bookable trips right now'), t('Trips open for reservation appear here until the bus leaves.')) : ''}`;
    },
    after: () => {
      const len = view.state.bookable.data?.trips?.length;
      if (view.state.hl && len != null && len !== focused) { focused = len; focusTrip(view.state.hl); }
    },
    actions: {
      pick: (el) => { view.state.pick[Number(el.dataset.id)] = Number(el.value) || null; view.update(); },
      reserve: (el) => doReserve(Number(el.dataset.id)),
      dir: (el) => view.set({ dir: el.dataset.d }),
      cancel: (el) => doCancel(Number(el.dataset.id)),
      quieter: (el) => focusTrip(Number(el.dataset.id)),
    },
  };
}

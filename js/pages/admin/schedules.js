import { html, bool } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { t, tn, isAr } from '../../core/i18n.js';
import { fmtTime, todayStr, tripVerb } from '../../core/format.js';
import { asyncBlock, pageHead, empty, tripStatusBadge, toast, confirmDialog, openModal } from '../../core/ui.js';
import { openForm } from '../../components/form-modal.js';

const DAYS = [['sun', 'Sun'], ['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat']];
const DIR_LABEL = { to_campus: 'To university', from_campus: 'From university' };
const TODAY_KEY = DAYS[new Date().getDay()][0];
const DEFAULT_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu'];
const STANDARD_TIMES = { to_campus: ['07:15', '08:30', '10:00'], from_campus: ['13:30', '15:05', '16:45', '18:15'] };
const DIRECTIONS = [
  { key: 'to_campus', title: 'Going to university', sub: 'Morning arrivals' },
  { key: 'from_campus', title: 'Leaving university', sub: 'Afternoon and evening departures' },
];
const fmt12 = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? t('AM') : t('PM')}`; };

export default function schedules(view, ctx) {
  ctx.setTitle('Schedules & trips');
  Object.assign(view.state, { tab: 'trips', date: todayStr(), routeId: null, menu: null });
  const sched = view.load('sched', () => api.get('/api/admin/schedules'));
  const trips = view.load('trips', () => api.get(`/api/admin/trips?date=${view.state.date}`), { ms: 5000 });
  view.load('buses', () => api.get('/api/admin/buses'));
  view.load('routes', () => api.get('/api/admin/routes'));
  view.load('drivers', () => api.get('/api/admin/drivers'));
  let slotView = null;

  const buses = () => view.state.buses.data?.buses ?? [];
  const routes = () => view.state.routes.data?.routes ?? [];
  const bOpts = () => buses().map((b) => ({ value: b.id, label: t('Bus {n}', { n: b.number }) }));
  const rOpts = () => routes().filter((r) => r.active).map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` }));
  const dOpts = () => (view.state.drivers.data?.drivers ?? []).filter((d) => d.active).map((d) => ({ value: d.id, label: d.name }));
  const tripById = (id) => view.state.trips.data.trips.find((x) => x.id === Number(id));
  const selRoute = () => routes().find((r) => r.id === view.state.routeId) ?? routes().find((r) => r.active) ?? routes()[0];

  const status = async (tr, s) => { try { await api.patch(`/api/admin/trips/${tr.id}/status`, { status: s }); toast(tripVerb(s)); trips.refresh(); } catch (e) { toast(e.message, 'error'); } };
  const loadStandard = async () => { try { const r = await api.post('/api/admin/schedules/standard', {}); toast(t('Standard timetable loaded ({n} departures)', { n: r.created })); sched.reload(); } catch (e) { toast(e.message, 'error'); } };
  const generate = async () => { try { const r = await api.post('/api/admin/trips/generate', { date: view.state.date }); toast(r.created ? t('{n} trip(s) created from schedules', { n: r.created }) : t('Trips for this date already exist')); trips.reload(); } catch (e) { toast(e.message, 'error'); } };
  // refresh schedules in place so an open dialog and the grid behind it both update
  const refreshSched = async () => {
    const data = await api.get('/api/admin/schedules');
    view.state.sched = { data, error: null, loading: false };
    view.update(); slotView?.update();
  };

  function scheduleForm(s) {
    const m = openForm({
      title: s.id ? t('Edit schedule') : t('Add schedule'),
      fields: [
        { key: 'route_id', label: t('Route'), type: 'select-number', required: true, blank: t('Choose…'), options: rOpts() }, { key: 'bus_id', label: t('Bus'), type: 'select-number', required: true, blank: t('Choose…'), options: bOpts() },
        { key: 'direction', label: t('Direction'), type: 'select', noBlank: true, options: [{ value: 'to_campus', label: t('Going to university') }, { value: 'from_campus', label: t('Leaving university') }] },
        { key: 'driver_id', label: t('Driver'), type: 'select-number', blank: t('Use the bus’s driver'), options: dOpts() }, { key: 'depart_time', label: t('Departure time'), type: 'time', required: true },
        { key: 'active', label: t('Schedule is active'), type: 'checkbox' },
      ],
      initial: { direction: 'to_campus', ...s },
      extra: (fv) => {
        if (!fv.state.days) fv.state.days = s.days ? (Array.isArray(s.days) ? [...s.days] : String(s.days).split(',')) : [...DEFAULT_DAYS];
        const noDays = fv.state.days.length === 0;
        return html`<fieldset style="border:0;padding:0;margin:0"><legend class="label">${t('Runs on')}</legend>
          <div class="seg" role="group" aria-label="${t('Days of the week')}">${DAYS.map(([k, l]) => html`<button type="button" aria-pressed="${bool(fv.state.days.includes(k))}" data-click="toggle-day" data-d="${k}">${t(l)}</button>`)}</div>
          ${noDays ? html`<span class="field-error" role="alert">${t('Choose at least one day')}</span>` : ''}</fieldset>
          ${s.id ? html`<button type="button" class="btn sm danger outline" style="justify-self:start" data-click="del-sched">${t('Delete this schedule')}</button>` : ''}`;
      },
      extraActions: {
        'toggle-day': (el) => { const fv = m.view; const d = el.dataset.d; fv.state.days = fv.state.days.includes(d) ? fv.state.days.filter((y) => y !== d) : [...fv.state.days, d]; fv.update(); },
        'del-sched': () => {
          m.close();
          confirmDialog({ title: t('Delete this schedule?'), body: t('{time} · {code} · Bus {n}. Existing trips are kept; no new trips will be generated.', { time: fmt12(s.depart_time), code: s.route_code, n: s.bus_number ?? '—' }), confirmLabel: t('Delete'), danger: true,
            onConfirm: async () => { try { await api.del(`/api/admin/schedules/${s.id}`); toast(t('Schedule deleted')); sched.reload(); } catch (e) { toast(e.message, 'error'); } } });
        },
      },
      onSubmit: async (v) => {
        const days = m.view.state.days ?? [...DEFAULT_DAYS];
        if (!days.length) throw new Error(t('Choose at least one day the schedule runs on'));
        const body = { ...v, days };
        if (s.id) await api.put(`/api/admin/schedules/${s.id}`, body); else await api.post('/api/admin/schedules', body);
        toast(t('Schedule saved')); sched.reload();
      },
    });
  }

  function oneOff() {
    openForm({
      title: t('Add one-off trip'),
      fields: [
        { key: 'bus_id', label: t('Bus'), type: 'select-number', required: true, blank: t('Choose…'), options: bOpts() },
        { key: 'route_id', label: t('Route'), type: 'select-number', required: true, blank: t('Choose…'), options: rOpts() },
        { key: 'direction', label: t('Direction'), type: 'select', noBlank: true, options: [{ value: 'to_campus', label: t('To university') }, { value: 'from_campus', label: t('From university') }] },
        { key: 'driver_id', label: t('Driver'), type: 'select-number', blank: t('Bus’s driver'), options: dOpts() },
        { key: 'date', label: t('Date'), type: 'date', required: true, validate: (val) => (val < todayStr() ? t('The date cannot be in the past') : '') }, { key: 'time', label: t('Departure time'), type: 'time', required: true },
        { key: 'outside_limit', label: t('Seats open to other routes'), type: 'number', int: true, min: 0, max: 120, hint: t('Cannot exceed the bus capacity.') }, { key: 'allow_outside', label: t('Allow other routes'), type: 'checkbox' },
      ],
      validate: (v) => {
        const out = {};
        const cap = buses().find((b) => b.id === Number(v.bus_id))?.capacity;
        if (cap != null && v.outside_limit !== '' && Number(v.outside_limit) > cap) out.outside_limit = t('Cannot exceed the bus capacity ({n})', { n: cap });
        return out;
      },
      initial: { date: view.state.date, outside_limit: 10, allow_outside: true, direction: 'to_campus' },
      onSubmit: async (v) => { await api.post('/api/admin/trips', v); toast(t('Trip added')); trips.reload(); },
    });
  }

  function slotManager(direction, time) {
    const route = selRoute();
    const dirTitle = t(DIRECTIONS.find((d) => d.key === direction).title);
    const m = openModal({
      title: `${route.code} · ${fmt12(time)} · ${dirTitle}`,
      onClose: () => { slotView = null; },
      setup: (v) => {
        slotView = v;
        Object.assign(v.state, { busy: false, q: '' });
        const mine = () => (view.state.sched.data?.schedules ?? []).filter((s) => s.route_id === route.id && s.direction === direction && s.depart_time === time);
        const run = async (fn, ok) => {
          v.set({ busy: true });
          try { await fn(); if (ok) toast(ok); await refreshSched(); } catch (e) { toast(e.message, 'error'); } finally { v.set({ busy: false }); }
        };
        const addBus = (b) => api.post('/api/admin/schedules', { route_id: route.id, bus_id: b.id, driver_id: b.driver_id ?? null, depart_time: time, direction, days: DEFAULT_DAYS });
        const info = () => {
          const list = mine();
          const taken = new Set(list.map((s) => s.bus_id));
          const routeBuses = buses().filter((b) => b.route_id === route.id);
          return { list, free: routeBuses.filter((b) => !taken.has(b.id) && b.status !== 'out_of_service'), other: buses().filter((b) => b.route_id !== route.id && !taken.has(b.id) && b.status !== 'out_of_service') };
        };
        return {
          render: () => {
            const { list, free, other } = info();
            const q = v.state.q.trim().toLowerCase();
            const shown = list.filter((s) => (s.bus_number ?? '').toLowerCase().includes(q) || (s.driver_name ?? '').toLowerCase().includes(q));
            const busy = v.state.busy;
            return html`<div class="stack" style="min-width:0">
              <div class="row between" style="flex-wrap:wrap;gap:8px">
                <span class="small muted">${t('{n} on this departure', { n: tn(list.length, '{n} bus', '{n} buses') })}</span>
                ${free.length > 0 ? html`<button type="button" class="btn sm" ${busy ? 'disabled' : ''} data-click="add-all">${t('Add all {code} buses ({n})', { code: route.code, n: free.length })}</button>` : ''}
              </div>
              ${list.length > 6 ? html`<input class="input" type="search" placeholder="${t('Find a bus or driver…')}" aria-label="${t('Find a bus or driver')}" value="${v.state.q}" data-bind="q">` : ''}
              ${list.length === 0 ? empty(t('No buses on this departure'), html`<p>${t('Add the buses that run {code} at {time}.', { code: route.code, time: fmt12(time) })}</p>`) : ''}
              <ul class="slot-list">
                ${shown.map((s) => html`<li data-key="sl-${s.id}" class="${s.active ? '' : 'paused'}">
                  <div class="slot-who"><span class="bus-chip">${s.bus_number ?? '—'}</span><span class="small muted">${s.driver_name ?? t('Bus driver')}${s.active ? '' : ` · ${t('paused')}`}</span></div>
                  <div class="slot-days" role="group" aria-label="${t('Days for bus {n}', { n: s.bus_number })}">
                    ${DAYS.map(([k, l]) => html`<button type="button" ${busy ? 'disabled' : ''} aria-pressed="${bool(s.days.split(',').includes(k))}" data-click="toggle-day" data-id="${s.id}" data-d="${k}" title="${t(l)}">${t(`${l}.short`) === `${l}.short` ? l.slice(0, 2) : t(`${l}.short`)}</button>`)}
                  </div>
                  <div class="slot-act">
                    <button type="button" class="btn sm ghost" ${busy ? 'disabled' : ''} data-click="pause" data-id="${s.id}">${s.active ? t('Pause') : t('Resume')}</button>
                    <button type="button" class="btn sm danger outline" ${busy ? 'disabled' : ''} data-click="remove" data-id="${s.id}">${t('Remove')}</button>
                  </div></li>`)}
                ${list.length > 0 && !shown.length ? html`<li class="small muted">${t('No bus or driver matches “{q}”.', { q: v.state.q })}</li>` : ''}
              </ul>
              <div class="field">
                <label for="slot-add">${t('Add a bus')}</label>
                <select id="slot-add" class="input" ${busy ? 'disabled' : ''} data-change="add-one">
                  <option value="">${t('Choose a bus…')}</option>
                  ${free.length > 0 ? html`<optgroup label="${t('{code} buses', { code: route.code })}">${free.map((b) => html`<option value="${b.id}">${t('Bus {n}', { n: b.number })}</option>`)}</optgroup>` : ''}
                  ${other.length > 0 ? html`<optgroup label="${t('Buses from other routes')}">${other.map((b) => html`<option value="${b.id}">${t('Bus {n}', { n: b.number })} (${b.route_code ?? t('no route')})</option>`)}</optgroup>` : ''}
                </select>
              </div>
              <p class="small muted">${t('New buses run Sunday to Thursday; change the days above. Trips are created from these schedules each day.')}</p>
            </div>`;
          },
          footer: () => html`<button class="btn" data-click="done">${t('Done')}</button>`,
          actions: {
            done: () => m.close(),
            'add-all': () => { const { free } = info(); run(async () => { for (const b of free) await addBus(b); }, t('{n} added', { n: tn(free.length, '{n} bus', '{n} buses') })); },
            'add-one': (el) => { const b = buses().find((x) => x.id === Number(el.value)); el.value = ''; if (b) run(() => addBus(b), t('Bus {n} added', { n: b.number })); },
            'toggle-day': (el) => {
              const s = mine().find((x) => x.id === Number(el.dataset.id)); const d = el.dataset.d;
              const list = s.days.split(','); const next = list.includes(d) ? list.filter((x) => x !== d) : [...list, d];
              if (!next.length) { toast(t('A bus needs at least one day. Remove it instead.'), 'error'); return; }
              run(() => api.put(`/api/admin/schedules/${s.id}`, { days: DAYS.map(([k]) => k).filter((k) => next.includes(k)) }));
            },
            pause: (el) => { const s = mine().find((x) => x.id === Number(el.dataset.id)); run(() => api.put(`/api/admin/schedules/${s.id}`, { active: !s.active })); },
            remove: (el) => { const s = mine().find((x) => x.id === Number(el.dataset.id)); run(() => api.del(`/api/admin/schedules/${s.id}`), t('Bus {n} removed', { n: s.bus_number })); },
          },
        };
      },
    });
  }

  function timetable(d) {
    const rs = routes();
    const route = selRoute();
    if (!route) return empty(t('No routes yet'), html`<p>${t('Create a route first, then build its timetable.')}</p>`);
    const all = d.schedules;
    const mine = all.filter((s) => s.route_id === route.id);
    const routeBuses = buses().filter((b) => b.route_id === route.id);
    return html`<div class="stack">
      <div class="card tint stack">
        <div class="row between" style="flex-wrap:wrap;gap:10px">
          <div><h2 style="margin-bottom:2px">${route.code} · ${route.name}</h2>
            <span class="small muted">${route.active ? t('Active route') : t('Not running')} · ${t('{n} assigned', { n: tn(routeBuses.length, '{n} bus', '{n} buses') })} · ${t('{n} departures a week', { n: mine.length })}</span></div>
          <label class="small" style="display:grid;gap:4px;font-weight:700">${t('Route')}
            <select class="input" data-change="route-pick">${rs.map((r) => html`<option value="${r.id}" ${r.id === route.id ? 'selected' : ''}>${r.code} · ${r.name}${r.active ? '' : ` ${t('(not running)')}`}</option>`)}</select>
          </label>
        </div>
        ${rs.length <= 8 ? html`<div class="seg" role="group" aria-label="${t('Choose a route')}">${rs.map((r) => html`<button aria-pressed="${bool(r.id === route.id)}" data-click="route-btn" data-id="${r.id}">${r.code}</button>`)}</div>` : ''}
      </div>
      ${DIRECTIONS.map((dir) => {
        const rows = mine.filter((s) => s.direction === dir.key);
        const times = [...new Set([...STANDARD_TIMES[dir.key], ...rows.map((s) => s.depart_time)])].sort();
        return html`<section class="card wk" data-key="wk-${dir.key}" aria-label="${t(dir.title)}">
          <div class="card-head">
            <div><h3>${t(dir.title)}</h3><span class="small muted">${t(dir.sub)} · ${t('{n} departures a day', { n: times.length })}</span></div>
            <button type="button" class="btn sm secondary" data-click="add-time" data-dir="${dir.key}">${t('Add another time')}</button>
          </div>
          <div class="table-wrap"><table class="wk-grid">
            <thead><tr><th scope="col">${t('Departs')}</th>${DAYS.map(([k, l]) => html`<th scope="col" class="${k === TODAY_KEY ? 'today' : ''}">${t(l)}${k === TODAY_KEY ? html`<span class="wk-today">${t('Today')}</span>` : ''}</th>`)}<th scope="col">${t('Buses')}</th></tr></thead>
            <tbody>
              ${times.map((tm) => {
                const atSlot = rows.filter((s) => s.depart_time === tm);
                const live = atSlot.filter((s) => s.active);
                return html`<tr data-key="tm-${dir.key}-${tm}">
                  <th scope="row" class="mono" dir="ltr">${fmt12(tm)}</th>
                  ${DAYS.map(([k, l]) => {
                    const n = live.filter((s) => s.days.split(',').includes(k)).length;
                    return html`<td class="${k === TODAY_KEY ? 'today' : ''}"><button type="button" class="wk-count ${n ? '' : 'none'}" data-click="slot" data-dir="${dir.key}" data-time="${tm}"
                      aria-label="${t('{route}, {time}, {day}: {n}. Manage buses', { route: route.code, time: fmt12(tm), day: t(l), n: tn(n, '{n} bus', '{n} buses') })}">${n || '—'}</button></td>`;
                  })}
                  <td><button type="button" class="btn sm secondary" data-click="slot" data-dir="${dir.key}" data-time="${tm}">${atSlot.length ? t('{n} · Manage', { n: tn(atSlot.length, '{n} bus', '{n} buses') }) : t('Assign buses')}</button></td>
                </tr>`;
              })}
            </tbody>
          </table></div>
        </section>`;
      })}
      <p class="small muted">${t('Numbers show how many buses run that departure on that day. Select a number to see and change which buses run it.')}</p>
    </div>`;
  }

  function rowMenu() {
    const m = view.state.menu;
    if (!m) return '';
    const tr = tripById(m.id);
    if (!tr) return '';
    const items = [
      ...(tr.status === 'scheduled' ? [['prep', t('Mark as preparing'), false]] : []),
      ['delay', t('Set delay…'), false], ['edit', t('Edit trip…'), false], ['cancel', t('Cancel trip…'), true],
    ];
    const style = Object.entries(m.pos).map(([k, v]) => `${k}:${v}px`).join(';');
    return html`<div class="menu-scrim" data-click="menu-close"></div>
      <div class="row-menu" role="menu" style="${style}" data-key="row-menu">${items.map(([k, label, danger]) => html`<button type="button" role="menuitem" class="${danger ? 'danger' : ''}" data-click="menu-item" data-k="${k}" ${k === items[0][0] ? 'autofocus' : ''}>${label}</button>`)}</div>`;
  }

  view.listen(window, 'keydown', (e) => { if (e.key === 'Escape' && view.state.menu) view.set({ menu: null }); });
  view.listen(window, 'resize', () => { if (view.state.menu) view.set({ menu: null }); });
  view.listen(window, 'scroll', () => { if (view.state.menu) view.set({ menu: null }); }, true);

  return {
    render: () => {
      const { tab, date } = view.state;
      const actions = tab === 'trips'
        ? html`<button class="btn secondary" data-click="generate">${t('Generate from schedules')}</button><button class="btn" data-click="one-off">${t('Add one-off trip')}</button>`
        : html`<button class="btn secondary" data-click="standard">${t('Load standard timetable')}</button><button class="btn" data-click="add-sched">${t('Add schedule')}</button>`;
      return html`${pageHead(t('Schedules & trips'), t('The weekly timetable shows when buses come to and leave the university each day; trips are the individual runs. Compare the planned departure with what actually happened.'), actions)}
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected="${bool(tab === 'trips')}" data-click="tab" data-k="trips">${t('Trips')}</button>
        <button role="tab" aria-selected="${bool(tab === 'schedules')}" data-click="tab" data-k="schedules">${t('Weekly schedules')}</button>
      </div>
      ${tab === 'trips' ? html`
        <div class="field" style="max-width:220px"><label for="d">${t('Date')}</label><input id="d" type="date" class="input" value="${date}" data-change="date"></div>
        ${asyncBlock(view.state.trips, 'trips', (d) => (d.trips.length ? html`<div class="table-wrap"><table class="t"><thead><tr><th>${t('Planned')}</th><th>${t('Bus')}</th><th>${t('Route')}</th><th>${t('Driver')}</th><th>${t('Actual')}</th><th>${t('Variance')}</th><th>${t('Status')}</th><th>${t('Seats')}</th><th></th></tr></thead><tbody>
          ${d.trips.map((tr) => html`<tr data-key="t-${tr.id}"><td class="mono">${fmtTime(tr.scheduled_departure)}${tr.source === 'demo' ? html`<div class="small muted">${t('demo')}</div>` : ''}</td><td><span class="bus-chip">${tr.bus.number}</span></td><td>${tr.route.code} · ${tr.route.name}${tr.direction ? html`<div class="small muted">${t(DIR_LABEL[tr.direction])}</div>` : ''}</td><td>${tr.driver?.name ?? '—'}</td>
            <td class="mono">${tr.actual_departure ? fmtTime(tr.actual_departure) : '—'}</td>
            <td>${tr.departure_variance_min == null ? (tr.overdue_minutes > 0 ? html`<span class="badge warn">${t('{n} min late', { n: tr.overdue_minutes })}</span>` : '—') : html`<span class="badge ${Math.abs(tr.departure_variance_min) > 5 ? 'warn' : ''}" dir="ltr">${tr.departure_variance_min > 0 ? '+' : ''}${t('{n} min', { n: tr.departure_variance_min })}</span>`}</td>
            <td>${tripStatusBadge(tr)}</td><td>${tr.seats.reserved}/${tr.seats.capacity}</td>
            <td class="actions"><div class="row-actions">
              ${['scheduled', 'preparing'].includes(tr.status) ? html`<button class="btn sm" data-click="status" data-id="${tr.id}" data-s="departed">${t('Depart')}</button>` : ''}
              ${tr.status === 'departed' ? html`<button class="btn sm" data-click="status" data-id="${tr.id}" data-s="completed">${t('Complete')}</button>` : ''}
              ${!['completed', 'cancelled'].includes(tr.status) ? html`<button type="button" class="btn sm secondary more-btn" aria-label="${t('More actions for {time} trip, bus {n}', { time: fmtTime(tr.scheduled_departure), n: tr.bus.number })}" aria-haspopup="menu" aria-expanded="${bool(view.state.menu?.id === tr.id)}" data-click="menu-open" data-id="${tr.id}">⋯</button>` : ''}
            </div></td></tr>`)}
        </tbody></table></div>` : empty(t('No trips on this date'), html`<p>${t('Generate them from the weekly schedules or add a one-off trip.')}</p>`)))}
        ${rowMenu()}` : asyncBlock(view.state.sched, 'sched', (d) => html`
          ${d.schedules.length === 0 ? html`<div class="alert info">${t('No weekly schedule yet. Use “Load standard timetable” to give every route the standard times, or open a departure below and assign buses.')}</div>` : ''}
          ${timetable(d)}`)}`;
    },
    actions: {
      tab: (el) => view.set({ tab: el.dataset.k, menu: null }),
      date: (el) => { if (!el.value) return; view.state.date = el.value; view.update(); trips.reload(); },
      generate,
      'one-off': oneOff,
      standard: () => confirmDialog({ title: t('Load the standard timetable?'), body: t('This replaces every weekly schedule with the standard times: to university 7:15, 8:30, 10:00 AM and from university 1:30, 3:05, 4:45, 6:15 PM, for every route, with all of that route’s buses assigned, Sunday to Thursday. Trips that already exist are kept.'), confirmLabel: t('Replace schedules'), onConfirm: loadStandard }),
      'add-sched': () => scheduleForm({ active: true }),
      status: (el) => status(tripById(el.dataset.id), el.dataset.s),
      'menu-open': (el) => {
        if (view.state.menu?.id === Number(el.dataset.id)) return view.set({ menu: null });
        const r = el.getBoundingClientRect();
        const up = window.innerHeight - r.bottom < 4 * 42 + 20;
        view.set({ menu: { id: Number(el.dataset.id), pos: { ...(isAr() ? { left: Math.max(8, r.left) } : { right: window.innerWidth - r.right }), ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }) } } });
      },
      'menu-close': () => view.set({ menu: null }),
      'menu-item': (el) => {
        const tr = tripById(view.state.menu.id); view.set({ menu: null });
        const k = el.dataset.k;
        if (k === 'prep') status(tr, 'preparing');
        else if (k === 'delay') {
          openForm({ title: t('Delay for {time} · Bus {n}', { time: fmtTime(tr.scheduled_departure), n: tr.bus.number }), submitLabel: t('Apply and notify'), note: t('Students on this route are notified. Set 0 to clear the delay.'),
            fields: [{ key: 'minutes', label: t('Delay (minutes)'), type: 'number', int: true, min: 0, max: 240, required: true, hint: t('0 to 240') }], initial: { minutes: tr.delay_minutes },
            onSubmit: async (v) => { await api.patch(`/api/admin/trips/${tr.id}/delay`, v); toast(t('Delay saved')); trips.refresh(); } });
        } else if (k === 'edit') {
          openForm({ title: t('Edit trip {time} · Bus {n}', { time: fmtTime(tr.scheduled_departure), n: tr.bus.number }),
            fields: [{ key: 'time', label: t('Departure time'), type: 'time', hint: t('Leave unchanged to keep it.') }, { key: 'driver_id', label: t('Responsible driver'), type: 'select-number', blank: t('— none —'), options: dOpts() },
              { key: 'allow_outside', label: t('Allow students from other routes'), type: 'checkbox' }, { key: 'outside_limit', label: t('Seats open to other routes'), type: 'number', int: true, min: 0, max: Math.min(120, tr.seats.capacity), hint: t('0 to {n} (bus capacity)', { n: tr.seats.capacity }) }],
            initial: { driver_id: tr.driver?.id ?? '', allow_outside: tr.allow_outside, outside_limit: tr.outside_limit, time: '' },
            onSubmit: async (v) => { const body = { ...v }; if (!body.time) delete body.time; await api.patch(`/api/admin/trips/${tr.id}`, body); toast(t('Trip updated')); trips.refresh(); } });
        } else if (k === 'cancel') {
          confirmDialog({ title: t('Cancel this trip?'), body: t('{time} · Bus {n}. Reservations are released and students notified.', { time: fmtTime(tr.scheduled_departure), n: tr.bus.number }), confirmLabel: t('Cancel trip'), danger: true, onConfirm: () => status(tr, 'cancelled') });
        }
      },
      'route-pick': (el) => view.set({ routeId: Number(el.value) }),
      'route-btn': (el) => view.set({ routeId: Number(el.dataset.id) }),
      'add-time': (el) => scheduleForm({ active: true, route_id: selRoute().id, direction: el.dataset.dir }),
      slot: (el) => slotManager(el.dataset.dir, el.dataset.time),
    },
  };
}

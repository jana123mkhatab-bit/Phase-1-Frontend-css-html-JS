import { html, bool } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { t, tn } from '../../core/i18n.js';
import { fmtTime, todayStr } from '../../core/format.js';
import { asyncBlock, pageHead, empty, seatBar, tripStatusBadge, toast, confirmDialog, openModal, field } from '../../core/ui.js';
import { openForm } from '../../components/form-modal.js';

const DIR_EN = { to_campus: 'To university', from_campus: 'From university' };
const DIR = (k) => t(DIR_EN[k]);
const BOOKABLE = ['scheduled', 'preparing'];
const norm = (s) => (s ?? '').toString().toLowerCase();
const resBadge = (r) => (r.status === 'confirmed' ? html`<span class="badge live">${t('Confirmed')}</span>` : r.status === 'cancelled' ? html`<span class="badge crit">${t('Cancelled')}</span>` : r.status === 'no_show' ? html`<span class="badge warn">${t('No-show')}</span>` : html`<span class="badge">${t('Completed')}</span>`);

export default function reservations(view, ctx) {
  ctx.setTitle('Reservations & capacity');
  Object.assign(view.state, { date: todayStr(), tripId: null, dir: 'all', routeCode: 'all', q: '', showCancelled: false });
  const cap = view.load('cap', () => api.get(`/api/admin/capacity?date=${view.state.date}`), { ms: 6000 });
  const list = view.load('list', () => api.get(`/api/admin/reservations?${view.state.tripId ? `trip_id=${view.state.tripId}` : `date=${view.state.date}`}`), { ms: 8000 });
  view.load('students', () => api.get('/api/admin/students'));
  const trips = () => view.state.cap.data?.trips ?? [];
  const reload = () => { list.reload(); cap.refresh(); };

  function reserveModal() {
    const bookable = trips().filter((x) => BOOKABLE.includes(x.status));
    openModal({
      title: t('Reserve a seat for a student'),
      setup: (v, m) => {
        Object.assign(v.state, { tripId: bookable.find((x) => x.id === view.state.tripId)?.id ?? bookable[0]?.id ?? '', q: '', pick: null, note: '', busy: false });
        m.canClose = () => !v.state.busy;
        return {
          render: () => {
            const students = view.state.students.data?.students ?? [];
            const loading = view.state.students.loading && !view.state.students.data;
            const q = v.state.q;
            const matches = (q.trim() ? students.filter((s) => [s.name, s.student_no, s.email].some((x) => norm(x).includes(norm(q.trim())))) : students).slice(0, 8);
            return html`<div class="stack">
              <p class="small muted">${t('Administrator reservations can use seats held for the trip’s own route, but never exceed the bus capacity.')}</p>
              <div class="field"><label for="rt-trip">${t('Trip')}</label>
                <select id="rt-trip" class="input" data-bind="tripId">${bookable.map((tr) => html`<option value="${tr.id}" ${String(v.state.tripId) === String(tr.id) ? 'selected' : ''}>${fmtTime(tr.scheduled_departure)} · ${t('Bus {n}', { n: tr.bus.number })} · ${tr.route.code}${tr.direction ? ` · ${DIR(tr.direction)}` : ''} (${t('{n} free', { n: tr.seats.available })})</option>`)}</select></div>
              <div class="field"><label for="rs">${t('Student')}</label>
                <input id="rs" type="search" class="input" autocomplete="off" placeholder="${t('Search by name, student number or email…')}" value="${q}" data-bind="q" data-input="clear-pick"></div>
              ${loading ? html`<p class="small muted">${t('Loading students…')}</p>` : matches.length === 0 ? html`<p class="small muted">${t('No student matches “{q}”.', { q })}</p>` : html`<ul class="stu-list" aria-label="${t('Students')}">
                ${matches.map((s) => html`<li data-key="stu-${s.id}"><button type="button" aria-pressed="${bool(v.state.pick?.id === s.id)}" data-click="pick" data-id="${s.id}"><b>${s.name}</b><span class="small muted">${s.student_no ? `#${s.student_no} · ` : ''}${s.email}${s.route_code ? ` · ${s.route_code}` : ''}</span></button></li>`)}
              </ul>`}
              <div class="field"><label for="rn">${t('Note (optional)')}</label><input id="rn" class="input" maxlength="200" value="${v.state.note}" data-bind="note"></div>
            </div>`;
          },
          footer: () => html`<button class="btn secondary" data-click="cancel" ${v.state.busy ? 'disabled' : ''}>${t('Cancel')}</button><button class="btn" data-click="submit" ${v.state.busy || !v.state.pick || !v.state.tripId ? 'disabled' : ''}>${v.state.busy ? t('Reserving…') : v.state.pick ? t('Reserve for {name}', { name: v.state.pick.name }) : t('Reserve')}</button>`,
          actions: {
            'clear-pick': () => { v.state.pick = null; },
            pick: (el) => v.set({ pick: (view.state.students.data?.students ?? []).find((s) => s.id === Number(el.dataset.id)) }),
            cancel: () => m.close(),
            submit: async () => {
              v.set({ busy: true });
              try { await api.post('/api/admin/reservations', { trip_id: Number(v.state.tripId), user_id: v.state.pick.id, ...(v.state.note.trim() ? { note: v.state.note.trim() } : {}) }); toast(t('Seat reserved')); reload(); m.close(); }
              catch (e) { toast(e.message, 'error'); v.set({ busy: false }); }
            },
          },
        };
      },
    });
  }

  return {
    render: () => {
      const { date, tripId, dir, routeCode, q, showCancelled } = view.state;
      const all = trips();
      const routeCodes = [...new Set(all.map((x) => x.route.code))].sort();
      const shown = all.filter((x) => (dir === 'all' || x.direction === dir) && (routeCode === 'all' || x.route.code === routeCode));
      const trip = all.find((x) => x.id === tripId) ?? null;
      const rows = (view.state.list.data?.reservations ?? []).filter((r) => (showCancelled || r.status !== 'cancelled') && (!q.trim() || [r.student_name, r.student_no, r.student_email, r.bus_number].some((x) => norm(x).includes(norm(q.trim())))));
      const totals = all.reduce((a, x) => ({ cap: a.cap + x.seats.capacity, res: a.res + x.seats.reserved, out: a.out + x.seats.outside_reserved }), { cap: 0, res: 0, out: 0 });

      return html`${pageHead(t('Reservations & capacity'), t('Pick a trip to see exactly which students have a seat on it. Control how many seats students from other routes may take.'), html`<button class="btn" data-click="add" ${!all.some((x) => BOOKABLE.includes(x.status)) ? 'disabled' : ''}>${t('Reserve for a student')}</button>`)}
      <div class="card tint stack">
        <div class="res-bar">
          <div class="field"><label for="d">${t('Date')}</label><input id="d" type="date" class="input" value="${date}" data-change="date"></div>
          <div class="field"><label>${t('Direction')}</label>
            <div class="seg" role="group" aria-label="${t('Direction')}">
              ${[['all', 'All'], ['to_campus', 'To university'], ['from_campus', 'From university']].map(([k, l]) => html`<button aria-pressed="${bool(dir === k)}" data-click="dir" data-k="${k}">${t(l)}</button>`)}
            </div></div>
          <div class="field"><label>${t('Route')}</label>
            <div class="seg" role="group" aria-label="${t('Route')}">
              <button aria-pressed="${bool(routeCode === 'all')}" data-click="rc" data-k="all">${t('All')}</button>
              ${routeCodes.map((c) => html`<button aria-pressed="${bool(routeCode === c)}" data-click="rc" data-k="${c}">${c}</button>`)}
            </div></div>
          <div class="field res-search"><label for="rq">${t('Find a student')}</label><input id="rq" type="search" class="input" placeholder="${t('Name, student number or email…')}" value="${q}" data-bind="q"></div>
        </div>
        <dl class="res-stats">
          <div><dt>${t('Trips')}</dt><dd>${all.length}</dd></div>
          <div><dt>${t('Seats reserved')}</dt><dd>${totals.res}<span class="muted"> / ${totals.cap}</span></dd></div>
          <div><dt>${t('From other routes')}</dt><dd>${totals.out}</dd></div>
        </dl>
      </div>

      ${asyncBlock(view.state.cap, 'cap', () => (all.length === 0 ? empty(t('No trips on this date'), html`<p>${t('Generate trips from the weekly schedules on the Schedules page.')}</p>`) : html`
        <div class="res-split">
          <section class="card res-trips" aria-label="${t('Trips')}">
            <div class="card-head"><h2>${t('Trips')}</h2><span class="small muted">${t('{n} shown', { n: shown.length })}</span></div>
            ${shown.length === 0 ? html`<p class="small muted">${t('No trips match these filters.')}</p>` : ''}
            <ul class="trip-pick">
              ${shown.map((tr) => {
                const pct = tr.seats.capacity ? Math.min(100, (tr.seats.reserved / tr.seats.capacity) * 100) : 0;
                return html`<li data-key="tp-${tr.id}">
                  <button type="button" aria-pressed="${bool(tr.id === tripId)}" class="tp ${tr.seats.available === 0 ? 'full' : ''}" data-click="pick-trip" data-id="${tr.id}">
                    <span class="mono tp-time">${fmtTime(tr.scheduled_departure)}</span>
                    <span class="tp-main"><span><span class="bus-chip">${tr.bus.number}</span> <b>${tr.route.code}</b> <span class="small muted">${tr.direction ? DIR(tr.direction) : tr.route.name}</span></span>
                      <span class="tp-bar" aria-hidden="true"><i style="width:${pct}%"></i></span></span>
                    <span class="tp-count mono">${tr.seats.reserved}/${tr.seats.capacity}</span>
                  </button>
                </li>`;
              })}
            </ul>
          </section>

          <section class="card stack res-detail" aria-label="${t('Students')}">
            ${trip ? html`
              <div class="card-head">
                <div><h2>${fmtTime(trip.scheduled_departure)} · ${t('Bus {n}', { n: trip.bus.number })} · ${trip.route.code} ${trip.route.name}</h2><span class="small muted">${trip.direction ? DIR(trip.direction) : t('Round trip')}</span></div>
                ${tripStatusBadge({ ...trip, expected_departure: trip.scheduled_departure })}
              </div>
              ${seatBar(trip.seats)}
              <div class="row between" style="flex-wrap:wrap;gap:8px">
                <span class="small">${t('Other routes:')} <b>${trip.allow_outside ? t('up to {n} seats ({u} used)', { n: trip.outside_limit, u: trip.seats.outside_reserved }) : t('closed')}</b></span>
                <div class="row">
                  ${BOOKABLE.includes(trip.status) ? html`<button class="btn sm" data-click="add">${t('Reserve for a student')}</button><button class="btn sm secondary" data-click="policy">${t('Outside-route rules')}</button>` : ''}
                  <button class="btn sm ghost" data-click="whole-day">${t('Show whole day')}</button>
                </div>
              </div>` : html`<div class="card-head"><div><h2>${t('All reservations on {date}', { date })}</h2><span class="small muted">${t('Select a trip on the left to see only its students.')}</span></div></div>`}

            <label class="check small"><input type="checkbox" data-bind="showCancelled" ${showCancelled ? 'checked' : ''}>${t('Show cancelled reservations')}</label>

            ${asyncBlock(view.state.list, 'list', () => (rows.length === 0
              ? empty(q ? t('No student matches') : trip ? t('No students on this trip yet') : t('No reservations on this date'), html`<p>${q ? t('Try a different name or student number.') : trip ? t('Reserved seats will list the student here.') : t('Students’ reservations will appear here.')}</p>`)
              : html`<div class="table-wrap"><table class="t res-table"><thead><tr><th>${t('Student')}</th>${!trip ? html`<th>${t('Trip')}</th>` : ''}<th>${t('Boarding at')}</th><th>${t('Type')}</th><th>${t('Status')}</th><th></th></tr></thead><tbody>
                ${rows.map((r) => html`<tr data-key="rv-${r.id}" class="${r.status === 'cancelled' ? 'dim' : ''}">
                  <td><b>${r.student_name}</b><div class="small muted">${r.student_no ? `#${r.student_no} · ` : ''}${r.student_email}</div></td>
                  ${!trip ? html`<td><span class="mono">${fmtTime(r.scheduled_departure)}</span> · ${t('Bus {n}', { n: r.bus_number })}<div class="small muted">${r.route_code}${r.direction ? ` · ${DIR(r.direction)}` : ''}</div></td>` : ''}
                  <td>${r.stop_name ?? '—'}</td>
                  <td>${r.outside_route ? html`<span class="badge sky">${t('Other route')}${r.student_route_code ? ` (${r.student_route_code})` : ''}</span>` : t('Own route')}${r.made_by === 'admin' ? html`<span class="badge navy" style="margin-inline-start:6px">${t('By admin')}</span>` : ''}${r.note ? html`<div class="small muted">${r.note}</div>` : ''}</td>
                  <td>${resBadge(r)}</td>
                  <td class="actions">${r.status === 'confirmed' ? html`<button class="btn sm danger outline" data-click="cancel" data-id="${r.id}">${t('Cancel')}</button>` : ''}</td>
                </tr>`)}
              </tbody></table></div>`))}
            <p class="small muted">${t('{n} shown.', { n: tn(rows.length, '{n} reservation', '{n} reservations') })}</p>
          </section>
        </div>`))}`;
    },
    actions: {
      add: reserveModal,
      date: (el) => { if (!el.value) return; view.state.date = el.value; view.state.tripId = null; view.update(); cap.reload(); list.reload(); },
      dir: (el) => view.set({ dir: el.dataset.k }),
      rc: (el) => view.set({ routeCode: el.dataset.k }),
      'pick-trip': (el) => { const id = Number(el.dataset.id); view.state.tripId = view.state.tripId === id ? null : id; view.update(); list.reload(); },
      'whole-day': () => { view.state.tripId = null; view.update(); list.reload(); },
      cancel: (el) => {
        const r = view.state.list.data.reservations.find((x) => x.id === Number(el.dataset.id));
        confirmDialog({ title: t('Cancel this reservation?'), body: t('{name}’s seat on bus {n} ({time}) will be released and the student notified.', { name: r.student_name, n: r.bus_number, time: fmtTime(r.scheduled_departure) }), confirmLabel: t('Cancel reservation'), danger: true,
          onConfirm: async () => { try { await api.del(`/api/admin/reservations/${r.id}`); toast(t('Reservation cancelled')); reload(); } catch (e) { toast(e.message, 'error'); } } });
      },
      policy: () => {
        const p = trips().find((x) => x.id === view.state.tripId);
        openForm({
          title: t('Outside-route seats, bus {n}', { n: p.bus.number }),
          fields: [{ key: 'allow_outside', label: t('Allow students from other routes'), type: 'checkbox' }, { key: 'outside_limit', label: t('Maximum seats for other routes'), type: 'number', int: true, min: 0, max: Math.min(120, p.seats.capacity), hint: t('0 to {n} (bus capacity)', { n: p.seats.capacity }) }],
          initial: { allow_outside: p.allow_outside, outside_limit: p.outside_limit },
          onSubmit: async (v) => { await api.patch(`/api/admin/trips/${p.id}`, v); toast(t('Rules saved')); cap.refresh(); },
        });
      },
    },
  };
}

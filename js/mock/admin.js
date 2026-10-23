// Admin endpoints of the mock backend. Shapes and validation messages follow the real API.
import { S, nextId } from './state.js';
import {
  MockError, bad, notFound, conflict, str, int, num, oneOf, bool, hhmm, nowIso, iso, ymd, dayKey, hmOf, MIN, dayNo, dateOfDayNo, parseYmd, median, hash,
} from './util.js';
import { validCoord } from './geo.js';
import {
  tripView, describe, resolve, busOf, routeOf, stopOf, driverOf, userOf, busRow, tripsOnDate, timetableTripsOn, currentTripOfBus, seatInfo, tripPct, liveBoard, slotPct,
} from './trips.js';
import {
  publicUser, requireRole, audit, notify, activeUpdates, announceServiceUpdate, announceTrip, announceDelay, routeFull, exists, unreadCount,
} from './common.js';
import { reserve, cancelReservation } from './student.js';

const BUS_STATUS = ['active', 'waiting', 'on_trip', 'delayed', 'out_of_service'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const CATS = ['bank', 'pharmacy', 'printing', 'food', 'registrar', 'library', 'clinic', 'worship', 'building', 'shop', 'other'];
const dateStr = (v, name) => { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad(`${name} must be YYYY-MM-DD`); return v; };
const A = () => requireRole('admin');
const round1 = (n) => Math.round(n * 10) / 10;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const TRANSITIONS = { scheduled: ['preparing', 'departed', 'cancelled'], preparing: ['departed', 'cancelled', 'scheduled'], departed: ['completed', 'cancelled'], completed: [], cancelled: [] };

// ---------------------------------------------------------------- trips
function setTripStatus(id, next, actor, now) {
  const d = describe(id);
  if (!d) throw notFound('Trip not found');
  const cur = resolve(d, now).status;
  if (cur === next) return;
  if (!TRANSITIONS[cur].includes(next)) throw conflict(`Cannot change a ${cur} trip to ${next}`);
  const bus = busOf(d.bus_id);
  if ((next === 'preparing' || next === 'departed') && bus.status === 'out_of_service') throw conflict('Bus is out of service');
  const ov = (S.tripOv[id] ??= {});
  if (next === 'departed') {
    if (S.buses.some((b) => b.id === bus.id && b.status !== 'out_of_service') && liveOtherTrip(bus, id, now)) throw conflict(`Bus ${bus.number} is already on another trip`);
    ov.departed_at = now; delete ov.status;
  } else if (next === 'completed') {
    ov.status = 'completed'; ov.completed_at = now;
    for (const r of S.reservations) if (r.trip_id === id && r.status === 'confirmed') r.status = 'completed';
  } else if (next === 'cancelled') {
    ov.status = 'cancelled'; ov.completed_at = now;
    for (const r of S.reservations) if (r.trip_id === id && r.status === 'confirmed') { r.status = 'cancelled'; r.cancelled_at = nowIso(); r.cancelled_by = 'system'; }
  } else if (next === 'preparing') { ov.status = 'preparing'; } else { delete ov.status; delete ov.departed_at; }
  if (actor) audit(actor, `trip.${next}`, 'trip', id, `Bus ${bus.number}`);
  announceTrip(d, next, now);
}
function liveOtherTrip(bus, exceptId, now) {
  return liveBoard(now).some((t) => t.status === 'departed' && t.bus.id === bus.id && t.id !== exceptId);
}
const adminTrip = (d, now) => {
  const v = tripView(d, now);
  const r = resolve(d, now);
  return { ...v, departure_variance_min: r.actual ? Math.round((r.actual - d.nominal) / MIN) : null };
};

// ---------------------------------------------------------------- capacity optimiser + reports (over the generated timetable history)
const OPT = { addAbovePct: 90, addShare: 0.5, addMinWeeks: 4, removeBelowPct: 25, removeShare: 0.5, removeMinWeeks: 6, minHistoryWeeks: 4, maxWeeks: 8, defaultWeeks: 8, addOffsetMin: 15 };
function pastTrips(weeks, routeId, now) {
  const today = dayNo(ymd(new Date(now)));
  const out = [];
  for (let n = today - weeks * 7; n < today; n += 1) {
    for (const d of timetableTripsOn(dateOfDayNo(n))) {
      if (routeId != null && d.route_id !== routeId) continue;
      const r = resolve(d, now);
      if (!['completed', 'cancelled'].includes(r.status)) continue;
      const bus = busOf(d.bus_id);
      const booked = Math.round((bus.capacity * tripPct(d)) / 100) + S.reservations.filter((x) => x.trip_id === d.id && ['confirmed', 'completed'].includes(x.status)).length;
      out.push({ d, r, route: routeOf(d.route_id), capacity: bus.capacity, booked: Math.min(bus.capacity, booked) });
    }
  }
  return out;
}
function optimise({ routeId = null, weeks = OPT.defaultWeeks }, now) {
  const w = Math.min(OPT.maxWeeks, Math.max(OPT.minHistoryWeeks, Number(weeks) || OPT.defaultWeeks));
  const rows = pastTrips(w, routeId, now);
  const dates = new Set(rows.filter((x) => x.r.status === 'completed').map((x) => x.d.service_date));
  const weeksHave = new Set([...dates].map((dt) => Math.floor(parseYmd(dt).getTime() / (7 * 86400000)))).size;
  if (weeksHave < OPT.minHistoryWeeks) return { suggestions: [], reason: 'not_enough_history', weeks_have: weeksHave, weeks_needed: OPT.minHistoryWeeks, weeks_missing: OPT.minHistoryWeeks - weeksHave };
  const slots = new Map();
  for (const x of rows) {
    const wd = parseYmd(x.d.service_date).getDay(); const time = hmOf(x.d.nominal);
    const key = `${x.d.route_id}|${wd}|${time}`;
    const s = slots.get(key) ?? { route_id: x.d.route_id, route: `${x.route.code} ${x.route.name}`, weekday: wd, time, trips: [], cancelled: 0, delayed: 0, capacity: 0 };
    if (x.r.status === 'cancelled') s.cancelled += 1;
    else {
      s.trips.push({ date: x.d.service_date, booked: x.booked, capacity: x.capacity, pct: x.capacity ? (x.booked / x.capacity) * 100 : 0 });
      if (x.r.delay > 0) s.delayed += 1;
      s.capacity = Math.max(s.capacity, x.capacity);
    }
    slots.set(key, s);
  }
  const out = [];
  for (const s of slots.values()) {
    const n = s.trips.length;
    if (!n) continue;
    s.trips.sort((a, b) => a.date.localeCompare(b.date));
    const above = s.trips.filter((x) => x.pct > OPT.addAbovePct).length; const below = s.trips.filter((x) => x.pct < OPT.removeBelowPct).length;
    const avg = s.trips.reduce((a, x) => a + x.pct, 0) / n;
    const common = {
      route_id: s.route_id, route: s.route, weekday: s.weekday, weekday_name: WEEKDAY_NAMES[s.weekday], time: s.time, weeks: n, avg_occupancy_pct: round1(avg),
      above_90_pct: Math.round((above / n) * 100), below_25_pct: Math.round((below / n) * 100), cancel_rate_pct: Math.round((s.cancelled / (n + s.cancelled)) * 100), delay_rate_pct: Math.round((s.delayed / n) * 100),
      evidence: s.trips.map((x) => ({ date: x.date, booked: x.booked, capacity: x.capacity, pct: Math.round(x.pct) })), spark: s.trips.map((x) => Math.round(x.pct)),
    };
    if (n >= OPT.addMinWeeks && above / n >= OPT.addShare) out.push({ ...common, type: 'add', key: `add:${s.route_id}:${s.weekday}:${s.time}`, impact_seats_per_week: s.capacity, sentence: `${s.route} on ${WEEKDAY_NAMES[s.weekday]}s at ${s.time} was more than ${OPT.addAbovePct}% booked in ${above} of ${n} weeks (average ${round1(avg)}%).` });
    else if (n >= OPT.removeMinWeeks && below / n >= OPT.removeShare) out.push({ ...common, type: 'remove', key: `remove:${s.route_id}:${s.weekday}:${s.time}`, impact_seats_per_week: -s.capacity, sentence: `${s.route} on ${WEEKDAY_NAMES[s.weekday]}s at ${s.time} was less than ${OPT.removeBelowPct}% booked in ${below} of ${n} weeks (average ${round1(avg)}%).` });
  }
  out.sort((a, b) => (a.type === b.type ? b.weeks - a.weeks : a.type === 'add' ? -1 : 1) || a.route.localeCompare(b.route) || a.weekday - b.weekday || a.time.localeCompare(b.time));
  return { suggestions: out, weeks_have: weeksHave, weeks_needed: OPT.minHistoryWeeks };
}
const proposedTime = (time) => { const m = Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) + OPT.addOffsetMin; return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

function buildReport(from, to, { routeId = null, busId = null }, now) {
  const trips = [];
  const a = dayNo(from); const b = dayNo(to);
  for (let n = a; n <= Math.min(b, a + 92); n += 1) {
    for (const d of timetableTripsOn(dateOfDayNo(n))) {
      if ((routeId != null && d.route_id !== routeId) || (busId != null && d.bus_id !== busId)) continue;
      const r = resolve(d, now); const bus = busOf(d.bus_id);
      const seats = r.status === 'cancelled' ? 0 : Math.min(bus.capacity, seatInfo(d, bus, r.status).reserved);
      trips.push({ d, r, bus, seats, cancelledRes: r.status === 'cancelled' ? Math.round((bus.capacity * tripPct(d)) / 100) : (hash(d.id) % 4 === 0 ? 1 : 0) });
    }
  }
  const count = (xs, f) => xs.filter(f).length;
  const group = (key) => { const m = new Map(); for (const t of trips) m.set(key(t), (m.get(key(t)) ?? 0) + 1); return [...m].map(([status, c]) => ({ status, count: c })); };
  const tripsByStatus = group((t) => t.r.status);
  const resActive = sum(trips.map((t) => t.seats)); const resCancelled = sum(trips.map((t) => t.cancelledRes));
  const resByStatus = [];
  const resDone = sum(trips.filter((t) => t.r.status === 'completed').map((t) => t.seats)); const resConf = sum(trips.filter((t) => ['scheduled', 'preparing', 'departed'].includes(t.r.status)).map((t) => t.seats));
  if (resDone) resByStatus.push({ status: 'completed', count: resDone });
  if (resConf) resByStatus.push({ status: 'confirmed', count: resConf });
  if (resCancelled) resByStatus.push({ status: 'cancelled', count: resCancelled });
  const agg = (list) => ({ trips: list.length, completed: list.length ? count(list, (t) => t.r.status === 'completed') : null, cancelled: list.length ? count(list, (t) => t.r.status === 'cancelled') : null, delayed_trips: list.length ? count(list, (t) => t.r.delay > 0) : null });
  const delays = (list) => { const x = list.filter((t) => t.r.delay > 0).map((t) => t.r.delay); return x.length ? round1(sum(x) / x.length) : null; };
  const routes = S.routes.filter((r) => routeId == null || r.id === routeId).sort((x, y) => x.code.localeCompare(y.code)).map((r) => {
    const list = trips.filter((t) => t.d.route_id === r.id);
    return { id: r.id, code: r.code, name: r.name, ...agg(list), avg_delay_min: delays(list), reservations: sum(list.map((t) => t.seats)) };
  });
  const buses = S.buses.filter((x) => busId == null || x.id === busId).sort((x, y) => x.number.localeCompare(y.number)).map((x) => {
    const list = trips.filter((t) => t.d.bus_id === x.id);
    const g = agg(list); const reserved = sum(list.map((t) => t.seats)); const offered = (g.trips - (g.cancelled || 0)) * x.capacity;
    return { id: x.id, number: x.number, capacity: x.capacity, ...g, seats_reserved: reserved, utilisation_pct: offered > 0 ? Math.round((reserved / offered) * 1000) / 10 : null };
  });
  const byDate = new Map();
  for (const t of trips) { const k = t.d.service_date; const e = byDate.get(k) ?? { date: k, trips: 0, cancelled: 0, delayed: 0, reservations: 0 }; e.trips += 1; e.cancelled += t.r.status === 'cancelled' ? 1 : 0; e.delayed += t.r.delay > 0 ? 1 : 0; e.reservations += t.seats; byDate.set(k, e); }
  const inRange = (isoStr) => { const day = isoStr.slice(0, 10); return day >= from && day <= to; };
  const grp = (rows, k) => { const m = new Map(); for (const r of rows) m.set(r[k], (m.get(r[k]) ?? 0) + 1); return [...m].map(([key, c]) => ({ [k]: key, count: c })); };
  const updates = busId != null ? [] : grp(S.updates.filter((u) => inRange(u.created_at) && (routeId == null || u.route_id === routeId)), 'kind');
  const issues = busId != null ? [] : grp(S.issues.filter((i) => inRange(i.created_at) && (routeId == null || i.route_id === routeId)), 'status');
  const delayedList = trips.filter((t) => t.r.delay > 0);
  return {
    range: { from, to }, filters: { route_id: routeId, bus_id: busId },
    summary: { trips: trips.length, completed: count(trips, (t) => t.r.status === 'completed'), cancelled: count(trips, (t) => t.r.status === 'cancelled'), delayed_trips: delayedList.length, avg_delay_min: delays(trips), reservations_active: resActive, reservations_cancelled: resCancelled, issues: sum(issues.map((x) => x.count)), updates: sum(updates.map((x) => x.count)) },
    tripsByStatus, resByStatus, routes, buses, daily: [...byDate.values()].sort((x, y) => x.date.localeCompare(y.date)), updates, issues,
  };
}

// ---------------------------------------------------------------- validation bodies
function placeBody(b, cur = {}) {
  const lat = b.lat === '' || b.lat == null ? (b.lat === undefined ? cur.lat ?? null : null) : num(b.lat, 'Latitude', { min: -90, max: 90 });
  const lng = b.lng === '' || b.lng == null ? (b.lng === undefined ? cur.lng ?? null : null) : num(b.lng, 'Longitude', { min: -180, max: 180 });
  if ((lat == null) !== (lng == null)) throw bad('Enter both latitude and longitude, or neither');
  if (lat != null && !validCoord(lat, lng)) throw bad('Invalid coordinates');
  const days = b.closed_days === undefined ? cur.closed_days ?? null : (Array.isArray(b.closed_days) ? b.closed_days : String(b.closed_days || '').split(',').filter(Boolean));
  if (Array.isArray(days) && days.some((d) => !DAYS.includes(d))) throw bad('Closed days are not valid');
  const opt = (k) => (b[k] === undefined ? cur[k] ?? null : b[k] === '' || b[k] == null ? null : hhmm(b[k], k === 'opens' ? 'Opening time' : 'Closing time'));
  const opens = opt('opens'); const closes = opt('closes');
  if ((opens == null) !== (closes == null)) throw bad('Enter both opening and closing time, or neither');
  return {
    name_en: str(b.name_en ?? cur.name_en, 'English name', { max: 80 }), name_ar: str(b.name_ar ?? cur.name_ar ?? '', 'Arabic name', { max: 80, optional: true }) ?? '',
    area: oneOf(b.area ?? cur.area ?? 'off_campus', 'Area', ['campus', 'off_campus']), category: oneOf(b.category ?? cur.category ?? 'other', 'Category', CATS), lat, lng,
    walk_min_from_campus_stop: b.walk_min_from_campus_stop === undefined ? cur.walk_min_from_campus_stop ?? null : int(b.walk_min_from_campus_stop, 'Walk minutes', { min: 0, max: 60, optional: true }),
    default_stay_min: b.default_stay_min === undefined ? cur.default_stay_min ?? 15 : int(b.default_stay_min, 'Default stay', { min: 1, max: 240 }),
    opens, closes, closed_days: Array.isArray(days) ? (days.join(',') || null) : days, active: b.active === undefined ? cur.active ?? 1 : bool(b.active),
  };
}
function busBody(b, cur = {}) {
  const number = str(b.number ?? cur.number, 'Bus number', { max: 20 });
  const capacity = int(b.capacity ?? cur.capacity, 'Capacity', { min: 1, max: 120 });
  const driver_id = b.driver_id === undefined ? cur.driver_id ?? null : int(b.driver_id, 'Driver', { optional: true });
  const route_id = b.route_id === undefined ? cur.route_id ?? null : int(b.route_id, 'Route', { optional: true });
  const status = oneOf(b.status ?? cur.status ?? 'waiting', 'Status', BUS_STATUS);
  const plate = b.plate === undefined ? cur.plate ?? null : str(b.plate, 'Plate', { max: 20, optional: true });
  const status_note = b.status_note === undefined ? cur.status_note ?? null : str(b.status_note, 'Note', { max: 200, optional: true });
  if (driver_id != null) { const d = exists(S.drivers, driver_id, 'Driver'); if (!d.active) throw bad('Driver is inactive'); }
  if (route_id != null) exists(S.routes, route_id, 'Route');
  return { number, capacity, driver_id, route_id, status, plate, status_note };
}
function routeBody(b, cur = {}) {
  return {
    code: str(b.code ?? cur.code, 'Route code', { max: 12 }).toUpperCase(), name: str(b.name ?? cur.name, 'Route name', { max: 60 }),
    area: b.area === undefined ? cur.area ?? null : str(b.area, 'Area', { max: 60, optional: true }), active: b.active === undefined ? cur.active ?? 1 : bool(b.active),
    avg_speed_kmh: num(b.avg_speed_kmh ?? cur.avg_speed_kmh ?? 28, 'Average speed', { min: 5, max: 90 }),
  };
}
function stopBody(b, cur = {}) {
  const lat = num(b.lat ?? cur.lat, 'Latitude', { min: -90, max: 90 }); const lng = num(b.lng ?? cur.lng, 'Longitude', { min: -180, max: 180 });
  if (!validCoord(lat, lng)) throw bad('Invalid coordinates');
  return { name: str(b.name ?? cur.name, 'Name', { max: 80 }), lat, lng, area: b.area === undefined ? cur.area ?? null : str(b.area, 'Area', { max: 60, optional: true }), active: b.active === undefined ? cur.active ?? 1 : bool(b.active) };
}
function normalizeLicense(lic) {
  return typeof lic === 'string' ? lic.trim().toLowerCase() : '';
}
function checkUniqueLicense(lic, excludeId = 0) {
  const norm = normalizeLicense(lic);
  if (!norm) return;
  const match = S.drivers.find((d) => d.id !== excludeId && normalizeLicense(d.license_no) === norm);
  if (match) {
    throw conflict('This license number is already assigned to another driver. Please enter a unique license number.');
  }
}
function driverBody(b, cur = {}) {
  const license_no = b.license_no === undefined ? cur.license_no ?? null : str(b.license_no, 'License number', { max: 30, optional: true });
  checkUniqueLicense(license_no, cur.id || 0);
  return {
    name: str(b.name ?? cur.name, 'Name', { max: 80 }), phone: b.phone === undefined ? cur.phone ?? null : str(b.phone, 'Phone', { max: 30, optional: true }),
    license_no, active: b.active === undefined ? cur.active ?? 1 : bool(b.active),
  };
}
function schedBody(b, cur = {}) {
  const route_id = int(b.route_id ?? cur.route_id, 'Route');
  const bus_id = b.bus_id === undefined ? cur.bus_id ?? null : int(b.bus_id, 'Bus', { optional: true });
  const driver_id = b.driver_id === undefined ? cur.driver_id ?? null : int(b.driver_id, 'Driver', { optional: true });
  exists(S.routes, route_id, 'Route');
  if (bus_id != null) exists(S.buses, bus_id, 'Bus');
  if (driver_id != null) exists(S.drivers, driver_id, 'Driver');
  let days = b.days ?? cur.days ?? 'sun,mon,tue,wed,thu';
  if (Array.isArray(days)) days = days.join(',');
  const list = String(days).split(',').filter(Boolean);
  if (!list.length || list.some((d) => !DAYS.includes(d))) throw bad('Choose at least one valid day');
  const depart_time = hhmm(b.depart_time ?? cur.depart_time, 'Departure time');
  const given = b.direction ?? cur.direction;
  const direction = given ? oneOf(given, 'Direction', ['to_campus', 'from_campus']) : (depart_time < '12:00' ? 'to_campus' : 'from_campus');
  return { route_id, bus_id, driver_id, depart_time, direction, days: [...new Set(list)].join(','), active: b.active === undefined ? cur.active ?? 1 : bool(b.active) };
}
const checkClash = (v, selfId = 0) => {
  if (v.bus_id == null) return;
  if (S.schedules.some((s) => s.bus_id === v.bus_id && s.depart_time === v.depart_time && s.id !== selfId && s.active) && v.active) throw conflict('This bus already has a schedule at that time');
};
const schedRow = (s) => ({ ...s, route_code: routeOf(s.route_id)?.code, route_name: routeOf(s.route_id)?.name, bus_number: busOf(s.bus_id)?.number ?? null, driver_name: driverOf(s.driver_id)?.name ?? null });

export function register(route) {
  // ---------------- auth ----------------
  route('POST', '/api/admin/auth/login', ({ body }) => {
    const email = String(body?.email ?? '').trim().toLowerCase();
    const u = S.users.find((x) => x.role === 'admin' && x.email === email && x.active);
    if (!u || u.password !== body?.password) throw new MockError(401, 'Invalid email or password');
    S.sessions.admin = u.id; audit(u, 'admin.login', 'user', u.id);
    return { user: publicUser(u) };
  });
  route('POST', '/api/admin/auth/logout', () => { S.sessions.admin = null; return { ok: true }; });
  route('GET', '/api/admin/auth/me', () => ({ user: publicUser(A()), mail: { provider: 'outbox' } }));
  const changePw = ({ body }) => {
    const u = A();
    if (typeof body?.current_password !== 'string' || !body.current_password || typeof body?.new_password !== 'string' || !body.new_password) throw bad('Current password and new password are required');
    if (body.current_password !== u.password) throw new MockError(401, 'Current password is incorrect');
    if (body.new_password.length < 8) throw bad('Password must be at least 8 characters');
    if (!/[A-Za-z]/.test(body.new_password) || !/\d/.test(body.new_password)) throw bad('Password must contain letters and numbers');
    u.password = body.new_password; audit(u, 'user.change_password', 'user', u.id);
    return { ok: true, message: 'Password updated successfully' };
  };
  route('POST', '/api/admin/auth/change-password', changePw);
  route('PUT', '/api/admin/auth/password', changePw);

  // ---------------- anomalies, eta accuracy, outbox ----------------
  const anomalyRow = (a) => { const bus = busOf(a.bus_id); const r = routeOf(bus?.route_id); return { ...a, bus_number: bus?.number ?? null, route_id: r?.id ?? null, route_code: r?.code ?? null, route_name: r?.name ?? null }; };
  const anomalyList = (status) => S.anomalies.filter((a) => status === 'all' || a.status === status).map(anomalyRow)
    .sort((a, b) => ({ critical: 0, warning: 1, info: 2 }[a.severity] - { critical: 0, warning: 1, info: 2 }[b.severity]) || b.id - a.id);
  route('GET', '/api/admin/anomalies', ({ query }) => { A(); return { anomalies: anomalyList(query.status ? oneOf(query.status, 'status', ['open', 'dismissed', 'published', 'all']) : 'open') }; });
  route('PATCH', '/api/admin/anomalies/:id', ({ params, body }) => {
    const u = A(); const id = int(params.id, 'id'); const cur = exists(S.anomalies, id, 'Anomaly');
    const action = oneOf(body?.action, 'action', ['dismiss', 'publish']);
    if (cur.status !== 'open') throw conflict('This item was already handled');
    cur.status = action === 'dismiss' ? 'dismissed' : 'published'; cur.handled_by = u.id; cur.handled_at = nowIso();
    audit(u, `anomaly.${action}`, 'anomaly', id, cur.evidence);
    const full = anomalyRow(cur);
    return { anomaly: full, ...(action === 'publish' ? { draft: { kind: 'delay', route_id: full.route_id, trip_id: full.trip_id ?? null, title: `Bus ${full.bus_number} may be delayed`, body: `${full.evidence}. We are looking into it and will update you.` } } : {}) };
  });
  route('GET', '/api/admin/eta-accuracy', () => {
    A();
    return { routes: S.routes.filter((r) => r.active).sort((a, b) => a.code.localeCompare(b.code)).map((r, i) => ({ route_id: r.id, code: r.code, name: r.name, samples: 140 + i * 37, compared: 112 + i * 29, gps_only_error_min: round1(2.9 + i * 0.4), predicted_error_min: round1(1.9 + i * 0.25), improvement_pct: 31 - i * 3 })) };
  });
  route('GET', '/api/admin/outbox', ({ query }) => {
    A();
    const limit = int(Number(query.limit ?? 25), 'limit', { min: 1, max: 100 }); const page = int(Number(query.page ?? 1), 'page', { min: 1, max: 10000 });
    const rows = [...S.outbox].sort((a, b) => b.id - a.id);
    return { emails: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, limit, provider: 'outbox' };
  });

  // ---------------- places ----------------
  route('GET', '/api/admin/places', () => { A(); return { places: S.places.filter((p) => !p.owner_id).sort((a, b) => a.area.localeCompare(b.area) || a.name_en.localeCompare(b.name_en)) }; });
  route('POST', '/api/admin/places', ({ body }) => { const u = A(); const v = placeBody(body ?? {}); const row = { id: nextId('place'), ...v }; S.places.push(row); audit(u, 'place.create', 'place', row.id, v.name_en); return { __status: 201, place: row }; });
  route('PUT', '/api/admin/places/:id', ({ params, body }) => { const u = A(); const cur = exists(S.places, int(params.id, 'id'), 'Place'); Object.assign(cur, placeBody(body ?? {}, cur)); audit(u, 'place.update', 'place', cur.id, cur.name_en); return { place: cur }; });
  route('DELETE', '/api/admin/places/:id', ({ params }) => { const u = A(); const p = exists(S.places, int(params.id, 'id'), 'Place'); S.places = S.places.filter((x) => x.id !== p.id); audit(u, 'place.delete', 'place', p.id, p.name_en); return { ok: true }; });

  // ---------------- buses ----------------
  route('GET', '/api/admin/buses', ({ now }) => { A(); return { buses: [...S.buses].sort((a, b) => a.number.localeCompare(b.number)).map((b) => busRow(b, now)) }; });
  route('POST', '/api/admin/buses', ({ body, now }) => {
    const u = A(); const v = busBody(body ?? {});
    if (S.buses.some((b) => b.number === v.number)) throw conflict('A bus with this number already exists');
    const row = { id: nextId('bus'), ...v }; S.buses.push(row); audit(u, 'bus.create', 'bus', row.id, v.number);
    return { __status: 201, bus: busRow(row, now) };
  });
  route('PUT', '/api/admin/buses/:id', ({ params, body, now }) => {
    const u = A(); const id = int(params.id, 'id'); const cur = exists(S.buses, id, 'Bus'); const v = busBody(body ?? {}, cur);
    if (v.number !== cur.number && S.buses.some((b) => b.number === v.number)) throw conflict('A bus with this number already exists');
    if (v.capacity < cur.capacity) {
      const max = Math.max(0, ...tripsOnDate(ymd(new Date(now)), now).filter((d) => d.bus_id === id && ['scheduled', 'preparing'].includes(resolve(d, now).status)).map((d) => S.reservations.filter((r) => r.trip_id === d.id && r.status === 'confirmed').length));
      if (v.capacity < max) throw conflict(`Capacity cannot go below ${max}: seats are already reserved on an upcoming trip`);
    }
    if (v.status === 'out_of_service' && liveBoard(now).some((t) => t.status === 'departed' && t.bus.id === id)) throw conflict('This bus is currently on a trip. Complete or cancel the trip first');
    Object.assign(cur, v); audit(u, 'bus.update', 'bus', id, `${v.number} status=${v.status}`);
    return { bus: busRow(cur, now) };
  });
  route('DELETE', '/api/admin/buses/:id', ({ params }) => {
    const u = A(); const id = int(params.id, 'id'); const bus = exists(S.buses, id, 'Bus');
    if (S.schedules.some((s) => s.bus_id === id) || S.manualTrips.some((t) => t.bus_id === id) || S.reservations.some((r) => describe(r.trip_id)?.bus_id === id)) throw conflict('This bus has trip history. Mark it out of service instead of deleting it');
    S.buses = S.buses.filter((b) => b.id !== id); audit(u, 'bus.delete', 'bus', id, bus.number);
    return { ok: true };
  });

  // ---------------- routes & collection points ----------------
  route('GET', '/api/admin/routes', () => {
    A();
    return {
      routes: [...S.routes].sort((a, b) => a.code.localeCompare(b.code)).map((r) => routeFull(r.id)),
      stops: [...S.stops].sort((a, b) => (b.is_campus ?? 0) - (a.is_campus ?? 0) || a.name.localeCompare(b.name)).map((s) => ({ ...s, route_count: Object.values(S.routeStops).filter((ids) => ids.includes(s.id)).length })),
    };
  });
  route('POST', '/api/admin/routes', ({ body }) => {
    const u = A(); const v = routeBody(body ?? {});
    if (S.routes.some((r) => r.code === v.code)) throw conflict('A route with this code already exists');
    const row = { id: nextId('route'), ...v }; S.routes.push(row); S.routeStops[row.id] = []; audit(u, 'route.create', 'route', row.id, v.code);
    return { __status: 201, route: routeFull(row.id) };
  });
  route('PUT', '/api/admin/routes/:id', ({ params, body, now }) => {
    const u = A(); const id = int(params.id, 'id'); const cur = exists(S.routes, id, 'Route'); const v = routeBody(body ?? {}, cur);
    if (v.code !== cur.code && S.routes.some((r) => r.code === v.code)) throw conflict('A route with this code already exists');
    if (!v.active && cur.active && liveBoard(now).some((t) => t.status === 'departed' && t.route.id === id)) throw conflict('A trip on this route is in progress');
    Object.assign(cur, v); audit(u, 'route.update', 'route', id, v.code);
    return { route: routeFull(id) };
  });
  route('PUT', '/api/admin/routes/:id/stops', ({ params, body, now }) => {
    const u = A(); const id = int(params.id, 'id'); exists(S.routes, id, 'Route');
    const ids = body?.stop_ids;
    if (!Array.isArray(ids) || ids.length > 30) throw bad('stop_ids must be an ordered list of collection point ids');
    const clean = ids.map((x) => int(x, 'stop id'));
    if (new Set(clean).size !== clean.length) throw bad('A collection point can appear only once on a route');
    for (const sid of clean) { const s = exists(S.stops, sid, 'Collection point'); if (s.is_campus) throw bad('The university campus is added automatically at both ends of every trip'); }
    if (liveBoard(now).some((t) => t.status === 'departed' && t.source !== 'demo' && t.route.id === id)) throw conflict('A trip on this route is in progress. Change the stops after it finishes');
    S.routeStops[id] = clean;
    for (const us of S.users) if (us.route_id === id && us.stop_id != null && !clean.includes(us.stop_id)) us.stop_id = null;
    audit(u, 'route.stops', 'route', id, clean.join(','));
    return { route: routeFull(id) };
  });
  route('DELETE', '/api/admin/routes/:id', ({ params }) => {
    const u = A(); const id = int(params.id, 'id'); const r = exists(S.routes, id, 'Route');
    if (S.buses.some((b) => b.route_id === id) || S.schedules.some((s) => s.route_id === id) || S.manualTrips.some((t) => t.route_id === id)) throw conflict('This route is used by buses, schedules or trips. Deactivate it instead');
    S.routes = S.routes.filter((x) => x.id !== id); delete S.routeStops[id]; audit(u, 'route.delete', 'route', id, r.code);
    return { ok: true };
  });
  route('POST', '/api/admin/stops', ({ body }) => { const u = A(); const v = stopBody(body ?? {}); const row = { id: nextId('stop'), ...v, is_campus: 0 }; S.stops.push(row); audit(u, 'stop.create', 'stop', row.id, v.name); return { __status: 201, stop: row }; });
  route('PUT', '/api/admin/stops/:id', ({ params, body, now }) => {
    const u = A(); const id = int(params.id, 'id'); const cur = exists(S.stops, id, 'Collection point'); const v = stopBody(body ?? {}, cur);
    const used = Object.entries(S.routeStops).filter(([, ids]) => ids.includes(id)).map(([rid]) => Number(rid));
    if (liveBoard(now).some((t) => t.status === 'departed' && t.source !== 'demo' && used.includes(t.route.id))) throw conflict('A trip using this collection point is in progress');
    Object.assign(cur, { ...v, active: cur.is_campus ? 1 : v.active }); audit(u, 'stop.update', 'stop', id, v.name);
    return { stop: cur };
  });
  route('DELETE', '/api/admin/stops/:id', ({ params }) => {
    const u = A(); const id = int(params.id, 'id'); const s = exists(S.stops, id, 'Collection point');
    if (s.is_campus) throw conflict('The campus cannot be deleted');
    if (Object.values(S.routeStops).some((ids) => ids.includes(id))) throw conflict('Remove this collection point from its routes first');
    S.stops = S.stops.filter((x) => x.id !== id); audit(u, 'stop.delete', 'stop', id, s.name);
    return { ok: true };
  });

  // ---------------- drivers ----------------
  route('GET', '/api/admin/drivers', () => {
    A();
    return { drivers: [...S.drivers].sort((a, b) => a.name.localeCompare(b.name)).map((d) => {
      const buses = S.buses.filter((b) => b.driver_id === d.id);
      return { ...d, buses: buses.map((b) => b.number).join(', ') || null, routes: [...new Set(buses.map((b) => routeOf(b.route_id)?.code).filter(Boolean))].join(',') || null };
    }) };
  });
  route('POST', '/api/admin/drivers', ({ body }) => { const u = A(); const v = driverBody(body ?? {}); const row = { id: nextId('driver'), ...v }; S.drivers.push(row); audit(u, 'driver.create', 'driver', row.id, v.name); return { __status: 201, driver: row }; });
  route('PUT', '/api/admin/drivers/:id', ({ params, body, now }) => {
    const u = A(); const id = int(params.id, 'id'); const cur = exists(S.drivers, id, 'Driver'); const v = driverBody(body ?? {}, cur);
    if (!v.active && liveBoard(now).some((t) => t.status === 'departed' && t.driver?.id === id)) throw conflict('This driver is on a trip right now');
    Object.assign(cur, v); audit(u, 'driver.update', 'driver', id, v.name);
    return { driver: cur };
  });
  route('DELETE', '/api/admin/drivers/:id', ({ params }) => {
    const u = A(); const id = int(params.id, 'id'); const d = exists(S.drivers, id, 'Driver');
    if (S.buses.some((b) => b.driver_id === id)) throw conflict('Unassign this driver from their bus first');
    if (S.schedules.some((s) => s.driver_id === id)) throw conflict('This driver has trip history. Deactivate instead of deleting');
    S.drivers = S.drivers.filter((x) => x.id !== id); audit(u, 'driver.delete', 'driver', id, d.name);
    return { ok: true };
  });
  route('POST', '/api/admin/drivers/:id/assign', ({ params, body, now }) => {
    const u = A(); const id = int(params.id, 'id'); const d = exists(S.drivers, id, 'Driver');
    if (!d.active) throw conflict('Driver is inactive');
    const busId = int(body?.bus_id, 'Bus'); const bus = exists(S.buses, busId, 'Bus');
    const routeId = int(body?.route_id, 'Route', { optional: true });
    if (routeId != null) exists(S.routes, routeId, 'Route');
    if (liveBoard(now).some((t) => t.status === 'departed' && t.bus.id === busId)) throw conflict('This bus is on a trip. Change the driver after it ends');
    for (const b of S.buses) if (b.driver_id === id && b.id !== busId) b.driver_id = null;
    bus.driver_id = id; if (routeId != null) bus.route_id = routeId;
    audit(u, 'driver.assign', 'driver', id, `Bus ${bus.number}`);
    return { bus: busRow(bus, now) };
  });

  // ---------------- schedules & trips ----------------
  route('GET', '/api/admin/schedules', () => { A(); return { schedules: S.schedules.map(schedRow).sort((a, b) => a.route_code.localeCompare(b.route_code) || a.depart_time.localeCompare(b.depart_time)) }; });
  route('POST', '/api/admin/schedules/standard', () => { A(); return { created: 0 }; });
  route('GET', '/api/admin/optimise', ({ query, now }) => {
    A();
    const routeId = query.route ? int(query.route, 'route') : null;
    return optimise({ routeId, weeks: query.weeks ? int(query.weeks, 'weeks', { min: 1, max: 52 }) : undefined }, now);
  });
  route('POST', '/api/admin/optimise/apply', ({ body, now }) => {
    const u = A(); const key = str(body?.suggestion_key, 'Suggestion', { max: 60 });
    const s = optimise({ weeks: body?.weeks }, now).suggestions.find((x) => x.key === key);
    if (!s) throw notFound('That suggestion is no longer supported by the data');
    if (s.type !== 'add') throw conflict('Only added departures can be created as a draft. Review this slot in Schedules & trips.', 'not_applicable');
    const v = schedBody({ route_id: s.route_id, bus_id: null, depart_time: proposedTime(s.time), days: [DAYS[s.weekday]], active: 0 });
    const row = { id: nextId('sched'), ...v, active: 0 }; S.schedules.push(row); audit(u, 'optimise.apply', 'schedule', row.id, `${key} -> draft ${v.depart_time}`);
    return { __status: 201, schedule: schedRow(row) };
  });
  route('POST', '/api/admin/schedules', ({ body }) => {
    const u = A(); const v = schedBody(body ?? {}); checkClash(v);
    const row = { id: nextId('sched'), ...v }; S.schedules.push(row); audit(u, 'schedule.create', 'schedule', row.id, v.depart_time);
    return { __status: 201, schedule: schedRow(row) };
  });
  route('PUT', '/api/admin/schedules/:id', ({ params, body }) => {
    const u = A(); const id = int(params.id, 'id'); const cur = exists(S.schedules, id, 'Schedule'); const v = schedBody(body ?? {}, cur); checkClash(v, id);
    Object.assign(cur, v); audit(u, 'schedule.update', 'schedule', id, v.depart_time);
    return { schedule: schedRow(cur) };
  });
  route('DELETE', '/api/admin/schedules/:id', ({ params }) => { const u = A(); const id = int(params.id, 'id'); exists(S.schedules, id, 'Schedule'); S.schedules = S.schedules.filter((s) => s.id !== id); audit(u, 'schedule.delete', 'schedule', id); return { ok: true }; });
  const generated = new Set();
  route('POST', '/api/admin/trips/generate', ({ body, now }) => {
    const u = A(); const date = body?.date ? dateStr(body.date, 'date') : ymd(new Date(now));
    const created = generated.has(date) ? 0 : timetableTripsOn(date).length; generated.add(date);
    audit(u, 'trips.generate', 'trip', null, `${date}: ${created} created`);
    return { created };
  });
  route('GET', '/api/admin/trips', ({ query, now }) => {
    A(); const date = query.date ? dateStr(query.date, 'date') : ymd(new Date(now));
    return { date, trips: tripsOnDate(date, now).map((d) => adminTrip(d, now)).filter(Boolean) };
  });
  route('POST', '/api/admin/trips', ({ body: b = {}, now }) => {
    const u = A();
    const direction = b.direction ? oneOf(b.direction, 'Direction', ['to_campus', 'from_campus']) : null;
    const bus_id = int(b.bus_id, 'Bus'); const route_id = int(b.route_id, 'Route'); const driver_id = int(b.driver_id, 'Driver', { optional: true });
    const service_date = dateStr(b.date ?? ymd(new Date(now)), 'date'); const time = hhmm(b.time, 'Departure time');
    const bus = exists(S.buses, bus_id, 'Bus'); const rt = exists(S.routes, route_id, 'Route');
    if (!rt.active) throw bad('Route is inactive');
    const row = { id: 200000000 + nextId('mtrip'), bus_id, route_id, driver_id: driver_id ?? bus.driver_id ?? null, service_date, time, direction, allow_outside: bool(b.allow_outside ?? 1), outside_limit: int(b.outside_limit ?? 10, 'Outside seats', { min: 0, max: 120 }) };
    S.manualTrips.push(row); audit(u, 'trip.create', 'trip', row.id, `Bus ${bus.number} ${time}`);
    return { __status: 201, trip: tripView(row.id, now) };
  });
  route('PATCH', '/api/admin/trips/:id/status', ({ params, body, now }) => {
    const u = A(); const id = int(params.id, 'id');
    setTripStatus(id, oneOf(body?.status, 'Status', ['scheduled', 'preparing', 'departed', 'completed', 'cancelled']), u, now);
    return { trip: tripView(id, now) };
  });
  route('PATCH', '/api/admin/trips/:id/delay', ({ params, body, now }) => {
    const u = A(); const id = int(params.id, 'id'); const d = describe(id);
    if (!d) throw notFound('Trip not found');
    const minutes = int(body?.minutes, 'Delay', { min: 0, max: 240 });
    if (['completed', 'cancelled'].includes(resolve(d, now).status)) throw conflict('Trip is already finished');
    const before = resolve(d, now).delay;
    (S.tripOv[id] ??= {}).delay_minutes = minutes;
    audit(u, 'trip.delay', 'trip', id, `${minutes} min`);
    if (minutes !== before) announceDelay(d, minutes);
    return { trip: tripView(id, now) };
  });
  route('PATCH', '/api/admin/trips/:id', ({ params, body: b = {}, now }) => {
    const u = A(); const id = int(params.id, 'id'); const d = describe(id);
    if (!d) throw notFound('Trip not found');
    const ov = (S.tripOv[id] ??= {});
    const driver_id = b.driver_id === undefined ? undefined : int(b.driver_id, 'Driver', { optional: true });
    if (driver_id != null) { const dr = exists(S.drivers, driver_id, 'Driver'); if (!dr.active) throw bad('Driver is inactive'); }
    const allow = b.allow_outside === undefined ? undefined : bool(b.allow_outside);
    const limit = b.outside_limit === undefined ? undefined : int(b.outside_limit, 'Outside seats', { min: 0, max: 120 });
    const st = resolve(d, now).status;
    if (['completed', 'cancelled'].includes(st)) throw conflict('Trip is already finished');
    if (b.time !== undefined) {
      if (st === 'departed') throw conflict('The trip has already departed');
      hhmm(b.time, 'Departure time');
      if (d.kind === 'manual') { const m = S.manualTrips.find((x) => x.id === id); if (m) m.time = b.time; }
      else { const [h, mi] = b.time.split(':').map(Number); const base = new Date(d.nominal); base.setHours(h, mi, 0, 0); ov.delay_minutes = Math.round((base.getTime() - d.nominal) / MIN) + (ov.delay_minutes ?? d.baseDelay); }
    }
    if (driver_id !== undefined) ov.driver_id = driver_id;
    if (allow !== undefined) ov.allow_outside = allow;
    if (limit !== undefined) ov.outside_limit = limit;
    audit(u, 'trip.update', 'trip', id);
    return { trip: tripView(id, now) };
  });

  // ---------------- monitor, capacity, reservations ----------------
  route('GET', '/api/admin/monitor', ({ now }) => {
    A();
    const rows = [...S.buses].sort((a, b) => a.number.localeCompare(b.number)).map((b) => {
      const d = currentTripOfBus(b, now);
      const view = d ? tripView(d, now) : null; const problems = [];
      if (b.status === 'out_of_service') problems.push('Out of service');
      if (view) {
        if (view.status === 'departed' && !view.position) problems.push('Departed but no GPS received');
        if (view.overdue_minutes > 0) problems.push(`Departure ${view.overdue_minutes} min late and not reported`);
        if (view.delay_minutes > 0) problems.push(`Delayed ${view.delay_minutes} min`);
      }
      return { bus: busRow(b, now), trip: view, where: !view ? 'No trip today' : view.status === 'departed' ? 'Travelling' : 'Waiting at university', problems };
    });
    return { buses: rows, updates: activeUpdates(), server_time: iso(now) };
  });
  route('GET', '/api/admin/capacity', ({ query, now }) => {
    A(); const date = query.date ? dateStr(query.date, 'date') : ymd(new Date(now));
    const trips = tripsOnDate(date, now).filter((d) => ['scheduled', 'preparing', 'departed'].includes(resolve(d, now).status)).map((d) => {
      const v = tripView(d, now);
      return { id: d.id, status: v.status, direction: v.direction, scheduled_departure: v.scheduled_departure, bus: v.bus, route: v.route, seats: v.seats, allow_outside: v.allow_outside, outside_limit: v.outside_limit, delay_minutes: v.delay_minutes };
    });
    return { date, trips };
  });
  const adminRes = (rs, now) => {
    const d = describe(rs.trip_id); if (!d) return null;
    const u = userOf(rs.user_id); const r = resolve(d, now); const rt = routeOf(d.route_id); const bus = busOf(d.bus_id);
    return { ...rs, student_name: u?.name, student_email: u?.email, student_no: u?.student_no, student_route_code: routeOf(u?.route_id)?.code ?? null, stop_name: stopOf(rs.stop_id)?.name ?? null, scheduled_departure: iso(d.nominal), service_date: d.service_date, direction: d.direction, trip_status: r.status, bus_number: bus.number, route_code: rt.code, route_name: rt.name };
  };
  route('GET', '/api/admin/reservations', ({ query, now }) => {
    A();
    const tripId = int(query.trip_id, 'trip_id', { optional: true }); const date = query.date ? dateStr(query.date, 'date') : null; const today = ymd(new Date(now));
    const rows = S.reservations.map((rs) => adminRes(rs, now)).filter(Boolean)
      .filter((x) => (tripId ? x.trip_id === tripId : date ? x.service_date === date : x.service_date >= today))
      .sort((a, b) => a.scheduled_departure.localeCompare(b.scheduled_departure) || a.student_name.localeCompare(b.student_name) || a.id - b.id).slice(0, 1000);
    return { reservations: rows };
  });
  route('GET', '/api/admin/students', () => { A(); return { students: S.users.filter((x) => x.role === 'student' && x.active).sort((a, b) => a.name.localeCompare(b.name)).map((x) => ({ id: x.id, name: x.name, email: x.email, student_no: x.student_no, route_id: x.route_id, route_code: routeOf(x.route_id)?.code ?? null })) }; });
  route('POST', '/api/admin/reservations', ({ body, now }) => {
    const u = A(); const stu = S.users.find((x) => x.id === int(body?.user_id, 'Student') && x.role === 'student' && x.active);
    if (!stu) throw notFound('Student not found');
    const tripId = int(body?.trip_id, 'Trip');
    const row = reserve({ user: stu, tripId, stopId: int(body?.stop_id, 'Collection point', { optional: true }), madeBy: 'admin', note: str(body?.note, 'Note', { max: 200, optional: true }), override: true, now });
    const bus = busOf(describe(tripId).bus_id); const rt = routeOf(describe(tripId).route_id);
    audit(u, 'reservation.create', 'reservation', row.id, `${stu.email} on trip ${tripId}`);
    notify(stu.id, { kind: 'reservation', tripId, key: `resadd:${row.id}`, title: 'A seat was reserved for you', body: `An administrator reserved a seat on bus ${bus.number} (${rt.name}).` });
    return { __status: 201, reservation: row };
  });
  route('DELETE', '/api/admin/reservations/:id', ({ params, now }) => { const u = A(); return { reservation: cancelReservation(int(params.id, 'id'), { byAdmin: true, actor: u, now }) }; });

  // ---------------- service updates ----------------
  route('GET', '/api/admin/updates', () => {
    A();
    return { updates: [...S.updates].sort((a, b) => b.active - a.active || b.id - a.id).slice(0, 200).map((su) => ({ ...su, route_code: routeOf(su.route_id)?.code ?? null, bus_number: busOf(su.bus_id)?.number ?? null, author: userOf(su.created_by)?.name ?? null })) };
  });
  route('POST', '/api/admin/updates', ({ body: b = {} }) => {
    const u = A();
    const kind = oneOf(b.kind, 'Type', ['delay', 'route_change', 'cancellation', 'breakdown', 'temporary']);
    const title = str(b.title, 'Title', { max: 100 }); const message = str(b.message, 'Message', { max: 500 });
    const route_id = int(b.route_id, 'Route', { optional: true }); const bus_id = int(b.bus_id, 'Bus', { optional: true }); const trip_id = int(b.trip_id, 'Trip', { optional: true });
    const delay_minutes = int(b.delay_minutes, 'Delay', { min: 0, max: 240, optional: true });
    if (route_id != null) exists(S.routes, route_id, 'Route');
    if (bus_id != null) exists(S.buses, bus_id, 'Bus');
    const su = { id: nextId('upd'), kind, title, message, route_id, bus_id, trip_id, delay_minutes, active: 1, created_by: u.id, created_at: nowIso(), resolved_at: null };
    S.updates.push(su);
    const notified = announceServiceUpdate(su); audit(u, 'update.create', 'service_update', su.id, `${kind}: ${title}`);
    return { __status: 201, update: su, notified };
  });
  route('PATCH', '/api/admin/updates/:id/resolve', ({ params }) => {
    const u = A(); const su = exists(S.updates, int(params.id, 'id'), 'Update');
    if (!su.active) throw conflict('Already resolved');
    su.active = 0; su.resolved_at = nowIso();
    const notified = announceServiceUpdate(su, true); audit(u, 'update.resolve', 'service_update', su.id, su.title);
    return { update: su, notified };
  });

  // ---------------- reports, issues, audit, overview ----------------
  route('GET', '/api/admin/reports', ({ query, now }) => {
    A();
    const to0 = ymd(new Date(now)); const from0 = ymd(new Date(now - 13 * 86400000));
    const from = query.from ? dateStr(query.from, 'from') : from0; const to = query.to ? dateStr(query.to, 'to') : to0;
    if (from > to) throw bad('The start date must be before the end date');
    const routeId = int(query.route_id, 'Route', { optional: true }); const busId = int(query.bus_id, 'Bus', { optional: true });
    if (routeId != null) exists(S.routes, routeId, 'Route');
    if (busId != null) exists(S.buses, busId, 'Bus');
    return buildReport(from, to, { routeId, busId }, now);
  });
  route('GET', '/api/admin/issues', ({ query }) => {
    A();
    const status = query.status ? oneOf(query.status, 'status', ['open', 'in_review', 'resolved', 'dismissed']) : null;
    const rank = { open: 0, in_review: 1 };
    const rows = S.issues.filter((i) => !status || i.status === status).map((i) => {
      const u = userOf(i.user_id);
      return { ...i, student_name: u?.name, student_email: u?.email, bus_number: busOf(i.bus_id)?.number ?? null, stop_name: stopOf(i.stop_id)?.name ?? null, route_code: routeOf(i.route_id)?.code ?? null };
    }).sort((a, b) => (rank[a.status] ?? 2) - (rank[b.status] ?? 2) || b.id - a.id).slice(0, 300);
    return { issues: rows };
  });
  route('PATCH', '/api/admin/issues/:id', ({ params, body }) => {
    const u = A(); const id = int(params.id, 'id'); const cur = exists(S.issues, id, 'Report');
    const status = oneOf(body?.status ?? cur.status, 'Status', ['open', 'in_review', 'resolved', 'dismissed']);
    const note = body?.admin_note === undefined ? cur.admin_note : str(body.admin_note, 'Note', { max: 500, optional: true });
    const changed = status !== cur.status;
    cur.status = status; cur.admin_note = note; cur.updated_at = nowIso();
    if (changed && ['resolved', 'dismissed', 'in_review'].includes(status)) notify(cur.user_id, { kind: 'report', key: `issue:${id}:${status}`, title: `Your report was ${status === 'in_review' ? 'picked up for review' : status}`, body: note || 'Thank you for helping improve the service.' });
    audit(u, 'issue.update', 'issue', id, status);
    return { issue: cur };
  });
  route('GET', '/api/admin/audit', ({ query: q }) => {
    A();
    let rows = [...S.audit];
    if (q.entity) rows = rows.filter((r) => r.entity === str(q.entity, 'entity', { max: 40 }));
    if (q.action) rows = rows.filter((r) => r.action === str(q.action, 'action', { max: 60 }));
    if (q.from) rows = rows.filter((r) => r.ts.slice(0, 10) >= dateStr(q.from, 'from'));
    if (q.to) rows = rows.filter((r) => r.ts.slice(0, 10) <= dateStr(q.to, 'to'));
    if (q.from && q.to && q.from > q.to) throw bad('The start date must be before the end date');
    if (q.q) { const n = str(q.q, 'search', { max: 80 }).toLowerCase(); rows = rows.filter((r) => `${r.actor_name} ${r.action} ${r.detail ?? ''}`.toLowerCase().includes(n)); }
    const limit = int(q.limit, 'limit', { min: 1, max: 200, optional: true }) ?? 50; const offset = int(q.offset, 'offset', { min: 0, max: 1e7, optional: true }) ?? 0;
    rows.sort((a, b) => b.id - a.id);
    return { entries: rows.slice(offset, offset + limit), total: rows.length, limit, offset, entities: [...new Set(S.audit.map((r) => r.entity))].sort(), actions: [...new Set(S.audit.map((r) => r.action))].sort() };
  });
  route('GET', '/api/admin/overview', ({ now }) => {
    A();
    const counts = new Map();
    for (const b of S.buses) { const st = busRow(b, now).status; counts.set(st, (counts.get(st) ?? 0) + 1); }
    const board = liveBoard(now); const today = ymd(new Date(now));
    return {
      buses: [...counts].map(([status, count]) => ({ status, count })), trips_today: tripsOnDate(today, now).length, live: board.filter((t) => t.status === 'departed').length,
      open_issues: S.issues.filter((i) => ['open', 'in_review'].includes(i.status)).length, active_updates: S.updates.filter((x) => x.active).length,
      open_anomalies: S.anomalies.filter((a) => a.status === 'open' && ['warning', 'critical'].includes(a.severity)).length,
      reservations_today: S.reservations.filter((r) => r.status === 'confirmed' && describe(r.trip_id)?.service_date === today).length,
    };
  });
}
export { median, slotPct, unreadCount, dayKey };

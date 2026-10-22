// The trip model of the mock backend. Nothing here is stored: a trip is a pure function of its id and the clock.
//
//  * "demo" trips (ids 1000+) cycle forever for every working bus, like the real server's DEMO_MODE simulator:
//    waiting at the university -> preparing -> departed (GPS moves along the real route geometry) -> completed.
//  * "timetable" trips (ids 100000000+) come from the schedules for a given date. They are the plan: scheduled until
//    their time, then completed (they are not animated, the demo trips provide the live movement).
//  * "manual" trips (ids 200000000+) are created by an admin and stored in state.
import { S } from './state.js';
import { buildPath, pointAt } from './geo.js';
import { etaStrategies } from './etaStrategies.js';
import { MIN, iso, ymd, dayKey, hash, median, localToMs, dayNo, dateOfDayNo, hmOf, parseYmd } from './util.js';

const WAIT = 7 * MIN; // waiting at the university before the nominal departure
const DELAY_RESERVE = 6 * MIN; // room for a delayed departure
const REST = 45000;
const DEMO_SPEEDUP = 3; // same factor as the real demo simulator
const T0 = Date.UTC(2026, 0, 1);
const CYCLE_BASE = 1000;

export const campus = () => S.stops.find((s) => s.is_campus);
export const busOf = (id) => S.buses.find((b) => b.id === id) ?? null;
export const routeOf = (id) => S.routes.find((r) => r.id === id) ?? null;
export const driverOf = (id) => S.drivers.find((d) => d.id === id) ?? null;
export const stopOf = (id) => S.stops.find((s) => s.id === id) ?? null;
export const userOf = (id) => S.users.find((u) => u.id === id) ?? null;

export const routeStopRows = (routeId) => (S.routeStops[routeId] ?? []).map((sid, i) => ({ ...stopOf(sid), seq: i + 1 })).filter((s) => s.id != null);

/** Ordered collection points of a route with their distance along the trip path (campus -> stops -> campus), as the server does. */
export function routeGeometry(routeId, direction = null) {
  const c = campus();
  let stops = routeStopRows(routeId);
  if (direction === 'to_campus') stops = [...stops].reverse();
  const pts = [];
  if (c && direction !== 'to_campus') pts.push(c);
  pts.push(...stops);
  if (c && direction !== 'from_campus') pts.push(c);
  const path = buildPath(pts);
  const off = c && direction !== 'to_campus' ? 1 : 0;
  return { campus: c, stops: stops.map((s, i) => ({ ...s, dist: path.cum[i + off] ?? null })), path };
}

// ---------------------------------------------------------------- demo (cycle) trips
export function cycleInfo(bus) {
  const route = routeOf(bus.route_id);
  if (!route || !route.active || bus.status === 'out_of_service') return null;
  const geom = routeGeometry(route.id, null);
  const L = geom.path.length;
  if (!L) return null;
  const speed = ((route.avg_speed_kmh * 1000) / 3600) * DEMO_SPEEDUP;
  const run = (L / speed) * 1000 + geom.stops.length * 6000;
  const period = Math.round(WAIT + DELAY_RESERVE + run + REST);
  const off = (bus.id * 123457) % period;
  return { L, speed, run, period, off, geom, route };
}
const cycleStart = (ci, k) => ci.off + k * ci.period;
const cycleK = (ci, t) => Math.floor((t - ci.off) / ci.period);
const cycleId = (bus, ci, k) => CYCLE_BASE + (k - Math.floor(T0 / ci.period)) * 100 + bus.id;
const baseDelay = (bus, idx) => (bus.number === '311' && idx % 2 === 0 ? 6 : 0);

/** Normalised description of a trip (everything but the clock-dependent status). */
export function describe(id) {
  if (id >= 200000000) {
    const m = S.manualTrips.find((x) => x.id === id);
    if (!m) return null;
    return { id, kind: 'manual', bus_id: m.bus_id, route_id: m.route_id, driver_id: m.driver_id ?? null, direction: m.direction ?? null, source: 'manual', schedule_id: null, service_date: m.service_date, nominal: localToMs(m.service_date, m.time), baseDelay: 0, allow_outside: m.allow_outside, outside_limit: m.outside_limit };
  }
  if (id >= 100000000) {
    const day = Math.floor((id - 100000000) / 1000); const sid = (id - 100000000) % 1000;
    const sc = S.schedules.find((x) => x.id === sid);
    if (!sc || sc.bus_id == null) return null;
    const date = dateOfDayNo(day);
    if (!sc.days.split(',').includes(dayKey(parseYmd(date)))) return null;
    return { id, kind: 'sched', bus_id: sc.bus_id, route_id: sc.route_id, driver_id: sc.driver_id ?? null, direction: sc.direction ?? null, source: 'schedule', schedule_id: sc.id, service_date: date, nominal: localToMs(date, sc.depart_time), baseDelay: 0, allow_outside: 1, outside_limit: 10, active: sc.active };
  }
  if (id >= CYCLE_BASE) {
    const busId = (id - CYCLE_BASE) % 100; const bus = busOf(busId);
    const ci = bus && cycleInfo(bus);
    if (!ci) return null;
    const idx = Math.floor((id - CYCLE_BASE) / 100);
    const k = idx + Math.floor(T0 / ci.period);
    const start = cycleStart(ci, k);
    const nominal = start + WAIT;
    return { id, kind: 'cycle', bus_id: bus.id, route_id: bus.route_id, driver_id: bus.driver_id ?? null, direction: null, source: 'demo', schedule_id: null, service_date: ymd(new Date(nominal)), nominal, baseDelay: baseDelay(bus, idx), allow_outside: 1, outside_limit: 8, run: ci.run, L: ci.L, speed: ci.speed, k };
  }
  return null;
}

/** The clock-dependent part: status, delay, actual departure, progress. */
export function resolve(d, now) {
  const ov = S.tripOv[d.id] ?? {};
  const delay = ov.delay_minutes ?? d.baseDelay;
  const expected = d.nominal + delay * MIN;
  const past = d.kind !== 'cycle' && d.service_date < ymd(new Date(now));
  let status; let actual = null; let completedAt = null;
  const run = d.run ?? 0;
  if (d.kind === 'cycle') {
    const dep = ov.departed_at ?? expected;
    if (ov.status === 'cancelled') status = 'cancelled';
    else if (ov.status === 'completed') { status = 'completed'; actual = dep; completedAt = ov.completed_at ?? now; }
    else if (now < dep - MIN) status = ov.status === 'preparing' ? 'preparing' : 'scheduled';
    else if (now < dep) status = 'preparing';
    else if (now < dep + run) { status = 'departed'; actual = dep; }
    else { status = 'completed'; actual = dep; completedAt = dep + run; }
    if (status === 'scheduled' && ov.status === 'preparing') status = 'preparing';
    const el = status === 'departed' ? Math.min(1, (now - dep) / run) : status === 'completed' ? 1 : 0;
    return { status, delay, expected, actual, completedAt, progress_m: el * d.L, speed_mps: status === 'departed' ? d.L / (run / 1000) : null, depAt: dep };
  }
  // timetable / manual trips
  let past_status;
  if (past) {
    const h = hash(d.id);
    past_status = h % 100 < 4 ? 'cancelled' : 'completed';
  }
  const pastDelay = past && past_status === 'completed' && hash(d.id + 7) % 100 < 15 ? 3 + (hash(d.id + 9) % 8) : 0;
  const dl = ov.delay_minutes ?? (past ? pastDelay : d.baseDelay);
  const exp = d.nominal + dl * MIN;
  if (ov.status === 'cancelled') status = 'cancelled';
  else if (ov.status === 'completed') { status = 'completed'; actual = ov.departed_at ?? exp; completedAt = ov.completed_at ?? now; }
  else if (ov.departed_at && now < ov.departed_at + 20 * MIN) { status = 'departed'; actual = ov.departed_at; }
  else if (past) { status = past_status; if (status === 'completed') { actual = exp + (hash(d.id + 3) % 3) * MIN; completedAt = actual + 25 * MIN; } }
  else if (now < exp - MIN) status = ov.status === 'preparing' ? 'preparing' : 'scheduled';
  else if (now < exp) status = 'preparing';
  else { status = 'completed'; actual = exp; completedAt = exp + 25 * MIN; }
  const route = routeOf(d.route_id); const geom = route ? routeGeometry(d.route_id, d.direction) : null;
  const L = geom?.path.length ?? 0;
  const run2 = 20 * MIN;
  const el = status === 'departed' ? Math.min(1, (now - actual) / run2) : status === 'completed' ? 1 : 0;
  return { status, delay: dl, expected: exp, actual, completedAt, progress_m: el * L, speed_mps: status === 'departed' && L ? L / (run2 / 1000) : null, depAt: exp };
}

// ---------------------------------------------------------------- seats and crowd
export function slotPct(routeId, weekday, time, date) {
  const h = hash(routeId * 100000 + weekday * 1000 + Number(time.slice(0, 2)) * 60 + Number(time.slice(3)));
  const band = (h >>> 8) % 100;
  const base = band < 4 ? 93 + (h >>> 16) % 6 : band < 8 ? 8 + (h >>> 16) % 14 : 35 + (h >>> 16) % 48;
  const noise = (hash(h + dayNo(date)) % 9) - 4;
  return Math.max(2, Math.min(100, base + noise));
}
export function tripPct(d) {
  if (d.kind === 'cycle') return 12 + (hash(d.id * 3) % 70);
  const t = new Date(d.nominal);
  return slotPct(d.route_id, t.getDay(), hmOf(d.nominal), d.service_date);
}
export const confirmedCount = (tripId) => S.reservations.filter((r) => r.trip_id === tripId && r.status === 'confirmed').length;
export function seatInfo(d, bus, st) {
  const capacity = bus?.capacity ?? 0;
  const cancelled = st === 'cancelled';
  const base = cancelled ? 0 : Math.round((capacity * tripPct(d)) / 100);
  const mine = S.reservations.filter((r) => r.trip_id === d.id && r.status === 'confirmed');
  const reserved = Math.min(capacity, base + mine.length);
  const outside = mine.filter((r) => r.outside_route).length;
  return { capacity, reserved, available: Math.max(0, capacity - reserved), outside_reserved: outside };
}
const levelOf = (pct) => (pct < 40 ? 'low' : pct > 75 ? 'high' : 'medium');
function crowdFor(d, status) {
  if (['completed', 'cancelled'].includes(status)) return null;
  let pct;
  if (d.kind === 'cycle') pct = tripPct(d);
  else {
    const t = new Date(d.nominal); const time = hmOf(d.nominal);
    const xs = []; for (let w = 1; w <= 8; w += 1) xs.push(slotPct(d.route_id, t.getDay(), time, dateOfDayNo(dayNo(d.service_date) - 7 * w)));
    pct = median(xs);
  }
  const level = levelOf(pct);
  let quieter = null;
  if (level !== 'low' && d.kind === 'cycle') {
    const next = describe(d.id + 100);
    if (next) quieter = { time: hmOf(next.nominal), level: 'low', trip_id: next.id };
  }
  return { level, samples: 8, typical_pct: Math.round(pct), quieter_alternative: quieter };
}

// ---------------------------------------------------------------- bus status
export function liveCycleTrip(bus, now) {
  const ci = cycleInfo(bus);
  if (!ci) return null;
  const k = cycleK(ci, now);
  for (const kk of [k, k - 1]) { const d = describe(cycleId(bus, ci, kk)); if (d && resolve(d, now).status === 'departed') return d; }
  return null;
}
export function busStatus(bus, now) {
  if (bus.status === 'out_of_service') return 'out_of_service';
  const live = liveCycleTrip(bus, now);
  if (live) return resolve(live, now).delay > 0 ? 'delayed' : 'on_trip';
  return ['active', 'waiting', 'delayed'].includes(bus.status) ? bus.status : 'waiting';
}
export const busBrief = (bus, now) => ({ id: bus.id, number: bus.number, plate: bus.plate, status: busStatus(bus, now), status_note: bus.status_note, capacity: bus.capacity });
export const busRow = (bus, now = Date.now()) => ({
  ...bus, status: busStatus(bus, now), driver_name: driverOf(bus.driver_id)?.name ?? null, route_code: routeOf(bus.route_id)?.code ?? null, route_name: routeOf(bus.route_id)?.name ?? null,
});

// ---------------------------------------------------------------- the view the UI uses
/** ETA to a point `dist` metres along the trip path. Never invents a live ETA from the clock alone (same strategies as the real API). */
function makeEta({ trip, r, geom, route, pos, now }) {
  const avg = ((route.avg_speed_kmh ?? 28) * 1000) / 3600;
  return (dist) => {
    const base = { kind: 'unavailable', seconds: null, arrival: null, basis: '' };
    if (dist == null) return { ...base, basis: 'Collection point has no valid coordinates' };
    if (r.status === 'cancelled') return { ...base, basis: 'Trip cancelled' };
    if (r.status === 'completed') return { ...base, basis: 'Trip completed' };
    const mk = (kind, seconds, basis) => ({ kind, seconds: Math.max(0, Math.round(seconds)), arrival: iso(now + Math.max(0, seconds) * 1000), basis });
    const intermediate = (from) => geom.stops.filter((s) => s.dist != null && s.dist > from && s.dist < dist).length;
    return (etaStrategies[r.status] ?? etaStrategies.scheduled)({ trip, geom, route, pos, stopDist: dist, now, avg, base, mk, intermediate });
  };
}
/** ETA of a trip's arrival at the campus (the end of its path). */
export function campusEtaOf(idOrDesc, now = Date.now()) {
  const d = typeof idOrDesc === 'object' ? idOrDesc : describe(idOrDesc);
  const route = d && routeOf(d.route_id);
  if (!route) return null;
  const r = resolve(d, now); const geom = routeGeometry(route.id, d.direction);
  const trip = { status: r.status, progress_m: r.progress_m, speed_mps: r.speed_mps, scheduled_departure: iso(d.nominal), delay_minutes: r.delay };
  const pos = { fresh: true, age_sec: 1 };
  return makeEta({ trip, r, geom, route, pos, now })(geom.path.length);
}

export function tripView(idOrDesc, now = Date.now()) {
  const d = typeof idOrDesc === 'object' ? idOrDesc : describe(idOrDesc);
  if (!d) return null;
  const bus = busOf(d.bus_id); const route = routeOf(d.route_id);
  if (!bus || !route) return null;
  const r = resolve(d, now);
  const ov = S.tripOv[d.id] ?? {};
  const driverId = ov.driver_id !== undefined ? ov.driver_id : d.driver_id;
  const dr = driverId ? driverOf(driverId) : null;
  const geom = routeGeometry(route.id, d.direction);
  const L = geom.path.length;
  const trip = { status: r.status, progress_m: r.progress_m, speed_mps: r.speed_mps, scheduled_departure: iso(d.nominal), delay_minutes: r.delay };
  let pos = null;
  if (r.status === 'departed' && L) { const p = pointAt(geom.path, r.progress_m); pos = { lat: p.lat, lng: p.lng, age_sec: 1, fresh: true, source: 'demo', speed_mps: r.speed_mps }; }
  else if (geom.campus) pos = { lat: geom.campus.lat, lng: geom.campus.lng, age_sec: 2, fresh: true, source: 'demo', speed_mps: 0 };
  const etaOf = makeEta({ trip, r, geom, route, pos, now });
  const expectedIso = iso(r.expected);
  const overdue = (r.status === 'scheduled' || r.status === 'preparing') && r.expected < now - 60000;
  return {
    id: d.id, status: r.status, direction: d.direction ?? null, source: d.source, service_date: d.service_date,
    scheduled_departure: iso(d.nominal), expected_departure: expectedIso, actual_departure: r.actual ? iso(r.actual) : null, delay_minutes: r.delay,
    overdue_minutes: overdue ? Math.round((now - r.expected) / 60000) : 0,
    allow_outside: !!(ov.allow_outside ?? d.allow_outside), outside_limit: ov.outside_limit ?? d.outside_limit,
    off_route: false, progress: L ? Math.min(1, r.progress_m / L) : 0,
    route: { id: route.id, code: route.code, name: route.name, area: route.area },
    bus: busBrief(bus, now),
    driver: dr && { id: dr.id, name: dr.name, phone: dr.phone },
    position: pos, seats: seatInfo(d, bus, r.status), crowd: crowdFor(d, r.status),
    stops: geom.stops.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng, seq: s.seq, eta: etaOf(s.dist) })),
    campus: geom.campus && { id: geom.campus.id, name: geom.campus.name, lat: geom.campus.lat, lng: geom.campus.lng },
  };
}

// ---------------------------------------------------------------- collections of trips
/** Timetable (+ manual) trips for one date, built from the active schedules. */
export function timetableTripsOn(date) {
  const wk = dayKey(parseYmd(date));
  const out = [];
  for (const sc of S.schedules) {
    if (!sc.active || sc.bus_id == null || !sc.days.split(',').includes(wk)) continue;
    const route = routeOf(sc.route_id);
    if (!route?.active) continue;
    const d = describe(100000000 + dayNo(date) * 1000 + sc.id);
    if (d) out.push(d);
  }
  for (const m of S.manualTrips) if (m.service_date === date) out.push(describe(m.id));
  return out.filter(Boolean).sort((a, b) => a.nominal - b.nominal);
}
const demoTripsAround = (now, before, after) => {
  const out = [];
  for (const bus of S.buses) {
    const ci = cycleInfo(bus);
    if (!ci) continue;
    const k0 = cycleK(ci, now);
    for (let k = k0 - before; k <= k0 + after; k += 1) { const d = describe(cycleId(bus, ci, k)); if (d) out.push(d); }
  }
  return out;
};
const ORDER = { departed: 0, preparing: 1, scheduled: 2 };

/** Trips a student cares about right now: moving, about to leave, or scheduled soon. */
export function liveBoard(now = Date.now()) {
  const cands = [...demoTripsAround(now, 1, 2), ...timetableTripsOn(ymd(new Date(now)))];
  const views = [];
  for (const d of cands) {
    const r = resolve(d, now);
    if (!['scheduled', 'preparing', 'departed'].includes(r.status)) continue;
    if (d.kind !== 'cycle' && !(r.expected > now - 60 * MIN && r.expected < now + 150 * MIN)) continue;
    const v = tripView(d, now);
    if (v) views.push(v);
  }
  return views.sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.expected_departure.localeCompare(b.expected_departure));
}

/** Trips shown to an admin for a date: the timetable plus, for today, the demo trips around now. */
export function tripsOnDate(date, now = Date.now()) {
  const today = ymd(new Date(now));
  const list = timetableTripsOn(date);
  if (date === today) list.push(...demoTripsAround(now, 2, 3).filter((d) => d.service_date === today));
  return list.sort((a, b) => a.nominal - b.nominal);
}

/** One current trip per bus (the one the monitor shows). */
export function currentTripOfBus(bus, now) {
  const ci = cycleInfo(bus);
  if (!ci) return null;
  const k = cycleK(ci, now);
  for (const kk of [k - 1, k, k + 1]) { const d = describe(cycleId(bus, ci, kk)); if (d && resolve(d, now).status === 'departed') return d; }
  for (const kk of [k, k + 1]) { const d = describe(cycleId(bus, ci, kk)); if (d && ['preparing', 'scheduled'].includes(resolve(d, now).status)) return d; }
  return null;
}

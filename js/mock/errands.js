// Errand planner for the mock backend: the same plan engine as the real API (planner.js), fed from the mock state.
import { S, nextId } from './state.js';
import { planErrands, UNCERTAINTY } from './planner.js';
import { haversine } from './geo.js';
import { placeView, isOpenAt, hm, normalise, CATEGORIES } from './places.js';
import { campus, tripView, timetableTripsOn, cycleTripsBetween, campusEtaOf, describe } from './trips.js';
import { bad, MIN, iso, ymd, dayKey, localToMs, nowIso } from './util.js';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const MAX_STOPS = 8;
const WALK_M_PER_MIN = 80;
const MODES = ['walk', 'taxi', 'transit', 'car'];
const ROUTING = { detour: 1.4, speedKmh: { walk: 4.8, taxi: 20, car: 20, transit: 15 }, transitWaitMin: 8 };
const WALK_TO_STOP_MAX_M = 600;
const CAMPUS_WALK_DEFAULT_MIN = 5;
const ARRIVAL_BUFFER_MIN = 10;

const toMs = (hhmm, date) => localToMs(date, hhmm);
export const classesOn = (userId, day) => S.classes.filter((c) => c.user_id === userId && c.day === day).sort((a, b) => a.start.localeCompare(b.start));

function campusPlace() {
  const c = campus();
  return { id: 'campus', name_en: 'Campus', name_ar: 'الجامعة', area: 'campus', category: 'campus', lat: c?.lat ?? null, lng: c?.lng ?? null, walk_min_from_campus_stop: 0, default_stay_min: 0, opens: null, closes: null, closed_days: null };
}
const coordsOf = (p, cp) => (p.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng } : p.area === 'campus' && cp.lat != null ? { lat: cp.lat, lng: cp.lng } : null);

const round5 = (n) => Math.max(5, Math.round(n / 5) * 5);
/** Rough fares in EGP: a taxi or ride-hailing trip, a microbus, or fuel for your own car. Walking is free, and so is the university bus. */
const COST = {
  walk: () => [0, 0],
  taxi: (km) => [round5(15 + 5 * km * 0.9), round5(20 + 7 * km * 1.15)],
  transit: (km) => [5, round5(5 + km * 1.2)],
  car: (km) => [round5(km * 2), round5(km * 3.5)],
};

function estimate(from, to, mode) {
  const dist = haversine(from, to) * ROUTING.detour;
  const mins = (dist / 1000 / ROUTING.speedKmh[mode]) * 60 + (mode === 'transit' ? ROUTING.transitWaitMin : 0);
  return { minutes_min: mins, minutes_max: mins, distance_m: Math.round(dist), basis: 'Rough estimate (straight line)', provider: 'estimate', cost: COST[mode]?.(dist / 1000) ?? null };
}

const BUS_HORIZON_MIN = 300;
/** Every university bus still to come (or running now): today's timetable plus the loop buses that keep circling all day. */
function liveBuses(now) {
  const seen = new Set();
  return [...timetableTripsOn(ymd(new Date(now))), ...cycleTripsBetween(now - 10 * MIN, now + BUS_HORIZON_MIN * MIN)]
    .filter((d) => d && !seen.has(d.id) && seen.add(d.id))
    .map((d) => ({ d, view: tripView(d, now) }))
    .filter((x) => x.view && ['scheduled', 'preparing', 'departed'].includes(x.view.status));
}
/** Buses of the student's own route, each with its arrival time at the campus. */
const busTrips = (user, board, now) => (user.route_id ? board.filter((x) => x.d.route_id === user.route_id).map((x) => ({ view: x.view, campus: campusEtaOf(x.d, now) })) : []);
const etaLabel = (k) => (k === 'live' ? 'Live bus ETA' : k === 'estimate' ? 'Estimate' : 'Scheduled estimate');

function busOption(trips, cp, from, to, at) {
  const out = from.area === 'campus' ? to : to.area === 'campus' ? from : null;
  if (!out || out.area === 'campus') return null;
  const oc = coordsOf(out, cp);
  if (!oc || !trips.length) return null;
  const toCampus = to.area === 'campus';
  const sample = trips[0].view.stops;
  let near = null;
  for (const s of sample) { const d = haversine({ lat: oc.lat, lng: oc.lng }, { lat: s.lat, lng: s.lng }); if (!near || d < near.d) near = { id: s.id, name: s.name, d }; }
  if (!near || near.d > WALK_TO_STOP_MAX_M) return null;
  const walk = (near.d * 1.4) / WALK_M_PER_MIN;
  const cands = [];
  for (const { view, campus: ce } of trips) {
    const stop = view.stops.find((s) => s.id === near.id);
    if (!stop) continue;
    // A timetable trip runs one way; a loop bus (no direction) leaves the campus, passes every point and comes back.
    const outbound = view.direction !== 'to_campus'; const inbound = view.direction !== 'from_campus';
    if (!toCampus && outbound && ['scheduled', 'preparing'].includes(view.status) && stop.eta.arrival) {
      const dep = new Date(view.expected_departure).getTime();
      if (dep < at) continue;
      const arr = new Date(stop.eta.arrival).getTime();
      cands.push({ view, key: dep, notBefore: dep, nominal: (arr - dep) / MIN + walk, kind: 'bus_scheduled', label: etaLabel(stop.eta.kind), boardAt: dep });
    } else if (toCampus && inbound && ['live', 'scheduled', 'estimate'].includes(stop.eta.kind) && stop.eta.arrival && ce?.arrival && ['live', 'scheduled', 'estimate'].includes(ce.kind)) {
      const atStop = new Date(stop.eta.arrival).getTime();
      if (atStop < at + walk * MIN) continue;
      const arr = new Date(ce.arrival).getTime();
      cands.push({ view, key: arr, notBefore: atStop - walk * MIN, nominal: walk + (arr - atStop) / MIN, kind: stop.eta.kind === 'live' ? 'bus_live' : 'bus_scheduled', label: etaLabel(stop.eta.kind), boardAt: atStop });
    }
  }
  cands.sort((a, b) => a.key - b.key);
  const c = cands[0];
  if (!c) return { mode: 'bus', estimable: false, warnings: ['No bus on your route fits this trip today'], nominal_min: 0, factor_key: 'bus_scheduled', basis: '' };
  return {
    mode: 'bus', nominal_min: c.nominal, factor_key: c.kind, not_before: c.notBefore, basis: c.label, cost: [0, 0],
    meta: {
      trip_id: c.view.id, bus_number: c.view.bus.number, board_at: iso(c.boardAt), stop_name: near.name, expected_departure: c.view.expected_departure, trip_status: c.view.status,
      next: cands.slice(1, 3).map((n) => ({ trip_id: n.view.id, bus_number: n.view.bus.number, board_at: iso(n.boardAt), label: n.label })),
    },
  };
}

function makeGetLeg({ user, board, now, cp }) {
  const trips = busTrips(user, board, now);
  return (from, to, at) => {
    const opts = [];
    if (from.area === 'campus' && to.area === 'campus') {
      const set = to.walk_min_from_campus_stop;
      opts.push({ mode: 'walk', nominal_min: set ?? CAMPUS_WALK_DEFAULT_MIN, factor_key: 'walk', basis: set != null ? 'Walking time set by the office' : 'Typical campus walk', cost: [0, 0] });
      return opts;
    }
    const bus = busOption(trips, cp, from, to, at);
    if (bus) opts.push(bus);
    const ca = coordsOf(from, cp); const cb = coordsOf(to, cp);
    if (ca && cb) {
      for (const mode of MODES) {
        const r = estimate(ca, cb, mode);
        if (mode === 'walk' && r.minutes_min > 45) continue;
        opts.push({ mode, nominal_min: r.minutes_min, factor_key: mode === 'walk' ? 'walk' : mode, basis: r.basis, cost: r.cost, meta: { distance_m: r.distance_m, provider: r.provider } });
      }
    }
    if (!opts.some((o) => o.estimable !== false)) {
      const missing = [from, to].filter((p) => !coordsOf(p, cp)).map((p) => p.name_en);
      opts.push({ mode: 'unknown', estimable: false, nominal_min: 0, factor_key: 'walk', basis: '', warnings: [missing.length ? `${missing.join(' and ')} has no coordinates` : 'No estimate is available'] });
    }
    return opts;
  };
}

const isoOrNull = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const placeOut = (p) => (p ? { id: p.id, name_en: p.name_en, name_ar: p.name_ar, area: p.area, category: p.category } : null);

function alternatives(cp, stopRow, prevPlace, stopPlace) {
  if (!stopPlace.category || stopPlace.category === 'other' || stopPlace.category === 'campus') return [];
  const mid = (stopRow.arrive_range[0] + (Number.isFinite(stopRow.arrive_range[1]) ? stopRow.arrive_range[1] : stopRow.arrive_range[0])) / 2;
  const pc = coordsOf(prevPlace, cp);
  return S.places.filter((p) => p.active && !p.owner_id && p.category === stopPlace.category && p.id !== stopPlace.id)
    .filter((p) => isOpenAt(p, mid))
    .map((p) => {
      const c = coordsOf(p, cp);
      const d = pc && c ? (haversine({ lat: pc.lat, lng: pc.lng }, { lat: c.lat, lng: c.lng }) * 1.4) / 1000 : null;
      return { place: placeOut(p), rough_minutes: d == null ? null : Math.round((d / 20) * 60), basis: 'Rough estimate (straight line)', _sort: d ?? 1e9 };
    })
    .sort((a, b) => a._sort - b._sort).slice(0, 3).map(({ _sort, ...r }) => r);
}

const BUS_NEAR_MAX_M = 2500;
/** University buses (any route) that pass a collection point near an outside stop: ones heading back to campus after the visit, and ones arriving there before it. */
function busesNear(cp, place, row, board, now) {
  const oc = coordsOf(place, cp);
  if (!oc || place.area === 'campus') return [];
  const end = (r, i) => (Number.isFinite(r?.[i]) ? r[i] : r?.[0]);
  const leaveAt = end(row.leave_range, 0); const arriveBy = end(row.arrive_range, 1);
  const best = new Map();
  for (const { view } of board) {
    let near = null;
    for (const s of view.stops) { const m = haversine(oc, { lat: s.lat, lng: s.lng }); if (!near || m < near.d) near = { s, d: m }; }
    if (!near || near.d > BUS_NEAR_MAX_M || !near.s.eta?.arrival || near.s.eta.kind === 'passed') continue;
    const at = new Date(near.s.eta.arrival).getTime();
    // Home: a bus that passes after you leave. There: a bus that passes before you arrive. A loop bus can do either.
    const kind = view.direction !== 'from_campus' && at >= leaveAt ? 'to_campus' : view.direction !== 'to_campus' && at <= arriveBy && at >= now ? 'from_campus' : null;
    if (!kind) continue;
    const key = `${view.route.id}:${kind}`; const prior = best.get(key);
    // Keep the first bus home, and the last bus that still gets you there on time.
    if (prior && (kind === 'to_campus' ? prior._at <= at : prior._at >= at)) continue;
    best.set(key, { trip_id: view.id, bus_number: view.bus.number, route_code: view.route.code, route_name: view.route.name, stop_name: near.s.name, walk_min: Math.max(1, Math.round((near.d * 1.4) / WALK_M_PER_MIN)), direction: kind, at: iso(at), label: etaLabel(near.s.eta.kind), _at: at });
  }
  return [...best.values()].sort((a, b) => a._at - b._at).slice(0, 4).map(({ _at, ...x }) => x);
}

/** Where the student has to be at the end: the building of the next class if we know it, otherwise the campus gate. */
function endPlaceFor(cp, blocks, startAt) {
  const next = blocks.filter((b) => b.start > startAt).sort((a, b) => a.start - b.start)[0];
  const key = normalise(next?.location_text);
  return (key && S.places.find((p) => p.active && p.area === 'campus' && normalise(p.name_en) === key)) || cp;
}

/** body: { start_at?, origin_place_id?, stops:[{place_id, stay_min?, arrive_by?}], finish_by?, use_schedule?, chosen_modes?, prev? } */
export function buildPlan(user, body, now = Date.now()) {
  const date = ymd(new Date(now));
  const rawStops = Array.isArray(body?.stops) ? body.stops : [];
  if (!rawStops.length) throw bad('Add at least one stop');
  if (rawStops.length > MAX_STOPS) throw bad(`You can plan up to ${MAX_STOPS} stops`);
  const cp = campusPlace();
  let origin = cp;
  if (body.origin_place_id != null && body.origin_place_id !== 'campus') {
    origin = S.places.find((p) => p.id === Number(body.origin_place_id) && p.active);
    if (!origin) throw bad('Starting place not found');
  }
  const stops = rawStops.map((s, i) => {
    const place = S.places.find((p) => p.id === Number(s?.place_id) && p.active);
    if (!place) throw bad(`Stop ${i + 1}: place not found`);
    const stay = s.stay_min == null || s.stay_min === '' ? place.default_stay_min : Number(s.stay_min);
    if (!Number.isFinite(stay) || stay < 0 || stay > 480) throw bad(`Stop ${i + 1}: stay must be 0 to 480 minutes`);
    if (s.arrive_by != null && s.arrive_by !== '' && !HHMM.test(s.arrive_by)) throw bad(`Stop ${i + 1}: arrive-by must be HH:MM`);
    return { place, stay_min: stay, arrive_by: s.arrive_by ? toMs(s.arrive_by, date) : null };
  });
  for (const t of [body.start_at, body.finish_by]) if (t != null && t !== '' && !HHMM.test(t)) throw bad('Times must be HH:MM');
  const chosen = Array.isArray(body.chosen_modes) ? body.chosen_modes.map((m) => (m == null ? null : [...MODES, 'bus'].includes(m) ? m : null)) : [];
  const board = liveBuses(now);
  const getLeg = makeGetLeg({ user, board, now, cp });
  const todayClasses = body.use_schedule === false ? [] : classesOn(user.id, dayKey(new Date(now)));
  const fixedBlocks = todayClasses.map((c) => ({ title: c.title, location_text: c.location_text, start: toMs(c.start, date), end: toMs(c.end, date) }));
  const startAt = Math.max(body.start_at ? toMs(body.start_at, date) : now, now);

  // The trip back matters: a class is judged on when you are THERE, not on when you leave the last stop.
  // Unless told otherwise, come back when a class (and no explicit finish time) sets the deadline.
  const wantsReturn = typeof body.return_to_campus === 'boolean' ? body.return_to_campus : !body.finish_by && fixedBlocks.some((b) => b.start > startAt);
  let endPlace = wantsReturn ? endPlaceFor(cp, fixedBlocks, startAt) : null;
  if (endPlace && stops[stops.length - 1].place.id === endPlace.id) endPlace = null;

  const plan = planErrands({
    now, startAt, origin, stops, getLeg, finishBy: body.finish_by ? toMs(body.finish_by, date) : null,
    uncertainty: UNCERTAINTY, fixedBlocks, chosenModes: chosen, bufferMin: ARRIVAL_BUFFER_MIN, endPlace,
  });

  const legs = plan.legs.map((l) => ({
    index: l.index, from: placeOut(l.from), to: placeOut(l.to), mode: l.mode, estimable: l.estimable, basis: l.basis ?? null, uncertainty_pct: l.uncertainty_pct ?? null,
    minutes_min: l.minutes_min != null ? Math.round(l.minutes_min) : null, minutes_max: l.minutes_max != null && Number.isFinite(l.minutes_max) ? Math.round(l.minutes_max) : null,
    start_range: l.start_range?.map(isoOrNull), end_range: l.end_range?.map(isoOrNull), cost: l.cost ?? null, meta: l.meta ?? null,
    options: (l.options ?? []).map((o) => ({ mode: o.mode, minutes_min: Math.round(o.minutes_min), minutes_max: Math.round(o.minutes_max), basis: o.basis, cost: o.cost })),
  }));
  const stopsOut = plan.stops.map((r, i) => (r.estimable === false ? { index: i, place: placeOut(r.place), estimable: false, is_return: i >= stops.length } : {
    index: i, place: placeOut(r.place), stay_min: r.stay_min, arrive_by: r.arrive_by ? hm(r.arrive_by) : null, status: r.status, open_at_arrival: r.open_at_arrival,
    is_return: r.is_return, wait_min: r.wait_min,
    arrive_range: r.arrive_range.map(isoOrNull), leave_range: r.leave_range.map(isoOrNull), campus_buses: r.is_return ? [] : busesNear(cp, r.place, r, board, now),
    backups: { modes: legs[i]?.options ?? [], places: r.is_return ? [] : alternatives(cp, r, i === 0 ? origin : stops[i - 1].place, stops[i].place), buses: legs[i]?.meta?.next ?? [] },
  }));
  const changed = [];
  for (const p of Array.isArray(body.prev) ? body.prev.slice(0, MAX_STOPS) : []) {
    const cur = legs[p?.leg];
    if (!cur || p.mode !== 'bus') continue;
    const was = { trip_id: p.trip_id ?? null, expected_departure: p.expected_departure ?? null };
    const nowv = cur.mode === 'bus' ? { trip_id: cur.meta?.trip_id ?? null, expected_departure: cur.meta?.expected_departure ?? null } : { trip_id: null, expected_departure: null };
    const moved = was.expected_departure && nowv.expected_departure && Math.abs(new Date(was.expected_departure) - new Date(nowv.expected_departure)) >= MIN;
    if (was.trip_id !== nowv.trip_id || moved) changed.push({ leg: p.leg, was, now: nowv });
  }
  const offCampusEstimates = legs.some((l) => l.mode && l.mode !== 'bus' && (l.from?.area === 'off_campus' || l.to?.area === 'off_campus') && !String(l.basis).startsWith('Road route'));
  return {
    verdict: plan.verdict, slack_min: plan.slack_min, cost_range: plan.cost_range, return_to: endPlace ? placeOut(endPlace) : null, leave_by: plan.leave_by ? hm(plan.leave_by) : null, leave_by_iso: isoOrNull(plan.leave_by),
    finish_range: plan.finish_range?.map(isoOrNull) ?? null, finish_by: plan.finish_by ? hm(plan.finish_by) : null, finish_source: plan.finish_source,
    start_at: isoOrNull(plan.start_at), origin: placeOut(origin), legs, stops: stopsOut, warnings: plan.warnings.map(({ code, leg, place, text }) => ({ code, leg, place, text })),
    suggestions: plan.suggestions.map((s) => ({ drop_index: s.drop_index, place: placeOut(s.place), resulting_verdict: s.resulting_verdict })),
    conflicts: plan.conflicts.map((b) => ({ title: b.title, start: hm(b.start), end: hm(b.end), location_text: b.location_text })),
    fixed_blocks: fixedBlocks.map((b) => ({ title: b.title, location_text: b.location_text, start: hm(b.start), end: hm(b.end), start_iso: isoOrNull(b.start), end_iso: isoOrNull(b.end) })),
    basis_notes: plan.basis_notes, routing_provider: 'estimate', offcampus_estimates: offCampusEstimates,
    changed, generated_at: isoOrNull(now),
  };
}

// ---- saved plans (kept for 7 days, structured stops only) ----
const SAVE_DAYS = 7;
const purgeExpired = (now) => { S.plans = S.plans.filter((p) => new Date(p.expires_at).getTime() > now); };
export function savePlan(userId, body, now = Date.now()) {
  purgeExpired(now);
  if (S.plans.filter((p) => p.user_id === userId).length >= 10) throw bad('You can save up to 10 plans');
  const stops = (Array.isArray(body?.stops) ? body.stops : []).slice(0, MAX_STOPS).map((s) => ({ place_id: Number(s.place_id), stay_min: s.stay_min == null ? null : Number(s.stay_min), arrive_by: HHMM.test(s.arrive_by ?? '') ? s.arrive_by : null }));
  if (!stops.length || stops.some((s) => !Number.isInteger(s.place_id) || !S.places.some((p) => p.id === s.place_id))) throw bad('Plan has no valid stops');
  const payload = { stops, origin_place_id: body.origin_place_id === 'campus' || body.origin_place_id == null ? 'campus' : Number(body.origin_place_id), finish_by: HHMM.test(body.finish_by ?? '') ? body.finish_by : null, name: String(body.name ?? '').slice(0, 60) || null };
  const row = { id: nextId('plan'), user_id: userId, created_at: nowIso(), expires_at: iso(now + SAVE_DAYS * 86400000), ...payload };
  S.plans.push(row);
  return { id: row.id, ...payload };
}
export function listPlans(userId, now = Date.now()) {
  purgeExpired(now);
  return S.plans.filter((p) => p.user_id === userId).sort((a, b) => b.id - a.id).map(({ user_id, ...p }) => p);
}
export { placeView, CATEGORIES, describe };

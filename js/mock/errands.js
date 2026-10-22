// Errand planner for the mock backend: the same plan engine as the real API (planner.js), fed from the mock state.
import { S, nextId } from './state.js';
import { planErrands, UNCERTAINTY } from './planner.js';
import { haversine } from './geo.js';
import { placeView, isOpenAt, hm, CATEGORIES } from './places.js';
import { campus, tripView, timetableTripsOn, campusEtaOf, describe } from './trips.js';
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

function estimate(from, to, mode) {
  const dist = haversine(from, to) * ROUTING.detour;
  const mins = (dist / 1000 / ROUTING.speedKmh[mode]) * 60 + (mode === 'transit' ? ROUTING.transitWaitMin : 0);
  return { minutes_min: mins, minutes_max: mins, distance_m: Math.round(dist), basis: 'Rough estimate (straight line)', provider: 'estimate' };
}

function busTrips(user, now) {
  if (!user.route_id) return [];
  return timetableTripsOn(ymd(new Date(now))).filter((d) => d.route_id === user.route_id)
    .map((d) => ({ view: tripView(d, now), campus: campusEtaOf(d, now) }))
    .filter((x) => x.view && ['scheduled', 'preparing', 'departed'].includes(x.view.status));
}
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
    if (!toCampus && view.direction === 'from_campus' && ['scheduled', 'preparing'].includes(view.status) && stop.eta.arrival) {
      const dep = new Date(view.expected_departure).getTime();
      if (dep < at) continue;
      const arr = new Date(stop.eta.arrival).getTime();
      cands.push({ view, key: dep, notBefore: dep, nominal: (arr - dep) / MIN + walk, kind: 'bus_scheduled', label: etaLabel(stop.eta.kind), boardAt: dep });
    } else if (toCampus && view.direction === 'to_campus' && ['live', 'scheduled', 'estimate'].includes(stop.eta.kind) && stop.eta.arrival && ce?.arrival && ['live', 'scheduled', 'estimate'].includes(ce.kind)) {
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
    mode: 'bus', nominal_min: c.nominal, factor_key: c.kind, not_before: c.notBefore, basis: c.label,
    meta: {
      trip_id: c.view.id, bus_number: c.view.bus.number, board_at: iso(c.boardAt), stop_name: near.name, expected_departure: c.view.expected_departure, trip_status: c.view.status,
      next: cands.slice(1, 3).map((n) => ({ trip_id: n.view.id, bus_number: n.view.bus.number, board_at: iso(n.boardAt), label: n.label })),
    },
  };
}

function makeGetLeg({ user, now, cp }) {
  const trips = busTrips(user, now);
  return (from, to, at) => {
    const opts = [];
    if (from.area === 'campus' && to.area === 'campus') {
      const set = to.walk_min_from_campus_stop;
      opts.push({ mode: 'walk', nominal_min: set ?? CAMPUS_WALK_DEFAULT_MIN, factor_key: 'walk', basis: set != null ? 'Walking time set by the office' : 'Typical campus walk' });
      return opts;
    }
    const bus = busOption(trips, cp, from, to, at);
    if (bus) opts.push(bus);
    const ca = coordsOf(from, cp); const cb = coordsOf(to, cp);
    if (ca && cb) {
      for (const mode of MODES) {
        const r = estimate(ca, cb, mode);
        if (mode === 'walk' && r.minutes_min > 45) continue;
        opts.push({ mode, nominal_min: r.minutes_min, factor_key: mode === 'walk' ? 'walk' : mode, basis: r.basis, cost: null, meta: { distance_m: r.distance_m, provider: r.provider } });
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
  return S.places.filter((p) => p.active && p.category === stopPlace.category && p.id !== stopPlace.id)
    .filter((p) => isOpenAt(p, mid))
    .map((p) => {
      const c = coordsOf(p, cp);
      const d = pc && c ? (haversine({ lat: pc.lat, lng: pc.lng }, { lat: c.lat, lng: c.lng }) * 1.4) / 1000 : null;
      return { place: placeOut(p), rough_minutes: d == null ? null : Math.round((d / 20) * 60), basis: 'Rough estimate (straight line)', _sort: d ?? 1e9 };
    })
    .sort((a, b) => a._sort - b._sort).slice(0, 3).map(({ _sort, ...r }) => r);
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
  const getLeg = makeGetLeg({ user, now, cp });
  const todayClasses = body.use_schedule === false ? [] : classesOn(user.id, dayKey(new Date(now)));
  const fixedBlocks = todayClasses.map((c) => ({ title: c.title, location_text: c.location_text, start: toMs(c.start, date), end: toMs(c.end, date) }));

  const plan = planErrands({
    now, startAt: body.start_at ? toMs(body.start_at, date) : now, origin, stops, getLeg, finishBy: body.finish_by ? toMs(body.finish_by, date) : null,
    uncertainty: UNCERTAINTY, fixedBlocks, chosenModes: chosen, bufferMin: ARRIVAL_BUFFER_MIN,
  });

  const legs = plan.legs.map((l) => ({
    index: l.index, from: placeOut(l.from), to: placeOut(l.to), mode: l.mode, estimable: l.estimable, basis: l.basis ?? null, uncertainty_pct: l.uncertainty_pct ?? null,
    minutes_min: l.minutes_min != null ? Math.round(l.minutes_min) : null, minutes_max: l.minutes_max != null && Number.isFinite(l.minutes_max) ? Math.round(l.minutes_max) : null,
    start_range: l.start_range?.map(isoOrNull), end_range: l.end_range?.map(isoOrNull), cost: l.cost ?? null, meta: l.meta ?? null,
    options: (l.options ?? []).map((o) => ({ mode: o.mode, minutes_min: Math.round(o.minutes_min), minutes_max: Math.round(o.minutes_max), basis: o.basis, cost: o.cost })),
  }));
  const stopsOut = plan.stops.map((r, i) => (r.estimable === false ? { index: i, place: placeOut(r.place), estimable: false } : {
    index: i, place: placeOut(r.place), stay_min: r.stay_min, arrive_by: r.arrive_by ? hm(r.arrive_by) : null, status: r.status, open_at_arrival: r.open_at_arrival,
    arrive_range: r.arrive_range.map(isoOrNull), leave_range: r.leave_range.map(isoOrNull),
    backups: { modes: legs[i]?.options ?? [], places: alternatives(cp, r, i === 0 ? origin : stops[i - 1].place, stops[i].place), buses: legs[i]?.meta?.next ?? [] },
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
    verdict: plan.verdict, leave_by: plan.leave_by ? hm(plan.leave_by) : null, leave_by_iso: isoOrNull(plan.leave_by),
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

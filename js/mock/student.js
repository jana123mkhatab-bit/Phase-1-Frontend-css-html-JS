// Public + student endpoints of the mock backend. Shapes follow the real API.
import { S, nextId } from './state.js';
import { MockError, bad, notFound, conflict, forbidden, str, int, num, oneOf, bool, nowIso, iso, ymd, dayKey, hmOf, MIN, dayNo, dateOfDayNo, parseYmd } from './util.js';
import { haversine } from './geo.js';
import {
  liveBoard, tripView, describe, resolve, busOf, routeOf, stopOf, routeStopRows, timetableTripsOn, campusEtaOf, confirmedCount,
} from './trips.js';
import {
  publicUser, requireRole, audit, notify, unreadCount, activeUpdates, routeCatalog, students, runNotificationPass,
} from './common.js';
import { buildPlan, savePlan, listPlans, classesOn } from './errands.js';
import { normalise, placeView, isOpenAt, hm, CATEGORIES, CATEGORY_DEFAULTS } from './places.js';

const MAX_FAVORITES = 10;
const LEAD_MINUTES = [30, 45, 60, 90];
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const passwordStrength = (pw) => {
  if (typeof pw !== 'string' || pw.length < 8) throw bad('Password must be at least 8 characters');
  if (pw.length > 100) throw bad('Password is too long');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw bad('Password must contain letters and numbers');
};

/** The closest collection point on a running route (one that has a bus), so every outside place can say which university bus serves it. */
function nearBusStop(p) {
  if (p.area === 'campus' || p.lat == null || p.lng == null) return null;
  const withBus = new Set(S.buses.filter((b) => b.route_id != null).map((b) => b.route_id));
  let best = null;
  for (const r of S.routes) {
    if (!r.active || !withBus.has(r.id)) continue;
    for (const id of S.routeStops[r.id] ?? []) {
      const s = stopOf(id); if (!s) continue;
      const d = haversine({ lat: p.lat, lng: p.lng }, { lat: s.lat, lng: s.lng });
      if (!best || d < best.d) best = { d, stop: s.name, route_code: r.code, route_name: r.name, buses: S.buses.filter((b) => b.route_id === r.id).map((b) => b.number) };
    }
  }
  return best && { stop_name: best.stop, route_code: best.route_code, route_name: best.route_name, buses: best.buses, distance_m: Math.round(best.d) };
}

const favRow =(f) => ({ id: f.id, route_id: f.route_id, stop_id: f.stop_id, label: f.label, route_code: routeOf(f.route_id)?.code, route_name: routeOf(f.route_id)?.name, stop_name: stopOf(f.stop_id)?.name });

/** reservation joined with its trip, or null when the trip no longer exists */
function joined(rs, now) {
  const d = describe(rs.trip_id);
  if (!d) return null;
  const r = resolve(d, now);
  const bus = busOf(d.bus_id); const route = routeOf(d.route_id);
  return { rs, d, r, bus, route };
}

function reserve({ user, tripId, stopId, madeBy = 'student', note = null, override = false, now = Date.now() }) {
  const d = describe(tripId);
  if (!d) throw notFound('Trip not found');
  const r = resolve(d, now);
  if (!['scheduled', 'preparing'].includes(r.status)) throw conflict('This trip has already left or finished, reservations are closed', 'closed');
  const bus = busOf(d.bus_id); const route = routeOf(d.route_id);
  if (bus.status === 'out_of_service') throw conflict('This bus is out of service', 'out_of_service');
  if (!route.active) throw conflict('This route is not active');
  if (stopId != null && !(S.routeStops[d.route_id] ?? []).includes(stopId)) throw bad('That collection point is not on this route');
  if (S.reservations.some((x) => x.user_id === user.id && x.trip_id === tripId && x.status === 'confirmed')) throw conflict('You already have a seat on this trip', 'duplicate');
  const view = tripView(d, now);
  const outside = user.route_id !== d.route_id ? 1 : 0;
  if (!outside && !override && madeBy === 'student') throw conflict('You are already registered on this route, so your seat is already covered. Reservations are only for buses outside your route.', 'own_route');
  if (outside && !override && !view.allow_outside) throw forbidden('Seats on this trip are reserved for students assigned to its route');
  if (outside && !override && view.seats.outside_reserved >= view.outside_limit) throw conflict('The seats open to other routes on this trip are taken', 'outside_full');
  if (view.seats.available <= 0) throw conflict('This bus is full', 'full');
  const row = { id: nextId('res'), user_id: user.id, trip_id: tripId, stop_id: stopId ?? null, status: 'confirmed', outside_route: outside, made_by: madeBy, cancelled_by: null, note, created_at: nowIso(), cancelled_at: null };
  S.reservations.push(row);
  return row;
}
export { reserve };

export function cancelReservation(id, { user, byAdmin = false, actor = null, now = Date.now() }) {
  const rs = S.reservations.find((x) => x.id === id);
  if (!rs || (!byAdmin && rs.user_id !== user.id)) throw notFound('Reservation not found');
  if (rs.status !== 'confirmed') throw conflict('This reservation is not active');
  const d = describe(rs.trip_id);
  const status = d ? resolve(d, now).status : 'completed';
  if (!byAdmin && !['scheduled', 'preparing'].includes(status)) throw conflict('The bus has already left, this reservation can no longer be cancelled');
  rs.status = 'cancelled'; rs.cancelled_at = nowIso(); rs.cancelled_by = byAdmin ? 'admin' : 'student';
  if (byAdmin) {
    audit(actor, 'reservation.cancel', 'reservation', id, `trip ${rs.trip_id}`);
    notify(rs.user_id, { kind: 'reservation', tripId: rs.trip_id, key: `rescan:${id}`, title: 'Your reservation was cancelled', body: 'An administrator cancelled your seat. Check the live dashboard for another bus.' });
  }
  return rs;
}

/** a few upcoming trips on the student's route, presented as "your usual bus" suggestions */
function suggestionsFor(user, now) {
  if (!user.suggestions) return { enabled: false, items: [] };
  if (!user.route_id) return { enabled: true, items: [] };
  const hidden = new Set(S.suppressed.filter((x) => x.user_id === user.id).map((x) => x.key));
  const wd = new Date(now).getDay();
  const board = liveBoard(now).filter((t) => ['scheduled', 'preparing'].includes(t.status) && t.route.id === user.route_id);
  const items = [];
  for (const trip of board.slice(0, 6)) {
    const key = `${wd}:${trip.route.id}:${trip.direction ?? '-'}:${hmOf(new Date(trip.scheduled_departure).getTime())}`;
    if (hidden.has(key)) continue;
    const myStop = trip.stops.find((s) => s.id === user.stop_id);
    items.push({
      key, reason: `You took this bus ${3 + (trip.id % 2)} of the last 4 ${['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][wd]}`,
      reason_parts: { count: 3 + (trip.id % 2), of: 4, weekday: wd },
      trip: { id: trip.id, status: trip.status, route: trip.route, bus: { number: trip.bus.number }, scheduled_departure: trip.scheduled_departure, expected_departure: trip.expected_departure, delay_minutes: trip.delay_minutes, seats: trip.seats, eta: myStop?.eta ?? null, minutes_until: Math.max(0, Math.round((new Date(trip.expected_departure).getTime() - now) / MIN)) },
      can_reserve: trip.seats.available > 0 && trip.bus.status !== 'out_of_service',
    });
    if (items.length >= 2) break;
  }
  return { enabled: true, items };
}

/** best bus for a class: the latest trip on the student's route that reaches campus before the class (minus a 10 min buffer) */
function recommendBus(user, cls, now) {
  if (!user.route_id || !user.stop_id) return { kind: 'no_route' };
  const date = ymd(new Date(now));
  const [y, m, d] = date.split('-').map(Number); const [hh, mm] = cls.start.split(':').map(Number);
  const deadline = new Date(y, m - 1, d, hh, mm).getTime() - 10 * MIN;
  const options = [];
  for (const t of timetableTripsOn(date)) {
    if (t.route_id !== user.route_id || t.direction !== 'to_campus') continue;
    if (!['scheduled', 'preparing', 'departed'].includes(resolve(t, now).status)) continue;
    const ce = campusEtaOf(t, now);
    if (!ce?.arrival) continue;
    const arrive = new Date(ce.arrival).getTime();
    if (arrive > deadline) continue;
    const v = tripView(t, now); const stop = v.stops.find((s) => s.id === user.stop_id);
    if (!stop?.eta.arrival || stop.eta.kind === 'passed') continue;
    options.push({ arrive, v, stop });
  }
  if (!options.length) return { kind: 'none', before: hm(deadline + 10 * MIN) };
  options.sort((a, b) => a.arrive - b.arrive);
  const best = options.at(-1);
  return { kind: 'bus', trip_id: best.v.id, bus_number: best.v.bus.number, route: `${best.v.route.code} ${best.v.route.name}`, stop_name: best.stop.name, pickup_time: hm(new Date(best.stop.eta.arrival).getTime()), arrive_time: hm(best.arrive), live: best.stop.eta.kind === 'live', delay_minutes: best.v.delay_minutes };
}
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function composeReminder(cls, rec) {
  const head = `You have "${cls.title}" at ${cls.start}${cls.location_text ? ` (${cls.location_text})` : ''}.`;
  const body = rec.kind === 'bus'
    ? `Suggested bus: Bus ${rec.bus_number} (${rec.route}). Expected at ${rec.stop_name} about ${rec.pickup_time} and at campus about ${rec.arrive_time}. ${rec.live ? 'Based on live GPS.' : 'Scheduled estimate, not live: it can change.'}${rec.delay_minutes ? ` It is delayed by ${rec.delay_minutes} min.` : ''}`
    : rec.kind === 'none' ? `No bus on your route gets you there before ${cls.start}.`
      : rec.kind === 'later' ? `This class is on ${DAY_NAMES[DAY_KEYS.indexOf(cls.day)]}. The bus suggestion is worked out on the day, from the live board.`
        : 'Set your route and collection point in My settings to get a bus suggestion.';
  return { subject: `Reminder: ${cls.title} at ${cls.start}`, text: `${head}\n${body}`, ai: false };
}
function previewReminder(user, now) {
  const mine = S.classes.filter((c) => c.user_id === user.id);
  if (!mine.length) return { empty: 'no_timetable' };
  const nowMin = new Date(now).getHours() * 60 + new Date(now).getMinutes();
  const toMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const cls = classesOn(user.id, dayKey(new Date(now))).find((c) => toMin(c.start) > nowMin);
  if (!cls) {
    for (let i = 1; i <= 7; i += 1) {
      const c = classesOn(user.id, dayKey(new Date(now + i * 86400000)))[0];
      if (c) { const rec = { kind: 'later' }; return { class: c, recommendation: rec, ...composeReminder(c, rec) }; }
    }
    return { empty: 'no_more_classes' };
  }
  const rec = recommendBus(user, cls, now);
  return { class: cls, recommendation: rec, ...composeReminder(cls, rec) };
}

// ---- the assistant: plain rules over the live board (no AI model in the demo) ----
const ACTIONS = {
  open_track: ['Track my bus', 'تتبّع أتوبيسي', '/student/track'], open_reserve: ['Reserve a seat', 'احجز مقعد', '/student/reserve'], open_routes: ['Routes & stops', 'الخطوط والمحطات', '/student/routes'],
  open_campus_map: ['Campus map', 'خريطة الحرم', '/student/campus-map'], open_errand_planner: ['Plan my errands', 'خطّط مشاويري', '/student/errands'],
};
const act = (id, lang, to) => ({ id, label: ACTIONS[id][lang === 'ar' ? 1 : 0], to: to ?? ACTIONS[id][2] });
function chat(user, messages, lang, now) {
  const text = String(messages.at(-1)?.content ?? '').toLowerCase();
  const ar = lang === 'ar';
  const board = liveBoard(now);
  const mine = board.filter((t) => t.route.id === user.route_id);
  const next = mine.find((t) => ['departed', 'preparing', 'scheduled'].includes(t.status)) ?? board[0];
  const t12 = (iso2) => hm(new Date(iso2).getTime());
  const has = (...w) => w.some((x) => text.includes(x));
  let reply; let actions = [];
  if (has('delay', 'late', 'تأخر', 'متأخر')) {
    const ups = activeUpdates(user.route_id); const delayed = board.filter((t) => t.delay_minutes > 0);
    reply = ups.length || delayed.length
      ? (ar ? 'فيه تأخيرات حالياً: ' : 'There are some delays right now: ') + [...ups.map((u) => u.title), ...delayed.map((t) => (ar ? `أتوبيس ${t.bus.number} متأخر ${t.delay_minutes} د` : `bus ${t.bus.number} is ${t.delay_minutes} min late`))].join('; ') + '.'
      : (ar ? 'مفيش تأخيرات معلنة دلوقتي.' : 'No delays are reported right now.');
    actions = [act('open_track', lang)];
  } else if (has('seat', 'available', 'reserve', 'book', 'مقعد', 'احجز', 'حجز')) {
    const t = board.find((x) => ['scheduled', 'preparing'].includes(x.status) && x.route.id === user.route_id) ?? board.find((x) => ['scheduled', 'preparing'].includes(x.status));
    reply = t ? (ar ? `الرحلة الجاية أتوبيس ${t.bus.number} الساعة ${t12(t.expected_departure)}: فاضل ${t.seats.available} مقعد من ${t.seats.capacity}.` : `The next bus to leave is bus ${t.bus.number} at ${t12(t.expected_departure)}: ${t.seats.available} of ${t.seats.capacity} seats are free.`) : (ar ? 'مفيش رحلات متاحة للحجز دلوقتي.' : 'No trips are open for booking right now.');
    actions = [act('open_reserve', lang, t ? `/student/reserve?trip=${t.id}` : undefined)];
  } else if (has('route', 'stop', 'خط', 'محطة', 'محطات')) {
    reply = (ar ? 'الخطوط: ' : 'Routes: ') + S.routes.filter((r) => r.active).map((r) => `${r.code} ${r.name} (${routeStopRows(r.id).map((s) => s.name).join(' → ')})`).join('; ') + '.';
    actions = [act('open_routes', lang), act('open_campus_map', lang)];
  } else if (has('bank', 'pharmacy', 'errand', 'بنك', 'صيدلية', 'مشوار')) {
    reply = ar ? 'جرّب مخطط المشاوير: بيقولك تقدر تخلّص في الوقت ولا لأ.' : 'Try the errand planner: it checks whether you can finish in time.';
    actions = [act('open_errand_planner', lang)];
  } else if (next) {
    const eta = next.stops.find((s) => s.id === user.stop_id)?.eta;
    reply = ar
      ? `أقرب أتوبيس: ${next.route.code}، أتوبيس ${next.bus.number}، المتوقع ${t12(next.expected_departure)}${next.delay_minutes ? ` (متأخر ${next.delay_minutes} د)` : ''}${eta?.arrival ? `. يوصل نقطتك حوالي ${t12(eta.arrival)}` : ''}.`
      : `Next bus: ${next.route.code} ${next.route.name}, bus ${next.bus.number}, expected ${t12(next.expected_departure)}${next.delay_minutes ? ` (${next.delay_minutes} min late)` : ''}${eta?.arrival ? `. It reaches your stop about ${t12(eta.arrival)}` : ''}.`;
    actions = [act('open_track', lang)];
  } else reply = ar ? 'مفيش رحلات نشطة دلوقتي.' : 'There are no active trips right now.';
  reply += ar ? ' (دي إجابة مبسطة: المساعد الذكي غير مفعّل في النسخة التجريبية.)' : ' (Basic answer: the AI assistant is not enabled in this demo.)';
  return { reply, actions, ai: false };
}

const runPass = runNotificationPass;

export function register(route) {
  // ---------------- public ----------------
  route('GET', '/api/health', () => ({ ok: true, time: nowIso() }));
  route('GET', '/api/public/overview', ({ now }) => {
    const board = liveBoard(now);
    return {
      data_mode: 'demo', buses_total: S.buses.filter((b) => b.status !== 'out_of_service').length, routes_active: S.routes.filter((r) => r.active).length,
      stops_total: S.stops.filter((s) => !s.is_campus && s.active).length, trips_live: board.filter((t) => t.status === 'departed').length,
      trips_waiting: board.filter((t) => t.status !== 'departed').length, updates: activeUpdates().length,
    };
  });
  route('GET', '/api/public/live', ({ now }) => ({ trips: liveBoard(now).map(({ driver, ...t }) => t), server_time: iso(now) }));
  route('GET', '/api/public/catalog', () => routeCatalog());

  // ---------------- auth ----------------
  route('POST', '/api/student/auth/login', ({ body }) => {
    const email = String(body?.email ?? '').trim().toLowerCase();
    const u = S.users.find((x) => x.role === 'student' && x.email === email && x.active);
    if (!u || u.password !== body?.password) throw new MockError(401, 'Invalid email or password');
    S.sessions.student = u.id;
    return { user: publicUser(u) };
  });
  route('POST', '/api/student/auth/register', ({ body }) => {
    const name = str(body?.name, 'Name', { max: 80 });
    const email = str(body?.email, 'Email', { max: 120 }).toLowerCase();
    if (!EMAIL.test(email)) throw bad('Enter a valid email address');
    const student_no = str(body?.student_no, 'Student number', { max: 30, optional: true });
    passwordStrength(body?.password);
    if (S.users.some((x) => x.email === email)) throw conflict('An account with this email already exists');
    const u = { id: nextId('user'), role: 'student', name, email, password: body.password, student_no, route_id: null, stop_id: null, walk_minutes: 5, email_days: ['sun', 'mon', 'tue', 'wed', 'thu'], suggestions: true, email_reminders: false, email_lead_minutes: 45, notif_eta: true, notif_departure: true, notif_updates: true, active: 1 };
    S.users.push(u); S.sessions.student = u.id;
    return { __status: 201, user: publicUser(u) };
  });
  route('POST', '/api/student/auth/logout', () => { S.sessions.student = null; return { ok: true }; });
  route('GET', '/api/student/auth/me', ({ now }) => { const u = requireRole('student'); runPass(now); return { user: publicUser(u), unread: unreadCount(u.id), mail: { provider: 'outbox' } }; });
  const changePw = ({ body }) => {
    const u = requireRole('student');
    if (typeof body?.current_password !== 'string' || !body.current_password || typeof body?.new_password !== 'string' || !body.new_password) throw bad('Current password and new password are required');
    if (body.current_password !== u.password) throw new MockError(401, 'Current password is incorrect');
    passwordStrength(body.new_password); u.password = body.new_password;
    return { ok: true, message: 'Password updated successfully' };
  };
  route('POST', '/api/student/auth/change-password', changePw);
  route('PUT', '/api/student/auth/password', changePw);

  // ---------------- profile & favourites ----------------
  route('PUT', '/api/student/profile', ({ body: b = {} }) => {
    const u = requireRole('student');
    const name = str(b.name ?? u.name, 'Name', { max: 80 });
    const route_id = b.route_id === undefined ? u.route_id : int(b.route_id, 'Route', { optional: true });
    let stop_id = b.stop_id === undefined ? u.stop_id : int(b.stop_id, 'Collection point', { optional: true });
    if (route_id == null) stop_id = null;
    if (route_id != null && !S.routes.some((r) => r.id === route_id && r.active)) throw bad('Route not found or inactive');
    if (stop_id != null && !(S.routeStops[route_id] ?? []).includes(stop_id)) throw bad('That collection point is not on the selected route');
    const walk = b.walk_minutes === undefined ? u.walk_minutes : int(b.walk_minutes, 'Walking time', { min: 0, max: 120 });
    const f = (k) => (b[k] === undefined ? !!u[k] : !!bool(b[k]));
    const lead = b.email_lead_minutes === undefined ? u.email_lead_minutes : oneOf(Number(b.email_lead_minutes), 'Email lead time', LEAD_MINUTES);
    let days = u.email_days;
    if (b.email_days !== undefined) {
      if (!Array.isArray(b.email_days) || b.email_days.some((d) => !DAY_KEYS.includes(d))) throw bad('Reminder days are not valid');
      days = DAY_KEYS.filter((d) => b.email_days.includes(d));
    }
    Object.assign(u, { name, route_id, stop_id, walk_minutes: walk, notif_eta: f('notif_eta'), notif_departure: f('notif_departure'), notif_updates: f('notif_updates'), email_reminders: f('email_reminders'), email_lead_minutes: lead, email_days: days, suggestions: f('suggestions') });
    return { user: publicUser(u) };
  });
  route('GET', '/api/student/favorites', () => { const u = requireRole('student'); return { favorites: S.favorites.filter((f) => f.user_id === u.id).sort((a, b) => a.id - b.id).map(favRow), max: MAX_FAVORITES }; });
  route('POST', '/api/student/favorites', ({ body: b = {} }) => {
    const u = requireRole('student');
    const route_id = int(b.route_id, 'Route'); const stop_id = int(b.stop_id, 'Collection point');
    const label = str(b.label, 'Label', { max: 40, optional: true }) || null;
    if (!S.routes.some((r) => r.id === route_id && r.active)) throw bad('Route not found or inactive');
    if (!(S.routeStops[route_id] ?? []).includes(stop_id)) throw bad('That collection point is not on the selected route');
    if (S.favorites.some((f) => f.user_id === u.id && f.route_id === route_id && f.stop_id === stop_id)) throw conflict('Already in your favourites');
    if (S.favorites.filter((f) => f.user_id === u.id).length >= MAX_FAVORITES) throw conflict(`You can save up to ${MAX_FAVORITES} favourites`);
    const row = { id: nextId('fav'), user_id: u.id, route_id, stop_id, label, created_at: nowIso() };
    S.favorites.push(row);
    return { __status: 201, favorite: favRow(row) };
  });
  route('PATCH', '/api/student/favorites/:id', ({ params, body }) => {
    const u = requireRole('student'); const f = S.favorites.find((x) => x.id === int(params.id, 'id') && x.user_id === u.id);
    if (!f) throw notFound('Favourite not found');
    f.label = str(body?.label, 'Label', { max: 40, optional: true }) || null;
    return { favorite: favRow(f) };
  });
  route('DELETE', '/api/student/favorites/:id', ({ params }) => {
    const u = requireRole('student'); const i = S.favorites.findIndex((x) => x.id === int(params.id, 'id') && x.user_id === u.id);
    if (i < 0) throw notFound('Favourite not found');
    S.favorites.splice(i, 1);
    return { ok: true };
  });

  // ---------------- catalog, nearest stops ----------------
  route('GET', '/api/student/catalog', () => { requireRole('student'); return routeCatalog(); });
  route('GET', '/api/student/stops/nearest', ({ query }) => {
    requireRole('student');
    const lat = num(query.lat, 'lat', { min: -90, max: 90 }); const lng = num(query.lng, 'lng', { min: -180, max: 180 });
    const rows = [];
    for (const r of S.routes.filter((x) => x.active)) for (const s of routeStopRows(r.id).filter((x) => x.active)) rows.push({ id: s.id, name: s.name, lat: s.lat, lng: s.lng, route_id: r.id, route_code: r.code, route_name: r.name });
    const out = rows.map((s) => { const m = haversine({ lat, lng }, s); return { ...s, distance_m: Math.round(m), walk_minutes: Math.max(1, Math.round(m / 80)) }; }).sort((a, b) => a.distance_m - b.distance_m).slice(0, 5);
    return { stops: out };
  });

  // ---------------- live data ----------------
  
  route('GET', '/api/student/live', ({ now }) => { requireRole('student'); runPass(now); return { trips: liveBoard(now), updates: activeUpdates(), server_time: iso(now) }; });
  route('GET', '/api/student/trips/:id', ({ params, now }) => {
    requireRole('student');
    const v = tripView(int(params.id, 'id'), now);
    if (!v) throw notFound('Trip not found');
    return { trip: v, server_time: iso(now) };
  });
  route('GET', '/api/student/my-trip', ({ now }) => {
    const u = requireRole('student');
    if (!u.route_id) return { trip: null, reason: 'no_route' };
    const trip = liveBoard(now).find((t) => t.route?.id === u.route_id) ?? null;
    return { trip, my_stop_id: u.stop_id, updates: activeUpdates(u.route_id), server_time: iso(now) };
  });
  route('GET', '/api/student/updates', ({ query }) => { const u = requireRole('student'); return { updates: activeUpdates(query.all ? null : u.route_id) }; });

  // ---------------- reservations ----------------
  route('GET', '/api/student/bookable', ({ now }) => {
    const u = requireRole('student');
    const mine = S.reservations.filter((r) => r.user_id === u.id && r.status === 'confirmed').map((r) => r.trip_id);
    const trips = liveBoard(now).filter((t) => ['scheduled', 'preparing'].includes(t.status) && t.bus.status !== 'out_of_service');
    return { trips: trips.map((t) => ({ ...t, outside_route: t.route.id !== u.route_id, reserved_by_me: mine.includes(t.id) })) };
  });
  route('POST', '/api/student/reservations', ({ body, now }) => {
    const u = requireRole('student');
    const tripId = int(body?.trip_id, 'Trip'); const stopId = int(body?.stop_id, 'Collection point', { optional: true });
    const row = reserve({ user: u, tripId, stopId, now });
    return { __status: 201, reservation: row, trip: tripView(tripId, now) };
  });
  route('GET', '/api/student/reservations', ({ now }) => {
    const u = requireRole('student');
    const rows = S.reservations.filter((r) => r.user_id === u.id).map((rs) => joined(rs, now)).filter(Boolean)
      .sort((a, b) => b.d.nominal - a.d.nominal).slice(0, 100)
      .map(({ rs, d, r, bus, route: rt }) => ({ ...rs, scheduled_departure: iso(d.nominal), trip_status: r.status, delay_minutes: r.delay, bus_number: bus.number, route_name: rt.name, route_code: rt.code, stop_name: stopOf(rs.stop_id)?.name ?? null }));
    return { reservations: rows };
  });
  route('DELETE', '/api/student/reservations/:id', ({ params, now }) => ({ reservation: cancelReservation(int(params.id, 'id'), { user: requireRole('student'), now }) }));

  // ---------------- notifications & history ----------------
  route('GET', '/api/student/notifications', ({ now }) => {
    const u = requireRole('student'); runPass(now);
    const rows = S.notifications.filter((n) => n.user_id === u.id).sort((a, b) => b.id - a.id).slice(0, 100);
    return { notifications: rows.map((n) => ({ ...n, read: !!n.read })), unread: unreadCount(u.id) };
  });
  route('POST', '/api/student/notifications/read', ({ body }) => {
    const u = requireRole('student');
    const ids = Array.isArray(body?.ids) && body.ids.length ? body.ids.map(Number) : null;
    for (const n of S.notifications) if (n.user_id === u.id && (!ids || ids.includes(n.id))) n.read = 1;
    return { unread: unreadCount(u.id) };
  });
  route('GET', '/api/student/history', ({ now }) => {
    const u = requireRole('student');
    const reservations = S.reservations.filter((r) => r.user_id === u.id).map((rs) => joined(rs, now)).filter(Boolean).sort((a, b) => b.d.nominal - a.d.nominal).slice(0, 100)
      .map(({ rs, d, r, bus, route: rt }) => ({ id: rs.id, status: rs.status, outside_route: rs.outside_route, created_at: rs.created_at, scheduled_departure: iso(d.nominal), actual_departure: r.actual ? iso(r.actual) : null, completed_at: r.completedAt ? iso(r.completedAt) : null, trip_status: r.status, bus_number: bus.number, route_code: rt.code, route_name: rt.name, stop_name: stopOf(rs.stop_id)?.name ?? null }));
    const service = [];
    if (u.route_id) {
      const today = dayNo(ymd(new Date(now)));
      for (let n = today; n > today - 12 && service.length < 50; n -= 1) {
        for (const d of timetableTripsOn(dateOfDayNo(n)).filter((x) => x.route_id === u.route_id).sort((a, b) => b.nominal - a.nominal)) {
          const r = resolve(d, now);
          if (!['completed', 'cancelled'].includes(r.status)) continue;
          service.push({ id: d.id, status: r.status, scheduled_departure: iso(d.nominal), actual_departure: r.actual ? iso(r.actual) : null, completed_at: r.completedAt ? iso(r.completedAt) : null, delay_minutes: r.delay, bus_number: busOf(d.bus_id).number, route_name: routeOf(d.route_id).name });
        }
      }
    }
    return { reservations, route_service: service.slice(0, 50) };
  });

  // ---------------- class timetable ----------------
  route('GET', '/api/student/schedule', () => { const u = requireRole('student'); return { classes: S.classes.filter((c) => c.user_id === u.id).sort((a, b) => a.day.localeCompare(b.day) || a.start.localeCompare(b.start)).map(({ user_id, ...c }) => c) }; });
  route('PUT', '/api/student/schedule', ({ body }) => {
    const u = requireRole('student');
    const rows = body?.classes;
    if (!Array.isArray(rows)) throw bad('rows must be a list');
    if (rows.length > 60) throw bad('You can save up to 60 classes');
    const errors = []; const clean = [];
    rows.forEach((r, i) => {
      const title = typeof r?.title === 'string' ? r.title.trim() : '';
      const m = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
      let why = null;
      if (!title) why = 'needs a title'; else if (title.length > 80) why = 'title is longer than 80 characters';
      else if (!DAY_KEYS.includes(r.day)) why = 'has an unknown day';
      else if (typeof r.start !== 'string' || !HHMM.test(r.start)) why = 'start time must be HH:MM';
      else if (typeof r.end !== 'string' || !HHMM.test(r.end)) why = 'end time must be HH:MM';
      else if (m(r.end) <= m(r.start)) why = 'must end after it starts';
      if (why) errors.push(`Row ${i + 1}: ${why}`);
      else clean.push({ title, day: r.day, start: r.start, end: r.end, location_text: r.location_text ? String(r.location_text).trim().slice(0, 80) : null, source: ['manual', 'csv', 'ai'].includes(r.source) ? r.source : 'manual' });
    });
    if (errors.length) throw bad(errors.slice(0, 5).join('; '));
    S.classes = S.classes.filter((c) => c.user_id !== u.id);
    for (const c of clean) S.classes.push({ id: nextId('cls'), user_id: u.id, ...c });
    return { classes: S.classes.filter((c) => c.user_id === u.id).sort((a, b) => a.day.localeCompare(b.day) || a.start.localeCompare(b.start)).map(({ user_id, ...c }) => c) };
  });
  route('DELETE', '/api/student/schedule', () => { const u = requireRole('student'); S.classes = S.classes.filter((c) => c.user_id !== u.id); return { ok: true }; });
  route('POST', '/api/student/schedule/parse', () => { requireRole('student'); throw conflict('AI is not enabled on this server. Enter your classes manually.', 'ai_disabled'); });

  // ---------------- AI-written explanations (the demo has no AI: callers show their own text) ----------------
  route('GET', '/api/student/eta/explain', () => { requireRole('student'); return { sentence: null, ai: false }; });
  route('GET', '/api/student/trips/:id/crowd-explain', () => { requireRole('student'); return { sentence: null, ai: false }; });
  route('POST', '/api/student/suggestions/explain', () => { requireRole('student'); return { sentence: null, ai: false }; });
  route('GET', '/api/student/ai/status', () => ({ ai: false }));

  route('GET', '/api/student/suggestions', ({ now }) => suggestionsFor(requireRole('student'), now));
  route('POST', '/api/student/suggestions/suppress', ({ body }) => {
    const u = requireRole('student'); const key = str(body?.pattern_key, 'Pattern', { max: 60 });
    if (!S.suppressed.some((x) => x.user_id === u.id && x.key === key)) S.suppressed.push({ user_id: u.id, key });
    return { ok: true };
  });

  // ---------------- errand planner ----------------
  route('GET', '/api/student/places', ({ query }) => {
    const me = requireRole('student');
    const area = query.area ? oneOf(query.area, 'area', ['campus', 'off_campus']) : null;
    const q = normalise(query.q ?? '');
    let rows = S.places.filter((p) => p.active && (!area || p.area === area) && (!p.owner_id || p.owner_id === me.id)).sort((a, b) => a.area.localeCompare(b.area) || a.name_en.localeCompare(b.name_en));
    if (q) rows = rows.filter((p) => normalise(`${p.name_en} ${p.name_ar} ${p.category}`).includes(q));
    return { places: rows.slice(0, 100).map((p) => ({ ...placeView(p), near: nearBusStop(p) })) };
  });
  /** A student's own place outside the campus (a shop, a friend's building…). Only that student sees it. */
  route('POST', '/api/student/places', ({ body: b = {} }) => {
    const u = requireRole('student');
    if (S.places.filter((p) => p.owner_id === u.id).length >= 20) throw conflict('You can save up to 20 places of your own');
    const name = str(b.name, 'Place name', { max: 80 });
    const category = oneOf(b.category ?? 'other', 'Category', CATEGORIES);
    const lat = num(b.lat, 'Latitude', { min: -90, max: 90 }); const lng = num(b.lng, 'Longitude', { min: -180, max: 180 });
    const row = { id: 100000 + nextId('uplace'), owner_id: u.id, name_en: name, name_ar: '', area: 'off_campus', category, lat, lng, walk_min_from_campus_stop: null, default_stay_min: CATEGORY_DEFAULTS[category] ?? 15, opens: null, closes: null, closed_days: null, active: 1 };
    S.places.push(row);
    return { __status: 201, place: placeView(row) };
  });
  route('POST', '/api/student/errands/parse', () => { requireRole('student'); throw conflict('AI is not enabled on this server. Add your stops one by one.', 'ai_disabled'); });
  route('POST', '/api/student/errands/plan', ({ body, now }) => buildPlan(requireRole('student'), body ?? {}, now));
  route('POST', '/api/student/errands/summary', () => { requireRole('student'); return { sentence: null, ai: false }; });
  route('GET', '/api/student/errands/saved', ({ now }) => ({ plans: listPlans(requireRole('student').id, now) }));
  route('POST', '/api/student/errands/save', ({ body, now }) => ({ __status: 201, plan: savePlan(requireRole('student').id, body ?? {}, now) }));
  route('DELETE', '/api/student/errands/saved/:id', ({ params }) => {
    const u = requireRole('student'); const i = S.plans.findIndex((p) => p.id === int(params.id, 'id') && p.user_id === u.id);
    if (i < 0) throw notFound('Saved plan not found');
    S.plans.splice(i, 1);
    return { ok: true };
  });

  // ---------------- reminders, chat, issues ----------------
  route('POST', '/api/student/reminders/preview', ({ now }) => previewReminder(requireRole('student'), now));
  route('POST', '/api/student/reminders/test', ({ now }) => {
    const u = requireRole('student');
    const p = previewReminder(u, now);
    const msg = p.subject ? p : { subject: 'Test reminder', text: 'This is a test email from Campus in Motion.' };
    S.outbox.push({ id: nextId('outbox'), to_email: u.email, subject: `[Test] ${msg.subject}`, status: 'queued', error: null, created_at: nowIso(), sent_at: null });
    return { provider: 'outbox', status: 'queued' };
  });
  route('POST', '/api/student/chat', ({ body, now }) => {
    const u = requireRole('student');
    const raw = Array.isArray(body?.messages) ? body.messages.slice(-10) : [];
    const messages = raw.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim()).map((m) => ({ role: m.role, content: m.content.trim().slice(0, 1000) }));
    while (messages.length && messages[0].role !== 'user') messages.shift();
    if (!messages.length || messages.at(-1).role !== 'user') throw bad('Send a message first');
    return chat(u, messages, body?.lang === 'ar' ? 'ar' : 'en', now);
  });
  route('POST', '/api/student/issues', ({ body: b = {} }) => {
    const u = requireRole('student');
    const category = oneOf(b.category, 'Category', ['bus', 'collection_point', 'route', 'service', 'other']);
    const description = str(b.description, 'Description', { min: 10, max: 1000 });
    const bus_id = int(b.bus_id, 'Bus', { optional: true }); const stop_id = int(b.stop_id, 'Collection point', { optional: true }); const route_id = int(b.route_id, 'Route', { optional: true });
    if (bus_id != null && !busOf(bus_id)) throw bad('Bus not found');
    if (stop_id != null && !stopOf(stop_id)) throw bad('Collection point not found');
    if (route_id != null && !routeOf(route_id)) throw bad('Route not found');
    const row = { id: nextId('issue'), user_id: u.id, category, bus_id, stop_id, route_id, description, status: 'open', admin_note: null, created_at: nowIso(), updated_at: null };
    S.issues.push(row);
    return { __status: 201, issue: row };
  });
  route('GET', '/api/student/issues', () => { const u = requireRole('student'); return { issues: S.issues.filter((i) => i.user_id === u.id).sort((a, b) => b.id - a.id).slice(0, 100) }; });
}
export { students, parseYmd, isOpenAt, confirmedCount };

// In-memory "database" of the mock backend. Seeded from seed.json (reference data copied from the real API's seed)
// plus demo records. Mutations are kept in localStorage so a page refresh does not lose them.
import seed from './seed.js';
import { MIN, iso, ymd, dayKey, dateOfDayNo, dayNo } from './util.js';

const KEY = 'campus-phase1-state-v1';
export let S = null;

const OFF_CAMPUS = [
  { name_en: 'CIB Bank, Ring Road', name_ar: 'بنك CIB - الطريق الدائري', category: 'bank', lat: 30.0293, lng: 31.4592, opens: '09:00', closes: '15:00', closed_days: 'fri,sat', default_stay_min: 20 },
  { name_en: 'Al Ezaby Pharmacy', name_ar: 'صيدلية العزبي', category: 'pharmacy', lat: 30.0364, lng: 31.4452, opens: '09:00', closes: '23:00', closed_days: null, default_stay_min: 10 },
  { name_en: 'Print & Copy Hub', name_ar: 'سنتر الطباعة والتصوير', category: 'printing', lat: 30.0228, lng: 31.4252, opens: '08:30', closes: '20:00', closed_days: 'fri', default_stay_min: 10 },
  { name_en: 'Heliopolis Food Court', name_ar: 'ساحة المطاعم - مصر الجديدة', category: 'food', lat: 30.0652, lng: 31.4308, opens: '10:00', closes: '23:30', closed_days: null, default_stay_min: 30 },
  { name_en: 'Nasr City Post Office', name_ar: 'مكتب بريد مدينة نصر', category: 'other', lat: 30.0211, lng: 31.4048, opens: '08:00', closes: '14:00', closed_days: 'fri,sat', default_stay_min: 15 },
];

const CLASSES = [
  ['sun', 'Data Structures', '09:00', '10:30', 'R Building'], ['sun', 'Databases', '12:00', '13:30', 'N Building'],
  ['mon', 'Software Engineering', '10:00', '11:30', 'R Building'], ['mon', 'Computer Networks', '13:00', '14:30', 'E Building'],
  ['tue', 'Data Structures', '09:00', '10:30', 'R Building'], ['tue', 'Operating Systems', '11:00', '12:30', 'S Building'],
  ['wed', 'Software Engineering', '10:00', '11:30', 'R Building'], ['wed', 'Databases', '12:00', '13:30', 'N Building'],
  ['thu', 'Operating Systems', '11:00', '12:30', 'S Building'], ['thu', 'Computer Networks', '14:00', '15:30', 'E Building'],
];

/** The n most recent service days (sun-thu) strictly before today, as day numbers (newest first). */
function pastServiceDays(n) {
  const out = [];
  let d = dayNo(ymd()) - 1;
  while (out.length < n) {
    if (['sun', 'mon', 'tue', 'wed', 'thu'].includes(dayKey(new Date(`${dateOfDayNo(d)}T12:00:00`)))) out.push(d);
    d -= 1;
  }
  return out;
}
/** Trip id of a timetable (schedule) trip on a given day. Ids are decoded again in trips.js. */
export const schedTripId = (day, schedId) => 100000000 + day * 1000 + schedId;

function fresh() {
  const now = Date.now();
  const ago = (min) => iso(now - min * MIN);
  const st = {
    v: 1, seq: {},
    users: structuredClone(seed.users), stops: structuredClone(seed.stops), buses: structuredClone(seed.buses), drivers: structuredClone(seed.drivers),
    routes: seed.routes.map(({ stops, ...r }) => r),
    routeStops: Object.fromEntries(seed.routes.map((r) => [r.id, r.stops.map((s) => s.id)])),
    schedules: structuredClone(seed.schedules),
    places: [...structuredClone(seed.places), ...OFF_CAMPUS.map((p, i) => ({ id: 18 + i, area: 'off_campus', walk_min_from_campus_stop: null, active: 1, ...p }))],
    reservations: [], favorites: [], notifications: [], issues: [], updates: [], anomalies: [], audit: [], outbox: [], classes: [], plans: [], suppressed: [],
    tripOv: {}, manualTrips: [], sessions: { student: null, admin: null }, lastNotifyPass: 0,
  };
  st.stops.forEach((s) => { delete s.route_count; });

  // --- demo history for the sample student (Salma, route R1) ---
  let rid = 0;
  const days = pastServiceDays(9);
  days.forEach((d, i) => {
    const sched = i % 3 === 2 ? 9 : 1; // mostly the 07:15 bus into campus, sometimes the 15:05 one home
    const cancelled = i === 5;
    st.reservations.push({ id: ++rid, user_id: 3, trip_id: schedTripId(d, sched), stop_id: 4, status: cancelled ? 'cancelled' : 'completed', outside_route: 0, made_by: 'student', cancelled_by: cancelled ? 'student' : null, note: null, created_at: iso(now - (dayNo(ymd()) - d + 0.5) * 86400000), cancelled_at: cancelled ? iso(now - (dayNo(ymd()) - d + 0.4) * 86400000) : null });
  });
  // Other students book too, so seat counts and the admin lists look alive.
  [[4, 15, 6], [5, 1, null]].forEach(([u, sched, stop], i) => st.reservations.push({ id: ++rid, user_id: u, trip_id: schedTripId(days[i], sched), stop_id: stop, status: 'completed', outside_route: u === 5 ? 1 : 0, made_by: 'student', cancelled_by: null, note: null, created_at: ago(60 * 24 * (i + 2)), cancelled_at: null }));
  st.seq.res = rid;

  st.favorites = [
    { id: 1, user_id: 3, route_id: 1, stop_id: 4, label: 'Home', created_at: ago(5000) },
    { id: 2, user_id: 3, route_id: 1, stop_id: 2, label: 'Weekend stop', created_at: ago(4000) },
  ];
  st.notifications = [
    { id: 1, user_id: 3, kind: 'update', title: 'Delay: Heavy traffic on Airport Road', body: 'Buses on the Heliopolis route may run about 6 minutes late this morning.', trip_id: null, dedupe_key: 'su:1:new', read: 0, created_at: ago(95) },
    { id: 2, user_id: 3, kind: 'eta', title: 'Bus 204 is about 4 min away', body: 'Arriving at Ring Road Link. Head to your collection point now.', trip_id: null, dedupe_key: 'seed:eta5', read: 1, created_at: ago(60 * 20) },
    { id: 3, user_id: 3, kind: 'eta', title: 'Time to leave', body: 'Bus 207 reaches Ring Road Link in about 6 min and you need about 6 min to walk there.', trip_id: null, dedupe_key: 'seed:leave', read: 1, created_at: ago(60 * 44) },
    { id: 4, user_id: 3, kind: 'report', title: 'Your report was picked up for review', body: 'Thank you for helping improve the service.', trip_id: null, dedupe_key: 'issue:2:in_review', read: 1, created_at: ago(60 * 30) },
  ];
  st.seq.notif = 4;
  st.issues = [
    { id: 1, user_id: 3, category: 'collection_point', bus_id: null, stop_id: 4, route_id: 1, description: 'The shelter at Ring Road Link has a broken bench and no light in the evening.', status: 'open', admin_note: null, created_at: ago(60 * 5), updated_at: null },
    { id: 2, user_id: 3, category: 'bus', bus_id: 4, stop_id: null, route_id: 1, description: 'The air conditioning on bus 207 was not working during the morning trip.', status: 'in_review', admin_note: 'Maintenance has been informed.', created_at: ago(60 * 31), updated_at: ago(60 * 30) },
    { id: 3, user_id: 4, category: 'service', bus_id: null, stop_id: null, route_id: 2, description: 'The 8:30 bus from Heliopolis has been arriving ten minutes late all week.', status: 'open', admin_note: null, created_at: ago(60 * 9), updated_at: null },
    { id: 4, user_id: 5, category: 'route', bus_id: null, stop_id: null, route_id: null, description: 'Please add a collection point near the new gate on the Ring Road.', status: 'resolved', admin_note: 'Added to the next route review.', created_at: ago(60 * 72), updated_at: ago(60 * 50) },
  ];
  st.seq.issue = 4;
  st.updates = [
    { id: 1, kind: 'delay', title: 'Heavy traffic on Airport Road', message: 'Buses on the Heliopolis route may run about 6 minutes late this morning.', route_id: 2, bus_id: null, trip_id: null, delay_minutes: 6, active: 1, created_by: 1, created_at: ago(100), resolved_at: null },
    { id: 2, kind: 'temporary', title: 'Gate 3 closed for maintenance', message: 'Buses use Gate 2 until Sunday. Walking time to the stop is about 3 minutes longer.', route_id: null, bus_id: null, trip_id: null, delay_minutes: null, active: 0, created_by: 1, created_at: ago(60 * 52), resolved_at: ago(60 * 30) },
  ];
  st.seq.upd = 2;
  st.anomalies = [
    { id: 1, trip_id: null, bus_id: 2, kind: 'stopped_too_long', severity: 'warning', evidence: 'Bus 311 has been stopped for 6 min away from any collection point', dedupe_key: 'seed1', status: 'open', handled_by: null, handled_at: null, detected_at: ago(4) },
    { id: 2, trip_id: null, bus_id: 3, kind: 'much_slower_than_usual', severity: 'critical', evidence: 'Bus 156 reached Stadium Corner 12 min later than usual', dedupe_key: 'seed2', status: 'open', handled_by: null, handled_at: null, detected_at: ago(9) },
    { id: 3, trip_id: null, bus_id: 1, kind: 'gps_dropouts', severity: 'info', evidence: 'Bus 204 lost its GPS signal 3 times in 20 min', dedupe_key: 'seed3', status: 'dismissed', handled_by: 1, handled_at: ago(40), detected_at: ago(60) },
  ];
  st.seq.anom = 3;
  st.audit = [
    ['driver.assign', 'driver', 5, 'Bus 118', 60 * 50], ['bus.update', 'bus', 6, '330 status=out_of_service', 60 * 40], ['schedule.update', 'schedule', 17, '08:30', 60 * 26],
    ['update.create', 'service_update', 2, 'temporary: Gate 3 closed for maintenance', 60 * 52], ['update.resolve', 'service_update', 2, 'Gate 3 closed for maintenance', 60 * 30],
    ['route.update', 'route', 3, 'R3', 60 * 20], ['trips.generate', 'trip', null, `${ymd()}: 40 created`, 60 * 9], ['issue.update', 'issue', 4, 'resolved', 60 * 50], ['admin.login', 'user', 1, null, 12],
  ].map(([action, entity, entity_id, detail, min], i) => ({ id: i + 1, actor_id: 1, actor_name: 'Transport Admin', action, entity, entity_id, detail, ts: ago(min) }));
  st.seq.audit = st.audit.length;
  st.outbox = [
    ['student@campus.test', 'Bus 204 is about 4 min away', 'sent', 20], ['student@campus.test', 'Time to leave', 'sent', 44], ['student2@campus.test', 'Delay: Heavy traffic on Airport Road', 'queued', 95],
    ['student@campus.test', 'Your plan for today: leave by 08:10', 'sent', 60 * 26],
  ].map(([to, subject, status, min], i) => ({ id: i + 1, to_email: to, subject, status, error: null, created_at: ago(min), sent_at: status === 'sent' ? ago(min) : null }));
  st.seq.outbox = st.outbox.length;
  st.classes = CLASSES.map(([day, title, start, end, loc], i) => ({ id: i + 1, user_id: 3, title, day, start, end, location_text: loc, source: 'manual' }));
  st.seq.cls = st.classes.length;
  const max = (a) => a.reduce((m, x) => Math.max(m, x.id), 0);
  Object.assign(st.seq, { fav: 2, bus: max(st.buses), driver: max(st.drivers), route: max(st.routes), stop: max(st.stops), sched: max(st.schedules), place: max(st.places), user: max(st.users), plan: 0, mtrip: 0 });
  return st;
}

export function initState() {
  if (S) return S;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const parsed = JSON.parse(raw); if (parsed?.v === 1) { S = parsed; return S; } }
  } catch { /* storage unavailable or corrupt: start fresh */ }
  S = fresh();
  return S;
}

let timer = null;
export function save() {
  clearTimeout(timer);
  timer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* ignore */ } }, 200);
}
export function resetDemo() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  S = fresh();
  save();
}
export const nextId = (name) => { S.seq[name] = (S.seq[name] ?? 0) + 1; return S.seq[name]; };

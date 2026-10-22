// In-memory "database" of the mock backend. Seeded from seed.json (reference data copied from the real API's seed)
// plus demo records. Mutations are kept in localStorage so a page refresh does not lose them.
import seed from './seed.js';
import { MIN, iso, ymd, dayKey, dateOfDayNo, dayNo } from './util.js';

const KEY = 'campus-phase1-state-v2';
export let S = null;

const OFF_CAMPUS = [
  { name_en: 'CIB Bank, Ring Road', name_ar: 'بنك CIB - الطريق الدائري', category: 'bank', lat: 30.0293, lng: 31.4592, opens: '09:00', closes: '15:00', closed_days: 'fri,sat', default_stay_min: 20 },
  { name_en: 'Al Ezaby Pharmacy', name_ar: 'صيدلية العزبي', category: 'pharmacy', lat: 30.0364, lng: 31.4452, opens: '09:00', closes: '23:00', closed_days: null, default_stay_min: 10 },
  { name_en: 'Print & Copy Hub', name_ar: 'سنتر الطباعة والتصوير', category: 'printing', lat: 30.0228, lng: 31.4252, opens: '08:30', closes: '20:00', closed_days: 'fri', default_stay_min: 10 },
  { name_en: 'Heliopolis Food Court', name_ar: 'ساحة المطاعم - مصر الجديدة', category: 'food', lat: 30.0652, lng: 31.4308, opens: '10:00', closes: '23:30', closed_days: null, default_stay_min: 30 },
  { name_en: 'Nasr City Post Office', name_ar: 'مكتب بريد مدينة نصر', category: 'other', lat: 30.0211, lng: 31.4048, opens: '08:00', closes: '14:00', closed_days: 'fri,sat', default_stay_min: 15 },
  { name_en: 'Banque Misr, New Cairo', name_ar: 'بنك مصر - القاهرة الجديدة', category: 'bank', lat: 30.0425, lng: 31.4318, opens: '08:30', closes: '15:00', closed_days: 'fri,sat', default_stay_min: 20 },
  { name_en: 'NBE ATM, Mall Corner', name_ar: 'ماكينة البنك الأهلي - ناصية المول', category: 'bank', lat: 30.0358, lng: 31.444, opens: null, closes: null, closed_days: null, default_stay_min: 5 },
  { name_en: 'Seif Pharmacy, Heliopolis', name_ar: 'صيدلية سيف - مصر الجديدة', category: 'pharmacy', lat: 30.0772, lng: 31.4062, opens: '00:00', closes: '23:59', closed_days: null, default_stay_min: 10 },
  { name_en: 'Rushdy Pharmacy, Nasr City', name_ar: 'صيدلية رشدي - مدينة نصر', category: 'pharmacy', lat: 30.0195, lng: 31.4062, opens: '09:00', closes: '22:00', closed_days: null, default_stay_min: 10 },
  { name_en: 'Quick Print Center', name_ar: 'كويك برينت للطباعة', category: 'printing', lat: 30.0295, lng: 31.4608, opens: '09:00', closes: '21:00', closed_days: 'fri', default_stay_min: 15 },
  { name_en: 'Zaki Stationery & Books', name_ar: 'مكتبة زكي للأدوات المكتبية', category: 'shop', lat: 30.0205, lng: 31.4492, opens: '10:00', closes: '22:00', closed_days: null, default_stay_min: 15 },
  { name_en: 'City Stars Mall', name_ar: 'سيتي ستارز مول', category: 'shop', lat: 30.0495, lng: 31.4515, opens: '10:00', closes: '23:00', closed_days: null, default_stay_min: 60 },
  { name_en: 'Nile Clinic, New Cairo', name_ar: 'عيادة النيل - القاهرة الجديدة', category: 'clinic', lat: 30.0432, lng: 31.4295, opens: '10:00', closes: '20:00', closed_days: 'fri', default_stay_min: 40 },
  { name_en: 'Al Salam Medical Lab', name_ar: 'معمل السلام الطبي', category: 'clinic', lat: 30.0668, lng: 31.4322, opens: '07:00', closes: '18:00', closed_days: 'fri', default_stay_min: 25 },
  { name_en: 'Coffee Corner, Ring Road', name_ar: 'كوفي كورنر - الطريق الدائري', category: 'food', lat: 30.0286, lng: 31.4585, opens: '08:00', closes: '01:00', closed_days: null, default_stay_min: 30 },
  { name_en: 'Koshary Abou Tarek (Nasr City)', name_ar: 'كشري أبو طارق - مدينة نصر', category: 'food', lat: 30.0225, lng: 31.4235, opens: '10:00', closes: '00:00', closed_days: null, default_stay_min: 25 },
  { name_en: 'Al Rahma Mosque', name_ar: 'مسجد الرحمة', category: 'worship', lat: 30.0362, lng: 31.4465, opens: null, closes: null, closed_days: null, default_stay_min: 20 },
  { name_en: 'Garden City Park', name_ar: 'حديقة جاردن سيتي', category: 'other', lat: 30.0645, lng: 31.4295, opens: '06:00', closes: '22:00', closed_days: null, default_stay_min: 30 },
];

// Every day has a morning class, a gap of about three hours (room for a bank, a pharmacy or lunch off campus) and an afternoon class.
const CLASSES = [
  ['sun', 'Data Structures', '09:00', '10:30', 'R Building'], ['sun', 'Databases', '14:00', '15:30', 'N Building'],
  ['mon', 'Software Engineering', '10:00', '11:30', 'R Building'], ['mon', 'Computer Networks', '14:30', '16:00', 'E Building'],
  ['tue', 'Data Structures', '09:00', '10:30', 'R Building'], ['tue', 'Operating Systems', '13:30', '15:00', 'S Building'],
  ['wed', 'Software Engineering', '10:00', '11:30', 'R Building'], ['wed', 'Databases', '14:00', '15:30', 'N Building'],
  ['thu', 'Operating Systems', '10:00', '11:30', 'S Building'], ['thu', 'Computer Networks', '15:00', '16:30', 'E Building'],
];

// Extra midday runs so a student can go out and come back by university bus (the base timetable is mostly morning in, afternoon out).
// [direction, depart_time, first bus, second bus] - two-bus routes alternate, a one-bus route uses its only bus.
const MIDDAY_RUNS = [
  ['from_campus', '10:45', 0], ['to_campus', '11:30', 0], ['from_campus', '12:00', 1], ['to_campus', '12:45', 1], ['from_campus', '13:00', 0],
  ['to_campus', '14:00', 0], ['from_campus', '14:15', 1], ['to_campus', '15:30', 1], ['from_campus', '16:00', 0], ['to_campus', '17:15', 0],
];
function middaySchedules(base) {
  const out = []; let id = base.reduce((m, x) => Math.max(m, x.id), 0);
  for (const route of [1, 2, 3]) {
    const buses = [...new Set(base.filter((x) => x.route_id === route).map((x) => x.bus_id))];
    for (const [direction, depart_time, which] of MIDDAY_RUNS) {
      const ref = base.find((x) => x.route_id === route && x.bus_id === (buses[which] ?? buses[0]));
      out.push({ ...ref, id: ++id, depart_time, direction });
    }
  }
  return out;
}

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
    schedules: [...structuredClone(seed.schedules), ...middaySchedules(seed.schedules)],
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
  // Two saved plans for the sample student: the first is on her bus route (free university bus both ways), the second needs a taxi or walk.
  const pid = (name) => st.places.find((p) => p.name_en.startsWith(name))?.id;
  st.plans = [
    ['Bank and clinic in New Cairo', 'Banque Misr', 20, 'Nile Clinic', 40],
    ['Pharmacy, printing and a coffee', 'Al Ezaby', 10, 'Quick Print', 15, 'Coffee Corner', 30],
  ].map(([name, ...rest], i) => {
    const stops = [];
    for (let j = 0; j < rest.length; j += 2) if (pid(rest[j])) stops.push({ place_id: pid(rest[j]), stay_min: rest[j + 1], arrive_by: null });
    return { id: i + 1, user_id: 3, created_at: ago(60 * 20), expires_at: iso(now + (6 - i) * 86400000), stops, origin_place_id: 'campus', finish_by: null, name };
  });
  st.seq.plan = st.plans.length;
  const max = (a) => a.reduce((m, x) => Math.max(m, x.id), 0);
  Object.assign(st.seq, { fav: 2, bus: max(st.buses), driver: max(st.drivers), route: max(st.routes), stop: max(st.stops), sched: max(st.schedules), place: max(st.places), user: max(st.users), plan: st.plans.length, mtrip: 0 });
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

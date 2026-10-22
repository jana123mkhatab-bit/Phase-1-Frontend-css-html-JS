// Shared pieces of the mock backend: sessions, audit log, notifications, service updates, route catalog.
import { S, nextId } from './state.js';
import { MockError, nowIso, MIN, hmOf } from './util.js';
import { busOf, routeOf, stopOf, userOf, routeStopRows, campus, liveBoard, tripView, describe, resolve } from './trips.js';

export const publicUser = (u) => u && ({
  id: u.id, role: u.role, name: u.name, email: u.email, student_no: u.student_no, route_id: u.route_id, stop_id: u.stop_id, walk_minutes: u.walk_minutes,
  email_days: Array.isArray(u.email_days) ? u.email_days : String(u.email_days ?? '').split(',').filter(Boolean), suggestions: u.suggestions == null ? true : !!u.suggestions,
  email_reminders: !!u.email_reminders, email_lead_minutes: u.email_lead_minutes, notif_eta: !!u.notif_eta, notif_departure: !!u.notif_departure, notif_updates: !!u.notif_updates,
});

/** The signed-in user of a role, or a 401 like the real API. */
export function requireRole(role) {
  const u = userOf(S.sessions[role]);
  if (!u || u.role !== role || !u.active) throw new MockError(401, 'Please sign in');
  return u;
}

export function audit(actor, action, entity, entityId = null, detail = null) {
  S.audit.push({ id: nextId('audit'), actor_id: actor?.id ?? null, actor_name: actor?.name ?? null, action, entity, entity_id: entityId, detail, ts: nowIso() });
  if (S.audit.length > 500) S.audit.splice(0, S.audit.length - 500);
}

const MAX_NOTIFICATIONS = 80;
/** One notification per (user, key). Returns true when new. */
export function notify(userId, { kind, title, body, tripId = null, key }) {
  if (S.notifications.some((n) => n.user_id === userId && n.dedupe_key === key)) return false;
  S.notifications.push({ id: nextId('notif'), user_id: userId, kind, title, body, trip_id: tripId, dedupe_key: key, read: 0, created_at: nowIso() });
  const mine = S.notifications.filter((n) => n.user_id === userId);
  if (mine.length > MAX_NOTIFICATIONS) { const drop = mine.sort((a, b) => a.id - b.id).slice(0, mine.length - MAX_NOTIFICATIONS).map((n) => n.id); S.notifications = S.notifications.filter((n) => !drop.includes(n.id)); }
  return true;
}
export const unreadCount = (uid) => S.notifications.filter((n) => n.user_id === uid && !n.read).length;

const PREF = { eta: 'notif_eta', departure: 'notif_departure', update: 'notif_updates', reservation: null };
export function broadcast(users, msg) {
  let n = 0;
  const pref = PREF[msg.kind];
  for (const u of users) { if (pref && !u[pref]) continue; if (notify(u.id, msg)) n++; }
  return n;
}
export const students = () => S.users.filter((u) => u.role === 'student' && u.active);
export const routeAudience = (routeId) => (routeId == null ? students() : students().filter((u) => u.route_id === routeId));
export const tripAudience = (d) => students().filter((u) => u.route_id === d.route_id || S.reservations.some((r) => r.trip_id === d.id && r.user_id === u.id && r.status === 'confirmed'));

export function activeUpdates(routeId = null) {
  return S.updates.filter((u) => u.active && (!routeId || u.route_id == null || u.route_id === routeId)).sort((a, b) => b.id - a.id)
    .map((su) => ({ ...su, route_code: routeOf(su.route_id)?.code ?? null, route_name: routeOf(su.route_id)?.name ?? null, bus_number: busOf(su.bus_id)?.number ?? null }));
}

export function announceServiceUpdate(su, resolved = false) {
  const labels = { delay: 'Delay', route_change: 'Route change', cancellation: 'Cancellation', breakdown: 'Bus breakdown', temporary: 'Temporary change' };
  return broadcast(routeAudience(su.route_id), {
    kind: 'update', tripId: su.trip_id, key: `su:${su.id}:${resolved ? 'end' : 'new'}`,
    title: resolved ? `Resolved: ${su.title}` : `${labels[su.kind]}: ${su.title}`,
    body: resolved ? 'This service issue has been resolved.' : su.message,
  });
}
export function announceTrip(d, status, now = Date.now()) {
  const bus = busOf(d.bus_id); const route = routeOf(d.route_id);
  const label = `Bus ${bus.number} (${route?.name ?? 'route'})`;
  const when = hmOf(d.nominal);
  if (status === 'preparing') broadcast(tripAudience(d), { kind: 'departure', tripId: d.id, key: `prep:${d.id}`, title: `${label} is preparing to leave`, body: `The ${when} departure is being prepared at the university. It has not left yet.` });
  else if (status === 'departed') broadcast(tripAudience(d), { kind: 'departure', tripId: d.id, key: `dep:${d.id}`, title: `${label} has left the university`, body: `Departed for ${route?.name}. Track it live for your arrival time.` });
  else if (status === 'cancelled') {
    broadcast(tripAudience(d), { kind: 'update', tripId: d.id, key: `cancel:${d.id}`, title: `${label} (${when}) is cancelled`, body: 'This trip will not run. Any seat you reserved has been released.' });
  }
}
export function announceDelay(d, minutes) {
  if (minutes <= 0) return;
  const bus = busOf(d.bus_id); const route = routeOf(d.route_id);
  broadcast(tripAudience(d), { kind: 'update', tripId: d.id, key: `delay:${d.id}:${minutes}`, title: `Bus ${bus.number} delayed by ${minutes} min`, body: `${route.name}: new expected departure ${hmOf(d.nominal + minutes * MIN)}.` });
}

/** "About 5 minutes away" / "time to leave" notifications from live ETAs, like the real server's periodic pass. */
let lastPass = 0;
export function runNotificationPass(now = Date.now()) {
  if (now - lastPass < 4000) return;
  lastPass = now;
  const board = liveBoard(now).filter((t) => t.status === 'departed');
  for (const view of board) {
    for (const u of students()) {
      if (!u.notif_eta) continue;
      const targets = [];
      if (u.route_id === view.route.id && u.stop_id != null) targets.push({ stopId: u.stop_id, fav: null });
      for (const f of S.favorites) if (f.user_id === u.id && f.route_id === view.route.id && !(u.route_id === f.route_id && u.stop_id === f.stop_id)) targets.push({ stopId: f.stop_id, fav: f.id });
      for (const { stopId, fav } of targets) {
        const s = view.stops.find((x) => x.id === stopId);
        if (!s || s.eta.kind !== 'live') continue;
        const sec = s.eta.seconds; const mins = Math.max(1, Math.round(sec / 60));
        const leaveBy = (u.walk_minutes || 0) * 60 + 120;
        const sfx = fav ? `fav${fav}:${view.id}` : `${view.id}`;
        if (sec <= 300) notify(u.id, { kind: 'eta', tripId: view.id, key: `eta5:${sfx}`, title: `Bus ${view.bus.number} is about ${mins} min away`, body: `Arriving at ${s.name}. Head to your collection point now.` });
        else if (sec <= leaveBy) notify(u.id, { kind: 'eta', tripId: view.id, key: `leave:${sfx}`, title: 'Time to leave', body: `Bus ${view.bus.number} reaches ${s.name} in about ${mins} min and you need about ${u.walk_minutes} min to walk there.` });
      }
    }
  }
}

export function routeFull(id) {
  const route = routeOf(id);
  if (!route) return null;
  return { ...route, stops: routeStopRows(id) };
}
export function routeCatalog() {
  const routes = [...S.routes].sort((a, b) => a.code.localeCompare(b.code));
  return {
    campus: campus(),
    routes: routes.map((r) => ({ ...r, stops: routeStopRows(r.id).map((s) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng, area: s.area, seq: s.seq })) })),
  };
}

export const exists = (list, id, label) => { const row = list.find((x) => x.id === id); if (!row) throw new MockError(404, `${label} not found`); return row; };
export { describe, resolve, tripView, stopOf };

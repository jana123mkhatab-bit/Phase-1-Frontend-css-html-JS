// Strategy pattern: one function per way of estimating arrival. services/eta.js picks the strategy
// from the trip status. Each strategy receives the same context object and returns an ETA result.

const DWELL_SEC = 30;
const MIN_SPEED = 3; // m/s
const MAX_SPEED = 60;

/** Bus has departed: distance left along the route ÷ observed speed. Only ever "live" with a fresh GPS fix. */
function live({ trip, pos, stopDist, avg, base, mk, intermediate }) {
  if (!pos) return { ...base, basis: 'Departed, but no GPS position has been received' };
  if (!pos.fresh) return { ...base, kind: 'stale', basis: `Last GPS fix ${Math.round(pos.age_sec / 60)} min ago, ETA paused` };
  const progress = trip.progress_m || 0;
  const remaining = stopDist - progress;
  if (remaining < -60) return { ...base, kind: 'passed', basis: 'Bus has already passed this collection point' };
  const speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, trip.speed_mps ?? avg));
  const seconds = Math.max(0, remaining) / speed + intermediate(progress) * DWELL_SEC;
  return mk('live', seconds, trip.speed_mps ? 'Based on live position and observed speed' : 'Based on live position and route average speed');
}

/** Bus is preparing to leave: assume departure in about 2 minutes. */
function estimate({ stopDist, avg, mk, intermediate }) {
  return mk('estimate', 120 + stopDist / avg + intermediate(0) * DWELL_SEC, 'Bus is preparing to leave; assumes departure in about 2 minutes');
}

/** Trip has not left: based on the planned (and delayed) departure. Never presented as live. */
function scheduled({ trip, stopDist, avg, base, mk, intermediate, now }) {
  const dep = new Date(trip.scheduled_departure).getTime() + (trip.delay_minutes || 0) * 60000;
  if (dep < now - 60000) {
    return { ...base, kind: 'overdue', basis: 'Scheduled time has passed and departure has not been reported' };
  }
  return mk('scheduled', (dep - now) / 1000 + stopDist / avg + intermediate(0) * DWELL_SEC, 'Based on scheduled departure; not live');
}

export const etaStrategies = { departed: live, preparing: estimate, scheduled };

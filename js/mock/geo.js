// Geometry helpers. All distances are metres. Uses a local equirectangular projection,
// which is accurate to well under 1% over a metropolitan area.
const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

export function validCoord(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function toXY(p, origin) {
  return { x: rad(p.lng - origin.lng) * R * Math.cos(rad(origin.lat)), y: rad(p.lat - origin.lat) * R };
}

/** Build a polyline path with cumulative distances from ordered points [{lat,lng,...}]. */
export function buildPath(points) {
  const pts = points.filter((p) => validCoord(p.lat, p.lng));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1], pts[i]));
  return { pts, cum, length: cum[cum.length - 1] || 0 };
}

/** Point at distance d along path. */
export function pointAt(path, d) {
  const { pts, cum } = path;
  if (!pts.length) return null;
  if (d <= 0) return { lat: pts[0].lat, lng: pts[0].lng };
  if (d >= path.length) return { lat: pts.at(-1).lat, lng: pts.at(-1).lng };
  let i = 1;
  while (i < cum.length && cum[i] < d) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const t = (d - cum[i - 1]) / seg;
  return { lat: pts[i - 1].lat + (pts[i].lat - pts[i - 1].lat) * t, lng: pts[i - 1].lng + (pts[i].lng - pts[i - 1].lng) * t };
}

/**
 * Project a GPS fix onto the path. Progress is kept monotonic: only segments at or beyond
 * (prevProgress - backTolerance) are considered, so a loop route (campus at start and end)
 * cannot jump backwards. Returns {progress, offRoute, distance}.
 */
export function project(path, fix, prevProgress = 0, { backTolerance = 150, maxOffRoute = 500 } = {}) {
  const { pts, cum } = path;
  if (pts.length < 2 || !validCoord(fix.lat, fix.lng)) return null;
  let best = null;
  for (let i = 1; i < pts.length; i++) {
    if (cum[i] < prevProgress - backTolerance) continue;
    const o = pts[i - 1];
    const a = { x: 0, y: 0 };
    const b = toXY(pts[i], o);
    const p = toXY(fix, o);
    const len2 = b.x * b.x + b.y * b.y || 1;
    let t = (p.x * b.x + p.y * b.y) / len2;
    t = Math.max(0, Math.min(1, t));
    const dx = p.x - (a.x + b.x * t);
    const dy = p.y - (a.y + b.y * t);
    const dist = Math.hypot(dx, dy);
    const progress = cum[i - 1] + (cum[i] - cum[i - 1]) * t;
    if (progress < prevProgress - backTolerance) continue;
    if (!best || dist < best.distance) best = { progress, distance: dist };
  }
  if (!best) return null;
  return { progress: best.progress, distance: best.distance, offRoute: best.distance > maxOffRoute };
}

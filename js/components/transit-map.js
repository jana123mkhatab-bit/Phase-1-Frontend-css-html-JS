// Dependency-free SVG map. Projects lat/lng to the viewport; draws route links (straight between
// collection points, labelled as such), collection points, the campus and live buses.
// Clicks are reported through data attributes: the page's view handles data-click="map-bus" (data-trip)
// and data-click="map-stop" (data-route, data-stop).
import { html, raw } from '../core/dom.js';
import { t as tx } from '../core/i18n.js';
import { colorMap } from '../core/format.js';

const PAD = 56;

export function transitMap({ campus, routes = [], trips = [], selectedTripId, highlightStopId, onSelectTrip, onSelectStop, userLoc, routeFilter, height, selectedRouteId, wide, insetRight = 0, size }) {
  const W = size ? size[0] : wide ? 930 : 760, H = size ? size[1] : wide ? 600 : 520;
  const colorOf = colorMap(routes);

  const shown = routes.filter((r) => (routeFilter ? r.id === routeFilter : r.active !== 0)).sort((a, b) => (a.id === selectedRouteId) - (b.id === selectedRouteId));
  const pts = [];
  if (campus) pts.push(campus);
  shown.forEach((r) => r.stops.forEach((s) => pts.push(s)));
  trips.forEach((t) => t.position && pts.push(t.position));
  if (userLoc) pts.push(userLoc);
  if (!pts.length) return html`<div class="empty">${tx('No map data yet.')}</div>`;

  const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const midLat = (minLat + maxLat) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const spanX = Math.max((maxLng - minLng) * kx, 1e-4), spanY = Math.max(maxLat - minLat, 1e-4);
  const availW = W - PAD * 2 - insetRight;
  const scale = Math.min(availW / spanX, (H - PAD * 2) / spanY);
  const offX = PAD + (availW - spanX * scale) / 2, offY = (H - spanY * scale) / 2;
  const X = (lng) => offX + (lng - minLng) * kx * scale;
  const Y = (lat) => H - (offY + (lat - minLat) * scale);

  const ink = 'var(--ink)', navy = 'var(--navy)', halo = 'var(--map-bg)', road = 'var(--road)', card = 'var(--white)';
  const withPos = trips.filter((t) => t.position);
  const parked = (t) => campus && Math.hypot((t.position.lat - campus.lat) * 111000, (t.position.lng - campus.lng) * 96000) < 60;
  const drawn = withPos.filter((t) => !parked(t) || t.id === selectedTripId);
  const hiddenParked = withPos.length - drawn.length;
  const onSel = (t) => !selectedRouteId || t.route?.id === selectedRouteId;
  const label = (x, y, text, size, weight, extra = '') => `<text ${x != null ? `x="${x}"` : ''} y="${y}" text-anchor="middle" font-size="${size}" font-weight="${weight}" fill="${ink}" stroke="${halo}" stroke-width="3" paint-order="stroke" stroke-linejoin="round" ${extra}>`;

  return html`<div class="map-wrap">
    <svg viewBox="0 0 ${W} ${H}" ${wide ? raw('preserveAspectRatio="xMidYMid slice"') : ''} role="group" aria-label="${tx('Map of routes, collection points and buses. Lines join collection points in order and are not road geometry.')}" style="${height ? `height:${height}px` : ''}">
      <rect width="${W}" height="${H}" fill="${halo}"/>
      <g aria-hidden="true">
        <g transform="rotate(-14 ${W / 2} ${H / 2})" stroke="${road}" stroke-width="1.4" fill="none" opacity=".8">
          ${raw(Array.from({ length: 40 }, (_, i) => `<path d="M${-400 + i * 54} -500V1400"/>`).join(''))}
          ${raw(Array.from({ length: 40 }, (_, i) => `<path d="M-500 ${-400 + i * 48}H1500"/>`).join(''))}
        </g>
        <g stroke="${road}" stroke-width="3" fill="none" stroke-linecap="round">
          <path d="M-20 ${H * 0.55}C${W * 0.25} ${H * 0.5} ${W * 0.5} ${H * 0.68} ${W + 20} ${H * 0.6}"/>
          <path d="M${W * 0.36} -20C${W * 0.4} ${H * 0.3} ${W * 0.32} ${H * 0.6} ${W * 0.42} ${H + 20}"/>
        </g>
        <path d="M${W * 0.14} ${H * 0.6}q40-34 92-18t40 52q-30 36-86 28t-46-62z" fill="var(--water)"/>
        <path d="M${W * 0.72} ${H * 0.78}q50-30 96 4t-4 66q-56 10-90-20t-2-50z" fill="var(--water)"/>
      </g>
      ${shown.map((r) => {
        const line = [campus, ...r.stops, campus].filter(Boolean).map((p) => `${X(p.lng)},${Y(p.lat)}`).join(' ');
        const dim = selectedRouteId ? r.id !== selectedRouteId : selectedTripId && !trips.find((t) => t.id === selectedTripId && t.route?.id === r.id);
        return html`<g opacity="${dim ? 0.3 : 1}" data-key="line-${r.id}">
          <polyline points="${line}" fill="none" stroke="${road}" stroke-width="${dim ? 7 : 10}" stroke-linejoin="round" stroke-linecap="round" opacity=".92"/>
          <polyline points="${line}" fill="none" stroke="${colorOf[r.id]}" stroke-width="${dim ? 3 : 5}" stroke-linejoin="round" stroke-linecap="round" ${dim ? raw('stroke-dasharray="2 7"') : ''}/>
        </g>`;
      })}
      ${shown.flatMap((r) => r.stops.map((s, i) => {
        const hi = s.id === highlightStopId;
        const act = onSelectStop ? `tabindex="0" role="button" data-click="map-stop" data-route="${r.id}" data-stop="${s.id}"` : '';
        return html`<g class="map-stop" data-key="stop-${r.id}-${s.id}" data-route="${r.id}" ${i === 0 ? raw('data-first="1"') : ''} transform="translate(${X(s.lng)},${Y(s.lat)})" style="cursor:${onSelectStop ? 'pointer' : 'default'}" aria-label="${tx('Collection point {name}, {route}, stop {n}', { name: s.name, route: r.name, n: i + 1 })}" ${raw(act)}>
          <title>${tx('{name} · {route} · stop {n}', { name: s.name, route: r.name, n: i + 1 })}</title>
          <circle r="16" fill="transparent"/>
          <circle class="ring" r="${hi ? 10.5 : 7}" fill="${hi ? '#8DB4F8' : card}" stroke="${hi ? ink : colorOf[r.id]}" stroke-width="${hi ? 4 : 3}"/>
          ${!selectedRouteId || r.id === selectedRouteId ? html`${raw(label(null, -14, '', 11, 700))}${s.name}</text>` : ''}
        </g>`;
      }))}
      ${campus ? html`<g transform="translate(${X(campus.lng)},${Y(campus.lat)})" data-key="campus">
        <title>${campus.name}</title>
        <rect x="-14" y="-14" width="28" height="28" rx="8" fill="${navy}"/>
        <path d="M-7 4v-8l7-4 7 4v8M-3 4V0h6v4" stroke="#fff" stroke-width="1.8" fill="none" stroke-linejoin="round"/>
        ${raw(label(null, 30, '', 12, 800))}${campus.name}</text>
      </g>` : ''}
      ${userLoc ? html`<g transform="translate(${X(userLoc.lng)},${Y(userLoc.lat)})" data-key="me"><title>${tx('You are here')}</title><circle r="16" fill="#2B63D9" opacity=".2"/><circle r="7" fill="#2B63D9" stroke="#fff" stroke-width="3"/></g>` : ''}
      ${campus && hiddenParked > 0 ? html`<g transform="translate(${X(campus.lng) + 24},${Y(campus.lat) + 12})" aria-hidden="true" data-key="parked">
        <rect width="150" height="22" rx="11" fill="${card}" stroke="var(--border)"/><circle cx="12" cy="11" r="4" fill="#8A97AB"/>
        <text x="23" y="15" font-size="10.5" font-weight="700" fill="${ink}">${tx('Parked at campus · {n}', { n: hiddenParked })}</text></g>` : ''}
      ${drawn.map((t) => {
        // a parked bus that is selected is drawn beside the campus icon; the rest are counted in the badge above
        const dx = parked(t) ? 34 : 0;
        const sel = t.id === selectedTripId; const fresh = t.position.fresh;
        const c = fresh ? colorOf[t.route?.id] || '#2B63D9' : '#8A97AB';
        const act = onSelectTrip ? `tabindex="0" role="button" data-click="map-bus" data-trip="${t.id}"` : '';
        return html`<g class="map-bus" data-key="bus-${t.id}" style="transform: translate(${X(t.position.lng) + dx}px, ${Y(t.position.lat)}px); cursor:${onSelectTrip ? 'pointer' : 'default'}"
          aria-label="${tx('Bus {n}', { n: t.bus.number })}, ${t.route?.name}${fresh ? '' : `, ${tx('GPS silent')}`}${sel ? `, ${tx('selected')}` : ''}" ${raw(act)}>
          <title>${`${tx('Bus {n}', { n: t.bus.number })} · ${t.route?.name}${fresh ? '' : ` · ${tx('GPS silent')}`}`}</title>
          ${sel ? html`<circle class="bk-sel" r="26" fill="none" stroke="#2B63D9" stroke-width="3"/>` : ''}
          <circle class="bk-ring" r="${sel ? 18 : 15}" fill="${card}" stroke="${c}" stroke-width="3.5"/>
          <g transform="translate(${sel ? -9 : -7.5} ${sel ? -9 : -7.5}) scale(${sel ? 0.75 : 0.625})" style="color:${c}">
            <path d="M5 17V8a3 3 0 013-3h8a3 3 0 013 3v9M5 13h14M8 20v-3M16 20v-3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          </g>
          ${onSel(t) ? html`${raw(label(null, sel ? 32 : 29, '', 11, 700, 'font-family="IBM Plex Mono, monospace"'))}${t.bus.number}</text>` : ''}
        </g>`;
      })}
    </svg>
    <div class="legend">${shown.map((r) => html`<span><i style="background:${colorOf[r.id]}"></i>${r.code} ${r.name}</span>`)}</div>
    <div class="map-note">${tx('Lines join collection points in order and are not road geometry. Bus markers show the last received position; grey means GPS is silent.')}</div>
  </div>`;
}

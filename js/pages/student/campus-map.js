import { html, raw, bool, attr } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { t, tn } from '../../core/i18n.js';
import { fmtTime } from '../../core/format.js';
import { pageHead, tripStatusBadge } from '../../core/ui.js';

const W = 360, H = 760;
const ink = 'var(--ink)', navy = 'var(--navy)', halo = 'var(--map-bg)', road = 'var(--road)', bld = 'var(--bld)';

// Layout is drawn from the official MIU campus map (not to scale).
const BUILDINGS = [
  { id: 'R', name: 'R Building', x: 250, y: 34, w: 84, h: 150, floors: [['Ground', 'Bookstore, RA1, RA2…', ['RA']], ['1st', 'Gym, RB1–RB6…', ['RB']], ['2nd', 'RC1, RC2, RC5…', ['RC']], ['3rd', 'RD1, RD2, RD5…', ['RD']]] },
  { id: 'N', name: 'N Building', x: 28, y: 214, w: 58, h: 160, floors: [] },
  { id: 'S', name: 'S Building', x: 178, y: 214, w: 46, h: 160, floors: [['Underground', 'Morgue 1, Morgue 2'], ['Ground', 'Preclinical, S1, S2, S3…'], ['1st', 'S14, S15, S16…'], ['2nd', 'S29, S30…'], ['3rd & 4th', 'Clinics'], ['5th', 'S60, S61…']] },
  { id: 'Pharmacy', name: 'Pharmacy Building', x: 244, y: 392, w: 78, h: 152, floors: [] },
  { id: 'E', name: 'E Building', x: 268, y: 590, w: 52, h: 58, floors: [] },
  { id: 'Main', name: 'Main Building', x: 28, y: 574, w: 222, h: 132, floors: [] },
];
const POIS = [
  { id: 'mosque', name: 'Mosque', cat: 'Facilities', x: 44, y: 446, kind: 'mosque' },
  { id: 'dental', name: 'Dental clinic', cat: 'Facilities', x: 262, y: 196, w: 62, h: 108, kind: 'zone' },
  { id: 'court', name: 'Basketball court', cat: 'Facilities', x: 128, y: 178, kind: 'court' },
  { id: 'copy', name: 'Copy center', cat: 'Facilities', x: 60, y: 520, kind: 'copy' },
];
const BENCHES = [[104, 190], [118, 196], [150, 190], [166, 196], [60, 392], [74, 396], [190, 392], [204, 396], [226, 556], [60, 556], [100, 556], [222, 410], [222, 440]];
const FOOD = [
  // x/y are approximate pin positions (the official map lists these places without pinning them)
  { id: 'f1', n: 1, name: 'R2go, The Backyard', group: 'Restaurants', x: 242, y: 192 },
  { id: 'f2', n: 2, name: 'Shobrawy, Man’oucheh', group: 'Restaurants', x: 97, y: 232 },
  { id: 'f3', n: 3, name: 'Cinnabon, TBS', group: 'Restaurants', x: 97, y: 352 },
  { id: 'f4', n: 4, name: 'Transit', group: 'Restaurants', x: 241, y: 262 },
  { id: 'f5', n: 5, name: 'Shawerma Elsham', group: 'Restaurants', x: 241, y: 376 },
  { id: 'f6', n: 6, name: 'Batates & Zalabeya', group: 'Restaurants', x: 97, y: 424 },
  { id: 'f7', n: 7, name: 'Adam’s', group: 'Restaurants', x: 241, y: 568 },
  { id: 'f8', name: 'Farghaly', group: 'Drinks', x: 97, y: 500 },
];

const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9؀-ۿ ]/g, '');
// search text in both languages so English and Arabic queries both work
const hay = (...xs) => norm(xs.map((x) => `${x} ${t(x)}`).join(' '));

function search(q) {
  const n = norm(q.trim());
  if (!n) return [];
  const out = [];
  BUILDINGS.forEach((b) => {
    if (hay(b.name).includes(n) || norm(b.id) === n) out.push({ key: `b-${b.id}`, label: t(b.name), sub: t('Building'), sel: { type: 'b', id: b.id } });
    b.floors.forEach(([f, rooms, codes]) => {
      const hit = hay(f, 'floor', rooms).includes(n) || (codes && codes.some((c) => n.startsWith(norm(c))));
      if (hit) out.push({ key: `b-${b.id}-${f}`, label: `${t(b.name)} · ${t('{f} floor', { f: t(f) })}`, sub: t(rooms), sel: { type: 'b', id: b.id, floor: f } });
    });
  });
  POIS.forEach((p) => hay(p.name).includes(n) && out.push({ key: `p-${p.id}`, label: t(p.name), sub: t('Facility'), sel: { type: 'p', id: p.id } }));
  FOOD.forEach((f) => (hay(f.name).includes(n) || hay(f.group).includes(n)) && out.push({ key: f.id, label: t(f.name), sub: t(f.group), sel: { type: 'f', id: f.id } }));
  return out.slice(0, 8);
}

export default function campusMap(view, ctx) {
  ctx.setTitle('Campus map');
  view.load('live', () => api.get('/api/student/live'), { ms: 5000 });
  Object.assign(view.state, { q: '', sel: null, layers: { facilities: true, food: true, benches: false }, vp: { k: 1, x: 0, y: 0 } });
  let drag = null;

  const clamp = (v) => ({ k: v.k, x: Math.min(Math.max(v.x, 0), W - W / v.k), y: Math.min(Math.max(v.y, 0), H - H / v.k) });
  const zoomTo = (k, cx, cy) => {
    const { vp } = view.state;
    const x = cx ?? vp.x + W / vp.k / 2, y = cy ?? vp.y + H / vp.k / 2;
    view.set({ vp: clamp({ k, x: x - W / k / 2, y: y - H / k / 2 }) });
  };
  const pick = (s) => {
    view.state.sel = s;
    const b = s.type === 'b' && BUILDINGS.find((x) => x.id === s.id);
    const p = (s.type === 'p' && POIS.find((x) => x.id === s.id)) || (s.type === 'f' && FOOD.find((x) => x.id === s.id));
    const c = b ? center(b) : p ? { x: p.x + (p.w || 0) / 2, y: p.y + (p.h || 0) / 2 } : null;
    if (c) zoomTo(Math.max(view.state.vp.k, 1.8), c.x, c.y); else view.update();
  };

  // pan by dragging (only when zoomed in); a drag must not count as a click on a building
  view.listen(view.root, 'pointerdown', (e) => {
    const svg = e.target.closest?.('.cm-svg'); if (!svg) return;
    const { vp } = view.state;
    drag = { px: e.clientX, py: e.clientY, x: vp.x, y: vp.y, moved: false };
  });
  view.listen(view.root, 'pointermove', (e) => {
    const svg = e.target.closest?.('.cm-svg');
    const d = drag; if (!d || view.state.vp.k === 1 || !svg) return;
    const { vp } = view.state;
    const dx = e.clientX - d.px, dy = e.clientY - d.py;
    if (Math.abs(dx) + Math.abs(dy) > 4) { d.moved = true; svg.setPointerCapture?.(e.pointerId); }
    if (d.moved) { const r = svg.getBoundingClientRect(); view.set({ vp: clamp({ k: vp.k, x: d.x - dx * (W / vp.k / r.width), y: d.y - dy * (H / vp.k / r.height) }) }); }
  });
  const up = () => { setTimeout(() => { drag = null; }, 0); };
  view.listen(view.root, 'pointerup', up);
  view.listen(view.root, 'pointercancel', up);

  const item = (type, id) => raw(`tabindex="0" role="button" style="cursor:pointer" data-click="pick-item" data-type="${type}" data-id="${id}"`);

  return {
    render: () => {
      const { q, sel, layers, vp } = view.state;
      const all = view.state.live.data?.trips ?? [];
      const atCampus = all.filter((x) => x.status === 'scheduled' || x.status === 'preparing');
      const onRoad = all.filter((x) => x.status === 'departed');
      const results = search(q);
      const vbW = W / vp.k, vbH = H / vp.k;
      const selB = sel?.type === 'b' ? BUILDINGS.find((b) => b.id === sel.id) : null;
      const selP = sel?.type === 'p' ? POIS.find((p) => p.id === sel.id) : null;
      const selF = sel?.type === 'f' ? FOOD.find((f) => f.id === sel.id) : null;
      const matched = new Set(results.filter((r) => r.sel.type === 'b').map((r) => r.sel.id));

      return html`${pageHead(t('Campus map'), t('Find buildings, floors, rooms and facilities, and see which buses are waiting on campus right now.'), html`<span class="badge live"><span class="dot"></span>${t('Live')}</span>`)}
      <div class="split">
        <div class="stack">
          <div class="card tint stack">
            <div class="field">
              <label for="cm-q" style="font-weight:700">${t('Search the campus')}</label>
              <input id="cm-q" class="input" type="search" autocomplete="off" placeholder="${t('Try “RB3”, “Gym”, “Clinics”, “Cinnabon”, “Mosque”…')}" data-bind="q" value="${q}">
            </div>
            ${q.trim() ? (results.length ? html`<ul class="cm-results" aria-label="${t('Search results')}">
              ${results.map((r, i) => html`<li data-key="r-${r.key}"><button type="button" data-click="pick-result" data-i="${i}"><b>${r.label}</b><span class="small muted">${r.sub}</span></button></li>`)}
            </ul>` : html`<p class="small muted">${t('Nothing matches “{q}”. Try a building letter, floor or place name.', { q })}</p>`) : ''}
          </div>

          <div class="map-wrap cm-wrap">
            <div class="cm-tools">
              <div class="seg-chips" role="group" aria-label="${t('Map layers')}">
                <button type="button" class="chip" aria-pressed="${bool(layers.facilities)}" data-click="layer" data-l="facilities">${t('Facilities')}</button>
                <button type="button" class="chip" aria-pressed="${bool(layers.food)}" data-click="layer" data-l="food">${t('Food & drinks')}</button>
                <button type="button" class="chip" aria-pressed="${bool(layers.benches)}" data-click="layer" data-l="benches">${t('Seats & benches')}</button>
              </div>
              <div class="cm-zoom" role="group" aria-label="${t('Zoom')}">
                <button type="button" class="btn sm secondary" aria-label="${t('Zoom out')}" ${vp.k <= 1 ? 'disabled' : ''} data-click="zoom" data-d="-0.6">−</button>
                <button type="button" class="btn sm secondary" aria-label="${t('Zoom in')}" ${vp.k >= 3 ? 'disabled' : ''} data-click="zoom" data-d="0.6">+</button>
                <button type="button" class="btn sm ghost" ${vp.k === 1 ? 'disabled' : ''} data-click="reset">${t('Reset')}</button>
              </div>
            </div>
            <svg class="cm-svg" viewBox="${vp.x} ${vp.y} ${vbW} ${vbH}" role="group" aria-label="${t('Interactive campus map. Select a building or facility for details.')}" style="touch-action:${vp.k === 1 ? 'pan-y' : 'none'};cursor:${vp.k > 1 ? 'grab' : 'default'}">
              <defs>
                <pattern id="cm-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--hatch-bg)"/><path d="M0 0V6" stroke="#2B63D9" stroke-width="2"/></pattern>
                <pattern id="cm-grass" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="var(--grass)"/><circle cx="3" cy="3" r="1" fill="var(--grass-dot)"/><circle cx="9" cy="9" r="1" fill="var(--grass-dot)"/></pattern>
              </defs>
              <rect x="0" y="0" width="${W}" height="${H}" fill="${halo}"/>
              <rect x="8" y="8" width="${W - 16}" height="${H - 16}" rx="22" fill="${bld}" opacity=".55"/>
              <rect x="8" y="8" width="${W - 16}" height="${H - 16}" rx="22" fill="none" stroke="#2B63D9" stroke-width="2.5"/>

              <g stroke="${road}" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M20 200H340"/><path d="M20 388H340"/><path d="M20 552H340"/><path d="M20 726H340"/>
                <path d="M96 196V560"/><path d="M236 196V560"/><path d="M262 392V196"/><path d="M140 726V740"/>
              </g>

              <g aria-hidden="true">
                <rect x="28" y="40" width="206" height="124" rx="10" fill="url(#cm-grass)" stroke="#8DB4F8" stroke-width="2"/>
                <rect x="40" y="52" width="182" height="100" rx="4" fill="none" stroke="${road}" stroke-width="2" opacity=".9"/>
                <path d="M131 52V152" stroke="${road}" stroke-width="2" opacity=".9"/><circle cx="131" cy="102" r="14" fill="none" stroke="${road}" stroke-width="2" opacity=".9"/>
                <rect x="96" y="14" width="68" height="16" rx="4" fill="${navy}"/><text x="130" y="25.5" text-anchor="middle" font-size="9" font-weight="700" fill="#fff">${t('Workshop')}</text>
              </g>

              <g aria-hidden="true">
                <rect x="108" y="410" width="120" height="132" rx="14" fill="url(#cm-grass)" stroke="#8DB4F8" stroke-width="2"/>
                <rect x="132" y="440" width="72" height="72" rx="8" fill="#B9D0F5" opacity=".7"/>
                ${[[120, 424], [140, 420], [216, 428], [214, 524], [120, 530], [184, 530], [112, 478], [222, 474]].map(([x, y]) => html`<circle cx="${x}" cy="${y}" r="8" fill="#8DB4F8" opacity=".85"/>`)}
                <circle cx="132" cy="298" r="38" fill="#C9DDF6" stroke="#8DB4F8" stroke-width="2"/><circle cx="132" cy="298" r="9" fill="#fff" stroke="#8DB4F8" stroke-width="2"/>
              </g>

              ${POIS.filter((p) => p.kind === 'zone').map((p) => {
                const on = selP?.id === p.id;
                return html`<g aria-label="${t(p.name)}" data-key="poi-${p.id}" ${item('p', p.id)}>
                  <title>${t(p.name)}</title>
                  <rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="8" fill="url(#cm-hatch)" stroke="${on ? ink : '#2B63D9'}" stroke-width="${on ? 4 : 2}"/>
                  <text x="${p.x + p.w / 2}" y="${p.y + p.h / 2}" text-anchor="middle" font-size="10" font-weight="800" fill="${ink}" stroke="${bld}" stroke-width="3" paint-order="stroke" transform="rotate(-90 ${p.x + p.w / 2} ${p.y + p.h / 2})">${t('Dental clinic')}</text>
                </g>`;
              })}

              ${BUILDINGS.map((b) => {
                const on = selB?.id === b.id, hit = matched.has(b.id), c = center(b);
                const tall = b.h > b.w;
                const lbl = b.id === 'Pharmacy' || b.id === 'Main';
                return html`<g class="cm-bld" data-key="b-${b.id}" aria-label="${t(b.name)}${on ? `, ${t('selected')}` : ''}" ${item('b', b.id)}>
                  <title>${t(b.name)}</title>
                  <rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="12" fill="${on ? '#2B63D9' : hit ? '#8DB4F8' : bld}" stroke="${on ? ink : '#2B63D9'}" stroke-width="${on ? 4 : 2.5}"/>
                  <rect x="${b.x + 6}" y="${b.y + 6}" width="${b.w - 12}" height="${b.h - 12}" rx="8" fill="none" stroke="${on ? '#fff' : '#B9D0F5'}" stroke-width="1.5" stroke-dasharray="3 4"/>
                  <text x="${c.x}" y="${c.y}" dy=".35em" text-anchor="middle" font-size="${lbl ? 14 : 26}" font-weight="800" fill="${on ? '#fff' : ink}" ${lbl && tall ? attr`transform="rotate(90 ${c.x} ${c.y})"` : ''}>${lbl ? t(b.id) : b.id}</text>
                </g>`;
              })}

              <g aria-hidden="true"><rect x="118" y="728" width="44" height="16" rx="4" fill="${navy}"/><text x="140" y="739.5" text-anchor="middle" font-size="9" font-weight="700" fill="#fff">${t('Entrance')}</text></g>

              ${layers.benches ? html`<g aria-hidden="true">${BENCHES.map(([x, y]) => html`<rect x="${x}" y="${y}" width="10" height="5" rx="2" fill="#2B63D9" opacity=".8"/>`)}</g>` : ''}

              ${layers.facilities ? POIS.filter((p) => p.kind !== 'zone').map((p) => {
                const on = selP?.id === p.id;
                return html`<g class="cm-poi" data-key="poi-${p.id}" transform="translate(${p.x},${p.y})" aria-label="${t(p.name)}" ${item('p', p.id)}>
                  <title>${t(p.name)}</title>
                  <circle r="16" fill="transparent"/>
                  <circle r="${on ? 13 : 11}" fill="${p.kind === 'court' ? navy : bld}" stroke="${on ? ink : '#2B63D9'}" stroke-width="${on ? 4 : 3}"/>
                  ${p.kind === 'mosque' ? html`<path d="M-5 5V-1a5 5 0 0110 0v6M-5 5h10M0 -8v-3" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"/>` : ''}
                  ${p.kind === 'court' ? html`<circle r="5.5" fill="none" stroke="#fff" stroke-width="1.6"/><path d="M-5.5 0h11M0 -5.5v11" stroke="#fff" stroke-width="1.2"/>` : ''}
                  ${p.kind === 'copy' ? html`<path d="M-5 2V-3h10v5M-5 2h10v4h-10zM-3 -3V-6h6v3" fill="none" stroke="${ink}" stroke-width="1.6" stroke-linejoin="round"/>` : ''}
                  <text y="25" text-anchor="middle" font-size="9.5" font-weight="700" fill="${ink}" stroke="${halo}" stroke-width="3" paint-order="stroke" stroke-linejoin="round">${t(p.name)}</text>
                </g>`;
              }) : ''}

              ${layers.food ? FOOD.map((f) => {
                const on = selF?.id === f.id, drink = f.group === 'Drinks';
                return html`<g class="cm-poi" data-key="food-${f.id}" transform="translate(${f.x},${f.y})" aria-label="${t(f.name)}, ${t(f.group)}" ${item('f', f.id)}>
                  <title>${t(f.name)}</title>
                  <circle r="16" fill="transparent"/>
                  <circle r="${on ? 12 : 9.5}" fill="${on ? '#2B63D9' : navy}" stroke="#fff" stroke-width="2.5"/>
                  ${drink ? html`<path d="M-3.5 -4h7l-1 8h-5zM-1 -4l1-3" fill="none" stroke="#fff" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>` : html`<text dy=".35em" text-anchor="middle" font-size="${on ? 12 : 10.5}" font-weight="800" fill="#fff">${f.n}</text>`}
                  ${on ? html`<text y="-19" text-anchor="middle" font-size="10" font-weight="800" fill="${ink}" stroke="${halo}" stroke-width="3.5" paint-order="stroke" stroke-linejoin="round">${t(f.name)}</text>` : ''}
                </g>`;
              }) : ''}

              <g aria-label="${tn(atCampus.length, '{n} bus at campus', '{n} buses at campus')}">
                ${atCampus.slice(0, 5).map((tr, i) => html`<g class="map-bus" data-key="cb-${tr.id}" transform="translate(${190 + i * 34},722)" aria-label="${t('Bus {n}, {route}, at campus', { n: tr.bus.number, route: tr.route.name })}">
                  <title>${`${t('Bus {n}', { n: tr.bus.number })} · ${tr.route.name} · ${tr.status === 'preparing' ? t('preparing to leave') : t('departs {time}', { time: fmtTime(tr.expected_departure) })}`}</title>
                  <circle class="bk-ring" r="14" fill="var(--white)" stroke="#2B63D9" stroke-width="3.5"/>
                  <g transform="translate(-7.5 -7.5) scale(.625)" style="color:#2B63D9"><path d="M5 17V8a3 3 0 013-3h8a3 3 0 013 3v9M5 13h14M8 20v-3M16 20v-3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></g>
                  <text y="26" text-anchor="middle" font-size="10" font-weight="700" fill="${ink}" stroke="${halo}" stroke-width="3" paint-order="stroke" font-family="IBM Plex Mono, monospace">${tr.bus.number}</text>
                </g>`)}
                ${atCampus.length > 5 ? html`<text x="${190 + 5 * 34 - 12}" y="726" font-size="11" font-weight="800" fill="${ink}">+${atCampus.length - 5}</text>` : ''}
              </g>
            </svg>
            <div class="map-note">${t('Schematic map, not to scale. Drag to pan when zoomed in. Buses shown next to the entrance are waiting at campus; the live position of buses on the road is on')} <a href="#/student/track">${t('Track my bus')}</a>.</div>
          </div>
        </div>

        <div class="stack">
          <div class="card stack" aria-live="polite">
            ${!sel ? html`<div class="card-head"><h2>${t('Select a place')}</h2></div><p class="muted">${t('Tap a building or facility on the map, or search above, to see floors, rooms and what is there.')}</p>` : ''}
            ${selB ? html`<div class="card-head"><h2>${t(selB.name)}</h2><button type="button" class="btn sm ghost" data-click="clear">${t('Clear')}</button></div>
              ${selB.floors.length ? html`<ol class="cm-floors">${[...selB.floors].reverse().map(([f, rooms]) => html`<li class="${sel.floor === f ? 'on' : ''}"><span class="cm-floor">${t('{f} floor', { f: t(f) })}</span><span>${t(rooms)}</span></li>`)}</ol>`
                : html`<p class="muted">${t('Floor and room details for this building are not listed on the official map yet.')}</p>`}` : ''}
            ${selP ? html`<div class="card-head"><h2>${t(selP.name)}</h2><button type="button" class="btn sm ghost" data-click="clear">${t('Clear')}</button></div><p class="muted">${t('Marked on the campus map.')} ${selP.kind === 'zone' ? t('It is the hatched area between the R and S buildings.') : t('Look for its icon on the map.')}</p>` : ''}
            ${selF ? html`<div class="card-head"><h2>${t(selF.name)}</h2><button type="button" class="btn sm ghost" data-click="clear">${t('Clear')}</button></div><p class="muted">${t('{group} on campus', { group: t(selF.group) })}${selF.n ? ` ${t('(number {n} on the map)', { n: selF.n })}` : ''}. ${t('The pin shows its approximate area.')}</p>` : ''}
          </div>

          <div class="card stack">
            <div class="card-head"><h2>${t('Buses at campus now')}</h2><span class="small muted">${t('Updates every few seconds')}</span></div>
            ${view.state.live.loading && !view.state.live.data ? html`<p class="muted">${t('Loading…')}</p>` : ''}
            ${view.state.live.data && !atCampus.length ? html`<p class="muted">${t('No buses are waiting at campus right now.')}</p>` : ''}
            <div class="campus-list" tabindex="0" role="region" aria-label="${t('Buses at campus now')}">
            ${atCampus.map((tr) => html`<div class="row between" data-key="ac-${tr.id}">
              <div><b class="mono">${t('Bus {n}', { n: tr.bus.number })}</b> <span class="small muted">· ${tr.route.code} ${tr.route.name}</span></div>
              ${tripStatusBadge(tr)}
            </div>`)}
            </div>
            ${onRoad.length > 0 ? html`<p class="small muted">${t('{n} more on the road.', { n: onRoad.length })} <a href="#/student/track">${t('Track them live')}</a></p>` : ''}
          </div>

          <div class="card stack">
            <div class="card-head"><h2>${t('Food & drinks')}</h2></div>
            ${['Restaurants', 'Drinks'].map((g) => html`<div>
              <div class="small muted" style="font-weight:700;margin-bottom:6px">${t(g)}</div>
              <div class="seg-chips">${FOOD.filter((f) => f.group === g).map((f) => html`<button type="button" class="chip" aria-pressed="${bool(selF?.id === f.id)}" data-click="pick-item" data-type="f" data-id="${f.id}">${f.n ? `${f.n} · ` : ''}${t(f.name)}</button>`)}</div>
            </div>`)}
          </div>
        </div>
      </div>`;
    },
    actions: {
      'pick-item': (el) => { if (drag?.moved) return; pick({ type: el.dataset.type, id: el.dataset.id }); },
      'pick-result': (el) => { const r = search(view.state.q)[Number(el.dataset.i)]; if (r) { pick(r.sel); view.state.q = ''; view.update(); } },
      layer: (el) => { const l = el.dataset.l; view.state.layers = { ...view.state.layers, [l]: !view.state.layers[l] }; view.update(); },
      zoom: (el) => zoomTo(Math.min(3, Math.max(1, view.state.vp.k + Number(el.dataset.d)))),
      reset: () => view.set({ vp: { k: 1, x: 0, y: 0 } }),
      clear: () => view.set({ sel: null }),
    },
  };
}

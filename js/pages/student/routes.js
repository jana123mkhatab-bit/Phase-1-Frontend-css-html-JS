import { html, bool } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { getUser, setUser } from '../../core/auth.js';
import { t } from '../../core/i18n.js';
import { icon } from '../../core/icons.js';
import { asyncBlock, pageHead, empty, toast } from '../../core/ui.js';
import { transitMap } from '../../components/transit-map.js';

export default function routesPage(view, ctx) {
  ctx.setTitle('Routes & stops');
  view.load('cat', () => api.get('/api/student/catalog'));
  view.load('favs', () => api.get('/api/student/favorites'));
  Object.assign(view.state, { routeId: null, favList: null, loc: null, near: null, geoErr: '', busy: false });

  const favList = () => view.state.favList ?? view.state.favs.data?.favorites ?? [];
  const favOf = (rid, sid) => favList().find((f) => f.route_id === rid && f.stop_id === sid);

  async function toggleFav(routeId, stopId) {
    const cur = favOf(routeId, stopId);
    const before = favList();
    if (cur) {
      view.set({ favList: before.filter((f) => f.id !== cur.id) });
      try { await api.del(`/api/student/favorites/${cur.id}`); toast(t('Removed from favourites')); } catch (e) { view.set({ favList: before }); toast(e.message, 'error'); }
    } else {
      view.set({ favList: [...before, { id: -1, route_id: routeId, stop_id: stopId }] });
      try { const d = await api.post('/api/student/favorites', { route_id: routeId, stop_id: stopId }); view.set({ favList: [...before, d.favorite] }); toast(t('Added to favourites')); } catch (e) { view.set({ favList: before }); toast(e.message, 'error'); }
    }
  }

  async function choose(s) {
    try {
      const d = await api.put('/api/student/profile', { route_id: s.route_id ?? s.routeId, stop_id: s.id, ...(s.walk_minutes ? { walk_minutes: s.walk_minutes } : {}) });
      setUser('student', d.user); toast(t('{name} is now your collection point', { name: s.name })); view.update();
    } catch (e) { toast(e.message, 'error'); }
  }

  function find() {
    view.set({ geoErr: '', busy: true });
    if (!('geolocation' in navigator)) { view.set({ geoErr: t('Your browser does not support location. Browse the routes below instead.'), busy: false }); return; }
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      try { const d = await api.get(`/api/student/stops/nearest?lat=${here.lat}&lng=${here.lng}`); view.set({ loc: here, near: d.stops }); }
      catch (e) { view.set({ geoErr: e.message }); } finally { view.set({ busy: false }); }
    }, (err) => {
      view.set({ geoErr: err.code === 1 ? t('Location permission was denied. You can allow it in your browser settings, or browse the routes below.') : t('Could not get your location. Browse the routes below instead.'), busy: false });
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  }

  return {
    render: () => {
      const user = getUser('student');
      const { routeId, loc, near, geoErr, busy } = view.state;
      return html`${pageHead(t('Routes & collection points'), t('Browse every route in order, or find the closest collection point to where you are.'))}
      <div class="card tint stack">
        <div class="row between">
          <div><h2>${t('Find the nearest collection point')}</h2><p class="small">${t('Uses your device location once, only when you press the button. Your location is not stored.')}</p></div>
          <button class="btn" data-click="find" ${busy ? 'disabled' : ''}>${busy ? t('Locating…') : t('Use my location')}</button>
        </div>
        ${geoErr ? html`<div class="alert warn" role="alert">${geoErr}</div>` : ''}
        ${near ? (near.length ? html`<div class="table-wrap"><table class="t"><thead><tr><th>${t('Collection point')}</th><th>${t('Route')}</th><th>${t('Distance')}</th><th>${t('Walk')}</th><th></th></tr></thead><tbody>
          ${near.map((s, i) => html`<tr><td><b>${s.name}</b></td><td>${s.route_code} · ${s.route_name}</td><td>${s.distance_m >= 1000 ? t('{n} km', { n: (s.distance_m / 1000).toFixed(1) }) : t('{n} m', { n: s.distance_m })}</td><td>~${t('{n} min', { n: s.walk_minutes })}</td>
            <td class="actions"><button class="btn sm" data-click="choose-near" data-i="${i}" ${user.stop_id === s.id ? 'disabled' : ''}>${user.stop_id === s.id ? t('Current') : t('Use as my stop')}</button></td></tr>`)}
        </tbody></table></div>` : empty(t('No collection points found'))) : ''}
      </div>
      ${asyncBlock(view.state.cat, 'cat', (d) => html`<div class="split">
        ${transitMap({ campus: d.campus, routes: d.routes, trips: [], routeFilter: routeId, userLoc: loc, highlightStopId: user.stop_id })}
        <div class="stack">
          <div class="seg" role="group" aria-label="${t('Filter by route')}">
            <button aria-pressed="${bool(!routeId)}" data-click="filter" data-id="">${t('All')}</button>
            ${d.routes.filter((r) => r.active).map((r) => html`<button aria-pressed="${bool(routeId === r.id)}" data-click="filter" data-id="${r.id}">${r.code}</button>`)}
          </div>
          <div class="route-track" tabindex="0" role="region" aria-label="${t('Routes & stops')}">
          ${d.routes.filter((r) => (routeId ? r.id === routeId : true)).map((r) => html`<section class="card" aria-label="${r.name}" data-key="rt-${r.id}">
            <div class="card-head"><div><h3>${r.code} · ${r.name}</h3><span class="small muted">${r.area}</span></div>${!r.active ? html`<span class="badge crit">${t('Not running')}</span>` : ''}${user.route_id === r.id ? html`<span class="badge sky">${t('My route')}</span>` : ''}</div>
            <ol class="journey">
              <li><span class="pip" style="border-color:var(--ink)"></span><span class="muted">${t('{name} (start)', { name: d.campus?.name })}</span><span></span></li>
              ${r.stops.map((s) => {
                const fav = !!favOf(r.id, s.id);
                return html`<li class="${user.stop_id === s.id ? 'mine' : ''}" data-key="st-${r.id}-${s.id}"><span class="pip"></span><span><b>${s.name}</b></span>
                  <span class="row" style="gap:4px;flex-wrap:nowrap">
                    <button type="button" class="btn sm ghost star-btn" aria-pressed="${bool(fav)}" ${!r.active && !fav ? 'disabled' : ''}
                      aria-label="${fav ? t('Remove {stop} from favourites', { stop: s.name }) : t('Add {stop} to favourites', { stop: s.name })}"
                      title="${fav ? t('Remove from favourites') : t('Add to favourites')}" data-click="fav" data-r="${r.id}" data-s="${s.id}">${icon('star', 18)}</button>
                    <button class="btn sm ghost" data-click="choose" data-r="${r.id}" data-s="${s.id}" ${user.stop_id === s.id || !r.active ? 'disabled' : ''}>${user.stop_id === s.id ? t('My stop') : t('Choose')}</button>
                  </span></li>`;
              })}
            </ol>
          </section>`)}
          </div>
        </div>
      </div>`)}`;
    },
    actions: {
      find,
      filter: (el) => view.set({ routeId: el.dataset.id ? Number(el.dataset.id) : null }),
      fav: (el) => toggleFav(Number(el.dataset.r), Number(el.dataset.s)),
      choose: (el) => {
        const r = view.state.cat.data.routes.find((x) => x.id === Number(el.dataset.r));
        const s = r.stops.find((x) => x.id === Number(el.dataset.s));
        choose({ ...s, route_id: r.id });
      },
      'choose-near': (el) => choose(view.state.near[Number(el.dataset.i)]),
    },
  };
}

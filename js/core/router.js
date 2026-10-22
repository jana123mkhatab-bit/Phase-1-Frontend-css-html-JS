// Hash router (#/student/track?x=1). Hash routing keeps the prototype a pure static site:
// it works from any static file server, VS Code Live Server, or even file://.
import { mountView } from './view.js';
import { currentUser, onSessionLost } from './auth.js';
import { onLangChange, t } from './i18n.js';
import { closeAllModals, loading } from './ui.js';
import { mountLayout } from '../components/layouts.js';

let rootEl = null;
let routes = [];
let current = null; // { layoutKey, layout, page, path }
let pendingState = null;
let renderToken = 0;

export function currentPath() {
  const h = location.hash.replace(/^#/, '') || '/';
  return h.split('?')[0] || '/';
}
export function currentQuery() {
  const h = location.hash.replace(/^#/, '');
  const q = h.includes('?') ? h.slice(h.indexOf('?') + 1) : '';
  return Object.fromEntries(new URLSearchParams(q).entries());
}

export function navigate(path, { replace = false, state = null } = {}) {
  pendingState = state;
  const target = `#${path}`;
  if (location.hash === target || (target === '#/' && !location.hash)) { render(); return; }
  if (replace) location.replace(target); else location.hash = target;
}

/** Update the query string without re-rendering the page (e.g. remembering the selected bus). */
export function setQuery(params) {
  const q = new URLSearchParams(params).toString();
  history.replaceState(null, '', `#${currentPath()}${q ? `?${q}` : ''}`);
}

function destroyAll() {
  closeAllModals();
  if (!current) return;
  current.page?.destroy();
  current.layout?.view.destroy();
  current = null;
  rootEl.innerHTML = '';
}

export const setTitle = (title) => { document.title = `${t(title)} · ${t('Campus in Motion')}`; };

async function render() {
  const token = ++renderToken;
  const path = currentPath();
  const query = currentQuery();
  const state = pendingState; pendingState = null;
  const route = routes.find((r) => r.path === path) || routes.find((r) => r.path === '*');
  closeAllModals();

  const role = route.layout || null;
  let user = null;
  if (role) {
    user = await currentUser(role);
    if (token !== renderToken) return;
    if (!user) { navigate(`/${role}/login`, { replace: true, state: { from: path } }); return; }
  }
  const mod = await route.load();
  if (token !== renderToken) return;
  const ctx = { path, query, state, navigate, user, role, setTitle };

  if (role) {
    if (!current || current.layoutKey !== role) {
      destroyAll();
      current = { layoutKey: role, layout: mountLayout(rootEl, role), page: null };
    }
    current.layout.go(path);
    current.page?.destroy();
    const main = current.layout.main();
    main.innerHTML = '';
    current.page = mountView(main, (v) => mod.default(v, ctx), ctx);
    window.scrollTo(0, 0);
  } else {
    destroyAll();
    current = { layoutKey: null, layout: null, page: mountView(rootEl, (v) => mod.default(v, ctx), ctx) };
    // honour an in-page anchor request such as #/?to=routes (not used) – otherwise start at the top
    window.scrollTo(0, 0);
  }
}

export function startRouter(root, routeTable) {
  rootEl = root;
  routes = routeTable;
  window.addEventListener('hashchange', render);
  // switching language re-renders everything so every string is translated again
  onLangChange(() => { render(); });
  onSessionLost((role) => {
    if (current?.layoutKey === role) navigate(`/${role}/login`, { replace: true, state: { from: currentPath() } });
  });
  root.innerHTML = `<div class="loading" role="status"><span class="spinner"></span></div>`;
  render();
}
export { loading };

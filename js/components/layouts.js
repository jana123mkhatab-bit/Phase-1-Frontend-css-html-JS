// The signed-in shell (sidebar + main area) for students and administrators.
import { html, bool, raw } from '../core/dom.js';
import { mountView } from '../core/view.js';
import { api } from '../core/api.js';
import { t, isAr } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { getUser, logout } from '../core/auth.js';
import { navigate } from '../core/router.js';
import { langSwitch, themeSwitch } from './switches.js';
import { mountChat } from './chatbot.js';

const STUDENT_NAV = [
  { to: '/student', label: 'Live dashboard', icon: 'bus', end: true },
  { to: '/student/track', label: 'Track my bus', icon: 'pin' },
  { to: '/student/routes', label: 'Routes & stops', icon: 'route' },
  { to: '/student/campus-map', label: 'Campus map', icon: 'map' },
  { to: '/student/reserve', label: 'Reserve a seat', icon: 'seat' },
  { to: '/student/notifications', label: 'Notifications', icon: 'bell' },
  { to: '/student/schedule', label: 'My timetable', icon: 'cal' },
  { to: '/student/errands', label: 'Errand planner', icon: 'route' },
  { to: '/student/history', label: 'Trip history', icon: 'history' },
  { to: '/student/report', label: 'Report an issue', icon: 'flag' },
  { to: '/student/settings', label: 'My settings', icon: 'user' },
];
const ADMIN_NAV = [
  { to: '/admin', label: 'Live monitor', icon: 'pin', end: true },
  { to: '/admin/buses', label: 'Buses', icon: 'bus' },
  { to: '/admin/routes', label: 'Routes & stops', icon: 'route' },
  { to: '/admin/drivers', label: 'Drivers', icon: 'users' },
  { to: '/admin/schedules', label: 'Schedules & trips', icon: 'cal' },
  { to: '/admin/reservations', label: 'Reservations', icon: 'seat' },
  { to: '/admin/updates', label: 'Service updates', icon: 'alert' },
  { to: '/admin/places', label: 'Places', icon: 'pin' },
  { to: '/admin/optimise', label: 'Capacity suggestions', icon: 'chart' },
  { to: '/admin/reports', label: 'Reports', icon: 'chart' },
  { to: '/admin/issues', label: 'Student issues', icon: 'flag' },
  { to: '/admin/audit', label: 'Audit log', icon: 'shield' },
];
const OUTBOX = { to: '/admin/outbox', label: 'Email outbox', icon: 'list' };

export function mountLayout(root, role) {
  const baseNav = role === 'admin' ? ADMIN_NAV : STUDENT_NAV;
  let chatMounted = false;
  const view = mountView(root, (v) => {
    let collapsed = false;
    try { collapsed = localStorage.getItem('side-collapsed') === '1'; } catch { /* ignore */ }
    Object.assign(v.state, { path: '/', open: false, collapsed });
    if (role === 'student') v.load('me', () => api.get('/api/student/auth/me'), { ms: 15000 });
    else { v.load('ov', () => api.get('/api/admin/overview'), { ms: 20000 }); v.load('me', () => api.get('/api/admin/auth/me')); }
    v.listen(document, 'keydown', (e) => { if (e.key === 'Escape' && v.state.open) v.set({ open: false }); });

    const counts = () => (role === 'student'
      ? { '/student/notifications': v.state.me?.data?.unread ?? 0 }
      : { '/admin': v.state.ov?.data?.open_anomalies ?? 0, '/admin/issues': v.state.ov?.data?.open_issues ?? 0 });
    const isActive = (n) => (n.end ? v.state.path === n.to : v.state.path === n.to || v.state.path.startsWith(`${n.to}/`));

    return {
      render: () => {
        const { open, collapsed: col } = v.state;
        const user = getUser(role);
        if (!user) return '';
        const nav = role === 'admin' && v.state.me?.data?.mail?.provider === 'outbox' ? [...baseNav, OUTBOX] : baseNav;
        const c = counts();
        return html`<div class="shell ${col ? 'collapsed' : ''}" data-key="shell">
          <a class="skip" href="#/" data-scroll="main">${t('Skip to content')}</a>
          <div class="mobile-bar">
            <a href="#/" class="brand"><span class="brand-mark">${icon('bus', 18)}</span>${t('Campus in Motion')}</a>
            <div class="row" style="gap:8px">${langSwitch()}<button class="btn sm secondary" data-click="toggle-menu" aria-expanded="${bool(open)}" aria-controls="sidenav">${icon('menu', 18)}${t('Menu')}</button></div>
          </div>
          ${open ? html`<div class="scrim" data-click="close-menu"></div>` : ''}
          <aside class="side ${role} ${open ? 'open' : ''}" id="sidenav">
            <button type="button" class="side-toggle" data-click="toggle-collapse" aria-expanded="${bool(!col)}" aria-controls="sidenav" aria-label="${col ? t('Expand menu') : t('Collapse menu')}" title="${col ? t('Expand menu') : t('Collapse menu')}">
              ${icon(col !== isAr() ? 'chevright' : 'chevleft', 16)}
            </button>
            <a href="#/" class="brand" title="${t('Campus in Motion')}"><span class="brand-mark">${icon('bus')}</span><span class="side-label">${t('Campus in Motion')}</span></a>
            <div class="side-role"><span class="role-tag">${role === 'admin' ? t('Administrator') : t('Student')}</span></div>
            <nav class="nav" aria-label="${role === 'admin' ? t('Administrator navigation') : t('Student navigation')}">
              ${nav.map((n) => html`<a href="#${n.to}" class="${isActive(n) ? 'active' : ''}" ${isActive(n) ? raw('aria-current="page"') : ''} title="${t(n.label)}" data-key="nav-${n.to}">
                ${icon(n.icon, 18)}<span class="side-label">${t(n.label)}</span>
                ${c[n.to] > 0 ? html`<span class="count" aria-label="${t('{n} new', { n: c[n.to] })}">${c[n.to]}</span>` : ''}
              </a>`)}
            </nav>
            <div class="side-foot">
              <div class="side-user"><b style="color:#fff">${user.name}</b><br><span style="word-break:break-all">${user.email}</span></div>
              <div class="side-label">${langSwitch()}</div>
              <div class="side-label">${themeSwitch()}</div>
              <button class="btn sm secondary" data-click="logout" title="${t('Sign out')}">${icon('logout', 16)}<span class="side-label">${t('Sign out')}</span></button>
            </div>
          </aside>
          <main class="main" id="main" tabindex="-1" data-key="main" data-static></main>
        </div>
        ${role === 'student' ? html`<div id="chat-root" data-key="chat-root" data-static></div>` : ''}`;
      },
      after: () => {
        if (role === 'student' && !chatMounted) {
          const host = root.querySelector('#chat-root');
          if (host) { chatMounted = true; const chat = mountChat(host); v.onCleanup(() => chat.destroy()); }
        }
      },
      actions: {
        'toggle-menu': () => v.set({ open: !v.state.open }),
        'close-menu': () => v.set({ open: false }),
        'toggle-collapse': () => {
          const next = !v.state.collapsed;
          try { localStorage.setItem('side-collapsed', next ? '1' : '0'); } catch { /* ignore */ }
          v.set({ collapsed: next });
        },
        logout: async () => { await logout(role); navigate('/'); },
      },
    };
  });
  return {
    view,
    go(path) { view.set({ path, open: false }); view.flush(); },
    main: () => root.querySelector('#main'),
  };
}

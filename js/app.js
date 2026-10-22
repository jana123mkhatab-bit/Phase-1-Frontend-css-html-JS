// Route table. Pages are loaded on demand. `layout` marks the signed-in areas (and which role may enter).
export const routes = [
  { path: '/', load: () => import('./pages/landing.js') },
  { path: '/student/login', load: () => import('./pages/login.js').then((m) => ({ default: m.student })) },
  { path: '/admin/login', load: () => import('./pages/login.js').then((m) => ({ default: m.admin })) },

  { path: '/student', layout: 'student', load: () => import('./pages/student/dashboard.js') },
  { path: '/student/track', layout: 'student', load: () => import('./pages/student/track.js') },
  { path: '/student/routes', layout: 'student', load: () => import('./pages/student/routes.js') },
  { path: '/student/campus-map', layout: 'student', load: () => import('./pages/student/campus-map.js') },
  { path: '/student/reserve', layout: 'student', load: () => import('./pages/student/reserve.js') },
  { path: '/student/notifications', layout: 'student', load: () => import('./pages/student/notifications.js') },
  { path: '/student/history', layout: 'student', load: () => import('./pages/student/history.js') },
  { path: '/student/report', layout: 'student', load: () => import('./pages/student/report.js') },
  { path: '/student/schedule', layout: 'student', load: () => import('./pages/student/schedule.js') },
  { path: '/student/errands', layout: 'student', load: () => import('./pages/student/errands.js') },
  { path: '/student/settings', layout: 'student', load: () => import('./pages/student/settings.js') },

  { path: '/admin', layout: 'admin', load: () => import('./pages/admin/monitor.js') },
  { path: '/admin/buses', layout: 'admin', load: () => import('./pages/admin/buses.js') },
  { path: '/admin/routes', layout: 'admin', load: () => import('./pages/admin/routes.js') },
  { path: '/admin/drivers', layout: 'admin', load: () => import('./pages/admin/drivers.js') },
  { path: '/admin/schedules', layout: 'admin', load: () => import('./pages/admin/schedules.js') },
  { path: '/admin/reservations', layout: 'admin', load: () => import('./pages/admin/reservations.js') },
  { path: '/admin/updates', layout: 'admin', load: () => import('./pages/admin/updates.js') },
  { path: '/admin/reports', layout: 'admin', load: () => import('./pages/admin/reports.js') },
  { path: '/admin/issues', layout: 'admin', load: () => import('./pages/admin/issues.js') },
  { path: '/admin/audit', layout: 'admin', load: () => import('./pages/admin/audit.js') },
  { path: '/admin/outbox', layout: 'admin', load: () => import('./pages/admin/outbox.js') },
  { path: '/admin/places', layout: 'admin', load: () => import('./pages/admin/places.js') },
  { path: '/admin/optimise', layout: 'admin', load: () => import('./pages/admin/optimise.js') },

  { path: '*', load: () => import('./pages/not-found.js') },
];

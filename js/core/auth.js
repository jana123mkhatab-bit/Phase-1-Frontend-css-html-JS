import { api, addUnauthorizedHandler } from './api.js';

/**
 * Two completely separate sessions. A student session never grants admin access (and vice versa):
 * each role has its own endpoints and login page. The (demo) backend re-checks the role on every request.
 */
const users = { student: undefined, admin: undefined }; // undefined = not asked yet, null = signed out
const asked = {};

export async function currentUser(role) {
  if (users[role] !== undefined) return users[role];
  if (!asked[role]) {
    asked[role] = api.get(`/api/${role}/auth/me`).then((d) => { users[role] = d.user; }).catch(() => { users[role] = null; });
  }
  await asked[role];
  return users[role];
}
export const getUser = (role) => users[role] ?? null;
export function setUser(role, user) { users[role] = user; }

export async function login(role, email, password) {
  const d = await api.post(`/api/${role}/auth/login`, { email, password });
  users[role] = d.user;
}
export async function register(role, body) {
  const d = await api.post(`/api/${role}/auth/register`, body);
  users[role] = d.user;
}
export async function logout(role) {
  try { await api.post(`/api/${role}/auth/logout`); } finally {
    try { sessionStorage.removeItem('chat-history'); } catch { /* ignore */ }
    users[role] = null;
  }
}
/** Router hooks this to send the user to the sign-in page when the session expires. */
export function onSessionLost(fn) {
  return addUnauthorizedHandler((url) => {
    for (const role of ['student', 'admin']) {
      if (url.startsWith(`/api/${role}/`) && !url.includes('/auth/')) { users[role] = null; fn(role); }
    }
  });
}

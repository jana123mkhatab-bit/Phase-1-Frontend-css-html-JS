// Entry point of the in-browser mock backend: a tiny router in front of the handlers in student.js / admin.js.
import { initState, save, S } from './state.js';
import { MockError } from './util.js';
import { register as registerStudent } from './student.js';
import { register as registerAdmin } from './admin.js';

export const MOCK = true;

const routes = [];
const route = (method, pattern, fn) => {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:([a-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
  routes.push({ method, re, keys, fn });
};
let ready = false;
function boot() {
  if (ready) return;
  ready = true;
  initState();
  registerStudent(route);
  registerAdmin(route);
}

const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** Same contract as fetch + JSON: resolves with the response body, rejects with { status, message, code } like the real API's errors. */
export async function mockRequest(method, url, body) {
  boot();
  await wait(40 + Math.random() * 80);
  const u = new URL(url, 'http://mock.local');
  const query = Object.fromEntries(u.searchParams);
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(u.pathname);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    try {
      const out = r.fn({ params, query, body: body === undefined ? undefined : structuredClone(body), now: Date.now() }) ?? {};
      if (method !== 'GET') save();
      const { __status, ...data } = out;
      return structuredClone(data);
    } catch (e) {
      if (e instanceof MockError) throw e;
      console.error('[mock]', method, url, e);
      throw new MockError(500, 'Something went wrong in the demo backend');
    }
  }
  throw new MockError(404, 'Not found');
}
export { S };

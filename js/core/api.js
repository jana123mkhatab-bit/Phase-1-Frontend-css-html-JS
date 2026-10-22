import { t, localize } from './i18n.js';
import { mockRequest } from '../mock/index.js';

// Every request goes to the in-browser demo backend (js/mock/) instead of the network, so the whole prototype
// works without a server. The contract is the same as fetch + JSON: resolve with the body, reject with { status, message }.
export class ApiError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

const handlers = new Set();
export const addUnauthorizedHandler = (fn) => { handlers.add(fn); return () => handlers.delete(fn); };

async function request(method, url, body) {
  try {
    return localize(await mockRequest(method, url, body));
  } catch (e) {
    const err = new ApiError(e.status ?? 500, localize(e.message, 'error') || t('Request failed ({status})', { status: e.status ?? 500 }), e.code);
    if (err.status === 401) handlers.forEach((h) => h(url, err));
    throw err;
  }
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b = {}) => request('POST', u, b),
  put: (u, b = {}) => request('PUT', u, b),
  patch: (u, b = {}) => request('PATCH', u, b),
  del: (u) => request('DELETE', u),
};

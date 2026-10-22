// A "view" is a small component: state + a render() that returns an html`` string + delegated events.
// There is no virtual DOM; morph() patches the real DOM after every state change.
import { morph } from './dom.js';

const EVENTS = ['click', 'input', 'change', 'submit', 'keydown', 'focusout'];

/**
 * mountView(root, setup, ctx)
 *   setup(view) runs once and returns { render(), actions?, after?() }.
 *   Markup hooks:  data-click="name"  data-input="name"  data-change="name"  data-submit="name"  data-keydown="name"
 *                  data-bind="state.path"   (two-way binding for inputs/selects/checkboxes)
 *                  data-retry="loaderKey"   (re-run a failed view.load)
 */
export function mountView(root, setup, ctx = {}) {
  const cleanups = [];
  const loaders = {};
  let scheduled = false;
  let destroyed = false;
  let spec = { render: () => '', actions: {} };

  const view = {
    root, ctx, state: {},
    set(patch) { Object.assign(view.state, typeof patch === 'function' ? patch(view.state) : patch); view.update(); },
    update() { if (scheduled || destroyed) return; scheduled = true; queueMicrotask(() => { scheduled = false; view.flush(); }); },
    flush() {
      if (destroyed) return;
      scheduled = false;
      morph(root, spec.render());
      spec.after?.();
    },
    get destroyed() { return destroyed; },
    onCleanup(fn) { cleanups.push(fn); },
    interval(fn, ms) { const id = setInterval(fn, ms); cleanups.push(() => clearInterval(id)); return id; },
    timeout(fn, ms) { const id = setTimeout(fn, ms); cleanups.push(() => clearTimeout(id)); return id; },
    listen(target, ev, fn, opts) { target.addEventListener(ev, fn, opts); cleanups.push(() => target.removeEventListener(ev, fn, opts)); },
    $(sel) { return root.querySelector(sel); },
    $$(sel) { return Array.from(root.querySelectorAll(sel)); },
    /**
     * Load data into state[key] = { data, error, loading } and optionally re-poll every `ms` while the tab is visible.
     * Mirrors the original usePoll(): stale requests are ignored, a failed refresh keeps the old data on screen.
     */
    load(key, fn, { ms = 0 } = {}) {
      let token = 0;
      let timer = null;
      let paused = false;
      view.state[key] = { data: null, error: null, loading: true };
      const run = async (silent = false) => {
        const my = ++token;
        if (!silent) view.state[key] = { ...view.state[key], loading: true };
        if (!silent) view.update();
        try {
          const data = await fn();
          if (my !== token || destroyed) return;
          view.state[key] = { data, error: null, loading: false };
        } catch (e) {
          if (my !== token || destroyed) return;
          view.state[key] = { data: view.state[key].data, error: e, loading: false };
        }
        view.update();
      };
      const arm = () => { clearInterval(timer); if (ms > 0 && !paused) timer = setInterval(() => { if (!document.hidden) run(true); }, ms); };
      const vis = () => { if (!document.hidden && ms > 0 && !paused) run(true); };
      document.addEventListener('visibilitychange', vis);
      cleanups.push(() => { token++; clearInterval(timer); document.removeEventListener('visibilitychange', vis); });
      const ctl = {
        reload: () => run(false),
        refresh: () => run(true),
        pause(p) { paused = p; arm(); },
        stop() { token++; clearInterval(timer); },
      };
      loaders[key] = ctl;
      arm();
      run(false);
      return ctl;
    },
    loaders,
  };

  // ---- event delegation
  // events inside a nested [data-static] region (a child page or widget) belong to that child's own view
  const owns = (el) => { const st = el.closest('[data-static]'); return !st || st === root || !root.contains(st); };
  const onEvent = (ev) => {
    const type = ev.type;
    if (ev.target instanceof Element && !owns(ev.target)) return;
    if (type === 'input' || type === 'change') bind(ev);
    let el = ev.target instanceof Element ? ev.target.closest(`[data-${type}], [data-retry]`) : null;
    while (el && root.contains(el)) {
      if (!owns(el)) return;
      if (type === 'click' && el.hasAttribute('data-retry')) { loaders[el.getAttribute('data-retry')]?.reload(); return; }
      const name = el.getAttribute(`data-${type}`);
      const fn = name && spec.actions?.[name];
      if (fn) {
        if (type === 'submit') ev.preventDefault();
        fn(el, ev);
        return;
      }
      el = el.parentElement?.closest(`[data-${type}], [data-retry]`);
    }
  };
  function bind(ev) {
    const el = ev.target;
    if (!(el instanceof Element) || !el.hasAttribute('data-bind')) return;
    const path = el.getAttribute('data-bind').split('.');
    let target = view.state;
    for (let i = 0; i < path.length - 1; i++) target = target[path[i]];
    const last = path[path.length - 1];
    target[last] = el.type === 'checkbox' ? el.checked : el.type === 'number' && el.hasAttribute('data-num') ? (el.value === '' ? '' : Number(el.value)) : el.value;
    view.update();
  }
  EVENTS.forEach((t) => root.addEventListener(t, onEvent));

  view.destroy = () => {
    if (destroyed) return;
    destroyed = true;
    EVENTS.forEach((t) => root.removeEventListener(t, onEvent));
    cleanups.splice(0).forEach((f) => { try { f(); } catch { /* ignore */ } });
  };

  spec = { ...spec, ...(setup(view) || {}) };
  view.flush();
  return view;
}

/** Read a form into a plain object. */
export function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}


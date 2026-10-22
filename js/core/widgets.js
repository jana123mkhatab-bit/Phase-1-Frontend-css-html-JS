// Self-contained pieces (favourites strip, suggestion card, mic button…) that load their own data.
// A page puts <div data-widget="name" data-key="w-name" data-static></div> in its markup and calls syncWidgets()
// from its after() hook; props flow in through view.state.props.
import { mountView } from './view.js';
import { raw } from './dom.js';

export function syncWidgets(parent, defs, props = {}) {
  parent.root.querySelectorAll('[data-widget]').forEach((el) => {
    const name = el.getAttribute('data-widget');
    const def = defs[name];
    if (!def) return;
    if (!el.__widget) {
      const w = mountView(el, (v) => { v.state.props = props[name] ?? {}; return def(v); }, parent.ctx);
      el.__widget = w;
      parent.onCleanup(() => w.destroy());
    } else if (el.__widgetProps !== props[name]) {
      el.__widget.set({ props: props[name] ?? {} });
    }
    el.__widgetProps = props[name];
  });
}
export const widgetHost = (name, extra = '') => raw(`<div data-widget="${name}" data-key="w-${name}${extra ? `-${extra}` : ''}" data-static></div>`);

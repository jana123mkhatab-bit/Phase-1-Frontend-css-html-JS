// Tiny templating + DOM patching helpers (no framework).
//  - html`...`  builds an HTML string and escapes every interpolated value unless it came from html`` / raw()
//  - morph()    updates the live DOM to match a new HTML string, touching only what changed
//    (so focus, scroll position, CSS transitions and running animations survive a re-render)

export class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Safe(String(s ?? ''));
/** For building attribute text: attr`min="${v}"` escapes the values and can be placed inside a tag. */
export const attr = (strings, ...vals) => new Safe(strings.reduce((o, s, i) => o + s + (i < vals.length ? esc(vals[i]) : ''), ''));

const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ENT[c]);

function str(v) {
  if (v == null || v === false || v === true) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(str).join('');
  return esc(v);
}
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += str(vals[i]) + strings[i + 1];
  return new Safe(out);
}
/** Boolean attribute helper: ${on(cond, 'disabled')} */
export const on = (cond, attr) => (cond ? attr : '');
export const cls = (...a) => a.filter(Boolean).join(' ');
/** For aria-* attributes that need the literal strings "true"/"false". */
export const bool = (v) => String(!!v);

// ---------------------------------------------------------------- morph
const keyOf = (n) => (n.nodeType === 1 ? n.getAttribute('data-key') || n.id || null : null);
const sameKind = (a, b) => a.nodeType === b.nodeType && a.nodeName === b.nodeName && (a.nodeType !== 1 || a.namespaceURI === b.namespaceURI);

function syncAttrs(o, n) {
  for (const a of Array.from(o.attributes)) if (!n.hasAttribute(a.name)) o.removeAttribute(a.name);
  for (const a of Array.from(n.attributes)) if (o.getAttribute(a.name) !== a.value) o.setAttribute(a.name, a.value);
}

function patchNode(o, n) {
  if (o.nodeType !== 1) { if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue; return; }
  syncAttrs(o, n);
  if (o.hasAttribute('data-static')) return; // content managed imperatively
  const tag = o.nodeName;
  if (tag === 'TEXTAREA') {
    if (o !== document.activeElement && o.value !== n.textContent) o.value = n.textContent;
    return;
  }
  patchChildren(o, n);
  if (tag === 'INPUT') {
    if (o.type === 'checkbox' || o.type === 'radio') o.checked = n.hasAttribute('checked');
    else if (o !== document.activeElement || o.type === 'range') { const v = n.getAttribute('value') ?? ''; if (o.value !== v) o.value = v; }
  } else if (tag === 'SELECT') {
    const sel = Array.from(n.options).find((x) => x.hasAttribute('selected'));
    if (sel) o.value = sel.value; else if (o.options.length) o.selectedIndex = 0;
  }
}

function patchChildren(o, n) {
  const oldKids = Array.from(o.childNodes);
  const newKids = Array.from(n.childNodes);
  const keyed = new Map();
  oldKids.forEach((k) => { const key = keyOf(k); if (key && !keyed.has(key)) keyed.set(key, k); });
  newKids.forEach((nk, i) => {
    const key = keyOf(nk);
    const cur = o.childNodes[i] || null;
    const hit = key ? keyed.get(key) : null;
    if (hit && sameKind(hit, nk)) {
      keyed.delete(key);
      if (hit !== cur) o.insertBefore(hit, cur);
      patchNode(hit, nk);
    } else if (cur && !keyOf(cur) && !key && sameKind(cur, nk)) {
      patchNode(cur, nk);
    } else {
      o.insertBefore(document.importNode(nk, true), cur);
    }
  });
  while (o.childNodes.length > newKids.length) o.removeChild(o.lastChild);
}

export function morph(root, htmlString) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(htmlString);
  patchChildren(root, tpl.content);
}

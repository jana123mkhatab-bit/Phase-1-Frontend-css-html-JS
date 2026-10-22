import { html, raw, attr } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { t, dateLocale } from '../../core/i18n.js';
import { asyncBlock, pageHead, empty, field } from '../../core/ui.js';

const PAGE = 25;
const EMPTY = { q: '', entity: '', action: '', from: '', to: '' };
const fmtTs = (iso) => new Date(iso).toLocaleString(dateLocale(), { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const nice = (a) => {
  const [e, ...rest] = String(a).split('.');
  return `${t(`audit.${e}`) === `audit.${e}` ? `${e.charAt(0).toUpperCase()}${e.slice(1)}` : t(`audit.${e}`)} · ${rest.length ? (t(`audit.${rest.join('.')}`) === `audit.${rest.join('.')}` ? rest.join('.') : t(`audit.${rest.join('.')}`)) : ''}`;
};
const entityLabel = (x) => (t(`audit.${x}`) === `audit.${x}` ? String(x).replace('_', ' ') : t(`audit.${x}`));

export default function audit(view, ctx) {
  ctx.setTitle('Audit log');
  Object.assign(view.state, { f: { ...EMPTY }, offset: 0, q: '' });
  const rangeBad = () => view.state.f.from && view.state.f.to && view.state.f.from > view.state.f.to;
  const list = view.load('list', () => {
    if (rangeBad()) return Promise.resolve(null);
    const { f, offset, q } = view.state;
    const qs = new URLSearchParams({ limit: PAGE, offset });
    for (const [k, v] of Object.entries({ q, entity: f.entity, action: f.action, from: f.from, to: f.to })) if (v) qs.set(k, v);
    return api.get(`/api/admin/audit?${qs}`);
  });
  let deb = null;
  const refetch = (delay = 0) => { clearTimeout(deb); deb = setTimeout(() => list.reload(), delay); };
  view.onCleanup(() => clearTimeout(deb));

  return {
    render: () => {
      const { f, offset } = view.state;
      const d = view.state.list.data;
      const total = d?.total ?? 0;
      const actions = d?.actions ?? [];
      const bad = rangeBad();
      const dirty = Object.values(f).some(Boolean);
      return html`${pageHead(t('Audit log'), t('A read-only record of every administrative change: who did what, to which record, and when. Entries cannot be edited or deleted.'), html`<button class="btn secondary" data-click="refresh" ${view.state.list.loading ? 'disabled' : ''}>${t('Refresh')}</button>`)}
      <div class="card stack" role="search" aria-label="${t('Audit log filters')}">
        <div class="form-grid">
          ${field({ label: t('Search'), id: 'au-q' }, html`<input id="au-q" type="search" class="input" value="${f.q}" maxlength="80" placeholder="${t('Admin, action or details')}" data-bind="f.q" data-input="f-q">`)}
          ${field({ label: t('Record type'), id: 'au-e' }, html`<select id="au-e" class="input" data-bind="f.entity" data-change="filter"><option value="">${t('All records')}</option>${(d?.entities ?? (f.entity ? [f.entity] : [])).map((x) => html`<option value="${x}" ${f.entity === x ? 'selected' : ''}>${entityLabel(x)}</option>`)}</select>`)}
          ${field({ label: t('Action'), id: 'au-a' }, html`<select id="au-a" class="input" data-bind="f.action" data-change="filter"><option value="">${t('All actions')}</option>${(f.action && !actions.includes(f.action) ? [...actions, f.action] : actions).map((x) => html`<option value="${x}" ${f.action === x ? 'selected' : ''}>${nice(x)}</option>`)}</select>`)}
          ${field({ label: t('From'), id: 'au-f' }, html`<input id="au-f" type="date" class="input" value="${f.from}" data-bind="f.from" data-change="filter">`)}
          ${field({ label: t('To'), id: 'au-t', error: bad ? t('The start date must be on or before the end date') : '' }, html`<input id="au-t" type="date" class="input" value="${f.to}" ${f.from ? attr`min="${f.from}"` : ''} data-bind="f.to" data-change="filter" ${bad ? raw('aria-invalid="true" aria-describedby="au-t-err"') : ''}>`)}
        </div>
        ${dirty ? html`<div><button class="btn sm ghost" data-click="clear">${t('Clear filters')}</button></div>` : ''}
      </div>
      ${!bad ? asyncBlock(view.state.list, 'list', (r) => (r ? html`<div class="stack-sm">
        <div class="table-wrap"><table class="t"><thead><tr><th>${t('When')}</th><th>${t('Administrator')}</th><th>${t('Action')}</th><th>${t('Record')}</th><th>${t('Details')}</th></tr></thead><tbody>
          ${r.entries.map((e) => html`<tr data-key="a-${e.id}">
            <td class="small" style="white-space:nowrap"><time datetime="${e.ts}">${fmtTs(e.ts)}</time></td>
            <td>${e.actor_name ?? html`<span class="muted">${t('system')}</span>`}</td>
            <td><span class="badge navy">${nice(e.action)}</span></td>
            <td class="small">${entityLabel(e.entity)}${e.entity_id != null ? html`<span class="mono muted"> #${e.entity_id}</span>` : ''}</td>
            <td class="small" style="overflow-wrap:anywhere;min-width:160px">${e.detail ?? html`<span class="muted">—</span>`}</td>
          </tr>`)}
        </tbody></table></div>
        <div class="row between">
          <span class="small muted" role="status">${t('Showing {a}–{b} of {c}', { a: r.offset + 1, b: r.offset + r.entries.length, c: r.total })}</span>
          <div class="row">
            <button class="btn sm secondary" ${offset === 0 || view.state.list.loading ? 'disabled' : ''} data-click="newer">${t('← Newer')}</button>
            <button class="btn sm secondary" ${offset + PAGE >= r.total || view.state.list.loading ? 'disabled' : ''} data-click="older">${t('Older →')}</button>
          </div>
        </div>
      </div>` : ''), { empty: (r) => !r || r.total === 0 || r.entries.length === 0 }) : ''}
      ${d && total === 0 && !bad ? empty(dirty ? t('No entries match these filters') : t('No activity recorded yet'), html`<p>${dirty ? t('Try widening the dates or clearing a filter.') : t('Changes made in the administrator area appear here.')}</p>`) : ''}
      ${d && total > 0 && d.entries.length === 0 ? empty(t('No more entries'), html`<button class="btn sm secondary" data-click="newest">${t('Back to the newest')}</button>`) : ''}`;
    },
    actions: {
      refresh: () => list.reload(),
      'f-q': () => { view.state.q = view.state.f.q.trim(); view.state.offset = 0; refetch(300); },
      filter: () => { view.state.offset = 0; refetch(); },
      clear: () => { view.set({ f: { ...EMPTY }, q: '', offset: 0 }); refetch(); },
      newer: () => { view.state.offset = Math.max(0, view.state.offset - PAGE); refetch(); },
      older: () => { view.state.offset += PAGE; refetch(); },
      newest: () => { view.state.offset = 0; refetch(); },
    },
  };
}

import { html, raw, bool } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { t, tn, getLang } from '../../core/i18n.js';
import { asyncBlock, pageHead, empty, field, toast, confirmDialog } from '../../core/ui.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function spark(values) {
  const w = 8, h = 28;
  return raw(`<svg width="${values.length * (w + 2)}" height="${h}" aria-hidden="true" focusable="false">${values.map((v, i) => { const bh = Math.max(2, (Math.min(100, v) / 100) * h); return `<rect x="${i * (w + 2)}" y="${h - bh}" width="${w}" height="${bh}" rx="2" fill="currentColor" opacity=".75"/>`; }).join('')}</svg>`);
}

export default function optimise(view, ctx) {
  ctx.setTitle('Capacity suggestions');
  Object.assign(view.state, { route: '', weeks: 8, open: null });
  view.load('routes', () => api.get('/api/admin/routes'));
  const list = view.load('list', () => api.get(`/api/admin/optimise?weeks=${view.state.weeks}${view.state.route ? `&route=${view.state.route}` : ''}&wording=ai&lang=${getLang()}`));

  return {
    render: () => {
      const { route, weeks, open } = view.state;
      return html`${pageHead(t('Capacity suggestions'), t('Where a departure is often full or almost empty, based on past trips. These are suggestions with their evidence: you decide, and nothing changes by itself.'))}
      <div class="alert info small" role="note"><div>${t('Based on seat reservations only; walk-on riders are not counted.')}</div></div>
      <div class="row">
        ${field({ label: t('Route'), id: 'op-route' }, html`<select id="op-route" class="input" data-bind="route" data-change="reload"><option value="">${t('All routes')}</option>${(view.state.routes.data?.routes ?? []).map((r) => html`<option value="${r.id}" ${String(route) === String(r.id) ? 'selected' : ''}>${r.code} · ${r.name}</option>`)}</select>`)}
        ${field({ label: t('Weeks of history'), id: 'op-weeks' }, html`<select id="op-weeks" class="input" data-bind="weeks" data-change="reload">${[4, 6, 8].map((w) => html`<option value="${w}" ${Number(weeks) === w ? 'selected' : ''}>${w}</option>`)}</select>`)}
      </div>
      ${asyncBlock(view.state.list, 'list', (d) => (d.reason === 'not_enough_history'
        ? empty(t('Not enough history yet'), html`<p>${tn(d.weeks_missing, '{n} more week of trips is needed (4 weeks in total).', '{n} more weeks of trips are needed (4 weeks in total).')}</p>`)
        : d.suggestions.length === 0 ? empty(t('No suggestions'), html`<p>${t('No departure is consistently full or empty. Nothing needs changing.')}</p>`)
          : html`<div class="table-wrap"><table class="t"><thead><tr><th>${t('Suggestion')}</th><th>${t('Departure')}</th><th>${t('Evidence')}</th><th>${t('Weekly impact')}</th><th></th></tr></thead><tbody>
            ${d.suggestions.map((s) => html`<tr data-key="s-${s.key}">
                <td><span class="badge ${s.type === 'add' ? 'warn' : 'sky'}">${s.type === 'add' ? t('Add a departure') : t('Consider merging or removing')}</span></td>
                <td><b>${s.route}</b><div class="small">${t(DAYS[s.weekday])} · ${s.time}</div></td>
                <td>${s.ai_sentence ? html`<div><span class="badge navy" style="margin-inline-end:8px">${t('AI-written')}</span>${s.ai_sentence}</div>` : ''}<div class="${s.ai_sentence ? 'small muted' : ''}">${t('{route} on {day}s at {time} averaged {p}% booked over {n} weeks.', { route: s.route, day: t(DAYS[s.weekday]), time: s.time, p: s.avg_occupancy_pct, n: s.weeks })}</div>
                  <div class="row" style="gap:8px">${spark(s.spark)}<button class="btn sm ghost" aria-expanded="${bool(open === s.key)}" data-click="evidence" data-k="${s.key}">${t('Evidence')}</button></div></td>
                <td class="mono">${s.impact_seats_per_week > 0 ? '+' : ''}${s.impact_seats_per_week} ${t('seats / week')}</td>
                <td class="actions">${s.type === 'add' ? html`<button class="btn sm" data-click="apply" data-k="${s.key}">${t('Apply as draft')}</button>` : html`<span class="small muted">${t('Review it in Schedules & trips')}</span>`}</td>
              </tr>
              ${open === s.key ? html`<tr data-key="e-${s.key}"><td colspan="5">
                <table class="t"><thead><tr><th>${t('Date')}</th><th>${t('Booked')}</th><th>${t('Seats')}</th><th>%</th></tr></thead><tbody>
                  ${s.evidence.map((e) => html`<tr data-key="ev-${e.date}"><td>${e.date}</td><td>${e.booked}</td><td>${e.capacity}</td><td>${e.pct}%</td></tr>`)}
                </tbody></table>
                <p class="small muted">${t('Cancelled {a}% · delayed {b}% of these trips.', { a: s.cancel_rate_pct, b: s.delay_rate_pct })}</p>
              </td></tr>` : ''}`)}
          </tbody></table></div>`))}`;
    },
    actions: {
      reload: () => list.reload(),
      evidence: (el) => view.set({ open: view.state.open === el.dataset.k ? null : el.dataset.k }),
      apply: (el) => confirmDialog({ title: 'Create a draft departure', confirmLabel: 'Create draft', body: t('This creates an inactive schedule with no bus. It does nothing until you assign a bus and activate it in Schedules & trips.'),
        onConfirm: async () => { await api.post('/api/admin/optimise/apply', { suggestion_key: el.dataset.k, weeks: view.state.weeks }); toast(t('Draft schedule created')); } }),
    },
  };
}

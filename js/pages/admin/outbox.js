import { html } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { fmtDateTime } from '../../core/format.js';
import { asyncBlock, pageHead, empty } from '../../core/ui.js';

const ST = { queued: ['Queued', ''], sent: ['Sent', 'live'], failed: ['Failed', 'crit'], skipped: ['Recorded only', 'warn'] };

export default function outbox(view, ctx) {
  ctx.setTitle('Email outbox');
  view.state.page = 1;
  const list = view.load('list', () => api.get(`/api/admin/outbox?page=${view.state.page}&limit=25`), { ms: 15000 });
  const go = (p) => { view.state.page = p; list.reload(); };
  return {
    render: () => {
      const { page } = view.state;
      return html`${pageHead(t('Email outbox'), t('Emails the system sent or recorded for students.'))}
      ${view.state.list.data?.provider === 'outbox' ? html`<div class="alert warn" role="status">${t('EMAIL OUTBOX — no SMTP configured, nothing is actually sent')}</div>` : ''}
      ${asyncBlock(view.state.list, 'list', (d) => html`<div class="stack">
        <div class="table-wrap"><table class="t"><thead><tr><th>${t('To')}</th><th>${t('Subject')}</th><th>${t('Status')}</th><th>${t('When')}</th></tr></thead><tbody>
          ${d.emails.map((m) => html`<tr data-key="m-${m.id}"><td>${m.to_email}</td><td>${m.subject}</td>
            <td><span class="badge ${ST[m.status][1]}">${t(ST[m.status][0])}</span>${m.error ? html`<div class="small muted">${m.error}</div>` : ''}</td>
            <td>${fmtDateTime(m.created_at)}</td></tr>`)}
        </tbody></table></div>
        <div class="row between">
          <button class="btn secondary sm" ${page <= 1 ? 'disabled' : ''} data-click="prev">${t('Previous')}</button>
          <span class="small muted">${t('Page {n}', { n: page })} · ${d.total}</span>
          <button class="btn secondary sm" ${page * d.limit >= d.total ? 'disabled' : ''} data-click="next">${t('Next')}</button>
        </div>
      </div>`, { empty: (d) => d.emails.length === 0 })}
      ${view.state.list.data?.emails.length === 0 ? empty(t('Nothing here'), html`<p>${t('No emails have been sent or recorded yet.')}</p>`) : ''}`;
    },
    actions: { prev: () => go(view.state.page - 1), next: () => go(view.state.page + 1) },
  };
}

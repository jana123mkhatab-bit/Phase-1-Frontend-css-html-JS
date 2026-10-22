import { html } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { fmtDateTime } from '../../core/format.js';
import { asyncBlock, pageHead, empty, toast } from '../../core/ui.js';

const KIND = { eta: 'Arrival', departure: 'Departure', update: 'Service update', reservation: 'Reservation', report: 'Your report' };

export default function notifications(view, ctx) {
  ctx.setTitle('Notifications');
  const n = view.load('n', () => api.get('/api/student/notifications'), { ms: 8000 });
  const read = async (ids) => {
    try { await api.post('/api/student/notifications/read', ids ? { ids } : {}); n.refresh(); } catch (e) { toast(e.message, 'error'); }
  };
  return {
    render: () => {
      const d = view.state.n.data;
      return html`${pageHead(t('Notifications'), t('Arrival alerts, departure notices and service changes for your route. Choose what you receive in My settings.'),
        d?.unread > 0 ? html`<button class="btn secondary" data-click="read-all">${t('Mark all as read')}</button>` : '')}
        ${asyncBlock(view.state.n, 'n', (data) => html`<div class="card" style="padding:0" role="list">
          ${data.notifications.map((x) => html`<div role="listitem" class="notif ${x.read ? '' : 'unread'}" data-key="n-${x.id}">
            <span class="u" aria-hidden="true"></span>
            <div><b>${x.title}</b>${!x.read ? html`<span class="sr-only"> ${t('(unread)')}</span>` : ''}<div>${x.body}</div><div class="small muted">${KIND[x.kind] ? t(KIND[x.kind]) : x.kind} · ${fmtDateTime(x.created_at)}</div></div>
            ${!x.read ? html`<button type="button" class="btn sm ghost" aria-label="${t('Mark “{title}” as read', { title: x.title })}" data-click="read-one" data-id="${x.id}">${t('Mark read')}</button>` : ''}
          </div>`)}
        </div>`, { empty: (data) => data.notifications.length === 0 })}
        ${d?.notifications.length === 0 ? empty(t('You’re all caught up'), t('Alerts will appear here when your bus is close, leaves, or the service changes.')) : ''}`;
    },
    actions: {
      'read-all': () => read(),
      'read-one': (el) => read([Number(el.dataset.id)]),
    },
  };
}

import { html, bool } from '../core/dom.js';
import { mountView } from '../core/view.js';
import { api } from '../core/api.js';
import { t, getLang } from '../core/i18n.js';
import { syncWidgets } from '../core/widgets.js';
import { navigate } from '../core/router.js';
import mic from './mic.js';

const SUGGESTIONS = ['When is my next bus?', 'Are there any delays?', 'Are seats available?', 'Can I go to the bank and be back for my 1 pm class?'];
export const CHAT_KEY = 'chat-history';
const MAX_KEPT = 20;
const load = () => { try { const v = JSON.parse(sessionStorage.getItem(CHAT_KEY) ?? '[]'); return Array.isArray(v) ? v.slice(-MAX_KEPT) : []; } catch { return []; } };
const store = (m) => { try { sessionStorage.setItem(CHAT_KEY, JSON.stringify(m.slice(-MAX_KEPT))); } catch { /* ignore */ } };

/** Floating transit assistant (rule-based in this prototype; the UI says so wherever it matters). */
export function mountChat(host) {
  return mountView(host, (view) => {
    Object.assign(view.state, { open: false, msgs: load(), text: '', busy: false });
    let lastSig = '';
    view.listen(document, 'keydown', (e) => { if (e.key === 'Escape' && view.state.open) view.set({ open: false }); });

    async function send(raw) {
      const content = raw.trim();
      if (!content || view.state.busy) return;
      const next = [...view.state.msgs, { role: 'user', content }];
      view.set({ msgs: next, text: '', busy: true }); store(next);
      let reply;
      try {
        const { reply: r, actions } = await api.post('/api/student/chat', { messages: next.map(({ role, content: c }) => ({ role, content: c })), lang: getLang() });
        reply = [...next, { role: 'assistant', content: r, actions: actions ?? [] }];
      } catch (e) {
        reply = [...next, { role: 'assistant', content: e.message, error: true }];
      }
      view.set({ msgs: reply, busy: false }); store(reply);
    }

    return {
      render: () => {
        const { open, msgs, text, busy } = view.state;
        return html`<div class="chat">
          ${open ? html`<section class="chat-panel" role="dialog" aria-label="${t('Transit assistant')}">
            <header class="chat-head">
              <b>${t('Transit assistant')}</b>
              <span class="row" style="gap:6px">
                ${msgs.length > 0 ? html`<button type="button" class="btn sm secondary" data-click="new-chat">${t('New chat')}</button>` : ''}
                <button type="button" class="chat-x" data-click="close" aria-label="${t('Close')}">×</button>
              </span>
            </header>
            <div class="chat-log" aria-live="polite">
              ${msgs.length === 0 ? html`<div class="chat-hello">
                <p>${t('Hi! Ask me about your bus, delays, seats or routes.')}</p>
                <div class="chat-sugg">${SUGGESTIONS.map((s, i) => html`<button type="button" class="btn sm secondary" data-click="suggest" data-i="${i}">${t(s)}</button>`)}</div>
              </div>` : ''}
              ${msgs.map((m, i) => html`<div class="chat-msg ${m.role}${m.error ? ' err' : ''}" data-key="m${i}">
                ${m.content}
                ${m.actions?.length > 0 ? html`<div class="chat-actions">${m.actions.map((a) => html`<button type="button" class="btn sm secondary" data-click="go" data-to="${a.to}">${a.label}</button>`)}</div>` : ''}
              </div>`)}
              ${busy ? html`<div class="chat-msg assistant muted">${t('Thinking…')}</div>` : ''}
              <div id="chat-end"></div>
            </div>
            <form class="chat-form" data-submit="send">
              <span data-widget="mic" data-key="w-mic" data-static></span>
              <input id="chat-input" data-bind="text" value="${text}" maxlength="500" placeholder="${t('Type your question…')}" aria-label="${t('Type your question…')}">
              <button class="btn primary sm" ${busy || !text.trim() ? 'disabled' : ''}>${t('Send')}</button>
            </form>
          </section>` : ''}
          <button type="button" class="chat-fab" data-click="toggle" aria-expanded="${bool(open)}" aria-label="${t('Transit assistant')}" title="${t('Transit assistant')}">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z"/></svg>
          </button>
        </div>`;
      },
      after: () => {
        const { open, msgs, busy } = view.state;
        syncWidgets(view, { mic }, { mic: { onResult: (s) => view.set({ text: (view.state.text ? `${view.state.text} ${s}` : s).slice(0, 500) }), disabled: busy } });
        const sig = `${open}|${msgs.length}|${busy}`;
        if (sig !== lastSig) { lastSig = sig; view.$('#chat-end')?.scrollIntoView({ block: 'end' }); }
      },
      actions: {
        toggle: () => view.set({ open: !view.state.open }),
        close: () => view.set({ open: false }),
        'new-chat': () => { view.set({ msgs: [] }); store([]); },
        suggest: (el) => send(t(SUGGESTIONS[Number(el.dataset.i)])),
        send: () => send(view.state.text),
        go: (el) => { view.set({ open: false }); navigate(el.dataset.to); },
      },
    };
  });
}

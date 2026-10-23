import { html } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { getUser, setUser } from '../../core/auth.js';
import { t, getLang } from '../../core/i18n.js';
import { asyncBlock, pageHead, field, toast, passwordInput } from '../../core/ui.js';
import { syncWidgets, widgetHost } from '../../core/widgets.js';
import { WIDGETS } from '../../components/widgets.js';

const TABS = [['travel', 'Travel'], ['alerts', 'Notifications'], ['account', 'Account']];

export default function settings(view, ctx) {
  ctx.setTitle('My settings');
  const user0 = getUser('student');
  view.load('cat', () => api.get('/api/student/catalog'));
  view.load('me', () => api.get('/api/student/auth/me'));
  Object.assign(view.state, {
    f: { name: user0.name, route_id: user0.route_id ?? '', stop_id: user0.stop_id ?? '', walk_minutes: user0.walk_minutes, notif_eta: user0.notif_eta, notif_departure: user0.notif_departure, notif_updates: user0.notif_updates, suggestions: user0.suggestions !== false },
    tab: 'travel', err: '', busy: false,
    em: { on: !!user0.email_reminders, lead: user0.email_lead_minutes ?? 45 }, emErr: '', emBusy: false,
    pw: { current_password: '', new_password: '', confirm_password: '' }, showPw: { cur: false, new: false, conf: false }, pwErr: '', pwBusy: false,
  });

  return {
    render: () => {
      const user = getUser('student');
      const { tab, f, err, busy, em, emErr, emBusy, pw, showPw, pwErr, pwBusy } = view.state;
      return html`${pageHead(t('My settings'), t('Your route and collection point decide whose ETA you see and when alerts are sent.'))}
      ${asyncBlock(view.state.cat, 'cat', (d) => {
        const route = d.routes.find((r) => r.id === Number(f.route_id));
        const saveRow = html`${err ? html`<div class="alert error" role="alert">${err}</div>` : ''}<div class="row"><button class="btn" ${busy ? 'disabled' : ''}>${busy ? t('Saving…') : t('Save settings')}</button></div>`;
        const sections = {
          travel: html`
            <form class="card stack" data-submit="save" novalidate>
              <div><h2 class="set-h">${t('My route')}</h2><p class="small muted set-sub">${t('Decides whose ETA you see and when alerts are sent.')}</p></div>
              <div class="form-grid">
                ${field({ label: t('My route'), id: 'r' }, html`<select id="r" class="input" data-bind="f.route_id" data-change="route-change"><option value="">${t('No route chosen')}</option>${d.routes.filter((r) => r.active).map((r) => html`<option value="${r.id}" ${String(f.route_id) === String(r.id) ? 'selected' : ''}>${r.code} · ${r.name}</option>`)}</select>`)}
                ${field({ label: t('My collection point'), id: 's' }, html`<select id="s" class="input" data-bind="f.stop_id" ${!route ? 'disabled' : ''}><option value="">${route ? t('Choose…') : t('Choose a route first')}</option>${(route?.stops ?? []).map((s) => html`<option value="${s.id}" ${String(f.stop_id) === String(s.id) ? 'selected' : ''}>${s.name}</option>`)}</select>`)}
              </div>
              ${field({ label: t('Minutes it takes me to walk to the collection point'), id: 'w', hint: t('Used to tell you when to leave.') }, html`<input id="w" type="number" min="0" max="120" class="input" data-bind="f.walk_minutes" value="${f.walk_minutes}">`)}
              ${saveRow}
            </form>
            ${widgetHost('favoritesList')}`,
          alerts: html`
            <form class="card stack" data-submit="save" novalidate>
              <div><h2 class="set-h">${t('In-app alerts')}</h2><p class="small muted set-sub">${t('Choose what we tell you about.')}</p></div>
              <fieldset style="border:0;padding:0;margin:0" class="stack-sm"><legend class="label">${t('Notify me about')}</legend>
                <label class="check"><input type="checkbox" data-bind="f.notif_eta" ${f.notif_eta ? 'checked' : ''}>${t('Arrival: “time to leave” and “5 minutes away”')}</label>
                <label class="check"><input type="checkbox" data-bind="f.notif_departure" ${f.notif_departure ? 'checked' : ''}>${t('Departure: bus preparing to leave / has left')}</label>
                <label class="check"><input type="checkbox" data-bind="f.notif_updates" ${f.notif_updates ? 'checked' : ''}>${t('Delays, route changes and cancellations')}</label>
                <label class="check"><input type="checkbox" data-bind="f.suggestions" ${f.suggestions ? 'checked' : ''}>${t('Show suggestions based on my trips')}</label>
              </fieldset>
              ${saveRow}
            </form>
            <form class="card stack" data-submit="save-email" novalidate>
              <div><h2 class="set-h">${t('Email reminders')}</h2><p class="small muted set-sub">${t('A reminder before your bus, sent to your university email.')}</p></div>
              <label class="check"><input type="checkbox" data-bind="em.on" ${em.on ? 'checked' : ''}>${t('Send me email reminders')}</label>
              <fieldset style="border:0;padding:0;margin:0" class="stack-sm"><legend class="label">${t('Send the reminder this long before')}</legend>
                <div class="seg" role="group">${[30, 45, 60, 90].map((m) => html`<button type="button" aria-pressed="${String(em.lead === m)}" data-click="lead" data-m="${m}">${t('{n} min', { n: m })}</button>`)}</div>
              </fieldset>
              ${field({ label: t('Send to'), id: 'em_to' }, html`<input id="em_to" class="input" value="${user.email}" readonly>`)}
              ${view.state.me.data?.mail?.provider === 'outbox' ? html`<div class="alert warn" role="status">${t('Email sending is not set up on this server yet, so reminders are recorded but not delivered.')}</div>` : ''}
              ${emErr ? html`<div class="alert error" role="alert">${emErr}</div>` : ''}
              <div class="row"><button class="btn" ${emBusy ? 'disabled' : ''}>${emBusy ? t('Saving…') : t('Save settings')}</button></div>
            </form>`,
          account: html`
            <form class="card stack" data-submit="save" novalidate>
              <div><h2 class="set-h">${t('Profile')}</h2><p class="small muted set-sub" dir="ltr">${user.email}</p></div>
              ${field({ label: t('Name'), id: 'n' }, html`<input id="n" class="input" data-bind="f.name" value="${f.name}">`)}
              ${saveRow}
            </form>
            <form class="card stack" data-submit="change-pw" novalidate>
              <div><h2 class="set-h">${t('Security & password')}</h2><p class="small muted set-sub">${t('At least 8 characters with letters and numbers')}</p></div>
              ${field({ label: t('Current password'), id: 'cur_pw' }, passwordInput({ id: 'cur_pw', bind: 'pw.current_password', value: pw.current_password, autocomplete: 'current-password', visible: showPw.cur, toggleAction: 'toggle-pw', key: 'cur' }))}
              <div class="form-grid">
                ${field({ label: t('New password'), id: 'new_pw' }, passwordInput({ id: 'new_pw', bind: 'pw.new_password', value: pw.new_password, autocomplete: 'new-password', visible: showPw.new, toggleAction: 'toggle-pw', key: 'new' }))}
                ${field({ label: t('Confirm new password'), id: 'conf_pw' }, passwordInput({ id: 'conf_pw', bind: 'pw.confirm_password', value: pw.confirm_password, autocomplete: 'new-password', visible: showPw.conf, toggleAction: 'toggle-pw', key: 'conf' }))}
              </div>
              ${pwErr ? html`<div class="alert error" role="alert">${pwErr}</div>` : ''}
              <div class="row"><button class="btn secondary" ${pwBusy ? 'disabled' : ''}>${pwBusy ? t('Updating…') : t('Change password')}</button></div>
            </form>`,
        };
        return html`<div class="stack">
          <div class="seg set-tabs" role="tablist" aria-label="${t('Settings sections')}">
            ${TABS.map(([k, l]) => html`<button type="button" role="tab" aria-selected="${String(tab === k)}" aria-pressed="${String(tab === k)}" data-click="tab" data-k="${k}">${t(l)}</button>`)}
          </div>
          <div class="set-grid">${sections[tab]}</div>
        </div>`;
      })}`;
    },
    after: () => syncWidgets(view, WIDGETS),
    actions: {
      tab: (el) => view.set({ tab: el.dataset.k, err: '', emErr: '', pwErr: '' }),
      'toggle-pw': (el) => {
        const k = el.dataset.pwKey;
        if (k && view.state.showPw) {
          view.set({ showPw: { ...view.state.showPw, [k]: !view.state.showPw[k] } });
        }
      },
      'route-change': () => { view.state.f.stop_id = ''; view.update(); },
      lead: (el) => { view.state.em.lead = Number(el.dataset.m); view.update(); },
      save: async () => {
        const { f } = view.state;
        view.set({ err: '', busy: true });
        try {
          const d = await api.put('/api/student/profile', { name: f.name, route_id: f.route_id ? Number(f.route_id) : null, stop_id: f.stop_id ? Number(f.stop_id) : null, walk_minutes: Number(f.walk_minutes), notif_eta: f.notif_eta, notif_departure: f.notif_departure, notif_updates: f.notif_updates, suggestions: f.suggestions, lang: getLang() });
          setUser('student', d.user); toast(t('Settings saved'));
        } catch (e) { view.state.err = e.message; } finally { view.set({ busy: false }); }
      },
      'save-email': async () => {
        const { em } = view.state;
        view.set({ emErr: '', emBusy: true });
        try {
          const d = await api.put('/api/student/profile', { email_reminders: em.on, email_lead_minutes: em.lead });
          setUser('student', d.user); toast(t('Settings saved'));
        } catch (e) { view.state.emErr = e.message; } finally { view.set({ emBusy: false }); }
      },
      'change-pw': async () => {
        const { pw } = view.state;
        view.state.pwErr = '';
        const fail = (m) => view.set({ pwErr: m });
        if (!pw.current_password) return fail(t('Please enter your current password'));
        if (!pw.new_password) return fail(t('Please enter a new password'));
        if (pw.new_password.length < 8) return fail(t('New password must be at least 8 characters'));
        if (pw.new_password !== pw.confirm_password) return fail(t('New passwords do not match'));
        view.set({ pwBusy: true });
        try {
          await api.post('/api/student/auth/change-password', { current_password: pw.current_password, new_password: pw.new_password });
          toast(t('Password updated successfully'));
          view.set({ pw: { current_password: '', new_password: '', confirm_password: '' } });
        } catch (e) { view.state.pwErr = e.message; } finally { view.set({ pwBusy: false }); }
      },
    },
  };
}

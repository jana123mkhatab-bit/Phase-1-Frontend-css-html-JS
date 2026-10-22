// Self-loading widgets used inside pages (see core/widgets.js for how they are mounted).
import { html } from '../core/dom.js';
import { api } from '../core/api.js';
import { t, td, getLang } from '../core/i18n.js';
import { fmtTime } from '../core/format.js';
import { icon } from '../core/icons.js';
import { getUser, setUser } from '../core/auth.js';
import { navigate } from '../core/router.js';
import { asyncBlock, etaView, tripStatusBadge, confirmDialog, toast, field, loading, aiSentence } from '../core/ui.js';

/** How booked this departure usually is (from seat reservations of past trips), next to the real current numbers. */
const LEVEL = { low: ['Usually quiet', ''], medium: ['Usually busy', 'sky'], high: ['Usually very busy', 'warn'] };
export function crowdBadge(crowd, seats, { showEmpty = false, tripId = null } = {}) {
  if (!crowd) return showEmpty ? html`<span class="small muted">${t('Not enough history yet')}</span>` : '';
  const [label, c] = LEVEL[crowd.level];
  const info = JSON.stringify({ tripId, samples: crowd.samples, pct: crowd.typical_pct });
  return html`<span class="row crowd" style="gap:8px">
    <span class="badge ${c}">${icon('users', 14)} ${t(label)}</span>
    ${seats ? html`<span class="small">${t('Booked: {r} / {c}', { r: seats.reserved, c: seats.capacity })}</span>` : ''}
    <button type="button" class="btn sm ghost" data-crowd-why="${info}" aria-haspopup="dialog">${t('How is this worked out?')}</button>
  </span>`;
}

// ------------------------------------------------------------------ favourites strip (dashboard)
const ACTIVE = ['departed', 'preparing', 'scheduled'];
const ORDER = { departed: 0, preparing: 1, scheduled: 2 };
/** The next trip on the favourite's route that has not passed the favourite's stop yet. */
function nextTrip(trips, fav) {
  return trips
    .filter((tr) => tr.route.id === fav.route_id && ACTIVE.includes(tr.status))
    .map((tr) => ({ tr, stop: tr.stops.find((s) => s.id === fav.stop_id) }))
    .filter((x) => x.stop && x.stop.eta.kind !== 'passed')
    .sort((a, b) => ORDER[a.tr.status] - ORDER[b.tr.status] || new Date(a.tr.expected_departure) - new Date(b.tr.expected_departure))[0] ?? null;
}
export function favoritesStrip(view) {
  view.load('favs', () => api.get('/api/student/favorites'));
  Object.assign(view.state, { off: {}, serverId: {} });
  return {
    actions: {
      'toggle-fav': async (el) => {
        const f = (view.state.favs.data?.favorites ?? []).find((x) => x.id === Number(el.dataset.id));
        if (!f) return;
        const off = { ...view.state.off };
        const sid = view.state.serverId[f.id] ?? f.id;
        try {
          if (!off[f.id]) {
            off[f.id] = true; view.set({ off });
            await api.del(`/api/student/favorites/${sid}`); toast(t('Removed from favourites'));
          } else {
            delete off[f.id]; view.set({ off });
            const d = await api.post('/api/student/favorites', { route_id: f.route_id, stop_id: f.stop_id });
            view.state.serverId[f.id] = d.favorite.id; toast(t('Added to favourites'));
          }
        } catch (e) {
          const back = { ...view.state.off };
          if (off[f.id]) delete back[f.id]; else back[f.id] = true;
          view.set({ off: back }); toast(e.message, 'error');
        }
      },
    },
    render: () => {
      const st = view.state.favs;
      if ((st.loading && !st.data) || (st.error && !st.data)) return '';
      const list = st.data?.favorites ?? [];
      const trips = view.state.props.trips ?? [];
      return html`<section class="stack-sm" aria-label="${t('My favourites')}">
        <h2>${t('My favourites')}</h2>
        ${list.length === 0 ? html`<div class="card flat"><p class="small muted">${t('No favourites yet. Open Routes & stops and tap the star next to a collection point to add one.')} <a href="#/student/routes">${t('Routes & stops')}</a></p></div>` : html`
          <div class="grid g3">${list.map((f) => {
            const n = nextTrip(trips, f);
            return html`<article class="card fav-card" data-key="fav-${f.id}">
              <div class="row between"><b class="row" style="gap:6px"><button type="button" class="btn sm ghost star-btn" style="width:28px;min-height:0;padding:0" aria-pressed="${String(!view.state.off[f.id])}" aria-label="${view.state.off[f.id] ? t('Add {stop} to favourites', { stop: f.stop_name }) : t('Remove {stop} from favourites', { stop: f.stop_name })}" data-click="toggle-fav" data-id="${f.id}">${icon('star', 16)}</button>${f.label || f.stop_name}</b><span class="badge navy">${f.route_code}</span></div>
              <div class="small muted">${f.label ? `${f.stop_name} · ` : ''}${f.route_name}</div>
              ${n ? html`<div class="row" style="margin-top:8px"><span class="bus-chip">${n.tr.bus.number}</span>${tripStatusBadge(n.tr)}</div>${etaView(n.stop.eta, { big: false, tripId: n.tr.id, stopId: f.stop_id })}`
                : html`<p class="small muted" style="margin-top:8px">${t('No bus is operating or due soon on this route.')}</p>`}
            </article>`;
          })}</div>`}
      </section>`;
    },
  };
}

// ------------------------------------------------------------------ favourites list (settings)
export function favoritesList(view) {
  view.load('favs', () => api.get('/api/student/favorites'));
  Object.assign(view.state, { edit: null, err: '' });
  return {
    render: () => {
      const { edit, err } = view.state;
      return html`<div class="card stack">
        <h2 style="font-size:1.15rem">${t('My favourites')}</h2>
        ${asyncBlock(view.state.favs, 'favs', (d) => (d.favorites.length === 0
          ? html`<p class="small muted">${t('No favourites yet. Open Routes & stops and tap the star next to a collection point to add one.')}</p>`
          : html`<ul class="stack-sm" style="list-style:none;margin:0;padding:0">${d.favorites.map((f) => html`<li class="row between" data-key="fl-${f.id}">
              ${edit?.id === f.id ? html`<form class="row" data-submit="save" style="flex:1">
                  ${field({ label: t('Name'), id: `fl-${f.id}` }, html`<input id="fl-${f.id}" class="input" maxlength="40" data-bind="edit.label" value="${edit.label}">`)}
                  <button class="btn sm">${t('Save')}</button>
                  <button type="button" class="btn sm secondary" data-click="cancel">${t('Cancel')}</button>
                </form>` : html`
                <div><b>${f.label || f.stop_name}</b><div class="small muted">${f.label ? `${f.stop_name} · ` : ''}${f.route_code} · ${f.route_name}</div></div>
                <div class="row">
                  <button class="btn sm secondary" data-click="rename" data-id="${f.id}" data-label="${f.label ?? ''}">${t('Rename')}</button>
                  <button class="btn sm danger" data-click="remove" data-id="${f.id}" data-name="${f.label || f.stop_name}">${t('Remove')}</button>
                </div>`}
            </li>`)}</ul>`))}
        ${err ? html`<div class="alert error" role="alert">${err}</div>` : ''}
      </div>`;
    },
    actions: {
      rename: (el) => view.set({ err: '', edit: { id: Number(el.dataset.id), label: el.dataset.label } }),
      cancel: () => view.set({ edit: null }),
      save: async () => {
        view.set({ err: '' });
        try {
          await api.patch(`/api/student/favorites/${view.state.edit.id}`, { label: view.state.edit.label });
          view.set({ edit: null }); toast(t('Favourite updated')); view.loaders.favs.refresh();
        } catch (e) { view.set({ err: e.message }); }
      },
      remove: (el) => confirmDialog({
        title: 'Remove favourite', danger: true, confirmLabel: 'Remove',
        body: t('Remove {name} from your favourites?', { name: el.dataset.name }),
        onConfirm: async () => { await api.del(`/api/student/favorites/${el.dataset.id}`); toast(t('Removed from favourites')); view.loaders.favs.refresh(); },
      }),
    },
  };
}

// ------------------------------------------------------------------ "For you" suggestion card (dashboard)
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function scrollTrack(view, dir) {
  const track = view.$('.sg-track');
  if (!track) return;
  const rtl = getComputedStyle(track).direction === 'rtl';
  track.scrollBy({ left: dir * (rtl ? -1 : 1) * track.clientWidth, behavior: 'smooth' });
}
export function suggestionCard(view) {
  view.load('sug', () => api.get('/api/student/suggestions'), { ms: 30000 });
  Object.assign(view.state, { open: {}, ai: {} });
  return {
    render: () => {
      const d = view.state.sug.data;
      const items = d?.items ?? [];
      if (!d || !d.enabled || items.length === 0) return '';
      return html`<section class="card tint stack-sm" aria-label="${t('For you')}">
        <div class="row between">
          <h2>${t('For you')}</h2>
          ${items.length > 1 ? html`<div class="sg-nav row" style="gap:6px">
            <button type="button" class="sg-arrow" data-click="prev" aria-label="${t('Previous')}">&#8249;</button>
            <button type="button" class="sg-arrow" data-click="next" aria-label="${t('Next')}">&#8250;</button>
          </div>` : ''}
        </div>
        <div class="sg-track">
        ${items.map((s) => {
          const tr = s.trip;
          const isOpen = !!view.state.open[s.key];
          return html`<article class="sg" data-key="sg-${s.key}">
            <div class="row between">
              <div>
                <b>${t('Your usual {time} bus (Bus {n}) leaves in {m} min', { time: fmtTime(tr.scheduled_departure), n: tr.bus.number, m: tr.minutes_until })}</b>
                ${tr.delay_minutes > 0 ? html`<span class="badge warn" style="margin-inline-start:8px">${t('+{n} min delay', { n: tr.delay_minutes })}</span>` : ''}
                <div class="row" style="gap:8px">${tripStatusBadge(tr)}<span class="small muted">${tr.route.code} · ${tr.route.name}</span></div>
              </div>
              ${s.can_reserve ? html`<a class="btn" href="#/student/reserve?trip=${tr.id}">${t('Reserve a seat')}</a>` : ''}
            </div>
            ${tr.eta ? etaView(tr.eta, { big: false }) : ''}
            <details ${isOpen ? 'open' : ''}>
              <summary data-click="why" data-k="${s.key}">${t('Why am I seeing this?')}</summary>
              ${aiSentence(view.state.ai[s.key])}
              <p class="small">${t('You took this bus {a} of the last {b} {day}s.', { a: s.reason_parts.count, b: s.reason_parts.of, day: t(DAYS[s.reason_parts.weekday]) })} ${t('Only your own trips are used.')}</p>
            </details>
            <div><button class="btn sm ghost" data-click="suppress" data-k="${s.key}">${t("Don't suggest this")}</button></div>
          </article>`;
        })}
        </div>
      </section>`;
    },
    actions: {
      prev: () => scrollTrack(view, -1),
      next: () => scrollTrack(view, 1),
      why: (el, ev) => {
        ev.preventDefault();
        const k = el.dataset.k;
        const now = !view.state.open[k];
        view.state.open[k] = now;
        if (now && !view.state.ai[k]) {
          view.state.ai[k] = { loading: true, data: null };
          api.post('/api/student/suggestions/explain', { key: k, lang: getLang() })
            .then((r) => { view.state.ai[k] = { loading: false, data: r?.ai ? r.sentence : null }; view.update(); })
            .catch(() => { view.state.ai[k] = { loading: false, data: null }; view.update(); });
        }
        view.update();
      },
      suppress: (el) => confirmDialog({
        title: 'Stop suggesting this', confirmLabel: 'Stop suggesting', body: t('We will stop suggesting this bus.'),
        onConfirm: async () => { await api.post('/api/student/suggestions/suppress', { pattern_key: el.dataset.k }); toast(t('Got it. We will not suggest this again.')); view.loaders.sug.reload(); },
      }),
    },
  };
}

// ------------------------------------------------------------------ email reminders (timetable page)
const RDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_LABEL = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };
export function remindersCard(view) {
  const u0 = getUser('student');
  view.load('me', () => api.get('/api/student/auth/me'));
  view.load('preview', () => api.post('/api/student/reminders/preview', {}));
  Object.assign(view.state, { f: { on: !!u0.email_reminders, lead: u0.email_lead_minutes ?? 45, days: u0.email_days ?? ['sun', 'mon', 'tue', 'wed', 'thu'] }, busy: false, err: '', testing: false });
  return {
    render: () => {
      const { f, busy, err, testing } = view.state;
      const outbox = view.state.me.data?.mail?.provider === 'outbox';
      const pv = view.state.preview;
      const p = pv.data;
      return html`<section class="card stack" aria-label="${t('Reminders')}">
        <h2 style="font-size:1.15rem">${t('Reminders')}</h2>
        <label class="check"><input type="checkbox" data-bind="f.on" ${f.on ? 'checked' : ''}>${t('Email me before each class, with the bus to take')}</label>
        <fieldset style="border:0;padding:0;margin:0" class="stack-sm"><legend class="label">${t('How long before class')}</legend>
          <div class="seg" role="group">${[30, 45, 60, 90].map((m) => html`<button type="button" aria-pressed="${String(f.lead === m)}" data-click="lead" data-m="${m}">${t('{n} min', { n: m })}</button>`)}</div>
        </fieldset>
        <fieldset style="border:0;padding:0;margin:0" class="stack-sm"><legend class="label">${t('On these days')}</legend>
          <div class="row">${RDAYS.map((d) => html`<label class="check"><input type="checkbox" data-change="day" data-d="${d}" ${f.days.includes(d) ? 'checked' : ''}>${t(DAY_LABEL[d])}</label>`)}</div>
        </fieldset>
        ${outbox ? html`<div class="alert warn" role="status">${t('Email sending is not set up on this server yet, so reminders are recorded but not delivered.')}</div>` : ''}
        ${err ? html`<div class="alert error" role="alert">${err}</div>` : ''}
        <div class="row">
          <button class="btn" data-click="save" ${busy ? 'disabled' : ''}>${busy ? t('Saving…') : t('Save reminders')}</button>
          <button class="btn secondary" data-click="test" ${testing ? 'disabled' : ''}>${t('Send me a test email')}</button>
        </div>
        ${outbox ? html`<p class="small muted">${t('Not delivered: email is not configured; it will appear in the outbox.')}</p>` : ''}
        <div class="card flat stack-sm" aria-live="polite">
          <h3>${t('Preview of your next reminder')}</h3>
          ${pv.loading && !p ? loading() : pv.error ? html`<div class="alert error" role="alert">${pv.error.message}</div>`
            : p?.empty === 'no_timetable' ? html`<p class="small muted">${t('Add your timetable first.')}</p>`
              : p?.empty === 'no_more_classes' ? html`<p class="small muted">${t('You have no more classes today.')}</p>`
                : p ? html`<b>${p.subject}</b><p style="white-space:pre-line">${p.text}</p>${p.ai ? html`<p><span class="badge navy">${t('AI-written')}</span> ${t('The first line is written by AI. Times and the bus come from live data.')}</p>` : ''}<p class="small muted">${t('This is only a preview. Bus times are estimates and can change.')}</p>` : ''}
        </div>
      </section>`;
    },
    actions: {
      lead: (el) => { view.state.f.lead = Number(el.dataset.m); view.update(); },
      day: (el) => { const f = view.state.f; const d = el.dataset.d; f.days = f.days.includes(d) ? f.days.filter((y) => y !== d) : [...f.days, d]; view.update(); },
      save: async () => {
        view.set({ busy: true, err: '' });
        const { f } = view.state;
        try {
          const d = await api.put('/api/student/profile', { email_reminders: f.on, email_lead_minutes: f.lead, email_days: f.days, lang: getLang() });
          setUser('student', d.user); toast(t('Reminder settings saved')); view.loaders.preview.reload();
        } catch (e) { view.state.err = e.message; } finally { view.set({ busy: false }); }
      },
      test: async () => {
        view.set({ testing: true });
        try { await api.post('/api/student/reminders/test', {}); toast(t('Test email sent')); } catch (e) { toast(e.message, 'error'); } finally { view.set({ testing: false }); }
      },
    },
  };
}

// ------------------------------------------------------------------ admin: "Needs attention"
const SEV = { critical: ['Critical', 'crit'], warning: ['Warning', 'warn'], info: ['Info', ''] };
const minsAgo = (iso) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
export function anomalyPanel(view) {
  view.load('list', () => api.get('/api/admin/anomalies'), { ms: 4000 });
  return {
    render: () => {
      const st = view.state.list;
      if (st.error && !st.data) return '';
      const items = st.data?.anomalies ?? [];
      return html`<section class="card stack-sm" aria-label="${t('Needs attention')}" aria-live="polite">
        <div class="card-head"><h2>${t('Needs attention')}</h2><span class="small muted">${t('Suggestions from the system. You decide what students are told.')}</span></div>
        ${items.length === 0 ? html`<p class="small muted">${t('Nothing unusual detected right now.')}</p>` : html`
          <ul class="stack-sm" style="list-style:none;margin:0;padding:0">${items.map((a) => html`<li class="row between" style="border-top:1px solid var(--border);padding-top:8px" data-key="an-${a.id}">
            <div>
              <div class="row" style="gap:8px">
                <span class="badge ${SEV[a.severity][1]}">${t(SEV[a.severity][0])}</span>
                ${a.bus_number ? html`<span class="bus-chip">${a.bus_number}</span>` : ''}
                ${a.route_code ? html`<span class="badge">${a.route_code}</span>` : ''}
              </div>
              <div>${td(a.evidence)}</div>
              <div class="small muted">${t('Detected {n} min ago', { n: minsAgo(a.detected_at) })} · ${fmtTime(a.detected_at)}</div>
            </div>
            <div class="row">
              <button class="btn sm secondary" data-click="dismiss" data-id="${a.id}">${t('Dismiss')}</button>
              <button class="btn sm" data-click="draft" data-id="${a.id}">${t('Draft service update')}</button>
            </div>
          </li>`)}</ul>`}
      </section>`;
    },
    actions: {
      dismiss: async (el) => {
        try { await api.patch(`/api/admin/anomalies/${el.dataset.id}`, { action: 'dismiss' }); toast(t('Dismissed')); view.loaders.list.refresh(); } catch (e) { toast(e.message, 'error'); }
      },
      draft: async (el) => {
        try { const r = await api.patch(`/api/admin/anomalies/${el.dataset.id}`, { action: 'publish' }); navigate('/admin/updates', { state: { draft: r.draft } }); } catch (e) { toast(e.message, 'error'); }
      },
    },
  };
}

// ------------------------------------------------------------------ admin: ETA accuracy table
export function etaAccuracy(view) {
  view.load('acc', () => api.get('/api/admin/eta-accuracy'));
  return {
    render: () => html`<section class="stack-sm">
      <h2>${t('ETA accuracy')}</h2>
      ${asyncBlock(view.state.acc, 'acc', (d) => (d.routes.length === 0
        ? html`<div class="empty">${t('Not enough completed trips yet')}</div>`
        : html`<div class="table-wrap"><table class="t"><thead><tr><th>${t('Route')}</th><th>${t('Samples')}</th><th>${t('GPS-only error (min)')}</th><th>${t('Predicted error (min)')}</th><th>${t('Improvement')}</th></tr></thead><tbody>
          ${d.routes.map((r) => html`<tr><td><b>${r.code}</b> ${r.name}</td><td>${r.samples}</td><td>${r.gps_only_error_min ?? '—'}</td><td>${r.predicted_error_min ?? '—'}</td><td>${r.improvement_pct == null ? '—' : `${r.improvement_pct}%`}</td></tr>`)}
        </tbody></table></div>`))}
      <p class="small muted">${t('Only samples that have both a GPS-only and a predicted ETA are compared. Simulated history is labelled where it is used.')}</p>
    </section>`,
  };
}

export const WIDGETS = { favoritesStrip, favoritesList, suggestionCard, remindersCard, anomalyPanel, etaAccuracy };

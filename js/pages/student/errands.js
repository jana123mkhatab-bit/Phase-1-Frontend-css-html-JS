import { html, bool } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { t, td, getLang } from '../../core/i18n.js';
import { fmtTime } from '../../core/format.js';
import { icon } from '../../core/icons.js';
import { asyncBlock, pageHead, field, loading, empty, toast, confirmDialog, openModal, aiEnabled, aiSentence } from '../../core/ui.js';
import { syncWidgets, widgetHost } from '../../core/widgets.js';
import { WIDGETS } from '../../components/widgets.js';
import mic from '../../components/mic.js';
import { speechSupported } from '../../components/speech.js';
import { timeline } from '../../components/timeline.js';

const hhmmNow = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const todayKey = () => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date().getDay()];
const VERDICT = {
  feasible: ['Feasible', 'live', 'check'], tight: ['Tight', 'warn', 'clock'], not_feasible: ['Not feasible', 'crit', 'alert'],
  no_deadline: ['No deadline set', 'sky', 'clock'], unknown: ['Cannot estimate', 'warn', 'alert'],
};
let seq = 0;
const newStop = (over = {}) => ({ key: ++seq, raw: '', place_id: '', candidates: [], stay_min: '', arrive_by: '', ...over });
const placeName = (p) => (p ? (getLang() === 'ar' && p.name_ar ? p.name_ar : p.name_en) : '');
const BASIS = { walk: 'Walking', bus_live: 'Bus with live GPS', bus_scheduled: 'Bus from the timetable', taxi: 'Taxi', car: 'Car', transit: 'Public transport' };

export default function errands(view, ctx) {
  ctx.setTitle('Errand planner');
  view.load('places', () => api.get('/api/student/places'));
  view.load('classes', () => api.get('/api/student/schedule'));
  const saved = view.load('saved', () => api.get('/api/student/errands/saved'));
  const preText = ctx.query.text || '';
  Object.assign(view.state, {
    step: 1, inputMode: preText ? 'type' : 'voice', form: false, text: preText, parsing: false, err: '', stops: [], origin: 'campus',
    startAt: hhmmNow(), finishBy: '', useSchedule: true, deadlineClass: '', modes: [], pick: '', ai: null,
    plan: { data: null, error: null, loading: false }, sumAi: null, openBackups: new Set(),
  });
  let prev = [];
  let autoForm = false;
  let planToken = 0;
  let sumKey = '';
  const micProps = { onResult: (s) => { view.state.text = view.state.text ? `${view.state.text} ${s}` : s; view.update(); }, disabled: false };

  aiEnabled().then((v) => {
    view.state.ai = v;
    if (v === false && !autoForm && !preText) { autoForm = true; view.state.form = true; }
    view.update();
  });

  const S = () => view.state;
  const list = () => S().places.data?.places ?? [];
  const byId = (id) => list().find((p) => p.id === Number(id));
  const upcoming = () => (S().classes.data?.classes ?? []).filter((c) => c.day === todayKey() && c.start > hhmmNow());
  const deadline = () => (S().deadlineClass ? upcoming().find((c) => String(c.id) === String(S().deadlineClass)) : null);
  const finishParam = () => {
    const d = deadline();
    if (S().finishBy) return S().finishBy;
    if (!d) return undefined;
    const [h, m] = d.start.split(':').map(Number); const x = h * 60 + m - 10;
    return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
  };
  const originVal = () => (S().origin === 'campus' ? 'campus' : Number(S().origin));
  const body = () => ({
    start_at: S().startAt || undefined, origin_place_id: originVal(), finish_by: finishParam(), use_schedule: S().useSchedule,
    stops: S().stops.map((s) => ({ place_id: Number(s.place_id), stay_min: s.stay_min === '' ? undefined : Number(s.stay_min), arrive_by: s.arrive_by || undefined })),
    chosen_modes: S().modes, prev,
  });
  const summaryText = () => S().stops.map((s) => placeName(byId(s.place_id)) || s.raw).join(' → ');

  async function runPlan(silent = false) {
    if (S().step !== 3) return;
    const my = ++planToken;
    if (!silent) view.set({ plan: { ...S().plan, loading: true } });
    try {
      const d = await api.post('/api/student/errands/plan', body());
      if (my !== planToken || view.destroyed) return;
      prev = d.legs.map((l) => ({ leg: l.index, mode: l.mode, trip_id: l.meta?.trip_id ?? null, expected_departure: l.meta?.expected_departure ?? null }));
      view.set({ plan: { data: d, error: null, loading: false } });
      aiSummary(d);
    } catch (e) {
      if (my !== planToken || view.destroyed) return;
      view.set({ plan: { data: S().plan.data, error: e, loading: false } });
    }
  }
  async function aiSummary(d) {
    if (S().ai !== true || !d?.verdict) return;
    const key = JSON.stringify([S().stops.map((s) => [s.place_id, s.stay_min, s.arrive_by]), S().origin, S().startAt, finishParam(), S().modes, d.verdict]);
    if (key === sumKey) return;
    sumKey = key;
    view.set({ sumAi: { loading: true, data: null } });
    try {
      const r = await api.post('/api/student/errands/summary', { ...body(), prev: undefined, lang: getLang() });
      if (key === sumKey) view.set({ sumAi: { loading: false, data: r.text ?? r.sentence ?? (typeof r === 'string' ? r : null) } });
    } catch { if (key === sumKey) view.set({ sumAi: null }); }
  }
  view.interval(() => { if (S().step === 3 && !document.hidden) runPlan(true); }, 30000);

  async function understand() {
    view.set({ err: '', parsing: true });
    try {
      const d = await api.post('/api/student/errands/parse', { text: S().text, lang: getLang() });
      if (!d.stops.length) { view.state.err = t('We could not find any stops in that. Try again, or add stops one by one.'); return; }
      view.state.stops = d.stops.map((s) => newStop({ raw: s.raw, place_id: s.matched_place_id ?? '', candidates: s.candidates, stay_min: s.stay_min ?? '', arrive_by: s.arrive_by ?? '' }));
      if (d.start_time) view.state.startAt = d.start_time;
      if (d.finish_by) view.state.finishBy = d.finish_by;
      view.state.step = 2;
    } catch (e) { view.state.err = e.code === 'ai_disabled' ? t('AI is off on this server. Add your stops one by one.') : e.message; } finally { view.set({ parsing: false }); }
  }
  const goPlan = () => { prev = []; sumKey = ''; view.set({ modes: [], step: 3, plan: { data: null, error: null, loading: true }, sumAi: null }); runPlan(); };
  const changed = (patch) => { view.set({ modes: [], ...patch }); runPlan(); };

  function openHow() {
    const p = S().plan.data;
    if (!p) return;
    const m = openModal({
      title: t('How is this calculated?'),
      setup: () => ({
        render: () => html`<p>${t('Every time is a range. The best case uses the fastest end of each trip; the worst case the slowest. "Feasible" means even the worst case meets your deadline; "Tight" means only the best case does.')}</p>
          <ul>${p.basis_notes.map((n) => html`<li>${t(BASIS[n.key])}: ±${n.pct}%</li>`)}</ul>
          <p class="small muted">${t('Bus times come from the live board and are labelled live or scheduled. Outside the campus, times come from the "{p}" estimator.', { p: p.routing_provider })}</p>`,
        footer: () => html`<button class="btn" data-click="close">${t('Close')}</button>`,
        actions: { close: () => m.close() },
      }),
    });
  }

  return {
    render: () => {
      const st = S();
      const { step, inputMode, form, text, parsing, err, stops, origin, startAt, finishBy, useSchedule, deadlineClass, pick, ai, plan } = st;
      const L = list();
      const up = upcoming();
      const dl = deadline();
      const cls = dl ?? up[0];
      const blocked = stops.length === 0 || stops.some((s) => !s.place_id);
      micProps.disabled = parsing;

      const step1 = html`<div class="stack">
        <div class="card stack">
          <h2 style="font-size:1.15rem">${t('1. Tell me your errands')}</h2>
          ${!L.some((p) => p.area === 'off_campus') ? html`<div class="alert info" role="note"><div>${t('No places outside the campus have been added yet, so only campus places can be planned for now. The office adds banks, pharmacies and other off-campus places in the admin Places page.')}</div></div>` : ''}
          ${ai === false ? html`<div class="alert warn" role="status"><div>${t('Understanding a spoken or typed sentence needs the AI assistant, which is switched off on this server (no API key is set). You can still plan: add your stops one by one below.')}</div></div>` : ''}
          ${!form ? html`
            <div class="seg" role="group" aria-label="${t('How do you want to tell me?')}">
              <button type="button" aria-pressed="${bool(inputMode === 'voice')}" data-click="input-mode" data-m="voice">${t('Voice')}</button>
              <button type="button" aria-pressed="${bool(inputMode === 'type')}" data-click="input-mode" data-m="type">${t('Type')}</button>
            </div>
            ${inputMode === 'voice' ? html`<div class="row">${widgetHost('mic')}${!speechSupported ? html`<p class="small muted">${t('Voice input is not supported in this browser. Type instead.')}</p>` : ''}</div>` : ''}
            ${field({ label: t('Your errands in your own words'), id: 'er-text', hint: t('You can fix the text before we read it.') }, html`<textarea id="er-text" class="input" rows="3" maxlength="600" data-bind="text" placeholder="${t('For example: library, then the bank, then the pharmacy, and class at 12')}">${text}</textarea>`)}
            <div class="row">
              <button class="btn" data-click="understand" ${parsing || !text.trim() || ai === false ? 'disabled' : ''}>${parsing ? t('Reading… this can take up to a minute') : t('Understand')}</button>
              <button class="btn secondary" data-click="show-form">${t('Add stops one by one')}</button>
            </div>` : html`
            ${ai === false ? html`<p class="small muted">${t('The AI reader is off on this server, so add your stops one by one.')}</p>` : ''}
            <div class="row">
              ${field({ label: t('Add a place'), id: 'er-pick' }, html`<select id="er-pick" class="input" data-bind="pick"><option value="">${t('Choose…')}</option>${L.map((p) => html`<option value="${p.id}" ${String(pick) === String(p.id) ? 'selected' : ''}>${placeName(p)} · ${p.area === 'campus' ? t('On campus') : t('Outside campus')}</option>`)}</select>`)}
              <button class="btn" data-click="add-pick" ${!pick ? 'disabled' : ''}>${t('Add')}</button>
              <button class="btn ghost" data-click="hide-form">${t('Describe it by voice or text')}${ai === false ? ` (${t('needs AI')})` : ''}</button>
            </div>
            ${stops.length > 0 ? html`<ol class="small">${stops.map((s) => html`<li data-key="sl-${s.key}">${placeName(byId(s.place_id))}</li>`)}</ol>` : ''}`}
          ${err ? html`<div class="alert error" role="alert">${err}<div><button class="btn sm secondary" data-click="understand">${t('Try again')}</button> <button class="btn sm secondary" data-click="show-form-clear">${t('Add stops one by one')}</button></div></div>` : ''}
        </div>

        <div class="card stack">
          <h2 style="font-size:1.15rem">${t('Starting point and times')}</h2>
          <div class="form-grid">
            ${field({ label: t('Starting from'), id: 'er-from' }, html`<select id="er-from" class="input" data-bind="origin"><option value="campus" ${origin === 'campus' ? 'selected' : ''}>${t('Campus')}</option>${L.map((p) => html`<option value="${p.id}" ${String(origin) === String(p.id) ? 'selected' : ''}>${placeName(p)}</option>`)}</select>`)}
            ${field({ label: t('Start at'), id: 'er-start' }, html`<input id="er-start" type="time" class="input" data-bind="startAt" value="${startAt}">`)}
            ${field({ label: t('Finish by (optional)'), id: 'er-fin' }, html`<input id="er-fin" type="time" class="input" data-bind="finishBy" value="${finishBy}">`)}
          </div>
          ${up.length > 0 && !finishBy ? html`<div class="alert info" role="note"><div>
            <label class="check"><input type="checkbox" data-bind="useSchedule" ${useSchedule ? 'checked' : ''}>${t('You have {c} at {time}{loc}. Use it as your deadline?', { c: cls.title, time: cls.start, loc: cls.location_text ? ` ${t('in {l}', { l: cls.location_text })}` : '' })}</label>
            ${useSchedule && up.length > 1 ? field({ label: t('Use a different class'), id: 'er-cls' }, html`<select id="er-cls" class="input" data-bind="deadlineClass"><option value="">${t('The next class')}</option>${up.map((c) => html`<option value="${c.id}" ${String(deadlineClass) === String(c.id) ? 'selected' : ''}>${c.start} · ${c.title}</option>`)}</select>`) : ''}
          </div></div>` : ''}
        </div>
        <div class="row"><button class="btn" data-click="continue" ${stops.length === 0 && !form ? 'disabled' : ''}>${t('Continue')}</button></div>

        ${asyncBlock(st.saved, 'saved', (d) => html`<div class="card stack-sm"><h2 style="font-size:1.15rem">${t('Saved plans')}</h2>
          ${d.plans.map((p) => html`<div class="row between" data-key="sp-${p.id}"><span>${p.name || `${p.stops.length} ${t('stops')}`} <span class="small muted">· ${t('kept until {d}', { d: new Date(p.expires_at).toLocaleDateString() })}</span></span>
            <span class="row"><button class="btn sm" data-click="open-saved" data-id="${p.id}">${t('Open')}</button>
              <button class="btn sm danger" data-click="del-saved" data-id="${p.id}">${t('Delete')}</button></span></div>`)}</div>`, { empty: (d) => d.plans.length === 0 })}
      </div>`;

      const step2 = html`<div class="stack">
        <div class="card stack">
          <h2 style="font-size:1.15rem">${t('2. Check what we understood')}</h2>
          <p aria-live="polite"><b>${summaryText() || t('No stops yet')}</b>${finishParam() ?? finishBy ? `, ${t('finish by {t}', { t: finishParam() ?? finishBy })}` : ''}.</p>
          ${stops.map((s, i) => {
            const p = byId(s.place_id);
            const options = s.candidates.length ? L.filter((x) => s.candidates.some((c) => c.id === x.id)) : L;
            return html`<div class="card flat stack-sm" data-key="stop-${s.key}">
              <div class="row between"><b>${i + 1}. ${s.raw || placeName(p)}</b>
                ${p ? html`<span class="badge ${p.area === 'campus' ? 'sky' : 'navy'}">${p.area === 'campus' ? t('On campus') : t('Outside campus')}</span>` : html`<span class="badge crit">${t('Needs a place')}</span>`}</div>
              <div class="form-grid">
                ${field({ label: t('Place'), id: `st-p-${s.key}` }, html`<select id="st-p-${s.key}" class="input" data-change="stop-place" data-i="${i}"><option value="">${t('Pick a place')}</option>${options.map((x) => html`<option value="${x.id}" ${String(s.place_id) === String(x.id) ? 'selected' : ''}>${placeName(x)}</option>`)}</select>`)}
                ${field({ label: t('Time spent (min)'), id: `st-s-${s.key}` }, html`<input id="st-s-${s.key}" type="number" min="0" max="480" class="input" data-bind="stops.${i}.stay_min" value="${s.stay_min}" placeholder="${p ? String(p.default_stay_min) : ''}">`)}
                ${field({ label: t('Arrive by (optional)'), id: `st-a-${s.key}` }, html`<input id="st-a-${s.key}" type="time" class="input" data-bind="stops.${i}.arrive_by" value="${s.arrive_by}">`)}
              </div>
              <div class="row">
                <button class="btn sm secondary" ${i === 0 ? 'disabled' : ''} data-click="move" data-i="${i}" data-d="-1">${t('Move up')}</button>
                <button class="btn sm secondary" ${i === stops.length - 1 ? 'disabled' : ''} data-click="move" data-i="${i}" data-d="1">${t('Move down')}</button>
                <button class="btn sm danger" data-click="remove-stop" data-i="${i}">${t('Remove')}</button>
              </div>
            </div>`;
          })}
          <div class="row"><button class="btn secondary" ${stops.length >= 8 ? 'disabled' : ''} data-click="add-blank">${t('Add stop')}</button></div>
          ${blocked && stops.length > 0 ? html`<div class="alert warn" role="status">${t('Every stop needs a place before we can plan.')}</div>` : ''}
        </div>
        <div class="row"><button class="btn secondary" data-click="back1">${t('Back')}</button><button class="btn" ${blocked ? 'disabled' : ''} data-click="go-plan">${t('Plan it')}</button></div>
      </div>`;

      const planBlock = () => {
        const p = plan.data;
        const [vl, vc, vi] = VERDICT[p.verdict];
        return html`<div class="stack" aria-live="polite">
          <section class="card stack-sm">
            <div class="row"><span class="badge ${vc}">${icon(vi, 14)} ${t(vl)}</span><span class="small muted">${t('Updated {t}', { t: fmtTime(p.generated_at) })}</span></div>
            ${p.leave_by ? html`<div class="stat"><b dir="ltr">${fmtTime(p.leave_by_iso)}</b><span>${t('Leave by')}</span></div>` : ''}
            ${p.finish_range ? html`<p>${t('Done between {a} and {b}', { a: fmtTime(p.finish_range[0]), b: fmtTime(p.finish_range[1]) })}${p.finish_by ? ` · ${t('deadline {t}', { t: p.finish_by })}${p.finish_source === 'class' ? ` (${t('from your class')})` : ''}` : ''}</p>` : ''}
            ${aiSentence(st.sumAi)}
            ${p.verdict === 'not_feasible' && p.suggestions.length === 0 ? html`<p class="small">${t('Even the best case misses the deadline.')}</p>` : ''}
          </section>
          ${p.offcampus_estimates ? html`<div class="alert info" role="note">${t('Outside-campus times are estimates. Traffic can change them.')}</div>` : ''}
          ${p.changed.map((c) => html`<div class="alert warn" role="alert" data-key="chg-${c.leg}"><div><b>${t('A bus on this plan changed.')}</b> ${c.now.trip_id ? t('Its departure moved.') : t('It is no longer available.')}</div><button class="btn sm" data-click="use-backup" data-leg="${c.leg}">${t('Use backup')}</button></div>`)}
          ${p.conflicts.map((c) => html`<div class="alert warn" role="alert">${t('This overlaps your class {c} ({a}–{b}).', { c: c.title, a: c.start, b: c.end })}</div>`)}
          ${p.warnings.map((w) => html`<div class="alert warn" role="status">${td(w.text)}</div>`)}
          ${p.suggestions.length > 0 ? html`<div class="card stack-sm"><b>${t('You could make it work by skipping one stop:')}</b>
            <div class="row">${p.suggestions.map((s) => html`<button class="btn sm secondary" data-click="skip" data-i="${s.drop_index}">${t('Skip {name}', { name: placeName(s.place) })} → ${t(VERDICT[s.resulting_verdict][0])}</button>`)}</div></div>` : ''}
          ${timeline(p, st.openBackups)}
        </div>`;
      };

      const step3 = html`<div class="stack">
        <div class="row"><button class="btn secondary" data-click="back2">${t('Back')}</button><button class="btn secondary" data-click="replan">${t('Re-plan')}</button>
          <button class="btn secondary" data-click="save-plan" ${!plan.data ? 'disabled' : ''}>${t('Save this plan')}</button><button class="btn ghost" data-click="how">${t('How is this calculated?')}</button></div>
        ${plan.loading && !plan.data ? loading(t('Planning…')) : ''}
        ${plan.error && !plan.data ? html`<div class="alert error" role="alert">${plan.error.message} <button class="btn sm secondary" data-click="replan">${t('Retry')}</button></div>` : ''}
        ${plan.data ? planBlock() : ''}
      </div>`;

      return html`${pageHead(t('Errand planner'), t('Tell us what you need to do. We check whether you can finish in time, and show times as ranges with how they were worked out.'))}
      ${asyncBlock(st.places, 'places', () => html`${step === 1 ? step1 : ''}${step === 2 ? step2 : ''}${step === 3 ? step3 : ''}${step === 1 && L.length === 0 ? empty(t('No places yet')) : ''}`)}`;
    },
    after: () => syncWidgets(view, { ...WIDGETS, mic }, { mic: micProps }),
    actions: {
      'input-mode': (el) => view.set({ inputMode: el.dataset.m }),
      understand,
      'show-form': () => view.set({ form: true }),
      'show-form-clear': () => view.set({ err: '', form: true }),
      'hide-form': () => view.set({ form: false }),
      'add-pick': () => {
        const p = byId(S().pick); if (!p) return;
        view.set({ stops: [...S().stops, newStop({ raw: p.name_en, place_id: p.id, stay_min: p.default_stay_min })], pick: '' });
      },
      continue: () => { if (S().stops.length) view.set({ step: 2 }); },
      'open-saved': (el) => {
        const p = S().saved.data.plans.find((x) => x.id === Number(el.dataset.id)); if (!p) return;
        view.set({ stops: p.stops.map((s) => newStop({ place_id: s.place_id, stay_min: s.stay_min ?? '', arrive_by: s.arrive_by ?? '' })), origin: p.origin_place_id === 'campus' ? 'campus' : String(p.origin_place_id), finishBy: p.finish_by ?? '', step: 2 });
      },
      'del-saved': (el) => confirmDialog({
        title: 'Delete saved plan', danger: true, confirmLabel: 'Delete', body: t('Delete this saved plan?'),
        onConfirm: async () => { await api.del(`/api/student/errands/saved/${el.dataset.id}`); toast(t('Plan deleted')); saved.reload(); },
      }),
      'stop-place': (el) => {
        const i = Number(el.dataset.i); const s = S().stops[i]; const np = byId(el.value);
        s.place_id = el.value ? Number(el.value) : '';
        if (s.stay_min === '' && np) s.stay_min = np.default_stay_min;
        view.update();
      },
      move: (el) => {
        const i = Number(el.dataset.i), d = Number(el.dataset.d); const a = [...S().stops]; [a[i], a[i + d]] = [a[i + d], a[i]]; view.set({ stops: a });
      },
      'remove-stop': (el) => view.set({ stops: S().stops.filter((_, j) => j !== Number(el.dataset.i)) }),
      'add-blank': () => view.set({ stops: [...S().stops, newStop()] }),
      back1: () => view.set({ step: 1 }),
      back2: () => { planToken++; view.set({ step: 2 }); },
      'go-plan': goPlan,
      replan: () => runPlan(),
      'save-plan': async () => {
        try {
          await api.post('/api/student/errands/save', { stops: S().stops.map((s) => ({ place_id: Number(s.place_id), stay_min: s.stay_min === '' ? null : Number(s.stay_min), arrive_by: s.arrive_by || null })), origin_place_id: originVal(), finish_by: finishParam() ?? null, name: summaryText().slice(0, 60) });
          toast(t('Plan saved for 7 days')); saved.reload();
        } catch (e) { toast(e.message, 'error'); }
      },
      how: openHow,
      'use-backup': (el) => { const a = [...S().modes]; a[Number(el.dataset.leg)] = null; view.set({ modes: a }); runPlan(); },
      skip: (el) => changed({ stops: S().stops.filter((_, j) => j !== Number(el.dataset.i)) }),
      'set-mode': (el) => { const a = [...S().modes]; a[Number(el.dataset.i)] = el.dataset.mode; view.set({ modes: a }); runPlan(); },
      'toggle-backup': (el) => {
        const i = Number(el.dataset.i); const s = new Set(S().openBackups);
        if (s.has(i)) s.delete(i); else s.add(i);
        view.set({ openBackups: s });
      },
      'swap-place': (el) => {
        const stop = S().plan.data?.stops.find((x) => x.index === Number(el.dataset.i));
        const place = stop?.backups?.places?.find((p) => p.place.id === Number(el.dataset.place))?.place;
        if (!place) return;
        const i = Number(el.dataset.i);
        changed({ stops: S().stops.map((x, j) => (j === i ? { ...x, place_id: place.id, raw: place.name_en } : x)) });
      },
    },
  };
}

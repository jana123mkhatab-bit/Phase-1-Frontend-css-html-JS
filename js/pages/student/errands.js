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
  feasible: ['Feasible', 'live', 'check'], tight: ['Tight', 'warn', 'clock'], not_feasible: ['Not feasible', 'crit', 'alert'], closed: ['A place is closed', 'crit', 'alert'],
  no_deadline: ['No deadline set', 'sky', 'clock'], unknown: ['Cannot estimate', 'warn', 'alert'],
};
let seq = 0;
const newStop = (over = {}) => ({ key: ++seq, raw: '', place_id: '', candidates: [], stay_min: '', arrive_by: '', ...over });
const placeName = (p) => (p ? (getLang() === 'ar' && p.name_ar ? p.name_ar : p.name_en) : '');
const CATS = ['bank', 'pharmacy', 'printing', 'food', 'clinic', 'worship', 'shop', 'other'];
// Ideas shown on an empty planner; each is offered only when all of its places exist. The first one is on the sample student's bus route.
const EXAMPLES = [
  { label: 'Bank and clinic by bus', names: ['Banque Misr', 'Nile Clinic'] },
  { label: 'Pharmacy and printing', names: ['Al Ezaby', 'Quick Print'] },
  { label: 'Print, then lunch', names: ['Print & Copy Hub', 'Koshary'] },
];
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
    backToCampus: true, area: 'campus', originArea: 'campus', custom: { name: '', category: 'other', coords: '', busy: false, err: '' },
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
    chosen_modes: S().modes, return_to_campus: S().backToCampus, prev,
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
        render: () => html`<p>${t('Every time is a range. The best case uses the fastest end of each trip; the worst case the slowest. "Feasible" means even the worst case meets your deadline; "Tight" means only the best case does. A class is judged on when you are back there, a place that has not opened yet means waiting, and a free bus is preferred to a taxi that is only a little faster.')}</p>
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
      const { step, inputMode, form, text, parsing, err, stops, origin, startAt, finishBy, backToCampus, useSchedule, deadlineClass, pick, ai, plan, custom, area, originArea } = st;
      const L = list();
      const up = upcoming();
      const dl = deadline();
      const cls = dl ?? up[0];
      const blocked = stops.length === 0 || stops.some((s) => !s.place_id);
      micProps.disabled = parsing;

      const exampleList = EXAMPLES.filter((x) => x.names.every((n) => L.some((p) => p.area === 'off_campus' && p.name_en.startsWith(n))));
      const stopChips = stops.length > 0 ? html`<ol class="er-chips" aria-label="${t('Your stops')}">${stops.map((s, i) => html`<li data-key="sl-${s.key}"><span class="er-chip"><b>${i + 1}</b>${placeName(byId(s.place_id)) || s.raw}<button type="button" class="er-x" data-click="remove-stop" data-i="${i}" aria-label="${t('Remove')}">${icon('close', 14)}</button></span></li>`)}</ol>` : '';

      const stepper = html`<ol class="er-steps" aria-label="${t('Steps')}">
        ${[[1, 'Stops'], [2, 'Details'], [3, 'Your plan']].map(([n, label]) => html`<li class="${step === n ? 'on' : step > n ? 'done' : ''}" ${step === n ? 'aria-current="step"' : ''}>
          <button type="button" data-click="goto-step" data-s="${n}" ${n >= step ? 'disabled' : ''}><span class="er-n">${step > n ? icon('check', 14) : n}</span><span>${t(label)}</span></button></li>`)}
      </ol>`;

      const step1 = html`<div class="stack">
        <div class="card stack">
          <div><h2 class="er-h">${t('Where do you need to go?')}</h2><p class="small muted" style="margin:4px 0 0">${t('Add one or more places. We work out the ways to get there and whether you finish in time.')}</p></div>
          ${!L.some((p) => p.area === 'off_campus') ? html`<div class="alert info" role="note"><div>${t('No places outside the campus have been added yet, so only campus places can be planned for now. The office adds banks, pharmacies and other off-campus places in the admin Places page.')}</div></div>` : ''}
          ${stopChips}
          ${exampleList.length > 0 && stops.length === 0 ? html`<div class="stack-sm"><span class="small muted">${t('Try an example')}</span>
            <div class="seg-chips">${exampleList.map((x, i) => html`<button type="button" class="chip" data-click="example" data-i="${i}">${icon('pin', 14)} ${t(x.label)}</button>`)}</div></div>` : ''}
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
            <div class="seg" role="group" aria-label="${t('Where is the place?')}">
              <button type="button" aria-pressed="${bool(area === 'campus')}" data-click="area" data-a="campus">${t('On campus')}</button>
              <button type="button" aria-pressed="${bool(area === 'off_campus')}" data-click="area" data-a="off_campus">${t('Outside campus')}</button>
            </div>
            <div class="er-add">
              ${field({ label: area === 'campus' ? t('Add a campus place') : t('Add a place outside campus'), id: 'er-pick' }, html`<select id="er-pick" class="input" data-bind="pick"><option value="">${t('Choose…')}</option>${L.filter((p) => p.area === area).map((p) => html`<option value="${p.id}" ${String(pick) === String(p.id) ? 'selected' : ''}>${placeName(p)}${p.near ? ` · ${p.near.route_code} ${t('bus')} (${p.near.stop_name})` : ''}</option>`)}</select>`)}
              <button class="btn" data-click="add-pick" ${!pick ? 'disabled' : ''}>${t('Add')}</button>
            </div>
            <div><button class="btn sm ghost" data-click="hide-form">${t('Describe it by voice or text')}${ai === false ? ` (${t('needs AI')})` : ''}</button></div>
            ${area === 'off_campus' ? html`<details class="er-custom"${custom.name || custom.coords || custom.err ? ' open' : ''}><summary>${t('Not in the list? Add your own place.')}</summary><div class="card flat stack-sm" role="group" aria-label="${t('Add your own place outside campus')}">
              <div class="form-grid">
                ${field({ label: t('Place name'), id: 'cu-name' }, html`<input id="cu-name" class="input" maxlength="80" data-bind="custom.name" value="${custom.name}" placeholder="${t('For example: Dr. Ahmed Clinic')}">`)}
                ${field({ label: t('Type of place'), id: 'cu-cat' }, html`<select id="cu-cat" class="input" data-bind="custom.category">${CATS.map((c) => html`<option value="${c}" ${custom.category === c ? 'selected' : ''}>${t(c[0].toUpperCase() + c.slice(1))}</option>`)}</select>`)}
              </div>
              ${field({ label: t('Location (latitude, longitude)'), id: 'cu-loc', hint: t('Paste the coordinates from your maps app (press and hold on the place), or use your current location.') }, html`<div class="row"><input id="cu-loc" class="input" style="flex:1;min-width:200px" inputmode="decimal" data-bind="custom.coords" value="${custom.coords}" placeholder="30.0293, 31.4592"><button type="button" class="btn sm secondary" data-click="custom-here" ${custom.busy ? 'disabled' : ''}>${t('Use my location')}</button></div>`)}
              ${custom.err ? html`<div class="alert error" role="alert">${custom.err}</div>` : ''}
              <div><button type="button" class="btn" data-click="custom-save" ${custom.busy ? 'disabled' : ''}>${custom.busy ? t('Saving…') : t('Save and add to my stops')}</button></div>
            </div></details>` : ''}`}
          ${err ? html`<div class="alert error" role="alert">${err}<div><button class="btn sm secondary" data-click="understand">${t('Try again')}</button> <button class="btn sm secondary" data-click="show-form-clear">${t('Add stops one by one')}</button></div></div>` : ''}
        </div>

        <div class="card stack">
          <h2 class="er-h">${t('Starting point and times')}</h2>
          <div class="form-grid">
            ${field({ label: t('Starting from'), id: 'er-from' }, html`<div class="stack-sm">
              <div class="seg" role="group" aria-label="${t('Where do you start?')}">
                <button type="button" aria-pressed="${bool(originArea === 'campus')}" data-click="origin-area" data-a="campus">${t('On campus')}</button>
                <button type="button" aria-pressed="${bool(originArea === 'off_campus')}" data-click="origin-area" data-a="off_campus">${t('Outside campus')}</button>
              </div>
              <select id="er-from" class="input" data-bind="origin">
                ${originArea === 'campus' ? html`<option value="campus" ${origin === 'campus' ? 'selected' : ''}>${t('Campus (main gate)')}</option>` : html`<option value="" disabled ${L.some((p) => p.area === 'off_campus' && String(p.id) === String(origin)) ? '' : 'selected'}>${t('Choose a place…')}</option>`}
                ${L.filter((p) => p.area === originArea).map((p) => html`<option value="${p.id}" ${String(origin) === String(p.id) ? 'selected' : ''}>${placeName(p)}</option>`)}
              </select></div>`)}
            ${field({ label: t('Start at'), id: 'er-start' }, html`<input id="er-start" type="time" class="input" data-bind="startAt" value="${startAt}">`)}
            ${field({ label: t('Finish by (optional)'), id: 'er-fin' }, html`<input id="er-fin" type="time" class="input" data-bind="finishBy" value="${finishBy}">`)}
          </div>
          <label class="check er-back"><input type="checkbox" data-bind="backToCampus" ${backToCampus ? 'checked' : ''}><span>${t('Come back to campus at the end')}<span class="small muted" style="display:block;font-weight:500">${t('We add the trip back, so a class is judged on when you arrive, not when you leave the last stop.')}</span></span></label>
          ${up.length > 0 && !finishBy ? html`<div class="alert info" role="note"><div>
            <label class="check"><input type="checkbox" data-bind="useSchedule" ${useSchedule ? 'checked' : ''}>${t('You have {c} at {time}{loc}. Use it as your deadline?', { c: cls.title, time: cls.start, loc: cls.location_text ? ` ${t('in {l}', { l: cls.location_text })}` : '' })}</label>
            ${useSchedule && up.length > 1 ? field({ label: t('Use a different class'), id: 'er-cls' }, html`<select id="er-cls" class="input" data-bind="deadlineClass"><option value="">${t('The next class')}</option>${up.map((c) => html`<option value="${c.id}" ${String(deadlineClass) === String(c.id) ? 'selected' : ''}>${c.start} · ${c.title}</option>`)}</select>`) : ''}
          </div></div>` : ''}
        </div>

        ${asyncBlock(st.saved, 'saved', (d) => html`<div class="card stack-sm"><h2 class="er-h">${t('Saved plans')}</h2>
          ${d.plans.map((p) => html`<div class="er-saved" data-key="sp-${p.id}"><div class="er-saved-txt"><b>${p.name || `${p.stops.length} ${t('stops')}`}</b>
              <span class="small muted">${p.stops.map((s) => placeName(byId(s.place_id))).filter(Boolean).join(' → ')} · ${t('kept until {d}', { d: new Date(p.expires_at).toLocaleDateString() })}</span></div>
            <span class="row"><button class="btn sm" data-click="open-saved" data-id="${p.id}">${t('Open')}</button>
              <button class="btn sm danger" data-click="del-saved" data-id="${p.id}">${t('Delete')}</button></span></div>`)}</div>`, { empty: (d) => d.plans.length === 0 })}

        <div class="er-actions"><button class="btn" data-click="continue" ${stops.length === 0 && !form ? 'disabled' : ''}>${t('Continue')} ${icon('arrow', 16)}</button></div>
      </div>`;

      const step2 = html`<div class="stack">
        <div class="card stack">
          <div><h2 class="er-h">${t('Check your stops')}</h2>
            <p class="small muted" style="margin:4px 0 0" aria-live="polite">${summaryText() || t('No stops yet')}${finishParam() ?? finishBy ? ` · ${t('finish by {t}', { t: finishParam() ?? finishBy })}` : ''}${backToCampus ? ` · ${t('back on campus at the end')}` : ''}</p></div>
          ${stops.map((s, i) => {
            const p = byId(s.place_id);
            const options = s.candidates.length ? L.filter((x) => s.candidates.some((c) => c.id === x.id)) : L;
            return html`<div class="card flat stack-sm er-stop" data-key="stop-${s.key}">
              <div class="row between"><b><span class="er-num">${i + 1}</span> ${s.raw || placeName(p)}</b>
                ${p ? html`<span class="badge ${p.area === 'campus' ? 'sky' : 'navy'}">${p.area === 'campus' ? t('On campus') : t('Outside campus')}</span>` : html`<span class="badge crit">${t('Needs a place')}</span>`}</div>
              <div class="form-grid">
                ${field({ label: t('Place'), id: `st-p-${s.key}` }, html`<select id="st-p-${s.key}" class="input" data-change="stop-place" data-i="${i}"><option value="">${t('Pick a place')}</option>${options.map((x) => html`<option value="${x.id}" ${String(s.place_id) === String(x.id) ? 'selected' : ''}>${placeName(x)}</option>`)}</select>`)}
                ${field({ label: t('Time spent (min)'), id: `st-s-${s.key}`, hint: p ? t('Usually {n} min', { n: p.default_stay_min }) : '' }, html`<input id="st-s-${s.key}" type="number" min="0" max="480" class="input" data-bind="stops.${i}.stay_min" value="${s.stay_min}" placeholder="${p ? String(p.default_stay_min) : ''}">`)}
                ${field({ label: t('Arrive by (optional)'), id: `st-a-${s.key}` }, html`<input id="st-a-${s.key}" type="time" class="input" data-bind="stops.${i}.arrive_by" value="${s.arrive_by}">`)}
              </div>
              <div class="row">
                <button class="btn sm secondary" ${i === 0 ? 'disabled' : ''} data-click="move" data-i="${i}" data-d="-1">${t('Move up')}</button>
                <button class="btn sm secondary" ${i === stops.length - 1 ? 'disabled' : ''} data-click="move" data-i="${i}" data-d="1">${t('Move down')}</button>
                <button class="btn sm danger outline" data-click="remove-stop" data-i="${i}">${t('Remove')}</button>
              </div>
            </div>`;
          })}
          <div class="row"><button class="btn secondary" ${stops.length >= 8 ? 'disabled' : ''} data-click="add-blank">${t('Add stop')}</button></div>
          ${blocked && stops.length > 0 ? html`<div class="alert warn" role="status">${t('Every stop needs a place before we can plan.')}</div>` : ''}
        </div>
        <div class="er-actions"><button class="btn secondary" data-click="back1">${t('Back')}</button><button class="btn" ${blocked ? 'disabled' : ''} data-click="go-plan">${t('Plan it')} ${icon('arrow', 16)}</button></div>
      </div>`;

      const planBlock = () => {
        const p = plan.data;
        const [vl, vc, vi] = VERDICT[p.verdict];
        const stopCount = p.stops.filter((x) => !x.is_return).length;
        const buses = p.legs.filter((l) => l.mode === 'bus').length;
        const slack = p.slack_min;
        const leaveLater = p.leave_by_iso && new Date(p.leave_by_iso) > new Date(p.start_at);
        const headline = { feasible: t('You can make it'), tight: t('Possible, but tight'), not_feasible: t('You will not make it'), closed: t('A place will be closed'), no_deadline: t('Here is your plan'), unknown: t('We cannot estimate part of this trip') }[p.verdict];
        const reason = {
          feasible: slack != null ? t('Even if things run slow you are done {n} min before the deadline.', { n: slack }) : '',
          tight: slack != null && slack < 0 ? t('If things run slow you would be {n} min late. Read the notes below.', { n: -slack }) : t('Check the notes below before you go.'),
          not_feasible: t('Even in the best case you finish after the deadline.'),
          closed: t('Check the opening hours in the notes below.'),
          no_deadline: t('Add a finish time to check this against a deadline.'),
          unknown: t('See the notes below.'),
        }[p.verdict];
        const cost = p.cost_range ? (p.cost_range[1] === 0 ? t('Free') : p.cost_range[0] === p.cost_range[1] ? t('{a} EGP', { a: p.cost_range[0] }) : t('{a}–{b} EGP', { a: p.cost_range[0], b: p.cost_range[1] })) : null;
        const notes = [
          ...p.changed.map((c) => html`<div class="alert warn" role="alert" data-key="chg-${c.leg}"><div><b>${t('A bus on this plan changed.')}</b> ${c.now.trip_id ? t('Its departure moved.') : t('It is no longer available.')}</div><button class="btn sm" data-click="use-backup" data-leg="${c.leg}">${t('Use backup')}</button></div>`),
          ...p.conflicts.map((c) => html`<div class="alert warn" role="alert">${icon('alert', 16)}<div>${t('This overlaps your class {c} ({a}–{b}).', { c: c.title, a: c.start, b: c.end })}</div></div>`),
          ...p.warnings.map((w) => html`<div class="alert warn" role="status">${icon(w.code === 'waits_for_opening' ? 'clock' : 'alert', 16)}<div>${td(w.text)}</div></div>`),
        ];
        return html`<div class="stack" aria-live="polite">
          <section class="card stack-sm plan-hero ${vc}">
            <div class="row between"><span class="badge ${vc}">${icon(vi, 14)} ${t(vl)}</span><span class="small muted">${t('Updated {t}', { t: fmtTime(p.generated_at) })}</span></div>
            <h2 class="plan-headline">${headline}</h2>
            ${reason ? html`<p class="muted" style="margin:0">${reason}</p>` : ''}
            <div class="plan-stats">
              ${leaveLater ? html`<div class="plan-stat"><span>${t('Latest you can leave')}</span><b dir="ltr">${fmtTime(p.leave_by_iso)}</b></div>` : ''}
              ${p.finish_range ? html`<div class="plan-stat"><span>${p.return_to ? t('Back on campus between') : t('Done between')}</span><b dir="ltr">${fmtTime(p.finish_range[0])}${p.finish_range[1] ? ` – ${fmtTime(p.finish_range[1])}` : ' –'}</b></div>` : ''}
              ${p.finish_by ? html`<div class="plan-stat"><span>${t('Deadline')}${p.finish_source === 'class' ? ` (${t('from your class')})` : ''}</span><b dir="ltr">${p.finish_by}</b></div>` : ''}
              ${slack != null && slack >= 0 ? html`<div class="plan-stat"><span>${t('Spare time')}</span><b>${t('{n} min', { n: slack })}</b></div>` : ''}
              ${cost ? html`<div class="plan-stat"><span>${t('Cost')}</span><b>${cost}</b></div>` : ''}
              ${buses > 0 ? html`<div class="plan-stat"><span>${t('University bus')}</span><b>${buses === 1 ? t('1 ride') : t('{n} rides', { n: buses })}</b></div>` : ''}
              <div class="plan-stat"><span>${t('Stops')}</span><b>${stopCount}</b></div>
            </div>
            ${aiSentence(st.sumAi)}
          </section>
          ${p.offcampus_estimates ? html`<div class="alert info" role="note">${t('Outside-campus times are estimates. Traffic can change them.')}</div>` : ''}
          ${notes.length > 0 ? html`<div class="stack-sm">${notes}</div>` : ''}
          ${p.suggestions.length > 0 ? html`<div class="card stack-sm"><b>${t('You could make it work by skipping one stop:')}</b>
            <div class="row">${p.suggestions.map((s) => html`<button class="btn sm secondary" data-click="skip" data-i="${s.drop_index}">${t('Skip {name}', { name: placeName(s.place) })} → ${t(VERDICT[s.resulting_verdict][0])}</button>`)}</div></div>` : ''}
          ${timeline(p, st.openBackups)}
        </div>`;
      };

      const step3 = html`<div class="stack">
        <div class="er-toolbar"><button class="btn secondary" data-click="back2">${icon('chevleft', 16)} ${t('Back')}</button><button class="btn secondary" data-click="replan">${t('Re-plan')}</button>
          <button class="btn secondary" data-click="save-plan" ${!plan.data ? 'disabled' : ''}>${t('Save this plan')}</button><button class="btn ghost" data-click="how">${t('How is this calculated?')}</button></div>
        ${plan.loading && !plan.data ? loading(t('Planning…')) : ''}
        ${plan.error && !plan.data ? html`<div class="alert error" role="alert">${plan.error.message} <button class="btn sm secondary" data-click="replan">${t('Retry')}</button></div>` : ''}
        ${plan.data ? planBlock() : ''}
      </div>`;

      return html`${pageHead(t('Errand planner'), t('Tell us what you need to do. We check whether you can finish in time, and show times as ranges with how they were worked out.'))}
      ${asyncBlock(st.places, 'places', () => html`${stepper}${step === 1 ? step1 : ''}${step === 2 ? step2 : ''}${step === 3 ? step3 : ''}${step === 1 && L.length === 0 ? empty(t('No places yet')) : ''}`)}`;
    },
    after: () => syncWidgets(view, { ...WIDGETS, mic }, { mic: micProps }),
    actions: {
      'goto-step': (el) => { const n = Number(el.dataset.s); if (n < S().step) { planToken++; view.set({ step: n }); } },
      example: (el) => {
        const offs = list().filter((p) => p.area === 'off_campus');
        const x = EXAMPLES.filter((e) => e.names.every((n) => offs.some((p) => p.name_en.startsWith(n))))[Number(el.dataset.i)]; if (!x) return;
        const ps = x.names.map((n) => offs.find((p) => p.name_en.startsWith(n)));
        view.set({ stops: ps.map((p) => newStop({ raw: p.name_en, place_id: p.id, stay_min: p.default_stay_min })), form: true, area: 'off_campus' });
      },
      'input-mode': (el) => view.set({ inputMode: el.dataset.m }),
      understand,
      'show-form': () => view.set({ form: true }),
      'show-form-clear': () => view.set({ err: '', form: true }),
      'hide-form': () => view.set({ form: false }),
      area: (el) => view.set({ area: el.dataset.a, pick: '' }),
      'origin-area': (el) => {
        const a = el.dataset.a; const cur = byId(S().origin);
        // keep the chosen start only if it belongs to the tab being opened; otherwise fall back to the campus
        view.set({ originArea: a, origin: a === 'campus' ? (cur?.area === 'campus' ? S().origin : 'campus') : (cur?.area === 'off_campus' ? S().origin : 'campus') });
      },
      'custom-here': () => {
        if (!('geolocation' in navigator)) { view.set({ custom: { ...S().custom, err: t('Your browser does not support location. Paste the coordinates instead.') } }); return; }
        view.set({ custom: { ...S().custom, busy: true, err: '' } });
        navigator.geolocation.getCurrentPosition(
          (p) => view.set({ custom: { ...S().custom, busy: false, coords: `${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}` } }),
          () => view.set({ custom: { ...S().custom, busy: false, err: t('We could not get your location. Paste the coordinates instead.') } }),
          { timeout: 10000 },
        );
      },
      'custom-save': async () => {
        const c = S().custom;
        const m = c.coords.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
        if (!c.name.trim()) { view.set({ custom: { ...c, err: t('Enter a name for the place.') } }); return; }
        if (!m) { view.set({ custom: { ...c, err: t('Enter the location as two numbers, like 30.0293, 31.4592.') } }); return; }
        view.set({ custom: { ...c, busy: true, err: '' } });
        try {
          const d = await api.post('/api/student/places', { name: c.name.trim(), category: c.category, lat: Number(m[1]), lng: Number(m[2]) });
          await view.loaders.places.refresh();
          const p = d.place;
          view.set({ stops: [...S().stops, newStop({ raw: p.name_en, place_id: p.id, stay_min: p.default_stay_min })], custom: { name: '', category: 'other', coords: '', busy: false, err: '' } });
          toast(t('Place added'));
        } catch (e) { view.set({ custom: { ...S().custom, busy: false, err: e.message } }); }
      },
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

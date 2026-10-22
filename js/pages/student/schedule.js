import { html, bool } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { downloadCsv } from '../../core/format.js';
import { asyncBlock, pageHead, empty, field, loading, toast, confirmDialog, aiEnabled } from '../../core/ui.js';
import { syncWidgets, widgetHost } from '../../core/widgets.js';
import { WIDGETS } from '../../components/widgets.js';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_LABEL = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };
const AR_DAYS = { الأحد: 'sun', الاحد: 'sun', الاثنين: 'mon', الإثنين: 'mon', الثلاثاء: 'tue', الأربعاء: 'wed', الاربعاء: 'wed', الخميس: 'thu', الجمعة: 'fri', السبت: 'sat' };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_FILE = 5 * 1024 * 1024;
const LOW = 0.7;
const blank = () => ({ title: '', day: 'sun', start: '', end: '', location_text: '', source: 'manual' });

/** Small hand-written CSV reader (quotes, commas, CRLF). Returns rows of cells. */
function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

function csvToRows(text) {
  const grid = parseCsv(text);
  const errors = []; const rows = [];
  if (!grid.length) return { rows, errors: [t('The file is empty.')] };
  const head = grid[0].map((h) => h.trim().toLowerCase());
  const col = (name) => head.indexOf(name);
  const idx = { title: col('title'), day: col('day'), start: col('start'), end: col('end'), loc: col('location') };
  if (idx.title < 0 || idx.day < 0 || idx.start < 0 || idx.end < 0) return { rows, errors: [t('The first line must be: title,day,start,end,location')] };
  grid.slice(1).forEach((r, i) => {
    const line = i + 2;
    const get = (k) => (k < 0 ? '' : (r[k] ?? '').trim());
    const dayRaw = get(idx.day).toLowerCase();
    const day = DAYS.includes(dayRaw.slice(0, 3)) && /^[a-z]+$/.test(dayRaw) ? dayRaw.slice(0, 3) : AR_DAYS[get(idx.day)];
    const row = { title: get(idx.title), day, start: get(idx.start), end: get(idx.end), location_text: get(idx.loc), source: 'csv' };
    const bad = [];
    if (!row.title) bad.push(t('title is missing'));
    if (!row.day) bad.push(t('day must be sun, mon, tue, wed, thu, fri or sat'));
    if (!HHMM.test(row.start)) bad.push(t('start must be HH:MM'));
    if (!HHMM.test(row.end)) bad.push(t('end must be HH:MM'));
    else if (HHMM.test(row.start) && row.end <= row.start) bad.push(t('end must be after start'));
    if (bad.length) errors.push(t('Line {n}: {why}', { n: line, why: bad.join(', ') })); else rows.push(row);
  });
  return { rows, errors };
}

const toBase64 = (file) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '');
  fr.onerror = () => reject(new Error(t('The file could not be read.')));
  fr.readAsDataURL(file);
});

function week(classes) {
  const today = DAYS[new Date().getDay()];
  const days = DAYS.filter((d) => ['sun', 'mon', 'tue', 'wed', 'thu'].includes(d) || classes.some((c) => c.day === d));
  return html`<div class="week" role="table" aria-label="${t('My weekly timetable')}">
    ${days.map((d) => html`<section data-key="wd-${d}" class="week-day ${d === today ? 'today' : ''}" role="rowgroup" aria-label="${t(DAY_LABEL[d])}">
      <h3>${t(DAY_LABEL[d])}${d === today ? html`<span class="badge sky">${t('Today')}</span>` : ''}</h3>
      ${classes.filter((c) => c.day === d).map((c) => html`<div class="week-class"><b dir="ltr">${c.start}–${c.end}</b><span>${c.title}</span>${c.location_text ? html`<span class="small muted">${c.location_text}</span>` : ''}</div>`)}
      ${!classes.some((c) => c.day === d) ? html`<span class="small muted">${t('No classes')}</span>` : ''}
    </section>`)}
  </div>`;
}

function rowsEditor(rows) {
  return html`<div class="stack-sm">${rows.map((r, i) => {
    const low = r.confidence != null && r.confidence < LOW;
    return html`<div class="card flat sched-row" data-key="row-${i}">
      <div class="form-grid">
        ${field({ label: t('Class'), id: `c-t-${i}` }, html`<input id="c-t-${i}" class="input" maxlength="80" data-bind="rows.${i}.title" value="${r.title}">`)}
        ${field({ label: t('Day'), id: `c-d-${i}` }, html`<select id="c-d-${i}" class="input" data-bind="rows.${i}.day">${DAYS.map((d) => html`<option value="${d}" ${r.day === d ? 'selected' : ''}>${t(DAY_LABEL[d])}</option>`)}</select>`)}
        ${field({ label: t('Starts'), id: `c-s-${i}` }, html`<input id="c-s-${i}" type="time" class="input" data-bind="rows.${i}.start" value="${r.start}">`)}
        ${field({ label: t('Ends'), id: `c-e-${i}` }, html`<input id="c-e-${i}" type="time" class="input" data-bind="rows.${i}.end" value="${r.end}">`)}
        ${field({ label: t('Location'), id: `c-l-${i}` }, html`<input id="c-l-${i}" class="input" maxlength="80" data-bind="rows.${i}.location_text" value="${r.location_text ?? ''}">`)}
      </div>
      <div class="row between">
        ${low ? html`<span class="badge warn">⚠ ${t('Please check this row: the reader was not sure')}</span>` : html`<span></span>`}
        <button type="button" class="btn sm secondary" data-click="remove-row" data-i="${i}">${t('Remove row')}</button>
      </div>
    </div>`;
  })}</div>`;
}

export default function schedule(view, ctx) {
  ctx.setTitle('My timetable');
  const saved = view.load('saved', () => api.get('/api/student/schedule'));
  Object.assign(view.state, { mode: 'view', tab: 'manual', rows: [], reviewing: false, errors: [], busy: false, err: '', ai: null, init: false });
  aiEnabled().then((v) => view.set({ ai: v }));

  const hasSaved = () => (view.state.saved.data?.classes.length ?? 0) > 0;
  const reset = (patch) => view.set({ errors: [], err: '', ...patch });

  return {
    render: () => {
      const { mode, tab, rows, reviewing, errors, busy, err, ai } = view.state;
      const d0 = view.state.saved.data;
      // first load with no classes: open the entry form (same as the original effect)
      if (d0 && !view.state.init) {
        view.state.init = true;
        if (d0.classes.length === 0) { view.state.mode = 'enter'; if (!view.state.rows.length) view.state.rows = [blank()]; queueMicrotask(() => view.update()); }
      }
      const has = hasSaved();
      return html`${pageHead(t('My timetable'), t('Save your classes once. The errand planner uses them as deadlines and email reminders tell you which bus to take.'), mode === 'view' && has ? html`<button class="btn secondary" data-click="edit">${t('Edit')}</button>` : '')}
      ${asyncBlock(view.state.saved, 'saved', (d) => html`
        ${mode === 'view' && d.classes.length > 0 ? html`
          ${week(d.classes)}
          <div class="row"><button class="btn sm danger" data-click="delete">${t('Delete my timetable')}</button></div>
          ${widgetHost('remindersCard')}` : ''}
        ${mode === 'enter' ? html`<div class="card stack">
          ${!reviewing ? html`<div class="seg" role="group" aria-label="${t('How to add your classes')}">
            ${[['manual', 'Enter manually'], ['csv', 'CSV'], ['photo', 'Photo / PDF']].map(([k, label]) => html`<button type="button" aria-pressed="${bool(tab === k)}" data-click="tab" data-k="${k}">${t(label)}</button>`)}
          </div>` : ''}
          ${!reviewing && tab !== 'manual' ? html`<p class="small muted">${t('Your file is read once to find your classes and is not kept. Only the classes you confirm are saved.')}</p>` : ''}
          ${!reviewing && tab === 'csv' ? html`<div class="stack-sm">
            <p class="small">${t('Use a CSV file with the columns title,day,start,end,location. In Excel, choose Save As, CSV.')}</p>
            <div class="row"><button type="button" class="btn secondary" data-click="template">${t('Download template')}</button>
              <label class="btn" for="csv-file">${t('Choose CSV file')}</label><input id="csv-file" class="sr-only" type="file" accept=".csv,text/csv" data-change="csv"></div>
          </div>` : ''}
          ${!reviewing && tab === 'photo' ? (ai === false
            ? html`<div class="alert warn" role="status">${t('Reading a photo or PDF needs the AI assistant, which is off on this server. Use the manual or CSV tab instead.')}</div>`
            : html`<div class="stack-sm">
              <p class="small">${t('Upload a clear photo or PDF of your timetable (PNG, JPEG or PDF, up to 5 MB). You will review every row before anything is saved.')}</p>
              <div class="row"><label class="btn" for="photo-file" aria-disabled="${bool(busy)}">${t('Choose file')}</label><input id="photo-file" class="sr-only" type="file" accept="image/png,image/jpeg,application/pdf" data-change="photo" ${busy || ai == null ? 'disabled' : ''}></div>
              ${busy ? loading(t('Reading your timetable… this can take up to a minute')) : ''}
            </div>`) : ''}
          ${errors.length > 0 ? html`<div class="alert error" role="alert"><ul style="margin:0;padding-inline-start:18px">${errors.slice(0, 8).map((e) => html`<li>${e}</li>`)}</ul></div>` : ''}
          ${reviewing || tab === 'manual' ? html`
            ${reviewing ? html`<p class="small">${t('Looks wrong? Edit it before saving. Nothing is saved until you press Save.')}</p>` : ''}
            ${rowsEditor(rows)}
            <div class="row"><button type="button" class="btn secondary" data-click="add-row" ${rows.length >= 60 ? 'disabled' : ''}>${t('Add a class')}</button></div>` : ''}
          ${err ? html`<div class="alert error" role="alert">${err}</div>` : ''}
          <div class="row">
            <button type="button" class="btn" data-click="save" ${busy || rows.length === 0 ? 'disabled' : ''}>${busy ? t('Saving…') : t('Save timetable')}</button>
            ${has ? html`<button type="button" class="btn secondary" data-click="cancel">${t('Cancel')}</button>` : ''}
            ${reviewing ? html`<button type="button" class="btn ghost" data-click="start-over">${t('Start over')}</button>` : ''}
          </div>
        </div>` : ''}
        ${mode === 'view' && d.classes.length === 0 ? empty(t('No timetable yet'), html`<p>${t('Add your classes to get started.')}</p>`) : ''}
      `)}`;
    },
    after: () => syncWidgets(view, WIDGETS),
    actions: {
      edit: () => {
        const cls = view.state.saved.data.classes;
        reset({ rows: cls.map((c) => ({ ...c, location_text: c.location_text ?? '' })), reviewing: true, tab: 'manual', mode: 'enter' });
      },
      tab: (el) => reset({ tab: el.dataset.k }),
      'add-row': () => view.set({ rows: [...view.state.rows, blank()] }),
      'remove-row': (el) => view.set({ rows: view.state.rows.filter((_, j) => j !== Number(el.dataset.i)) }),
      template: () => downloadCsv('timetable-template.csv', 'title,day,start,end,location'),
      csv: async (el) => {
        const f = el.files?.[0]; el.value = '';
        if (!f) return;
        const out = csvToRows(await f.text());
        view.set({ errors: out.errors, err: '' });
        if (out.rows.length) view.set({ rows: out.rows, reviewing: true });
      },
      photo: async (el) => {
        const f = el.files?.[0]; el.value = '';
        if (!f) return;
        view.set({ err: '', errors: [] });
        if (!['image/png', 'image/jpeg', 'application/pdf'].includes(f.type)) return view.set({ err: t('Choose a PNG, JPEG or PDF file.') });
        if (f.size > MAX_FILE) return view.set({ err: t('The file is larger than 5 MB.') });
        view.set({ busy: true });
        try {
          const d = await api.post('/api/student/schedule/parse', { media_type: f.type, data_base64: await toBase64(f) });
          if (!d.rows.length) view.state.err = t('No classes were found in that file. Try a clearer photo or enter them manually.');
          else { view.state.rows = d.rows.map((r) => ({ ...r, location_text: r.location_text ?? '' })); view.state.reviewing = true; }
          if (d.dropped) toast(t('{n} unreadable row(s) were skipped.', { n: d.dropped }), 'error');
        } catch (e) { view.state.err = e.code === 'ai_disabled' ? t('AI is off on this server. Use the manual or CSV tab.') : e.message; } finally { view.set({ busy: false }); }
      },
      save: async () => {
        view.set({ busy: true, err: '' });
        try {
          const d = await api.put('/api/student/schedule', { classes: view.state.rows.map(({ title, day, start, end, location_text, source }) => ({ title, day, start, end, location_text: location_text || null, source })) });
          saved.reload(); view.set({ mode: 'view', reviewing: false, rows: [] }); toast(t('Timetable saved ({n} classes)', { n: d.classes.length }));
        } catch (e) { view.state.err = e.message; } finally { view.set({ busy: false }); }
      },
      cancel: () => reset({ mode: 'view', reviewing: false, rows: [] }),
      'start-over': () => view.set({ reviewing: false, rows: hasSaved() ? [] : [blank()] }),
      delete: () => confirmDialog({
        title: 'Delete timetable', danger: true, confirmLabel: 'Delete', body: t('Delete all your saved classes?'),
        onConfirm: async () => { await api.del('/api/student/schedule'); toast(t('Timetable deleted')); saved.reload(); view.set({ mode: 'enter', rows: [blank()], reviewing: false }); },
      }),
    },
  };
}

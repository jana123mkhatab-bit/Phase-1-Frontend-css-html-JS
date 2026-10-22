import { html, raw, attr, esc } from '../core/dom.js';
import { openModal, field } from '../core/ui.js';
import { t, tn } from '../core/i18n.js';

const isText = (f) => !f.type || ['text', 'textarea', 'email', 'tel'].includes(f.type);
const isNum = (f) => f.type === 'number';

/** Returns an error message for one field, or '' when it is valid. */
export function fieldError(f, val, all) {
  const blank = val === '' || val == null || (typeof val === 'string' && val.trim() === '');
  if (f.type === 'checkbox') return '';
  if (blank) return f.required ? t('{label} is required', { label: f.label }) : '';
  if (isNum(f)) {
    const n = Number(val);
    if (!Number.isFinite(n)) return t('{label} must be a number', { label: f.label });
    if (f.int && !Number.isInteger(n)) return t('{label} must be a whole number', { label: f.label });
    if (f.min != null && n < f.min) return t('{label} must be at least {n}', { label: f.label, n: f.min });
    if (f.max != null && n > f.max) return t('{label} must be at most {n}', { label: f.label, n: f.max });
  }
  if (isText(f) && typeof val === 'string') {
    const v = val.trim();
    if (f.minLength && v.length < f.minLength) return t('{label} must be at least {n} characters', { label: f.label, n: f.minLength });
    if (f.max != null && v.length > f.max) return t('{label} must be at most {n} characters', { label: f.label, n: f.max });
    if (f.pattern && !f.pattern.test(v)) return f.patternMsg || t('{label} is not in the expected format', { label: f.label });
  }
  return f.validate ? f.validate(val, all) || '' : '';
}

/**
 * Generic form dialog with inline, per-field validation.
 * openForm({ title, fields, initial, submitLabel, onSubmit(values), note, validate(values), extra })
 * fields: [{key,label,type,options,hint,required,min,max,int,step,placeholder,pattern,patternMsg,minLength,validate,wide,noBlank,blank}]
 *   - number fields: min/max bound the value, int demands a whole number
 *   - text fields: max is the maximum length
 *   - validate(value, allValues) returns a message for custom rules
 * validate(values) on the form returns { key: message } for cross-field rules.
 * extra(view) may return extra markup placed under the fields; its handlers go in extraActions.
 */
export function openForm({ title, fields, initial = {}, submitLabel, onSubmit, note, validate, extra, extraActions = {} }) {
  return openModal({
    title,
    setup: (view, modal) => {
      view.state.v = Object.fromEntries(fields.map((f) => [f.key, initial[f.key] ?? (f.type === 'checkbox' ? false : f.noBlank ? f.options[0]?.value ?? '' : '')]));
      Object.assign(view.state, { touched: {}, attempted: false, err: '', busy: false });
      modal.canClose = () => !view.state.busy;

      const check = (vals) => {
        const out = {};
        for (const f of fields) { const m = fieldError(f, vals[f.key], vals); if (m) out[f.key] = m; }
        if (validate) for (const [k, m] of Object.entries(validate(vals) || {})) if (m && !out[k]) out[k] = m;
        return out;
      };
      const shown = (errs, k) => ((view.state.touched[k] || view.state.attempted) && errs[k]) || '';

      return {
        render: () => {
          const { v, busy, err } = view.state;
          const errs = check(v);
          const count = view.state.attempted ? Object.values(errs).filter(Boolean).length : 0;
          return html`<form data-submit="submit" class="stack" novalidate id="form-modal">
            ${note ? html`<p class="small muted">${note}</p>` : ''}
            <div class="form-grid">
              ${fields.map((f) => {
                const id = `f-${f.key}`;
                const msg = shown(errs, f.key);
                const aria = raw(`${msg ? 'aria-invalid="true"' : ''} ${msg ? `aria-describedby="${esc(id)}-err"` : ''} ${f.required ? 'aria-required="true"' : ''}`);
                const bindAttr = raw(`data-bind="v.${esc(f.key)}" data-focusout="blur" data-k="${esc(f.key)}"`);
                if (f.type === 'checkbox') {
                  return html`<label class="check" style="align-self:end" data-key="c-${f.key}"><input id="${id}" type="checkbox" data-bind="v.${f.key}" ${v[f.key] ? 'checked' : ''}>${f.label}</label>`;
                }
                let control;
                if (f.type === 'textarea') control = html`<textarea id="${id}" class="input" ${bindAttr} maxlength="${f.max ? f.max * 2 : ''}" ${aria}>${v[f.key]}</textarea>`;
                else if (f.type === 'select' || f.type === 'select-number') {
                  control = html`<select id="${id}" class="input" ${bindAttr} ${aria}>
                    ${!f.noBlank ? html`<option value="" ${v[f.key] === '' || v[f.key] == null ? 'selected' : ''}>${f.blank ?? t('— none —')}</option>` : ''}
                    ${f.options.map((o) => html`<option value="${o.value}" ${String(v[f.key]) === String(o.value) ? 'selected' : ''}>${o.label}</option>`)}
                  </select>`;
                } else {
                  control = html`<input id="${id}" class="input" type="${f.type || 'text'}" value="${v[f.key]}" ${bindAttr}
                    ${isNum(f) && f.min != null ? attr`min="${f.min}"` : ''} ${isNum(f) && f.max != null ? attr`max="${f.max}"` : ''}
                    ${f.step != null || (isNum(f) && f.int) ? attr`step="${f.step ?? 1}"` : ''} ${isNum(f) ? raw('inputmode="decimal"') : ''}
                    ${isText(f) && f.max ? attr`maxlength="${f.max * 2}"` : ''} ${f.placeholder ? attr`placeholder="${f.placeholder}"` : ''} ${aria}>`;
                }
                return html`<div style="${f.wide || f.type === 'textarea' ? 'grid-column:1 / -1' : ''}" data-key="fld-${f.key}">${field({ label: f.label + (f.required ? ' *' : ''), id, hint: f.hint, error: msg }, control)}</div>`;
              })}
            </div>
            ${extra ? extra(view) : ''}
            ${count > 0 ? html`<div class="alert error" role="alert">${t('Please fix {n} before saving.', { n: tn(count, '{n} field', '{n} fields') })}</div>` : ''}
            ${err ? html`<div class="alert error" role="alert">${err}</div>` : ''}
            <div class="foot">
              <button type="button" class="btn secondary" data-click="cancel" ${busy ? 'disabled' : ''}>${t('Cancel')}</button>
              <button class="btn" ${busy ? 'disabled' : ''}>${busy ? t('Saving…') : submitLabel ?? t('Save')}</button>
            </div>
          </form>`;
        },
        actions: {
          ...extraActions,
          cancel: () => modal.close(),
          blur: (el) => { view.state.touched[el.dataset.k] = true; view.update(); },
          submit: async () => {
            const { v } = view.state;
            view.state.err = '';
            view.state.attempted = true;
            const found = check(v);
            const firstBad = fields.find((f) => found[f.key]);
            if (firstBad) { view.flush(); view.$(`#f-${firstBad.key}`)?.focus(); return; }
            const out = {};
            for (const f of fields) {
              let x = v[f.key];
              if (f.type === 'number' || f.type === 'select-number') x = x === '' || x == null ? null : Number(x);
              else if (typeof x === 'string' && isText(f)) x = x.trim();
              out[f.key] = x;
            }
            view.set({ busy: true });
            try { await onSubmit(out); modal.close(); } catch (e2) { view.set({ err: e2.message, busy: false }); }
          },
        },
      };
    },
  });
}

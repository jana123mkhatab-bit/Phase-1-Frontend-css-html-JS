import { html } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { fmtTime } from '../core/format.js';
import { t, getLang } from '../core/i18n.js';

const pn = (p) => (getLang() === 'ar' && p.name_ar ? p.name_ar : p.name_en);
const MODE = { walk: 'Walk', bus: 'Bus', taxi: 'Taxi', transit: 'Public transport', car: 'Car' };
const modeLabel = (m) => t(MODE[m] ?? 'Unknown');
const fmtRange = (r) => (!r?.[0] ? '—' : r[1] ? `${fmtTime(r[0])} – ${fmtTime(r[1])}` : `${fmtTime(r[0])} –`);
const mins = (a, b) => (a === b ? t('{n} min', { n: a }) : t('{a}–{b} min', { a, b }));
const money = (c) => (c[1] === 0 ? t('Free') : c[0] === c[1] ? t('{a} EGP', { a: c[0] }) : t('{a}–{b} EGP', { a: c[0], b: c[1] }));
const ic = (m) => icon(m === 'walk' ? 'walk' : m, 14);

/** A horizontal range bar: where this step falls inside the whole plan. Decorative; the text beside it says the same. */
function rangeBar(from, to, total) {
  if (!total || !from || !to) return '';
  const left = Math.max(0, ((new Date(from[0]) - total[0]) / (total[1] - total[0])) * 100);
  const right = Math.min(100, ((new Date(to[1] ?? to[0]) - total[0]) / (total[1] - total[0])) * 100);
  return html`<span class="tl-bar" aria-hidden="true"><i style="inset-inline-start:${left}%;width:${Math.max(2, right - left)}%"></i></span>`;
}

/** University buses that pass near an outside stop. */
function campusBuses(stop) {
  const list = stop.campus_buses;
  if (stop.place.area === 'campus') return '';
  return html`<div class="tl-buses stack-sm">
    <b class="small">${icon('bus', 14)} ${t('University buses you can take here')}</b>
    ${list?.length ? html`<ul>${list.map((x) => html`<li><a class="bus-link" href="#/student/track?trip=${x.trip_id}" title="${t('Track this bus')}"><b class="mono">${t('Bus {n}', { n: x.bus_number })}</b> · ${x.route_code} ${x.route_name} <span class="badge ${x.direction === 'to_campus' ? 'sky' : ''}">${x.direction === 'to_campus' ? t('To university') : t('From university')}</span>
      <span class="small muted">${t('{time} at {stop} ({n} min walk)', { time: fmtTime(x.at), stop: x.stop_name, n: x.walk_min })} · ${t(x.label)}</span> <span class="small">${t('Track')} →</span></a></li>`)}</ul>`
      : html`<p class="small muted" style="margin:0">${t('No university bus passes close to this place today.')}</p>`}
  </div>`;
}

function backups(stop, open) {
  const b = stop.backups;
  if (!b || (!b.modes?.length && !b.places?.length && !b.buses?.length)) return '';
  return html`<div class="tl-backups">
    <button type="button" class="btn sm ghost" aria-expanded="${String(open)}" data-click="toggle-backup" data-i="${stop.index}">${t('Backup options')}</button>
    ${open ? html`<div class="stack-sm">
      ${b.modes?.length > 1 ? html`<div><b>${t('Other ways to get there')}</b><ul>${b.modes.map((m) => html`<li>${modeLabel(m.mode)}: ${mins(m.minutes_min, m.minutes_max)} <span class="small muted">(${t(m.basis)})</span></li>`)}</ul></div>` : ''}
      ${b.places?.length > 0 ? html`<div><b>${t('Other places that are open')}</b><ul>${b.places.map((p) => html`<li>${pn(p.place)}${p.rough_minutes != null ? html`<span class="small muted"> · ${t('about {n} min away', { n: p.rough_minutes })}</span>` : ''} <button type="button" class="btn sm secondary" data-click="swap-place" data-i="${stop.index}" data-place="${p.place.id}">${t('Use this instead')}</button></li>`)}</ul></div>` : ''}
      ${b.buses?.length > 0 ? html`<div><b>${t('Next buses')}</b><ul>${b.buses.map((x) => html`<li>${t('Bus {n}', { n: x.bus_number })} · ${fmtTime(x.board_at)} <span class="small muted">(${t(x.label)})</span></li>`)}</ul></div>` : ''}
    </div>` : ''}
  </div>`;
}

/**
 * Vertical timeline of legs, stops and locked classes. Every time is a range with its basis.
 * Interactions are reported as data-click actions on the page: set-mode (data-i, data-mode), toggle-backup, swap-place.
 */
export function timeline(plan, openBackups = new Set()) {
  const all = [new Date(plan.start_at).getTime(), new Date(plan.finish_range?.[1] ?? plan.finish_range?.[0] ?? plan.start_at).getTime()];
  const total = all[1] > all[0] ? all : null;
  const nextClass = plan.fixed_blocks.find((b) => new Date(b.start_iso) > new Date(plan.start_at));
  const items = [];
  plan.legs.forEach((leg, i) => {
    const stop = plan.stops[i];
    items.push({ at: new Date(leg.start_range?.[0] ?? plan.start_at).getTime(), key: `l${i}`, node: html`
      <li class="tl-leg">
        <span class="tl-ico">${icon(leg.mode === 'walk' ? 'walk' : leg.mode ?? 'alert', 18)}</span>
        <div class="tl-body">
          ${leg.estimable === false ? html`<b>${t('Cannot estimate the way to {name}', { name: pn(leg.to) })}</b>` : html`
            <div class="tl-leg-head"><b>${modeLabel(leg.mode)}</b><span class="tl-dur">${mins(leg.minutes_min, leg.minutes_max)}</span>
              ${leg.cost ? html`<span class="badge ${leg.cost[1] === 0 ? 'live' : 'navy'}">${money(leg.cost)}</span>` : ''}</div>
            <div class="small muted">${t('Leave {a}, arrive {b}', { a: fmtRange(leg.start_range), b: fmtRange(leg.end_range) })} · ${t(leg.basis)}</div>
            ${rangeBar(leg.start_range, leg.end_range, total)}
            ${leg.options.length > 1 ? html`<div class="seg tl-modes" role="group" aria-label="${t('Way to get to {name}', { name: pn(leg.to) })}">
              ${leg.options.map((o) => html`<button type="button" aria-pressed="${String(o.mode === leg.mode)}" data-click="set-mode" data-i="${i}" data-mode="${o.mode}">
                ${ic(o.mode)} ${modeLabel(o.mode)} · ${mins(o.minutes_min, o.minutes_max)}${o.cost && o.cost[1] > 0 ? ` · ${money(o.cost)}` : ''}
              </button>`)}
            </div>` : ''}`}
        </div>
      </li>` });
    if (stop?.is_return && stop.estimable !== false) {
      items.push({ at: new Date(stop.arrive_range[0]).getTime() + 1, key: `s${i}`, node: html`
        <li class="tl-stop tl-return">
          <span class="tl-ico solid">${icon('flag', 18)}</span>
          <div class="tl-body">
            <div class="tl-stop-head"><b>${t('Back at {name}', { name: pn(stop.place.id === 'campus' ? { name_en: 'campus', name_ar: 'الجامعة' } : stop.place) })}</b></div>
            <dl class="tl-times tl-times-1"><div><dt>${t('Arrive')}</dt><dd>${fmtRange(stop.arrive_range)}</dd></div></dl>
          </div>
        </li>` });
    } else if (stop?.estimable !== false && stop) {
      items.push({ at: new Date(stop.arrive_range[0]).getTime() + 1, key: `s${i}`, node: html`
        <li class="tl-stop">
          <span class="tl-ico solid">${icon('pin', 18)}</span>
          <div class="tl-body">
            <div class="tl-stop-head"><b>${i + 1}. ${pn(stop.place)}</b><span class="badge ${stop.place.area === 'campus' ? 'sky' : 'navy'}">${stop.place.area === 'campus' ? t('On campus') : t('Outside campus')}</span></div>
            <dl class="tl-times">
              <div><dt>${t('Arrive')}</dt><dd>${fmtRange(stop.arrive_range)}</dd></div>
              <div><dt>${t('Stay')}</dt><dd>${t('{n} min', { n: stop.stay_min })}</dd></div>
              <div><dt>${t('Leave')}</dt><dd>${fmtRange(stop.leave_range)}</dd></div>
            </dl>
            ${stop.wait_min > 0 ? html`<span class="badge warn">${icon('clock', 14)} ${t('Wait about {n} min until it opens', { n: stop.wait_min })}</span>` : ''}
            ${stop.status !== 'ok' ? html`<span class="badge crit">${stop.status === 'late' ? t('Cannot arrive by {t}', { t: stop.arrive_by }) : t('Arriving by {t} is not certain', { t: stop.arrive_by })}</span>` : ''}
            ${campusBuses(stop)}
            ${backups(stop, openBackups.has(stop.index))}
          </div>
        </li>` });
    }
  });
  plan.fixed_blocks.forEach((b) => items.push({ at: new Date(b.start_iso).getTime(), key: `c${b.start}${b.title}`, node: html`
    <li class="tl-class ${b === nextClass ? 'next' : ''}">
      <span class="tl-ico">${icon('lock', 18)}</span>
      <div class="tl-body"><b>${t('Class')}: ${b.title}</b> ${b === nextClass ? html`<span class="badge warn">${t('Next class')}</span>` : ''}<div class="small"><span dir="ltr">${b.start}–${b.end}</span>${b.location_text ? ` · ${b.location_text}` : ''}</div></div>
    </li>` }));
  items.sort((a, b) => a.at - b.at);
  return html`<ol class="timeline" aria-label="${t('Your plan, step by step')}">
    <li class="tl-start"><span class="tl-ico solid">${icon('home', 18)}</span><div class="tl-body"><div class="tl-stop-head"><b>${t('Start')}: ${pn(plan.origin)}</b><span class="small muted">${fmtTime(plan.start_at)}</span></div></div></li>
    ${items.map((x) => x.node)}
  </ol>`;
}

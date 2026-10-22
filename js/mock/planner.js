// Pure errand feasibility engine. No database, no clock, no model: the same input always gives the same output.
// Every time is a RANGE (best case .. worst case). Walking, bus and car legs each have their own uncertainty.
import { hoursAt, hm } from './places.js';

export const UNCERTAINTY = { walk: 0.10, bus_live: 0.15, bus_scheduled: 0.25, taxi: 0.35, car: 0.35, transit: 0.40 };
/** When no way is chosen, every 10 EGP counts as this many minutes, so a free bus beats a taxi that is only a little faster. */
export const COST_MIN_PER_EGP = 0.2;
const MIN = 60000;
const RANK = { feasible: 3, tight: 2, no_deadline: 1, unknown: 0, closed: 0, not_feasible: 0 };
const costPenaltyMin = (o) => (o.cost ? ((o.cost[0] + o.cost[1]) / 2) * COST_MIN_PER_EGP : 0);

/**
 * getLeg(from, to, atMs) -> options [{ mode, nominal_min, factor_key, not_before?, basis, cost?, estimable?, warnings?, meta? }]
 * An option with estimable === false means "cannot be estimated"; the plan says so instead of guessing.
 * Stops may carry is_return: the last "stop" that takes the student back to where the day continues (no stay, no opening hours).
 */
function simulate({ startAt, origin, stops, getLeg, uncertainty, chosenModes }) {
  let best = startAt; let worst = startAt; let prev = origin;
  const legs = []; const rows = []; const warnings = []; let unknown = false; let blocked = false; let risky = false;
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    const name = s.place.name_en;
    const optsB = getLeg(prev, s.place, best) ?? [];
    // Default way = earliest arrival when things go slowly (a shaky estimate must not win), plus a small price for money so a free bus beats a slightly faster taxi.
    const price = (o, cur) => Math.max(cur, o.not_before ?? cur) + (o.nominal_min * (1 + (uncertainty[o.factor_key] ?? 0)) + costPenaltyMin(o)) * MIN;
    const usable = optsB.filter((o) => o.estimable !== false);
    let pick;
    if (chosenModes?.[i]) pick = usable.find((o) => o.mode === chosenModes[i]);
    if (!pick) {
      // Nobody is assumed to own a car: it is offered as a choice, never picked by default.
      const pool = usable.filter((o) => o.mode !== 'car');
      pick = [...(pool.length ? pool : usable)].sort((a, b) => price(a, best) - price(b, best))[0];
    }
    if (!pick) {
      unknown = true;
      const why = optsB.flatMap((o) => o.warnings ?? [])[0] ?? 'No way to estimate this leg';
      warnings.push({ code: 'cannot_estimate', leg: i, place: name, text: `Cannot estimate the trip to ${name}: ${why}` });
      legs.push({ index: i, from: prev, to: s.place, mode: null, estimable: false, options: [] });
      rows.push({ index: i, place: s.place, estimable: false });
      break;
    }
    const f = uncertainty[pick.factor_key] ?? 0;
    const startB = Math.max(best, pick.not_before ?? best);
    const endB = startB + pick.nominal_min * (1 - f) * MIN;
    const optW = (getLeg(prev, s.place, worst) ?? []).find((o) => o.mode === pick.mode && o.estimable !== false);
    let startW = Infinity; let endW = Infinity;
    if (optW) {
      startW = Math.max(worst, optW.not_before ?? worst);
      endW = startW + optW.nominal_min * (1 + (uncertainty[optW.factor_key] ?? f)) * MIN;
    } else {
      warnings.push({ code: 'no_later_option', leg: i, place: name, text: `No ${pick.mode} option is left if you run late for ${name}` });
    }
    const stay = Math.max(0, Number(s.stay_min) || 0);
    for (const w of pick.warnings ?? []) warnings.push({ code: 'leg_warning', leg: i, place: name, text: w });

    // Opening hours: wait for a place that has not opened yet; flag one that is closed, or that closes before the visit is over.
    const serve = (arrive) => {
      if (!Number.isFinite(arrive)) return { start: Infinity, state: 'unknown' };
      const h = hoursAt(s.place, arrive);
      if (h.closedAllDay) return { start: arrive, state: 'closed_today' };
      if (h.open) return { start: arrive, state: h.closesAt && arrive + stay * MIN > h.closesAt ? 'closes_early' : 'ok', closesAt: h.closesAt };
      if (h.opensAt) return { start: h.opensAt, state: 'wait', opensAt: h.opensAt };
      return { start: arrive, state: 'closed_now' };
    };
    const sB = serve(endB); const sW = serve(endW);
    const shut = (x) => x.state === 'closed_today' || x.state === 'closed_now';
    if (sB.state === 'closed_today') warnings.push({ code: 'closed', leg: i, place: name, text: `${name} is closed today.` });
    else if (sB.state === 'closed_now') warnings.push({ code: 'closed', leg: i, place: name, text: `${name} is closed when you would arrive.` });
    else if (sB.state === 'wait') warnings.push({ code: 'waits_for_opening', leg: i, place: name, text: `${name} opens at ${hm(sB.opensAt)}, so you would wait about ${Math.round((sB.start - endB) / MIN)} min.` });
    else if (sB.state === 'closes_early') warnings.push({ code: 'closes_early', leg: i, place: name, text: `${name} closes at ${hm(sB.closesAt)}, before you would finish.` });
    if (!shut(sB) && (shut(sW) || (sW.state === 'closes_early' && sB.state !== 'closes_early'))) warnings.push({ code: 'may_be_closed', leg: i, place: name, text: `${name} may be closed when you arrive.` });
    if (shut(sB)) blocked = true;
    else if (sB.state === 'closes_early' || shut(sW) || sW.state === 'closes_early') risky = true;

    const leaveB = sB.start + stay * MIN; const leaveW = sW.start + stay * MIN;
    let stopStatus = 'ok';
    if (s.arrive_by != null) {
      if (endB > s.arrive_by) stopStatus = 'late';
      else if (endW > s.arrive_by) stopStatus = 'tight';
      if (stopStatus !== 'ok') warnings.push({ code: `arrive_by_${stopStatus}`, leg: i, place: name, text: stopStatus === 'late' ? `You cannot reach ${name} by ${hm(s.arrive_by)}.` : `Reaching ${name} by ${hm(s.arrive_by)} is not certain.` });
    }
    legs.push({
      index: i, from: prev, to: s.place, mode: pick.mode, estimable: true, basis: pick.basis, factor_key: pick.factor_key, uncertainty_pct: Math.round(f * 100),
      nominal_min: pick.nominal_min, minutes_min: pick.nominal_min * (1 - f), minutes_max: pick.nominal_min * (1 + (optW ? uncertainty[optW.factor_key] ?? f : f)),
      start_range: [startB, startW], end_range: [endB, endW], meta: pick.meta ?? null, cost: pick.cost ?? null,
      options: usable.map((o) => ({ mode: o.mode, nominal_min: o.nominal_min, minutes_min: o.nominal_min * (1 - (uncertainty[o.factor_key] ?? 0)), minutes_max: o.nominal_min * (1 + (uncertainty[o.factor_key] ?? 0)), basis: o.basis, cost: o.cost ?? null, meta: o.meta ?? null })),
    });
    rows.push({
      index: i, place: s.place, stay_min: stay, arrive_by: s.arrive_by ?? null, arrive_range: [endB, endW], leave_range: [leaveB, leaveW], status: stopStatus,
      is_return: !!s.is_return, wait_min: sB.state === 'wait' ? Math.round((sB.start - endB) / MIN) : 0,
      open_at_arrival: !shut(sB) && !shut(sW) && sB.state !== 'wait' && sW.state !== 'wait',
    });
    best = leaveB; worst = leaveW; prev = s.place;
  }
  return { legs, rows, warnings, unknown, blocked, risky, finish: [best, worst] };
}

function verdictOf(sim, finishBy, hasConflict) {
  if (sim.unknown) return 'unknown';
  if (sim.blocked) return 'closed';
  let v;
  if (finishBy == null) return 'no_deadline';
  if (sim.finish[1] <= finishBy) v = 'feasible';
  else if (sim.finish[0] <= finishBy) v = 'tight';
  else v = 'not_feasible';
  // A place that might shut, or a class that overlaps the plan, means you cannot be sure.
  if (v === 'feasible' && (sim.risky || hasConflict)) v = 'tight';
  return v;
}

/**
 * planErrands({ now, startAt, origin, stops, getLeg, finishBy, uncertainty, fixedBlocks, chosenModes, bufferMin, endPlace, suggest })
 * Times are epoch ms. stops: [{ place, stay_min, arrive_by? }]. fixedBlocks: [{ title, start, end }] (class sessions).
 * endPlace (optional): where the student must be at the end (for example back on campus for the next class). The trip there is
 * part of the plan, so the deadline is judged on arrival there, not on leaving the last stop.
 */
export function planErrands(input) {
  const { now, origin, stops, getLeg, uncertainty = UNCERTAINTY, fixedBlocks = [], chosenModes = [], bufferMin = 10, endPlace = null, suggest = true } = input;
  const startAt = Math.max(input.startAt ?? now, now);
  let finishBy = input.finishBy ?? null;
  let finishSource = finishBy != null ? 'user' : null;
  const sortedBlocks = [...fixedBlocks].sort((a, b) => a.start - b.start);
  const nextClass = sortedBlocks.find((b) => b.start > startAt);
  if (finishBy == null && nextClass) { finishBy = nextClass.start - bufferMin * MIN; finishSource = 'class'; }

  const route = endPlace ? [...stops, { place: endPlace, stay_min: 0, is_return: true }] : stops;
  const sim = simulate({ startAt, origin, stops: route, getLeg, uncertainty, chosenModes });

  const windowEnd = Number.isFinite(sim.finish[1]) ? sim.finish[1] : sim.finish[0];
  // Classes that fall inside the plan window; the class used as the deadline is judged by the verdict instead.
  const conflicts = sortedBlocks.filter((b) => b.start < windowEnd && b.end > startAt && !(finishSource === 'class' && b === nextClass));
  const verdict = verdictOf(sim, finishBy, conflicts.length > 0);

  // Latest start whose worst case still meets the deadline (monotone, so a binary search over whole minutes).
  let leaveBy = null;
  if (finishBy != null && !sim.unknown && !sim.blocked && route.length) {
    const ok = (s) => simulate({ startAt: s, origin, stops: route, getLeg, uncertainty, chosenModes }).finish[1] <= finishBy;
    let lo = Math.floor((finishBy - 8 * 60 * MIN) / MIN); let hi = Math.floor(finishBy / MIN);
    if (ok(lo * MIN)) {
      while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (ok(mid * MIN)) lo = mid; else hi = mid - 1; }
      leaveBy = lo * MIN;
    }
  }
  const slackMin = finishBy != null && !sim.unknown && Number.isFinite(sim.finish[1]) ? Math.floor((finishBy - sim.finish[1]) / MIN) : null;

  let suggestions = [];
  if (suggest && finishBy != null && verdict !== 'feasible' && stops.length > 1) {
    for (let i = 0; i < stops.length; i++) {
      const rest = stops.filter((_, j) => j !== i);
      const alt = planErrands({ ...input, stops: rest, chosenModes: [], suggest: false });
      if (RANK[alt.verdict] > RANK[verdict] && (alt.verdict === 'feasible' || alt.verdict === 'tight')) suggestions.push({ drop_index: i, place: stops[i].place, resulting_verdict: alt.verdict });
    }
    suggestions = suggestions.sort((a, b) => RANK[b.resulting_verdict] - RANK[a.resulting_verdict] || a.drop_index - b.drop_index).slice(0, 3);
  }

  const priced = sim.legs.filter((l) => l.cost);
  return {
    verdict, start_at: startAt, finish_by: finishBy, finish_source: finishSource, leave_by: leaveBy, slack_min: slackMin,
    finish_range: sim.unknown ? null : sim.finish, legs: sim.legs, stops: sim.rows, warnings: sim.warnings, suggestions, conflicts,
    cost_range: priced.length ? [priced.reduce((a, l) => a + l.cost[0], 0), priced.reduce((a, l) => a + l.cost[1], 0)] : null,
    basis_notes: Object.entries(uncertainty).map(([key, f]) => ({ key, pct: Math.round(f * 100) })),
  };
}

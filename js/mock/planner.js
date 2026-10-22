// Pure errand feasibility engine. No database, no clock, no model: the same input always gives the same output.
// Every time is a RANGE (best case .. worst case). Walking, bus and car legs each have their own uncertainty.
import { isOpenAt, hm } from './places.js';

export const UNCERTAINTY = { walk: 0.10, bus_live: 0.15, bus_scheduled: 0.25, taxi: 0.35, car: 0.35, transit: 0.40 };
const MIN = 60000;
const RANK = { feasible: 3, tight: 2, no_deadline: 1, unknown: 0, not_feasible: 0 };

/**
 * getLeg(from, to, atMs) -> options [{ mode, nominal_min, factor_key, not_before?, basis, estimable?, warnings?, meta? }]
 * An option with estimable === false means "cannot be estimated"; the plan says so instead of guessing.
 */
function simulate({ startAt, origin, stops, getLeg, uncertainty, chosenModes }) {
  let best = startAt; let worst = startAt; let prev = origin;
  const legs = []; const rows = []; const warnings = []; let unknown = false;
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    const optsB = getLeg(prev, s.place, best) ?? [];
    const price = (o, cur) => Math.max(cur, o.not_before ?? cur) + o.nominal_min * (1 - (uncertainty[o.factor_key] ?? 0)) * MIN;
    const usable = optsB.filter((o) => o.estimable !== false);
    let pick;
    if (chosenModes?.[i]) pick = usable.find((o) => o.mode === chosenModes[i]);
    if (!pick) pick = [...usable].sort((a, b) => price(a, best) - price(b, best))[0];
    if (!pick) {
      unknown = true;
      const why = optsB.flatMap((o) => o.warnings ?? [])[0] ?? 'No way to estimate this leg';
      warnings.push({ code: 'cannot_estimate', leg: i, place: s.place.name_en, text: `Cannot estimate the trip to ${s.place.name_en}: ${why}` });
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
      warnings.push({ code: 'no_later_option', leg: i, place: s.place.name_en, text: `No ${pick.mode} option is left if you run late for ${s.place.name_en}` });
    }
    const stay = Math.max(0, Number(s.stay_min) || 0);
    const leaveB = endB + stay * MIN; const leaveW = endW + stay * MIN;
    for (const w of pick.warnings ?? []) warnings.push({ code: 'leg_warning', leg: i, place: s.place.name_en, text: w });
    const openB = isOpenAt(s.place, endB); const openW = Number.isFinite(endW) ? isOpenAt(s.place, endW) : true;
    if (!openB || !openW) warnings.push({ code: openB || openW ? 'may_be_closed' : 'closed', leg: i, place: s.place.name_en, text: openB || openW ? `${s.place.name_en} may be closed when you arrive.` : `${s.place.name_en} is closed when you would arrive.` });
    let stopStatus = 'ok';
    if (s.arrive_by != null) {
      if (endB > s.arrive_by) stopStatus = 'late';
      else if (endW > s.arrive_by) stopStatus = 'tight';
      if (stopStatus !== 'ok') warnings.push({ code: `arrive_by_${stopStatus}`, leg: i, place: s.place.name_en, text: stopStatus === 'late' ? `You cannot reach ${s.place.name_en} by ${hm(s.arrive_by)}.` : `Reaching ${s.place.name_en} by ${hm(s.arrive_by)} is not certain.` });
    }
    legs.push({
      index: i, from: prev, to: s.place, mode: pick.mode, estimable: true, basis: pick.basis, factor_key: pick.factor_key, uncertainty_pct: Math.round(f * 100),
      nominal_min: pick.nominal_min, minutes_min: pick.nominal_min * (1 - f), minutes_max: pick.nominal_min * (1 + (optW ? uncertainty[optW.factor_key] ?? f : f)),
      start_range: [startB, startW], end_range: [endB, endW], meta: pick.meta ?? null, cost: pick.cost ?? null,
      options: usable.map((o) => ({ mode: o.mode, nominal_min: o.nominal_min, minutes_min: o.nominal_min * (1 - (uncertainty[o.factor_key] ?? 0)), minutes_max: o.nominal_min * (1 + (uncertainty[o.factor_key] ?? 0)), basis: o.basis, cost: o.cost ?? null, meta: o.meta ?? null })),
    });
    rows.push({ index: i, place: s.place, stay_min: stay, arrive_by: s.arrive_by ?? null, arrive_range: [endB, endW], leave_range: [leaveB, leaveW], status: stopStatus, open_at_arrival: openB && openW });
    best = leaveB; worst = leaveW; prev = s.place;
  }
  return { legs, rows, warnings, unknown, finish: [best, worst] };
}

const verdictOf = (sim, finishBy) => {
  if (sim.unknown) return 'unknown';
  if (finishBy == null) return 'no_deadline';
  if (sim.finish[1] <= finishBy) return 'feasible';
  if (sim.finish[0] <= finishBy) return 'tight';
  return 'not_feasible';
};

/**
 * planErrands({ now, startAt, origin, stops, getLeg, finishBy, uncertainty, fixedBlocks, chosenModes, bufferMin, suggest })
 * Times are epoch ms. stops: [{ place, stay_min, arrive_by? }]. fixedBlocks: [{ title, start, end }] (class sessions).
 */
export function planErrands(input) {
  const { now, origin, stops, getLeg, uncertainty = UNCERTAINTY, fixedBlocks = [], chosenModes = [], bufferMin = 10, suggest = true } = input;
  const startAt = Math.max(input.startAt ?? now, now);
  let finishBy = input.finishBy ?? null;
  let finishSource = finishBy != null ? 'user' : null;
  const sortedBlocks = [...fixedBlocks].sort((a, b) => a.start - b.start);
  const nextClass = sortedBlocks.find((b) => b.start > startAt);
  if (finishBy == null && nextClass) { finishBy = nextClass.start - bufferMin * MIN; finishSource = 'class'; }

  const sim = simulate({ startAt, origin, stops, getLeg, uncertainty, chosenModes });
  const verdict = verdictOf(sim, finishBy);

  // Latest start whose worst case still meets the deadline (monotone, so a binary search over whole minutes).
  let leaveBy = null;
  if (finishBy != null && !sim.unknown && stops.length) {
    const ok = (s) => simulate({ startAt: s, origin, stops, getLeg, uncertainty, chosenModes }).finish[1] <= finishBy;
    let lo = Math.floor((finishBy - 8 * 60 * MIN) / MIN); let hi = Math.floor(finishBy / MIN);
    if (ok(lo * MIN)) {
      while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (ok(mid * MIN)) lo = mid; else hi = mid - 1; }
      leaveBy = lo * MIN;
    }
  }

  const windowEnd = Number.isFinite(sim.finish[1]) ? sim.finish[1] : sim.finish[0];
  // Classes that fall inside the plan window; the class used as the deadline is judged by the verdict instead.
  const conflicts = sortedBlocks.filter((b) => b.start < windowEnd && b.end > startAt && !(finishSource === 'class' && b === nextClass));

  let suggestions = [];
  if (suggest && finishBy != null && verdict !== 'feasible' && stops.length > 1) {
    for (let i = 0; i < stops.length; i++) {
      const rest = stops.filter((_, j) => j !== i);
      const alt = planErrands({ ...input, stops: rest, chosenModes: [], suggest: false });
      if (RANK[alt.verdict] > RANK[verdict] && (alt.verdict === 'feasible' || alt.verdict === 'tight')) suggestions.push({ drop_index: i, place: stops[i].place, resulting_verdict: alt.verdict });
    }
    suggestions = suggestions.sort((a, b) => RANK[b.resulting_verdict] - RANK[a.resulting_verdict] || a.drop_index - b.drop_index).slice(0, 3);
  }

  return {
    verdict, start_at: startAt, finish_by: finishBy, finish_source: finishSource, leave_by: leaveBy,
    finish_range: sim.unknown ? null : sim.finish, legs: sim.legs, stops: sim.rows, warnings: sim.warnings, suggestions, conflicts,
    basis_notes: Object.entries(uncertainty).map(([key, f]) => ({ key, pct: Math.round(f * 100) })),
  };
}

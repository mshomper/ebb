// @ts-check
// The set-piece runner (docs/future/14, "How it runs"): written set pieces, each a recipe in
// recipes/setpieces/<id>.json, played out over game days in the hourly tick. Pure and worker-safe,
// so an hour watched, a save and reload, and a catch-up all play the same beats in the same order.
//
//   Trigger   named checks (TRIGGERS) on the world state: a season and year, a condition the live
//             game reported, a seeded day of the season. True: the set piece arms.
//   Beats     the recipe's beats, flattened into steps (a beat with `repeat` gives that many). Each
//             falls `afterDays` game days after the step before (a number, or [min, max] seeded),
//             at its hour of day (`at`: dawn, dusk or any; dawn and dusk follow the season's day
//             length), once its `waitFor` check is true. `presence`: only in an hour you are on the
//             island (env.away is set by catch-up), so nothing big happens behind your back; it
//             waits, armed, for the next fitting hour you are there.
//   Choices   live play records small notes (addNote): the next hour's tick applies them, in order,
//             through the set piece's hooks (hooks.js), as the hen's trust does. Conditions the
//             tick cannot see (the camp has stores) come the same way, as `cond` notes.
//   Lasting   whatever a set piece's hooks write in its run's `data` stays after it ends.
//
// Spacing (recipes/world/setpieces.json): one set piece at a time, gapDays of rest after each, big
// ones bigGapDays apart and at most firstYearMax big ones in the island's first year. Events:
// setpiece:arm, :warn, :beat, :choice and :end, each with { id }. State (world.setpieces, well
// under 1 KB a set piece):
//   { runs: { <id>: Run }, count: { <id>: n }, conds: { <name>: value }, endedAt?, bigEndedAt?,
//     bigCount?, pending?: Note[] }

import { HOURS_PER_DAY } from '../../core/clock.js';
import { hash32 } from '../../core/rng.js';
import { HOOKS } from './hooks.js';

/**
 * @typedef {{ id: string, at?: 'dawn' | 'dusk' | 'any', afterDays?: number | [number, number], presence?: boolean,
 *   waitFor?: string, repeat?: number, warn?: boolean, line?: string }} Beat
 * @typedef {{ beat: number, rep: number, def: Beat }} Step
 * @typedef {{ id: string, n: number, armed: number, start?: number, step: number, fell: number[], done?: number,
 *   season?: number, data: Record<string, any>, log: { kind: string, hour: number }[] }} Run
 *   n: which run of this set piece (0 the first); armed: the hour it armed; start: the hour its first
 *   step fell; step: the next step to fall; fell: the hour each step fell; season: the season it ran in
 *   (year * 4 + index); log: the choices applied, kept short
 * @typedef {{ id: string, kind: string, hour: number, [k: string]: any }} Note
 */

/** The most choices a run keeps in its log. */
const LOG_CAP = 24;

/** The steps of a set piece: its beats, a beat with `repeat` given that many times. @param {any} R @returns {Step[]} */
export function stepsOf(R) {
  /** @type {Step[]} */ const out = [];
  (R.beats ?? []).forEach((/** @type {Beat} */ def, /** @type {number} */ beat) => {
    for (let rep = 0; rep < Math.max(1, def.repeat ?? 1); rep++) out.push({ beat, rep, def });
  });
  return out;
}

/** The season as one number (year * 4 + index). @param {any} state */
export const seasonKey = (state) => (state?.seasons?.year ?? 0) * 4 + (state?.seasons?.index ?? 0);

/**
 * The hour of the day dawn and dusk fall in today, from the season's day length.
 * @param {any} state @returns {{ dawn: number, dusk: number }}
 */
export function dawnDusk(state) {
  const L = state?.seasons?.dayLengthH ?? 12;
  return { dawn: Math.round(12 - L / 2), dusk: Math.round(12 + L / 2) };
}

/** A seeded share 0..1. @param {number} seed @param {...number} k */
const u01 = (seed, ...k) => (hash32(seed, ...k) >>> 8) / 16777216;

/** A seeded whole number from a number or a [min, max] range. @param {number | [number, number] | undefined} v @param {number} seed @param {...number} k */
export function pick(v, seed, ...k) {
  if (Array.isArray(v)) return v[0] + Math.floor(u01(seed, ...k) * (v[1] - v[0] + 1));
  return v ?? 0;
}

/** A set piece's id as a number for hashing. @param {string} id */
const idNum = (id) => { let h = 0; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0; return h; };

/**
 * Trigger checks, named in a recipe's `trigger` (all of `all` must hold). Each reads the world
 * state, the hour and the set pieces' own state; none changes anything.
 * @type {Record<string, (a: any, c: { state: any, sp: any, hour: number, seed: number, id: string }) => boolean>}
 */
export const TRIGGERS = {
  /** The season is `season` (0 spring to 3 winter) in year `minYear` or later. */
  season: (a, c) => (c.state?.seasons?.index ?? 0) === a.season && (c.state?.seasons?.year ?? 0) >= (a.minYear ?? 0),
  /** A condition the live game reported (a `cond` note) is true. */
  cond: (a, c) => !!c.sp.conds?.[a.name],
  /** The island is at least `days` game days old. */
  age: (a, c) => c.hour >= (a.days ?? 0) * HOURS_PER_DAY,
  /** On or after a seeded day of the season: from `minDay`, up to `spanDays` later (each season its own). */
  seasonDay: (a, c) => (c.state?.seasons?.day ?? 0) >= (a.minDay ?? 0) + Math.floor(u01(c.seed, idNum(c.id), seasonKey(c.state)) * (a.spanDays ?? 1)),
};

/** Does a set piece's trigger hold now? @param {any} R @param {any} c */
function triggered(R, c) {
  const T = R.trigger ?? {};
  const all = T.all ?? [T];
  const any = T.any ?? null;
  const ok = all.every((/** @type {any} */ t) => !t.check || !!TRIGGERS[t.check]?.(t, c));
  return ok && (!any || any.some((/** @type {any} */ t) => !!TRIGGERS[t.check]?.(t, c)));
}

/** A new, empty set-piece state. */
export const emptySetpieces = () => ({ runs: {}, count: {}, conds: {} });

/** The set pieces' state of a world state, made if missing (older saves). @param {any} state */
export const setpiecesOf = (state) => state?.setpieces ?? emptySetpieces();

/**
 * Record a note for the next hourly tick to apply. Pure: a new world state.
 * @param {any} state @param {Note} note
 */
export function addNote(state, note) {
  const sp = setpiecesOf(state);
  return { ...state, setpieces: { ...sp, pending: [...(sp.pending ?? []), note] } };
}

/** Is a run under way (armed, not done)? @param {Run | undefined} run */
export const running = (run) => !!run && run.done === undefined;

/** The step a run is on (the next to fall), or null when done. @param {any} R @param {Run | undefined} run */
export function stepNow(R, run) {
  if (!run || run.done !== undefined) return null;
  return stepsOf(R)[run.step] ?? null;
}

/** The beat id a run has reached (the last to fall), or null before the first. @param {any} R @param {Run | undefined} run */
export function beatReached(R, run) {
  if (!run || !run.fell.length) return null;
  return stepsOf(R)[run.fell.length - 1] ?? null;
}

/**
 * The first hour the run's next step may fall (its afterDays from the step before, at its hour of
 * day: the check of the hour itself is in `fits`). @param {Run} run @param {Step} st @param {number} seed
 */
function earliest(run, st, seed) {
  const prev = run.fell.length ? run.fell[run.fell.length - 1] : run.armed;
  const days = pick(st.def.afterDays, seed, idNum(run.id), run.n, run.step);
  // A day after a dawn is the next dawn: half a day early, so the hour of day decides.
  return prev + Math.max(1, days * HOURS_PER_DAY - (days > 0 ? 12 : 0));
}

/** Does this hour suit the step's time of day? @param {Step} st @param {number} hour @param {any} state */
function fits(st, hour, state) {
  const at = st.def.at ?? 'any';
  if (at === 'any') return true;
  const dd = dawnDusk(state);
  return hour % HOURS_PER_DAY === dd[at];
}

/**
 * Apply the pending notes, in order. Pure. @param {any} sp @param {Record<string, any>} recipes
 * @param {any} env @param {any[]} events
 */
function applyNotes(sp, recipes, env, events) {
  if (!sp.pending?.length) return sp;
  let out = { ...sp, pending: undefined };
  for (const note of sp.pending) {
    if (note.kind === 'cond') { out = { ...out, conds: { ...out.conds, [note.name]: note.value } }; continue; }
    const R = recipes[note.id], run = out.runs[note.id];
    const hook = HOOKS[note.id]?.onNote;
    if (!R || !run || !hook) continue;
    const next = hook(run, note, { R, env, sp: out, step: stepNow(R, run) });
    if (!next || next === run) continue;
    const log = [...(next.log ?? []), { kind: note.kind, hour: note.hour }].slice(-LOG_CAP);
    out = { ...out, runs: { ...out.runs, [note.id]: { ...next, log } } };
    events.push({ name: 'setpiece:choice', payload: { id: note.id, kind: note.kind } });
  }
  return out;
}

/**
 * Wait-for checks, named in a beat's `waitFor`: true once the run's data holds that key (a hook
 * or a note put it there), or the set piece's hooks say so.
 * @param {string} name @param {Run} run @param {any} R @param {any} sp
 */
function waited(name, run, R, sp) {
  const own = HOOKS[run.id]?.waitFor?.[name];
  return own ? own(run, R, sp) : run.data?.[name] !== undefined;
}

/**
 * One hour of the set pieces. Pure: env.recipes.setpieces holds each set piece's recipe by id and
 * `world` the shared numbers (recipes/world/setpieces.json); env.away is true in catch-up.
 * @param {any} state @param {number} hour @param {any} env
 * @returns {{ state: any, events: { name: string, payload: any }[] }}
 */
export function coarseStep(state, hour, env) {
  const all = env?.recipes?.setpieces;
  if (!all?.list) return { state, events: [] };
  /** @type {{ name: string, payload: any }[]} */ const events = [];
  const W = all.world ?? {};
  let sp = applyNotes(setpiecesOf(state), all.list, env, events);
  const seed = env.seed ?? 0;

  // The one running, if any, plays on.
  for (const id of Object.keys(sp.runs)) {
    const R = all.list[id];
    let run = sp.runs[id];
    if (!R || !running(run)) continue;
    const steps = stepsOf(R);
    // At most one step an hour; beats due while away fall in order, an hour apart at the least.
    const st = steps[run.step];
    if (!st) { run = { ...run, done: hour }; sp = ended(sp, id, R, hour, events); sp = { ...sp, runs: { ...sp.runs, [id]: run } }; continue; }
    if (hour < earliest(run, st, seed) || !fits(st, hour, state) || (st.def.presence && env.away)
      || (st.def.waitFor && !waited(st.def.waitFor, run, R, sp))) continue;
    run = { ...run, fell: [...run.fell, hour], step: run.step + 1, start: run.start ?? hour };
    const hook = HOOKS[id]?.onStep;
    if (hook) run = hook(run, st, { R, env, sp, hour, state }) ?? run;
    if (st.def.warn) events.push({ name: 'setpiece:warn', payload: { id, beat: st.def.id } });
    events.push({ name: 'setpiece:beat', payload: { id, beat: st.def.id, rep: st.rep } });
    if (run.step >= steps.length) { run = { ...run, done: hour }; sp = ended(sp, id, R, hour, events); }
    sp = { ...sp, runs: { ...sp.runs, [id]: run } };
  }

  // Otherwise, one may arm: in recipe order, if spacing allows.
  const busy = Object.values(sp.runs).some((r) => running(/** @type {Run} */ (r)));
  if (!busy) {
    for (const id of all.order ?? Object.keys(all.list)) {
      const R = all.list[id];
      if (!R || !canArm(R, id, sp, hour, state, W, seed)) continue;
      if (!triggered(R, { state, sp, hour, seed, id })) continue;
      const n = sp.count?.[id] ?? 0;
      const keep = HOOKS[id]?.carry?.(sp.runs[id]) ?? {};
      /** @type {Run} */ const run = { id, n, armed: hour, step: 0, fell: [], season: seasonKey(state), data: keep, log: [] };
      sp = { ...sp, runs: { ...sp.runs, [id]: run } };
      events.push({ name: 'setpiece:arm', payload: { id } });
      break;
    }
  }
  return { state: sp === state?.setpieces ? state : { ...state, setpieces: sp }, events };
}

/** A run ended: counted, and the spacing clocks set. @param {any} sp @param {string} id @param {any} R @param {number} hour @param {any[]} events */
function ended(sp, id, R, hour, events) {
  events.push({ name: 'setpiece:end', payload: { id } });
  return { ...sp, count: { ...sp.count, [id]: (sp.count?.[id] ?? 0) + 1 }, endedAt: hour, ...(R.size === 'big' ? { bigEndedAt: hour, bigCount: (sp.bigCount ?? 0) + 1 } : {}) };
}

/**
 * May this set piece arm now? Once-only ones once; seasonal ones once a season; one with `again`
 * that many game days (seeded) after it last ended; a rest after the
 * last one ended (gapDays), big ones bigGapDays after the last big one, and the first year's cap.
 * @param {any} R @param {string} id @param {any} sp @param {number} hour @param {any} state @param {any} W @param {number} seed
 */
function canArm(R, id, sp, hour, state, W, seed) {
  const n = sp.count?.[id] ?? 0, last = sp.runs[id];
  if (R.repeat === 'once' && (n > 0 || last)) return false;
  if (R.repeat === 'season' && last && last.season === seasonKey(state)) return false;
  // Again after a seeded number of game days since it last ended (`again`: [min, max]).
  if (R.again && last?.done !== undefined && hour - last.done < pick(R.again, seed, idNum(id), n) * HOURS_PER_DAY) return false;
  if (R.max !== undefined && n >= R.max) return false;
  if (sp.endedAt !== undefined && hour - sp.endedAt < (W.gapDays ?? 0) * HOURS_PER_DAY) return false;
  if (R.size === 'big' && sp.bigEndedAt !== undefined && hour - sp.bigEndedAt < (W.bigGapDays ?? 7) * HOURS_PER_DAY) return false;
  if (R.size === 'big' && (state?.seasons?.year ?? 0) === 0 && (sp.bigCount ?? 0) >= (W.firstYearMax ?? 3)) return false;
  return true;
}

/**
 * Start a set piece at a step, for the test links: armed now, every step before `at` fallen now
 * (an hour apart, back from now, so they keep their order) with its hooks, and spacing ignored.
 * Steps that wait for something (a planned trail) take `data` instead. Pure.
 * @param {any} state @param {string} id @param {number} at the step to stand on (0 the first)
 * @param {number} hour @param {any} env @param {Record<string, any>} [data] run data to start with
 */
export function startAt(state, id, at, hour, env, data = {}) {
  const R = env.recipes.setpieces.list[id];
  const steps = stepsOf(R);
  const sp = setpiecesOf(state);
  const k = Math.max(0, Math.min(steps.length, at));
  const from = hour - k;
  /** @type {Run} */ let run = { id, n: sp.count?.[id] ?? 0, armed: from - 1, step: 0, fell: [], season: seasonKey(state), data: { ...(HOOKS[id]?.carry?.(sp.runs[id]) ?? {}), ...data }, log: [] };
  for (let i = 0; i < k; i++) {
    run = { ...run, fell: [...run.fell, from + i], step: i + 1, start: run.start ?? from + i };
    run = HOOKS[id]?.onStep?.(run, steps[i], { R, env, sp, hour: from + i, state }) ?? run;
  }
  const runs = Object.fromEntries(Object.entries(sp.runs).map(([key, r]) => [key, key === id ? r : (running(/** @type {Run} */ (r)) ? { ...r, done: hour } : r)]));
  return { ...state, setpieces: { ...sp, runs: { ...runs, [id]: run } } };
}

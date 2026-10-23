// @ts-check
// Catch-up (docs 02, 18): how many game hours the island earned while you were away, with guards
// against a moved device clock, and running them. The hours run back to back in a worker on the
// `catchup` lane, a day (24 hours) per job, so the page keeps drawing and can show progress; the
// same function runs on the page if workers fail. Pure parts first; the runner is at the bottom.

import { run } from '../core/workers.js';
import { makeEnv } from './tick.js';
import { hourStep } from './hour.js';
import { habitatByDay } from '../world/growth/habitat-days.js';

/** At most 7 game days per return (docs 02, future/01), so a return never skips half a season. */
export const CAP_HOURS = 168;
/** Game hours per real minute away: a quarter of watched time, so time away is gentle (future/01).
 *  recipes/world/save.json catchUp.awayRate overrides it. */
export const AWAY_RATE = 0.25;
const MS_PER_MINUTE = 60000;
/** A clock moved back further than this resets the guard rather than waiting for real time. */
const RESET_MS = 2 * 24 * 3600 * 1000;
/** Small backward steps (network time corrections) are forgiven up to this. */
const GRACE_MS = 5 * 60 * 1000;
const JOB = { module: './sim/catchup.js', fn: 'catchUpJob' };

/**
 * Game hours earned since the last record of time, by doc 18's clock rules.
 * @param {{ now: number, savedAt: number, wallHighWater: number, carryMinutes?: number, flow: number,
 *   keepGrowing?: boolean, cap?: number, rate?: number }} p  all times UTC ms; carryMinutes: game hours
 *   carried over (fractional; the name is doc 18's, from when one real minute was one game hour);
 *   rate: game hours per real minute away (AWAY_RATE)
 * @returns {{ hours: number, carryMinutes: number, wallHighWater: number, why: 'away'|'paused'|'clock-back'|'clock-reset'|'capped' }}
 */
export function awayHours(p) {
  const cap = p.cap ?? CAP_HOURS;
  const hw = Math.max(p.wallHighWater || 0, p.savedAt || 0);
  let elapsed = 0, highWater = hw;
  /** @type {'away'|'paused'|'clock-back'|'clock-reset'|'capped'} */ let why = 'away';
  if (p.now < hw - RESET_MS) { highWater = p.now; why = 'clock-reset'; }
  else if (p.now < hw) why = 'clock-back';
  else { elapsed = p.now - Math.max(p.savedAt || 0, hw - GRACE_MS); highWater = p.now; }
  if (!p.flow || p.keepGrowing === false) { elapsed = 0; if (why === 'away') why = 'paused'; }
  const total = (Math.max(0, elapsed) / MS_PER_MINUTE) * (p.rate ?? AWAY_RATE) + Math.max(0, p.carryMinutes ?? 0);
  const hours = Math.min(Math.floor(total), cap);
  if (hours === cap && total > cap) why = 'capped';
  return { hours, carryMinutes: hours === cap ? 0 : total - hours, wallHighWater: highWater, why };
}

/**
 * @typedef {Object} CatchUpInput
 * @property {number} seed        world seed
 * @property {any} recipes        the tick env's recipes (plain JSON): seasons, sky, water, growth, flora, covers, land, species
 * @property {any} habitat        the habitat grid as you left it (no edits while you are away)
 * @property {import('../world/growth/habitat-days.js').HabitatInputs | null} [habitatInputs]  what it is
 *   built from: then the habitat follows the season day by day, as the game's does (the water table and
 *   the summer drawdown; A9), instead of staying as you left it
 * @property {Uint8Array | null} material  painted materials, for the journal's ground survey
 * @property {any} state          world state at the last whole hour
 * @property {any} journal        the journal, or null on a page without one
 * @property {{ words: any, island: any, web: any } | null} jr  the journal's recipes
 * @property {number} fromHour    the first hour to run
 * @property {number} hours       how many
 * @property {{ x: number, z: number, reachM: number, trust: number } | null} [camp]  the camp's pad
 *   centre and its standing presence (recipes/world/camp.json standing), once the tent is pitched
 */

/**
 * Run hours back to back. The worker job and the page fallback are this same function.
 * @param {CatchUpInput} a
 * @returns {{ state: any, journal: any, notes: any[], events: any[] }}
 */
export function catchUpJob(a) {
  const env = makeEnv(a.seed, a.recipes);
  // The camp's standing presence (docs/future/13 CP-13) is earned only while away.
  /** @type {any} */ (env).awayCamp = a.camp ?? null;
  const byDay = a.habitatInputs ? habitatByDay(a.habitatInputs) : null;
  let habitat = a.habitat;
  env.habitat = () => habitat;
  const jc = { material: a.material, words: a.jr?.words, island: a.jr?.island, web: a.jr?.web };
  let state = a.state, journal = a.jr ? a.journal : null;
  /** @type {any[]} */ const notes = [], events = [];
  for (let h = a.fromHour; h < a.fromHour + a.hours; h++) {
    if (byDay) habitat = byDay(h);
    const r = hourStep(state, journal, h, env, jc);
    state = r.state;
    journal = r.journal;
    notes.push(...r.notes);
    events.push(...r.events);
  }
  return { state, journal: a.jr ? journal : a.journal, notes, events };
}

/**
 * Run `hours` hours from `fromHour`, a day per job, in a worker (or here, between frames, if
 * workers fail). Resolves with the island and journal after the last hour.
 * @param {CatchUpInput & { block?: number, onProgress?: (done: number, of: number) => void, worker?: boolean }} a
 *   worker: false runs on the page (tools compare the two)
 */
export async function catchUp(a) {
  const block = a.block ?? 24;
  let state = a.state, journal = a.journal;
  /** @type {any[]} */ const notes = [], events = [];
  let useWorker = a.worker !== false;
  for (let done = 0; done < a.hours;) {
    const n = Math.min(block, a.hours - done);
    const args = { ...a, onProgress: undefined, state, journal, fromHour: a.fromHour + done, hours: n };
    /** @type {ReturnType<typeof catchUpJob> | null} */ let r = null;
    if (useWorker) {
      try { r = await run(JOB, args, { lane: 'catchup' }); }
      catch (err) { console.warn('catch-up in a worker failed; running it here', err); useWorker = false; }
    }
    if (!r) {
      await new Promise((ok) => setTimeout(ok, 0));   // let a frame through between days
      r = catchUpJob(args);
    }
    state = r.state;
    journal = r.journal;
    notes.push(...r.notes);
    events.push(...r.events);
    done += n;
    a.onProgress?.(done, a.hours);
  }
  return { state, journal, notes, events };
}

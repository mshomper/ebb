// @ts-check
// Shaped ground, live (B3 S0; the checks are in shaped.js): the memory that turns a look at the
// ground into ages and quiet, and the watch that looks once a game hour and after the water settles.
// The memory is the save section `shaped` (an older save reads as nothing remembered yet):
//   ponds  [{ x, z, born, seen }]  each dug pond, the game hour it was first seen and last seen
//   wrack  { since }               the game hour since which at least wrack.minM has lain (null: not now)
//   steps  [[cell, hour], ...]     the walker's footprint grid (bar.stepCellM squares) over the last bar.quietH
//   visits { lookedH, by }         ecology/visits.js keeps its own part here
// The report goes to the store slice `shapedNow` (not saved: it is worked out again from the ground).

import { get, update } from '../../core/store.js';
import { on } from '../../core/events.js';
import { HABITAT_ORIGIN, HABITAT_CELLS } from '../growth/habitat.js';
import { openBox } from './fields.js';
import { shapedReport, wrackLyingM } from './shaped.js';

/** @typedef {{ x: number, z: number, born: number, seen: number }} PondMemory */
/** @typedef {{ version: 1, ponds: PondMemory[], wrack: { since: number | null }, steps: number[][], visits: { lookedH: number | null, by: Record<string, any> } }} ShapedMemory */

/** A new island's memory. @returns {ShapedMemory} */
export const emptyShaped = () => ({ version: 1, ponds: [], wrack: { since: null }, steps: [], visits: { lookedH: null, by: {} } });

/**
 * The save section as read: anything missing or unreadable comes back as nothing remembered.
 * @param {any} v @returns {ShapedMemory}
 */
export function cleanShaped(v) {
  const e = emptyShaped();
  if (!v || typeof v !== 'object' || v.version !== 1) return e;
  const num = (/** @type {any} */ x) => typeof x === 'number' && Number.isFinite(x);
  return {
    version: 1,
    ponds: Array.isArray(v.ponds) ? v.ponds.filter((/** @type {any} */ p) => p && num(p.x) && num(p.z) && num(p.born)).map((/** @type {any} */ p) => ({ x: p.x, z: p.z, born: p.born, seen: num(p.seen) ? p.seen : p.born })) : [],
    wrack: { since: num(v.wrack?.since) ? v.wrack.since : null },
    steps: Array.isArray(v.steps) ? v.steps.filter((/** @type {any} */ s) => Array.isArray(s) && num(s[0]) && num(s[1])).map((/** @type {number[]} */ s) => [s[0], s[1]]) : [],
    visits: { lookedH: num(v.visits?.lookedH) ? v.visits.lookedH : null, by: v.visits?.by && typeof v.visits.by === 'object' ? structuredClone(v.visits.by) : {} },
  };
}

/**
 * Remember the dug ponds seen now: one within matchM of a remembered pond is that pond (it keeps its
 * birth hour), a new one is born now, and a remembered one not seen for forgetDays is forgotten (a
 * pond that dried for a summer week and filled again starts over). Pure.
 * @param {PondMemory[]} mem @param {{ x: number, z: number, dug: boolean }[]} ponds @param {number} nowH @param {any} R
 * @returns {{ ponds: PondMemory[], ageOf: (p: { x: number, z: number }) => number }}
 */
export function rememberPonds(mem, ponds, nowH, R) {
  const P = R.pond, m2 = P.matchM * P.matchM;
  const out = mem.map((p) => ({ ...p }));
  const used = new Set();
  for (const p of ponds) {
    if (!p.dug) continue;
    let best = -1, bestD = m2;
    for (let i = 0; i < out.length; i++) {
      if (used.has(i)) continue;
      const d = (out[i].x - p.x) ** 2 + (out[i].z - p.z) ** 2;
      if (d <= bestD) { bestD = d; best = i; }
    }
    if (best >= 0) { used.add(best); Object.assign(out[best], { x: p.x, z: p.z, seen: nowH }); }
    else { out.push({ x: p.x, z: p.z, born: nowH, seen: nowH }); used.add(out.length - 1); }
  }
  const kept = out.filter((p) => nowH - p.seen <= (P.forgetDays ?? 3) * 24);
  const ageOf = (/** @type {{ x: number, z: number }} */ p) => {
    let best = null, bestD = m2;
    for (const q of kept) { const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2; if (d <= bestD) { bestD = d; best = q; } }
    return best ? Math.round(((nowH - best.born) / 24) * 10) / 10 : 0;
  };
  return { ponds: kept, ageOf };
}

/**
 * How long wrack has lain: the hour since which at least minM has, or null when less lies now. Pure.
 * @param {number | null} since @param {number} lyingM @param {number} nowH @param {any} R
 */
export const wrackSince = (since, lyingM, nowH, R) => (lyingM >= R.wrack.minM ? since ?? nowH : null);

/** The footprint square of a point. @param {number} x @param {number} z @param {any} R */
export function stepCell(x, z, R) {
  const c = R.bar.stepCellM, per = Math.ceil(HABITAT_CELLS / c);
  const i = Math.floor((x - HABITAT_ORIGIN) / c), j = Math.floor((z - HABITAT_ORIGIN) / c);
  return i < 0 || j < 0 || i >= per || j >= per ? -1 : j * per + i;
}

/**
 * The walker's footprints with a step at (x, z) this hour, and those older than quietH dropped. Pure.
 * @param {number[][]} steps @param {number} x @param {number} z @param {number} nowH @param {any} R
 */
export function noteStep(steps, x, z, nowH, R) {
  const c = stepCell(x, z, R);
  const keep = steps.filter((s) => nowH - s[1] <= R.bar.quietH && s[0] !== c);
  if (c >= 0) keep.push([c, nowH]);
  return keep;
}

/**
 * Is a bar quiet: no walker within quietM of it (its middle, plus half its length) in the last
 * quietH game hours? nearM: the nearest footprint square's middle, or null. Pure.
 * @param {{ x: number, z: number, lengthM: number }} bar @param {number[][]} steps @param {number} nowH @param {any} R
 */
export function quietAt(bar, steps, nowH, R) {
  const c = R.bar.stepCellM, per = Math.ceil(HABITAT_CELLS / c);
  let near = Infinity;
  for (const [k, h] of steps) {
    if (nowH - h > R.bar.quietH) continue;
    const x = HABITAT_ORIGIN + ((k % per) + 0.5) * c, z = HABITAT_ORIGIN + (Math.floor(k / per) + 0.5) * c;
    const d = Math.max(0, Math.sqrt((x - bar.x) ** 2 + (z - bar.z) ** 2) - bar.lengthM / 2);
    if (d < near) near = d;
  }
  return { quiet: near > R.bar.quietM, nearM: Number.isFinite(near) ? Math.round(near * 10) / 10 : null };
}

/**
 * The watch: looks once a game hour, a moment after the water settles, and after time away; keeps
 * the walker's footprints a couple of times a second while you walk. A system on the live sim.
 * @param {{ R: any, world: { state: any, env: any }, nowH: () => number, you: () => { x: number, z: number } | null,
 *   wrack?: (x: number, z: number, r: number) => { kind: string, source: string, left: number }[], onLook?: (report: any) => void }} o
 *   wrack: the gather spots near a point (src/world/gather near), for the strandline's wrack
 */
export function createShapedWatch(o) {
  const { R } = o;
  const mem = () => /** @type {ShapedMemory} */ (get('shaped') ?? emptyShaped());
  let lookS = 3, stepS = 0, lastHour = -1;
  const offs = ['water:summary-updated', 'world:ticked', 'terrain:stroke-ended'].map((ev) => on(ev, () => { lookS = Math.min(lookS, 1); }));

  /** Look at the ground now and publish the report. */
  function look() {
    const hab = o.world.env.habitat?.();
    if (!hab) return null;
    const nowH = o.nowH(), m = mem(), st = o.world.state;
    // The strandline's wrack, over the island's box.
    let lyingM = 0;
    if (o.wrack) {
      const b = openBox(hab);
      const cx = HABITAT_ORIGIN + (b.i0 + b.i1 + 1) / 2, cz = HABITAT_ORIGIN + (b.j0 + b.j1 + 1) / 2;
      const r = Math.sqrt((b.i1 - b.i0 + 1) ** 2 + (b.j1 - b.j0 + 1) ** 2) / 2;
      lyingM = wrackLyingM(o.wrack(cx, cz, r), R);
    }
    const since = wrackSince(m.wrack.since, lyingM, nowH, R);
    // Ponds first without ages, to remember them; then the whole report with ages and quiet.
    const plants = st?.growth?.plants ?? [], rushes = st?.growth?.cover?.rushes ?? null;
    const first = shapedReport({ hab, plants, rushes }, R);
    const ponds = rememberPonds(m.ponds, first.ponds, nowH, R);
    const report = shapedReport({ hab, plants, rushes, islet: get('islet') ?? null,
      wrack: { lyingM, days: since === null ? 0 : Math.round(((nowH - since) / 24) * 10) / 10 },
      quiet: (bar) => quietAt(bar, m.steps, nowH, R), ageOf: ponds.ageOf }, R);
    update('shaped', (v) => ({ ...cleanShaped(v), ponds: ponds.ponds, wrack: { since } }));
    const { _cells, ...out } = report;
    update('shapedNow', () => ({ ...out, hour: nowH }));
    o.onLook?.(report);
    return report;
  }

  return {
    id: 'shaped-watch',
    look,
    /** Each frame. @param {{ realDt: number }} f */
    tick(f) {
      stepS += f.realDt;
      if (stepS >= 0.5) {
        stepS = 0;
        const y = o.you();
        if (y) {
          const nowH = o.nowH(), c = stepCell(y.x, y.z, R);
          const steps = mem().steps;
          if (!steps.some((s) => s[0] === c && s[1] === nowH)) update('shaped', (v) => { const m = cleanShaped(v); return { ...m, steps: noteStep(m.steps, y.x, y.z, nowH, R) }; });
        }
      }
      const hour = Math.floor(o.nowH());
      if (hour !== lastHour && lastHour >= 0) lookS = Math.min(lookS, 0.2);
      lastHour = hour;
      if (lookS > 0 && (lookS -= f.realDt) <= 0) look();
    },
    dispose() { for (const off of offs) off(); },
  };
}

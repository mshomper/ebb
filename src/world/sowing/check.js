// @ts-check
// Planting from below, run for tools/determinism.html (P2g): on a made-up pond margin, a seed sown,
// a seed ball's cluster, a clump lifted and set in again at its size, and a willow cutting, all
// through the growth system's own planting path; then three game days of hours. Run straight, run
// again from a copy of the state as a save keeps it (a catch-up resumes from the save), and on a
// worker: every hash must agree. Pure; runs as a worker job with plain-data arguments.

import { initialWorldState, makeEnv, runHour, hashWorldState } from '../../sim/tick.js';
import { HABITAT_CELLS, HABITAT_ORIGIN } from '../growth/habitat.js';
import { settleGrowth, plantSeed, liftPlant } from '../growth/coarse.js';
import { ballSpots } from './model.js';

/** A made-up habitat: a damp, fresh bank either side of a still margin, where these all belong. */
function bankHabitat() {
  const N = HABITAT_CELLS;
  const hab = { n: N, depthCm: new Uint8Array(N * N), moisture: new Uint8Array(N * N), salt: new Uint8Array(N * N),
    still: new Uint8Array(N * N), sea: new Uint8Array(N * N), grass: new Uint8Array(N * N), open: new Uint8Array(N * N).fill(1), hash: 0x91a7 };
  for (let j = 0; j < N; j++) for (let i = 36; i < 50; i++) {
    const k = j * N + i, wet = i >= 42 && i < 44;
    hab.depthCm[k] = wet ? 15 : 0; hab.moisture[k] = wet ? 255 : 200; hab.still[k] = wet ? 1 : 0;
  }
  return hab;
}

/**
 * @param {{ worldSeed: number, sowing: any, seasons: any, growth: any, flora: Record<string, any>, covers: Record<string, any> }} a
 * @returns {{ planted: number, missed: string[], straight: number, fromSave: number, again: number, hash: number, sizes: number[] }}
 */
export function plantingCheckJob(a) {
  const R = a.sowing;
  const recipes = { seasons: a.seasons, growth: a.growth, flora: a.flora, covers: a.covers };
  const hab = bankHabitat();
  const env = { ...makeEnv(a.worldSeed, recipes), habitat: () => hab };
  const X = HABITAT_ORIGIN + 40.5, Z = HABITAT_ORIGIN + 30.5;

  /** The edits, as the walker would make them, at the start of a summer day. */
  const edits = () => {
    let st = settleGrowth(initialWorldState(a.worldSeed), env), took = 0;
    missed = [];
    /** @param {string} sp @param {number} x @param {number} z @param {any} [o] */
    const put = (sp, x, z, o) => { const r = plantSeed(st, sp, x, z, env, o); if (r.ok) { st = r.state; took++; } else missed.push(`${sp}: ${r.reason}`); return r.ok; };
    put('watermint', X, Z);
    for (const [x, z] of ballSpots(X + 1, Z + 6, R.ball.seeds, (a.flora.campion?.spread?.minSpacingM ?? 0.5) * R.ball.spreadShare)) put('meadowsweet', x, z, { minSuit: R.ball.minSuit });
    put('iris', X - 1, Z - 6, { size: 0.6, best: 0.8 });
    // Lifted, and set in again elsewhere at the size it was, a good start on top.
    const iris = st.growth.plants.find((/** @type {any} */ p) => p.sp === 'iris');
    if (iris) { const l = liftPlant(st, iris.id); st = l.state; put('iris', X - 1, Z + 12, { size: Math.min(1, l.plant.size + R.goodStart.bonus), best: l.plant.best }); }
    put(R.cutting.species, X - 2, Z + 20, { size: R.cutting.size, capped: true });
    planted = took;
    return st;
  };
  let planted = 0;
  /** @type {string[]} */ let missed = [];
  const h0 = 24 * 14 * 1 + 24 * 3 + 8;   // summer, day 3, 8 in the morning
  /** @param {any} st */
  const days = (st) => { for (let h = h0; h < h0 + 72; h++) st = runHour(st, h, env).state; return st; };

  const start = edits();
  const straight = days(start);
  const fromSave = days(structuredClone(start));
  const again = days(edits());
  const out = { planted, straight: hashWorldState(straight), fromSave: hashWorldState(fromSave), again: hashWorldState(again) };
  return { ...out, missed, hash: out.straight, sizes: straight.growth.plants.map((/** @type {any} */ p) => Math.round(p.size * 1e6) / 1e6) };
}

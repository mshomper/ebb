// @ts-check
// The midge field (docs 11, 12): how many midges dance over each square meter, 0..255. Midges
// gather over still fresh water and the ground just beside it, where reeds and rushes feed them,
// more in summer and hardly any in winter. Each hour the field moves part of the way toward what the
// ground can hold, so a new reed bed fills over a day or so and a drained one empties. Frogs read it
// as food. Pure and worker-safe; integers in the stored field.

import { chamfer } from '../growth/habitat.js';
import { openBox, sat, boxSum, plantField, grow } from './fields.js';

/** Thirds of a cell per meter in a chamfer distance. */
const THIRDS = 3;

/**
 * What each square can hold now, 0..255.
 * @param {any} hab the habitat grid @param {any} growth state.growth @param {any} F recipes/species/midge.json field
 * @param {number} season 0 spring .. 3 winter
 */
export function midgeTarget(hab, growth, F, season) {
  const n = hab.n;
  const box = openBox(hab, 1);
  // Still fresh water and damp hollows: where midges breed and hang.
  const still = new Uint8Array(n * n);
  for (let j = box.j0; j <= box.j1; j++) {
    for (let i = box.i0; i <= box.i1; i++) {
      const k = j * n + i;
      if (hab.open[k] && !hab.sea[k] && hab.still[k]) still[k] = 1;
    }
  }
  // Both only inside the box (its sources and plants are there), and exact there.
  const dWater = chamfer(still, n, THIRDS * 32, box);
  const r = Math.round(F.feedRadiusM);
  const feed = sat(plantField(hab, growth, F.feed, false), n, 1, grow(box, r, n));
  const warmth = F.warmth[season] ?? 0;
  const near = F.nearWaterM * THIRDS;
  const out = new Uint8Array(n * n);
  for (let j = box.j0; j <= box.j1; j++) {
    for (let i = box.i0; i <= box.i1; i++) {
      const k = j * n + i;
      if (!hab.open[k] || hab.sea[k] || dWater[k] > near) continue;
      const f = boxSum(feed, n, i, j, r) / F.fullFeed;
      out[k] = Math.floor(255 * warmth * (f > 1 ? 1 : f));
    }
  }
  return out;
}

/**
 * One hour of the midge field: each square moves riseShare of the way up toward its target, or
 * fallShare of the way down, at least one step (integers).
 * @param {any} hab @param {any} growth @param {Uint8Array | null} prev last hour's field (null in a new world: no midges yet)
 * @param {any} F recipes/species/midge.json field @param {number} season
 */
export function stepMidges(hab, growth, prev, F, season) {
  const target = midgeTarget(hab, growth, F, season);
  const n = hab.n;
  // Past the island's box the target is always 0, so the field there stays as it was (0): only the
  // box moves.
  const out = prev ? prev.slice() : new Uint8Array(n * n);
  const box = openBox(hab, 1);
  for (let j = box.j0; j <= box.j1; j++) {
    for (let k = j * n + box.i0; k <= j * n + box.i1; k++) {
      const was = prev ? prev[k] : 0, t = target[k];
      if (t === was) { out[k] = t; continue; }
      const share = t > was ? F.riseShare : F.fallShare;
      let step = Math.floor(Math.abs(t - was) * share);
      if (step === 0) step = 1;
      out[k] = t > was ? was + step : was - step;
    }
  }
  return out;
}

/**
 * Square meters holding at least `share` of a full midge cloud.
 * @param {Uint8Array | null | undefined} m @param {number} share
 */
export function midgeArea(m, share) {
  if (!m) return 0;
  const at = 255 * share;
  let a = 0;
  for (let k = 0; k < m.length; k++) if (m[k] >= at) a++;
  return a;
}

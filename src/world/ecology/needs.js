// @ts-check
// Generic needs (docs 11, 12; docs/future/11 "Generic needs"): the five needs scored 0..1 per
// square of the 1 m habitat grid from a species recipe's needs block, and the habitat score of each
// square (the mood those needs make with the species' ideal group around). One reader for every
// species: where it lives (on the bank, in the water, over it), what water, food and cover it wants,
// all come from its recipe. Frogs add their bank on top (habitat.js frogNeeds). Pure and
// worker-safe; det math through moodOf only.
//
// Recipe shape (ecology.needs, ecology.scored):
//   water    { depthM: [lo, hi], damp?: true, body?: { minM2, deepM? }, okM, maxM, w }
//            good water is still fresh water lo..hi deep (or a damp hollow, unless damp is false);
//            with `body`, only in a connected body of standing water of at least minM2 that is
//            somewhere at least deepM deep. Water scores 1 within okM of good water, 0 beyond maxM.
//   food     { field: 'midges' } or { fields: { midges: 1, ... } }, plants?: { pondweed: 0.5 }, radiusM, per (or perFrog), w
//            the fields (and plants, weight x size) summed over the square of radiusM around, against
//            per x the ideal group
//   shelter  { cover: { plant: weight }, fields?: { basks: 1 }, radiusM, from, full, w }  the best
//            cover within radiusM; fields count too (the basking spots you set, for turtles)
//   quiet    { w }  nothing disturbs yet (no paths or lanterns), so full
//   company  { n: [min, ideal, max], w }  scored at the ideal group here
//   scored   { where: 'shore' | 'water' | 'near', shallowCm? }
//            shore: ground and shallows up to shallowCm (frogs); water: squares of the water body
//            (minnows); near: any open ground or fresh water (dragonflies over a pond and its banks)

import { chamfer } from '../growth/habitat.js';
import { openBox, sat, boxSum, boxMax, plantField, smooth } from './fields.js';
import { moodOf } from './habitat.js';

/**
 * @typedef {Object} WaterBody  a connected body of standing fresh water (four-connected squares)
 * @property {number} id     1.. in grid order
 * @property {number} area   square meters
 * @property {number} good   square meters of good depth
 * @property {number} deepCm the deepest square
 * @property {number} deepK  where that is (the first in grid order)
 */

/**
 * The bodies of standing fresh water (still, deeper than 0) inside the box, labelled.
 * @param {any} hab @param {import('./fields.js').Box} box
 * @returns {{ label: Uint16Array, bodies: WaterBody[] }}
 */
export function waterBodies(hab, box) {
  const n = hab.n;
  const label = new Uint16Array(n * n);
  /** @type {WaterBody[]} */ const bodies = [];
  const wet = (/** @type {number} */ k) => hab.open[k] && !hab.sea[k] && hab.still[k] && hab.depthCm[k] > 0;
  for (let j = box.j0; j <= box.j1; j++) {
    for (let i = box.i0; i <= box.i1; i++) {
      const k0 = j * n + i;
      if (label[k0] || !wet(k0)) continue;
      const id = bodies.length + 1;
      const b = { id, area: 0, good: 0, deepCm: 0, deepK: k0 };
      const stack = [k0];
      label[k0] = id;
      while (stack.length) {
        const k = /** @type {number} */ (stack.pop());
        b.area++;
        const d = hab.depthCm[k];
        if (d > b.deepCm || (d === b.deepCm && k < b.deepK)) { b.deepCm = d; b.deepK = k; }
        const a = k % n;
        for (const q of [a > 0 ? k - 1 : -1, a < n - 1 ? k + 1 : -1, k - n, k + n]) {
          if (q >= 0 && q < n * n && !label[q] && wet(q)) { label[q] = id; stack.push(q); }
        }
      }
      bodies.push(b);
    }
  }
  return { label, bodies };
}

/**
 * Good water for a species: still fresh water of its depth, or a damp hollow; with a body rule,
 * only in bodies big and deep enough (those bodies' ids are returned too).
 * @param {any} hab @param {any} W the recipe's water need @param {import('./fields.js').Box} box
 * @returns {{ good: Uint8Array, label: Uint16Array | null, bodies: WaterBody[] }}
 */
export function goodWater(hab, W, box) {
  const n = hab.n;
  const good = new Uint8Array(n * n);
  const lo = W.depthM[0] * 100, hi = W.depthM[1] * 100;
  const damp = W.damp !== false;
  const B = W.body ?? null;
  const found = B ? waterBodies(hab, box) : null;
  /** @type {Set<number>} */ const keep = new Set();
  if (found) {
    for (const b of found.bodies) if (b.area >= (B.minM2 ?? 0) && b.deepCm >= (B.deepM ?? 0) * 100) keep.add(b.id);
  }
  for (let j = box.j0; j <= box.j1; j++) {
    for (let i = box.i0; i <= box.i1; i++) {
      const k = j * n + i;
      if (!hab.open[k] || hab.sea[k] || !hab.still[k]) continue;
      const d = hab.depthCm[k];
      if (found) {
        if (d > 0 && keep.has(found.label[k]) && d >= lo && d <= hi) good[k] = 1;
      } else if ((damp && d === 0) || (d >= lo && d <= hi)) good[k] = 1;
    }
  }
  if (!found) return { good, label: null, bodies: [] };
  // Each kept body's good area, for the species that count room by the pool.
  const bodies = found.bodies.filter((b) => keep.has(b.id));
  for (const b of bodies) b.good = 0;
  for (let k = 0; k < n * n; k++) if (good[k]) { const b = bodies.find((x) => x.id === found.label[k]); if (b) b.good++; }
  return { good, label: found.label, bodies };
}

/**
 * The food fields a recipe names, with their weights. @param {any} F the recipe's food need
 * @returns {[string, number][]}
 */
export const foodFields = (F) => (F.fields ? Object.entries(F.fields) : F.field ? [[F.field, 1]] : []);

/**
 * Every need and the habitat score per square, for one species.
 * @param {any} hab the habitat grid @param {any} growth state.growth
 * @param {Record<string, Uint8Array | null | undefined>} fields ecology fields by name, 0..255 per square (midges, ...)
 * @param {any} rec the species recipe
 * @returns {{ score: Float32Array, water: Float32Array, food: Float32Array, shelter: Float32Array,
 *   good: Uint8Array, label: Uint16Array | null, bodies: WaterBody[], box: import('./fields.js').Box }}
 */
export function needMaps(hab, growth, fields, rec) {
  const E = rec.ecology, N = E.needs;
  const n = hab.n;
  const box = openBox(hab, 1);
  const where = E.scored?.where ?? 'shore';
  const { good, label, bodies } = goodWater(hab, N.water, box);
  const dGood = chamfer(good, n, 3 * 64);
  const near = plantField(hab, growth, N.shelter.cover, true);
  // Shelter from a field too (turtles' basking spots): each square keeps the better of the two.
  for (const [name, w] of Object.entries(N.shelter.fields ?? {})) {
    const f = fields[name];
    if (f) for (let k = 0; k < n * n; k++) { const v = (w * f[k]) / 255; if (v > near[k]) near[k] = v; }
  }
  const cover = boxMax(near, n, Math.round(N.shelter.radiusM), box);
  const F = N.food;
  const per = F.per ?? F.perFrog;
  const rf = Math.round(F.radiusM);
  const sums = foodFields(F).map(([name, w]) => ({ S: fields[name] ? sat(/** @type {Uint8Array} */ (fields[name]), n, 1 / 255) : null, w }))
    .filter((f) => f.S);
  // Plants eaten where they grow (minnows graze pondweed): each plant's weight times its size.
  if (F.plants) sums.push({ S: sat(plantField(hab, growth, F.plants, false), n), w: 1 });
  const ideal = N.company.n[1];
  const keep = label ? new Set(bodies.map((b) => b.id)) : null;
  const shallow = E.scored?.shallowCm ?? 0;

  const score = new Float32Array(n * n), water = new Float32Array(n * n);
  const food = new Float32Array(n * n), shelter = new Float32Array(n * n);
  for (let j = box.j0; j <= box.j1; j++) {
    for (let i = box.i0; i <= box.i1; i++) {
      const k = j * n + i;
      if (!hab.open[k] || hab.sea[k]) continue;
      if (where === 'shore' && hab.depthCm[k] > shallow) continue;
      if (where === 'water' && !(keep && label && keep.has(label[k]))) continue;
      const w = 1 - smooth(dGood[k] / 3, N.water.okM, N.water.maxM);
      if (w <= 0) continue;
      let s = 0;
      for (const f of sums) s += f.w === 1 ? boxSum(/** @type {Float64Array} */ (f.S), n, i, j, rf) : f.w * boxSum(/** @type {Float64Array} */ (f.S), n, i, j, rf);
      const fd = sums.length ? Math.min(1, s / (per * ideal)) : 0;
      const sh = smooth(cover[k], N.shelter.from, N.shelter.full);
      water[k] = w; food[k] = fd; shelter[k] = sh;
      score[k] = moodOf({ water: w, food: fd, shelter: sh, quiet: 1, company: 1 }, N);
    }
  }
  return { score, water, food, shelter, good, label, bodies, box };
}

// @ts-check
// Burying under raised ground (docs/future/13 5.2 Terraforming, and the bush rule Matt asked for on
// October 24: ride up whole, or go under whole, never half in the ground). Pure and worker-safe.
//
// Every plant stands on a seat: the ground under its base ring (its recipe's clump or cushion
// radius, by its size), sampled at its middle and bury.seatPoints round it. On ordinary ground the
// seat is the middle's height; where the ground under one side of the base rises more than
// bury.seatSlack x the ring's radius above the middle (a raise lapping one side, not a natural
// slope), the seat rises with it, so no stem or blade is ever drawn inside the ground.
//
// When a stroke settles, a plant whose seat rose by more than its bury depth goes under whole:
// depth = bury.raiseM, plus bury.heightShare of its drawn height for a plant drawn taller than
// bury.tallM (shrubs, iris, reeds). Below that it rides up on its new seat. Buried records ride in
// the stroke's undo command; undo puts them back exactly, redo takes them again.

const TAU = 6.283185307179586;

/** The radius of a plant's base ring (m): its stems' or blades' circle, by its size. @param {any} rec @param {number} size */
export function baseRadius(rec, size) {
  const S = rec?.shape ?? {};
  const r = S.clumpRadius ?? S.cushionRadius ?? 0;
  return r * (0.4 + 0.6 * Math.min(1, Math.max(0, size)));
}

/** The height a plant is drawn at (m), roughly: its recipe's full height by its size. @param {any} rec @param {number} size */
export function drawnHeight(rec, size) {
  const S = rec?.shape ?? {};
  return (S.maxHeight ?? S.cushionHeight ?? 0) * Math.min(1, Math.max(0, size));
}

/** How far a plant's seat must rise for it to go under (m). @param {any} rec @param {number} size @param {any} B growth.json bury */
export function buryDepth(rec, size, B) {
  const h = drawnHeight(rec, size);
  return B.raiseM + (h > (B.tallM ?? Infinity) ? (B.heightShare ?? 0) * h : 0);
}

/**
 * The points a seat is read at: the middle, then `n` round the base ring.
 * @param {number} x @param {number} z @param {number} r @param {number} n @returns {number[][]}
 */
export function seatPoints(x, z, r, n) {
  /** @type {number[][]} */ const out = [[x, z]];
  if (r <= 0) return out;
  // A fixed ring (Math.cos/sin of fixed angles only), so the same plant reads the same points.
  for (let i = 0; i < n; i++) out.push([x + r * Math.cos((TAU * i) / n), z + r * Math.sin((TAU * i) / n)]);
  return out;
}

/**
 * A plant's seat height from a height sampler: the middle's height, raised to the ring's highest
 * point less seatSlack x radius when the ground under one side stands higher than that.
 * @param {{ x: number, z: number, size: number }} p @param {any} rec @param {any} B growth.json bury
 * @param {(x: number, z: number) => number} height
 */
export function seatHeight(p, rec, B, height) {
  const r = baseRadius(rec, p.size);
  const pts = seatPoints(p.x, p.z, r, B.seatPoints ?? 6);
  const mid = height(pts[0][0], pts[0][1]);
  let top = mid;
  for (let i = 1; i < pts.length; i++) top = Math.max(top, height(pts[i][0], pts[i][1]));
  return Math.max(mid, top - (B.seatSlack ?? 0) * r);
}

/**
 * Which plants a settled stroke buries. before and after sample the ground before and after the
 * stroke; only plants within `area` (a world rect the stroke touched) are read.
 * @param {any[]} plants growth plants @param {Record<string, any>} flora @param {any} B growth.json bury
 * @param {(x: number, z: number) => number} before @param {(x: number, z: number) => number} after
 * @param {{ x0: number, z0: number, x1: number, z1: number }} area
 * @returns {{ buried: any[], kept: any[] }}
 */
export function buryUnder(plants, flora, B, before, after, area) {
  /** @type {any[]} */ const buried = [], kept = [];
  for (const p of plants) {
    const rec = flora[p.sp];
    const r = rec ? baseRadius(rec, p.size) : 0;
    if (!rec || p.x + r < area.x0 || p.x - r > area.x1 || p.z + r < area.z0 || p.z - r > area.z1) { kept.push(p); continue; }
    const rise = seatHeight(p, rec, B, after) - seatHeight(p, rec, B, before);
    if (rise > buryDepth(rec, p.size, B)) buried.push(p); else kept.push(p);
  }
  return { buried, kept };
}

/**
 * The plants with buried records back (undo): each one not already on the island returns exactly as
 * it was, in id order with the rest. Nothing refuses a restore (maxPlants, budget).
 * @param {any[]} plants @param {any[]} records @returns {any[]}
 */
export function restoreBuried(plants, records) {
  const have = new Set(plants.map((p) => p.id));
  const back = records.filter((q) => !have.has(q.id)).map((q) => ({ ...q }));
  if (!back.length) return plants;
  return [...plants, ...back].sort((a, b) => a.id - b.id);
}

/** The plants without the buried ids (redo). @param {any[]} plants @param {any[]} records */
export function removeBuried(plants, records) {
  const gone = new Set(records.map((q) => q.id));
  return plants.filter((p) => !gone.has(p.id));
}

/**
 * The bury event's payload: how many went, how many were gather plants, by species, and where.
 * @param {any[]} buried @param {Record<string, any>} flora @param {(rec: any) => boolean} isGather
 */
export function buriedSummary(buried, flora, isGather) {
  /** @type {Record<string, { count: number, x: number, z: number, gather: boolean, ids: number[] }>} */ const bySpecies = {};
  let gatherCount = 0, sx = 0, sz = 0;
  for (const p of buried) {
    const g = isGather(flora[p.sp]);
    if (g) gatherCount++;
    const s = bySpecies[p.sp] ??= { count: 0, x: 0, z: 0, gather: g, ids: [] };
    s.count++; s.x += p.x; s.z += p.z; s.ids.push(p.id);
    sx += p.x; sz += p.z;
  }
  for (const s of Object.values(bySpecies)) { s.x /= s.count; s.z /= s.count; }
  const n = Math.max(1, buried.length);
  return { count: buried.length, gatherCount, bySpecies, where: { x: sx / n, z: sz / n }, ids: buried.map((p) => p.id) };
}

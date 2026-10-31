// @ts-check
// Shaped ground (doc 13 "Shaped, not found"; B3 S0): the homes B3's newcomers want, measured from
// the island's own heights and paint on the 1 m habitat grid, the way the dragonflies judge a pond
// the player made (the habitat's shapedCm: how far the ground moved from the island as generated).
// Each check reports numbers and never says no; a species' visit block names the numbers it wants
// (homeOf below; docs/11-creatures-and-ecology.md "Visits and shaped homes"). Homes compete: the
// coast is shared out (shoreShare), and wrack the player gathers is wrack the turnstones don't get.
// Pure and worker-safe; sqrt only. The memory that makes ages and quiet (pond ages, how long wrack
// has lain, where the walker went) is in shaped-live.js; rules from recipes/world/shaped.json.

import { HABITAT_ORIGIN, chamfer } from '../growth/habitat.js';
import { openBox } from './fields.js';
import { waterBodies } from './needs.js';
import { marginReach } from '../shaper.js';

/** Square edges overcount a smooth shore by about 4 / pi (as habitat.js). */
const FACE_M = 0.7853981633974483;

/**
 * @typedef {{ cells: number[], areaM2: number, x: number, z: number, lengthM: number, widthM: number, along: number[] }} Patch
 *   a connected patch of squares: its middle (world m), and its length and width from its spread
 *   (a solid L x W rectangle reads L x W), along: the unit direction of its length [x, z]
 */

/**
 * A patch's middle and spread. Length and width are the patch's extent along the two main axes of
 * its squares (sqrt(12 var + 1), exact for a solid rectangle of squares).
 * @param {number[]} cells @param {number} n @returns {Patch}
 */
export function patchOf(cells, n) {
  let si = 0, sj = 0;
  for (const k of cells) { si += k % n; sj += Math.floor(k / n); }
  const c = cells.length, mi = si / c, mj = sj / c;
  let a = 0, b = 0, d = 0;
  for (const k of cells) { const di = (k % n) - mi, dj = Math.floor(k / n) - mj; a += di * di; b += di * dj; d += dj * dj; }
  a /= c; b /= c; d /= c;
  const half = (a + d) / 2, root = Math.sqrt(((a - d) / 2) ** 2 + b * b);
  const l1 = half + root, l2 = Math.max(0, half - root);
  // The long axis: the eigenvector of the larger spread.
  let ux = b, uz = l1 - a;
  if (Math.abs(ux) + Math.abs(uz) < 1e-9) { ux = a >= d ? 1 : 0; uz = a >= d ? 0 : 1; }
  const ul = Math.sqrt(ux * ux + uz * uz);
  const r2 = (/** @type {number} */ v) => Math.round(v * 100) / 100;
  return { cells, areaM2: c, x: r2(HABITAT_ORIGIN + mi + 0.5), z: r2(HABITAT_ORIGIN + mj + 0.5),
    lengthM: r2(Math.sqrt(12 * l1 + 1)), widthM: r2(Math.sqrt(12 * l2 + 1)), along: [r2(ux / ul), r2(uz / ul)] };
}

/**
 * The connected patches of a mask inside a box, in grid order of their first square.
 * @param {Uint8Array} mask @param {number} n @param {import('./fields.js').Box} box @param {boolean} [eight] eight-connected
 * @returns {number[][]}
 */
export function patches(mask, n, box, eight = false) {
  const seen = new Uint8Array(n * n);
  /** @type {number[][]} */ const out = [];
  const steps = eight ? [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]] : [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (let j = box.j0; j <= box.j1; j++) for (let i = box.i0; i <= box.i1; i++) {
    const k0 = j * n + i;
    if (!mask[k0] || seen[k0]) continue;
    seen[k0] = 1;
    const list = [k0];
    for (let q = 0; q < list.length; q++) {
      const k = list[q], a = k % n, b = Math.floor(k / n);
      for (const [di, dj] of steps) {
        const x = a + di, y = b + dj;
        if (x < box.i0 || y < box.j0 || x > box.i1 || y > box.j1) continue;
        const kk = y * n + x;
        if (mask[kk] && !seen[kk]) { seen[kk] = 1; list.push(kk); }
      }
    }
    out.push(list);
  }
  return out;
}

/** Is any of the four sides of k (in the grid) set in m? @param {Uint8Array} m @param {number} n @param {number} k */
const besideAny = (m, n, k) => {
  const i = k % n;
  return (i > 0 && m[k - 1]) || (i < n - 1 && m[k + 1]) || (k >= n && m[k - n]) || (k + n < n * n && m[k + n]);
};

/** How many of the four sides of k are set in m. @param {Uint8Array} m @param {number} n @param {number} k */
const sidesIn = (m, n, k) => {
  const i = k % n;
  return (i > 0 && m[k - 1] ? 1 : 0) + (i < n - 1 && m[k + 1] ? 1 : 0) + (k >= n && m[k - n] ? 1 : 0) + (k + n < n * n && m[k + n] ? 1 : 0);
};

/**
 * Raised bars in the tide band: ground the player moved (shapedCm), dry at an ordinary low tide and
 * under a spring high tide, each patch of at least minAreaM2 and minWidthM wide, largest first. With its sand share.
 * @param {any} hab @param {any} R recipes/world/shaped.json
 * @returns {(Patch & { sand: number })[]}
 */
export function barsOf(hab, R) {
  if (!hab.heightDm || !hab.shapedCm) return [];
  const n = hab.n, B = R.bar, box = openBox(hab);
  const lo = B.dryAboveM * 10, hi = B.coverBelowM * 10;
  const mask = new Uint8Array(n * n);
  for (let j = box.j0; j <= box.j1; j++) for (let k = j * n + box.i0; k <= j * n + box.i1; k++) {
    if (!hab.open[k] || hab.depthCm[k] > 0) continue;
    const h = hab.heightDm[k];
    if (h > lo && h < hi && hab.shapedCm[k] >= R.shapedCm) mask[k] = 1;
  }
  return patches(mask, n, box).filter((c) => c.length >= B.minAreaM2).map((c) => {
    let sand = 0;
    for (const k of c) sand += hab.sand?.[k] ?? 0;
    return { ...patchOf(c, n), sand: Math.round((sand / c.length / 255) * 100) / 100 };
  }).filter((b) => b.widthM >= (B.minWidthM ?? 0)).sort((a, b) => b.areaM2 - a.areaM2 || a.cells[0] - b.cells[0]);
}

/**
 * The sea and the tide band, as one mask (the waterline's salt side). @param {any} hab
 * @returns {Uint8Array}
 */
const saltSide = (hab) => {
  const m = new Uint8Array(hab.n * hab.n);
  for (let k = 0; k < m.length; k++) if (hab.sea[k] || hab.band?.[k]) m[k] = 1;
  return m;
};

/** The highest ground within one square of k (dm). @param {Int16Array} h @param {number} n @param {number} k */
function topNear(h, n, k) {
  const i = k % n, j = Math.floor(k / n);
  let top = -32768;
  for (let b = Math.max(0, j - 1); b <= Math.min(n - 1, j + 1); b++) for (let a = Math.max(0, i - 1); a <= Math.min(n - 1, i + 1); a++) if (h[b * n + a] > top) top = h[b * n + a];
  return top;
}

/**
 * Terrace sea walls at the waterline: squares painted rock (rockShare) on ground the player moved,
 * steep, in the splash zone, on or beside the sea or the tide band, standing out of the water
 * (topAboveM within one square). Eight-connected runs of at least
 * minCells, longest first. The island's own rocky point is rock but unshaped, so it never counts.
 * @param {any} hab @param {any} R
 * @returns {Patch[]}
 */
export function wallsOf(hab, R) {
  if (!hab.heightDm || !hab.shapedCm || !hab.rock) return [];
  const n = hab.n, W = R.wall, box = openBox(hab, 1);
  const salt = saltSide(hab);
  const rock = W.rockShare * 255, lo = W.lowM * 10, hi = W.highM * 10, top = (W.topAboveM ?? 0) * 10;
  const mask = new Uint8Array(n * n);
  for (let j = box.j0; j <= box.j1; j++) for (let k = j * n + box.i0; k <= j * n + box.i1; k++) {
    // The face itself may stand in the sea at mean tide (its cell's middle is under water).
    if (!hab.open[k]) continue;
    const h = hab.heightDm[k];
    if (hab.rock[k] < rock || hab.shapedCm[k] < R.shapedCm || (hab.slopeDeg?.[k] ?? 0) < W.minSlopeDeg || h < lo || h > hi) continue;
    if ((salt[k] || besideAny(salt, n, k)) && topNear(hab.heightDm, n, k) >= top) mask[k] = 1;
  }
  return patches(mask, n, box, true).filter((c) => c.length >= W.minCells).map((c) => patchOf(c, n))
    .sort((a, b) => b.lengthM - a.lengthM || a.cells[0] - b.cells[0]);
}

/**
 * The bodies of standing fresh water, each with what the eels and teal ask of a pond: its area,
 * whether it was dug (shapedShare of it on shaped ground), how far the sea is (m, up to seaMaxM),
 * whether wet grass leads from its edge to the shore, and the share of its margin with reeds,
 * rushes or iris beside it. Bodies under minAreaM2 are left out. Age comes from shaped-live.js.
 * @param {any} hab @param {{ plants?: { sp: string, x: number, z: number }[], rushes?: Uint8Array | null }} g
 * @param {any} R
 * @returns {(Patch & { deepCm: number, shaped: number, dug: boolean, seaM: number, wetGrass: boolean, reeds: number })[]}
 */
export function pondsOf(hab, g, R) {
  const n = hab.n, P = R.pond, box = openBox(hab, 1);
  const { label, bodies } = waterBodies(hab, box);
  const big = bodies.filter((b) => b.area >= P.minAreaM2);
  if (!big.length) return [];
  const sea = new Uint8Array(n * n);
  for (let k = 0; k < sea.length; k++) if (hab.sea[k]) sea[k] = 1;
  const dSea = chamfer(sea, n, 3 * P.seaMaxM);
  const salt = saltSide(hab);
  const near = marginReach(n, g.plants ?? [], g.rushes ?? null, P.reeds.plants, P.reeds.rushCover);
  /** @type {Map<number, number[]>} */ const cellsOf = new Map(big.map((b) => [b.id, []]));
  for (let j = box.j0; j <= box.j1; j++) for (let k = j * n + box.i0; k <= j * n + box.i1; k++) cellsOf.get(label[k])?.push(k);
  return big.map((b) => {
    const cells = /** @type {number[]} */ (cellsOf.get(b.id));
    const water = new Uint8Array(n * n);
    let shaped = 0, seaD = 3 * P.seaMaxM;
    for (const k of cells) { water[k] = 1; if ((hab.shapedCm?.[k] ?? 0) >= R.shapedCm) shaped++; }
    // Its margin: open land beside its water.
    /** @type {number[]} */ const edge = [];
    const onEdge = new Uint8Array(n * n);
    for (const k of cells) {
      const i = k % n;
      for (const kk of [i > 0 ? k - 1 : -1, i < n - 1 ? k + 1 : -1, k - n, k + n]) {
        if (kk < 0 || kk >= n * n || water[kk] || onEdge[kk] || !hab.open[kk] || hab.sea[kk]) continue;
        onEdge[kk] = 1;
        edge.push(kk);
      }
    }
    for (const k of edge) if (dSea[k] < seaD) seaD = dSea[k];
    let lined = 0;
    for (const k of edge) if (near[k]) lined++;
    const sh = shaped / cells.length;
    return { ...patchOf(cells, n), deepCm: b.deepCm, shaped: Math.round(sh * 100) / 100, dug: sh >= P.shapedShare,
      seaM: Math.round((seaD / 3) * 10) / 10, wetGrass: wetPath(hab, edge, salt, P.wetGrass),
      reeds: edge.length ? Math.round((lined / edge.length) * 100) / 100 : 0 };
  });
}

/**
 * Does a path of wet grass lead from a pond's margin to the shore (a square beside the sea or the
 * tide band)? Through squares with grass and moisture at least the recipe's. Pure.
 * @param {any} hab @param {number[]} edge the pond's margin @param {Uint8Array} salt @param {{ grass: number, moisture: number }} G
 */
export function wetPath(hab, edge, salt, G) {
  const n = hab.n;
  const ok = (/** @type {number} */ k) => hab.open[k] && !hab.sea[k] && hab.depthCm[k] === 0 && hab.grass[k] >= G.grass && hab.moisture[k] >= G.moisture;
  const seen = new Uint8Array(n * n);
  const list = edge.filter((k) => ok(k));
  for (const k of list) seen[k] = 1;
  for (let q = 0; q < list.length; q++) {
    const k = list[q];
    if (salt[k] || besideAny(salt, n, k)) return true;
    const i = k % n;
    for (const kk of [i > 0 ? k - 1 : -1, i < n - 1 ? k + 1 : -1, k - n, k + n]) {
      if (kk < 0 || kk >= n * n || seen[kk] || !ok(kk)) continue;
      seen[kk] = 1;
      list.push(kk);
    }
  }
  return false;
}

/**
 * The coast shared out (homes compete): metres of waterline at mean tide (land squares beside the
 * sea), and how much of it a sea wall, a raised bar or sand holds now. `free` is what is left.
 * @param {any} hab @param {Patch[]} walls @param {Patch[]} bars @param {any} R
 */
export function shoreShare(hab, walls, bars, R) {
  const n = hab.n, box = openBox(hab, 1);
  const sea = new Uint8Array(n * n);
  for (let k = 0; k < sea.length; k++) if (hab.sea[k]) sea[k] = 1;
  const wall = new Uint8Array(n * n), bar = new Uint8Array(n * n);
  // A wall square holds the waterline beside it too (its foot), so grow the walls by one square.
  for (const w of walls) for (const k of w.cells) { wall[k] = 1; const i = k % n; if (i > 0) wall[k - 1] = 1; if (i < n - 1) wall[k + 1] = 1; if (k >= n) wall[k - n] = 1; if (k + n < n * n) wall[k + n] = 1; }
  for (const b of bars) for (const k of b.cells) bar[k] = 1;
  let coast = 0, onWall = 0, onBar = 0, sandy = 0;
  const sandAt = R.shore.sandShare * 255;
  for (let j = box.j0; j <= box.j1; j++) for (let k = j * n + box.i0; k <= j * n + box.i1; k++) {
    if (!hab.open[k] || sea[k]) continue;
    const s = sidesIn(sea, n, k);
    if (!s) continue;
    coast += s;
    if (wall[k]) onWall += s;
    else if (bar[k]) onBar += s;
    else if ((hab.sand?.[k] ?? 0) >= sandAt) sandy += s;
  }
  const m = (/** @type {number} */ s) => Math.round(s * FACE_M * 10) / 10;
  return { coastM: m(coast), wallM: m(onWall), barM: m(onBar), sandM: m(sandy), freeM: m(coast - onWall - onBar) };
}

/**
 * Metres of strandline holding wrack nobody gathered: the strand spots of wrack with some left,
 * each one bin long. @param {{ kind: string, source: string, left: number }[]} spots @param {any} R
 */
export const wrackLyingM = (spots, R) => spots.filter((s) => s.kind === 'wrack' && s.source === 'strand' && s.left > 0).length * R.wrack.binM;

/**
 * Everything the checks report at once (the store slice `shapedNow`), from the habitat and what the
 * live memory adds. Never a rule: just the numbers each species' home asks of.
 * @param {{ hab: any, plants?: any[], rushes?: Uint8Array | null, wrack?: { lyingM: number, days: number },
 *   islet?: any, quiet?: (bar: Patch) => { quiet: boolean, nearM: number | null }, ageOf?: (p: Patch) => number }} inp
 *   wrack: from the live memory; islet: the store slice `islet` (the meadow islet, B3a) when present;
 *   quiet: the seals' quiet near a bar (shaped-live.js); ageOf: a pond's age in game days
 * @param {any} R
 */
export function shapedReport(inp, R) {
  const hab = inp.hab;
  const bars = barsOf(hab, R).map((b) => ({ ...b, ...(inp.quiet ? inp.quiet(b) : { quiet: true, nearM: null }), islet: false }));
  const walls = wallsOf(hab, R);
  const ponds = pondsOf(hab, { plants: inp.plants, rushes: inp.rushes }, R).map((p) => ({ ...p, ageDays: inp.ageOf ? inp.ageOf(p) : 0 }));
  const shore = shoreShare(hab, walls, bars, R);
  // The meadow islet's bar (B3a publishes `islet`): a bar of its own, quiet unless a walker was near.
  const I = inp.islet;
  if (I?.risen && (I.barM2 ?? 0) > 0) {
    const at = I.bar ?? { x: I.x ?? 0, z: I.z ?? 0 };
    const b = /** @type {any} */ ({ cells: [], areaM2: I.barM2, x: at.x, z: at.z, lengthM: I.barLengthM ?? Math.sqrt(I.barM2 * 3), widthM: I.barWidthM ?? Math.sqrt(I.barM2 / 3),
      along: [1, 0], sand: 1, islet: true, risenDay: I.day ?? null });
    Object.assign(b, inp.quiet ? inp.quiet(b) : { quiet: true, nearM: null });
    bars.push(b);
  }
  const strip = (/** @type {any} */ p) => { const { cells, ...rest } = p; return { ...rest, cellCount: cells.length }; };
  return { bars: bars.map(strip), walls: walls.map(strip), ponds: ponds.map(strip), wrack: inp.wrack ?? { lyingM: 0, days: 0 }, shore,
    _cells: { bars: bars.map((b) => b.cells), walls: walls.map((w) => w.cells), ponds: ponds.map((p) => p.cells) } };
}

/**
 * The candidates a home check reads in a report. @param {any} report @param {string} check
 * @returns {any[]}
 */
export function candidatesOf(report, check) {
  if (check === 'bar') return report?.bars ?? [];
  if (check === 'wall') return report?.walls ?? [];
  if (check === 'pond') return (report?.ponds ?? []).filter((/** @type {any} */ p) => p.dug);
  if (check === 'wrack') return report?.wrack ? [report.wrack] : [];
  return [];
}

/**
 * How near a candidate comes to a home (0..1, 1 when every need is met): each `need` field at least
 * its value (true: the field must hold), each `max` field at most its value; the weakest decides.
 * @param {any} c @param {{ need?: Record<string, number | boolean>, max?: Record<string, number> }} H
 */
export function homeFit(c, H) {
  let fit = 1;
  for (const [key, want] of Object.entries(H.need ?? {})) {
    const v = c[key];
    if (typeof want === 'boolean') { if (!!v !== want) fit = 0; continue; }
    const f = want > 0 ? Math.max(0, Math.min(1, (Number(v) || 0) / want)) : 1;
    if (f < fit) fit = f;
  }
  for (const [key, most] of Object.entries(H.max ?? {})) {
    const v = Number(c[key]);
    const f = !Number.isFinite(v) ? 0 : v <= most ? 1 : Math.max(0, most / v);
    if (f < fit) fit = f;
  }
  return Math.round(fit * 1000) / 1000;
}

/**
 * The best home a species' visit block finds in a report: { met, fit, best } (best: the candidate
 * that fits most, the first of them on a tie; null with none).
 * @param {any} report @param {{ check: string, need?: any, max?: any } | undefined} H ecology.visit.home
 */
export function homeOf(report, H) {
  if (!H) return { met: false, fit: 0, best: null };
  let best = null, fit = -1;
  for (const c of candidatesOf(report, H.check)) { const f = homeFit(c, H); if (f > fit) { fit = f; best = c; } }
  return { met: fit >= 1, fit: Math.max(0, fit), best };
}

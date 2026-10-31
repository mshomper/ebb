// @ts-check
// The keepsake shelf at camp, pure (B2, Matt, October 30, 2026; docs/future/12, docs/future/13): how
// a kept keepsake sits in its spot on the shelf, and where the shelf's spots and letter tin are in the
// world. A keepsake's mesh is built lying on the sand (src/world/keepsakes/families); here it is
// turned to suit the shelf (a bottle stood on its base, a flat thing leant back against the boards,
// anything long laid along the plank), given a small seeded turn, sized up to the findable scale and
// into its spot, and set with the middle of its base on the plank's top. Numbers: recipes/world/
// camp.json keepsakeShelf.

import { hash32 } from '../../core/rng.js';
import { rollKeepsake } from '../keepsakes/families/index.js';
import { emptyShelf, keep, SHELF_CAP } from '../keepsakes/shelf.js';

/** @typedef {import('../finds/procedural.js').Mesh} Mesh */

/**
 * The bounds of a mesh's points (9 floats a vertex: position, normal, colour).
 * @param {Float32Array} v @param {number} count @returns {{ lo: number[], hi: number[] }}
 */
export function meshBounds(v, count) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) for (let a = 0; a < 3; a++) {
    const x = v[i * 9 + a];
    if (x < lo[a]) lo[a] = x;
    if (x > hi[a]) hi[a] = x;
  }
  return { lo, hi };
}

/**
 * Turn every point and normal of a mesh in place by a 3 x 3 matrix (rows).
 * @param {Float32Array} v @param {number} count @param {number[]} m
 */
function turn(v, count, m) {
  for (let i = 0; i < count; i++) for (const o of [0, 3]) {
    const k = i * 9 + o, x = v[k], y = v[k + 1], z = v[k + 2];
    v[k] = m[0] * x + m[1] * y + m[2] * z;
    v[k + 1] = m[3] * x + m[4] * y + m[5] * z;
    v[k + 2] = m[6] * x + m[7] * y + m[8] * z;
  }
}

/** Turned about +y by a (radians; +z toward +x as a grows). @param {number} a */
const aboutY = (a) => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
/** About +x by a: its back edge (-z) rises and its top faces the front (+z). @param {number} a */
const aboutX = (a) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
/** Stood up: its +x (a bottle's axis, base at -x) becomes +y. */
const standUp = [0, -1, 0, 1, 0, 0, 0, 0, 1];

/**
 * How a keepsake sits on the shelf: its lying mesh turned, sized and set in its spot, in the shelf's
 * frame (x along the plank, y up, z toward the front) with the middle of its base at the origin.
 * Pure: the same keepsake always sits the same way. @param {Mesh} mesh as built (lying on the sand)
 * @param {any} n its numbers (family) @param {any} S camp.json keepsakeShelf @param {number} seed the shelf entry's
 * @returns {{ mesh: Mesh, size: number[], pose: 'lie' | 'stand' | 'lean' }} size: its width, height and depth on the shelf (m)
 */
export function shelfFit(mesh, n, S, seed) {
  const F = S.fit, fam = S.families?.[n.family] ?? {};
  const v = mesh.vertices.slice(), count = mesh.count;
  const u = (/** @type {number} */ q) => (hash32(seed >>> 0, q) >>> 8) / 16777216;
  /** @type {'lie' | 'stand' | 'lean'} */ const pose = fam.stand ? 'stand' : fam.leanDeg ? 'lean' : 'lie';
  if (pose === 'stand') {
    // Stood on its base, turned a little about its own axis so the label side varies.
    turn(v, count, standUp);
    turn(v, count, aboutY(u(1) * 2 * Math.PI));
  } else {
    // Its longer side along the plank (one to lean, front to back, so leaning stands it up), then a
    // small seeded turn.
    const b = meshBounds(v, count), deeper = b.hi[2] - b.lo[2] > b.hi[0] - b.lo[0];
    const along = deeper !== (pose === 'lean') ? Math.PI / 2 : 0;
    turn(v, count, aboutY(along + (u(2) - 0.5) * 2 * (F.jitterDeg * Math.PI) / 180));
    if (pose === 'lean') turn(v, count, aboutX((fam.leanDeg * Math.PI) / 180));
  }
  // Sized: at the findable scale, at least minM along its longest side, and never more than the spot holds.
  const b = meshBounds(v, count);
  const w = b.hi[0] - b.lo[0], h = b.hi[1] - b.lo[1], d = b.hi[2] - b.lo[2], longest = Math.max(w, h, d) || 1;
  const s = Math.min(Math.max(F.scale, F.minM / longest), F.maxWideM / (w || 1), F.maxHighM / (h || 1), F.maxDeepM / (d || 1));
  // A leaning thing rests against the back: its middle set back by backM.
  const cx = (b.lo[0] + b.hi[0]) / 2, cz = (b.lo[2] + b.hi[2]) / 2 + (pose === 'lean' ? (F.leanBackM ?? 0) / s : 0);
  for (let i = 0; i < count; i++) {
    const k = i * 9;
    v[k] = (v[k] - cx) * s;
    v[k + 1] = (v[k + 1] - b.lo[1]) * s;
    v[k + 2] = (v[k + 2] - cz) * s;
  }
  return { mesh: { vertices: v, count, indices: mesh.indices }, size: [w * s, h * s, d * s], pose };
}

/**
 * A point in the shelf model's frame (x across, y up, z out of its front), in the world.
 * @param {{ x: number, y: number, z: number, yaw: number }} at where the shelf stands, its +z turned by yaw
 * @param {number[]} p @returns {number[]}
 */
export function shelfPoint(at, p) {
  const c = Math.cos(at.yaw), s = Math.sin(at.yaw);
  return [at.x + c * p[0] + s * p[2], at.y + p[1], at.z - s * p[0] + c * p[2]];
}

/**
 * Where a view ray first meets a box in the shelf's frame (x across, y up from its base, z out of its
 * front), or Infinity. @param {number[]} o @param {number[]} d the ray, world meters
 * @param {{ x: number, y: number, z: number, yaw: number }} at @param {number[]} lo @param {number[]} hi the box's corners
 */
export function rayShelfBox(o, d, at, lo, hi) {
  const c = Math.cos(at.yaw), s = Math.sin(at.yaw);
  // Into the shelf's frame: the inverse of shelfPoint.
  const ox = o[0] - at.x, oz = o[2] - at.z;
  const lo3 = [c * ox - s * oz, o[1] - at.y, s * ox + c * oz], ld = [c * d[0] - s * d[2], d[1], s * d[0] + c * d[2]];
  let t0 = 0, t1 = Infinity;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(ld[a]) < 1e-12) { if (lo3[a] < lo[a] || lo3[a] > hi[a]) return Infinity; continue; }
    let ta = (lo[a] - lo3[a]) / ld[a], tb = (hi[a] - lo3[a]) / ld[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return Infinity;
  }
  return t0 > 0 ? t0 : Infinity;
}

/**
 * Where the camera eases to when the shelf is clicked from above: its eye at the model's look_from
 * point, looking down at its pitch toward the plane of the spots (the view holds that height as its
 * target), no nearer than look.minDistanceM: further back along the same line, so all of it is in view. Pure.
 * @param {{ x: number, y: number, z: number, yaw: number }} at @param {any} S camp.json keepsakeShelf
 * @returns {{ target: number[], distance: number, pitchDeg: number, yaw: number }}
 */
export function shelfLook(at, S) {
  const L = S.look, run = L.fromM[2] - S.slotsM[0][2], drop = run * Math.tan((L.pitchDeg * Math.PI) / 180);
  const target = shelfPoint(at, [L.fromM[0], L.fromM[1] - drop, S.slotsM[0][2]]);
  return { target, distance: Math.max(Math.hypot(run, drop), L.minDistanceM ?? 0), pitchDeg: L.pitchDeg, yaw: at.yaw };
}

/** The families the test shelf draws from, in turn (the artifacts wait for their bases to load). */
const TEST_FAMILIES = ['bottle', 'shell', 'starfish', 'driftwood', 'stone', 'feather', 'urchin', 'purse', 'fossil', 'coral', 'cuttlebone', 'seed', 'bivalve', 'sherd', 'bottle', 'shell'];
const TEST_RARITY = ['common', 'uncommon', 'rare', 'common', 'veryRare', 'uncommon', 'common', 'rare'];

/**
 * A shelf of `count` keepsakes, one of each family in turn at a spread of rarities, the same every
 * time (the test link `?camp=shelf`). Pure. @param {any} K keepsakes.json @param {number} count
 * @param {number} hour when they were kept @returns {import('../keepsakes/shelf.js').ShelfState}
 */
export function testShelf(K, count, hour) {
  let s = emptyShelf();
  for (let i = 0; i < Math.min(count, SHELF_CAP); i++) {
    const n = rollKeepsake(TEST_FAMILIES[i], 0x5e1f, i, K, { spring: 0, season: 'summer' }, TEST_RARITY[i % TEST_RARITY.length]);
    s = keep(s, { n, hour: Math.max(0, hour - 24 * (SHELF_CAP - i)), spring: i % 3 === 0 }).state;
  }
  return s;
}

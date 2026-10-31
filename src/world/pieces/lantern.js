// @ts-check
// The lantern (B2 L1, Matt, October 30, 2026): a placed piece of kind 'lantern', the shaper's trail's
// gift for a pond of your own with no fish. A short stick post with a pierced clay pot on top and a
// rush tie, set where you like; it lights itself every dusk and goes out at dawn, with no fuel and
// nothing to tend. Whether it is lit comes from the sun alone (the clock), so nothing about the light
// is saved and time away needs no catch-up. Pure: the record, the glow, the place rules, the meshes
// (the props pass's layout: position, normal, uv; 8 floats a vertex). The live side is lantern-live.js.
// Numbers and words: recipes/world/pieces.json lantern.
//
// A record: { id, kind: 'lantern', x, z, yaw, seed, size, placedHour }: size its footprint (m), seed
// its turn and the post's lean.

import { hash32 } from '../../core/rng.js';
import { stick } from '../hen/perch.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
/** @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;

/** @typedef {{ data: Float32Array, indices: Uint32Array }} PropMesh */

/**
 * A new lantern record, seeded from the island's piece seed and its number.
 * @param {number} piecesSeed subSeed(worldSeed, 'pieces') @param {number} n its number (the id is p<n>)
 * @param {number} x @param {number} z @param {number} hour @param {any} L pieces.json lantern
 */
export function makeLantern(piecesSeed, n, x, z, hour, L) {
  const seed = hash32(piecesSeed, n, 0x1a7) >>> 0;
  return { id: `p${n}`, kind: /** @type {'lantern'} */ ('lantern'), x, z, yaw: u01(hash32(seed, 1)) * TAU, seed, size: L.sizeM, placedHour: hour };
}

/**
 * How lit a lantern is at a sun altitude: 0 by day, easing up from litAtSunDeg to full at
 * fullAtSunDeg (and down the same way at dawn). @param {number} sunAltDeg @param {any} light pieces.json lantern.light
 */
export function lanternGlow(sunAltDeg, light) {
  const t = (light.litAtSunDeg - sunAltDeg) / Math.max(1e-6, light.litAtSunDeg - light.fullAtSunDeg);
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
}

/**
 * The post's lean (radians from upright) and which way it leans (radians about y), from the seed.
 * @param {{ seed: number }} p @param {any} L
 */
export function leanOf(p, L) {
  return { tilt: u01(hash32(p.seed, 2)) * L.post.leanDeg * DEG, dir: u01(hash32(p.seed, 3)) * TAU };
}

/**
 * Where the pot sits (its foot on the post's top) and its middle, the light's place, for a lantern
 * standing on ground at height y. @param {{ x: number, z: number, seed: number }} p @param {number} y @param {any} L
 * @returns {{ top: number[], glass: number[], tilt: number, dir: number }}
 */
export function lanternAt(p, y, L) {
  const { tilt, dir } = leanOf(p, L);
  const h = L.post.heightM, off = Math.sin(tilt) * h;
  const top = [p.x + Math.sin(dir) * off, y + Math.cos(tilt) * h, p.z + Math.cos(dir) * off];
  return { top, glass: [top[0], top[1] + L.pot.heightM * 0.5, top[2]], tilt, dir };
}

/**
 * May a lantern stand at a point? On dry land (no water over it), off the camp ground, at least
 * apartM from another lantern. @param {{ depth: number, camp: boolean, others: { x: number, z: number }[] }} at
 * @param {number} x @param {number} z @param {any} L @returns {boolean}
 */
export function mayStand(at, x, z, L) {
  if (at.depth > 0.01 || at.camp) return false;
  return at.others.every((q) => Math.hypot(q.x - x, q.z - z) >= L.apartM);
}

/**
 * How many lanterns the island has or has coming: standing, in the pack (fired pots and made
 * lanterns), pale on the workbench and at the fire. The make is offered while this is under the cap.
 * @param {{ standing: number, pouches: [string, number][], shaped: string[], work: { id: string }[] }} o
 */
export function lanternsOwned(o) {
  let n = o.standing;
  for (const [kind, h] of o.pouches) if (kind === 'post-lantern' || kind === 'lantern-pot') n += h;
  n += o.shaped.filter((k) => k === 'lantern-pot').length;
  n += o.work.filter((w) => w.id === 'fire-lantern-pot').length;
  return n;
}

/**
 * A surface turned round the y axis from a profile of [radius, height] points, bottom to top
 * (radius 0 closes an end), `around` segments round. @param {number[]} V @param {number[]} I
 * @param {[number, number][]} prof @param {number} around
 */
function lathe(V, I, prof, around) {
  const base = V.length / 8;
  for (let k = 0; k < prof.length; k++) {
    const a = prof[Math.max(0, k - 1)], b = prof[Math.min(prof.length - 1, k + 1)];
    // The profile's outward normal: its tangent turned a quarter.
    let nr = b[1] - a[1], ny = -(b[0] - a[0]);
    const l = Math.hypot(nr, ny) || 1;
    nr /= l; ny /= l;
    for (let s = 0; s <= around; s++) {
      const t = (s / around) * TAU, c = Math.cos(t), sn = Math.sin(t);
      V.push(prof[k][0] * sn, prof[k][1], prof[k][0] * c, nr * sn, ny, nr * c, s / around, k / (prof.length - 1));
    }
  }
  for (let k = 0; k < prof.length - 1; k++) for (let s = 0; s < around; s++) {
    const p = base + k * (around + 1) + s, q = p + 1, P = p + around + 1, Q = P + 1;
    I.push(p, q, P, q, Q, P);
  }
}

/**
 * The clay pot: a round-bellied housing, its foot at the origin, a shoulder closing to a short neck
 * and a knob of a lid. Drawn on its own (pale on the workbench, firing at the ring) and on a post.
 * @param {any} L pieces.json lantern @returns {PropMesh}
 */
export function potMesh(L) {
  const P = L.pot, r = P.radiusM, h = P.heightM, k = P.knobM;
  /** @type {number[]} */ const V = [];
  /** @type {number[]} */ const I = [];
  /** @type {[number, number][]} */
  const prof = [[0, 0], [r * 0.55, 0], [r * 0.82, h * 0.08], [r * 0.98, h * 0.3], [r, h * 0.48], [r * 0.93, h * 0.68], [r * 0.72, h * 0.86],
    [r * 0.42, h * 0.97], [r * 0.4, h], [k * 0.7, h + k * 0.15], [k * 0.55, h + k * 0.7], [0, h + k]];
  lathe(V, I, prof, 18);
  return { data: new Float32Array(V), indices: new Uint32Array(I) };
}

/**
 * The pot's holes, the dark of the pierced clay (by day; at night the glow shows through them):
 * small discs a hair proud of its belly, rows rows round, staggered. @param {any} L @returns {PropMesh}
 */
export function holesMesh(L) {
  const P = L.pot, r = P.radiusM, h = P.heightM, hr = P.holeM / 2;
  /** @type {number[]} */ const V = [];
  /** @type {number[]} */ const I = [];
  // Heights and radii on the belly (from the profile above), and how many holes round at each.
  const bands = [[h * 0.3, r * 0.98, 9], [h * 0.48, r, 10], [h * 0.68, r * 0.93, 9]].slice(0, P.rows);
  bands.forEach(([y, rr, n], row) => {
    for (let i = 0; i < n; i++) {
      const t = ((i + (row % 2) * 0.5) / n) * TAU, nx = Math.sin(t), nz = Math.cos(t);
      const c = [nx * (rr + 0.0012), y, nz * (rr + 0.0012)], ux = [nz, 0, -nx];
      const base = V.length / 8;
      V.push(c[0], c[1], c[2], nx, 0, nz, 0.5, 0.5);
      for (let s = 0; s <= 6; s++) {
        const a = (s / 6) * TAU, cs = Math.cos(a) * hr, sn = Math.sin(a) * hr;
        V.push(c[0] + ux[0] * cs, c[1] + sn, c[2] + ux[2] * cs, nx, 0, nz, 0.5, 0.5);
      }
      for (let s = 0; s < 6; s++) I.push(base, base + 1 + s, base + 2 + s);
    }
  });
  return { data: new Float32Array(V), indices: new Uint32Array(I) };
}

/**
 * The post: a stick from below the ground up to heightM, upright (the draw leans it), its top
 * where the pot's foot sits. @param {any} L @returns {PropMesh}
 */
export function postMesh(L) {
  const T = L.post;
  /** @type {number[]} */ const V = [];
  /** @type {number[]} */ const I = [];
  stick(V, I, [0, -T.sinkM, 0], [0, T.heightM, 0], T.radiusM, T.topRadiusM, 8);
  return { data: new Float32Array(V), indices: new Uint32Array(I) };
}

/**
 * The rush tie round the post, a short band bandAtM of the way up, a little proud of the stick.
 * @param {any} L @returns {PropMesh}
 */
export function bandMesh(L) {
  const T = L.post, y = T.heightM * T.bandAtM, r = T.radiusM + (T.topRadiusM - T.radiusM) * T.bandAtM + 0.004;
  /** @type {number[]} */ const V = [];
  /** @type {number[]} */ const I = [];
  stick(V, I, [0, y - T.bandM / 2, 0], [0, y + T.bandM / 2, 0], r, r, 8);
  return { data: new Float32Array(V), indices: new Uint32Array(I) };
}

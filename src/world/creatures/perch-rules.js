// @ts-check
// Perch stick rules (B1 P1, docs/future/13 8.3 F-07): a new stick's record, where one can stand, its
// tip and its mesh, and whether a tap's ray meets it. Pure and worker-safe; the live side is
// perch-sticks.js. Numbers: recipes/world/treats.json perch.

import { hash32 } from '../../core/rng.js';
import { WATER_CLASS } from '../water/summary.js';

/** @param {number} h */
export const u01 = (h) => (h >>> 8) / 16777216;
/** @param {number[]} r @param {number} u */
export const span = (r, u) => r[0] + (r[1] - r[0]) * u;

/**
 * A new perch stick standing in water `depth` deep: its height (the depth, its foot in the bed and
 * aboveM over the water) and its seed from the island's piece seed and its number. Pure.
 * @param {number} piecesSeed subSeed(worldSeed, 'pieces') @param {number} n its number (id p<n>)
 * @param {number} x @param {number} z @param {number} depth @param {number} hour @param {any} P treats.json perch
 */
export function makePerch(piecesSeed, n, x, z, depth, hour, P) {
  const seed = hash32(piecesSeed, n, 0x9e7c);
  const size = Math.round((P.sinkM + depth + span(P.aboveM, u01(hash32(seed, 1)))) * 1000) / 1000;
  return { id: `p${n}`, kind: 'perch', x, z, yaw: 0, seed, size, placedHour: hour };
}

/**
 * Where a stick can stand along the line from (x, z) toward its heading: the first point out to
 * wadeM whose water is fresh and still (not the sea) and between shallowM deep. Pure.
 * @param {number} x @param {number} z @param {number} dx @param {number} dz unit heading
 * @param {(x: number, z: number) => { depth: number, cls: number }} at the water there
 * @param {any} P treats.json perch @param {number} [fromM] where along the line to start
 * @returns {{ x: number, z: number, depth: number } | null}
 */
export function shallowsAlong(x, z, dx, dz, at, P, fromM = 0) {
  for (let s = fromM; s <= Math.max(fromM, P.wadeM) + 1e-6; s += 0.1) {
    const px = x + dx * s, pz = z + dz * s, w = at(px, pz);
    if (w.cls === WATER_CLASS.sea || w.cls === WATER_CLASS.dry) continue;
    if (w.depth >= P.shallowM[0] && w.depth <= P.shallowM[1]) return { x: px, z: pz, depth: w.depth };
  }
  return null;
}

/**
 * A stick's tip, where a dragonfly lands, from its foot (x, bed - sinkM, z). The lean is baked into
 * its mesh (perchMesh), so this is the same point the drawing ends at. Pure.
 * @param {{ x: number, z: number, seed: number, size: number }} p @param {number} bed @param {any} P
 */
export function perchTip(p, bed, P) {
  const L = leanOf(p, P);
  return { x: p.x + L.ax * p.size, y: bed - P.sinkM + L.ay * p.size, z: p.z + L.az * p.size };
}

/** A stick's lean: its axis (unit) from its seed. @param {{ seed: number }} p @param {any} P */
function leanOf(p, P) {
  const lean = (span(P.leanDeg, u01(hash32(p.seed, 2))) * Math.PI) / 180, dir = u01(hash32(p.seed, 3)) * Math.PI * 2;
  return { ax: Math.sin(lean) * Math.cos(dir), ay: Math.cos(lean), az: Math.sin(lean) * Math.sin(dir), dir };
}

/**
 * A stick's mesh, in meters from its foot (the pieces pass draws it at size 1, yaw 0): a tapered
 * rod along its leaning axis, thinning to tipShare at the top, a side twig, darker where it stood
 * wet below waterM. Vertex albedo is linear (docs/05). Pure.
 * @param {{ seed: number, size: number }} p @param {number} waterM height of the water over its foot (m)
 * @param {any} P treats.json perch
 * @returns {{ vertices: Float32Array, count: number, indices: Uint32Array }}
 */
export function perchMesh(p, waterM, P) {
  const L = leanOf(p, P), r0 = span(P.radiusM, u01(hash32(p.seed, 4)));
  /** @type {number[]} */ const v = [];
  /** @type {number[]} */ const idx = [];
  // A frame across the axis, for the rings.
  const ax = [L.ax, L.ay, L.az];
  const side = norm(cross(ax, [0, 0, 1]));
  const up2 = cross(side, ax);
  /**
   * One tapered rod from base b along unit axis d, length len, radius ra to rb.
   * @param {number[]} b @param {number[]} d @param {number} len @param {number} ra @param {number} rb
   */
  const rod = (b, d, len, ra, rb) => {
    const s1 = norm(cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), s2 = cross(s1, d);
    const A = 6, R = 6, first = v.length / 9;
    for (let k = 0; k <= R; k++) {
      const t = k / R, r = ra + (rb - ra) * t;
      const c = [b[0] + d[0] * len * t, b[1] + d[1] * len * t, b[2] + d[2] * len * t];
      const wet = c[1] < waterM + 0.02;
      const tone = 0.9 + 0.2 * u01(hash32(p.seed, 10, k));
      const col = (wet ? P.wetColor : P.color).map((/** @type {number} */ q) => q * tone);
      for (let j = 0; j < A; j++) {
        const a = (j / A) * Math.PI * 2, n = [s1[0] * Math.cos(a) + s2[0] * Math.sin(a), s1[1] * Math.cos(a) + s2[1] * Math.sin(a), s1[2] * Math.cos(a) + s2[2] * Math.sin(a)];
        v.push(c[0] + n[0] * r, c[1] + n[1] * r, c[2] + n[2] * r, n[0], n[1], n[2], col[0], col[1], col[2]);
      }
    }
    for (let k = 0; k < R; k++) for (let j = 0; j < A; j++) {
      const a = first + k * A + j, b2 = first + k * A + ((j + 1) % A), c = a + A, d2 = b2 + A;
      idx.push(a, c, b2, b2, c, d2);
    }
    // A cap on the top end.
    const top = v.length / 9, tc = [b[0] + d[0] * len, b[1] + d[1] * len, b[2] + d[2] * len];
    v.push(tc[0], tc[1], tc[2], d[0], d[1], d[2], P.color[0], P.color[1], P.color[2]);
    for (let j = 0; j < A; j++) idx.push(first + R * A + j, top, first + R * A + ((j + 1) % A));
  };
  rod([0, 0, 0], ax, p.size, r0, r0 * P.tipShare);
  // The side twig, turned out from the axis toward a seeded side.
  const T = P.twig, at = span(T.atShare, u01(hash32(p.seed, 5))) * p.size, turn = u01(hash32(p.seed, 6)) * Math.PI * 2;
  const out = norm([side[0] * Math.cos(turn) + up2[0] * Math.sin(turn), side[1] * Math.cos(turn) + up2[1] * Math.sin(turn), side[2] * Math.cos(turn) + up2[2] * Math.sin(turn)]);
  const tw = (T.deg * Math.PI) / 180;
  const td = norm([ax[0] * Math.cos(tw) + out[0] * Math.sin(tw), ax[1] * Math.cos(tw) + out[1] * Math.sin(tw), ax[2] * Math.cos(tw) + out[2] * Math.sin(tw)]);
  const rAt = r0 + (r0 * P.tipShare - r0) * (at / p.size);
  rod([ax[0] * at, ax[1] * at, ax[2] * at], td, span(T.lenM, u01(hash32(p.seed, 7))), rAt * T.radiusShare, rAt * T.radiusShare * 0.4);
  return { vertices: new Float32Array(v), count: v.length / 9, indices: new Uint32Array(idx) };
}

/**
 * How near a ray passes a stick (its axis from foot to tip), and how far along the ray. Pure.
 * @param {number[]} ro @param {number[]} rd unit direction @param {number[]} a foot @param {number[]} b tip
 */
export function rayToSegment(ro, rd, a, b) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [ro[0] - a[0], ro[1] - a[1], ro[2] - a[2]];
  const uu = u[0] * u[0] + u[1] * u[1] + u[2] * u[2], ud = u[0] * rd[0] + u[1] * rd[1] + u[2] * rd[2];
  const uw = u[0] * w[0] + u[1] * w[1] + u[2] * w[2], dw = rd[0] * w[0] + rd[1] * w[1] + rd[2] * w[2];
  const den = uu - ud * ud;
  // s along the stick (0 foot .. 1 tip), t along the ray.
  let s = den > 1e-9 ? Math.min(1, Math.max(0, (uw - ud * dw) / den)) : 0;
  let t = Math.max(0, ud * s - dw);
  s = Math.min(1, Math.max(0, (uw + t * ud) / Math.max(uu, 1e-9)));
  t = Math.max(0, ud * s - dw);
  const px = ro[0] + rd[0] * t - (a[0] + u[0] * s), py = ro[1] + rd[1] * t - (a[1] + u[1] * s), pz = ro[2] + rd[2] * t - (a[2] + u[2] * s);
  return { d: Math.hypot(px, py, pz), t };
}

/** @param {number[]} a @param {number[]} b */
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** @param {number[]} a */
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

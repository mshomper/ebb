// @ts-check
// The moon jellyfish stranded on the strandline (doc 13, summer), built from shape with no model
// file: a low glassy bell slumped flat on the sand, its margin in eight shallow lobes, and the four
// pale violet horseshoes (the gonads) inside it, seen through the clear bell. Drawn by its own
// translucent pass (render/passes/jelly.js). Each vertex carries a physical albedo (what the
// jelly scatters) and an optical depth (how much of the light through it is scattered rather than
// passed on), so the look comes from light, not from painted color. Pure and seeded: the same
// recipe gives the same meshes on every load.

import { hash32 } from '../../core/rng.js';

/** Floats a vertex: position 3, normal 3, albedo 3, optical depth 1. */
export const JELLY_FLOATS = 10;

/** @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;

/**
 * The bell's outline radius at an angle, in widths (about 0.5): eight shallow marginal lobes and a
 * seeded slump to one side, as a stranded bell spreads unevenly.
 * @param {number} a @param {any} S recipe shape @param {{ slump: number, slumpA: number }} v
 */
export function bellRadius(a, S, v) {
  return 0.5 * (1 + S.lobe * Math.cos(8 * a) + v.slump * Math.cos(a - v.slumpA));
}

/**
 * The bell's height at a share of its radius (0 middle, 1 margin), in widths.
 * @param {number} rho @param {any} S
 */
export function bellHeight(rho, S) {
  const t = Math.max(0, 1 - rho * rho);
  return S.heightShare * Math.pow(t, S.profile);
}

/**
 * One jellyfish mesh, one meter wide (scaled to its size when drawn), lying on y = 0.
 * Index order matters to the translucent pass: the horseshoes first, then the bell over them.
 * @param {any} S finds.json kinds.moonjelly.shape @param {number} variant
 * @returns {{ vertices: Float32Array, indices: Uint32Array, count: number }}
 */
export function jellyMesh(S, variant) {
  const h = hash32(S.seed, variant);
  const v = { slump: S.slump * u01(hash32(h, 1)), slumpA: u01(hash32(h, 2)) * Math.PI * 2 };
  /** @type {number[]} */ const V = [];
  /** @type {number[]} */ const I = [];
  const rings = S.rings, segs = S.segments;
  /** A point on the bell's top at polar (rho share of the radius, angle a). */
  const at = (/** @type {number} */ rho, /** @type {number} */ a) => {
    const R = bellRadius(a, S, v);
    return [Math.cos(a) * R * rho, bellHeight(rho, S), Math.sin(a) * R * rho];
  };
  /** The top's normal there, from nearby points. */
  const normal = (/** @type {number} */ rho, /** @type {number} */ a) => {
    const e = 1e-3;
    const pr = at(Math.min(1, rho + e), a), pm = at(Math.max(0, rho - e), a);
    const pa = at(Math.max(rho, e), a + e), pb = at(Math.max(rho, e), a - e);
    const dr = [pr[0] - pm[0], pr[1] - pm[1], pr[2] - pm[2]];
    const da = [pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]];
    let n = [da[1] * dr[2] - da[2] * dr[1], da[2] * dr[0] - da[0] * dr[2], da[0] * dr[1] - da[1] * dr[0]];
    if (n[1] < 0) n = n.map((x) => -x);
    const l = Math.hypot(n[0], n[1], n[2]);
    return !(l > 1e-12) ? [0, 1, 0] : [n[0] / l, n[1] / l, n[2] / l];
  };
  const push = (/** @type {number[]} */ p, /** @type {number[]} */ n, /** @type {number[]} */ c, /** @type {number} */ tau) => {
    V.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2], tau);
    return V.length / JELLY_FLOATS - 1;
  };

  // The four horseshoes: arcs about their middles, open toward the bell's middle, a little under
  // the top so the clear bell lies over them.
  const G = S.gonads;
  for (let q = 0; q < 4; q++) {
    const phi = Math.PI / 4 + (q * Math.PI) / 2 + (u01(hash32(h, 10 + q)) - 0.5) * G.jitter;
    const cx = Math.cos(phi) * G.atShare * 0.5, cz = Math.sin(phi) * G.atShare * 0.5;
    const sweep = (G.sweepDeg * Math.PI) / 180;
    // The gap faces in, toward the middle: the arc is centered on the outward direction.
    const a0 = phi - sweep / 2, n = G.steps;
    const first = V.length / JELLY_FLOATS;
    for (let s = 0; s <= n; s++) {
      const a = a0 + (sweep * s) / n;
      // The ends taper, as the living horseshoes do.
      const taper = Math.sin((Math.PI * s) / n) ** 0.35;
      for (const side of [-1, 1]) {
        const r = G.radiusShare * 0.5 + side * G.bandShare * 0.5 * taper;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        const rho = Math.hypot(x, z) / bellRadius(Math.atan2(z, x), S, v);
        const y = bellHeight(rho, S) * (1 - G.depthShare);
        push([x, y, z], normal(rho, Math.atan2(z, x)), G.albedo, G.tau);
      }
    }
    for (let s = 0; s < n; s++) {
      const i = first + s * 2;
      I.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
    }
  }

  // The bell: a polar grid from the middle out to the margin. Its optical depth follows its
  // thickness (the bell is solid jelly, thickest in the middle), with a denser rim where the
  // short marginal tentacles lie in a fringe.
  const centre = push(at(0, 0), [0, 1, 0], S.albedo, S.tau);
  for (let r = 1; r <= rings; r++) {
    const rho = r / rings;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const thick = bellHeight(rho, S) / S.heightShare;
      const rim = Math.max(0, (rho - (1 - S.rimShare)) / S.rimShare);
      const tau = S.tau * thick + S.rimTau * rim * rim;
      const c = S.albedo.map((/** @type {number} */ x, /** @type {number} */ i) => x + (S.rimAlbedo[i] - x) * rim);
      push(at(rho, a), normal(rho, a), c, tau);
    }
  }
  // Ring r (1..rings) starts at centre + 1 + (r - 1) * segs.
  const ring = (/** @type {number} */ r, /** @type {number} */ s) => centre + 1 + (r - 1) * segs + (s % segs);
  for (let s = 0; s < segs; s++) I.push(centre, ring(1, s + 1), ring(1, s));
  for (let r = 1; r < rings; r++) {
    for (let s = 0; s < segs; s++) I.push(ring(r, s), ring(r, s + 1), ring(r + 1, s), ring(r + 1, s), ring(r, s + 1), ring(r + 1, s + 1));
  }
  return { vertices: new Float32Array(V), indices: new Uint32Array(I), count: V.length / JELLY_FLOATS };
}

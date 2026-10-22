// @ts-check
// Life under a log (docs/future/11 L3a): a woodlouse and a violet ground beetle, built from the
// numbers in under-log.json (each kind's `shape`) with no model file, in the creature pass's layout
// (position, normal, linear albedo: 9 floats), meters at real size, base on y = 0, facing +z, legs
// out along x. Each mesh also carries `bind` for leg-rig.js: the bone and weight of every vertex,
// each leg's root and each antenna's base, so the legs step without being guessed from the outline.
//
// Woodlouse: seven arched plates laid like roof tiles (each one's back edge over the next one's
// front), pale along their rims, a small head with two long elbowed antennae, a narrow tail of three
// small plates and a point, two short prongs behind, and a short leg under each plate's edge.
// Beetle: a long domed oval of wing cases, nearly black with a violet rim, a narrower heart-shaped
// shield in front, a head with jaws and two long beaded antennae, and three pairs of long thin legs
// raised to a high knee, built to run.

import { hash32 } from '../../core/rng.js';
import { builder, tube, lathe } from './procedural.js';

/**
 * @typedef {import('./leg-rig.js').Leg} Leg
 * @typedef {import('./leg-rig.js').Bind} Bind
 * @typedef {{ vertices: Float32Array, count: number, indices: Uint32Array, bind: Bind }} BoundMesh
 */

/** @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;
/** @param {number} a @param {number} b @param {number} x */
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** @param {number[]} a @param {number[]} b @param {number} t */
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
/** @param {number[]} a @param {number[]} b */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** @param {number[]} a @param {number[]} b */
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** @param {number[]} a @param {number[]} b */
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Lengths along a path, from its start. @param {number[][]} pts */
function arc(pts) {
  /** @type {number[]} */ const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(...sub(pts[i], pts[i - 1])));
  return s;
}

/**
 * A builder that also notes which bone each vertex follows: set `cur` before building a part.
 * @param {number} bands legs a side
 */
function rigged(bands) {
  const m = builder();
  /** @type {number[]} */ const bone = [];
  /** @type {number[]} */ const w = [];
  /** @type {{ bone: number, pts: number[][] | null, s: number[], w0: number, w1: number }} */
  let cur = { bone: 0, pts: null, s: [], w0: 0, w1: 1 };
  let lo = Infinity;
  const vert = m.vert;
  // Weight by how far along its limb a vertex sits: none at the root, all of it past the ramp.
  /** @param {number[]} p */
  const along = (p) => {
    const P = /** @type {number[][]} */ (cur.pts);
    let best = Infinity, at = 0;
    for (let i = 0; i + 1 < P.length; i++) {
      const d = sub(P[i + 1], P[i]), q = sub(p, P[i]);
      const t = Math.max(0, Math.min(1, dot(q, d) / Math.max(dot(d, d), 1e-18)));
      const e = Math.hypot(q[0] - d[0] * t, q[1] - d[1] * t, q[2] - d[2] * t);
      if (e < best) { best = e; at = cur.s[i] + t * (cur.s[i + 1] - cur.s[i]); }
    }
    return smooth(cur.w0, cur.w1, at);
  };
  m.vert = (p, n, c) => {
    const i = vert(p, n, c);
    lo = Math.min(lo, p[1]);
    bone[i] = cur.bone; w[i] = cur.pts ? along(p) : 0;
    return i;
  };
  /** @type {Leg[]} */ const legs = [];
  /** @type {Leg[]} */ const antennae = [];
  return {
    m,
    /**
     * A leg: a tube along pts, its root under the body, turning about pts[1] (where it leaves the
     * body's edge). @param {number} side @param {number} band @param {number[][]} pts
     * @param {number[]} radii @param {number[]} color @param {number} sides
     */
    leg(side, band, pts, radii, color, sides) {
      const s = arc(pts), k = (side > 0 ? 0 : bands) + band;
      cur = { bone: 1 + k, pts, s, w0: s[1] * 0.75, w1: s[1] + 0.25 * (s[s.length - 1] - s[1]) };
      tube(m, pts, radii, color, sides);
      legs[k] = { pivot: [...pts[1]], side, band };
      cur = { bone: 0, pts: null, s: [], w0: 0, w1: 1 };
    },
    /**
     * An antenna, swaying about its base (pts[0]). @param {number} side @param {number[][]} pts
     * @param {number[]} radii @param {number[]} color
     */
    antenna(side, pts, radii, color) {
      const s = arc(pts), k = side > 0 ? 0 : 1;
      cur = { bone: 1 + 2 * bands + k, pts, s, w0: 0, w1: s[s.length - 1] * 0.15 };
      tube(m, pts, radii, color, 4);
      antennae[k] = { pivot: [...pts[0]], side, band: 0 };
      cur = { bone: 0, pts: null, s: [], w0: 0, w1: 1 };
    },
    /** @returns {BoundMesh} */
    done() {
      const mesh = m.done();
      // done() set the base on y = 0: the roots move with it.
      for (const L of [...legs, ...antennae]) L.pivot[1] -= lo;
      return { ...mesh, bind: { bone: Uint8Array.from(bone), w: Float32Array.from(w), legs, antennae } };
    },
  };
}

/**
 * A surface from a grid of points, rows running along +z, columns across +x, facing up (down when
 * flip). Normals come from the grid. @param {ReturnType<typeof builder>} m @param {number[][][]} P
 * @param {number[][][]} C @param {boolean} [flip]
 */
function sheet(m, P, C, flip = false) {
  const R = P.length, N = P[0].length;
  const id = P.map((row, i) => row.map((p, j) => {
    const du = sub(P[Math.min(R - 1, i + 1)][j], P[Math.max(0, i - 1)][j]);
    const dv = sub(P[i][Math.min(N - 1, j + 1)], P[i][Math.max(0, j - 1)]);
    const n = cross(du, dv);
    return m.vert(p, flip ? n.map((x) => -x) : n, C[i][j]);
  }));
  for (let i = 0; i + 1 < R; i++) {
    for (let j = 0; j + 1 < N; j++) {
      const a = id[i][j], b = id[i + 1][j], c = id[i][j + 1], d = id[i + 1][j + 1];
      if (flip) { m.tri(a, c, b); m.tri(b, c, d); } else { m.tri(a, b, c); m.tri(b, d, c); }
    }
  }
}

/**
 * A fan from a centre to a row of points, facing the way of hint. @param {ReturnType<typeof builder>} m
 * @param {number[]} c @param {number[][]} ring @param {number[]} color @param {number[]} hint
 */
function fan(m, c, ring, color, hint) {
  const ci = m.vert(c, hint, color);
  const ids = ring.map((p) => m.vert(p, hint, color));
  for (let k = 0; k + 1 < ring.length; k++) {
    const n = cross(sub(ring[k], c), sub(ring[k + 1], c));
    if (dot(n, hint) >= 0) m.tri(ci, ids[k], ids[k + 1]); else m.tri(ci, ids[k + 1], ids[k]);
  }
}

/** A small ball. @param {ReturnType<typeof builder>} m @param {number[]} c @param {number} r @param {number[]} color */
function ball(m, c, r, color) {
  /** @type {[number, number, number][]} */ const prof = [];
  for (let k = 0; k <= 6; k++) { const a = -Math.PI / 2 + (Math.PI * k) / 6; prof.push([Math.max(r * 0.02, r * Math.cos(a)), c[1] + r * Math.sin(a), 0]); }
  lathe(m, prof, [color], c[0], c[2], 8);
}

/**
 * The common rough woodlouse, facing +z: a low dome of seven plates, head, tail, prongs, antennae
 * and seven pairs of short legs under the plates' edges.
 * @param {any} S under-log.json woodlice.shape @returns {BoundMesh}
 */
export function woodlouseMesh(S) {
  const B = rigged(S.plates), m = B.m;
  const L = S.lengthM, W = S.widthM / 2, D = S.domeM, cl = S.clearM;
  const zHead = L / 2 - S.headM, zTail = -L / 2 + S.tailM, zEnd = -L / 2 + S.tailM * 0.3;
  const d = (zHead - zTail) / S.plates, zc = (zHead + zTail) / 2, a = 0.8 * (zHead - zTail);
  // The body's outline: an oval, a little blunt at both ends.
  const hw = (/** @type {number} */ z) => W * Math.sqrt(Math.max(0.05, 1 - ((z - zc) / a) ** 2));
  const top = (/** @type {number} */ z) => cl + (D - cl) * (hw(z) / W) ** 1.5;
  const tw = hw(zTail) * S.tailWidthShare;
  const tailHw = (/** @type {number} */ z) => tw * (1 - 0.3 * Math.min(1, (zTail - z) / S.tailM));
  const tailTop = (/** @type {number} */ z) => cl + (top(zTail) - cl) * 0.5 * (tailHw(z) / tw);

  /**
   * One plate: an arched band from zb to zf, reaching ov forward under the plate ahead; its back edge
   * stands a little proud and drops to the next plate in a pale lip. @param {number} zb
   * @param {number} zf @param {number} ov @param {(z: number) => number} hwAt @param {(z: number) => number} topAt
   * @param {number} key seed for its mottling
   */
  const plate = (zb, zf, ov, hwAt, topAt, key) => {
    const rows = 5, cols = 16, tone = 1 + 0.08 * (u01(hash32(S.seed, 50, key)) - 0.5);
    /** @type {number[][][]} */ const P = [];
    /** @type {number[][][]} */ const C = [];
    for (let i = 0; i <= rows; i++) {
      const z = zb + (i / rows) * (zf + ov - zb), v = (z - zb) / (zf - zb);
      const w = hwAt(Math.min(z, zf)) * (z > zf ? 0.96 : 1), h = topAt(Math.min(z, zf)) - cl;
      /** @type {number[][]} */ const pr = [];
      /** @type {number[][]} */ const cr = [];
      for (let j = 0; j <= cols; j++) {
        const u = -1 + (2 * j) / cols, arch = (1 - u * u) ** 0.85;
        // Proud at the back edge, tucked low at the front; a slight upturn at the flared rim.
        const lip = S.lipM * Math.max(-1, Math.min(1, 1 - 2 * v)) * arch;
        const turn = h * 0.05 * Math.exp(-(((1 - Math.abs(u)) / 0.1) ** 2));
        pr.push([u * w, cl + h * arch + lip + turn, z]);
        const rim = Math.max(smooth(1 - S.rimShare, 1, Math.abs(u)), smooth(0.3, 0, v));
        const k = tone * (1 + S.mottle * (u01(hash32(S.seed, key, i, j)) - 0.5) * 2);
        cr.push(mix(S.albedo.map((/** @type {number} */ x) => x * k), S.rimAlbedo, rim));
      }
      P.push(pr); C.push(cr);
    }
    sheet(m, P, C);
    // The lip: from the back edge straight down past the next plate's surface, facing back.
    const edge = P[0], low = edge.map((p) => [p[0], Math.max(cl * 0.9, p[1] - S.lipM * 2.5), p[2] + 1e-5]);
    sheet(m, [low, edge], [C[0].map(() => S.rimAlbedo), C[0].map(() => S.rimAlbedo)]);
  };

  // Seven plates, front to back.
  for (let i = 0; i < S.plates; i++) {
    const zf = zHead - i * d;
    plate(zf - d, zf, d * S.overlapShare, hw, top, i);
  }
  // The tail: a few small plates, narrower, then the pointed end.
  const dt = (zTail - zEnd) / S.tailPlates;
  for (let i = 0; i < S.tailPlates; i++) {
    const zf = zTail - i * dt;
    plate(zf - dt, zf, dt * S.overlapShare, tailHw, tailTop, 20 + i);
  }
  const endHw = (/** @type {number} */ z) => tailHw(zEnd) * (0.15 + 0.85 * Math.max(0, (z + L / 2) / (zEnd + L / 2)));
  plate(-L / 2, zEnd, dt * S.overlapShare, endHw, tailTop, 30);

  // The head: a low rounded cap in front of the first plate, tucked a little under it.
  const Hw = W * S.headWidthShare;
  const headT = (/** @type {number} */ z) => Math.max(0, Math.min(1, (z - zHead) / S.headM));
  const headHw = (/** @type {number} */ z) => Hw * Math.sqrt(Math.max(0.03, 1 - headT(z) ** 2));
  const headH = (/** @type {number} */ z) => (top(zHead) - cl) * 0.6 * Math.sqrt(Math.max(0, 1 - headT(z) ** 2.5));
  const headY = (/** @type {number} */ u, /** @type {number} */ z) => cl + headH(z) * (1 - u * u) ** 0.8;
  {
    /** @type {number[][][]} */ const P = [];
    /** @type {number[][][]} */ const C = [];
    for (let i = 0; i <= 6; i++) {
      const z = zHead - d * 0.3 + (i / 6) * (S.headM + d * 0.3);
      /** @type {number[][]} */ const pr = [];
      /** @type {number[][]} */ const cr = [];
      for (let j = 0; j <= 12; j++) {
        const u = -1 + j / 6;
        pr.push([u * headHw(z), headY(u, z), z]);
        cr.push(mix(S.albedo, S.rimAlbedo, smooth(0.75, 1, Math.abs(u)) * 0.6));
      }
      P.push(pr); C.push(cr);
    }
    sheet(m, P, C);
  }
  for (const side of [1, -1]) {
    // Eyes: small dark bumps at the head's sides.
    const ez = zHead + S.headM * 0.3;
    ball(m, [side * headHw(ez) * 0.8, headY(0.8, ez), ez], S.eyeM, S.eyeAlbedo);
    // Antennae: a stout stalk out and up to an elbow, then the thinner whip bending out and down.
    const A = S.antennaM, bz = L / 2 - S.headM * 0.2, base = [side * Hw * 0.45, headY(0.45, bz), bz];
    const rel = [[0, 0, 0], [0.12, 0.08, 0.18], [0.3, 0.15, 0.36], [0.5, 0.1, 0.55], [0.68, 0.02, 0.75], [0.8, -0.05, 0.95]];
    const len = arc(rel)[rel.length - 1];
    const pts = rel.map((p) => [base[0] + (side * p[0] * A) / len, base[1] + (p[1] * A) / len, base[2] + (p[2] * A) / len]);
    B.antenna(side, pts, [1, 0.95, 0.85, 0.6, 0.5, 0.3].map((k) => k * S.antennaRadiusM), S.legAlbedo);
    // Uropods: two short prongs out behind the tail's point.
    const U = S.uropodM, ux = side * tailHw(zEnd) * 0.6, uy = cl + 0.0002;
    tube(m, [[ux, uy, zEnd], [ux + side * 0.15 * U, uy, zEnd - 0.45 * U], [ux + side * 0.3 * U, uy - 0.05 * U, zEnd - U]],
      [S.uropodRadiusM, S.uropodRadiusM * 0.8, S.uropodRadiusM * 0.25], S.legAlbedo, 4);
  }

  // The belly: a flat pale underside closing the shell from below.
  {
    /** @type {number[][]} */ const ring = [];
    const outline = (/** @type {number} */ z) => (z > zHead ? headHw(z) : z > zTail ? hw(z) : z > zEnd ? tailHw(z) : endHw(z)) * 0.92;
    for (let k = 0; k <= 24; k++) { const z = L / 2 - (k / 24) * L; ring.push([outline(z), cl * 0.95, z]); }
    for (let k = 24; k >= 0; k--) { const z = L / 2 - (k / 24) * L; ring.push([-outline(z), cl * 0.95, z]); }
    fan(m, [0, cl * 0.95, 0], ring, S.bellyAlbedo, [0, -1, 0]);
  }

  // Legs: one pair under each plate, the front ones reaching forward and the back ones back.
  for (let b = 0; b < S.plates; b++) {
    const z = zHead - (b + 0.5) * d, w = hw(z), R = S.legRadiusM;
    const ang = ((S.legSpreadDeg[0] + (S.legSpreadDeg[1] - S.legSpreadDeg[0]) * (b / (S.plates - 1))) * Math.PI) / 180;
    const ca = Math.cos(ang), sa = Math.sin(ang), Lg = S.legM;
    for (const side of [1, -1]) {
      B.leg(side, b, [
        [side * w * 0.45, cl * 0.7, z],
        [side * w * 0.95, cl * 0.8, z],
        [side * (w + Lg * 0.4 * ca), cl + S.legKneeM, z + Lg * 0.4 * sa],
        [side * (w + Lg * 0.8 * ca), cl * 0.5, z + Lg * 0.8 * sa],
        [side * (w + Lg * ca), 0, z + Lg * sa],
      ], [R, R, R * 0.9, R * 0.7, R * 0.4], S.legAlbedo, 4);
    }
  }
  return B.done();
}

/**
 * The violet ground beetle, facing +z: domed wing cases, the shield in front, head with jaws and
 * beaded antennae, and three pairs of long legs with a high knee.
 * @param {any} S under-log.json beetle.shape @returns {BoundMesh}
 */
export function beetleMesh(S) {
  const B = rigged(3), m = B.m;
  const L = S.lengthM, cl = S.clearM;
  // Front to back: jaws, head, neck, shield (pronotum), waist, wing cases (elytra).
  const zHead1 = L / 2 - S.mandibleM, zHead0 = zHead1 - S.headM, zPro1 = zHead0 - S.neckM;
  const zPro0 = zPro1 - S.pronotumM, zEl0 = zPro0 - S.waistM, zEl1 = -L / 2;
  const elLen = zEl0 - zEl1, EW = S.elytraWidthM / 2, PW = S.pronotumWidthM / 2, HW = S.headWidthM / 2;
  const elS = (/** @type {number} */ z) => Math.max(0, Math.min(1, (zEl0 - z) / elLen));
  // Wing cases: narrow at the shoulders, widest a little behind, rounding to a point.
  const elHw = (/** @type {number} */ z) => {
    const s = elS(z);
    return EW * (s < 0.42 ? 0.68 + 0.32 * Math.sin((Math.PI / 2) * (s / 0.42)) : Math.sqrt(Math.max(0.004, 1 - ((s - 0.42) / 0.58) ** 2)));
  };
  const elH = (/** @type {number} */ z) => {
    const s = elS(z);
    return S.elytraDomeM * (s < 0.4 ? 0.75 + 0.25 * Math.sin((Math.PI / 2) * (s / 0.4)) : Math.sqrt(Math.max(0, 1 - ((s - 0.4) / 0.62) ** 2)) ** 0.8);
  };
  const proT = (/** @type {number} */ z) => Math.max(0, Math.min(1, (z - zPro0) / S.pronotumM));
  // The shield: heart shaped, narrow behind, widest two thirds forward.
  const proHw = (/** @type {number} */ z) => {
    const t = proT(z);
    return PW * (t < 0.7 ? 0.72 + 0.28 * Math.sin((Math.PI / 2) * (t / 0.7)) : 1 - 0.15 * ((t - 0.7) / 0.3) ** 2);
  };
  const headT = (/** @type {number} */ z) => Math.max(0, Math.min(1, (z - zHead0) / S.headM));
  const headHw = (/** @type {number} */ z) => { const t = headT(z); return HW * (0.8 + 0.2 * Math.sin(Math.PI * t)) * (t > 0.8 ? 1 - ((t - 0.8) / 0.2) ** 2 * 0.5 : 1); };
  const headY = (/** @type {number} */ u, /** @type {number} */ z) => cl * 0.9 + S.headDomeM * (0.6 + 0.4 * Math.sin(Math.PI * (0.2 + 0.6 * headT(z)))) * (1 - u * u) ** 0.7;
  /** The body's half width at z, for where the legs leave it. @param {number} z */
  const bodyHw = (z) => (z > zPro0 ? proHw(z) : elHw(z));
  const tone = (/** @type {number} */ ...k) => 1 + S.mottle * (u01(hash32(S.seed, ...k)) - 0.5) * 2;

  // Wing cases: one domed sheet with a fine groove down the middle where the two meet.
  {
    const rows = 18, cols = 24;
    /** @type {number[][][]} */ const P = [];
    /** @type {number[][][]} */ const C = [];
    for (let i = 0; i <= rows; i++) {
      const z = zEl1 + (i / rows) * elLen, w = elHw(z), h = elH(z);
      /** @type {number[][]} */ const pr = [];
      /** @type {number[][]} */ const cr = [];
      for (let j = 0; j <= cols; j++) {
        const u = -1 + (2 * j) / cols;
        const groove = S.sutureM * Math.exp(-((u / 0.05) ** 2)) * Math.min(1, h / S.elytraDomeM * 2);
        pr.push([u * w, cl + h * (1 - u * u) ** 0.7 - groove, z]);
        // Violet creeps in toward the outer edge, and a little at the tip.
        const rim = Math.max(smooth(1 - S.rimShare, 1, Math.abs(u)), smooth(0.9, 1, elS(z)) * 0.6);
        cr.push(mix(S.albedo.map((/** @type {number} */ x) => x * tone(1, i, j)), S.rimAlbedo, rim));
      }
      P.push(pr); C.push(cr);
    }
    sheet(m, P, C);
    fan(m, [0, cl, zEl0 + 1e-5], P[rows], S.albedo, [0, 0, 1]);
  }

  // The shield: flatter, with a raised violet bead round its edge.
  {
    const rows = 10, cols = 16;
    /** @type {number[][][]} */ const P = [];
    /** @type {number[][][]} */ const C = [];
    for (let i = 0; i <= rows; i++) {
      const z = zPro0 + (i / rows) * S.pronotumM, w = proHw(z), t = proT(z);
      const h = S.pronotumDomeM * (0.75 + 0.25 * Math.sin(Math.PI * t));
      /** @type {number[][]} */ const pr = [];
      /** @type {number[][]} */ const cr = [];
      for (let j = 0; j <= cols; j++) {
        const u = -1 + (2 * j) / cols;
        const bead = S.pronotumDomeM * 0.08 * Math.exp(-(((1 - Math.abs(u)) / 0.1) ** 2));
        pr.push([u * w, cl + h * (1 - u * u) ** 0.6 + bead, z]);
        cr.push(mix(S.albedo.map((/** @type {number} */ x) => x * tone(2, i, j)), S.rimAlbedo, smooth(1 - S.rimShare * 0.8, 1, Math.abs(u))));
      }
      P.push(pr); C.push(cr);
    }
    sheet(m, P, C);
    fan(m, [0, cl, zPro0], P[0], S.albedo, [0, 0, -1]);
    fan(m, [0, cl, zPro1], P[rows], S.albedo, [0, 0, 1]);
  }
  // Neck and waist: short dark links, mostly hidden.
  tube(m, [[0, cl + S.pronotumDomeM * 0.3, zEl0 - 0.0005], [0, cl + S.pronotumDomeM * 0.3, zPro0 + 0.0005]], [PW * 0.35, PW * 0.35], S.albedo, 7);
  tube(m, [[0, cl * 0.95 + S.headDomeM * 0.4, zPro1 - 0.0005], [0, cl * 0.95 + S.headDomeM * 0.4, zHead0 + 0.0005]], [HW * 0.55, HW * 0.55], S.albedo, 7);

  // The head, with its eyes, jaws and feelers.
  {
    /** @type {number[][][]} */ const P = [];
    /** @type {number[][][]} */ const C = [];
    for (let i = 0; i <= 8; i++) {
      const z = zHead0 + (i / 8) * S.headM;
      /** @type {number[][]} */ const pr = [];
      /** @type {number[][]} */ const cr = [];
      for (let j = 0; j <= 12; j++) { const u = -1 + j / 6; pr.push([u * headHw(z), headY(u, z), z]); cr.push(S.albedo); }
      P.push(pr); C.push(cr);
    }
    sheet(m, P, C);
    fan(m, [0, cl * 0.9, zHead0], P[0], S.albedo, [0, 0, -1]);
    fan(m, [0, cl * 0.9, zHead1], P[8], S.albedo, [0, 0, 1]);
  }
  for (const side of [1, -1]) {
    const ez = zHead0 + S.headM * 0.55;
    ball(m, [side * headHw(ez) * 0.92, headY(0.85, ez), ez], S.eyeM, S.eyeAlbedo);
    // Jaws: curved inward, crossing at the tips.
    const jy = cl * 0.9 + 0.0003, R = S.mandibleRadiusM, J = S.mandibleM;
    tube(m, [[side * HW * 0.45, jy, zHead1 - J * 0.1], [side * HW * 0.55, jy, zHead1 + J * 0.35], [side * HW * 0.4, jy, zHead1 + J * 0.75], [side * HW * 0.05, jy, zHead1 + J]],
      [R, R * 0.9, R * 0.6, R * 0.15], S.albedo, 5);
    // Palps: little feelers under the jaws.
    tube(m, [[side * HW * 0.3, cl * 0.75, zHead1 - J * 0.2], [side * HW * 0.6, cl * 0.6, zHead1 + J * 0.3], [side * HW * 0.75, cl * 0.4, zHead1 + J * 0.6]],
      [R * 0.4, R * 0.35, R * 0.25], S.legAlbedo, 4);
    // Antennae: eleven beads, out and forward, curving wider toward the tip.
    const n = S.antennaSegments, A = S.antennaM, step = A / n;
    const bz = zHead1 - S.headM * 0.15;
    let p = [side * HW * 0.7, headY(0.7, bz) - 0.0002, bz];
    /** @type {number[][]} */ const pts = [p];
    /** @type {number[]} */ const radii = [S.antennaRadiusM * 1.2];
    for (let k = 0; k < n; k++) {
      const s = (k + 0.5) / n, ang = ((S.antennaSpreadDeg[0] + (S.antennaSpreadDeg[1] - S.antennaSpreadDeg[0]) * s) * Math.PI) / 180;
      const rise = 0.3 - 0.45 * s, dir = [side * Math.sin(ang), rise, Math.cos(ang)], dl = Math.hypot(...dir);
      const r = S.antennaRadiusM * (1 - 0.35 * s);
      // Each segment swells in the middle and pinches at its joint.
      const mid = p.map((x, i) => x + (dir[i] / dl) * step * 0.5), end = p.map((x, i) => x + (dir[i] / dl) * step);
      pts.push(mid, end); radii.push(r, k === n - 1 ? r * 0.3 : r * 0.6);
      p = end;
    }
    B.antenna(side, pts, radii, S.legAlbedo);
  }

  // Legs: from under the body out past its edge, up to a high knee, then down to a long foot.
  for (let b = 0; b < 3; b++) {
    const z0 = S.legRootZM[b], ang = (S.legAngleDeg[b] * Math.PI) / 180, bend = ((S.legAngleDeg[b] + S.legBendDeg[b]) * Math.PI) / 180;
    const F = S.femurM[b], T = S.tibiaM[b], Ta = S.tarsusM[b], R = S.legRadiusM;
    for (const side of [1, -1]) {
      const root = [side * 0.0012, cl * 0.7, z0];
      const ex = bodyHw(z0) + 0.0003, exit = [side * ex, cl * 0.85, z0 + Math.tan(ang) * (ex - 0.0012) * 0.5];
      const knee = [exit[0] + side * Math.cos(ang) * F * 0.85, cl + S.kneeRiseM, exit[2] + Math.sin(ang) * F * 0.85];
      const ankle = [knee[0] + side * Math.cos(bend) * T * 0.8, S.ankleM, knee[2] + Math.sin(bend) * T * 0.8];
      const mid = [ankle[0] + side * Math.cos(bend) * Ta * 0.5, S.ankleM * 0.5, ankle[2] + Math.sin(bend) * Ta * 0.5];
      const foot = [ankle[0] + side * Math.cos(bend) * Ta, 0, ankle[2] + Math.sin(bend) * Ta];
      B.leg(side, b, [root, exit, knee, ankle, mid, foot], [R * 1.2, R * 1.1, R * 0.9, R * 0.65, R * 0.5, R * 0.35], S.legAlbedo, 5);
    }
  }
  // The belly closes the body from below.
  {
    /** @type {number[][]} */ const ring = [];
    const outline = (/** @type {number} */ z) => (z > zHead0 ? headHw(z) : z > zPro1 ? HW * 0.55 : z > zPro0 ? proHw(z) : z > zEl0 ? PW * 0.35 : elHw(z)) * 0.92;
    const z1 = zHead1, z0 = zEl1;
    for (let k = 0; k <= 30; k++) { const z = z1 - (k / 30) * (z1 - z0); ring.push([outline(z), cl * 0.92, z]); }
    for (let k = 30; k >= 0; k--) { const z = z1 - (k / 30) * (z1 - z0); ring.push([-outline(z), cl * 0.92, z]); }
    fan(m, [0, cl * 0.92, 0], ring, S.albedo, [0, -1, 0]);
  }
  return B.done();
}

/**
 * Both meshes by name, for the finds pass. @param {any} recipe under-log.json
 * @returns {Record<string, BoundMesh>}
 */
export function underLogMeshes(recipe) {
  /** @type {Record<string, BoundMesh>} */ const out = {};
  if (recipe.woodlice?.shape?.lengthM) out.woodlice = woodlouseMesh(recipe.woodlice.shape);
  if (recipe.beetle?.shape?.lengthM) out.beetle = beetleMesh(recipe.beetle.shape);
  return out;
}

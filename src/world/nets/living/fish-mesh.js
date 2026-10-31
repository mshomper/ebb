// @ts-check
// A gen 2 fish as a mesh (docs/future/17): the lab's side view lifted into a body. The growth grid
// (u nose to tail, v top to bottom) becomes a tube, v running round the girth (v = -cos of the angle
// round it), as wide as the body plan allows; the grown field colours each vertex, so the mesh and
// the journal sketch traced from it show the same fish. Fins and the tail are thin two-sided
// sheets on the midline, the pectorals angled out, the eyes small spheres. The rare types add their
// signature forms: a lionfish's banded spines and fan, a stonefish's warts, an anglerfish's gape and
// lure, a ghost fish's spine, ribs and gut (drawn through its clear body). Real meters, +z forward,
// y up, the origin in its middle, 9 floats a vertex (position, normal, linear albedo) as the
// creature body bake's, so the tray, the sketch tracer and the creature pass take it as they are.
// swimBones and fishSkin give the hooked fish a four-bone swim in the world. Pure.

import { makeMap, hsl, clamp } from './fish-species.js';
import { cellRgb, fieldAt } from './fish-field.js';

/** How wide a body is for its height, by plan (and rare type). */
const WIDTH = /** @type {Record<string, number>} */ ({ fusiform: 0.55, compressed: 0.36, elongate: 0.85, globose: 0.7, stone: 0.85, angler: 0.78, lion: 0.42 });
/** Tube segments along and round the body. */
const ALONG = 44, ROUND = 18;

/** sRGB 0..255 to linear 0..1. @param {number[]} c */
const lin = (c) => c.map((x) => Math.pow(clamp(x, 0, 255) / 255, 2.2));

/** The tail fin's outline in the side view, the lab's tailPts. @param {(u: number, v: number) => number[]} map @param {any} geo @param {string} tail */
export function tailPts(map, geo, tail) {
  const t = map(0.97, -1), b = map(0.97, 1), cx = (t[0] + b[0]) / 2, cy = (t[1] + b[1]) / 2, L = geo.tl, S = geo.spread, pts = [t];
  const q = (/** @type {number[]} */ p0, /** @type {number[]} */ c, /** @type {number[]} */ p1, n = 8) => {
    for (let i = 1; i <= n; i++) { const s = i / n, a = (1 - s) * (1 - s), m = 2 * (1 - s) * s, z = s * s; pts.push([a * p0[0] + m * c[0] + z * p1[0], a * p0[1] + m * c[1] + z * p1[1]]); }
  };
  if (tail === 'forked') { const A = [cx + L, cy - S], B = [cx + L, cy + S], C = [cx + L * 0.42, cy]; q(t, [cx + L * 0.5, cy - S * 0.55], A); q(A, [cx + L * 0.62, cy - S * 0.25], C); q(C, [cx + L * 0.62, cy + S * 0.25], B); q(B, [cx + L * 0.5, cy + S * 0.55], b); }
  else if (tail === 'lunate') { const A = [cx + L, cy - S * 1.1], B = [cx + L, cy + S * 1.1], C = [cx + L * 0.55, cy]; q(t, [cx + L * 0.35, cy - S * 0.7], A); q(A, [cx + L * 0.5, cy - S * 0.35], C); q(C, [cx + L * 0.5, cy + S * 0.35], B); q(B, [cx + L * 0.35, cy + S * 0.7], b); }
  else if (tail === 'rounded') { q(t, [cx + L * 0.6, cy - S * 1.1], [cx + L, cy]); q([cx + L, cy], [cx + L * 0.6, cy + S * 1.1], b); }
  else { const A = [cx + L, cy - S * 0.85], B = [cx + L, cy + S * 0.85]; q(t, [cx + L * 0.4, cy - S * 0.6], A); q(A, [cx + L * 1.03, cy], B); q(B, [cx + L * 0.4, cy + S * 0.6], b); }
  return { pts, c: [cx, cy] };
}

/** A dorsal (side -1) or anal (side 1) fin's tips and base, the lab's finPts. @param {(u: number, v: number) => number[]} map @param {number} u0 @param {number} u1 @param {number} side @param {number} h @param {boolean} spiny */
export function finPts(map, u0, u1, side, h, spiny) {
  /** @type {number[][]} */ const tips = [], base = [];
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = u0 + (u1 - u0) * t, [x, y] = map(u, side * 0.96);
    let f = h * Math.pow(Math.sin(Math.PI * t), 0.7) * (1.25 - 0.5 * t);
    if (spiny && side < 0 && t < 0.6 && i % 2) f *= 0.55;
    tips.push([x, y + side * f]); base.push([x, y]);
  }
  return { tips, base };
}

/** A growing mesh: positions, linear albedo, triangles; normals worked out at the end. */
function builder() {
  /** @type {number[]} */ const P = [], C = [], I = [];
  /** @type {number[]} */ const N = [];
  return {
    /** @param {number[]} p @param {number[]} c linear @param {number[]} [n] a set normal (else from the faces) */
    v(p, c, n) { P.push(p[0], p[1], p[2]); C.push(c[0], c[1], c[2]); N.push(...(n ?? [NaN, 0, 0])); return P.length / 3 - 1; },
    /** @param {number} a @param {number} b @param {number} c */
    t(a, b, c) { I.push(a, b, c); },
    done() {
      const n = P.length / 3, acc = new Float64Array(n * 3);
      for (let k = 0; k < I.length; k += 3) {
        const [a, b, c] = [I[k], I[k + 1], I[k + 2]];
        const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
        const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const i of [a, b, c]) { acc[i * 3] += nx; acc[i * 3 + 1] += ny; acc[i * 3 + 2] += nz; }
      }
      const out = new Float32Array(n * 9);
      for (let i = 0; i < n; i++) {
        let nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
        if (Number.isNaN(nx)) { nx = acc[i * 3]; ny = acc[i * 3 + 1]; nz = acc[i * 3 + 2]; }
        const l = Math.hypot(nx, ny, nz) || 1;
        out.set([P[i * 3], P[i * 3 + 1], P[i * 3 + 2], nx / l, ny / l, nz / l, C[i * 3], C[i * 3 + 1], C[i * 3 + 2]], i * 9);
      }
      return { vertices: out, indices: new Uint32Array(I), count: n };
    },
  };
}

/**
 * The mesh of one fish. Pure.
 * @param {any} sp a species (fish-species.js) @param {any} ind an individual of it
 * @param {{ Nu: number, Nv: number, field: Float32Array }} F its grown field (fish-field.js)
 * @returns {{ vertices: Float32Array, indices: Uint32Array, count: number }}
 */
export function fishMesh(sp, ind, F) {
  const map = makeMap(ind.g), geo = ind.geo, col = ind.col;
  const tail = tailPts(map, geo, sp.tail);
  // The side view's extent: the body, its tail and fins, so the length is its whole length.
  let xmin = 0, xmax = 1;
  for (let i = 0; i <= 40; i++) { const a = map(i / 40, -1), b = map(i / 40, 1); xmin = Math.min(xmin, a[0], b[0]); xmax = Math.max(xmax, a[0], b[0]); }
  for (const p of tail.pts) xmax = Math.max(xmax, p[0]);
  const L = ind.sizeCm / 100, s = L / (xmax - xmin), xc = (xmin + xmax) / 2;
  const kind = sp.special === 'stone' || sp.special === 'angler' || sp.special === 'lion' ? sp.special : sp.plan;
  const wr = WIDTH[kind] ?? 0.55;
  /** Side view to body meters, at a lateral offset (side view units). @param {number[]} q @param {number} lat */
  const at = (q, lat) => [lat * s, -q[1] * s, (xc - q[0]) * s];
  /** The body's half height at u (side view units). @param {number} u */
  const halfH = (u) => (map(u, 1)[1] - map(u, -1)[1]) / 2;
  const B = builder();

  // The body: a tube, v round the girth.
  const u0 = 0.004, u1 = 0.97;
  /** @type {number[][]} */ const rows = [];
  for (let i = 0; i <= ALONG; i++) {
    const t = i / ALONG, u = u0 + (u1 - u0) * Math.pow(t, 0.85), hw = halfH(u) * wr, row = [];
    for (let k = 0; k <= ROUND; k++) {
      const th = (k / ROUND) * Math.PI * 2, v = -Math.cos(th);
      row.push(B.v(at(map(u, v), Math.sin(th) * hw), lin(cellRgb(col, v, fieldAt(F, u, v)))));
    }
    rows.push(row);
  }
  for (let i = 0; i < ALONG; i++) for (let k = 0; k < ROUND; k++) {
    const a = rows[i][k], b = rows[i][k + 1], c = rows[i + 1][k], d = rows[i + 1][k + 1];
    B.t(a, c, b); B.t(b, c, d);
  }
  // Close the tail end round its middle.
  const end = B.v(at(map(u1, 0), 0), lin(cellRgb(col, 0, fieldAt(F, u1, 0))));
  for (let k = 0; k < ROUND; k++) B.t(rows[ALONG][k], end, rows[ALONG][k + 1]);

  // Fins: thin two-sided sheets on the midline.
  const fh = col.fh !== null ? col.fh : sp.finUseH2 ? col.h2 : col.h;
  const finC = lin(hsl(fh, col.fh !== null ? Math.max(col.s, 65) : col.s, col.l + 6));
  const th = 0.006;
  /** A two-sided strip between two rows of side view points. @param {number[][]} a @param {number[][]} b @param {(i: number) => number[]} [colour] */
  const strip = (a, b, colour) => {
    for (const side of [1, -1]) {
      const A = a.map((q, i) => B.v(at(q, side * th), colour ? colour(i) : finC, [side, 0, 0]));
      const Bb = b.map((q, i) => B.v(at(q, side * th), colour ? colour(i) : finC, [side, 0, 0]));
      for (let i = 0; i < a.length - 1; i++) {
        if (side > 0) { B.t(A[i], Bb[i], A[i + 1]); B.t(A[i + 1], Bb[i], Bb[i + 1]); } else { B.t(A[i], A[i + 1], Bb[i]); B.t(A[i + 1], Bb[i + 1], Bb[i]); }
      }
    }
  };
  /** A two-sided fan from a middle to a run of points. @param {number[]} c @param {number[][]} pts @param {(i: number) => number[]} [colour] @param {number} [lat] */
  const fan = (c, pts, colour, lat = 0) => {
    for (const side of [1, -1]) {
      const m = B.v(at(c, lat + side * th), finC, [side, 0, 0]);
      const R = pts.map((q, i) => B.v(at(q, lat + side * th), colour ? colour(i) : finC, [side, 0, 0]));
      for (let i = 0; i < R.length - 1; i++) side > 0 ? B.t(m, R[i], R[i + 1]) : B.t(m, R[i + 1], R[i]);
    }
  };
  fan(tail.c, tail.pts);
  const F2 = sp.fin;
  const red = lin(hsl(col.h, col.s, col.l)), white = lin(hsl(col.h2, col.s2, col.l2));
  if (sp.special === 'lion') {
    // Separate banded spines over a low membrane.
    const k = 13;
    for (let i = 0; i < k; i++) {
      const t = i / (k - 1), u = F2.d0 + (F2.d1 - F2.d0) * t, b = map(u, -0.95), h = geo.dh * (1 - 0.55 * t) * (0.85 + 0.15 * (i % 3));
      const tip = [b[0] + 0.05 + 0.04 * t, b[1] - h], seg = [];
      for (let q = 0; q <= 7; q++) seg.push([b[0] + (tip[0] - b[0]) * (q / 7), b[1] + (tip[1] - b[1]) * (q / 7)]);
      strip(seg, seg.map((q) => [q[0] + 0.012, q[1]]), (q) => (q % 2 ? white : red));
    }
    const mem = finPts(map, F2.d0, F2.d1, -1, geo.dh * 0.35, false);
    strip(mem.base, mem.tips);
  } else {
    const d = finPts(map, F2.d0, F2.d1, -1, geo.dh, F2.spiny);
    strip(d.base, d.tips);
  }
  const an = finPts(map, F2.a0, F2.a1, 1, geo.ah, false);
  strip(an.base, an.tips);
  // The pectorals: angled out from each flank behind the gill; a lionfish's is a fan of separate banded rays.
  const pu = geo.gu + 0.045, pc = map(pu, 0.18), phw = halfH(pu) * wr;
  for (const side of [1, -1]) {
    const lat = side * phw * 0.9;
    if (sp.special === 'lion') {
      const n = 13, len = 0.32 + 0.22 * ind.g.depth, pale = lin(hsl(col.h, col.s * 0.5, col.l + 24));
      for (let i = 0; i < n; i++) {
        const a = 0.25 + (1.5 * i) / (n - 1), r = len * (0.7 + 0.4 * Math.sin((Math.PI * i) / (n - 1)));
        const seg = [];
        for (let q = 0; q <= 6; q++) seg.push([pc[0] + Math.cos(a) * r * (q / 6), pc[1] + Math.sin(a) * r * 0.8 * (q / 6)]);
        const out = seg.map((q) => [q[0] + 0.01, q[1] + 0.006]);
        for (const sd of [1, -1]) {
          const A = seg.map((q, k) => B.v(at(q, lat + side * k * 0.012 + sd * th), k % 2 ? pale : red, [side * sd, 0, 0]));
          const C = out.map((q, k) => B.v(at(q, lat + side * k * 0.012 + sd * th), k % 2 ? pale : red, [side * sd, 0, 0]));
          for (let k = 0; k < seg.length - 1; k++) { if (sd > 0) { B.t(A[k], C[k], A[k + 1]); B.t(A[k + 1], C[k], C[k + 1]); } else { B.t(A[k], A[k + 1], C[k]); B.t(A[k + 1], C[k + 1], C[k]); } }
        }
      }
      continue;
    }
    const n = 9, len = 0.1, wide = 0.04 + 0.04 * Math.min(ind.g.depth, 0.4), pts = [];
    for (let i = 0; i < n; i++) { const a = 0.45 + (-0.9 + (1.8 * i) / (n - 1)) * 0.4; pts.push([pc[0] + Math.cos(a) * len, pc[1] + Math.sin(a) * wide]); }
    for (const sd of [1, -1]) {
      const m = B.v(at(pc, lat), finC, [side, 0, 0]);
      const R = pts.map((q) => B.v(at(q, lat + side * Math.abs(q[0] - pc[0]) * 0.5 + sd * th), finC, [side * sd, 0, 0]));
      for (let i = 0; i < R.length - 1; i++) sd > 0 ? B.t(m, R[i], R[i + 1]) : B.t(m, R[i + 1], R[i]);
    }
  }

  // The eyes: small spheres on each flank, the pupil dark where it looks out.
  const ep = sp.special === 'stone' ? map(0.13, -0.72) : sp.special === 'angler' ? map(0.24, -0.5) : map(sp.plan === 'elongate' ? 0.06 : 0.1, -0.22);
  const er = sp.eye * (0.022 + 0.035 * Math.min(ind.g.depth, 0.5));
  const eu = sp.special === 'stone' ? 0.13 : sp.special === 'angler' ? 0.24 : sp.plan === 'elongate' ? 0.06 : 0.1;
  const iris = lin(hsl(col.iris[0], col.iris[1], col.iris[2])), pupil = lin([12, 13, 18]);
  for (const side of [1, -1]) sphere(B, at(ep, side * halfH(eu) * wr * 0.75), er * s, (n) => (n[0] * side > 0.72 ? pupil : iris));

  // The rare types' signature forms.
  if (sp.special === 'stone') {
    (ind.warts ?? []).forEach((/** @type {number[]} */ w, /** @type {number} */ i) => {
      const side = i % 2 ? 1 : -1, v = clamp(w[1], -0.95, 0.95), thw = Math.sqrt(Math.max(0, 1 - v * v));
      sphere(B, at(map(w[0], v), side * halfH(w[0]) * wr * thw), w[2] * s * 1.2, () => lin(hsl(col.h, col.s, col.l + (w[3] ? 12 : -12))));
    });
  }
  if (sp.special === 'angler') {
    const gp = sp.gape ?? 1, N = map(0.035, -0.62 * Math.min(gp, 1.2)), Cc = map(0.3 * gp, -0.05), L0 = map(0.03, 0.55 * Math.min(gp, 1.3)), N2 = [L0[0] - 0.04 * gp, L0[1]];
    for (const side of [1, -1]) { const lat = side * halfH(0.1) * wr * 0.85; const dark = lin([6, 7, 10]); const a = B.v(at(N, lat), dark), b = B.v(at(Cc, lat), dark), c = B.v(at(N2, lat), dark); side > 0 ? B.t(a, b, c) : B.t(a, c, b); }
    const b0 = map(0.2, -1), wl = sp.whip ? 1.9 : 1, d = ind.g.depth;
    const cc = [b0[0] + 0.04 * wl, b0[1] - (0.3 * d + 0.05) * wl], t = [b0[0] - 0.17 * wl, b0[1] - (0.12 * d + 0.08) * (sp.whip ? 0.2 : 1)];
    const stalk = [];
    for (let i = 0; i <= 10; i++) { const q = i / 10, a = (1 - q) * (1 - q), m = 2 * (1 - q) * q, z = q * q; stalk.push([a * b0[0] + m * cc[0] + z * t[0], a * b0[1] + m * cc[1] + z * t[1]]); }
    tube(B, stalk.map((q) => at(q, 0)), 0.006 * s, lin(hsl(col.h, col.s, col.l + 12)));
    sphere(B, at(t, 0), 0.022 * s, () => lin(col.accent));
  }
  if (sp.special === 'ghost') {
    const bone = lin([128, 146, 164]);
    const spine = [];
    for (let i = 0; i <= 16; i++) spine.push(at(map(0.2 + (0.77 * i) / 16, -0.05), 0));
    tube(B, spine, 0.008 * s, bone);
    for (let u = 0.23; u < 0.94; u += 0.045) {
      for (const side of [1, -1]) tube(B, [at(map(u, -0.08), 0), at(map(u + 0.04, -0.7), side * halfH(u) * wr * 0.5)], 0.003 * s, bone);
      for (const side of [1, -1]) tube(B, [at(map(u, 0.02), 0), at(map(u + (u < 0.58 ? 0.06 : 0.04), u < 0.58 ? 0.75 : 0.6), side * halfH(u) * wr * 0.5)], 0.003 * s, bone);
    }
    sphere(B, at(map(0.33, 0.35), 0), (0.035 + 0.05 * ind.g.depth) * s, () => lin([150, 160, 176]), [2, 1, 1]);
  }
  return B.done();
}

/**
 * A small sphere into the builder. @param {ReturnType<typeof builder>} B @param {number[]} c @param {number} r
 * @param {(n: number[]) => number[]} colour by normal @param {number[]} [stretch] along x, y, z (z first: [z, y, x] reads as along the body)
 */
function sphere(B, c, r, colour, stretch = [1, 1, 1]) {
  const nu = 8, nv = 6, idx = [];
  for (let j = 0; j <= nv; j++) {
    const ph = (j / nv) * Math.PI, row = [];
    for (let i = 0; i <= nu; i++) {
      const th = (i / nu) * Math.PI * 2, n = [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)];
      row.push(B.v([c[0] + n[0] * r * stretch[2], c[1] + n[1] * r * stretch[1], c[2] + n[2] * r * stretch[0]], colour(n), n));
    }
    idx.push(row);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = idx[j][i], b = idx[j][i + 1], d = idx[j + 1][i], e = idx[j + 1][i + 1]; B.t(a, b, d); B.t(b, e, d); }
}

/** A thin tube along points. @param {ReturnType<typeof builder>} B @param {number[][]} pts @param {number} r @param {number[]} c */
function tube(B, pts, r, c) {
  const rings = pts.map((p, i) => {
    const q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)];
    let dx = q[0] - o[0], dy = q[1] - o[1], dz = q[2] - o[2];
    const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    // Two directions across it.
    let ax = 0, ay = 1, az = 0;
    if (Math.abs(dy) > 0.9) { ax = 1; ay = 0; }
    let ux = ay * dz - az * dy, uy = az * dx - ax * dz, uz = ax * dy - ay * dx;
    const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
    const wx = dy * uz - dz * uy, wy = dz * ux - dx * uz, wz = dx * uy - dy * ux;
    const ring = [];
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const n = [ux * ca + wx * sa, uy * ca + wy * sa, uz * ca + wz * sa];
      ring.push(B.v([p[0] + n[0] * r, p[1] + n[1] * r, p[2] + n[2] * r], c, n));
    }
    return ring;
  });
  for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < 4; k++) {
    const a = rings[i][k], b = rings[i][(k + 1) % 4], d = rings[i + 1][k], e = rings[i + 1][(k + 1) % 4];
    B.t(a, d, b); B.t(b, d, e);
  }
}

/** Bone pivots along the body, as shares of its length from the middle (+ forward), head to tail. */
export const SWIM_PIVOTS = [0.22, 0.04, -0.14, -0.3];

/**
 * Skin weights for the four-bone swim: each vertex between the two pivots it lies between, by how
 * far along. @param {{ vertices: Float32Array, count: number }} m @param {number} L its length (m)
 * @returns {{ joints: Uint8Array, weights: Uint8Array }}
 */
export function fishSkin(m, L) {
  const joints = new Uint8Array(m.count * 4), weights = new Uint8Array(m.count * 4);
  const P = SWIM_PIVOTS.map((p) => p * L);
  for (let v = 0; v < m.count; v++) {
    const z = m.vertices[v * 9 + 2];
    let k = 0;
    while (k < P.length - 1 && z < P[k + 1]) k++;
    if (k >= P.length - 1 || z >= P[0]) { joints[v * 4] = z >= P[0] ? 0 : P.length - 1; weights[v * 4] = 255; continue; }
    const t = clamp((P[k] - z) / (P[k] - P[k + 1]), 0, 1);
    joints[v * 4] = k; joints[v * 4 + 1] = k + 1;
    weights[v * 4] = Math.round(255 * (1 - t)); weights[v * 4 + 1] = 255 - weights[v * 4];
  }
  return { joints, weights };
}

/**
 * The four bones' matrices for a swim at time t (seconds): a wave from head to tail, each bone
 * turning about y at its pivot on top of the one before. Column-major, 16 floats a bone.
 * @param {number} t @param {number} L length (m) @param {number} [strength] 1 a calm swim, 2 a hooked fish's struggle
 * @param {Float32Array} [out]
 */
export function swimBones(t, L, strength = 1, out = new Float32Array(64)) {
  const P = SWIM_PIVOTS.map((p) => p * L);
  const amp = [0.05, 0.12, 0.22, 0.32].map((a) => a * strength), w = 6.5 + 3 * (strength - 1);
  let M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (let k = 0; k < 4; k++) {
    const a = amp[k] * Math.sin(t * w - k * 1.1), c = Math.cos(a), s = Math.sin(a), pz = P[k];
    // T(0, 0, pz) Ry(a) T(0, 0, -pz): x' = c x + s (z - pz); z' = -s x + c (z - pz) + pz.
    const R = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, -s * pz, 0, pz - c * pz, 1];
    M = mul(M, R);
    out.set(M, k * 16);
  }
  return out;
}

/** Column-major 4 x 4 product a b. @param {number[]} a @param {number[]} b */
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let x = 0; for (let k = 0; k < 4; k++) x += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = x; }
  return o;
}

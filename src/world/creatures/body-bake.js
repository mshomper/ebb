// @ts-check
// Creature bodies (doc 11): a species recipe's blended-SDF primitives, baked to a triangle mesh by
// surface nets on a regular grid, with a normal and a linear albedo per vertex (region colors, a
// pale belly underneath, seeded blotches on the back). Pure and deterministic: the same recipe
// gives the same mesh. First used by the frog size preview (?frogscale); S6b skins and animates it.

import { surfaceNets } from '../mesh/surface-nets.js';

const DEG = Math.PI / 180;

/** @param {number} a @param {number} b @param {number} k smooth minimum radius (m); 0 is a hard union */
function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Rotate p by the inverse of rot (degrees about x, then y, then z). @param {number[]} p @param {number[]} rot */
function unrotate(p, rot) {
  let [x, y, z] = p;
  if (rot[2]) { const c = Math.cos(-rot[2] * DEG), s = Math.sin(-rot[2] * DEG); [x, y] = [c * x - s * y, s * x + c * y]; }
  if (rot[1]) { const c = Math.cos(-rot[1] * DEG), s = Math.sin(-rot[1] * DEG); [x, z] = [c * x + s * z, -s * x + c * z]; }
  if (rot[0]) { const c = Math.cos(-rot[0] * DEG), s = Math.sin(-rot[0] * DEG); [y, z] = [c * y - s * z, s * y + c * z]; }
  return [x, y, z];
}

/** Round cone (capsule with two radii) from a to b. @param {number[]} p @param {number[]} a @param {number[]} b @param {number} ra @param {number} rb */
function roundCone(p, a, b, ra, rb) {
  const ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const pa = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const l2 = ba[0] * ba[0] + ba[1] * ba[1] + ba[2] * ba[2];
  const t = Math.min(1, Math.max(0, (pa[0] * ba[0] + pa[1] * ba[1] + pa[2] * ba[2]) / Math.max(l2, 1e-12)));
  const d = Math.hypot(pa[0] - ba[0] * t, pa[1] - ba[1] * t, pa[2] - ba[2] * t);
  return d - (ra + (rb - ra) * t);
}

/** Signed distance (m) to one primitive. @param {any} q @param {number[]} p */
export function primDistance(q, p) {
  switch (q.type) {
    case 'sphere': return Math.hypot(p[0] - q.c[0], p[1] - q.c[1], p[2] - q.c[2]) - q.r;
    case 'ellipsoid': {
      const l = unrotate([p[0] - q.c[0], p[1] - q.c[1], p[2] - q.c[2]], q.rot ?? [0, 0, 0]);
      const k0 = Math.hypot(l[0] / q.r[0], l[1] / q.r[1], l[2] / q.r[2]);
      const k1 = Math.hypot(l[0] / (q.r[0] * q.r[0]), l[1] / (q.r[1] * q.r[1]), l[2] / (q.r[2] * q.r[2]));
      let d = k1 > 1e-12 ? (k0 * (k0 - 1)) / k1 : -Math.min(...q.r);
      // A dome: cut flat below cutY (a turtle's carapace, its rim at cutY).
      if (q.cutY !== undefined) d = Math.max(d, q.cutY - p[1]);
      // Shell plates: a shallow groove along every seam between scutes.
      if (q.scutes?.grooveM) d += q.scutes.grooveM * (1 - Math.min(1, scuteAt(q.scutes, p).seam / q.scutes.seamW));
      return d;
    }
    case 'capsule': return roundCone(p, q.a, q.b, q.r[0], q.r[1]);
    case 'roundCone': {
      const s = q.scale ?? [1, 1, 1];
      const local = [q.a[0] + (p[0] - q.a[0]) / s[0], q.a[1] + (p[1] - q.a[1]) / s[1], q.a[2] + (p[2] - q.a[2]) / s[2]];
      return roundCone(local, q.a, q.b, q.ra, q.rb) * Math.min(s[0], s[1], s[2]);
    }
    default: return Infinity;
  }
}

/** Scute centres per scutes block, built once. @type {WeakMap<any, number[][]>} */
const SCUTE_CENTRES = new WeakMap();

/**
 * A turtle's shell plates (body.prims[].scutes): the scutes seen from above, in the shell's own
 * oval (u across, v along, 1 at the rim): vertebrals down the middle, costals either side, marginals
 * round the rim (their centres past it, at marginalR). Which scute p lies in, how far it is from
 * that scute's centre, and how far from the nearest seam (all in oval units).
 * @param {any} S @param {number[]} p @returns {{ i: number, r: number, seam: number, du: number, dv: number }}
 */
export function scuteAt(S, p) {
  let cs = SCUTE_CENTRES.get(S);
  if (!cs) {
    cs = [];
    for (const v of S.vertebral) cs.push([0, v]);
    for (const v of S.costal) cs.push([S.costalU, v], [-S.costalU, v]);
    for (let k = 0; k < S.marginals; k++) {
      const a = ((k + 0.5) / S.marginals) * Math.PI * 2;
      cs.push([Math.sin(a) * S.marginalR, Math.cos(a) * S.marginalR]);
    }
    SCUTE_CENTRES.set(S, cs);
  }
  const u = (p[0] - S.c[0]) / S.rx, v = (p[2] - S.c[1]) / S.rz;
  let d1 = Infinity, d2 = Infinity, i1 = 0;
  for (let i = 0; i < cs.length; i++) {
    const d = Math.hypot(u - cs[i][0], v - cs[i][1]);
    if (d < d1) { d2 = d1; d1 = d; i1 = i; } else if (d < d2) d2 = d;
  }
  return { i: i1, r: d1, seam: (d2 - d1) / 2, du: u - cs[i1][0], dv: v - cs[i1][1] };
}

/** A 0..1 hash of two integers. @param {number} a @param {number} b */
function hash2(a, b) {
  let n = Math.imul(a, 374761393) + Math.imul(b, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** The body's signed distance at p, and the primitive nearest it. @param {any[]} prims @param {number[]} p */
export function bodyDistance(prims, p) {
  let d = Infinity, best = Infinity, near = 0;
  prims.forEach((q, i) => {
    const di = primDistance(q, p);
    d = i === 0 ? di : smin(d, di, q.k ?? 0);
    if (di < best) { best = di; near = i; }
  });
  return { d, near };
}

/** A smooth 0..1 value noise in 3D, seeded by integer lattice hashes. @param {number} x @param {number} y @param {number} z */
function valueNoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const h = (/** @type {number} */ i, /** @type {number} */ j, /** @type {number} */ k) => {
    let n = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 2147483647);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const lerp = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ t) => a + (b - a) * t;
  return lerp(
    lerp(lerp(h(xi, yi, zi), h(xi + 1, yi, zi), u), lerp(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
    lerp(lerp(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), lerp(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v), w);
}

/**
 * Bake a body to a mesh: interleaved position, normal and albedo (9 floats a vertex), and indices.
 * @param {any} body the species recipe's body @param {number} cellM grid cell size (m)
 * @returns {{ vertices: Float32Array, indices: Uint32Array, count: number, bounds: { min: number[], max: number[] } }}
 */
export function bakeBody(body, cellM) {
  const prims = body.prims;
  // Bounds: every primitive's reach, plus blend room.
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const q of prims) {
    const pts = q.c ? [q.c] : [q.a, q.b];
    const r = Array.isArray(q.r) ? Math.max(...q.r) : (q.r ?? Math.max(q.ra ?? 0, q.rb ?? 0) * Math.max(...(q.scale ?? [1, 1, 1])));
    for (const c of pts) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], c[a] - r); max[a] = Math.max(max[a], c[a] + r); }
  }
  for (let a = 0; a < 3; a++) { min[a] -= 3 * cellM; max[a] += 3 * cellM; }
  const n = min.map((m, a) => Math.ceil((max[a] - m) / cellM) + 1);
  const at = (/** @type {number} */ i, /** @type {number} */ j, /** @type {number} */ k) => (k * n[1] + j) * n[0] + i;

  const field = new Float32Array(n[0] * n[1] * n[2]);
  for (let k = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) {
    field[at(i, j, k)] = bodyDistance(prims, [min[0] + i * cellM, min[1] + j * cellM, min[2] + k * cellM]).d;
  }

  // Surface nets (src/world/mesh/surface-nets.js), then normals from the field's gradient and albedo
  // from the nearest primitive's region.
  const { pos, idx, count } = surfaceNets(field, n, min, cellM);
  const out = new Float32Array(count * 9);
  const A = body.albedo, e = cellM * 0.5;
  for (let vi = 0; vi < count; vi++) {
    const p = [pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]];
    const g = [0, 1, 2].map((a) => {
      const hi = p.slice(), lo = p.slice();
      hi[a] += e; lo[a] -= e;
      return bodyDistance(prims, hi).d - bodyDistance(prims, lo).d;
    });
    const gl = Math.hypot(g[0], g[1], g[2]) || 1;
    const nrm = g.map((x) => x / gl);
    const region = prims[bodyDistance(prims, p).near].region;
    let col = A[region] ?? A.back;
    if (region === 'eye') {
      const q = prims[bodyDistance(prims, p).near];
      const dir = [p[0] - q.c[0], p[1] - q.c[1], p[2] - q.c[2]].map((x) => x / q.r);
      col = body.eyeLook ? eyeColour(body.eyeLook, A, dir, Math.sign(q.c[0]) || 1, p) : oldEye(A, dir);
    } else if (region === 'shell') {
      // A turtle's carapace: dark seams between the plates, and pale dots strung in lines fanning
      // out from each plate's middle (the scutes block on the shell piece).
      const S = prims[bodyDistance(prims, p).near].scutes;
      const c = scuteAt(S, p);
      col = A.shell;
      if (c.seam < S.seamW * 0.5) col = A.seam;
      else if (S.streaks) {
        const a = (Math.atan2(c.du, c.dv) / (Math.PI * 2) + 0.5) * S.streaks + hash2(c.i, 7) * 3;
        const id = Math.floor(a), mid = Math.abs(a - id - 0.5) * 2;
        const dot = valueNoise(p[0] * S.dotScale, p[1] * S.dotScale, p[2] * S.dotScale);
        if (hash2(c.i, id) < S.streakShare && c.r > S.streakFrom && mid < S.streakW && dot > S.dotCut) col = A.fleck;
      }
    } else if (region === 'back') {
      // A body variant moves its blotches by blotch.offset (in noise cells; none by default).
      const o = body.blotch.offset ?? [0, 0, 0], s = body.blotch.scale;
      if (nrm[1] < body.bellyBelowNormalY) col = A.belly;
      else if (valueNoise(p[0] * s + o[0], p[1] * s + o[1], p[2] * s + o[2]) < body.blotch.amount * 0.75) col = A.blotch;
      // Lines along the back (a lizard's dark mid-line, pale and dark flank lines): at |x| from the
      // middle, between z[0] and z[1], where the skin faces up at least minNy.
      for (const st of body.stripes ?? []) {
        if (nrm[1] >= st.minNy && nrm[1] >= body.bellyBelowNormalY && p[2] >= st.z[0] && p[2] <= st.z[1] && Math.abs(Math.abs(p[0]) - st.x) < st.w) col = A[st.color];
      }
    }
    // Small spots on a region (a turtle's yellow-dotted skin, its plastron's dark blotches).
    const sp = body.speckle?.[region];
    if (sp) {
      const o = body.blotch?.offset ?? [0, 0, 0];
      if (valueNoise(p[0] * sp.scale + o[0], p[1] * sp.scale + o[1], p[2] * sp.scale + o[2]) > sp.cut) col = A[sp.color];
    }
    out.set(p, vi * 9);
    out.set(nrm, vi * 9 + 3);
    out.set(col, vi * 9 + 6);
  }
  return { vertices: out, indices: new Uint32Array(idx), count, bounds: { min, max } };
}

/** The first eye: a gold ring around a dark eye, from how far a point sits off its forward-up axis. @param {any} A @param {number[]} dir */
function oldEye(A, dir) {
  if (dir[1] < -0.2) return A.back;
  return dir[1] > 0.75 || dir[2] > 0.55 ? A.eye : A.eyeRing;
}

/**
 * A frog's eye (body.eyeLook): it looks out along `axis` (outward, up, forward; mirrored for the
 * right eye), a wide horizontal pupil (`pupil`, half-widths across and up, as shares of the radius)
 * in a gold iris (eyeRing) flecked darker (fleck, flecksPerM); the rest of the ball (eye) mostly
 * sits under the lid. @param {any} L @param {any} A @param {number[]} dir unit, from the eye's centre
 * @param {number} side 1 left, -1 right @param {number[]} p body point
 */
function eyeColour(L, A, dir, side, p) {
  const ax = [L.axis[0] * side, L.axis[1], L.axis[2]];
  const al = Math.hypot(ax[0], ax[1], ax[2]);
  const a = [ax[0] / al, ax[1] / al, ax[2] / al];
  // Across (horizontal, perpendicular to the axis) and up (perpendicular to both).
  let h = [a[2], 0, -a[0]];
  const hl = Math.hypot(h[0], h[2]) || 1;
  h = [h[0] / hl, 0, h[2] / hl];
  const v = [a[1] * h[2] - a[2] * h[1], a[2] * h[0] - a[0] * h[2], a[0] * h[1] - a[1] * h[0]];
  const dot = (/** @type {number[]} */ u, /** @type {number[]} */ w) => u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
  const along = dot(dir, a), x = dot(dir, h), y = dot(dir, v);
  if (along > 0 && (x / L.pupil[0]) ** 2 + (y / L.pupil[1]) ** 2 < 1) return A.pupil;
  if (along > L.irisCos) {
    const f = L.flecksPerM;
    const n = Math.sin(p[0] * f) * Math.sin(p[1] * f * 0.85 + 1.3) * Math.sin(p[2] * f * 0.92 + 2.1);
    return n > L.fleckShare ? A.fleck : A.eyeRing;
  }
  return A.eye;
}

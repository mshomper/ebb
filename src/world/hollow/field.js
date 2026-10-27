// @ts-check
// A Hollow floor's signed field (H1, the floor maker; doc 16, How it is built). The air is the
// chambers (blended blobs or faceted pockets with flat floors, shelves, puddles, a channel) joined
// by bent passages with a smooth minimum, less the rock stood in it (columns, hanging stone,
// crystals), worn with seeded noise. The sponge keeps only the rock of a gyroid lattice inside its
// widened chambers, thicker toward the walls. The mesher wants rock negative, so a sample is minus
// the air distance, clamped (only the surface matters). Pure and deterministic: + - * /, sqrt,
// min, max and floor on the samples, with the gyroid's sines from det (src/core/rng.js), so a
// floor is the same in every browser and worker, and a slab is the same however the floor is split.

import { det } from '../../core/rng.js';
import { ellDist } from './shapes.js';

/** Smooth minimum (as body-bake.js). @param {number} a @param {number} b @param {number} k */
function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** A faceted pocket: the farthest plane. @param {any} q @param {number} x @param {number} y @param {number} z */
function polyDist(q, x, y, z) {
  const dx = x - q.c[0], dy = y - q.c[1], dz = z - q.c[2];
  let d = -Infinity;
  for (const p of q.planes) d = Math.max(d, dx * p[0] + dy * p[1] + dz * p[2] - p[3]);
  return d;
}

/** A rounded box, yawed about y. @param {any} q @param {number} x @param {number} y @param {number} z */
function boxDist(q, x, y, z) {
  const dx = x - q.c[0], dy = y - q.c[1], dz = z - q.c[2];
  const lx = dx * q.cos + dz * q.sin, lz = -dx * q.sin + dz * q.cos;
  const rr = q.h[3];
  const ax = Math.abs(lx) - (q.h[0] - rr), ay = Math.abs(dy) - (q.h[1] - rr), az = Math.abs(lz) - (q.h[2] - rr);
  const ox = Math.max(ax, 0), oy = Math.max(ay, 0), oz = Math.max(az, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(ax, ay, az), 0) - rr;
}

/** A round cone from c (radius ra) to b (radius rb). @param {any} q @param {number} x @param {number} y @param {number} z */
function coneDist(q, x, y, z) {
  const bx = q.b[0] - q.c[0], by = q.b[1] - q.c[1], bz = q.b[2] - q.c[2];
  const px = x - q.c[0], py = y - q.c[1], pz = z - q.c[2];
  const l2 = bx * bx + by * by + bz * bz;
  const t = Math.min(1, Math.max(0, (px * bx + py * by + pz * bz) / Math.max(l2, 1e-12)));
  const ex = px - bx * t, ey = py - by * t, ez = pz - bz * t;
  return Math.sqrt(ex * ex + ey * ey + ez * ez) - (q.ra + (q.rb - q.ra) * t);
}

/** A hexagonal prism in its own frame (after Inigo Quilez's sdHexPrism). @param {any} q @param {number} x @param {number} y @param {number} z */
function hexDist(q, x, y, z) {
  const dx = x - q.c[0], dy = y - q.c[1], dz = z - q.c[2], a = q.ax;
  let px = Math.abs(dx * a[3] + dy * a[4] + dz * a[5]), py = Math.abs(dx * a[6] + dy * a[7] + dz * a[8]);
  const pz = Math.abs(dx * a[0] + dy * a[1] + dz * a[2]);
  const kx = -0.8660254037844386, ky = 0.5, kz = 0.5773502691896258;
  const dd = 2 * Math.min(kx * px + ky * py, 0);
  px -= dd * kx; py -= dd * ky;
  const cx = Math.min(kz * q.hr, Math.max(-kz * q.hr, px));
  const ex = px - cx, ey = py - q.hr;
  const sx = Math.sqrt(ex * ex + ey * ey) * (ey < 0 ? -1 : 1), sy = pz - q.hl;
  const ox = Math.max(sx, 0), oy = Math.max(sy, 0);
  return Math.min(Math.max(sx, sy), 0) + Math.sqrt(ox * ox + oy * oy);
}

/** Any primitive's distance. @param {any} q @param {number} x @param {number} y @param {number} z */
function primDist(q, x, y, z) {
  switch (q.t) {
    case 'ell': return ellDist(q, x, y, z);
    case 'poly': return polyDist(q, x, y, z);
    case 'box': return boxDist(q, x, y, z);
    case 'cone': return coneDist(q, x, y, z);
    case 'hex': return hexDist(q, x, y, z);
    default: return Infinity;
  }
}

/** One chamber's air: its blobs blended, a flat floor, then what is carved and filled. @param {any} c @param {number} x @param {number} y @param {number} z */
function chamberAir(c, x, y, z) {
  let a = Infinity;
  for (const b of c.blobs) a = a === Infinity ? primDist(b, x, y, z) : smin(a, primDist(b, x, y, z), c.blend);
  a = Math.max(a, c.y - y);
  for (const q of c.airAdd) a = smin(a, primDist(q, x, y, z), 0.3);
  for (const q of c.rockAdd) a = Math.max(a, -primDist(q, x, y, z));
  return a;
}

/** A bent passage's air and the floor height under the nearest part of it. @param {any} p @param {number} x @param {number} y @param {number} z @param {number[]} out */
function passageAir(p, x, y, z, out) {
  let best = Infinity, fy = 0;
  for (let i = 1; i < p.pts.length; i++) {
    const a = p.pts[i - 1], b = p.pts[i];
    const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
    const px = x - a[0], py = y - a[1] - p.lift, pz = z - a[2];
    const l2 = bx * bx + by * by + bz * bz;
    const t = Math.min(1, Math.max(0, (px * bx + py * by + pz * bz) / Math.max(l2, 1e-12)));
    const ex = px - bx * t, ey = py - by * t, ez = pz - bz * t;
    const floor = a[1] + by * t;
    const d = Math.max(Math.sqrt(ex * ex + ey * ey + ez * ez) - p.r, floor - y);
    if (d < best) { best = d; fy = floor; }
  }
  out[0] = best; out[1] = fy;
}

/** A 0..1 value noise in 3D, seeded (integer hashes only). @param {number} seed @param {number} x @param {number} y @param {number} z */
export function noise3(seed, x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const h = (/** @type {number} */ i, /** @type {number} */ j, /** @type {number} */ k) => {
    let n = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 2147483647) + Math.imul(seed, 1103515245)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const x0 = h(xi, yi, zi) + (h(xi + 1, yi, zi) - h(xi, yi, zi)) * u;
  const x1 = h(xi, yi + 1, zi) + (h(xi + 1, yi + 1, zi) - h(xi, yi + 1, zi)) * u;
  const x2 = h(xi, yi, zi + 1) + (h(xi + 1, yi, zi + 1) - h(xi, yi, zi + 1)) * u;
  const x3 = h(xi, yi + 1, zi + 1) + (h(xi + 1, yi + 1, zi + 1) - h(xi, yi + 1, zi + 1)) * u;
  const y0 = x0 + (x1 - x0) * v, y1 = x2 + (x3 - x2) * v;
  return y0 + (y1 - y0) * w;
}

/**
 * The air's signed distance at a point (negative in the air), given the active chambers, passages
 * and rock nearby, and the gyroid's sines and cosines there (the sponge only).
 * @param {any} D dressed floor @param {any[]} chs @param {any[]} pas @param {any[]} rocks
 * @param {number} x @param {number} y @param {number} z @param {number[]} g sin and cos of f x, f y, f z (6 numbers)
 * @param {number} cap stop early once the air is this far off (the clamp)
 */
export function airAt(D, chs, pas, rocks, x, y, z, g, cap) {
  let air = Infinity, best = Infinity, floorY = 0;
  const tmp = [0, 0];
  for (const c of chs) {
    const a = chamberAir(c, x, y, z);
    air = air === Infinity ? a : smin(air, a, D.passageBlend);
    if (a < best) { best = a; floorY = c.y; }
  }
  for (const p of pas) {
    passageAir(p, x, y, z, tmp);
    air = air === Infinity ? tmp[0] : smin(air, tmp[0], D.passageBlend);
    if (tmp[0] < best) { best = tmp[0]; floorY = tmp[1]; }
  }
  const W = D.wear;
  if (air > cap + W.amountM + W.fineM) return cap;
  if (D.sponge) {
    // Gyroid: sin x cos y + sin y cos z + sin z cos x; rock where it rises past the strut level.
    const S = D.sponge, f = (2 * det.PI) / S.periodM;
    const G = g[0] * g[3] + g[2] * g[5] + g[4] * g[1];
    const nearWall = Math.min(1, Math.max(0, 1 + air / 2));
    // Thinned in the walking band over the floor, easing back above it.
    const band = Math.min(1, Math.max(0, (floorY + S.walkBandM + S.bandFadeM - y) / S.bandFadeM));
    const open = S.thickness - S.wallThicken * nearWall;
    const level = open + (S.bandLevel - open) * band * band * (3 - 2 * band);
    air = Math.max(air, (G - level) / (f * 1.5));
  }
  for (const q of rocks) air = Math.max(air, -primDist(q, x, y, z));
  // Wear: the walls more than the floor.
  const up = Math.min(1, Math.max(0, (y - floorY) / W.wallFromM));
  const amt = W.amountM * (W.floorShare + (1 - W.floorShare) * up * up * (3 - 2 * up));
  air += (noise3(D.noiseSeed, x / W.scaleM, y / W.scaleM, z / W.scaleM) - 0.5) * 2 * amt;
  air += (noise3(D.noiseSeed + 1, x / W.fineScaleM, y / W.fineScaleM, z / W.fineScaleM) - 0.5) * 2 * W.fineM * (W.floorShare + (1 - W.floorShare) * up);
  return air;
}

/**
 * The sample grid over a dressed floor: its corner, sample counts and spacing.
 * @param {any} D dressed floor @param {any} M recipe floors.mesh
 * @returns {{ min: number[], n: number[], cellM: number }}
 */
export function floorBounds(D, M) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const c of D.chambers) {
    lo[0] = Math.min(lo[0], c.x - c.reach); hi[0] = Math.max(hi[0], c.x + c.reach);
    lo[2] = Math.min(lo[2], c.z - c.reach); hi[2] = Math.max(hi[2], c.z + c.reach);
    lo[1] = Math.min(lo[1], c.y - 2); hi[1] = Math.max(hi[1], c.y + c.height);
  }
  for (const p of D.passages) for (const q of p.pts) {
    lo[0] = Math.min(lo[0], q[0] - p.r); hi[0] = Math.max(hi[0], q[0] + p.r);
    lo[2] = Math.min(lo[2], q[2] - p.r); hi[2] = Math.max(hi[2], q[2] + p.r);
    hi[1] = Math.max(hi[1], q[1] + p.lift + p.r);
  }
  // Coarser for bigger floors, so the triangle count stays near the same.
  const more = Math.sqrt(Math.max(1, D.chambers.length / M.refChambers));
  const c = Math.round(Math.min(M.maxCellM, M.cellM * more) * (D.sponge ? M.spongeCellShare : D.cellShare) * 1000) / 1000;
  const min = lo.map((v) => Math.floor((v - M.marginM) / c) * c);
  const n = hi.map((v, a) => Math.ceil((v + M.marginM - min[a]) / c) + 1);
  return { min, n, cellM: c };
}

/** A plan rectangle [x0, z0, x1, z1] round a chamber, passage or rock piece, grown by pad. @param {any} q @param {number} pad */
function rectOf(q, pad) {
  if (q.blobs) return [q.x - q.reach - pad, q.z - q.reach - pad, q.x + q.reach + pad, q.z + q.reach + pad];
  if (q.pts) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of q.pts) { x0 = Math.min(x0, p[0]); z0 = Math.min(z0, p[2]); x1 = Math.max(x1, p[0]); z1 = Math.max(z1, p[2]); }
    return [x0 - q.r - pad, z0 - q.r - pad, x1 + q.r + pad, z1 + q.r + pad];
  }
  if (q.t === 'cone') {
    const r = Math.max(q.ra, q.rb);
    return [Math.min(q.c[0], q.b[0]) - r - pad, Math.min(q.c[2], q.b[2]) - r - pad, Math.max(q.c[0], q.b[0]) + r + pad, Math.max(q.c[2], q.b[2]) + r + pad];
  }
  const r = q.hl + q.hr;
  return [q.c[0] - r - pad, q.c[2] - r - pad, q.c[0] + r + pad, q.c[2] + r + pad];
}

/**
 * Sample one slab of the field, z layers k0 to k1 (exclusive). Runs in a worker (src/core/workers.js);
 * the floor's slabs side by side are the whole field, the same as one call over it all.
 * @param {{ dressed: any, bounds: { min: number[], n: number[], cellM: number }, k0: number, k1: number, clampM: number }} args
 * @returns {{ field: Float32Array, k0: number, k1: number, __transfer: Transferable[] }}
 */
export function fieldSlab({ dressed: D, bounds, k0, k1, clampM }) {
  const { min, n, cellM } = bounds;
  const [nx, ny] = n;
  const field = new Float32Array(nx * ny * (k1 - k0));
  const pad = Math.max(D.passageBlend, 0) + clampM + D.wear.amountM + D.wear.fineM;
  const items = { chs: D.chambers.map((/** @type {any} */ c) => [c, rectOf(c, pad + c.blend)]), pas: D.passages.map((/** @type {any} */ p) => [p, rectOf(p, pad)]), rocks: D.rock.map((/** @type {any} */ q) => [q, rectOf(q, pad)]) };
  const f = D.sponge ? (2 * det.PI) / D.sponge.periodM : 0;
  // The gyroid's sines along each axis, once per sample row.
  const trig = (/** @type {number} */ count, /** @type {number} */ m0) => {
    const s = new Float64Array(count), c = new Float64Array(count);
    if (f) for (let i = 0; i < count; i++) { s[i] = det.sin(f * (m0 + i * cellM)); c[i] = det.cos(f * (m0 + i * cellM)); }
    return [s, c];
  };
  const [sxA, cxA] = trig(nx, min[0]), [syA, cyA] = trig(ny, min[1]);
  const [szA, czA] = trig(n[2], min[2]);
  const g = [0, 0, 0, 0, 0, 0];
  const inRect = (/** @type {number[]} */ r, /** @type {number} */ x, /** @type {number} */ z) => x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3];
  for (let k = k0; k < k1; k++) {
    const z = min[2] + k * cellM;
    g[4] = szA[k]; g[5] = czA[k];
    for (let i = 0; i < nx; i++) {
      const x = min[0] + i * cellM;
      const chs = [], pas = [], rocks = [];
      for (const [c, r] of items.chs) if (inRect(r, x, z)) chs.push(c);
      for (const [p, r] of items.pas) if (inRect(r, x, z)) pas.push(p);
      for (const [q, r] of items.rocks) if (inRect(r, x, z)) rocks.push(q);
      g[0] = sxA[i]; g[1] = cxA[i];
      for (let j = 0; j < ny; j++) {
        const at = ((k - k0) * ny + j) * nx + i;
        if (chs.length === 0 && pas.length === 0) { field[at] = -clampM; continue; }
        g[2] = syA[j]; g[3] = cyA[j];
        const air = airAt(D, chs, pas, rocks, x, min[1] + j * cellM, z, g, clampM);
        field[at] = Math.min(clampM, Math.max(-clampM, -air));
      }
    }
  }
  return { field, k0, k1, __transfer: [field.buffer] };
}

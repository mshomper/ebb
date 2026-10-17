// @ts-check
// Deterministic base landform (doc 08): land recipe + seed -> one chunk's base heights
// (quantized) and material weights. Runs as a worker job or on the main thread.
// Uses only hash32 and + - * /, Math.floor, Math.sqrt, Math.abs, Math.min/max, so every
// browser and worker produces bit-identical chunks. Height is a pure function of world
// (x, z), seed and recipe, so chunk seams match with no blending.

import { hash32, det } from '../../core/rng.js';
import { CELL, CHUNK_CELLS, CHUNK_SIZE, quantize } from './grid.js';

/**
 * @typedef {Object} FbmRecipe
 * @property {number} scale       base frequency in cycles per meter
 * @property {number} octaves
 * @property {number} [lacunarity] default 2
 * @property {number} [gain]       default 0.5
 */
/**
 * @typedef {Object} LandRecipe  parsed recipes/land/*.json (fields documented in the recipe's note)
 * @property {number} radius @property {number} plateauHeight @property {number} inlandWidth
 * @property {number} beachSlope @property {number} seaFallWidth @property {number} seabedDepth
 * @property {number} falloffStart @property {number} falloffEnd
 * @property {{amount: number} & FbmRecipe} coast
 * @property {{strength: number} & FbmRecipe} warp
 * @property {{amplitude: number} & FbmRecipe} detail
 * @property {{x: number, z: number, jitter: number, radius: number, height: number}} rise
 * @property {{x: number, z: number, jitter: number, innerRadius: number, outerRadius: number,
 *   floor: number, floorNoise: number, rimWobble: number, wobbleScale: number}} basin
 * @property {{sandLow: number, sandHigh: number, sandJitter: number, sandJitterScale: number,
 *   soilScale: number, soilLow: number, soilHigh: number, soilMax: number, basinSoil: number,
 *   rockScale: number, rockLow: number, rockHigh: number, rockMinHeight: number, rockFade: number}} materials
 */

// Layer ids mixed into the seed so each noise field is independent.
const L_WARP_X = 1, L_WARP_Z = 2, L_COAST = 3, L_DETAIL = 4, L_SAND = 5, L_SOIL = 6, L_ROCK = 7;
const L_BASIN = 8, L_FLOOR = 9, L_RISE_POS = 10, L_BASIN_POS = 11;

const CELLS = CHUNK_CELLS * CHUNK_CELLS;

// ---------------------------------------------------------------------------
// Noise

/** Quintic fade 6t^5 - 15t^4 + 10t^3. @param {number} t */
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/**
 * One lattice corner of value-gradient noise: a random value plus a random gradient
 * dotted with the offset, all decoded from one hash.
 * @param {number} h uint32 corner hash @param {number} dx @param {number} dz
 */
function corner(h, dx, dz) {
  const gx = (h & 1023) * (2 / 1023) - 1;
  const gz = ((h >>> 10) & 1023) * (2 / 1023) - 1;
  const v = (h >>> 20) * (2 / 4095) - 1;
  return v + gx * dx + gz * dz;
}

// Corner-hash cache slots per octave: [ix, iz, h00, h10, h01, h11]. Neighboring cells
// almost always fall in the same lattice square, so this skips most hash32 calls.
// It only memoizes a pure function, so results are unchanged.
const SLOT = 6;

/**
 * Value-gradient noise with quintic fades, roughly in [-1, 1].
 * @param {number} x @param {number} z @param {number} seed
 * @param {Float64Array} cache @param {number} at  cache slot offset
 */
function noise(x, z, seed, cache, at) {
  const ix = Math.floor(x), iz = Math.floor(z);
  if (cache[at] !== ix || cache[at + 1] !== iz) {
    cache[at] = ix; cache[at + 1] = iz;
    cache[at + 2] = hash32(ix, iz, seed);
    cache[at + 3] = hash32(ix + 1, iz, seed);
    cache[at + 4] = hash32(ix, iz + 1, seed);
    cache[at + 5] = hash32(ix + 1, iz + 1, seed);
  }
  const fx = x - ix, fz = z - iz;
  const ux = fade(fx), uz = fade(fz);
  const a = corner(cache[at + 2], fx, fz);
  const b = corner(cache[at + 3], fx - 1, fz);
  const c = corner(cache[at + 4], fx, fz - 1);
  const d = corner(cache[at + 5], fx - 1, fz - 1);
  const ab = a + (b - a) * ux;
  const cd = c + (d - c) * ux;
  return 0.5 * (ab + (cd - ab) * uz);
}

/**
 * @typedef {Object} Fbm
 * @property {Uint32Array} seeds  one seed per octave
 * @property {Float64Array} cache corner-hash cache, SLOT numbers per octave
 * @property {number} scale @property {number} lacunarity @property {number} gain @property {number} norm
 */

/** @param {number} seed @param {number} layer @param {FbmRecipe} r @returns {Fbm} */
function makeFbm(seed, layer, r) {
  const n = Math.max(1, Math.floor(r.octaves));
  const seeds = new Uint32Array(n);
  const cache = new Float64Array(n * SLOT).fill(NaN);
  const gain = r.gain ?? 0.5;
  let amp = 1, sum = 0;
  for (let o = 0; o < n; o++) { seeds[o] = hash32(seed, layer, o); sum += amp; amp *= gain; }
  return { seeds, cache, scale: r.scale, lacunarity: r.lacunarity ?? 2, gain, norm: 1 / sum };
}

/**
 * Fractal sum of noise octaves, each rotated (0.8, 0.6) from the last to hide lattice axes.
 * Normalized so the result is roughly in [-1, 1].
 * @param {Fbm} f @param {number} x @param {number} z
 */
function fbm(f, x, z) {
  let px = x * f.scale, pz = z * f.scale, amp = 1, sum = 0;
  for (let o = 0; o < f.seeds.length; o++) {
    sum += amp * noise(px, pz, f.seeds[o], f.cache, o * SLOT);
    const rx = 0.8 * px - 0.6 * pz, rz = 0.6 * px + 0.8 * pz;
    px = rx * f.lacunarity; pz = rz * f.lacunarity;
    amp *= f.gain;
  }
  return sum * f.norm;
}

// ---------------------------------------------------------------------------
// Shaping helpers

/** @param {number} t */
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
/** @param {number} a @param {number} b @param {number} x */
function smoothstep(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
/**
 * Cubic Hermite from 0 (slope m0, in units of t) to p1 (slope 0) over t in [0, 1].
 * @param {number} t @param {number} m0 @param {number} p1
 */
function hermite(t, m0, p1) {
  const u = clamp01(t), u2 = u * u, u3 = u2 * u;
  return m0 * (u3 - 2 * u2 + u) + p1 * (3 * u2 - 2 * u3);
}
/** Soft round bump: (1 - t^2)^2 for t < 1, else 0. @param {number} t */
function bump(t) {
  if (t >= 1) return 0;
  const k = 1 - t * t;
  return k * k;
}
/** Uniform-ish float in [-1, 1] from a hash. @param {number} seed @param {number} a @param {number} b */
const signedHash = (seed, a, b) => (hash32(seed, a, b) >>> 8) * (2 / 16777215) - 1;

// ---------------------------------------------------------------------------
// Landform context: everything that depends on recipe and seed but not on the cell.

/** @param {LandRecipe} land @param {number} seed */
function makeContext(land, seed) {
  const r = land.rise, b = land.basin, m = land.materials;
  const riseX = r.x + r.jitter * signedHash(seed, L_RISE_POS, 0);
  const riseZ = r.z + r.jitter * signedHash(seed, L_RISE_POS, 1);
  const basinX = b.x + b.jitter * signedHash(seed, L_BASIN_POS, 0);
  const basinZ = b.z + b.jitter * signedHash(seed, L_BASIN_POS, 1);
  // The spring's channel: from the spring down to the edge of the basin floor (docs/07).
  const sp = /** @type {any} */ (land).spring;
  let channel = null;
  if (sp?.channel) {
    const dx = riseX - basinX, dz = riseZ - basinZ;
    const dl = Math.sqrt(dx * dx + dz * dz) || 1;
    const ux = dx / dl, uz = dz / dl;
    channel = {
      sx: basinX + ux * sp.fromBasinM, sz: basinZ + uz * sp.fromBasinM,
      ex: basinX + ux * b.innerRadius, ez: basinZ + uz * b.innerRadius,
      halfWidth: sp.channel.widthM * 0.5, depth: sp.channel.depthM,
      meander: sp.channel.meanderM ?? 0, bends: sp.channel.bends ?? 1,
      thalwegHalf: (sp.channel.thalwegWidthM ?? 0.8) * 0.5, thalwegDepth: sp.channel.thalwegDepthM ?? 0,
    };
  }
  return {
    land,
    warpX: makeFbm(seed, L_WARP_X, land.warp),
    warpZ: makeFbm(seed, L_WARP_Z, land.warp),
    coast: makeFbm(seed, L_COAST, land.coast),
    detail: makeFbm(seed, L_DETAIL, land.detail),
    sand: makeFbm(seed, L_SAND, { scale: m.sandJitterScale, octaves: 2 }),
    soil: makeFbm(seed, L_SOIL, { scale: m.soilScale, octaves: 3 }),
    rock: makeFbm(seed, L_ROCK, { scale: m.rockScale, octaves: 2 }),
    basinWobble: makeFbm(seed, L_BASIN, { scale: b.wobbleScale, octaves: 2 }),
    floor: makeFbm(seed, L_FLOOR, { scale: 0.3, octaves: 2 }),
    riseX, riseZ, basinX, basinZ, channel,
    // Hermite end slopes, in units of the ramp parameter, so both sides meet the
    // waterline with the same gentle beach slope (no crease at the shore).
    landM0: land.beachSlope * land.inlandWidth,
    seaM0: -land.beachSlope * land.seaFallWidth,
  };
}
/** @typedef {ReturnType<typeof makeContext>} Ctx */

/**
 * The starter spring (docs/07): `fromBasinM` from the basin center toward the rise, so its
 * channel runs down into the pond hollow. Null when the land has no spring.
 * @param {Ctx} c
 */
function springOf(c) {
  const sp = /** @type {any} */ (c.land).spring;
  if (!sp) return null;
  const dx = c.riseX - c.basinX, dz = c.riseZ - c.basinZ;
  const dl = Math.sqrt(dx * dx + dz * dz) || 1;
  return { x: c.basinX + (dx / dl) * sp.fromBasinM, z: c.basinZ + (dz / dl) * sp.fromBasinM, spec: sp };
}

/**
 * Seeded centers of the land's rise and pond basin and the starter spring, for systems that place
 * things on the landform (the water simulation, docs/07).
 * @param {LandRecipe} land @param {number} seed the terrain sub-seed
 */
export function landmarks(land, seed) {
  const c = makeContext(land, seed >>> 0);
  const s = springOf(c);
  return {
    rise: { x: c.riseX, z: c.riseZ }, basin: { x: c.basinX, z: c.basinZ },
    spring: s ? { x: s.x, z: s.z, rateLps: s.spec.rateLps } : null,
  };
}

/**
 * Base height and material weights at world (x, z). Writes [h, grass, sand, rock, soil] to out.
 * @param {Ctx} c @param {number} x @param {number} z @param {Float64Array} out
 */
function sampleCell(c, x, z, out) {
  const L = c.land, M = L.materials;
  const r = Math.sqrt(x * x + z * z);
  if (r >= L.falloffEnd) {
    out[0] = L.seabedDepth; out[1] = 0; out[2] = 1; out[3] = 0; out[4] = 0;
    return;
  }
  // Domain warp (Quilez): sample the shape fields at a gently displaced point.
  const px = x + L.warp.strength * fbm(c.warpX, x, z);
  const pz = z + L.warp.strength * fbm(c.warpZ, x, z);

  // Shore profile from the signed distance inland, with a noisy coast.
  const d = r + L.coast.amount * fbm(c.coast, px, pz);
  const s = L.radius - d;
  let h = s >= 0
    ? hermite(s / L.inlandWidth, c.landM0, L.plateauHeight)
    : hermite(-s / L.seaFallWidth, c.seaM0, L.seabedDepth);

  // Land features fade in from the shore.
  const landMask = smoothstep(0, L.inlandWidth, s);
  let riseW = 0;
  if (landMask > 0) {
    const rx = px - c.riseX, rz = pz - c.riseZ;
    riseW = bump(Math.sqrt(rx * rx + rz * rz) / L.rise.radius);
    h += landMask * (L.rise.height * riseW + L.detail.amplitude * fbm(c.detail, px, pz));
  }

  // Basin: blend toward a flat floor above sea level, bank shape smoothstep.
  const bx = x - c.basinX, bz = z - c.basinZ;
  const B = L.basin;
  let basinW = 0;
  const bd = Math.sqrt(bx * bx + bz * bz);
  if (bd < B.outerRadius + 2 * B.rimWobble) { // 2x: fbm can slightly exceed [-1, 1]
    const wob = bd + B.rimWobble * fbm(c.basinWobble, x, z);
    basinW = 1 - smoothstep(B.innerRadius, B.outerRadius, wob);
    if (basinW > 0) {
      const floorH = B.floor + B.floorNoise * fbm(c.floor, x, z);
      if (h > floorH) h += (floorH - h) * basinW;
    }
  }

  // The spring's channel: a soft trough along the warped line from the spring to the pond, so
  // the stream has a bed to run in and meanders a little with the domain warp.
  let chanW = 0;
  const ch = c.channel;
  if (ch && landMask > 0) {
    const vx = ch.ex - ch.sx, vz = ch.ez - ch.sz;
    const len2 = vx * vx + vz * vz;
    const t = Math.min(1, Math.max(0, ((px - ch.sx) * vx + (pz - ch.sz) * vz) / len2));
    // Meander: a sideways swing along the run, tapering to nothing at the spring and the pond.
    // det.sin, not Math.sin: the landform must be bit-identical in every browser (CLAUDE.md).
    const swing = ch.meander * det.sin(2 * det.PI * ch.bends * t) * 4 * t * (1 - t);
    const inv = 1 / Math.sqrt(len2);
    const qx = px - (ch.sx + vx * t - vz * inv * swing), qz = pz - (ch.sz + vz * t + vx * inv * swing);
    // A wide soft swale with a narrow V-shaped thread (the thalweg) along its middle, where the
    // flow gathers into a stream instead of spreading as a sheet.
    const q = Math.sqrt(qx * qx + qz * qz);
    const head = smoothstep(0, 0.08, t);
    chanW = bump(q / ch.halfWidth) * head;
    const tw = Math.max(0, 1 - q / ch.thalwegHalf);
    h -= landMask * (ch.depth * chanW + ch.thalwegDepth * tw * Math.sqrt(tw) * head);
  }

  // Outer falloff: everything joins the open seabed before falloffEnd.
  const fall = smoothstep(L.falloffStart, L.falloffEnd, r);
  if (fall > 0) h += (L.seabedDepth - h) * fall;

  // Materials. Sand on the shore band and underwater, rock outcrops high on the rise,
  // soil patches on land and on the basin floor, grass for the rest.
  let sand = 1, rock = 0, soil = 0;
  if (h > M.sandLow - 2 * M.sandJitter) {
    const j = M.sandJitter * fbm(c.sand, x, z);
    // The basin floor sits in the sand height band but is a pond bed, not a beach.
    sand = (1 - smoothstep(M.sandLow + j, M.sandHigh + j, h)) * (1 - basinW);
    if (h > M.rockMinHeight) {
      rock = smoothstep(M.rockMinHeight, M.rockMinHeight + M.rockFade, h) *
        smoothstep(M.rockLow, M.rockHigh, fbm(c.rock, x, z));
    }
    soil = M.soilMax * smoothstep(M.soilLow, M.soilHigh, fbm(c.soil, x, z));
    soil = Math.max(soil, basinW * M.basinSoil);
    // Running water scours the channel bed down to soil and gravel.
    soil = Math.max(soil, chanW * M.basinSoil);
  }
  const sandW = sand * (1 - rock);
  const soilW = soil * (1 - rock) * (1 - sand);
  out[0] = h;
  out[2] = sandW;
  out[3] = rock;
  out[4] = soilW;
  out[1] = Math.max(0, 1 - sandW - rock - soilW);
}

// ---------------------------------------------------------------------------
// Public API

/**
 * Build one chunk's base landform.
 * Cell (i, j) of chunk (cx, cz) is at index j * 128 + i, world center
 * x = 32 cx - 16 + (i + 0.5) 0.25, z likewise.
 * @param {{land: LandRecipe, seed: number, cx: number, cz: number}} args
 * @returns {{cx: number, cz: number, heightQ: Uint16Array, material: Uint8Array, __transfer: ArrayBuffer[]}}
 */
export function buildBase({ land, seed, cx, cz }) {
  const c = makeContext(land, seed >>> 0);
  const heightQ = new Uint16Array(CELLS);
  const material = new Uint8Array(CELLS * 4);
  const out = new Float64Array(5);
  const x0 = CHUNK_SIZE * cx - CHUNK_SIZE / 2;
  const z0 = CHUNK_SIZE * cz - CHUNK_SIZE / 2;
  for (let j = 0; j < CHUNK_CELLS; j++) {
    const z = z0 + (j + 0.5) * CELL;
    for (let i = 0; i < CHUNK_CELLS; i++) {
      const x = x0 + (i + 0.5) * CELL;
      sampleCell(c, x, z, out);
      const k = j * CHUNK_CELLS + i;
      heightQ[k] = quantize(out[0]);
      writeWeights(material, k * 4, out);
    }
  }
  return { cx, cz, heightQ, material, __transfer: [heightQ.buffer, material.buffer] };
}

/**
 * Four weights (grass, sand, rock, soil) to bytes that sum to exactly 255, by rounding
 * the running total so rounding errors never pile up.
 * @param {Uint8Array} dst @param {number} at @param {Float64Array} w  [h, grass, sand, rock, soil]
 */
function writeWeights(dst, at, w) {
  const total = w[1] + w[2] + w[3] + w[4];
  if (!(total > 0)) { dst[at] = 255; dst[at + 1] = 0; dst[at + 2] = 0; dst[at + 3] = 0; return; }
  const k = 255 / total;
  const c1 = Math.min(255, Math.floor(w[1] * k + 0.5));
  const c2 = Math.max(c1, Math.min(255, Math.floor((w[1] + w[2]) * k + 0.5)));
  const c3 = Math.max(c2, Math.min(255, Math.floor((w[1] + w[2] + w[3]) * k + 0.5)));
  dst[at] = c1;
  dst[at + 1] = c2 - c1;
  dst[at + 2] = c3 - c2;
  dst[at + 3] = 255 - c3;
}

/**
 * Cheap uint32 fingerprint of a chunk base (FNV-1a over heights, then material bytes).
 * Endian-independent: material bytes are folded four at a time in a fixed order.
 * @param {Uint16Array} heightQ
 * @param {Uint8Array} material
 * @returns {number} uint32
 */
export function hashBase(heightQ, material) {
  let h = 2166136261;
  for (let k = 0; k < heightQ.length; k++) h = Math.imul(h ^ heightQ[k], 16777619);
  for (let k = 0; k + 3 < material.length; k += 4) {
    const v = material[k] | (material[k + 1] << 8) | (material[k + 2] << 16) | (material[k + 3] << 24);
    h = Math.imul(h ^ v, 16777619);
  }
  return hash32(h, heightQ.length, material.length);
}

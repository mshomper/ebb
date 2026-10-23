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
 * @property {Basin} [basin]    one pond hollow (the starter island), or
 * @property {Basin[]} [basins] several: ponds and marshes (a marsh is a wide, shallow basin)
 * @property {any} [spring]     one spring feeding the basin, or
 * @property {any[]} [springs]  several, each with `basin` (index) and optional `bearingDeg`
 * @property {{sandLow: number, sandHigh: number, sandJitter: number, sandJitterScale: number,
 *   soilScale: number, soilLow: number, soilHigh: number, soilMax: number, basinSoil: number,
 *   rockScale: number, rockLow: number, rockHigh: number, rockMinHeight: number, rockFade: number,
 *   sandFloorM?: number, sandFloorSoftM?: number}} materials
 */

/**
 * @typedef {{x: number, z: number, jitter: number, innerRadius: number, outerRadius: number,
 *   floor: number, floorNoise: number, rimWobble: number, wobbleScale: number, floorScale?: number, soil?: number}} Basin
 *   floorScale: its own floor-noise frequency (cycles per meter; marsh tussocks), else the shared one;
 *   soil: how much of its floor is soil (0..1), else the land's materials.basinSoil
 */

// Layer ids mixed into the seed so each noise field is independent. A second basin or spring adds
// LAYER_STEP times its index to its layers, so the first keeps exactly the ids it always had.
const LAYER_STEP = 16;
const L_WARP_X = 1, L_WARP_Z = 2, L_COAST = 3, L_DETAIL = 4, L_SAND = 5, L_SOIL = 6, L_ROCK = 7;
const L_BASIN = 8, L_FLOOR = 9, L_RISE_POS = 10, L_BASIN_POS = 11, L_OUTCROP = 12, L_STONE_LUMP = 13;
const L_LOBES = 14, L_POINTS = 15;

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
export function makeFbm(seed, layer, r) {
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
export function fbm(f, x, z) {
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
  const r = land.rise, m = land.materials;
  const riseX = r.x + r.jitter * signedHash(seed, L_RISE_POS, 0);
  const riseZ = r.z + r.jitter * signedHash(seed, L_RISE_POS, 1);
  // Basins: ponds and marshes, each placed and wobbled by its own seeded layers.
  const sharedFloor = makeFbm(seed, L_FLOOR, { scale: 0.3, octaves: 2 });
  const basins = (land.basins ?? (land.basin ? [land.basin] : [])).map((b, i) => ({
    B: b,
    x: b.x + b.jitter * signedHash(seed, L_BASIN_POS + LAYER_STEP * i, 0),
    z: b.z + b.jitter * signedHash(seed, L_BASIN_POS + LAYER_STEP * i, 1),
    wobble: makeFbm(seed, L_BASIN + LAYER_STEP * i, { scale: b.wobbleScale, octaves: 2 }),
    floor: b.floorScale ? makeFbm(seed, L_FLOOR + LAYER_STEP * i, { scale: b.floorScale, octaves: 2 }) : sharedFloor,
  }));
  // Springs: each one's channel runs from the spring down to the edge of its basin's floor
  // (docs/07), uphill toward the rise unless the recipe gives a bearing.
  /** @type {any[]} */ const springSpecs = /** @type {any} */ (land).springs ?? (/** @type {any} */ (land).spring ? [/** @type {any} */ (land).spring] : []);
  /** @type {any[]} */ const channels = [];
  /** @type {any[]} */ const outcrops = [];
  /** @type {{ x: number, z: number, spec: any }[]} */ const springHeads = [];
  springSpecs.forEach((sp, j) => {
    const basin = basins[sp.basin ?? 0];
    if (!basin) return;
    let ux, uz;
    if (sp.bearingDeg !== undefined) {
      ux = det.cos(sp.bearingDeg * det.PI / 180); uz = det.sin(sp.bearingDeg * det.PI / 180);
    } else {
      const dx = riseX - basin.x, dz = riseZ - basin.z;
      const dl = Math.sqrt(dx * dx + dz * dz) || 1;
      ux = dx / dl; uz = dz / dl;
    }
    const head = { sx: basin.x + ux * sp.fromBasinM, sz: basin.z + uz * sp.fromBasinM };
    springHeads.push({ x: head.sx, z: head.sz, spec: sp });
    if (!sp.channel) return;
    const channel = {
      ...head,
      ex: basin.x + ux * basin.B.innerRadius, ez: basin.z + uz * basin.B.innerRadius,
      halfWidth: sp.channel.widthM * 0.5, depth: sp.channel.depthM,
      meander: sp.channel.meanderM ?? 0, bends: sp.channel.bends ?? 1,
      thalwegHalf: (sp.channel.thalwegWidthM ?? 0.8) * 0.5, thalwegDepth: sp.channel.thalwegDepthM ?? 0,
      gravel: sp.channel.bedGravel ?? 0.85, headTaper: sp.channel.headTaper ?? 0.08,
    };
    channels.push(channel);
    // Uphill is from the pond toward the spring, the way the channel climbs.
    if (sp.outcrop) outcrops.push(makeOutcrop(seed, sp.outcrop, channel.sx, channel.sz, ux, uz, LAYER_STEP * j));
  });
  const c = {
    land,
    warpX: makeFbm(seed, L_WARP_X, land.warp),
    warpZ: makeFbm(seed, L_WARP_Z, land.warp),
    coast: makeFbm(seed, L_COAST, land.coast),
    detail: makeFbm(seed, L_DETAIL, land.detail),
    sand: makeFbm(seed, L_SAND, { scale: m.sandJitterScale, octaves: 2 }),
    soil: makeFbm(seed, L_SOIL, { scale: m.soilScale, octaves: 3 }),
    rock: makeFbm(seed, L_ROCK, { scale: m.rockScale, octaves: 2 }),
    riseX, riseZ, basins, channels, outcrops, springHeads,
    shore: makeShore(land, seed),
    // The pad levelled into the base (new islands only; an older island's is stamped on load).
    pad: /** @type {any} */ (land).camp && /** @type {any} */ (land).camp.inBase !== false ? campPad(/** @type {any} */ (land).camp) : null,
    // Hermite end slopes, in units of the ramp parameter, so both sides meet the
    // waterline with the same gentle beach slope (no crease at the shore).
    landM0: land.beachSlope * land.inlandWidth,
    seaM0: -land.beachSlope * land.seaFallWidth,
  };
  // Each pool's water level: the meadow (before any channel or outcrop is cut) where the notch
  // crosses the rim, plus lipRise. The pool is leveled to it, so it holds water even on a slope.
  const bare = { ...c, channels: [], outcrops: [] };
  for (const outcrop of outcrops) {
    const [x, z] = unwarp(c, outcrop.x + outcrop.dnx * outcrop.poolR, outcrop.z + outcrop.dnz * outcrop.poolR);
    const out = new Float64Array(5);
    sampleCell(bare, x, z, out);
    outcrop.level = out[0] + outcrop.lipRise;
  }
  return c;
}
/** @typedef {ReturnType<typeof makeContext>} Ctx */

/**
 * The world point the domain warp carries onto (px, pz) in the warped frame: p + warp(p) = s,
 * solved by fixed-point iteration (the warp moves slowly, so each step shrinks the error about
 * fivefold).
 * @param {{ land: LandRecipe, warpX: Fbm, warpZ: Fbm }} c @param {number} px @param {number} pz
 * @returns {[number, number]}
 */
function unwarp(c, px, pz) {
  const W = c.land.warp.strength;
  let x = px, z = pz;
  for (let k = 0; k < 16; k++) {
    const wx = W * fbm(c.warpX, x, z), wz = W * fbm(c.warpZ, x, z);
    x = px - wx; z = pz - wz;
  }
  return [x, z];
}

/**
 * The spring's rock outcrop (docs/07): a horseshoe of stones around a small pool, open downhill
 * where the pool spills into the channel. Everything comes from the seed, so one seed always
 * gives the same stones. Laid out in the warped frame, like the channel, so the pool sits
 * exactly at the head of the bed.
 * @param {number} seed @param {any} o  the land recipe's spring.outcrop
 * @param {number} cx @param {number} cz  pool center (warped frame) @param {number} ux @param {number} uz  uphill
 * @param {number} [layer] added to its layer ids (0 for the first spring)
 */
function makeOutcrop(seed, o, cx, cz, ux, uz, layer = 0) {
  const s = hash32(seed, L_OUTCROP + layer, 0);
  /** Uniform in [0, 1). @param {number} a @param {number} b */
  const u = (a, b) => (hash32(s, a, b) >>> 8) / 16777216;
  /** @param {number[]} r @param {number} t */
  const lerp = (r, t) => r[0] + (r[1] - r[0]) * t;
  const DEG = det.PI / 180;
  const n = o.stones[0] + Math.floor(u(0, 0) * (o.stones[1] - o.stones[0] + 1));
  const arc = o.arcDeg * DEG;
  const turn = (2 * u(0, 1) - 1) * o.turnDeg * DEG;
  const stones = [];
  let reach = o.poolRadiusM;
  for (let i = 0; i < n; i++) {
    // Spread over the arc centered on uphill, so the open side faces down the channel.
    const a = turn - arc / 2 + arc * (i + 0.5 + (u(i + 1, 0) - 0.5) * o.angleJitter) / n;
    const ca = det.cos(a), sa = det.sin(a);
    const dx = ux * ca - uz * sa, dz = ux * sa + uz * ca;
    const ring = o.ringM + (2 * u(i + 1, 1) - 1) * o.ringJitterM;
    const r = lerp(o.radiusM, u(i + 1, 2));
    const aspect = 1 + o.elongate * u(i + 1, 4);
    const phi = u(i + 1, 5) * det.PI;
    stones.push({
      x: cx + dx * ring, z: cz + dz * ring, h: lerp(o.heightM, u(i + 1, 3)),
      ra: r * Math.sqrt(aspect), rb: r / Math.sqrt(aspect), cp: det.cos(phi), sp: det.sin(phi),
    });
    reach = Math.max(reach, ring + r * Math.sqrt(aspect) * (1 + o.lump));
  }
  return {
    x: cx, z: cz, dnx: -ux, dnz: -uz, stones, sink: o.sinkM, lump: o.lump,
    lumps: makeFbm(seed, L_STONE_LUMP + layer, { scale: o.lumpScale, octaves: 2 }),
    poolR: o.poolRadiusM, poolDepth: o.poolDepthM, gravel: o.poolGravel, lipRise: o.lipRiseM,
    rimAbove: o.rimAboveM, rimW: o.rimWidthM, notchHalf: o.notchWidthM * 0.5, apron: o.apronSlope,
    spillHalf: o.spillwayWidthM * 0.5, spillSlope: o.spillSlope,
    // Far enough out that the apron has sunk below the meadow before the stamp ends.
    reach: Math.max(reach + 0.5, o.poolRadiusM + o.rimWidthM + 1.8),
    level: 0, // the pool's water level (m), set once the context exists (makeContext)
  };
}

/**
 * The keeper's camp pad (docs/future/13 section 3.1) from the land recipe's `camp` block: center,
 * level, radius and blend, and the outward unit direction it faces (from the island's center unless
 * `facingDeg` is given; 0 deg is +x, 90 deg is +z).
 * @param {any} camp
 */
export function campPad(camp) {
  /** @type {number} */ let fx, /** @type {number} */ fz;
  if (typeof camp.facingDeg === 'number') {
    fx = det.cos(camp.facingDeg * det.PI / 180); fz = det.sin(camp.facingDeg * det.PI / 180);
  } else {
    const l = Math.sqrt(camp.x * camp.x + camp.z * camp.z) || 1;
    fx = camp.x / l; fz = camp.z / l;
  }
  return { x: camp.x, z: camp.z, r: camp.radiusM, h: camp.heightM, blend: camp.blendM, fx, fz, fall: camp.fallM ?? 0 };
}

/**
 * The pad's level at (x, z): heightM at its center, falling fallM toward the sea by its seaward
 * edge (and rising as much on its landward edge), held at the edge's level beyond it, so it sheds
 * rain toward the beach (F1).
 * @param {{ x: number, z: number, r: number, h: number, fx: number, fz: number, fall: number }} pad
 * @param {number} x @param {number} z
 */
export function padLevel(pad, x, z) {
  const u = ((x - pad.x) * pad.fx + (z - pad.z) * pad.fz) / pad.r;
  return pad.h - pad.fall * (u < -1 ? -1 : u > 1 ? 1 : u);
}

/**
 * The island's center in the world (m). A land recipe's own positions (rise, basins, camp) are
 * measured from it; the 4 x 4 open land of the larger island is centered on (-16, -16), since
 * chunks sit on multiples of 32 m (docs/future/13 section 3.11).
 * @param {any} land
 * @returns {{ x: number, z: number }}
 */
export function islandCenter(land) {
  return { x: land.center?.x ?? 0, z: land.center?.z ?? 0 };
}

/**
 * The keeper's camp pad in world meters, from the land recipe (the pad itself is in the island's
 * base only when `camp.inBase` is not false). Null when the land has no camp block. An older
 * island's live pad is in the store's `camp.pad` once it has been stamped (src/world/camp).
 * @param {any} land
 * @returns {{ x: number, z: number, r: number, h: number, blend: number, fx: number, fz: number, inBase: boolean } | null}
 */
export function campOf(land) {
  if (!land?.camp) return null;
  const p = campPad(land.camp), o = islandCenter(land);
  return { ...p, x: p.x + o.x, z: p.z + o.z, inBase: land.camp.inBase !== false };
}

/**
 * The coast's larger shapes (docs/future/13 section 3.11), all from the seed: low-frequency lobes
 * (coves and headlands), a short spit and one rocky point, each a tongue along a seeded bearing.
 * The lobes fade to nothing on the camp's side (`calmDeg` either side of its facing), so the camp
 * always looks down a plain sand beach to the boat. Null when the land recipe has no `shape`.
 * @param {LandRecipe} land @param {number} seed
 */
function makeShore(land, seed) {
  /** @type {any} */ const S = /** @type {any} */ (land).shape;
  if (!S) return null;
  const DEG = det.PI / 180;
  const pad = /** @type {any} */ (land).camp ? campPad(/** @type {any} */ (land).camp) : { fx: 1, fz: 0 };
  const campDeg = det.atan2(pad.fz, pad.fx) / DEG;
  /** Uniform in [0, 1). @param {number} k */
  const u = (k) => (hash32(seed, L_POINTS, k) >>> 8) / 16777216;
  // The spit and the rocky point sit on the far side from the camp, apart from each other.
  const spitDeg = campDeg + S.spit.fromCampDeg[0] + u(0) * (S.spit.fromCampDeg[1] - S.spit.fromCampDeg[0]);
  const side = u(1) < 0.5 ? 1 : -1;
  const rockDeg = spitDeg + side * (S.rocky.fromSpitDeg[0] + u(2) * (S.rocky.fromSpitDeg[1] - S.rocky.fromSpitDeg[0]));
  /** @param {number} deg @param {any} t */
  const tongue = (deg, t) => ({ dx: det.cos(deg * DEG), dz: det.sin(deg * DEG), len: t.lengthM, half: t.widthM * 0.5 });
  return {
    lobes: makeFbm(seed, L_LOBES, S.lobes), amount: S.lobes.amount,
    campX: pad.fx, campZ: pad.fz, calmIn: det.cos(S.calmDeg * 0.5 * DEG), calmOut: det.cos(S.calmDeg * DEG),
    spit: tongue(spitDeg, S.spit), rocky: tongue(rockDeg, S.rocky), rockyPaint: S.rocky.paint,
  };
}

/**
 * How far one tongue (a spit or a point) pushes the coast out at (x, z), in meters, and its weight
 * (0..1) across its width. A pointed tongue: full length on its center line, nothing past `half`.
 * @param {{ dx: number, dz: number, len: number, half: number }} t @param {number} x @param {number} z
 */
function tongueAt(t, x, z) {
  const along = x * t.dx + z * t.dz;
  if (along <= 0) return 0;
  return bump(Math.abs(z * t.dx - x * t.dz) / t.half);
}

/**
 * The island's springs (docs/07): each `fromBasinM` from its basin's center, uphill toward the rise
 * (or along its bearing), so its channel runs down into the pond hollow. The channel and the
 * outcrop are laid out in the warped frame, so each spring sits at the world point the warp
 * carries onto their head.
 * @param {Ctx} c
 */
function springsOf(c) {
  return c.springHeads.map((h) => {
    const [x, z] = unwarp(c, h.sx ?? h.x, h.sz ?? h.z);
    return { x, z, spec: h.spec };
  });
}

/**
 * Seeded centers of the land's rise, basins (ponds and marshes) and springs, for systems that place
 * things on the landform (the water simulation, docs/07). `basin` and `spring` are the first of each.
 * @param {LandRecipe} land @param {number} seed the terrain sub-seed
 */
export function landmarks(land, seed) {
  const c = makeContext(land, seed >>> 0);
  const o = islandCenter(land);
  const springs = springsOf(c).map((s) => ({ x: s.x + o.x, z: s.z + o.z, rateLps: s.spec.rateLps }));
  const basins = c.basins.map((b) => ({ x: b.x + o.x, z: b.z + o.z }));
  return {
    rise: { x: c.riseX + o.x, z: c.riseZ + o.z }, basin: basins[0] ?? null, basins,
    spring: springs[0] ?? null, springs,
  };
}

/**
 * Base height and material weights at (x, z), measured from the island's center (islandCenter).
 * Writes [h, grass, sand, rock, soil] to out.
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
  let d = r + L.coast.amount * fbm(c.coast, px, pz);
  // The coast's larger shapes (section 3.11): lobes calm on the camp's side, a spit, a rocky point.
  let rockyW = 0;
  const sh = c.shore;
  if (sh && r > 0) {
    const toCamp = (x * sh.campX + z * sh.campZ) / r;
    d -= sh.amount * fbm(sh.lobes, px, pz) * (1 - smoothstep(sh.calmOut, sh.calmIn, toCamp));
    d -= sh.spit.len * tongueAt(sh.spit, x, z);
    rockyW = tongueAt(sh.rocky, x, z);
    d -= sh.rocky.len * rockyW;
  }
  const s = L.radius - d;
  // The rocky point is rock only near its own shore, not along its whole bearing inland.
  rockyW *= 1 - smoothstep(2, 5, s);
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

  // Basins (ponds and marshes): blend toward a floor above sea level, bank shape smoothstep. A
  // marsh's floor is shallow and lumpy, so tussocks stand out of its water.
  let basinW = 0;
  let basinSoil = 0; // the basins' soil on their floors (a marsh's own `soil`, else the land's basinSoil)
  for (const bs of c.basins) {
    const bx = x - bs.x, bz = z - bs.z;
    const B = bs.B;
    const bd = Math.sqrt(bx * bx + bz * bz);
    if (bd < B.outerRadius + 2 * B.rimWobble) { // 2x: fbm can slightly exceed [-1, 1]
      const wob = bd + B.rimWobble * fbm(bs.wobble, x, z);
      const w = 1 - smoothstep(B.innerRadius, B.outerRadius, wob);
      if (w > 0) {
        const floorH = B.floor + B.floorNoise * fbm(bs.floor, x, z);
        if (h > floorH) h += (floorH - h) * w;
      }
      if (w > basinW) basinW = w;
      const sw = w * (B.soil ?? M.basinSoil);
      if (sw > basinSoil) basinSoil = sw;
    }
  }

  // Each spring's channel: a soft trough along the warped line from the spring to its pond, so
  // the stream has a bed to run in and meanders a little with the domain warp.
  let bedSoil = 0;
  for (const ch of c.channels) {
    if (landMask <= 0) break;
    let chanW = 0;
    let bedW = 0;
    const vx = ch.ex - ch.sx, vz = ch.ez - ch.sz;
    const len2 = vx * vx + vz * vz;
    const t = Math.min(1, Math.max(0, ((px - ch.sx) * vx + (pz - ch.sz) * vz) / len2));
    // Meander: a sideways swing along the run, tapering to nothing at the spring and the pond.
    // det.sin, not Math.sin: the landform must be bit-identical in every browser (CLAUDE.md).
    const swing = ch.meander * det.sin(2 * det.PI * ch.bends * t) * 4 * t * (1 - t);
    const inv = 1 / Math.sqrt(len2);
    const qx = px - (ch.sx + vx * t - vz * inv * swing), qz = pz - (ch.sz + vz * t + vx * inv * swing);
    // A wide, gentle grassy swale with a narrow rounded bed (the thalweg) along its middle, where
    // the flow gathers into a stream. Both stay well under the steep-rock angle.
    const q = Math.sqrt(qx * qx + qz * qz);
    // headTaper 0: the bed starts at full depth (under the outcrop's pool), with a rounded end.
    const head = ch.headTaper > 0 ? smoothstep(0, ch.headTaper, t) : 1;
    chanW = bump(q / ch.halfWidth) * head;
    bedW = bump(q / ch.thalwegHalf) * head;
    h -= landMask * (ch.depth * chanW + ch.thalwegDepth * bedW);
    // The bed itself, a little wider than the thread: washed gravel and stones.
    bedW = bump(q / (ch.thalwegHalf * 1.3)) * head * landMask;
    // Running water washes the bed down to gravel and pebbles: the soil scan is a gravelly one,
    // so the bed is soil, fading out into the grass banks.
    bedSoil = Math.max(bedSoil, smoothstep(0.05, 0.5, bedW) * ch.gravel);
  }

  // Each spring's outcrop: a small pool leveled into the head of the bed, ringed by a low rim
  // with a notch on the downhill side, so the water wells up, stands, and leaves only through
  // the notch down a short spillway into the channel; a horseshoe of stones stands around it.
  let poolSoil = 0;
  let stoneRock = 0;
  for (const oc of c.outcrops) {
    if (landMask <= 0) break;
    let poolW = 0;
    let stoneLift = 0;
    const ox = px - oc.x, oz = pz - oc.z;
    if (ox * ox + oz * oz < oc.reach * oc.reach) {
      const d = Math.sqrt(ox * ox + oz * oz);
      const along = ox * oc.dnx + oz * oc.dnz, across = oz * oc.dnx - ox * oc.dnz;
      // The rim stands rimAbove over the water, down to the water level in the notch.
      const notch = along > 0 ? bump(Math.abs(across) / oc.notchHalf) : 0;
      const rimH = oc.level + oc.rimAbove * (1 - notch);
      // A bowl from the floor up to the rim, carried on outward so the banks above it are cut
      // back smoothly. Low ground around it is lifted to the rim, which falls away outside as a
      // short apron, except down the bed's line: there the sill drops into the bed, so the
      // spill stays in the channel instead of fanning out over a raised apron.
      const floorH = oc.level - oc.poolDepth;
      const t = d / oc.poolR;
      const bowl = floorH + (rimH - floorH) * t * t;
      let hh = t < 1 ? bowl : Math.min(h, bowl);
      if (t >= 1) {
        const past = d - oc.poolR - oc.rimW;
        const lift = past > 0 ? rimH - past * oc.apron : rimH;
        const w = past > 0 && along > 0 ? 1 - bump(Math.abs(across) / oc.spillHalf) : 1;
        if (lift > hh) hh += (lift - hh) * w;
        // Below the sill, a short ramp down the notch's line eases the spill into the bed.
        const ramp = oc.level - Math.max(0, past) * oc.spillSlope;
        if (notch > 0 && ramp > hh) hh += (ramp - hh) * notch;
      }
      h += (hh - h) * landMask;
      poolW = t < 1 ? (1 - t * t) * landMask : 0;
      const lump = 1 + oc.lump * fbm(oc.lumps, px, pz);
      for (const s of oc.stones) {
        const sx = px - s.x, sz = pz - s.z;
        const a = (sx * s.cp + sz * s.sp) / s.ra, b = (sz * s.cp - sx * s.sp) / s.rb;
        const t2 = (a * a + b * b) / (lump * lump);
        if (t2 >= 1) continue;
        // A rounded dome, set into the ground by `sink`; lumps roughen the outline and the top.
        const lift = s.h * lump * Math.sqrt(1 - t2) - oc.sink;
        if (lift > stoneLift) stoneLift = lift;
      }
      h += stoneLift * landMask;
    }
    poolSoil = Math.max(poolSoil, smoothstep(0.05, 0.4, poolW) * oc.gravel);
    stoneRock = Math.max(stoneRock, smoothstep(0, 0.03, stoneLift));
  }

  // The camp pad (docs/future/13 section 3.1): level at its height inside the radius, easing back to
  // the natural ground across the blend.
  let padW = 0;
  const pad = c.pad;
  if (pad) {
    const qx = x - pad.x, qz = z - pad.z, q2 = qx * qx + qz * qz, out2 = pad.r + pad.blend;
    if (q2 < out2 * out2) {
      padW = 1 - smoothstep(pad.r, out2, Math.sqrt(q2));
      h += (padLevel(pad, x, z) - h) * padW;
    }
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
    soil = Math.max(soil, basinSoil);
    if (c.channels.length) soil = Math.max(soil, bedSoil);
    if (c.outcrops.length) {
      soil = Math.max(soil, poolSoil);
      rock = Math.max(rock, stoneRock);
    }
  }
  // A floor under the grass (sandFloorM, the larger island): on the shore ramp, ground below it is
  // sand all along, not only where the sand noise says, so no grass lies where the tide and its
  // waves reach. Pond beds keep their own ground.
  if (M.sandFloorM !== undefined && s < L.inlandWidth) {
    const floor = (1 - smoothstep(M.sandFloorM - (M.sandFloorSoftM ?? 0.15), M.sandFloorM, h)) * (1 - basinW);
    if (floor > sand) sand = floor;
  }
  // The rocky point is bare rock out to the water; the pad is grass and soil only.
  if (sh && rockyW > 0) rock = Math.max(rock, sh.rockyPaint * smoothstep(0.25, 0.6, rockyW));
  if (padW > 0) { sand *= 1 - padW; rock *= 1 - padW; }
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
  // Cells are sampled from the island's center (0 unless the land recipe moves it).
  const o = islandCenter(land);
  const x0 = CHUNK_SIZE * cx - CHUNK_SIZE / 2 - o.x;
  const z0 = CHUNK_SIZE * cz - CHUNK_SIZE / 2 - o.z;
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

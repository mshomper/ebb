// @ts-check
// Ground spots for gathering (docs/future/13 4.2, 4.4, 4.5). Every non-plant gatherable lies in a
// spot: the foot of a host plant (sticks), a 2 m bin of qualifying ground (pebbles, flat stones),
// or a 2 m stretch of a fresh strandline (drift twigs). What a spot holds this period is worked
// out from the world seed, the spot, the period and that period's season and weather, so nothing
// is saved until something is taken (events.js). Pure: the live module fills a context from the
// world (GatherCtx below) and asks.

import { hash32, subSeed, det } from '../../core/rng.js';
import { WATER_CLASS } from '../water/summary.js';
import { WATER_CELL, WATER_CELLS, WATER_ORIGIN } from '../water/grid.js';
import { STAGE } from '../growth/coarse.js';
import { PERIOD, periodOf } from './events.js';

// New kinds go at the end: a kind's place here salts its rolls (as finds' KINDS), so sticks and
// lichen twigs at the same shrub roll apart. Later kinds: kelp, wrack, sand, leaves, lichen-twigs,
// acorns, hazelnuts, old-comb, charcoal, ash, cakes.
export const KINDS = Object.freeze(['sticks', 'drift-twigs', 'pebbles', 'flat-stones']);

/** A bin's side (m), gather.json spotM. Keys are bin indices, so this stays 2. */
export const BIN_M = 2;
/** Water cells along a bin's side (4). */
const BIN_CELLS = Math.round(BIN_M / WATER_CELL);
/** Bins along the grid's side (96). */
export const BINS = WATER_CELLS / BIN_CELLS;
/** Painted grounds, as shore.js groundOfCell. */
const GROUND = Object.freeze({ grass: 0, sand: 1, rock: 2, soil: 3 });

/** @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;

/** The seed every gather roll starts from. @param {number} worldSeed */
export const gatherSeed = (worldSeed) => subSeed(worldSeed, 'gather');

/**
 * @typedef {import('../weather.js').DayRecord} DayRecord
 * @typedef {{ tideId: number, level: number, spring: number, season: number, day: DayRecord | null }} StrandLine
 *   one lying strandline, newest first in ctx.lines: tideId (which high water, as finds' strandline
 *   shells), level (m, strandLines levels), spring (-1 neap .. 1), season (strand.js seasonOfTide),
 *   day (strand.js weatherOfTide)
 * @typedef {{ id: number, sp: string, x: number, z: number, stage: number }} HostPlant
 */

/**
 * What the live module fills from the world. Only seed, day and season are needed; a source whose
 * fields are missing simply has no spots.
 * @typedef {Object} GatherCtx
 * @property {number} seed       gatherSeed(world seed)
 * @property {number} day        game day now
 * @property {number} season     season index now, 0 spring .. 3 winter
 * @property {DayRecord | null} [today]      state.weather.today
 * @property {DayRecord | null} [yesterday]  state.weather.yesterday
 * @property {HostPlant[]} [plants]          world.state.growth.plants (all, or those near)
 * @property {(sp: string) => number} [crownOf]  a host's crown radius (m; flora shape.crownRadius), else 0.8
 * @property {{ rect: {x:number,y:number,w:number,h:number}, cls: Uint8Array, band: Uint8Array, shore: Uint8Array, targetMm?: Uint16Array }} [summary]
 *   the water summary (water.getSummary())
 * @property {(k: number) => number} [groundOf]  painted ground of summary cell k: 0 grass, 1 sand, 2 rock, 3 soil
 *   (shore.js groundOfCell over the terrain mirror's material)
 * @property {(k: number) => number} [slopeOf]   ground slope at summary cell k, degrees
 * @property {(k: number) => number} [heightOf]  ground height at summary cell k, m about mean sea level
 * @property {StrandLine[]} [lines]  the lines lying now, newest first
 * @property {number} [runupM]       shore.json look.strandline.runupM
 * @property {number[]} [center]     the island's centre [x, z], for onshore wind
 */

/**
 * A spot: kind and source; key, the uint32 the picked events keep; sourceKey, the plant id or bin
 * index; period (events.js); where to draw it and walk to; cell, the summary cell it sits on (-1
 * for a plant's foot); reach, how far from (x, z) a tap still lands on it.
 * @typedef {{ kind: string, source: string, key: number, sourceKey: number, period: number, x: number, z: number, cell: number, reach: number }} Spot
 */

// ---- bins -----------------------------------------------------------------------------------

/** @param {number} bi @param {number} bj */
export const binKey = (bi, bj) => bj * BINS + bi;

/** The bin holding a world point, or -1 off the grid. @param {number} x @param {number} z */
export function binOf(x, z) {
  const bi = Math.floor((x - WATER_ORIGIN) / BIN_M), bj = Math.floor((z - WATER_ORIGIN) / BIN_M);
  return bi < 0 || bj < 0 || bi >= BINS || bj >= BINS ? -1 : binKey(bi, bj);
}

/** A bin's middle, [x, z]. @param {number} key */
export function binCenter(key) {
  const bi = key % BINS, bj = Math.floor(key / BINS);
  return [WATER_ORIGIN + (bi + 0.5) * BIN_M, WATER_ORIGIN + (bj + 0.5) * BIN_M];
}

/** A bin's cells as [di, dj], nearest its middle first (ties in a fixed order). */
const BIN_ORDER = (() => {
  /** @type {number[][]} */ const o = [];
  for (let dj = 0; dj < BIN_CELLS; dj++) for (let di = 0; di < BIN_CELLS; di++) o.push([di, dj]);
  const c = (BIN_CELLS - 1) / 2;
  const d = (/** @type {number[]} */ a) => (a[0] - c) * (a[0] - c) + (a[1] - c) * (a[1] - c);
  return o.sort((a, b) => d(a) - d(b) || a[1] - b[1] || a[0] - b[0]);
})();

/**
 * Where each kind lies (gather.json kinds.<kind>.where), as tests on a summary cell.
 * @type {Record<string, (k: number, ctx: GatherCtx, recipe: any) => boolean>}
 */
export const WHERE = {
  // Sand or shingle in or above the tide band.
  shoreShingle: (k, ctx) => !!ctx.summary && ctx.summary.shore[k] > 0 && ctx.groundOf?.(k) === GROUND.sand,
  // Running or slow fresh water no deeper than the ankle.
  streamBed: (k, ctx, recipe) => {
    const s = ctx.summary;
    if (!s || s.band[k] || (s.cls[k] !== WATER_CLASS.running && s.cls[k] !== WATER_CLASS.slow)) return false;
    return (s.targetMm?.[k] ?? 0) <= (recipe.bins?.ankleM ?? 0.12) * 1000;
  },
  // Rock in the tide band.
  bandRock: (k, ctx) => !!ctx.summary && ctx.summary.band[k] === 1 && ctx.groundOf?.(k) === GROUND.rock,
  // Shore sand steep enough to be shingle (docs/future/10, computed shingle).
  steepShingle: (k, ctx, recipe) => WHERE.shoreShingle(k, ctx, recipe) && !!ctx.slopeOf && ctx.slopeOf(k) >= (recipe.bins?.steepDeg ?? 20),
};

/**
 * Does summary cell k lie on a strandline (its level plus the waves' run-up, within toleranceM)?
 * Never on rock or steep ground, where the line is never drawn.
 * @param {number} k @param {StrandLine} line @param {GatherCtx} ctx @param {any} recipe
 */
function onLine(k, line, ctx, recipe) {
  if (!ctx.heightOf || ctx.groundOf?.(k) === GROUND.rock) return false;
  // Only the sea's shore: never a pond's or a stream's edge, whatever its height.
  const s = ctx.summary;
  if (s && (!s.shore[k] || (s.cls[k] !== WATER_CLASS.dry && s.cls[k] !== WATER_CLASS.sea))) return false;
  if (ctx.slopeOf && ctx.slopeOf(k) >= (recipe.bins?.steepDeg ?? 20)) return false;
  return Math.abs(ctx.heightOf(k) - line.level - (ctx.runupM ?? 0.05)) <= (recipe.strand?.toleranceM ?? 0.06);
}

/**
 * The bin and strand spots of one bin: for each kind, the qualifying cell nearest the bin's middle.
 * @param {number} key bin index @param {GatherCtx} ctx @param {any} recipe @returns {Spot[]}
 */
export function binSpots(key, ctx, recipe) {
  const s = ctx.summary;
  if (!s || key < 0) return [];
  const bi = key % BINS, bj = Math.floor(key / BINS);
  /** @type {Spot[]} */ const out = [];
  /** @param {string} kind @param {string} source @param {number} k @param {number} period */
  const put = (kind, source, k, period) => {
    const i = k % s.rect.w, j = Math.floor(k / s.rect.w);
    out.push({ kind, source, key: spotKey(ctx.seed, kind, key), sourceKey: key, period,
      x: WATER_ORIGIN + (s.rect.x + i + 0.5) * WATER_CELL, z: WATER_ORIGIN + (s.rect.y + j + 0.5) * WATER_CELL, cell: k, reach: BIN_M / 2 });
  };
  /** The first cell (nearest the middle) passing a test, or -1. @param {(k: number) => boolean} ok */
  const first = (ok) => {
    for (const [di, dj] of BIN_ORDER) {
      const i = bi * BIN_CELLS + di - s.rect.x, j = bj * BIN_CELLS + dj - s.rect.y;
      if (i < 0 || j < 0 || i >= s.rect.w || j >= s.rect.h) continue;
      const k = j * s.rect.w + i;
      if (ok(k)) return k;
    }
    return -1;
  };
  for (const kind of KINDS) {
    const K = recipe.kinds?.[kind];
    if (K?.source === 'bin') {
      const tests = (K.where ?? []).map((/** @type {string} */ w) => WHERE[w]).filter(Boolean);
      const k = first((c) => tests.some((/** @type {any} */ t) => t(c, ctx, recipe)));
      if (k >= 0) put(kind, 'bin', k, periodOf(PERIOD.day, ctx.day));
    } else if (K?.source === 'strand') {
      const lines = (ctx.lines ?? []).slice(0, K.lines ?? Infinity);
      for (const line of lines) {
        const k = first((c) => onLine(c, line, ctx, recipe));
        if (k >= 0) put(kind, 'strand', k, periodOf(PERIOD.tide, line.tideId));
      }
    }
  }
  return out;
}

// ---- spots ----------------------------------------------------------------------------------

/**
 * The key a spot's picked events are kept under: the seed, the kind's salt and the spot's own key.
 * @param {number} seed @param {string} kind @param {number} sourceKey
 */
export const spotKey = (seed, kind, sourceKey) => hash32(seed, KINDS.indexOf(kind) + 1, sourceKey);

/**
 * The foot spots near a point: under each host plant of each foot kind.
 * @param {number} x @param {number} z @param {number} r @param {GatherCtx} ctx @param {any} recipe @returns {Spot[]}
 */
function footSpots(x, z, r, ctx, recipe) {
  /** @type {Spot[]} */ const out = [];
  for (const kind of KINDS) {
    const K = recipe.kinds?.[kind];
    if (K?.source !== 'foot') continue;
    const least = STAGE[/** @type {keyof typeof STAGE} */ (K.hostMin ?? 'young')] ?? STAGE.young;
    for (const p of ctx.plants ?? []) {
      if (!K.hosts?.includes(p.sp) || p.stage < least) continue;
      const crown = ctx.crownOf?.(p.sp) ?? 0.8;
      const dx = p.x - x, dz = p.z - z;
      if (dx * dx + dz * dz > (r + crown) * (r + crown)) continue;
      out.push({ kind, source: 'foot', key: spotKey(ctx.seed, kind, p.id), sourceKey: p.id, period: periodOf(PERIOD.day, ctx.day), x: p.x, z: p.z, cell: -1, reach: crown });
    }
  }
  return out;
}

/**
 * Every spot within r of a point (a plant's foot counts from its crown's edge), in a fixed order:
 * feet first, then bins and stretches by bin, each by kind.
 * @param {number} x @param {number} z @param {number} r @param {GatherCtx} ctx @param {any} recipe @returns {Spot[]}
 */
export function spotsNear(x, z, r, ctx, recipe) {
  const out = footSpots(x, z, r, ctx, recipe);
  const lo = (/** @type {number} */ v) => Math.max(0, Math.floor((v - r - WATER_ORIGIN) / BIN_M));
  const hi = (/** @type {number} */ v) => Math.min(BINS - 1, Math.floor((v + r - WATER_ORIGIN) / BIN_M));
  for (let bj = lo(z); bj <= hi(z); bj++) {
    for (let bi = lo(x); bi <= hi(x); bi++) {
      for (const s of binSpots(binKey(bi, bj), ctx, recipe)) {
        if ((s.x - x) * (s.x - x) + (s.z - z) * (s.z - z) <= r * r) out.push(s);
      }
    }
  }
  return out;
}

/**
 * Every spot under a tap: the feet whose crown it lands in (nearest plant first), then the spots
 * of the bin it lands in (by kind, newest line first).
 * @param {number} x @param {number} z @param {GatherCtx} ctx @param {any} recipe @returns {Spot[]}
 */
export function spotsAt(x, z, ctx, recipe) {
  const d2 = (/** @type {Spot} */ s) => (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
  const feet = footSpots(x, z, 0, ctx, recipe).sort((a, b) => d2(a) - d2(b) || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
  // A bin's spot sits at its qualifying cell: a tap a little way off (on the grass behind the
  // beach) does not land on it.
  const near = (recipe.bins?.tapM ?? 1);
  return [...feet, ...binSpots(binOf(x, z), ctx, recipe).filter((s) => d2(s) <= near * near)];
}

/**
 * The best spot under a tap, or null: a plant's foot stands out, so it comes first.
 * @param {number} x @param {number} z @param {GatherCtx} ctx @param {any} recipe @returns {Spot | null}
 */
export function spotAt(x, z, ctx, recipe) {
  return spotsAt(x, z, ctx, recipe)[0] ?? null;
}

// ---- shares ---------------------------------------------------------------------------------

/**
 * Was today or yesterday windy (windStrength at least windyMin)?
 * @param {GatherCtx} ctx @param {any} W gather.json weather
 */
export function isWindy(ctx, W) {
  return (ctx.today?.windStrength ?? 0) >= W.windyMin || (ctx.yesterday?.windStrength ?? 0) >= W.windyMin;
}

/**
 * Did a tide's day blow onshore at a stretch: windy, and toward the land there,
 * dot(windToward, outward) <= onshoreDot with windToward = (cos windDir, -sin windDir) and outward
 * from the island's centre to the stretch.
 * @param {DayRecord | null} day @param {number[]} at [x, z] @param {number[] | undefined} center @param {any} W
 */
export function isOnshore(day, at, center, W) {
  if (!day || day.windStrength < W.windyMin) return false;
  const ox = at[0] - (center?.[0] ?? 0), oz = at[1] - (center?.[1] ?? 0);
  const l = Math.sqrt(ox * ox + oz * oz);
  if (l === 0) return false;
  return (det.cos(day.windDir) * ox - det.sin(day.windDir) * oz) / l <= W.onshoreDot;
}

/**
 * What a spot holds this period, in handfuls (0: nothing): u = u01(hash32(seed, kindSalt, key,
 * period)); below empty[season] the spot is empty, otherwise it holds handfuls[season] plus the
 * modifiers (gather.json kinds, 4.4). Day spots read ctx.season, today and yesterday; a strand
 * spot reads its line's (the one in ctx.lines whose high water the period names), and is empty
 * when that line no longer lies.
 * @param {string} kind @param {number} sourceKey plant id or bin index @param {number} period events.js
 * @param {GatherCtx} ctx @param {any} recipe gather.json
 */
export function share(kind, sourceKey, period, ctx, recipe) {
  const K = recipe.kinds?.[kind];
  const salt = KINDS.indexOf(kind) + 1;
  if (!K || !salt) return 0;
  const W = recipe.weather;
  let season = ctx.season;
  /** @type {StrandLine | null} */ let line = null;
  if (K.source === 'strand') {
    line = (ctx.lines ?? []).find((l) => periodOf(PERIOD.tide, l.tideId) === period) ?? null;
    if (!line) return 0;
    season = line.season;
  }
  const base = K.handfuls?.[season] ?? 0;
  if (base <= 0) return 0;
  let more = 0, empty = K.empty?.[season] ?? 0;
  if (K.windy !== undefined && isWindy(ctx, W)) { more += K.windy; empty = K.emptyWindy ?? empty; }
  if (K.onshore !== undefined && line && isOnshore(line.day, binCenter(sourceKey), ctx.center, W)) { more += K.onshore; empty = K.emptyOnshore ?? empty; }
  if (u01(hash32(ctx.seed, salt, sourceKey, period)) < empty) return 0;
  return base + more;
}

/** share() for a spot from spotsNear or spotAt. @param {Spot} s @param {GatherCtx} ctx @param {any} recipe */
export const shareOf = (s, ctx, recipe) => share(s.kind, s.sourceKey, s.period, ctx, recipe);

/**
 * The card's word for what is left (gather.json words): 2 or more plenty, 1 a little, 0 picked over,
 * and 0 with nothing there to start, nothing; a strandline stretch has its own last two.
 * @param {number} left share - taken @param {number} shareN the period's share @param {string} source @param {any} words
 */
export function wordFor(left, shareN, source, words) {
  const strand = source === 'strand';
  if (shareN <= 0) return strand ? words.strandNothing : words.nothing;
  if (left >= 2) return words.plenty;
  if (left === 1) return words.little;
  return strand ? words.strandPicked : words.pickedOver;
}

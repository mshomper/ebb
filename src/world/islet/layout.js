// @ts-check
// The meadow islet's layout and shape (docs/13, 'How new land joins'; B3a): where it lies, its
// ground and paint as it will stand, its sandbar to the island's shore, and how far under that it
// is at any hour of its rise. Pure: the seed, the land and recipes/land/meadow-islet.json in, numbers
// out, so a tools page, a test and the game all see the same islet. Uses only hash32, det math and
// + - * /, Math.sqrt, Math.abs, Math.min/max, as the landform does.

import { hash32, det } from '../../core/rng.js';
import { makeFbm, fbm, islandCenter, shoreBearings } from '../terrain/landform.js';
import { CHUNK_SIZE, WORLD_ORIGIN, WORLD_CELLS, CELL } from '../terrain/grid.js';

const DEG = det.PI / 180;
/** The world window's far edge (m). */
const WORLD_END = WORLD_ORIGIN + WORLD_CELLS * CELL;
const L_SIDE = 1, L_COAST = 2, L_DETAIL = 3, L_SAND = 4, L_PATCH = 5, L_BAR = 6;

/**
 * @typedef {Object} Box @property {number} x0 @property {number} z0 @property {number} x1 @property {number} z1
 * @typedef {Object} IsletLayout
 * @property {number} x @property {number} z   the islet's middle (m)
 * @property {number} ux @property {number} uz outward, from the island's middle toward it
 * @property {number} tx @property {number} tz along its length (the coast)
 * @property {number} A @property {number} B   half its length and half its width (m)
 * @property {number} sideDeg                  its bearing from the island's middle
 * @property {{ from: [number, number], to: [number, number], halfWidthM: number, topM: number }} bar
 * @property {Box} box                         everything it and its bar touch, skirts and all (m, in the world)
 * @property {Box} islandBox                   the open land it lies outside of
 */

/** Smallest angle between two bearings (degrees). @param {number} a @param {number} b */
const apart = (a, b) => { const d = Math.abs((((a - b) % 360) + 540) % 360 - 180); return d; };
/** @param {number} t */
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
/** @param {number} a @param {number} b @param {number} x */
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** The open land's box from the land recipe (its chunk range; the older island's 3 x 3 without one). @param {any} land */
export function landBox(land) {
  const c0 = land.chunkMin ?? -1, c1 = land.chunkMax ?? 1;
  return { x0: CHUNK_SIZE * c0 - CHUNK_SIZE / 2, z0: CHUNK_SIZE * c0 - CHUNK_SIZE / 2, x1: CHUNK_SIZE * c1 + CHUNK_SIZE / 2, z1: CHUNK_SIZE * c1 + CHUNK_SIZE / 2 };
}

/**
 * Where the islet lies: the side of the open sea that fits it, farthest from the camp's facing and
 * the spit, turned a little by the seed; its bar runs from the island's shore straight out to it.
 * Null when no side fits (an island with no open sea around it).
 * @param {any} R recipes/land/meadow-islet.json @param {any} land the land recipe
 * @param {number} terrainSeed subSeed(world, 'terrain') @param {number} seed subSeed(world, 'islet')
 * @param {(x: number, z: number) => number} base the island's ground as generated (landform baseSampler)
 * @returns {IsletLayout | null}
 */
export function isletLayout(R, land, terrainSeed, seed, base) {
  const P = R.place, S = R.shape, Bar = R.bar;
  const c = islandCenter(land), isle = landBox(land);
  const A = S.lengthM / 2, B = S.widthM / 2, reachOut = S.coast.amount * 0.5 + S.seaFallM, m = P.edgeMarginM;
  const away = shoreBearings(land, terrainSeed);
  /** @type {{ deg: number, dist: number, score: number }[]} */ const fits = [];
  P.sidesDeg.forEach((/** @type {number} */ side, /** @type {number} */ i) => {
    const turn = P.jitterDeg * ((hash32(seed, L_SIDE, i) >>> 8) / 8388607.5 - 1);
    // distanceM out, or a little nearer where the world's edge is close (the older, smaller island).
    for (let dist = P.distanceM; dist >= P.distanceM - P.nearerM; dist -= 1) {
      const deg = [side + turn, side].find((d) => fitsAt(d, dist));
      if (deg === undefined) continue;
      const score = Math.min(away.campDeg === null ? 180 : apart(deg, away.campDeg), away.spitDeg === null ? 180 : apart(deg, away.spitDeg));
      fits.push({ deg, dist, score });
      break;
    }
  });
  /**
   * Its outline (before the coast's wobble) clears the open land, and its coast (the wobble's noise
   * stays within half its amount) and half its underwater skirt stay inside the world. @param {number} deg @param {number} dist
   */
  function fitsAt(deg, dist) {
    const ux = det.cos(deg * DEG), uz = det.sin(deg * DEG);
    const x = c.x + dist * ux, z = c.z + dist * uz;
    const hx = Math.abs(ux) * B + Math.abs(uz) * A, hz = Math.abs(uz) * B + Math.abs(ux) * A, w = S.coast.amount * 0.5 + S.seaFallM / 2;
    const clear = x - hx > isle.x1 + m || x + hx < isle.x0 - m || z - hz > isle.z1 + m || z + hz < isle.z0 - m;
    return clear && x - hx - w > WORLD_ORIGIN + m && x + hx + w < WORLD_END - m && z - hz - w > WORLD_ORIGIN + m && z + hz + w < WORLD_END - m;
  }
  if (!fits.length) return null;
  fits.sort((a, b) => b.score - a.score);
  const { deg, dist } = fits[0], ux = det.cos(deg * DEG), uz = det.sin(deg * DEG), tx = -uz, tz = ux;
  const x = c.x + dist * ux, z = c.z + dist * uz;
  // The bar: from where the island's own ground first reaches its top, walking in from the islet.
  let shore = 0;
  for (let r = dist - B; r > 0; r -= 0.5) {
    if (base(c.x + ux * r, c.z + uz * r) >= Bar.topM) { shore = Math.max(0, r - Bar.shoreInM); break; }
  }
  const out = dist - B + Bar.intoIsletM;
  /** @type {[number, number]} */ const from = [c.x + ux * shore, c.z + uz * shore];
  /** @type {[number, number]} */ const to = [c.x + ux * out, c.z + uz * out];
  const hx = Math.abs(ux) * B + Math.abs(uz) * A + reachOut, hz = Math.abs(uz) * B + Math.abs(ux) * A + reachOut;
  const bw = Bar.halfWidthM * (1 + Bar.flare) + Bar.wander.amount + Bar.shoulderM;
  const box = {
    x0: Math.max(WORLD_ORIGIN, Math.min(x - hx, from[0] - bw, to[0] - bw)), z0: Math.max(WORLD_ORIGIN, Math.min(z - hz, from[1] - bw, to[1] - bw)),
    x1: Math.min(WORLD_END, Math.max(x + hx, from[0] + bw, to[0] + bw)), z1: Math.min(WORLD_END, Math.max(z + hz, from[1] + bw, to[1] + bw)),
  };
  return { x, z, ux, uz, tx, tz, A, B, sideDeg: deg, bar: { from, to, halfWidthM: Bar.halfWidthM, topM: Bar.topM }, box, islandBox: isle };
}

/**
 * The islet and bar as they will stand: ground height and paint shares at a world point, or null
 * where they do not reach (the seabed stays as it is). The shares are of the four ground layers
 * (grass, sand, rock, soil), from the height the ground stands at, so a cell under water paints as
 * sand and turns to meadow as it clears the water (paintAt).
 * @param {IsletLayout} L @param {any} R @param {number} seed subSeed(world, 'islet') @param {number} seabedM the land's seabedDepth
 */
export function makeShape(L, R, seed, seabedM) {
  const S = R.shape, Bar = R.bar, M = R.materials;
  const coast = makeFbm(seed, L_COAST, S.coast), detail = makeFbm(seed, L_DETAIL, S.detail);
  const sandN = makeFbm(seed, L_SAND, M.sand), patchN = makeFbm(seed, L_PATCH, M.machair.patches);
  const wander = makeFbm(seed, L_BAR, Bar.wander);
  const n = S.roundness, [ax, az] = L.bar.from, [bx, bz] = L.bar.to;
  const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1, len = Math.sqrt(l2);
  const barReach = Bar.halfWidthM * (1 + Bar.flare) + Bar.wander.amount + Bar.shoulderM;
  /** How far in from the islet's coast a point lies (m; negative out at sea), along the ray from its middle. @param {number} x @param {number} z */
  const inwardAt = (x, z) => {
    const px = x - L.x, pz = z - L.z;
    const a = Math.abs(px * L.tx + pz * L.tz) / L.A, b = Math.abs(px * L.ux + pz * L.uz) / L.B;
    const q = det.pow(det.pow(a, n) + det.pow(b, n), 1 / n);
    return { q, inward: (q > 1e-6 ? Math.sqrt(px * px + pz * pz) * (1 / q - 1) : 1e3) + S.coast.amount * fbm(coast, x, z) };
  };
  return {
    /**
     * Final ground height there (m), or -Infinity where neither the islet nor the bar reaches.
     * @param {number} x @param {number} z
     */
    heightAt(x, z) {
      let h = -Infinity;
      // The islet: distance in from its coast along the ray from its middle.
      const { q, inward } = inwardAt(x, z);
      if (inward > -S.seaFallM) {
        if (inward >= 0) {
          const t = clamp01(inward / S.inlandM);
          const dome = S.domeM * smooth(0, 1, 1 - q);
          h = S.topM * t * (2 - t) + dome + S.detail.amplitude * fbm(detail, x, z) * t;
        } else {
          h = seabedM * smooth(0, 1, -inward / S.seaFallM);
        }
      }
      // The bar: level along its line, a little crown in its middle, its sides falling away. Its
      // line wanders (wander, fading to nothing at its ends) and it fans out where it meets each shore.
      const along = ((x - ax) * vx + (z - az) * vz) / l2, t = clamp01(along);
      const past = (along - t) * len, side = ((x - ax) * vz - (z - az) * vx) / len;
      if (Math.abs(side) < barReach && Math.abs(past) < barReach) {
        const ends = smooth(0, 0.2, t) * smooth(1, 0.8, t);
        const off = Math.hypot(side - Bar.wander.amount * ends * fbm(wander, t * len, 0), past);
        const half = Bar.halfWidthM * (1 + Bar.flare * (1 - ends));
        const crown = Bar.crownM * (1 - Math.min(1, off / half) ** 2);
        const hb = off <= half ? Bar.topM + crown : Bar.topM + (seabedM - Bar.topM) * smooth(0, 1, (off - half) / Bar.shoulderM);
        h = Math.max(h, hb);
      }
      return h;
    },
    /**
     * Paint shares [grass, sand, rock, soil] for ground standing at height h there.
     * @param {number} x @param {number} z @param {number} h
     */
    paintAt(x, z, h) {
      const j = M.sandJitterM * fbm(sandN, x, z);
      const beach = 1 - smooth(M.sandHighM - M.sandSoftM + j, M.sandHighM + j, h);
      // Machair above the beach (Matt, October 31, 2026): mostly sand through a thin turf, with
      // sparse patches where the grass closes over (where the clover and bedstraw take).
      const P = M.machair, patch = smooth(P.patchFrom, P.patchTo, fbm(patchN, x, z));
      const sand = Math.max(beach, P.sand + (P.patchSand - P.sand) * patch);
      const soil = P.soil * patch * (1 - beach);
      return [Math.max(0, 1 - sand - soil), sand, 0, soil];
    },
  };
}

/**
 * The first low water at or after a game hour. @param {number} fromH
 * @param {{ periodH: number, phaseH: number }} tide recipes/world/water.json tide (with defaults)
 */
export function nextLowH(fromH, tide) {
  const k = Math.ceil((fromH - tide.phaseH) / tide.periodH - 0.5);
  return tide.phaseH + tide.periodH * (k + 0.5);
}

/**
 * The low water it first shows at: the big low tide of firstDay at firstHour, or the first low water
 * after the milestone (and its shoal's lead) when that comes later.
 * @param {any} R @param {{ periodH: number, phaseH: number }} tide @param {number} earnedH the game hour the milestone was earned
 */
export function riseLowH(R, tide, earnedH) {
  const first = R.rise.firstDay * 24 + R.rise.firstHour;
  return nextLowH(Math.max(first, earnedH + R.rise.shoalH), tide);
}

/**
 * How far under its final shape the islet stands at a game hour (m): Infinity before its shoal
 * starts; over shoalH it grows from the seabed to blendDepthM under (the shoal); over durationH from
 * that low water it rises to 0 (smootherstep).
 * @param {any} R @param {number} lowH riseLowH @param {number} tH @param {number} spanM its top over the seabed (final top less seabed)
 */
export function underBy(R, lowH, tH, spanM) {
  const W = R.rise, D = W.blendDepthM;
  if (tH < lowH - W.shoalH) return Infinity;
  if (tH < lowH) return D + Math.max(0, spanM - D) * (1 - smooth(0, 1, (tH - (lowH - W.shoalH)) / W.shoalH));
  const e = clamp01((tH - lowH) / W.durationH);
  return D * (1 - e * e * e * (e * (e * 6 - 15) + 10));
}

/**
 * Where it stands at a game hour: waiting (not earned or not yet shown), shoal, rising or risen.
 * @param {any} R @param {number | null} lowH @param {number} tH
 * @returns {'waiting'|'shoal'|'rising'|'risen'}
 */
export function phaseOf(R, lowH, tH) {
  if (lowH === null || tH < lowH - R.rise.shoalH) return 'waiting';
  if (tH < lowH) return 'shoal';
  return tH < lowH + R.rise.durationH ? 'rising' : 'risen';
}

/** Is a world point inside a box? @param {Box} b @param {number} x @param {number} z */
export const inBox = (b, x, z) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;

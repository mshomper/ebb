// @ts-check
// Canvas weathering (docs/future/13 C-35; B1 C2): the tent's canvas fades and pales over the seasons
// since it was first pitched, gains a few stitched patches where it wore, and its wooden poles silver
// (doc 09's wood, about three seasons). All from game time since `firstPitchedHour` (saved in the camp
// section), eased to a cap after about a year, so it needs no state of its own and catch-up gives the
// same tent. The look is physical: prop-draw.wgsl changes the canvas's linear albedo, and the palette
// still paints at tonemap. Undyed only; a dyed canvas (Phase 4, section 9.3) plugs in through `dye`
// (the tint and its own fade, dyeFadeShare). Pure. Numbers: recipes/world/camp.json `canvas`, `poles`.

import { stream } from '../../core/rng.js';

const HOURS_PER_SEASON = 24 * 14;
/** The patches' stream key (C-35). */
const PATCH_KEY = 35;

/**
 * @typedef {{ fadeSeasons: number, fadeCap: number, patchAtSeasons: number, patchEverySeasons: number, patchMax: number,
 *   patchHalfM: number[][], patchZ: number[], patchY: number[], patchTurn: number }} CanvasRecipe
 * @typedef {{ silverSeasons: number, silverCap: number }} PolesRecipe
 * @typedef {{ fade: number, silver: number, patches: number }} Wear
 *   fade: 0..fadeCap how far the canvas has paled and greyed; silver: 0..silverCap how far the poles
 *   have silvered; patches: how many of the tent's patches are sewn on (0..patchMax)
 * @typedef {{ side: number, z: number, y: number, hw: number, hh: number, turn: number, tone: number }} Patch
 *   on the side facing side (+1: +x, -1: -x) of the tent's own frame, centred at (z, y) on its slope,
 *   half width hw along z and half height hh up the slope (m), turned by turn (radians); tone 0..1 picks
 *   the cloth between the recipe's two patch tints
 */

/** Seasons since the tent was first pitched (0 before, or with no pitch yet). @param {number} hour @param {number | null} firstPitchedHour */
export function seasonsSince(hour, firstPitchedHour) {
  if (!Number.isFinite(firstPitchedHour) || !Number.isFinite(hour)) return 0;
  return Math.max(0, (hour - /** @type {number} */ (firstPitchedHour)) / HOURS_PER_SEASON);
}

/** 0..1 eased out: quick at first, settling to 1 at `full` seasons and staying there. @param {number} s @param {number} full */
export function easeTo(s, full) {
  const t = Math.min(1, Math.max(0, s / Math.max(1e-6, full)));
  return 1 - (1 - t) * (1 - t);
}

/**
 * The tent's wear at `seasons` since it was pitched.
 * @param {number} seasons @param {CanvasRecipe} C @param {PolesRecipe} P @returns {Wear}
 */
export function canvasWear(seasons, C, P) {
  const s = Math.max(0, seasons);
  // The first patch at patchAtSeasons, then one more each patchEverySeasons, up to patchMax.
  const patches = s < C.patchAtSeasons ? 0 : Math.min(C.patchMax, 1 + Math.floor((s - C.patchAtSeasons) / Math.max(1e-6, C.patchEverySeasons)));
  return { fade: C.fadeCap * easeTo(s, C.fadeSeasons), silver: P.silverCap * easeTo(s, P.silverSeasons), patches };
}

/**
 * Where the tent's patches go, the same every time for a tent seed (the tent slot's seed, so one
 * island always wears the same patches). patchMax of them, in the order they are sewn on.
 * @param {number} seed @param {CanvasRecipe} C @returns {Patch[]}
 */
export function canvasPatches(seed, C) {
  const r = stream(seed, PATCH_KEY);
  const lerp = (/** @type {number[]} */ a, /** @type {number} */ t) => a[0] + (a[1] - a[0]) * t;
  /** @type {Patch[]} */ const out = [];
  for (let i = 0; i < C.patchMax; i++) {
    out.push({ side: r.next() < 0.5 ? -1 : 1, z: lerp(C.patchZ, r.next()), y: lerp(C.patchY, r.next()),
      hw: lerp(C.patchHalfM[0], r.next()), hh: lerp(C.patchHalfM[1], r.next()), turn: (r.next() * 2 - 1) * C.patchTurn, tone: r.next() });
  }
  return out;
}

/**
 * The hook for a dyed canvas (section 9.3, Phase 4): the share of a dye faded toward weathered canvas
 * after `seasons` since it was dyed: min(cap, 1 - exp(-seasons / tau)). Re-dyeing starts it fresh.
 * Not used until dyes come (dyeTint below feeds a prop's `dye`).
 * @param {number} seasons @param {{ fadeTau: number, fadeCap: number }} D
 */
export function dyeFadeShare(seasons, D) {
  return Math.min(D.fadeCap, 1 - Math.exp(-Math.max(0, seasons) / Math.max(1e-6, D.fadeTau)));
}

/**
 * The hook's tint for a dyed canvas: the dye (a linear multiplier on the cloth) slid toward weathered
 * canvas by dyeFadeShare. Phase 4 decides the dyes; this only keeps section 9.3's fade in one place.
 * @param {number[]} tint @param {number} seasons since dyed @param {{ fadeTau: number, fadeCap: number, weathered: number[] }} D
 * @returns {number[]} rgb, then 1 (dyed), for the tent prop's `dye`
 */
export function dyeTint(tint, seasons, D) {
  const k = dyeFadeShare(seasons, D);
  return [0, 1, 2].map((i) => tint[i] + (D.weathered[i] - tint[i]) * k).concat(1);
}

/**
 * The tent prop's weathering fields at `hour`: its wear and no dye (undyed until Phase 4).
 * @param {number} hour @param {number | null} firstPitchedHour @param {CanvasRecipe} C @param {PolesRecipe} P
 * @returns {{ wear: number[], dye: number[] }} wear: fade, silver, patches, 0; dye: none yet (dyeTint, Phase 4)
 */
export function tentWeather(hour, firstPitchedHour, C, P) {
  const w = canvasWear(seasonsSince(hour, firstPitchedHour), C, P);
  return { wear: [w.fade, w.silver, w.patches, 0], dye: [0, 0, 0, 0] };
}

// @ts-check
// The gather lab's numbers (docs/future/13 4.2 and 5.2): how many handfuls one plant gives a game
// day, part by part and season by season, when the walker picks it every time it is ready, with the
// growth step's own formula (size += ratePerH x seasonRate x suit x (1 - size) x recoverFactor) on
// ground that suits it fully. Pure, so tools/unit-tests.html can check it too.

import { recoverFactor } from '../src/world/growth/coarse.js';
import { partOf, inWindow } from '../src/world/gather/plants.js';

/** Game hours in a season (14 days). */
export const SEASON_H = 14 * 24;

/**
 * One plant through `hours` game hours from season position `pos0`, picked of `part` whenever it is
 * ready. rain and mist hold for every hour. Returns the handfuls and its size each hour.
 * @param {{ sp: string, part: string, flora: any, gather: any, pos0: number, hours: number, rain: number, mist?: number,
 *   pickAt?: number | null }} a  pickAt: pick once at that hour only (the recovery curve), else whenever ready
 * @returns {{ handfuls: number, sizes: number[] }}
 */
export function runPlant(a) {
  const G = a.flora.growth, P = partOf(a.sp, a.part, a.gather);
  if (!P) return { handfuls: 0, sizes: [] };
  const mature = G.stages.matureSize;
  let size = 0.95, best = 0.95, handfuls = 0;
  /** @type {number[]} */ const sizes = [];
  for (let h = 0; h < a.hours; h++) {
    const pos = (a.pos0 + h / SEASON_H) % 4;
    const season = Math.floor(pos);
    const ready = size >= P.readyShare * best && inWindow(pos, P.window);
    const now = a.pickAt === undefined || a.pickAt === null ? ready : h === a.pickAt;
    if (now) { size = Math.max(G.floor * best, size * (1 - P.share)); handfuls++; }
    const k = recoverFactor(size, best, mature, P.readyShare, a.gather.plants, a.rain, a.mist ?? 0);
    size += G.ratePerH * G.seasonRate[season] * (1 - size) * k;
    if (size > best) best = size;
    sizes.push(size);
  }
  return { handfuls, sizes };
}

/**
 * Handfuls a game day for one part, each season, dry and in rain.
 * @param {string} sp @param {string} part @param {any} flora @param {any} gather
 * @returns {{ dry: number[], wet: number[] }}
 */
export function handfulsBySeason(sp, part, flora, gather) {
  const per = (/** @type {number} */ rain) => [0, 1, 2, 3].map((s) => runPlant({ sp, part, flora, gather, pos0: s, hours: SEASON_H, rain }).handfuls / 14);
  return { dry: per(0), wet: per(1) };
}

/**
 * From a full plant picked whenever it is ready: how many handfuls come one after another (an hour
 * apart) before it must rest, and how many hours it then rests before the next, or null when it
 * never comes back within the hours run.
 * @param {string} sp @param {string} part @param {any} flora @param {any} gather
 * @param {number} pos0 @param {number} rain @param {number} [hours]
 * @returns {{ inARow: number, restH: number | null }}
 */
export function restAfterPicks(sp, part, flora, gather, pos0, rain, hours = SEASON_H) {
  const G = flora.growth, P = partOf(sp, part, gather);
  if (!P) return { inARow: 0, restH: null };
  let size = 0.95, best = 0.95, inARow = 0, last = -1;
  for (let h = 0; h < hours; h++) {
    const season = Math.floor((pos0 + h / SEASON_H) % 4);
    if (size >= P.readyShare * best) {
      if (last >= 0 && h - last > 1) return { inARow, restH: h - last };
      size = Math.max(G.floor * best, size * (1 - P.share));
      inARow++; last = h;
    }
    const k = recoverFactor(size, best, G.stages.matureSize, P.readyShare, gather.plants, rain, 0);
    size += G.ratePerH * G.seasonRate[season] * (1 - size) * k;
    if (size > best) best = size;
  }
  return { inARow, restH: null };
}

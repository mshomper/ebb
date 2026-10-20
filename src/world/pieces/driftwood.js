// @ts-check
// Driftwood on the strandline (docs 13, docs/future/10): once the naturalist's notes give driftwood
// (at 10 finds), each high tide may leave a log or two along its strandline (world/water/
// strandline.js), lying along the shore. Like the shells (world/finds shellAt), where and which is
// a seeded hash of the tide that left it and the cell, so every device sees the same logs, nothing
// is saved, and a later tide that sweeps the line takes its logs with it. Only the newest lines keep
// logs, so a few lie on the island's strand at a time. A log carried off and set down becomes a kept
// piece (model.js makeLog), and the strand never shows it twice. Pure.

import { hash32 } from '../../core/rng.js';
import { strandLines } from '../water/strandline.js';
import { waterCellCenter } from '../water/grid.js';
import { WATER_CLASS } from '../water/summary.js';

/** @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;

/**
 * @typedef {{ key: string, kind: 'log', x: number, z: number, yaw: number, seed: number, size: number, length: number, tideId: number }} StrandLog
 *   key: the strand log's name (its tide and cell); size: thickness (m); seed: its shape, and the kept
 *   record's seed once carried
 */

/**
 * The logs lying on the strandline at a game hour.
 * @param {{ seed: number, nowH: number, tide: import('../tide.js').TideParams, strand: any,
 *   rect: { x: number, y: number, w: number, h: number }, heights: ArrayLike<number>,
 *   height: (x: number, z: number) => number, recipe: any, kept?: Set<number>, mask?: Uint8Array | null }} p
 *   seed: subSeed(worldSeed, 'driftwood'); strand: shore.json look.strandline (runupM, and the lines);
 *   rect: the water cells looked at; heights: the ground at each cell's middle (rect order);
 *   mask: 1 where the sea's strand can be (strandMask; left out: anywhere);
 *   height: the ground anywhere (slope and ends); recipe: pieces.json driftwood; kept: seeds of
 *   logs already carried off (they lie where they were set now)
 * @returns {StrandLog[]}
 */
export function strandLogs(p) {
  const D = p.recipe, R = p.rect, T = p.tide;
  const lines = strandLines(p.nowH, T, p.strand);
  /** @type {StrandLog[]} */ const out = [];
  // Every log the tides left, kept or not: a log carried off still holds its place, so the others
  // stay just where they were.
  /** @type {number[][]} */ const spots = [];
  const apart = D.spacingM * D.spacingM;
  for (let n = 0; n < Math.min(lines.levels.length, D.lines) && spots.length < D.most; n++) {
    const tideId = Math.round((p.nowH - lines.ages[n] - T.phaseH) / T.periodH);
    const level = lines.levels[n] + p.strand.runupM;
    const h0 = hash32(p.seed, tideId, 0xd71f);
    const want = D.perTide[0] + Math.floor(u01(h0) * (D.perTide[1] - D.perTide[0] + 1));
    if (want <= 0) continue;
    /** @type {{ k: number, h: number }[]} */ const cand = [];
    for (let k = 0; k < R.w * R.h; k++) {
      const y = p.heights[k];
      if (Math.abs(y - level) <= D.lineToleranceM && (!p.mask || p.mask[k])) cand.push({ k, h: hash32(p.seed, tideId, k, 0x10a) });
    }
    cand.sort((a, b) => a.h - b.h || a.k - b.k);
    let got = 0;
    for (const c of cand) {
      if (got >= want || spots.length >= D.most) break;
      const i = c.k % R.w, j = (c.k - i) / R.w;
      const x = waterCellCenter(R.x + i) + (u01(hash32(c.h, 1)) - 0.5) * 0.4;
      const z = waterCellCenter(R.y + j) + (u01(hash32(c.h, 2)) - 0.5) * 0.4;
      if (spots.some(([ox, oz]) => (ox - x) * (ox - x) + (oz - z) * (oz - z) < apart)) continue;
      // Its own spot on the line too, not only its cell's middle.
      if (!(Math.abs(p.height(x, z) - level) <= D.lineToleranceM)) continue;
      // Lying along the shore: across the ground's fall, give or take a little.
      const e = 0.3;
      const gx = (p.height(x + e, z) - p.height(x - e, z)) / (2 * e), gz = (p.height(x, z + e) - p.height(x, z - e)) / (2 * e);
      const fall = Math.hypot(gx, gz);
      if (!(fall <= D.maxSlope)) continue;
      const turn = ((u01(hash32(c.h, 3)) - 0.5) * 2 * D.yawJitterDeg * Math.PI) / 180;
      const yaw = (fall > 1e-4 ? Math.atan2(-gz, gx) : u01(hash32(c.h, 4)) * 2 * Math.PI) + turn;
      const length = D.lengthM[0] + (D.lengthM[1] - D.lengthM[0]) * u01(hash32(c.h, 5));
      const size = D.thickM[0] + (D.thickM[1] - D.thickM[0]) * u01(hash32(c.h, 6));
      // Both ends on the strand too, so the log lies along it, not across it.
      const ax = Math.sin(yaw) * length / 2, az = Math.cos(yaw) * length / 2;
      if (Math.abs(p.height(x + ax, z + az) - level) > D.endToleranceM || Math.abs(p.height(x - ax, z - az) - level) > D.endToleranceM) continue;
      got++;
      spots.push([x, z]);
      const seed = hash32(c.h, 7) >>> 0;
      if (p.kept?.has(seed)) continue;
      out.push({ key: `drift:${tideId}:${c.k}`, kind: 'log', x, z, yaw, seed, size, length, tideId });
    }
  }
  return out;
}

/**
 * Where the sea's strand can be: dry or damp ground within reachM of the tide band (the sea's
 * reach, water summary band), so a pond's bank at the same height never gets driftwood. 1 there,
 * by a two-pass chamfer distance (2 a side step of 0.5 m, 3 a diagonal, in quarter meters). Pure.
 * @param {{ rect: { w: number, h: number }, cls: Uint8Array, band: Uint8Array }} s the water summary
 * @param {number} reachM
 */
export function strandMask(s, reachM) {
  const R = s.rect, n = R.w * R.h, far = 0xffff, d = new Uint16Array(n).fill(far);
  for (let k = 0; k < n; k++) if (s.band[k]) d[k] = 0;
  const at = (/** @type {number} */ i, /** @type {number} */ j) => (i < 0 || j < 0 || i >= R.w || j >= R.h ? far : d[j * R.w + i]);
  for (let j = 0; j < R.h; j++) for (let i = 0; i < R.w; i++) {
    const k = j * R.w + i;
    d[k] = Math.min(d[k], at(i - 1, j) + 2, at(i - 1, j - 1) + 3, at(i, j - 1) + 2, at(i + 1, j - 1) + 3);
  }
  for (let j = R.h - 1; j >= 0; j--) for (let i = R.w - 1; i >= 0; i--) {
    const k = j * R.w + i;
    d[k] = Math.min(d[k], at(i + 1, j) + 2, at(i + 1, j + 1) + 3, at(i, j + 1) + 2, at(i - 1, j + 1) + 3);
  }
  const out = new Uint8Array(n), lim = Math.round(reachM * 4);
  for (let k = 0; k < n; k++) if (d[k] <= lim && (s.cls[k] === WATER_CLASS.dry || s.cls[k] === WATER_CLASS.damp)) out[k] = 1;
  return out;
}

/**
 * The ground at the middle of every cell of a rect (rect order), for strandLogs.
 * @param {{ x: number, y: number, w: number, h: number }} R @param {(x: number, z: number) => number} height
 */
export function cellHeights(R, height) {
  const out = new Float32Array(R.w * R.h);
  for (let j = 0; j < R.h; j++) for (let i = 0; i < R.w; i++) out[j * R.w + i] = height(waterCellCenter(R.x + i), waterCellCenter(R.y + j));
  return out;
}

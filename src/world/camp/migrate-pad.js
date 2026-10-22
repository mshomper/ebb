// @ts-check
// An older island's camp pad (docs/future/13 section 3.8, CP-07 then CP-08). Islands made before
// the keeper's camp keep their own land, so the pad is not in their base: it is laid on the first
// load after the update, as recorded edits (off the undo history, marking the chunks edited so the
// save keeps them). Pure: heights in, a spot and the new tiles out.
//
// CP-07: the recipe's spot, unless laying it would flood or cut into what the player shaped: any
// pad cell wet, a cliff face on the pad, a height range over 0.6 m, or more than a tenth of its
// cells shaped by more than 0.3 m. CP-08: then the nearest plateau spot whose cells are all dry and
// not cliff, whose natural spread is within 0.3 m and whose level is at least heightM - 0.05 and
// kingTideMarginM over the highest tide, levelled to its mean. With none, the one needing the least
// change; a cell under water is never levelled.

import { CELL, WORLD_CELLS as N, WORLD_ORIGIN, TILE_CELLS as T, dequantize, quantize } from '../terrain/grid.js';
import { tilesOf, copyTiles } from '../terrain/undo.js';

/** The numbers CP-07 and CP-08 judge a spot by (docs/future/13 section 3.8). */
export const PAD_RULES = Object.freeze({ maxRangeM: 0.6, shapedM: 0.3, shapedShare: 0.1, spreadM: 0.3, levelSlackM: 0.05, ringStepM: 1, ringsM: 30, sampleM: 0.5 });

/**
 * @typedef {Object} PadGround
 * @property {Uint16Array} heightQ   the island's heights now (the mirror)
 * @property {Uint16Array} baseQ     its heights as generated (terrainLive.baseQ)
 * @property {(x: number, z: number) => boolean} wet  standing or running water, or the sea, there
 * @property {number} cliffStepM     a drop to a neighbor cell steeper than this is a cliff face
 * @property {number} tideTopM       the highest spring tide (m)
 * @property {[number, number]} openMin @property {[number, number]} openMax  the open land (m)
 */

/** Cell index of world (x, z), or -1 outside the window. @param {number} x @param {number} z */
function cellAt(x, z) {
  const i = Math.floor((x - WORLD_ORIGIN) / CELL), j = Math.floor((z - WORLD_ORIGIN) / CELL);
  return i < 1 || j < 1 || i >= N - 1 || j >= N - 1 ? -1 : j * N + i;
}

/**
 * The cells a pad of radius r at (x, z) covers, sampled every PAD_RULES.sampleM.
 * @param {number} x @param {number} z @param {number} r @returns {number[]}
 */
function padCells(x, z, r) {
  const out = [], s = PAD_RULES.sampleM;
  for (let dz = -r; dz <= r + 1e-9; dz += s) for (let dx = -r; dx <= r + 1e-9; dx += s) {
    if (dx * dx + dz * dz > r * r) continue;
    out.push(cellAt(x + dx, z + dz));
  }
  return out;
}

/**
 * How a spot measures up: its cells' heights now and as generated, and what rules it breaks.
 * @param {PadGround} g @param {number} x @param {number} z @param {number} r
 */
export function judgeSpot(g, x, z, r) {
  const cells = padCells(x, z, r);
  let lo = Infinity, hi = -Infinity, blo = Infinity, bhi = -Infinity, sum = 0, shaped = 0, wet = 0, cliff = 0, outside = 0;
  let n = 0;
  for (const k of cells) {
    if (k < 0) { outside++; continue; }
    const h = dequantize(g.heightQ[k]), b = dequantize(g.baseQ[k]);
    const wx = WORLD_ORIGIN + ((k % N) + 0.5) * CELL, wz = WORLD_ORIGIN + (Math.floor(k / N) + 0.5) * CELL;
    if (wx < g.openMin[0] || wz < g.openMin[1] || wx > g.openMax[0] || wz > g.openMax[1]) { outside++; continue; }
    n++;
    lo = Math.min(lo, h); hi = Math.max(hi, h); blo = Math.min(blo, b); bhi = Math.max(bhi, b); sum += h;
    if (Math.abs(h - b) > PAD_RULES.shapedM) shaped++;
    if (g.wet(wx, wz)) wet++;
    for (const d of [1, -1, N, -N]) if (Math.abs(dequantize(g.heightQ[k + d]) - h) > g.cliffStepM) { cliff++; break; }
  }
  const mean = n ? sum / n : -Infinity;
  return { n, mean, range: hi - lo, spread: bhi - blo, shaped: n ? shaped / n : 1, wet, cliff, outside };
}

/**
 * Where an older island's pad goes. The spot comes back in world meters with the level it is
 * laid at, and `source` says whether it is the recipe's spot or the nearest that qualified.
 * @param {PadGround} g @param {import('./layout.js').Pad} pad  the recipe's pad
 * @param {number} kingTideMarginM
 * @returns {{ x: number, z: number, heightM: number, facingDeg: number, source: 'recipe' | 'nearest' }}
 */
export function choosePadSpot(g, pad, kingTideMarginM) {
  const R = PAD_RULES;
  const facingDeg = Math.atan2(pad.fz, pad.fx) * 180 / Math.PI;
  const here = judgeSpot(g, pad.x, pad.z, pad.r);
  if (!here.outside && !here.wet && !here.cliff && here.range <= R.maxRangeM && here.shaped <= R.shapedShare) {
    return { x: pad.x, z: pad.z, heightM: pad.h, facingDeg, source: 'recipe' };
  }
  const floor = Math.max(pad.h - R.levelSlackM, g.tideTopM + kingTideMarginM);
  /** @type {{ x: number, z: number, mean: number, cost: number } | null} */ let best = null;
  for (let ring = R.ringStepM; ring <= R.ringsM; ring += R.ringStepM) {
    // About one try per meter of the ring, starting on the camp's own facing line.
    const steps = Math.max(8, Math.ceil(2 * Math.PI * ring));
    for (let a = 0; a < steps; a++) {
      const t = Math.atan2(pad.fz, pad.fx) + 2 * Math.PI * a / steps;
      const x = pad.x + ring * Math.cos(t), z = pad.z + ring * Math.sin(t);
      const j = judgeSpot(g, x, z, pad.r);
      if (j.outside || j.wet || !j.n) continue;
      if (!j.cliff && j.spread <= R.spreadM && j.mean >= floor) return { x, z, heightM: j.mean, facingDeg, source: 'nearest' };
      const cost = j.range + j.cliff * 0.1 + Math.max(0, floor - j.mean) * 4 + j.shaped;
      if (!best || cost < best.cost) best = { x, z, mean: Math.max(j.mean, floor), cost };
    }
  }
  if (best) return { x: best.x, z: best.z, heightM: best.mean, facingDeg, source: 'nearest' };
  return { x: pad.x, z: pad.z, heightM: pad.h, facingDeg, source: 'recipe' };
}

/**
 * The tiles with the pad laid in: level inside r, easing back to the ground over the blend, grass
 * and soil only on the pad. Cells under water are left as they are. Returns the changed tiles for
 * terrain.applyTiles; the mirror itself is not changed.
 * @param {{ heightQ: Uint16Array, material: Uint8Array }} mirror
 * @param {{ x: number, z: number, heightM: number }} at @param {{ r: number, blend: number }} pad
 * @param {(x: number, z: number) => boolean} wet
 */
export function padTiles(mirror, at, pad, wet) {
  const reach = pad.r + pad.blend;
  const i0 = Math.max(0, Math.floor((at.x - reach - WORLD_ORIGIN) / CELL)), i1 = Math.min(N - 1, Math.ceil((at.x + reach - WORLD_ORIGIN) / CELL));
  const j0 = Math.max(0, Math.floor((at.z - reach - WORLD_ORIGIN) / CELL)), j1 = Math.min(N - 1, Math.ceil((at.z + reach - WORLD_ORIGIN) / CELL));
  const tiles = copyTiles(/** @type {any} */ (mirror), tilesOf({ x: i0, y: j0, w: i1 - i0 + 1, h: j1 - j0 + 1 }));
  for (const t of tiles) {
    for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) {
      const ci = t.tx * T + i, cj = t.tz * T + j;
      const x = WORLD_ORIGIN + (ci + 0.5) * CELL, z = WORLD_ORIGIN + (cj + 0.5) * CELL;
      const d = Math.hypot(x - at.x, z - at.z);
      if (d >= reach || wet(x, z)) continue;
      const u = Math.min(1, Math.max(0, (d - pad.r) / pad.blend)), w = 1 - u * u * (3 - 2 * u);
      const k = j * T + i, h = dequantize(t.h[k]);
      t.h[k] = quantize(h + (at.heightM - h) * w);
      // Grass and soil only on the pad: sand and rock fold into grass as the pad takes over.
      const m = t.m, o = k * 4, moved = Math.round((m[o + 1] + m[o + 2]) * w);
      const sand = Math.round(m[o + 1] * w), rock = Math.min(m[o + 2], moved - sand);
      m[o + 1] -= sand; m[o + 2] -= rock; m[o] += sand + rock;
    }
  }
  return tiles;
}

/**
 * Loose stones and logs on the pad move to just outside its edge, straight out from its center.
 * @param {import('../pieces/model.js').PiecesState} pieces @param {{ x: number, z: number }} at @param {number} r
 * @returns {import('../pieces/model.js').PiecesState}
 */
export function clearPieces(pieces, at, r) {
  let moved = false;
  const list = pieces.list.map((p) => {
    const dx = p.x - at.x, dz = p.z - at.z, d = Math.hypot(dx, dz);
    const reach = r + 0.4 + (p.length ?? p.size ?? 0) * 0.5;
    if (d >= reach) return p;
    moved = true;
    const ux = d > 1e-6 ? dx / d : 1, uz = d > 1e-6 ? dz / d : 0;
    return { ...p, x: at.x + ux * reach, z: at.z + uz * reach };
  });
  return moved ? { ...pieces, list } : pieces;
}

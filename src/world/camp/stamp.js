// @ts-check
// Lay an older island's camp pad on its first load after the update (docs/future/13 section 3.8):
// pick the spot (src/world/camp/migrate-pad.js), level it as recorded edits off the undo history,
// move loose stones and logs to its edge, note it in the save's `camp` section and the live
// `campPad` slice, and emit `camp:stamped`. Runs once; a stamped island never moves its pad again.

import { get, update } from '../../core/store.js';
import { emitDeferred } from '../../core/events.js';
import { WATER_CLASS } from '../water/summary.js';
import { waterCellOf } from '../water/grid.js';
import { padOf } from './layout.js';
import { choosePadSpot, padTiles, clearPieces } from './migrate-pad.js';

/**
 * Standing or running water, or the sea, at (x, z) from the water summary.
 * @param {any} summary @returns {(x: number, z: number) => boolean}
 */
export function wetFromSummary(summary) {
  const W = WATER_CLASS;
  return (x, z) => {
    if (!summary) return false;
    const i = waterCellOf(x) - summary.rect.x, j = waterCellOf(z) - summary.rect.y;
    if (i < 0 || j < 0 || i >= summary.rect.w || j >= summary.rect.h) return true;
    const c = summary.cls[j * summary.rect.w + i];
    return c === W.sea || c === W.still || c === W.slow || c === W.running;
  };
}

/**
 * Stamp the pad if this island needs it: its land has a camp that is not in its base, and the
 * save's camp section is not stamped yet. Returns the spot, or null when nothing was done.
 * @param {{ land: any, terrain: any, water: any, terrainRecipe: any, waterRecipe: any }} o
 */
export function stampOlderPad(o) {
  const C = o.land.camp;
  const camp = get('camp');
  if (!C || C.inBase !== false || camp?.stamped) return null;
  const pad = padOf(o.land);
  const live = get('terrainLive');
  if (!pad || !live?.mirror) return null;
  const wet = wetFromSummary(o.water.getSummary?.());
  const tide = o.waterRecipe.tide;
  const b = o.terrain.openBounds();
  const at = choosePadSpot({
    heightQ: live.mirror.heightQ, baseQ: live.baseQ ?? live.mirror.heightQ, wet,
    cliffStepM: Math.tan(o.terrainRecipe.cliff.faceDeg * Math.PI / 180) * 0.25,
    tideTopM: tide.amplitudeM * (1 + (tide.springNeap ?? 0)),
    openMin: b.openMin, openMax: b.openMax,
  }, pad, C.kingTideMarginM);
  o.terrain.applyTiles(padTiles(live.mirror, at, pad, wet));
  update('pieces', (p) => (p?.list ? clearPieces(p, at, pad.r) : p));
  update('camp', (c) => ({ ...(c ?? { version: 1 }), stamped: true, pad: at }));
  update('campPad', () => padOf(o.land, at));
  emitDeferred('camp:stamped', { source: at.source });
  return at;
}

// @ts-check
// The strandline (docs/future/10, Z3, "The driftline"): each high tide leaves a line of litter
// (dried wrack, kelp, sticks, shells) along its highest reach, and a later, higher tide sweeps it
// up into its own line. From the analytic tide (tide.js) alone: the last few high waters, and of
// those the lines still lying, the ones no later high water reached above. The newest line is the
// freshest; older ones dry and scatter. Pure, from the display hour, so every device agrees and
// nothing is saved.

import { amplitude } from '../tide.js';

/**
 * @typedef {{ levels: number[], strengths: number[], ages: number[] }} Strandlines
 *   levels: meters about mean sea level, newest first; strengths 0..1; ages in game hours
 */

/**
 * The lines lying at a game hour.
 * @param {number} nowH game hours (display time)
 * @param {import('../tide.js').TideParams} p tide params
 * @param {{ lookbackTides: number, maxLines: number, fadeHours: number }} r shore.json `strandline`
 * @returns {Strandlines}
 */
export function strandLines(nowH, p, r) {
  /** @type {Strandlines} */ const out = { levels: [], strengths: [], ages: [] };
  const n0 = Math.floor((nowH - p.phaseH) / p.periodH);
  let highest = -Infinity;   // the highest water since: anything below it was swept up
  for (let k = 0; k < r.lookbackTides && out.levels.length < r.maxLines; k++) {
    const t = p.phaseH + (n0 - k) * p.periodH;
    const lvl = amplitude(t, p);
    if (lvl > highest) {
      const age = nowH - t;
      out.levels.push(lvl);
      out.ages.push(age);
      out.strengths.push(Math.exp(-age / r.fadeHours));
    }
    highest = Math.max(highest, lvl);
  }
  return out;
}

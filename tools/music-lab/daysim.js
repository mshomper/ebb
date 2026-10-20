// @ts-check
// The music lab's day simulator (doc 24, "The music lab"): runs the real director against the
// game's own sun (src/world/sky/sun-moon.js with recipes/world/sky.json's orbit) for a number of
// game days, at a time flow of 1x, 4x or 16x, without playing anything, and reports every slot,
// piece, rest and frog window, and the share of real time the music bus is silent. A piece's
// length is either its real realized length or, while only short test pieces exist, a length
// drawn from its slot's planned range (doc 24's slot lengths), so the pacing can be judged now.

import { sunMoon } from '../../src/world/sky/sun-moon.js';
import { createDirector } from '../../src/audio/music/director.js';
import { stream } from '../../src/core/rng.js';
import { DAYS_PER_SEASON } from '../../src/core/clock.js';

const DAY = 86400;
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

/**
 * @param {{
 *   recipes: {director: any, seasons: Record<string, any>}, pieces: any[], orbit: any,
 *   days: number, flow: number, seed: number, startDay?: number, startHour?: number,
 *   weather: 'clear'|'cloud'|'rain'|'mist', frogsSettled: boolean, frequency?: string,
 *   lengths?: 'planned'|'real', realLength?: (piece: any, seed: number) => number,
 *   dormancy?: number[], callAfterDuskH?: number[],
 * }} o
 */
export function simulate(o) {
  const sunAltDeg = (/** @type {number} */ t) => (sunMoon(t, { latitudeDeg: o.orbit.latitudeDeg, tiltDeg: o.orbit.tiltDeg }).sunAlt * 180) / Math.PI;
  const dir = createDirector(o.recipes, o.pieces, { seed: o.seed, sunAltDeg });
  const r = stream(o.seed >>> 0, 0x51a);
  const startT = ((o.startDay ?? 0) * 24 + (o.startHour ?? o.orbit.startHour ?? 10)) * 3600;
  const endReal = (o.days * DAY) / (60 * o.flow);
  const dorm = o.dormancy ?? [2.6, 0.3];
  const call = o.callAfterDuskH ?? [-0.5, 3];
  /** @type {any[]} */
  const pieces = [];
  /** @type {any[]} */
  const rests = [];
  let playingUntil = -1, cur = /** @type {any} */ (null);
  const step = 1; // real seconds
  for (let realS = 0; realS < endReal; realS += step) {
    const gameT = startT + realS * 60 * o.flow;
    const pos = ((gameT / (DAYS_PER_SEASON * DAY)) % 4 + 4) % 4;
    const awake = o.frogsSettled && !(dorm[1] <= dorm[0] ? pos >= dorm[0] || pos < dorm[1] : pos >= dorm[0] && pos < dorm[1]);
    const di = dir.dayInfo(Math.floor(gameT / DAY));
    const h = (gameT % DAY) / 3600;
    const calling = awake && h >= di.dusk + call[0] && h < di.dusk + call[1];
    const st = { realS, gameT, weather: o.weather, frogsAwake: awake, frogsCalling: calling, residents: o.frogsSettled ? ['frog'] : [], frequency: /** @type {any} */ (o.frequency ?? 'now-and-then') };
    if (cur && realS >= playingUntil) {
      cur.endRealS = realS;
      const rest = dir.ended(st);
      rests.push({ fromRealS: realS, toRealS: realS + rest });
      cur = null;
    }
    if (!cur) {
      const d = dir.update(st);
      if (d) {
        const slotLen = (o.recipes.director.slots[d.slot === 'early-nocturne' ? 'nocturne' : d.slot]?.lenMin ?? [2, 3]);
        const len = o.lengths === 'real' && o.realLength ? o.realLength(d.piece, d.seed) : (slotLen[0] + r.next() * (slotLen[1] - slotLen[0])) * 60;
        dir.started(d, st, d.key ?? d.piece.keys[0]);
        cur = { id: d.piece.id, slot: d.slot, seed: d.seed, startRealS: realS, endRealS: realS + len, gameT, season: SEASONS[Math.floor(pos)], note: /** @type {any} */ (d).note };
        playingUntil = realS + len;
        pieces.push(cur);
      }
    }
  }
  const playedS = pieces.reduce((n, p) => n + (Math.min(p.endRealS, endReal) - p.startRealS), 0);
  // The sun's day for each simulated game day, for drawing.
  const firstDay = Math.floor(startT / DAY), lastDay = Math.floor((startT + endReal * 60 * o.flow) / DAY);
  const daysInfo = [];
  for (let d = firstDay; d <= lastDay; d++) daysInfo.push(dir.dayInfo(d));
  return { pieces, rests, endRealS: endReal, startT, flow: o.flow, silenceShare: 1 - playedS / endReal, days: daysInfo, log: dir.log() };
}

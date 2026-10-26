// @ts-check
// The star fire (docs/future/13 section 3.12, Matt's rule: always a star of wood; S4): the ring's
// wood drawn as a few logs from Matt's single log model, radiating, their burnt ends meeting in the
// middle. As the fire burns its logs burn shorter and are pushed in, so the inner ends always meet;
// each is charred from its inner end by the fire's state and glows there as embers. Once the hearth
// stones stand in the middle (made at the workbench), the logs that would run into a stone stop at
// its outer face and the others reach in between them, under the pot. Pieces laid at the fire to
// fire overnight sit between the logs at the star's edge. Pure: it reads the fire now and gives
// where each log lies in the ring's own frame; frame.js turns that into the world.

import { hash32 } from '../../core/rng.js';

const DEG = Math.PI / 180;

/** 0..1 from a hash. @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;

/**
 * @typedef {{ logs: number, sizeM: number, logLenM: number, innerM: number, hearthInnerM: number, stoneClearM: number, stoneHalfDeg: number,
 *   tiltDeg: number, startDeg: number, jitterDeg: number, sizeJitter: number, pushM: number, maxBurntM: number, settledBurnt: number,
 *   endChar: Record<string, number>, glow: Record<string, number>, workM: number[], workLiftM: number }} StarRecipe recipes/world/camp.json star
 * @typedef {{ a: number, r: number, y: number, roll: number, size: number, stretch: number, endChar: number, glow: number }} StarLog
 *   a: its direction from the middle in the ring model's frame (radians, 0 along the model's +x,
 *   toward its +z at 90 degrees); r: how far its inner end lies from the middle (m); y: its base's
 *   lift at its middle (m); roll: its outer end raised (radians); size: its scale; stretch: its
 *   length now as a share of the model's; endChar: burnt from the inner end this far along; glow: its embers
 */

/**
 * How much of each log has burnt away: the logs are pushed in pushM for each handful's flame hours
 * the burn going now has had, up to maxBurntM; banked or cold, they stay at settledBurnt of that.
 * A new lighting lays fresh logs. @param {{ word: string }} at fireAt now
 * @param {{ sinceHour: number, flameUntilHour: number }} fire @param {number} hour
 * @param {{ flameH: number }} F @param {StarRecipe} S
 */
export function burntM(at, fire, hour, F, S) {
  if (at.word === 'lit') return Math.min(S.maxBurntM, (S.pushM * Math.max(0, Math.min(hour, fire.flameUntilHour) - fire.sinceHour)) / Math.max(1e-6, F.flameH));
  if (at.word === 'embers' || at.word === 'cold') return S.maxBurntM * S.settledBurnt;
  return 0;
}

/**
 * The star's logs now, in the ring model's frame. With the hearth stones (three stones 120 degrees
 * apart, the first toward the model's -z), the logs that line up with a stone stop at stoneClearM
 * and the rest reach in to hearthInnerM between them. Seeded jitter keeps it hand-laid.
 * @param {{ word: string, ash: number }} at fireAt now @param {{ sinceHour: number, flameUntilHour: number }} fire
 * @param {number} hour @param {{ flameH: number }} F @param {StarRecipe} S
 * @param {{ seed: number, hearth: boolean, rainy?: boolean, halfX?: number }} o halfX: the log model's half length (m)
 * @returns {StarLog[]}
 */
export function starLogs(at, fire, hour, F, S, o) {
  const word = at.word;
  if (word === 'none') return [];
  const burnt = burntM(at, fire, hour, F, S), n = Math.max(1, S.logs);
  const stones = [-90, 30, 150].map((d) => d * DEG), half = S.stoneHalfDeg * DEG;
  const char = S.endChar[word] ?? 0;
  const glow = word === 'lit' ? (o.rainy ? 1 : S.glow.lit ?? 0.6) : S.glow[word] ?? 0;
  /** @type {StarLog[]} */ const out = [];
  for (let i = 0; i < n; i++) {
    const h = hash32(o.seed >>> 0, i + 1);
    const a = (S.startDeg + (360 * i) / n + (u01(h) - 0.5) * 2 * S.jitterDeg) * DEG;
    const size = (S.sizeM / S.logLenM) * (1 + (u01(hash32(h, 1)) - 0.5) * 2 * S.sizeJitter);
    // A log lined up with a hearth stone stops at the stone's outer face.
    const onStone = o.hearth && stones.some((s) => Math.abs(Math.atan2(Math.sin(a - s), Math.cos(a - s))) < half);
    const inner = o.hearth ? (onStone ? S.stoneClearM : S.hearthInnerM) : S.innerM;
    const len = S.logLenM * size, stretch = Math.max(0.3, (len - burnt) / len);
    const roll = S.tiltDeg * DEG * (1 + (u01(hash32(h, 2)) - 0.5) * 0.4);
    const halfLen = (len * stretch) / 2;
    // Its inner end on the ground in the middle, its outer end raised over the ring's stones.
    out.push({ a, r: inner, y: halfLen * Math.sin(roll), roll, size, stretch, endChar: char * (0.9 + 0.2 * u01(hash32(h, 3))), glow });
  }
  return out;
}

/**
 * A star log's place in the ring model's frame: its origin (the middle of its base) and the yaw
 * that turns the log model's +x (its outer end) outward. @param {StarLog} g @param {number} halfX
 * the log model's half length (m) @returns {{ x: number, z: number, y: number, yaw: number }}
 */
export function logPlace(g, halfX) {
  const halfLen = halfX * g.size * g.stretch;
  const rc = g.r + halfLen * Math.cos(g.roll);
  return { x: Math.cos(g.a) * rc, z: Math.sin(g.a) * rc, y: g.y, yaw: -g.a };
}

/**
 * Where a piece laid at the fire sits: between the logs at the star's edge, the i-th of them, in
 * the ring model's frame. @param {number} i @param {StarRecipe} S @returns {{ x: number, z: number, a: number }}
 */
export function workSpot(i, S) {
  const n = Math.max(1, S.logs), a = (S.startDeg + (360 * (i + 0.5)) / n) * DEG, r = S.workM[i % S.workM.length];
  return { x: Math.cos(a) * r, z: Math.sin(a) * r, a };
}

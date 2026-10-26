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
import { ANGLES, DR, RING, HEARTH } from './ring-top.js';

const DEG = Math.PI / 180;

/** 0..1 from a hash. @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;

/**
 * @typedef {{ logs: number, sizeM: number, logLenM: number, innerM: number, hearthInnerM: number, stoneClearM: number, stoneHalfDeg: number,
 *   minTiltDeg: number, maxTiltDeg: number, sinkM: number, clearM: number, ashTopM: number, logHalfW: number, logThick: number, minStretch: number, startDeg: number, jitterDeg: number, sizeJitter: number, pushM: number, maxBurntM: number, settledBurnt: number,
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
    const len = S.logLenM * size;
    // Its inner end on the ash in the middle, the rest resting on the stones it crosses: tipped up
    // just enough to clear each one, or, where that would stand it too steep, shorter, so its outer
    // end stops against the stone instead of passing through it.
    const fit = fitLog(a, inner, Math.max(S.minStretch * len, len - burnt), size, !!o.hearth, S, S.minTiltDeg * DEG * (1 + (u01(hash32(h, 2)) - 0.5) * 0.4));
    const stretch = fit.len / len, roll = fit.roll;
    const halfLen = fit.len / 2;
    out.push({ a, r: inner, y: fit.y0 + halfLen * Math.sin(roll), roll, size, stretch, endChar: char * (0.9 + 0.2 * u01(hash32(h, 3))), glow });
  }
  return out;
}

/**
 * The tops of the ring's stones (and the hearth stones, once laid) under a point in the ring
 * model's frame (m), from the baked tables (ring-top.js; each cell's highest point, so it never
 * reads low). @param {number} x @param {number} z @param {boolean} hearth
 */
export function stoneTop(x, z, hearth) {
  const r = Math.hypot(x, z), ai = ((Math.floor((Math.atan2(z, x) / (2 * Math.PI)) * ANGLES) % ANGLES) + ANGLES) % ANGLES;
  const at = (/** @type {{ radii: number, mm: number[] }} */ T) => { const ri = Math.floor(r / DR); return ri < T.radii ? T.mm[ai * T.radii + ri] / 1000 : 0; };
  return Math.max(at(RING), hearth ? at(HEARTH) : 0);
}

/** Each log line's profile of what it must clear, kept by its direction and inner end. @type {Map<string, { y0: number, need: Float64Array }>} */
const profiles = new Map();
const STEP = 0.01;

/**
 * What a log along direction a from inner end r0 rests on: y0 the height of its inner end, and
 * need[i] the least slope (rise over run) its underside must have to clear everything out to
 * i * STEP from its inner end, across its width. Ash is sunk into by sinkM; stone is kept clearM off.
 * @param {number} a @param {number} r0 @param {number} halfW @param {boolean} hearth @param {StarRecipe} S
 */
function profile(a, r0, halfW, hearth, S) {
  const key = `${a.toFixed(5)}|${r0}|${halfW.toFixed(5)}|${hearth}`;
  const had = profiles.get(key);
  if (had) return had;
  const ca = Math.cos(a), sa = Math.sin(a);
  const under = (/** @type {number} */ s) => {
    let m = -1;
    for (const w of [-1, -0.5, 0, 0.5, 1]) {
      const t = stoneTop(ca * (r0 + s) - sa * w * halfW, sa * (r0 + s) + ca * w * halfW, hearth);
      m = Math.max(m, t <= S.ashTopM ? t - S.sinkM : t + S.clearM);
    }
    return m;
  };
  const y0 = Math.max(under(0), under(STEP), under(2 * STEP));
  const n = Math.ceil(0.6 / STEP), need = new Float64Array(n + 1);
  for (let i = 3; i <= n; i++) need[i] = Math.max(need[i - 1], (under(i * STEP) - y0) / (i * STEP));
  const p = { y0, need };
  if (profiles.size > 512) profiles.clear();
  profiles.set(key, p);
  return p;
}

/**
 * A log's length and tip so it rests on the stones it crosses and never passes through one: the
 * least tip that clears them along its length (and its end's face), at least minRoll; where that
 * is steeper than maxTiltDeg, it is shortened until it fits (down to minStretch of its length).
 * @param {number} a @param {number} r0 @param {number} len its length now (m) @param {number} size
 * @param {boolean} hearth @param {StarRecipe} S @param {number} minRoll
 * @returns {{ len: number, roll: number, y0: number }}
 */
export function fitLog(a, r0, len, size, hearth, S, minRoll) {
  const P = profile(a, r0, S.logHalfW * size, hearth, S), thick = S.logThick * size;
  const needTo = (/** @type {number} */ run) => P.need[Math.min(P.need.length - 1, Math.max(0, Math.ceil(run / STEP)))];
  const rollFor = (/** @type {number} */ L) => {
    let roll = minRoll;
    for (let k = 0; k < 3; k++) roll = Math.max(minRoll, Math.atan(needTo(L * Math.cos(roll) + thick * Math.sin(roll))));
    return roll;
  };
  const maxRoll = S.maxTiltDeg * DEG, least = S.minStretch * S.logLenM * size;
  let L = len, roll = rollFor(L);
  while (roll > maxRoll && L - STEP >= least) { L -= STEP; roll = rollFor(L); }
  return { len: L, roll, y0: P.y0 };
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

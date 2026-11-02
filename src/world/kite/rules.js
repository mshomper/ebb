// @ts-check
// The kite, pure (docs/future/20, 'The kite'). When it washes in and where it lies, where the islet's
// top is and whether you may fly it there, where it is in the air, and the high view's pose.
// Numbers: recipes/world/kite.json. The wash-in is read from the seeded weather's day records
// (src/world/weather.js dayRecord), so an island left alone finds it lying there on its return,
// and the same seed and edits always bring it on the same day.

import { dayRecord } from '../weather.js';
import { seasonOf, SECONDS_PER_DAY } from '../../core/clock.js';

const DEG = Math.PI / 180;
const AUTUMN = 2;

/** The way the wind blows toward, as a ground vector (weather.js: 0 = +x, pi/2 = -z). @param {number} dir */
export const windVec = (dir) => [Math.cos(dir), -Math.sin(dir)];

/**
 * Does a wind blow onto the bar: within onshoreDeg of straight across its line, from either side?
 * @param {number} dir @param {{ tx: number, tz: number }} L the islet's layout (t runs across the bar)
 * @param {number} onshoreDeg
 */
export function onshore(dir, L, onshoreDeg) {
  const w = windVec(dir);
  return Math.abs(w[0] * L.tx + w[1] * L.tz) >= Math.cos(onshoreDeg * DEG) - 1e-9;
}

/**
 * The game day the torn kite washes in: the first autumn day after the islet rose whose wind is at
 * least windMin and onshore. Null if none within searchDays (or before the islet rose).
 * @param {{ weatherSeed: number, lean: number, weather: any, riseDay: number | null, L: any, W: any }} o
 *   weather: seasons.json weather; W: kite.json wash
 * @returns {number | null}
 */
export function washDay(o) {
  if (o.riseDay === null || !Number.isFinite(o.riseDay)) return null;
  for (let d = o.riseDay + 1; d <= o.riseDay + o.W.searchDays; d++) {
    if (seasonOf(d * SECONDS_PER_DAY).index !== AUTUMN) continue;
    const rec = dayRecord(o.weatherSeed, d, o.lean, o.weather);
    if (rec.windStrength >= o.W.windMin && onshore(rec.windDir, o.L, o.W.onshoreDeg)) return d;
  }
  return null;
}

/**
 * Where it lies: walking in along the bar's line from the sea toward the islet's middle, the first
 * ground between aboveTideM and aboveTideM + bandM over the highest tide, sideM off the walking line.
 * @param {any} L the islet's layout @param {(x: number, z: number) => number} heightAt its final ground
 * @param {number} highTideM @param {any} W kite.json wash @returns {{ x: number, z: number } | null}
 */
export function strandSpot(L, heightAt, highTideM, W) {
  const lo = highTideM + W.aboveTideM, hi = lo + W.bandM;
  for (let s = L.B + 14; s >= 0; s -= 0.25) {
    const x = L.x - L.ux * s + L.tx * W.sideM, z = L.z - L.uz * s + L.tz * W.sideM;
    const h = heightAt(x, z);
    if (h >= lo && h <= hi) return { x, z };
  }
  return null;
}

/** The islet's highest ground (a 1 m search over its outline). @param {any} L @param {(x: number, z: number) => number} heightAt */
export function isletTop(L, heightAt) {
  let best = { x: L.x, z: L.z, y: heightAt(L.x, L.z) };
  for (let a = -L.A; a <= L.A; a += 1) for (let b = -L.B; b <= L.B; b += 1) {
    const x = L.x + a * L.tx + b * L.ux, z = L.z + a * L.tz + b * L.uz, y = heightAt(x, z);
    if (y > best.y) best = { x, z, y };
  }
  return best;
}

/**
 * May the kite go up from here? 'ok'; 'calm' (on the top, but too little wind); 'where' (anywhere else).
 * @param {number[] | null} you [x, y, z] where you stand below, or null above
 * @param {{ x: number, z: number, y: number } | null} top @param {(x: number, z: number) => number} ground live ground
 * @param {number} wind now, 0..1 @param {any} F kite.json fly
 * @returns {'ok' | 'calm' | 'where'}
 */
export function flyState(you, top, ground, wind, F) {
  if (!you || !top) return 'where';
  if (Math.hypot(you[0] - top.x, you[2] - top.z) > F.topReachM || ground(you[0], you[2]) < top.y - F.topDropM) return 'where';
  return wind >= F.windMin ? 'ok' : 'calm';
}

/** Smoothstep. @param {number} x */
export const ease = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

/**
 * The kite in the air, t seconds after it was let out from the hand: its point (meters) and the
 * line's length, out downwind and swaying. @param {number[]} hand [x, y, z] @param {number} dir the wind's
 * @param {number} t @param {any} F kite.json fly
 */
export function kiteAt(hand, dir, t, F) {
  const len = F.lineM * ease(t / F.climbS);
  const sway = Math.sin(t * F.swayHz * 2 * Math.PI), sway2 = Math.sin(t * F.swayHz * 1.7 * 2 * Math.PI + 1.3);
  const elev = (F.elevDeg + F.swayDeg * 0.6 * sway2) * DEG * ease(t / (F.climbS * 0.6) + 0.15);
  const az = Math.atan2(-Math.sin(dir), Math.cos(dir)) + F.swayDeg * DEG * sway;
  const h = Math.cos(elev) * len;
  return { x: hand[0] + Math.cos(az) * h, y: hand[1] + Math.sin(elev) * len, z: hand[2] + Math.sin(az) * h, len, up: ease(t / F.climbS) };
}

/** @param {number[]} a @param {number[]} b */
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** @param {number[]} a */
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/**
 * A pose from three axes (columns: x, y, z) as a column-major 4x4 (the pieces pass's bone). @param {number[]} x
 * @param {number[]} y @param {number[]} z @returns {Float32Array}
 */
export const axes = (x, y, z) => new Float32Array([x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, 0, 0, 0, 1]);

/**
 * The flying kite's pose: its face (+z of its mesh) toward the wind it rides, leaning back tiltDeg,
 * the spine (+y) up, wobbling about its face. @param {number[]} kite [x, y, z] @param {number[]} hand
 * @param {number} t @param {any} F
 */
export function kitePose(kite, hand, t, F) {
  const d = norm([kite[0] - hand[0], 0, kite[2] - hand[2]]), tilt = F.tiltDeg * DEG;
  const z = [-d[0] * Math.cos(tilt), -Math.sin(tilt), -d[2] * Math.cos(tilt)];
  const y0 = [-d[0] * Math.sin(tilt), Math.cos(tilt), -d[2] * Math.sin(tilt)];
  const roll = F.rollDeg * DEG * Math.sin(t * 1.9) * Math.sin(t * 0.7 + 0.4);
  const x0 = cross(y0, z);
  const y = [y0[0] * Math.cos(roll) + x0[0] * Math.sin(roll), y0[1] * Math.cos(roll) + x0[1] * Math.sin(roll), y0[2] * Math.cos(roll) + x0[2] * Math.sin(roll)];
  return axes(cross(y, z), y, z);
}

/**
 * The line from the hand to the kite, sagging at its middle: n + 1 points. @param {number[]} a
 * @param {number[]} b @param {number} sag meters at the middle @param {number} n
 */
export function linePoints(a, b, sag, n) {
  /** @type {number[][]} */ const out = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n, dip = 4 * s * (1 - s) * sag;
    out.push([a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s - dip, a[2] + (b[2] - a[2]) * s]);
  }
  return out;
}

/**
 * A segment of rod as a bone: its mesh runs 0..1 along +z, so z is the whole segment. @param {number[]} a
 * @param {number[]} b
 */
export function segmentBone(a, b) {
  const z = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const n = norm(z), x = norm(cross(Math.abs(n[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0], n));
  return axes(x, cross(n, x), z);
}

/**
 * The high view's goal: behind the kite, looking over it at the middle of what it frames (the
 * island, the islet, the stack), at `fill` times the distance that would just hold their circle
 * square on (the low, slanting view foreshortens the ground, so under 1 still holds it all).
 * @param {{ x: number, z: number, r: number }[]} things @param {number[]} kite @param {number} fovY radians
 * @param {number} t seconds since the view began @param {any} V kite.json view
 * @returns {{ eye: number[], look: number[] }}
 */
export function viewGoal(things, kite, fovY, t, V) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of things) { x0 = Math.min(x0, p.x - p.r); x1 = Math.max(x1, p.x + p.r); z0 = Math.min(z0, p.z - p.r); z1 = Math.max(z1, p.z + p.r); }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, rad = Math.hypot(x1 - x0, z1 - z0) / 2;
  const dist = (rad / Math.tan(fovY / 2)) * V.fill;
  // From the middle out past the kite, drifting a little either way.
  const a0 = Math.atan2(kite[2] - cz, kite[0] - cx) + V.driftDeg * DEG * Math.sin(t * V.driftHz * 2 * Math.PI);
  const p = V.pitchDeg * DEG;
  const h = Math.max(dist * Math.cos(p), Math.hypot(kite[0] - cx, kite[2] - cz) + V.behindM);
  return { eye: [cx + Math.cos(a0) * h, Math.max(kite[1] + V.behindM, Math.tan(p) * h), cz + Math.sin(a0) * h], look: [cx, 0, cz] };
}

/**
 * Photo mode's free pose (src/render/camera.js setFree) from an eye and a point to look at.
 * @param {number[]} eye @param {number[]} look @returns {{ eye: number[], yaw: number, pitch: number }}
 */
export function freePose(eye, look) {
  const dx = look[0] - eye[0], dy = look[1] - eye[1], dz = look[2] - eye[2];
  const len = Math.hypot(dx, dy, dz) || 1;
  return { eye: [eye[0], eye[1], eye[2]], yaw: Math.atan2(-dx, -dz), pitch: Math.asin(Math.max(-1, Math.min(1, dy / len))) };
}

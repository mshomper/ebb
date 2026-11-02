// @ts-check
// The grey seal's clips (B3 wave 3): bone moves for the rig in model.js, written against its bone
// roles, for adult and pup alike (the pup breathes faster and waves and rolls). Body space: forward
// +z, up +y, the seal's own left +x. A turn about +x by a positive angle drops what is ahead of a
// pivot and lifts what is behind it. Numbers: recipes/species/seal.json motion. Live animation
// only (never saved); plain Math is fine here.

import { axisAngle } from '../creatures/pose.js';
import { B, SEAL_BONES } from './model.js';

const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
const TAU = Math.PI * 2;

/** q = a * b (quaternions [x, y, z, w]). @param {number[]} a @param {number[]} b */
function qmul(a, b) {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}

/** A turn of yaw (about y), then pitch (about x), then roll (about z), each radians. @param {number} yaw @param {number} pitch @param {number} [roll] */
export function turn(yaw, pitch, roll = 0) {
  let q = [0, 0, 0, 1];
  if (yaw) q = qmul(q, axisAngle(Y, yaw));
  if (pitch) q = qmul(q, axisAngle(X, pitch));
  if (roll) q = qmul(q, axisAngle(Z, roll));
  return q;
}

/** @typedef {import('../creatures/pose.js').BoneMove} BoneMove */
/** A still skeleton's moves (one null a bone). @returns {(BoneMove | null)[]} */
const still = () => SEAL_BONES.map(() => null);

/**
 * Breathing at rest: the chest swells, the neck takes it back so the head stays its size.
 * @param {(BoneMove | null)[]} m @param {number} t seconds @param {number} periodS @param {number} amount
 */
function breathe(m, t, periodS, amount) {
  const s = 1 + amount * (0.5 + 0.5 * Math.sin((TAU * t) / periodS));
  m[B.chest] = { ...(m[B.chest] ?? {}), s: [s, s, 1] };
  m[B.neck] = { ...(m[B.neck] ?? {}), s: [1 / s, 1 / s, 1] };
}

/**
 * Lying hauled out. banana 0..1 how curved (head and tail flippers lifted, a little to one side and
 * rolled toward it); side -1 or 1; look: where the head turns (radians) and how far it lifts;
 * scratch: -1 none, else 0..1 through a fore flipper's scratch; yawn: 0..1 how far the jaw is open;
 * wave: 0..1 through a pup's flipper wave (-1 none); rollOver: 0..1 how far a pup has rolled on its back.
 * @param {any} M recipes/species/seal.json motion @param {number} t seconds
 * @param {{ banana: number, side: number, look: { yaw: number, lift: number }, scratch: number, yawn: number, pup: boolean, wave?: number, rollOver?: number }} o
 */
export function lieMoves(M, t, o) {
  const m = still(), A = M.banana, b = o.banana, s = o.side;
  const roll = -s * A.roll * b + (o.rollOver ?? 0) * s * 1.6;
  m[B.root] = { q: turn(0, 0, roll) };
  m[B.lumbar] = { q: turn(-s * A.side * b * 0.5, A.tail * b * 0.55) };
  m[B.tail] = { q: turn(-s * A.side * b * 0.5, A.tail * b * 0.45) };
  m[B.chest] = { q: turn(s * A.side * b * 0.4, 0) };
  const L = M.look;
  m[B.neck] = { q: turn(o.look.yaw * L.turn * 0.6 + s * A.side * b * 0.3, -A.head * b * 0.5 - o.look.lift * 0.5) };
  m[B.head] = { q: turn(o.look.yaw * L.turn * 0.4, -o.look.lift * 0.5) };
  m[B.jaw] = o.yawn > 0 ? { q: turn(0, 0.5 * o.yawn) } : null;
  // The hind flippers rest a little open, and close and open slowly.
  const fan = 0.08 * Math.sin(t * 0.7);
  m[B.hindL] = { q: turn(0.12 + fan, 0) };
  m[B.hindR] = { q: turn(-0.12 - fan, 0) };
  if (o.scratch >= 0) {
    // A fore flipper lifts to the belly and rubs.
    const up = Math.sin(Math.PI * o.scratch), rub = Math.sin(TAU * M.scratch.hz * o.scratch * M.scratch.s);
    m[B.foreL] = { q: turn(0.3 * up, 0.25 * rub * up, -1.0 * up) };
  }
  if ((o.wave ?? -1) >= 0) {
    const w = o.wave ?? 0, up = Math.sin(Math.PI * w);
    m[B.foreR] = { q: turn(0, 0.2 * Math.sin(TAU * 3 * w) * up, 1.1 * up + 0.3 * Math.sin(TAU * 2 * w) * up) };
  }
  breathe(m, t, o.pup ? M.breathe.pupS : M.breathe.s, M.breathe.chest * (o.pup ? 1.4 : 1));
  return m;
}

/**
 * Humping along the ground: the middle arches up as the chest reaches down, then the chest lifts
 * forward as the back follows, the fore flippers pushing back under it. phase: humps so far.
 * @param {any} M @param {number} phase @param {number} t
 */
export function humpMoves(M, phase, t) {
  const m = still(), H = M.hump, a = Math.sin(TAU * phase), c = Math.cos(TAU * phase);
  m[B.root] = { t: [0, H.lift * Math.max(0, a), 0] };
  m[B.lumbar] = { q: turn(0, -H.lumbar * a) };
  m[B.tail] = { q: turn(0, -H.lumbar * 0.5 * a) };
  m[B.chest] = { q: turn(0, H.chest * a) };
  // The head is held steadier than the chest under it, looking ahead.
  m[B.neck] = { q: turn(0, -H.chest * 0.7 * a + 0.15) };
  m[B.foreL] = { q: turn(H.fore * 0.6 * c, 0, -0.2) };
  m[B.foreR] = { q: turn(-H.fore * 0.6 * c, 0, 0.2) };
  m[B.hindL] = { q: turn(0.05, 0.1 * a) };
  m[B.hindR] = { q: turn(-0.05, 0.1 * a) };
  breathe(m, t, M.breathe.s * 0.6, M.breathe.chest);
  return m;
}

/**
 * Swimming level under the surface: the hind flippers and tail sweep side to side and the back
 * follows a little behind, the fore flippers held back along the body, the head lowered in line.
 * @param {any} M @param {number} phase strokes so far @param {number} [bank] a turn's lean, radians
 */
export function swimMoves(M, phase, bank = 0) {
  const m = still(), S = M.swim, a = Math.sin(TAU * phase);
  m[B.root] = { q: turn(0, 0, bank) };
  m[B.lumbar] = { q: turn(S.lumbar * Math.sin(TAU * phase - 0.8), 0.1) };
  m[B.tail] = { q: turn(S.tail * a, 0) };
  m[B.hindL] = { q: turn(0.25 * a - 0.05, 0) };
  m[B.hindR] = { q: turn(0.25 * a + 0.05, 0) };
  m[B.neck] = { q: turn(0, 0.55) };
  m[B.head] = { q: turn(0, 0.35) };
  m[B.foreL] = { q: turn(S.fore, 0, 0.2) };
  m[B.foreR] = { q: turn(-S.fore, 0, -0.2) };
  return m;
}

/**
 * Bottling: upright in the water, head out, bobbing; the head turns to look (yaw), the fore
 * flippers scull slowly and the hind flippers hang. @param {any} M @param {number} t @param {number} lookYaw
 */
export function bottleMoves(M, t, lookYaw) {
  const m = still(), Bt = M.bottle;
  const sway = Math.sin(t * 0.9) * 0.05;
  m[B.root] = { q: turn(0, -Bt.pitch, sway) };
  m[B.lumbar] = { q: turn(0.08 * Math.sin(t * 0.6), 0.15) };
  m[B.tail] = { q: turn(0.1 * Math.sin(t * 0.6 - 0.5), 0.1) };
  // Level the head: the body stands up, so the neck bends it forward again.
  m[B.neck] = { q: turn(lookYaw * Bt.look * 0.6, Bt.pitch * 0.55) };
  m[B.head] = { q: turn(lookYaw * Bt.look * 0.4, Bt.pitch * 0.25) };
  const scull = Math.sin(t * 2.1) * 0.35;
  m[B.foreL] = { q: turn(scull, 0, -0.4) };
  m[B.foreR] = { q: turn(-scull, 0, 0.4) };
  breathe(m, t, M.breathe.s, M.breathe.chest);
  return m;
}

/** The bob of a bottling seal's height (m) at time t. @param {any} M @param {number} t */
export const bottleBob = (M, t) => M.bottle.bobM * Math.sin((TAU * t) / M.bottle.bobS);

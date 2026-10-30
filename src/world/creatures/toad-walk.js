// @ts-check
// The common toad's walk (doc 13; the creature rigging rule): a toad wears the frog's rig with its
// own proportions (rigs/frog.js; recipes/species/toad.json) and walks, never hops: a slow crawl on
// diagonal pairs of legs (front left with hind right, then the others), body low. Each hind foot is
// set down and stays put on the ground while the body passes over it, then lifts and swings forward
// (two-bone IK, motion.js); the front legs swing and lift with them; the body rolls a little from
// side to side and the head sways against it. Its stride follows the ground it covers (the phase is
// distance walked over the stride), so the feet never slide. Sitting, it breathes, pulses its
// throat and blinks (pose.js idleMoves). Pure; live animation only.

import { idleMoves } from './pose.js';
import { twoBoneIK, qaxis, qmul } from './motion.js';

/** @typedef {import('./pose.js').BoneMove} BoneMove */

const DEG = Math.PI / 180;

/**
 * The toad's walk phase from the ground it has covered. @param {number} walkedM world meters
 * @param {any} M toad.json motion @param {number} displayScale
 */
export const toadPhase = (walkedM, M, displayScale) => walkedM / (M.walk.strideM * displayScale);

/**
 * Bone moves for a toad this frame.
 * @param {{ name: string, parent: number, pivot: number[] }[]} skeleton
 * @param {ReturnType<typeof import('./motion.js').legsOf>} legs
 * @param {{ id: number, ph: number, walking: number }} a ph: walk phase in strides; walking: 0..1 how much it walks
 * @param {number} t animation seconds @param {any} M toad.json motion
 * @returns {(BoneMove | null)[]}
 */
export function toadMoves(skeleton, legs, a, t, M) {
  const moves = idleMoves(skeleton, t, a.id, M);
  const at = (/** @type {string} */ n) => skeleton.findIndex((b) => b.name === n);
  const W = M.walk, k = a.walking, p = a.ph % 1;
  const torso = at('torso');
  // The body: low; rolling with each pair of legs, a small bob as each pair pushes.
  const roll = Math.sin(p * Math.PI * 2) * W.rollDeg * DEG * k;
  const bob = (Math.abs(Math.sin(p * Math.PI * 2)) * W.bobM - W.crouchM) * k;
  const breath = moves[torso]?.s ?? [1, 1, 1];
  moves[torso] = { q: qaxis([0, 0, 1], roll), t: [0, bob, 0], s: breath };
  const head = at('head');
  if (head >= 0) moves[head] = { q: qaxis([0, 1, 0], -Math.sin(p * Math.PI * 2) * W.headSwayDeg * DEG * k) };
  if (k < 1e-3) return moves;
  // Each leg's own phase: front left and hind right together, then front right and hind left.
  // A planted foot goes back past the body as far as the body goes in its stance (stance of a
  // stride), so it stays put on the ground; the step swings it forward as far again.
  const sweep = W.strideM * W.stance;
  /** @param {number} off @returns {{ dz: number, lift: number }} where the foot is along its sweep (body m) and how high */
  const step = (off) => {
    const s = (p + off) % 1;
    if (s < W.stance) return { dz: sweep * (0.5 - s / W.stance), lift: 0 };
    const e = (s - W.stance) / (1 - W.stance);
    return { dz: sweep * (-0.5 + e), lift: Math.sin(e * Math.PI) };
  };
  for (const L of legs) {
    // Hind foot: planted, then lifted and swung forward, by IK from hip to ankle.
    const hind = step(L.side === 'l' ? 0.5 : 0);
    const T = [L.A[0], L.A[1] + hind.lift * W.footLiftM * k, L.A[2] + hind.dz * k];
    const ik = twoBoneIK(L.H, L.K, L.A, T);
    moves[L.thigh] = { q: ik.q1 };
    moves[L.shank] = { q: ik.q2 };
    // Front leg: swung back through its stance and forward lifted (a turn about x; + is back).
    const front = step(L.side === 'l' ? 0 : 0.5);
    const swing = (-front.dz / (sweep * 0.5)) * W.armSwingDeg * DEG * k * 0.5;
    if (L.arm >= 0) moves[L.arm] = { q: qmul(qaxis([1, 0, 0], swing), qaxis([0, 0, 1], L.sign * front.lift * W.armLiftDeg * DEG * k)) };
    const fore = at(`forearm.${L.side}`);
    if (fore >= 0) moves[fore] = { q: qaxis([1, 0, 0], -front.lift * W.armLiftDeg * DEG * 0.8 * k) };
  }
  return moves;
}

/**
 * Bone moves for a toad asleep in the winter ground (docs/future/13 10.6.8, B1 D1): sunk low and
 * tucked tight, its hind feet drawn in under it by IK and its arms folded close, the head bowed and
 * the eyes drawn shut; it breathes slowly (the breath at motion.sleep.slow of its pace) and never
 * blinks. Pure. @param {{ name: string, parent: number, pivot: number[] }[]} skeleton
 * @param {ReturnType<typeof import('./motion.js').legsOf>} legs @param {number} id
 * @param {number} t animation seconds @param {any} M toad.json motion
 * @returns {(BoneMove | null)[]}
 */
export function toadSleepMoves(skeleton, legs, id, t, M) {
  const S = M.sleep;
  const moves = idleMoves(skeleton, t * S.slow, id, { ...M, blink: { ...M.blink, s: 0 } });
  const at = (/** @type {string} */ n) => skeleton.findIndex((b) => b.name === n);
  const torso = at('torso');
  if (torso >= 0) moves[torso] = { t: [0, -S.sinkM, 0], s: moves[torso]?.s ?? [1, 1, 1] };
  const head = at('head');
  if (head >= 0) moves[head] = { q: qaxis([1, 0, 0], S.headDeg * DEG) };
  for (const eye of ['eye.l', 'eye.r']) { const i = at(eye); if (i >= 0) moves[i] = { s: [1, S.eyeShut, 1], t: [0, -M.blink.retractM, 0] }; }
  for (const L of legs) {
    // The hind foot drawn in toward the body and forward, under the flank.
    const T = [L.A[0] * (1 - S.tuck), L.A[1], L.A[2] + S.tuckM];
    const ik = twoBoneIK(L.H, L.K, L.A, T);
    moves[L.thigh] = { q: ik.q1 };
    moves[L.shank] = { q: ik.q2 };
    if (L.arm >= 0) moves[L.arm] = { q: qmul(qaxis([1, 0, 0], S.armDeg * DEG), qaxis([0, 0, 1], -L.sign * S.armInDeg * DEG)) };
  }
  return moves;
}

// @ts-check
// Frog motion (S6b-2, docs 11, 12): turns what a frog is doing (an agent from agents.js) into bone
// moves for pose.js. The hind legs reach out in a hop and fold back by two-bone IK (hip, knee,
// ankle, read from the skeleton), the body pitches nose up as it leaves and nose down as it lands,
// a spring squashes it on landing, the throat sac swells for a call, the legs kick in the water,
// and the eyes blink. Values from Matt's pond tier 1 prototype (recipes/species/frog.json motion).
// Live animation only; plain Math is fine.

import { idleMoves } from './pose.js';

/** @typedef {import('./pose.js').BoneMove} BoneMove */
/** @typedef {number[]} V3 @typedef {number[]} Q */

const sub = (/** @type {V3} */ a, /** @type {V3} */ b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (/** @type {V3} */ a, /** @type {V3} */ b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (/** @type {V3} */ a, /** @type {number} */ s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (/** @type {V3} */ a, /** @type {V3} */ b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (/** @type {V3} */ a) => Math.hypot(a[0], a[1], a[2]);
const norm = (/** @type {V3} */ a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (/** @type {V3} */ a, /** @type {V3} */ b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ t) => a + (b - a) * t;

/** Quaternion product a * b. @param {Q} a @param {Q} b @returns {Q} */
export function qmul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
/** @param {Q} q @returns {Q} */
const qconj = (q) => [-q[0], -q[1], -q[2], q[3]];
/** Rotate v by q. @param {Q} q @param {V3} v @returns {V3} */
export function qrot(q, v) {
  const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), qconj(q));
  return [p[0], p[1], p[2]];
}
/** The shortest turn taking direction a to direction b. @param {V3} a @param {V3} b @returns {Q} */
export function qfromTo(a, b) {
  const u = norm(a), v = norm(b);
  const c = dot(u, v);
  if (c < -0.999999) {
    const axis = norm(Math.abs(u[0]) < 0.9 ? cross(u, [1, 0, 0]) : cross(u, [0, 1, 0]));
    return [axis[0], axis[1], axis[2], 0];
  }
  const w = cross(u, v);
  const q = [w[0], w[1], w[2], 1 + c];
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
/** A turn of angle a (radians) about an axis. @param {V3} axis @param {number} a @returns {Q} */
export const qaxis = (axis, a) => { const s = Math.sin(a / 2); const n = norm(axis); return [n[0] * s, n[1] * s, n[2] * s, Math.cos(a / 2)]; };

/**
 * Two-bone IK: turns for the upper and lower bone so the end (ankle) reaches target T, the knee
 * bending toward where it rests. H hip, K knee, A ankle in rest body space. The lower turn is in
 * the upper bone's frame, as pose.js composes it.
 * @param {V3} H @param {V3} K @param {V3} A @param {V3} T
 * @returns {{ q1: Q, q2: Q, knee: V3 }}
 */
export function twoBoneIK(H, K, A, T) {
  const l1 = len(sub(K, H)), l2 = len(sub(A, K));
  const toT = sub(T, H);
  const a = Math.min(l1 + l2 - 1e-6, Math.max(Math.abs(l1 - l2) + 1e-6, len(toT)));
  const dir = norm(toT);
  // The knee's side: the rest knee's offset off the hip-to-target line.
  const kr = sub(K, H);
  let pole = sub(kr, scl(dir, dot(kr, dir)));
  if (len(pole) < 1e-9) pole = [0, 1, 0];
  pole = norm(pole);
  const cosA = Math.min(1, Math.max(-1, (l1 * l1 + a * a - l2 * l2) / (2 * l1 * a)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  const knee = add(H, scl(add(scl(dir, cosA), scl(pole, sinA)), l1));
  const q1 = qfromTo(kr, sub(knee, H));
  const reach = add(H, scl(dir, a));
  const qw = qfromTo(qrot(q1, sub(A, K)), sub(reach, knee));
  const q2 = qmul(qmul(qconj(q1), qw), q1);
  return { q1, q2, knee };
}

/**
 * The legs' rest geometry, read once from a skeleton and its rest foot tips.
 * @param {{ name: string, parent: number, pivot: number[] }[]} skeleton
 * @param {Record<string, number[]>} tips foot tips by side ('l', 'r'), body space
 */
export function legsOf(skeleton, tips) {
  const at = (/** @type {string} */ n) => skeleton.findIndex((b) => b.name === n);
  return ['l', 'r'].map((side) => ({
    side, sign: side === 'l' ? 1 : -1,
    thigh: at(`thigh.${side}`), shank: at(`shank.${side}`), foot: at(`foot.${side}`), arm: at(`arm.${side}`),
    H: skeleton[at(`thigh.${side}`)].pivot, K: skeleton[at(`shank.${side}`)].pivot, A: skeleton[at(`foot.${side}`)].pivot, tip: tips[side],
  }));
}

/**
 * How far the hind legs reach out at a hop's phase t (0 take-off, 1 landing): out fast, held
 * through the flight, folded back before landing.
 * @param {number} t
 */
export function hopReach(t) {
  if (t <= 0 || t >= 1) return 0;
  if (t < 0.15) return t / 0.15;
  if (t < 0.6) return 1;
  return 1 - (t - 0.6) / 0.4;
}

/**
 * Bone moves for a frog this frame.
 * @param {{ name: string, parent: number, pivot: number[] }[]} skeleton
 * @param {ReturnType<typeof legsOf>} legs
 * @param {{ id: number, hopT: number, kick: number, sq: number, sac: number, swimming: boolean }} a
 *   hopT: hop phase 0..1 (or -1); kick: swim kick phase 0..1 (or -1); sq: squash spring value; sac: sac inflation 0..1.3
 * @param {number} t animation seconds @param {any} M recipes/species/frog.json motion
 * @returns {(BoneMove | null)[]}
 */
export function frogMoves(skeleton, legs, a, t, M) {
  const moves = idleMoves(skeleton, t, a.id, M);
  const at = (/** @type {string} */ n) => skeleton.findIndex((b) => b.name === n);
  const torso = at('torso');
  // The body: pitched through the hop, squashed by the landing spring, breathing on top.
  /** @type {Q} */ let q = [0, 0, 0, 1];
  if (a.hopT >= 0) q = qaxis([1, 0, 0], lerp(-0.45, 0.3, a.hopT) * Math.sin(Math.PI * a.hopT));
  const breathS = moves[torso]?.s ?? [1, 1, 1];
  const sq = a.sq;
  moves[torso] = { q, s: [breathS[0] * (1 + 0.5 * sq), breathS[1] * (1 - sq), breathS[2] * (1 + 0.5 * sq)] };
  // The throat sac swells for a call (down and forward, about its top), on top of breathing.
  const throat = at('throat');
  if (throat >= 0 && a.sac > 0.001) {
    const i = a.sac * M.call.inflate;
    const b = moves[throat]?.s ?? [1, 1, 1];
    moves[throat] = { s: [b[0] * (1 + 0.8 * i), b[1] * (1 + i), b[2] * (1 + 0.9 * i)] };
  }
  // Hind legs: out in a hop or a kick, by IK; forelegs lift in the air.
  const reach = a.hopT >= 0 ? hopReach(a.hopT) : a.kick >= 0 ? Math.sin(Math.PI * a.kick) : a.swimming ? 0.55 : 0;
  if (reach > 0.001) {
    for (const L of legs) {
      const l = len(sub(L.K, L.H)) + len(sub(L.A, L.K));
      const out = norm([L.sign * 0.22, a.swimming ? -0.05 : -0.42, -1]);
      const T = add(L.A, scl(sub(add(L.H, scl(out, l * M.hop.reach)), L.A), reach));
      const ik = twoBoneIK(L.H, L.K, L.A, T);
      moves[L.thigh] = { q: ik.q1 };
      moves[L.shank] = { q: ik.q2 };
      // The foot straightens along the shank as the leg reaches.
      const shankW = qmul(ik.q1, ik.q2);
      const footDir = qrot(shankW, sub(L.tip, L.A));
      const along = norm(sub(T, ik.knee));
      const want = norm(add(scl(norm(footDir), 1 - reach), scl(along, reach)));
      const qw = qfromTo(footDir, want);
      moves[L.foot] = { q: qmul(qmul(qconj(shankW), qw), shankW) };
      if (a.hopT >= 0 && L.arm >= 0) moves[L.arm] = { q: qaxis([1, 0, 0], -M.hop.lift * reach) };
    }
  }
  return moves;
}

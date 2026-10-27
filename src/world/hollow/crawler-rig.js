// @ts-check
// The silt crawler's rig (H2, October 27, 2026; CLAUDE.md, the creature rule): how its 16 bones move
// for one pose. The bones and their rest pivots come from the model (crawler-model.js): a root about
// the hind hips (the whole crawler rears and dives about it), the body on it (breathing, the plate's
// bob, a glance's recoil, a flinch), two eye stalks on the body, four legs of a hip and a knee each, and
// a tail of four bones. Each leg reaches its foot's target by two-bone IK: the knee bends up and out
// (as a crab's), so its straight tube curves across the knee's blended weights. The tail and the
// stalks take a turn and a tilt each. Pure: the pose comes in (crawler-motion.js works it out), bone
// matrices go out (pose.js poseSkeleton), for the crawler pass to skin with.

import { axisAngle, poseSkeleton } from '../creatures/pose.js';

export const LEGS = /** @type {const} */ (['fl', 'fr', 'hl', 'hr']);

/**
 * One pose. Angles in radians, lengths in metres, model space (Y up, facing +z).
 * @typedef {{
 *   root: { up: number, roll: number, lift: number, fwd: number },
 *   body: { up: number, roll: number, turn: number, bob: number, breath: number, squash: number },
 *   feet: Record<'fl' | 'fr' | 'hl' | 'hr', number[]>,
 *   tail: number[][], stalks: Record<'l' | 'r', number[]>,
 * }} CrawlerPose root.up: the front raised (rearing), negative dives; feet: each foot's middle, where
 *   it should be; tail: [turn, tilt] a bone, root end first (tilt raises it); stalks: [turn, tilt] each
 *   (tilt leans it forward)
 */

/** q * p (p first, then q). @param {number[]} q @param {number[]} p */
export function qmul(q, p) {
  return [
    q[3] * p[0] + q[0] * p[3] + q[1] * p[2] - q[2] * p[1],
    q[3] * p[1] - q[0] * p[2] + q[1] * p[3] + q[2] * p[0],
    q[3] * p[2] + q[0] * p[1] - q[1] * p[0] + q[2] * p[3],
    q[3] * p[3] - q[0] * p[0] - q[1] * p[1] - q[2] * p[2],
  ];
}
/** @param {number[]} q */
const conj = (q) => [-q[0], -q[1], -q[2], q[3]];
/** v turned by q. @param {number[]} q @param {number[]} v */
export function rot(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
const sub = (/** @type {number[]} */ a, /** @type {number[]} */ b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (/** @type {number[]} */ a, /** @type {number[]} */ b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (/** @type {number[]} */ a, /** @type {number} */ s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (/** @type {number[]} */ a, /** @type {number[]} */ b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (/** @type {number[]} */ a) => Math.hypot(a[0], a[1], a[2]);
const unit = (/** @type {number[]} */ a) => scale(a, 1 / (len(a) || 1));
const cross = (/** @type {number[]} */ a, /** @type {number[]} */ b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The shortest turn taking unit a onto unit b. @param {number[]} a @param {number[]} b */
export function fromTo(a, b) {
  const c = cross(a, b), d = dot(a, b);
  if (d < -0.9999) return axisAngle(unit(Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0])), Math.PI);
  const q = [c[0], c[1], c[2], 1 + d];
  const l = Math.hypot(...q);
  return q.map((v) => v / l);
}

/** The root's turn: the front raised by up (about +x, the crawler's left), rolled by roll. @param {CrawlerPose['root']} r */
export const rootTurn = (r) => qmul(axisAngle([0, 0, 1], r.roll), axisAngle([1, 0, 0], -r.up));

/**
 * Where a rest point lands once the root has moved (model space). @param {import('./crawler-model.js').CrawlerModel} model
 * @param {CrawlerPose['root']} r @param {number[]} p
 */
export function underRoot(model, r, p) {
  const piv = model.skeleton[0].pivot;
  return add(add(rot(rootTurn(r), sub(p, piv)), piv), [0, r.lift, r.fwd]);
}

/** Bone indices by name, per skeleton. @type {WeakMap<object, Record<string, number>>} */
const INDEX = new WeakMap();

/**
 * The bone matrices for one pose, MAX_BONES (16) of 16 floats, written into out from offset.
 * Returns where each foot ended up (model space), for checks. @param {import('./crawler-model.js').CrawlerModel} model
 * @param {CrawlerPose} pose @param {Float32Array} out @param {number} [offset]
 */
export function poseCrawler(model, pose, out, offset = 0) {
  const sk = model.skeleton;
  let at = INDEX.get(sk);
  if (!at) { at = {}; sk.forEach((b, i) => { /** @type {Record<string, number>} */ (at)[b.name] = i; }); INDEX.set(sk, at); }
  const moves = sk.map(() => /** @type {import('../creatures/pose.js').BoneMove | null} */ (null));
  const r = pose.root, qr = rootTurn(r);
  moves[at.root] = { q: qr, t: [0, r.lift, r.fwd] };
  // The body: breathing (wider and taller), squashed by a flinch, the plate's bob and recoil about its middle.
  const b = pose.body, sw = 1 + b.breath, sy = (1 + b.breath * 0.7) * (1 - b.squash), sx = sw * (1 + b.squash * 0.5);
  moves[at.body] = { q: qmul(axisAngle([0, 1, 0], b.turn), qmul(axisAngle([0, 0, 1], b.roll), axisAngle([1, 0, 0], -b.up))), s: [sx, sy, sw], t: [0, b.bob, 0] };
  for (const s of /** @type {const} */ (['l', 'r'])) {
    const [turn, tilt] = pose.stalks[s];
    moves[at[`stalk.${s}`]] = { q: qmul(axisAngle([0, 1, 0], turn), axisAngle([1, 0, 0], tilt)) };
  }
  pose.tail.forEach(([turn, tilt], i) => { moves[at[`tail.${i}`]] = { q: qmul(axisAngle([0, 1, 0], turn), axisAngle([1, 0, 0], tilt)) }; });
  /** @type {Record<string, number[]>} */ const reached = {};
  for (const leg of LEGS) {
    const L = model.legs[leg], target = pose.feet[leg];
    const H = underRoot(model, r, L.hip);
    const l1 = len(sub(L.knee, L.hip)), l2 = len(sub(L.foot, L.knee));
    const d = sub(target, H), dist = Math.min(Math.max(len(d), Math.abs(l1 - l2) + 1e-4, (l1 + l2) * 0.25), (l1 + l2) * 0.9995);
    const u = unit(d);
    // The knee bends toward up and out: the pole, made square to the hip-to-foot line.
    const out0 = sub(L.foot, L.hip);
    const pole0 = unit([out0[0] * 0.6, Math.hypot(out0[0], out0[2]) * 1.2, out0[2] * 0.6]);
    const pole = unit(sub(pole0, scale(u, dot(pole0, u))));
    const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const K = add(H, add(scale(u, a), scale(pole, h)));
    const qh = fromTo(unit(sub(L.knee, L.hip)), unit(sub(K, H)));
    const lower = rot(qh, unit(sub(L.foot, L.knee)));
    const qk = qmul(fromTo(lower, unit(sub(add(H, scale(u, dist)), K))), qh);
    moves[at[`hip.${leg}`]] = { q: qmul(conj(qr), qh) };
    moves[at[`knee.${leg}`]] = { q: qmul(conj(qh), qk) };
    reached[leg] = add(K, rot(qk, sub(L.foot, L.knee)));
  }
  poseSkeleton(sk, moves, out, offset);
  return reached;
}

/** A still pose: standing on its feet where they belong, everything at rest. @param {import('./crawler-model.js').CrawlerModel} model */
export function restPose(model) {
  return /** @type {CrawlerPose} */ ({
    root: { up: 0, roll: 0, lift: 0, fwd: 0 },
    body: { up: 0, roll: 0, turn: 0, bob: 0, breath: 0, squash: 0 },
    feet: Object.fromEntries(LEGS.map((l) => [l, model.legs[l].foot.slice()])),
    tail: [[0, 0], [0, 0], [0, 0], [0, 0]], stalks: { l: [0, 0], r: [0, 0] },
  });
}

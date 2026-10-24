// @ts-check
// The walker's short acts (keeper's camp, docs/future/13-keepers-camp.md 2.3): drink, pitch, lay,
// strike (the fire steel), crawlIn and climbOut. Each is a track of keys in recipes/world/figure.json
// poses: at t seconds in, how far into the kneel and the crawl, extra lean, head pitch and hip drop,
// and where each hand reaches (body meters, y over the ground under you). A key changes only what it
// names; the rest carries on from the key before. Between keys the pose eases (smoothstep), so
// nothing snaps; motion.js blends the result over the walk as it blends Feed.
// Gestures (walker gestures, part 3; October 24, 2026) are short tracks of the same keys in poses.gestures,
// one for each thing the walker does by hand (gather, set down, take up, lift, feed the fire, the net,
// getting up, I'm stuck, sow): they play over the walker's posture and never stop a walk or a tap, and a
// key may also turn the head (yaw, degrees to the left). A gesture with no keys yet (sow, until Phase 2) is
// a named hook: it plays nothing. Drawing only. Pure.

import { smooth, lerp } from './kinematics.js';

/** The acts there are. */
export const ACTS = ['drink', 'pitch', 'lay', 'strike', 'crawlIn', 'climbOut'];

/**
 * @typedef {Object} ActPose
 * @property {number} kneel @property {number} crawl  posture weights 0..1
 * @property {number} lean @property {number} head  extra degrees (forward, down)
 * @property {number} yaw  the head's extra turn (degrees, to the left)
 * @property {number} drop  the hips lower by this (body m)
 * @property {number} arms  how much the hands follow l and r, 0..1
 * @property {number[]} l @property {number[]} r  hand targets (body m, y over the ground under you)
 */

const START = { t: 0, kneel: 0, crawl: 0, lean: 0, head: 0, yaw: 0, drop: 0, arms: 0, l: [0.12, 0.5, 0.25], r: [-0.12, 0.5, 0.25] };
/** Keys with everything filled in from the key before. @type {WeakMap<object[], ActPose & { t: number }[]>} */
const resolved = new WeakMap();

/** @param {object[]} keys */
function fill(keys) {
  let k = resolved.get(keys);
  if (!k) {
    let prev = START;
    k = keys.map((key) => (prev = { ...prev, ...key }));
    resolved.set(keys, k);
  }
  return k;
}

/** How long an act lasts (s): its last key. 0 for a name that is not an act. @param {any} PO poses @param {string} name */
export function actLength(PO, name) {
  const keys = ACTS.includes(name) ? PO[name]?.keys : null;
  return keys?.length ? keys[keys.length - 1].t : 0;
}

/**
 * The act's pose u seconds in (held at its last key after the end).
 * @param {any} PO poses @param {string} name @param {number} u @returns {ActPose}
 */
export function actPose(PO, name, u) {
  return posed(PO[name].keys, u);
}

/** The gestures there are (named in the recipe, keys or not). @param {any} PO poses */
export const gestureNames = (PO) => Object.keys(PO.gestures ?? {}).filter((k) => k !== 'note');

/** How long a gesture lasts (s): its last key; 0 for a hook with no keys yet, or a name that is not one. @param {any} PO poses @param {string} name */
export function gestureLength(PO, name) {
  const keys = gestureNames(PO).includes(name) ? PO.gestures[name].keys : null;
  return keys?.length ? keys[keys.length - 1].t : 0;
}

/** A gesture's pose u seconds in. @param {any} PO poses @param {string} name @param {number} u @returns {ActPose} */
export function gesturePose(PO, name, u) {
  return posed(PO.gestures[name].keys, u);
}

/** A track of keys at u seconds. @param {object[]} keys @param {number} u @returns {ActPose} */
function posed(keys, u) {
  const k = fill(keys);
  let i = 0;
  while (i < k.length - 1 && k[i + 1].t <= u) i++;
  const a = k[i], b = k[Math.min(i + 1, k.length - 1)];
  const f = b.t > a.t ? smooth((u - a.t) / (b.t - a.t)) : 0;
  const mix = (/** @type {number} */ p, /** @type {number} */ q) => lerp(p, q, f);
  return {
    kneel: mix(a.kneel, b.kneel), crawl: mix(a.crawl, b.crawl), lean: mix(a.lean, b.lean), head: mix(a.head, b.head), yaw: mix(a.yaw, b.yaw),
    drop: mix(a.drop, b.drop), arms: mix(a.arms, b.arms),
    l: [0, 1, 2].map((j) => mix(a.l[j], b.l[j])), r: [0, 1, 2].map((j) => mix(a.r[j], b.r[j])),
  };
}

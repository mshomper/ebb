// @ts-check
// The small-bird rig (B3 R1): one skeleton of bone roles for every small bird drawn in code (the
// turnstone first, the purple sandpiper next, the teal where its proportions fit), its pivots read
// from a recipe's shape (recipes/birds/<id>.json, real metres, rest pose, head toward +z, feet on
// y = 0, the bird's left on +x), never from one mesh. Motion (bird-motion.js) is written against the
// roles, so a new bird is a new shape and plumage, not new code.
//
// The wing telescopes: folded, the arm panel lies under the hand panel along the flank; spread, the
// arm turns out from the shoulder (its flat face up) and the hand slides out along it to the wrist,
// so a wing as long as the bird's own body opens to a span twice that. The legs are two bones and
// the toes: a planar reach (legReach) puts each foot where the gait asks, so a foot on the ground
// stays put while the body passes over it.
// Pure: no DOM, no GPU.

/** @typedef {{ name: string, parent: number, pivot: number[] }} Bone */
/**
 * @typedef {{ hip: number[], ankle: number[], foot: number[], leg: number, shank: number, foot_: number, side: number }} LegRig
 * @typedef {{ shoulder: number[], wrist: number[], arm: number, hand: number, side: number, armM: number, handStraight: number, lean: number }} WingRig
 * @typedef {{ skeleton: Bone[], at: Record<string, number>, legs: LegRig[], wings: WingRig[] }} BirdRig
 */

/** The bone roles, parents first (MAX_BONES is 16; a bird uses 15). */
export const BIRD_ROLES = /** @type {const} */ (['root', 'body', 'neck', 'head', 'tail',
  'wing.l', 'hand.l', 'wing.r', 'hand.r', 'leg.l', 'shank.l', 'foot.l', 'leg.r', 'shank.r', 'foot.r']);

/** Each role's parent role. */
const PARENT = /** @type {Record<string, string | null>} */ ({ root: null, body: 'root', neck: 'body', head: 'neck', tail: 'body',
  'wing.l': 'body', 'hand.l': 'wing.l', 'wing.r': 'body', 'hand.r': 'wing.r',
  'leg.l': 'body', 'shank.l': 'leg.l', 'foot.l': 'shank.l', 'leg.r': 'body', 'shank.r': 'leg.r', 'foot.r': 'shank.r' });

/** The wrist sits this far behind the shoulder when folded (m). */
const WRIST_BACK_M = 0.004;

/** A point mirrored to the bird's right. @param {number[]} p @param {number} side */
export const sideOf = (p, side) => [p[0] * side, p[1], p[2]];

/**
 * The rig for a shape: every role's pivot and parent, and the legs and wings by side.
 * @param {any} S recipes/birds/<id>.json shape
 * @returns {BirdRig}
 */
export function birdRig(S) {
  const L = S.leg, W = S.wing;
  const hip = [0, L.hip[1], L.hip[2]];
  const tailBase = [0, S.tail.c[1], S.tail.c[2] + S.tail.r[2] * 0.8];
  const wrist = [W.shoulder[0], W.shoulder[1], W.shoulder[2] - WRIST_BACK_M];
  /** @type {Record<string, number[]>} */
  const pivot = { root: [0, 0, 0], body: hip, neck: S.neck.base.slice(), head: S.neck.top.slice(), tail: tailBase };
  for (const [s, side] of /** @type {const} */ ([['l', 1], ['r', -1]])) {
    pivot[`wing.${s}`] = sideOf(W.shoulder, side);
    pivot[`hand.${s}`] = sideOf(wrist, side);
    pivot[`leg.${s}`] = sideOf(L.hip, side);
    pivot[`shank.${s}`] = sideOf(L.ankle, side);
    pivot[`foot.${s}`] = sideOf(L.foot, side);
  }
  /** @type {Record<string, number>} */ const at = {};
  BIRD_ROLES.forEach((r, i) => { at[r] = i; });
  /** @type {Bone[]} */
  const skeleton = BIRD_ROLES.map((r) => ({ name: r, parent: PARENT[r] ? at[/** @type {string} */ (PARENT[r])] : -1, pivot: pivot[r] }));
  // The hand points a little in toward the tail when folded; spread, it turns by this much about
  // its own up so it carries straight on from the arm (sign for the left; the right mirrors).
  const tip = W.tip, dx = tip[0] - W.shoulder[0], dz = tip[2] - wrist[2];
  const handStraight = Math.atan(-dx / dz);
  const legs = /** @type {LegRig[]} */ ([['l', 1], ['r', -1]].map(([s, side]) => ({ hip: pivot[`leg.${s}`], ankle: pivot[`shank.${s}`], foot: pivot[`foot.${s}`],
    leg: at[`leg.${s}`], shank: at[`shank.${s}`], foot_: at[`foot.${s}`], side })));
  const wings = /** @type {WingRig[]} */ ([['l', 1], ['r', -1]].map(([s, side]) => ({ shoulder: pivot[`wing.${s}`], wrist: pivot[`hand.${s}`],
    arm: at[`wing.${s}`], hand: at[`hand.${s}`], side, armM: W.armM, handStraight, lean: ((W.leanDeg ?? 0) * Math.PI) / 180 })));
  return { skeleton, at, legs, wings };
}

/** The angle of a (z, y) vector in the side plane: 0 forward, pi/2 up. @param {number} y @param {number} z */
const ang = (y, z) => Math.atan2(y, z);

/**
 * A leg's reach in the side plane (y up, z forward): the turns about x for the leg (hip to ankle)
 * and the shank (ankle to foot), as world turns from rest, that put the foot's pivot at the target,
 * the ankle bending back as a bird's does. A target out of reach is met as near as the leg allows.
 * A turn about +x by a moves a (z, y) vector's angle by -a.
 * @param {number[]} hip the hip now (y, z used) @param {LegRig} L the leg at rest @param {number[]} target the foot pivot wanted (y, z used)
 * @returns {{ leg: number, shank: number, reached: boolean }}
 */
export function legReach(hip, L, target) {
  const a = Math.hypot(L.ankle[1] - L.hip[1], L.ankle[2] - L.hip[2]);
  const b = Math.hypot(L.foot[1] - L.ankle[1], L.foot[2] - L.ankle[2]);
  const ty = target[1] - hip[1], tz = target[2] - hip[2];
  const d0 = Math.hypot(ty, tz);
  const d = Math.min(a + b - 1e-6, Math.max(Math.abs(a - b) + 1e-6, d0));
  const toT = ang(ty, tz);
  // The hip's opening: the ankle sits behind the hip-to-foot line (a smaller angle when pointing down).
  const open = Math.acos(Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d))));
  const up = toT - open;
  const ay = Math.sin(up) * a, az = Math.cos(up) * a;
  const fy = Math.sin(toT) * d, fz = Math.cos(toT) * d;
  const low = ang(fy - ay, fz - az);
  const restUp = ang(L.ankle[1] - L.hip[1], L.ankle[2] - L.hip[2]);
  const restLow = ang(L.foot[1] - L.ankle[1], L.foot[2] - L.ankle[2]);
  return { leg: restUp - up, shank: restLow - low, reached: Math.abs(d - d0) < 1e-4 };
}

/** q = a * b (a after b), quaternions [x, y, z, w]. @param {number[]} a @param {number[]} b */
export function qmul(a, b) {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}

/** A turn of `angle` radians about x, y or z. @param {0 | 1 | 2} axis @param {number} angle */
export function qAxis(axis, angle) {
  const s = Math.sin(angle / 2), q = [0, 0, 0, Math.cos(angle / 2)];
  q[axis] = s;
  return q;
}

/** Turn a point by a quaternion. @param {number[]} q @param {number[]} v */
export function qRotate(q, v) {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}

/**
 * A wing's turn and the hand's slide for how far it is spread (0 folded, 1 open), how far it is
 * raised (radians, up positive), swept forward (radians) and how much the hand bends up behind the
 * arm (radians) and folds back (radians). Folded, the panels hang flat along the flank; open, the
 * arm's outer face turns up and its length points out from the body.
 * @param {WingRig} W @param {{ spread: number, up: number, sweep: number, handUp: number, handFold: number }} g
 * @returns {{ arm: { q: number[] }, hand: { q: number[], t: number[] } }}
 */
export function wingMoves(W, g) {
  const s = Math.max(0, Math.min(1, g.spread)), side = W.side, R = Math.PI / 2;
  // Roll the panel flat (outer face up), swing it out, then raise it about the body's long axis.
  // (The folded panels lean in by W.lean already, so the roll that lays them flat is that much less.)
  const arm = qmul(qAxis(2, side * g.up), qmul(qAxis(1, -side * (R * s + g.sweep * s)), qAxis(2, side * (R - W.lean) * s)));
  // The hand, in the arm's rest frame: straightened to carry on from the arm, bent up behind it
  // (about rest y, which the open arm turns into the long axis of the body) and folded back (rest x).
  const hand = qmul(qAxis(1, side * (W.handStraight * s - g.handUp * s)), qAxis(0, g.handFold * s));
  return { arm: { q: arm }, hand: { q: hand, t: [0, 0, -W.armM * s] } };
}

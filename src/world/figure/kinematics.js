// @ts-check
// The walker's small math (doc 23, W5): quaternions on top of the frogs' (creatures/motion.js), a
// two-bone IK with an explicit pole (the A-pose arm is straight, so its rest elbow cannot say which
// way to bend), and a damped spring for the parts that follow a beat late.
// Pure; plain Math (live animation, never saved).

import { qmul, qrot, qfromTo, qaxis } from '../creatures/motion.js';

export { qmul, qrot, qfromTo, qaxis };

/** @typedef {number[]} V3 @typedef {number[]} Q */

export const sub = (/** @type {V3} */ a, /** @type {V3} */ b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (/** @type {V3} */ a, /** @type {V3} */ b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scl = (/** @type {V3} */ a, /** @type {number} */ s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (/** @type {V3} */ a, /** @type {V3} */ b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (/** @type {V3} */ a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (/** @type {V3} */ a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const cross = (/** @type {V3} */ a, /** @type {V3} */ b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const lerp = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ t) => a + (b - a) * t;
export const smooth = (/** @type {number} */ u) => { const x = Math.min(1, Math.max(0, u)); return x * x * (3 - 2 * x); };
export const DEG = Math.PI / 180;
export const QI = /** @type {Q} */ ([0, 0, 0, 1]);

/** @param {Q} q @returns {Q} */
export const qconj = (q) => [-q[0], -q[1], -q[2], q[3]];

/** Shortest-path spherical blend. @param {Q} a @param {Q} b @param {number} t @returns {Q} */
export function qslerp(a, b, t) {
  let c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = c < 0 ? -1 : 1;
  c *= s;
  if (c > 0.9995) {
    const q = [0, 1, 2, 3].map((i) => a[i] + (b[i] * s - a[i]) * t);
    const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return q.map((x) => x / l);
  }
  const th = Math.acos(c), sn = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / sn, wb = (Math.sin(t * th) / sn) * s;
  return [0, 1, 2, 3].map((i) => a[i] * wa + b[i] * wb);
}

/** Rotation part of a column-major 4x4 as a quaternion. @param {ArrayLike<number>} m @param {number} [o] @returns {Q} */
export function matQuat(m, o = 0) {
  const m00 = m[o], m11 = m[o + 5], m22 = m[o + 10];
  const tr = m00 + m11 + m22;
  let q;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m[o + 6] - m[o + 9]) / s, (m[o + 8] - m[o + 2]) / s, (m[o + 1] - m[o + 4]) / s, s / 4];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [s / 4, (m[o + 4] + m[o + 1]) / s, (m[o + 8] + m[o + 2]) / s, (m[o + 6] - m[o + 9]) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m[o + 4] + m[o + 1]) / s, s / 4, (m[o + 9] + m[o + 6]) / s, (m[o + 8] - m[o + 2]) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m[o + 8] + m[o + 2]) / s, (m[o + 9] + m[o + 6]) / s, s / 4, (m[o + 1] - m[o + 4]) / s];
  }
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return q.map((x) => x / l);
}

/** A point through a column-major 4x4. @param {ArrayLike<number>} m @param {number} o @param {V3} p @returns {V3} */
export function matPoint(m, o, p) {
  return [m[o] * p[0] + m[o + 4] * p[1] + m[o + 8] * p[2] + m[o + 12],
    m[o + 1] * p[0] + m[o + 5] * p[1] + m[o + 9] * p[2] + m[o + 13],
    m[o + 2] * p[0] + m[o + 6] * p[1] + m[o + 10] * p[2] + m[o + 14]];
}

/** A point through the inverse of a rigid column-major 4x4. @param {ArrayLike<number>} m @param {number} o @param {V3} p @returns {V3} */
export function matPointInv(m, o, p) {
  const d = [p[0] - m[o + 12], p[1] - m[o + 13], p[2] - m[o + 14]];
  return [m[o] * d[0] + m[o + 1] * d[1] + m[o + 2] * d[2],
    m[o + 4] * d[0] + m[o + 5] * d[1] + m[o + 6] * d[2],
    m[o + 8] * d[0] + m[o + 9] * d[1] + m[o + 10] * d[2]];
}

/**
 * Two-bone IK in one frame: turns for the upper and lower bone so the end reaches T, bending toward
 * the pole. H, K, A: root, joint and end at rest. The lower turn is in the upper bone's frame, as
 * pose.js composes it (rest-pose axes).
 * @param {V3} H @param {V3} K @param {V3} A @param {V3} T @param {V3} pole a direction the joint bends toward
 * @returns {{ q1: Q, q2: Q, joint: V3, reach: V3 }}
 */
export function twoBone(H, K, A, T, pole) {
  const l1 = len(sub(K, H)), l2 = len(sub(A, K));
  const toT = sub(T, H);
  const d = Math.min(l1 + l2 - 1e-5, Math.max(Math.abs(l1 - l2) + 1e-5, len(toT)));
  const dir = norm(toT);
  let p = sub(pole, scl(dir, dot(pole, dir)));
  if (len(p) < 1e-6) p = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
  p = norm(p);
  const cosA = Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  const joint = add(H, scl(add(scl(dir, cosA), scl(p, sinA)), l1));
  const q1 = qfromTo(sub(K, H), sub(joint, H));
  const reach = add(H, scl(dir, d));
  // The lower bone: its rest direction carried by q1, turned onto the joint-to-reach line, expressed in the upper bone's frame.
  const qw = qfromTo(qrot(q1, sub(A, K)), sub(reach, joint));
  const q2 = qmul(qmul(qconj(q1), qw), q1);
  return { q1, q2, joint, reach };
}

/** A damped spring on a few numbers: x follows the target with stiffness k (1/s^2) and damping as a share of critical. */
export class Spring {
  /** @param {number} n how many numbers @param {{ stiffness: number, damping: number }} o */
  constructor(n, o) {
    this.x = new Float64Array(n);
    this.v = new Float64Array(n);
    this.k = o.stiffness;
    this.c = 2 * Math.sqrt(o.stiffness) * o.damping;
  }

  /** @param {number[]} target @param {number} dt seconds */
  step(target, dt) {
    // Small sub-steps keep a stiff spring steady at a low frame rate.
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let s = 0; s < n; s++) {
      for (let i = 0; i < this.x.length; i++) {
        const a = this.k * (target[i] - this.x[i]) - this.c * this.v[i];
        this.v[i] += a * h;
        this.x[i] += this.v[i] * h;
      }
    }
    return this.x;
  }
}

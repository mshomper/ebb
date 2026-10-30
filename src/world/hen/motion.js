// @ts-check
// The hen's code clips (docs/future/15, slice 1): her pose from what she is doing, on the bones
// rig.js kept, over the file's own Idle. Every turn is about a bone's pivot in the rest pose's
// space (x her left, y up, z forward), as pose.js composes them. The walk and run are timed to
// distance (phase: strides travelled), so her feet move with the ground; the head lock holds her
// head still in the world while she walks, then jumps it forward (life.js keeps the offset). Settled
// (slice 2: by the fire at dusk, beside the walker), her legs fold under her and she sinks onto them.
// Live animation only (never saved); plain Math is fine here.

import { axisAngle, poseSkeleton } from '../creatures/pose.js';
import { qmul, qrot, qslerp, QI, smooth } from '../figure/kinematics.js';

/** @typedef {import('../creatures/pose.js').BoneMove} BoneMove */

/**
 * What she is doing this frame, as the clips need it (life.js poseInput).
 * @typedef {Object} HenPose
 * @property {number} t          seconds of animation time (the Idle clip's clock)
 * @property {number} phase      strides travelled (signed: a step back runs it backward)
 * @property {number} walk       0 still .. 1 walking (how much the legs swing)
 * @property {number} run        0 walking .. 1 running
 * @property {{ side: 'l' | 'r', u: number } | null} kick   a scratch kick, u 0..1 through it
 * @property {number} peck       0 .. 1 down
 * @property {{ yaw: number, tilt: number, down: number }} look   radians: turn, one eye to the ground, nod
 * @property {number} alert      0 .. 1 upright and still
 * @property {number} lockM      the head lock: the head's shift forward from where the body carries it (rest m)
 * @property {number} [settle]   0 .. 1 settled down, legs folded under her (by the fire, slice 2)
 */

const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
const TAU = Math.PI * 2;
const frac = (/** @type {number} */ x) => x - Math.floor(x);

/**
 * @param {{ name: string, parent: number, pivot: number[] }[]} skeleton rig.js's kept bones
 * @param {any} M recipes/species/hen.json motion
 * @param {import('./rig.js').IdleClip | null} idle
 */
export function createHenPoser(skeleton, M, idle) {
  const at = (/** @type {string} */ n) => skeleton.findIndex((b) => b.name === n);
  const B = {
    root: at('root'), chest: at('chest'), n0: at('neck.0'), n1: at('neck.1'), n2: at('neck.2'), head: at('head'), tail: at('tail'), tip: at('tail.tip'),
    l: { hip: at('hip.l'), knee: at('knee.l'), ankle: at('ankle.l'), toes: at('toes.l') },
    r: { hip: at('hip.r'), knee: at('knee.r'), ankle: at('ankle.r'), toes: at('toes.r') },
  };
  const n = skeleton.length;
  // The neck's line at rest, from its base to the head.
  const neckDir = (() => {
    const a = skeleton[B.n0]?.pivot ?? [0, 0, 0], b = skeleton[B.head]?.pivot ?? [0, 1, 0];
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(d[0], d[1], d[2]) || 1;
    return d.map((v) => v / l);
  })();

  /** The Idle clip's move for bone i at time t, eased in by w (0: still). @param {number} i @param {number} t @param {number} w */
  function idleMove(i, t, w) {
    if (!idle || w <= 0) return null;
    const f = frac(t * idle.fps / idle.frames) * idle.frames;
    const a = Math.floor(f) % idle.frames, b = (a + 1) % idle.frames, u = f - Math.floor(f);
    const A = idle.data.subarray((a * n + i) * 7, (a * n + i) * 7 + 7), C = idle.data.subarray((b * n + i) * 7, (b * n + i) * 7 + 7);
    const q = qslerp(QI, qslerp([A[0], A[1], A[2], A[3]], [C[0], C[1], C[2], C[3]], u), w);
    return { q, t: [0, 1, 2].map((k) => (A[4 + k] + (C[4 + k] - A[4 + k]) * u) * w) };
  }

  /**
   * Every bone's move this frame.
   * @param {HenPose} s @returns {(BoneMove | null)[]}
   */
  function moves(s) {
    /** @type {{ q: number[], t: number[] }[]} */ const code = skeleton.map(() => ({ q: QI, t: [0, 0, 0] }));
    const turn = (/** @type {number} */ i, /** @type {number[]} */ axis, /** @type {number} */ a) => { if (i >= 0 && a) code[i].q = qmul(axisAngle(axis, a), code[i].q); };
    const shift = (/** @type {number} */ i, /** @type {number[]} */ d) => { if (i >= 0) code[i].t = code[i].t.map((v, k) => v + d[k]); };
    const walk = Math.min(1, Math.max(0, s.walk)), run = Math.min(1, Math.max(0, s.run));
    const p = Math.min(1, Math.max(0, s.peck));
    const st = smooth(Math.min(1, Math.max(0, s.settle ?? 0)));
    // The body's tip forward: into a run, a kick or a peck (a hen tips her whole body to reach the
    // ground), back upright when alert.
    const kickLean = s.kick ? M.kickLeanRad * Math.sin(Math.PI * Math.min(1, Math.max(0, s.kick.u))) : 0;
    const pitch = M.runPitchRad * run + kickLean + M.peckBodyRad * p + M.alertBodyRad * s.alert;
    const duty = M.duty + (M.runDuty - M.duty) * run;
    const swing = (M.hipSwingRad + (M.runHipSwingRad - M.hipSwingRad) * run) * walk;
    // Legs: a stance that carries the foot back under her, a swing that lifts and brings it forward.
    for (const side of /** @type {const} */ (['l', 'r'])) {
      const L = B[side];
      const u = frac(s.phase + (side === 'r' ? 0.5 : 0));
      let hip = 0, lift = 0;
      if (u < duty) hip = -swing + 2 * swing * (u / duty);
      else { const k = (u - duty) / (1 - duty); hip = swing - 2 * swing * smooth(k); lift = Math.sin(Math.PI * k) * walk; }
      // A scratch kick: the foot rakes back along the ground, then lifts on its way home.
      if (s.kick && s.kick.side === side) {
        const k = Math.min(1, Math.max(0, s.kick.u));
        hip += M.kickHipRad * Math.sin(Math.PI * Math.min(1, k / 0.7));
        lift = Math.max(lift, (M.kickLiftRad / M.liftRad) * Math.sin(Math.PI * Math.min(1, Math.max(0, (k - 0.55) / 0.45))));
      }
      // The legs stand upright however the body tips (hips undo the body's pitch).
      // Settled, the legs fold under her: thigh forward, shank back, the foot flat beneath.
      turn(L.hip, X, hip - lift * 0.35 - pitch + M.settleHipRad * st);
      turn(L.knee, X, M.liftRad * lift + M.settleKneeRad * st);
      turn(L.ankle, X, -M.liftRad * 0.6 * lift + M.settleAnkleRad * st);
      turn(L.toes, X, M.toeCurlRad * lift);
    }
    // The body: a dip at each footfall, a sway side to side, leaning into a run or a kick, upright when alert.
    const bob = M.bobM * walk * (0.5 - 0.5 * Math.cos(2 * TAU * s.phase));
    shift(B.root, [0, -bob - M.settleDropM * st, 0]);
    turn(B.root, Z, M.rollRad * walk * Math.sin(TAU * s.phase));
    turn(B.root, X, pitch);
    turn(B.tail, Y, M.tailSwayRad * walk * Math.sin(TAU * s.phase));
    turn(B.tail, X, M.alertTailRad * s.alert + M.settleTailRad * st);
    // The neck and head: a peck swings the neck down and the beak to the ground; alert lifts it.
    const P = M.peckNeckRad;
    turn(B.n0, X, P[0] * p + M.alertNeckRad * s.alert + M.settleNeckRad * st);
    turn(B.n1, X, P[1] * p);
    turn(B.n2, X, P[2] * p + s.look.down * 0.5);
    turn(B.head, X, M.peckHeadRad * p + s.look.down * 0.5);
    turn(B.n2, Y, s.look.yaw * 0.5);
    turn(B.head, Y, s.look.yaw * 0.5);
    turn(B.head, Z, s.look.tilt);
    // The head lock: the head's shift forward (and back up against the body's dip), spread down the neck.
    // A peck also stretches the neck along its own line.
    const H = M.headLock.share, stretch = neckDir.map((v) => v * M.peckStretchM * p);
    const lock = [stretch[0], bob + stretch[1], s.lockM + stretch[2]];
    [B.n1, B.n2, B.head].forEach((i, k) => shift(i, lock.map((v) => v * H[k])));
    // The Idle clip under it all, faded out as she moves, pecks, kicks or stands alert.
    const idleW = (M.idleW ?? 1) * (1 - walk) * (1 - p) * (s.kick ? 0 : 1) * (1 - s.alert) * (1 - 0.6 * st);
    return code.map((c, i) => {
      const im = idleMove(i, s.t, idleW);
      const q = im ? qmul(c.q, im.q) : c.q;
      const t = im ? c.t.map((v, k) => v + qrot(c.q, im.t)[k]) : c.t;
      return q === QI && !t[0] && !t[1] && !t[2] ? null : { q, t };
    });
  }

  return {
    moves,
    /** Pose into bone matrices (16 floats a bone). @param {HenPose} s @param {Float32Array} [out] */
    pose(s, out = new Float32Array(n * 16)) {
      poseSkeleton(skeleton, moves(s), out, 0);
      return out;
    },
  };
}

/** A still hen, for tests and the tools page. @returns {HenPose} */
export const stillPose = () => ({ t: 0, phase: 0, walk: 0, run: 0, kick: null, peck: 0, look: { yaw: 0, tilt: 0, down: 0 }, alert: 0, lockM: 0, settle: 0 });

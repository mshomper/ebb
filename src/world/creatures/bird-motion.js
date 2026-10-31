// @ts-check
// The small bird's code clips (B3 R1), written against the rig's bone roles (bird-rig.js) and
// tuned by the recipe's motion block (recipes/birds/<id>.json), so the turnstone, the purple
// sandpiper and any later small bird share them. A clip is a plain function of its progress that
// returns a pose (a few named angles and lengths); poseBird turns a pose into one move per bone.
// Feet on the ground are placed by legReach, timed to the distance walked (phase = metres walked /
// stride), so they never slide: the clip says where each foot is, the legs bend to reach it.
// Live animation only (never saved); plain Math is fine.

import { legReach, wingMoves, qAxis, qmul } from './bird-rig.js';

const DEG = Math.PI / 180;
const clamp01 = (/** @type {number} */ x) => Math.max(0, Math.min(1, x));
const ease = (/** @type {number} */ x) => { const k = clamp01(x); return k * k * (3 - 2 * k); };
/** 0 before a, rising to 1 at b. @param {number} u @param {number} a @param {number} b */
const ramp = (u, a, b) => ease((u - a) / (b - a));
/** Up from 0 at a to 1 between b and c, down to 0 at d. @param {number} u @param {number} a @param {number} b @param {number} c @param {number} d */
const hump = (u, a, b, c, d) => ramp(u, a, b) * (1 - ramp(u, c, d));
const mix = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ k) => a + (b - a) * k;

/**
 * A bird's pose: every angle in radians (pitch positive nose down; a tail's and a wing's up
 * positive), lengths in real metres.
 * @typedef {{ spread: number, up: number, sweep: number, handUp: number, handFold: number }} WingPose
 * @typedef {{
 *   t: number, breath: number,
 *   gait: { phase: number, w: number, strideM: number, duty: number, liftM: number },
 *   feet: { dz: number, dy: number }[],
 *   bodyPitch: number, bodyLift: number, bodyLunge: number,
 *   neckPitch: number, neckYaw: number, headPitch: number, headYaw: number, headTilt: number,
 *   tailUp: number, tailFan: number,
 *   wing: WingPose, wingL: Partial<WingPose> | null, wingR: Partial<WingPose> | null,
 *   air: number, reach: number,
 * }} BirdPose
 *   headPitch: the head's pitch in the world (held level against the body and neck);
 *   air: 0 legs on the ground, 1 tucked for flight; reach: legs swung forward to land
 */

/** @returns {BirdPose} the bird standing still, wings folded. */
export function restPose() {
  return { t: 0, breath: 1, gait: { phase: 0, w: 0, strideM: 0.05, duty: 0.6, liftM: 0.01 }, feet: [{ dz: 0, dy: 0 }, { dz: 0, dy: 0 }],
    bodyPitch: 0, bodyLift: 0, bodyLunge: 0, neckPitch: 0, neckYaw: 0, headPitch: 0, headYaw: 0, headTilt: 0,
    tailUp: 0, tailFan: 1, wing: { spread: 0, up: 0, sweep: 0, handUp: 0, handFold: 0 }, wingL: null, wingR: null, air: 0, reach: 0 };
}

/**
 * Where a foot's pivot is this instant (root space), for a gait: on the ground it moves back as
 * fast as the body moves on; in the air it swings forward in an arc. Left at the phase, right half a
 * stride after. @param {import('./bird-rig.js').LegRig} L @param {BirdPose} P @param {number} i leg
 * @returns {{ y: number, z: number, swing: number }} swing: 0 on the ground, else 0..1 through the swing
 */
export function footAt(L, P, i) {
  const G = P.gait, f = P.feet[i] ?? { dz: 0, dy: 0 };
  const u = (((G.phase + (L.side < 0 ? 0.5 : 0)) % 1) + 1) % 1;
  const reachM = G.strideM * G.duty;
  let z, y = 0, swing = 0;
  if (u < G.duty) z = reachM * (0.5 - u / G.duty);
  else {
    const v = (u - G.duty) / (1 - G.duty);
    z = reachM * (-0.5 + ease(v));
    y = G.liftM * Math.sin(Math.PI * v);
    swing = v;
  }
  return { y: L.foot[1] + f.dy + y * G.w, z: L.foot[2] + f.dz + z * G.w, swing: G.w > 0 ? swing : 0 };
}

/**
 * One move per bone for a pose. @param {import('./bird-rig.js').BirdRig} rig @param {BirdPose} P
 * @param {any} M recipes/birds/<id>.json motion @returns {(import('./pose.js').BoneMove | null)[]}
 */
export function poseBird(rig, P, M) {
  const at = rig.at;
  /** @type {(import('./pose.js').BoneMove | null)[]} */ const moves = rig.skeleton.map(() => null);
  const sw = M.breath.swell * P.breath * (0.5 + 0.5 * Math.sin(P.t * M.breath.hz * Math.PI * 2));
  // Breathing swells the flanks only: a sideways stretch turns with the legs' own turns (about x),
  // so it never moves a foot along the ground or up off it.
  moves[at.body] = { q: qAxis(0, P.bodyPitch), t: [0, P.bodyLift, P.bodyLunge], s: [1 + sw, 1, 1] };
  moves[at.neck] = { q: qmul(qAxis(1, P.neckYaw), qAxis(0, P.neckPitch)) };
  // The head holds its own pitch in the world (as a bird's does), whatever the body and neck do.
  moves[at.head] = { q: qmul(qAxis(1, P.headYaw), qmul(qAxis(0, P.headPitch - P.bodyPitch - P.neckPitch), qAxis(2, P.headTilt))) };
  moves[at.tail] = { q: qAxis(0, P.tailUp), s: [P.tailFan, 1, 1] };
  for (const W of rig.wings) {
    const own = W.side > 0 ? P.wingL : P.wingR;
    const w = own ? { ...P.wing, ...own } : P.wing;
    const m = wingMoves(W, w);
    moves[W.arm] = m.arm; moves[W.hand] = m.hand;
  }
  const T = M.tuck;
  rig.legs.forEach((L, i) => {
    // On the ground: reach for the gait's foot. In the air: tucked (or swung forward to land).
    const hip = [L.hip[0], L.hip[1] + P.bodyLift, L.hip[2] + P.bodyLunge];
    const f = footAt(L, P, i);
    const r = legReach(hip, L, [0, f.y, f.z]);
    const curl = Math.sin(Math.PI * f.swing) * 0.9;
    const tuck = { leg: T.legDeg * DEG, shank: T.shankDeg * DEG, foot: T.footDeg * DEG };
    const reach = { leg: -40 * DEG, shank: -25 * DEG, foot: 25 * DEG };
    const air = { leg: mix(tuck.leg, reach.leg, P.reach), shank: mix(tuck.shank, reach.shank, P.reach), foot: mix(tuck.foot, reach.foot, P.reach) };
    const legW = mix(r.leg, air.leg + P.bodyPitch, P.air), shankW = mix(r.shank, air.shank + air.leg + P.bodyPitch, P.air);
    const footW = mix(curl, air.foot + air.shank + air.leg + P.bodyPitch, P.air);
    moves[L.leg] = { q: qAxis(0, legW - P.bodyPitch) };
    moves[L.shank] = { q: qAxis(0, shankW - legW) };
    moves[L.foot_] = { q: qAxis(0, footW - shankW) };
  });
  return moves;
}

/**
 * A wingbeat at a phase (0..1, the downstroke first): how high the wing is, the hand bending up
 * behind the arm on the downstroke and folding back on the upstroke, and the stroke's sweep.
 * @param {number} phase @param {any} F recipes/birds/<id>.json motion.flap @param {number} [amp] 1 a full beat
 * @returns {WingPose}
 */
export function flapAt(phase, F, amp = 1) {
  const u = ((phase % 1) + 1) % 1, d = F.downShare;
  const mid = (F.upDeg + F.downDeg) / 2;
  let up, handUp, handFold, sweep;
  if (u < d) {
    const k = u / d;
    up = mix(F.upDeg, F.downDeg, ease(k));
    handUp = F.handLagDeg * Math.sin(Math.PI * k);
    handFold = 0;
    sweep = F.sweepDeg * Math.sin(Math.PI * k);
  } else {
    const k = (u - d) / (1 - d);
    up = mix(F.downDeg, F.upDeg, ease(k));
    handUp = -F.handLagDeg * 0.6 * Math.sin(Math.PI * k);
    handFold = F.handFoldDeg * Math.sin(Math.PI * k);
    sweep = -F.sweepDeg * 0.6 * Math.sin(Math.PI * k);
  }
  return { spread: 1, up: (mid + (up - mid) * amp) * DEG, sweep: sweep * amp * DEG, handUp: handUp * amp * DEG, handFold: handFold * amp * DEG };
}

/** Wings held open and still, a little raised (a glide). @param {any} F */
export const glideWing = (F) => ({ spread: 1, up: F.glideUpDeg * DEG, sweep: 0, handUp: -4 * DEG, handFold: 4 * DEG });

/** Folded wings. */
const FOLDED = { spread: 0, up: 0, sweep: 0, handUp: 0, handFold: 0 };

/** Two wing poses mixed. @param {WingPose} a @param {WingPose} b @param {number} k */
export function mixWing(a, b, k) {
  return { spread: mix(a.spread, b.spread, k), up: mix(a.up, b.up, k), sweep: mix(a.sweep, b.sweep, k), handUp: mix(a.handUp, b.handUp, k), handFold: mix(a.handFold, b.handFold, k) };
}

/**
 * Standing: breathing, the head turning now and then to look about (or tilting an eye up).
 * @param {number} t seconds @param {any} M @param {number} [seed] a bird's own timing
 */
export function idlePose(t, M, seed = 0) {
  const P = restPose();
  P.t = t;
  const L = M.look, s = t * 0.37 + seed * 1.7;
  // A look is a quick turn and a hold, not a sway.
  P.headYaw = L.yawDeg * DEG * Math.max(-1, Math.min(1, Math.sin(s) * 3 + Math.sin(s * 2.3) * 0.8));
  P.headTilt = L.tiltDeg * DEG * Math.max(0, Math.sin(t * 0.23 + seed) * 4 - 3);
  P.neckPitch = -3 * DEG * Math.max(0, Math.sin(t * 0.29 + seed * 0.5));
  return P;
}

/**
 * Walking or running at a gait phase (metres walked / strideM): short quick steps, the body
 * bobbing twice a stride and leaning into a run.
 * @param {number} t @param {number} phase @param {any} M @param {'walk' | 'run'} kind
 */
export function gaitPose(t, phase, M, kind) {
  const G = M[kind], P = restPose();
  P.t = t;
  P.gait = { phase, w: 1, strideM: G.strideM, duty: G.duty, liftM: G.liftM };
  P.bodyLift = -G.bobM * (0.5 + 0.5 * Math.cos(phase * Math.PI * 4)) - (kind === 'run' ? 0.004 : 0);
  P.bodyPitch = (kind === 'run' ? G.leanDeg : 2) * DEG;
  P.neckPitch = (kind === 'run' ? -10 : -2) * DEG + Math.sin(phase * Math.PI * 4) * 2.5 * DEG;
  P.headPitch = 4 * DEG;
  P.tailUp = Math.sin(phase * Math.PI * 4 + 1) * M.tail.bobDeg * 0.4 * DEG;
  return P;
}

/**
 * A peck: down to the ground just ahead, a short hold, back up. @param {number} t @param {number} u 0..1 through it @param {any} M
 */
export function peckPose(t, u, M) {
  const K = M.peck, P = restPose();
  P.t = t;
  const d = u < 0.35 ? ease(u / 0.35) : u < 0.5 ? 1 : 1 - ease((u - 0.5) / 0.5);
  P.bodyPitch = K.reachDeg * DEG * d;
  P.neckPitch = K.neckDeg * DEG * d;
  P.headPitch = 55 * DEG * d;
  P.bodyLift = -0.006 * d;
  P.tailUp = 12 * DEG * d;
  return P;
}

/**
 * Turning a stone or a clump of wrack, the turnstone's own: head down, bill under the near edge,
 * a shove forward and up with the whole body that tips it over away from the bird, then pecks at
 * what was hiding under it. `lever` is how far over the stone is (0 lying, 1 flipped), for the
 * stone's own turn. @param {number} t @param {number} u 0..1 through it @param {any} M
 * @returns {{ pose: BirdPose, lever: number }}
 */
export function flipPose(t, u, M) {
  const F = M.flip, P = restPose();
  P.t = t;
  const down = ramp(u, 0, 0.22), shove = ramp(u, 0.24, 0.42), up = hump(u, 0.36, 0.44, 0.5, 0.6), done = ramp(u, 0.88, 1);
  // The pecks at the turned ground.
  const pk = u > 0.56 && u < 0.88 ? Math.max(0, Math.sin(((u - 0.56) / 0.32) * Math.PI * F.pecks)) : 0;
  const reach = down * (1 - shove * 0.7) * (1 - done);
  P.bodyPitch = (F.reachDeg * reach + 18 * pk * (1 - done) - 8 * up) * DEG;
  P.neckPitch = (F.neckDeg * reach - 30 * up + 34 * pk) * DEG;
  P.headPitch = (62 * down * (1 - shove) + 20 * shove - 45 * up + 55 * pk) * DEG * (1 - done);
  P.bodyLunge = F.thrustM * (shove - ramp(u, 0.6, 0.9)) * (1 - done);
  P.bodyLift = -0.008 * reach + 0.006 * up - 0.004 * pk;
  P.tailUp = (14 * reach + 6 * pk) * DEG;
  // The feet brace: the left a touch forward, the right back.
  P.feet = [{ dz: 0.008, dy: 0 }, { dz: -0.008, dy: 0 }];
  P.wing = { ...FOLDED, spread: 0.06 * up, up: 0.1 * up };
  return { pose: P, lever: ramp(u, 0.27, 0.5) };
}

/**
 * Preening: the head swings back to one side and nibbles through the wing and flank feathers, the
 * wing on that side lifted a little; the left first, then the right. @param {number} t @param {number} u @param {any} M
 */
export function preenPose(t, u, M) {
  const K = M.preen, P = restPose();
  P.t = t;
  const half = u < 0.5 ? 0 : 1, v = (u * 2) % 1, side = half ? -1 : 1;
  const into = hump(v, 0, 0.18, 0.82, 1);
  const nib = Math.sin(v * Math.PI * 14) * into;
  P.neckYaw = side * K.neckYawDeg * DEG * into * 0.55;
  P.headYaw = side * K.neckYawDeg * DEG * into * 0.45 + nib * 0.08;
  P.neckPitch = K.neckPitchDeg * DEG * into;
  P.headPitch = (25 * into + nib * 6) * DEG;
  P.headTilt = side * 25 * DEG * into;
  const lift = { spread: K.wingLift * into, up: 0.25 * into, sweep: 0, handUp: 0, handFold: 0 };
  if (side > 0) P.wingL = lift; else P.wingR = lift;
  P.tailFan = 1 + 0.15 * into;
  return P;
}

/**
 * Flying: wingbeats with a glide every so often (as a flock of small waders flies), the legs
 * tucked, the neck drawn in. `beat` is how many beats since it began (a flock passes each bird its
 * own); `glide` 0..1 holds the wings open. @param {number} t @param {number} beat @param {number} glide @param {any} M
 */
export function flyPose(t, beat, glide, M) {
  const F = M.flap, P = restPose();
  P.t = t;
  P.breath = 0;
  P.air = 1;
  P.wing = mixWing(flapAt(beat, F), glideWing(F), glide);
  P.bodyPitch = -F.bodyPitchDeg * DEG;
  P.bodyLift = Math.sin(beat * Math.PI * 2 + 0.6) * 0.002 * (1 - glide);
  P.neckPitch = 12 * DEG;
  P.headPitch = 0;
  P.tailFan = 1 + (M.tail.fan - 1) * 0.3;
  return P;
}

/**
 * Taking off: a few quick running steps, a crouch, a spring with the wings coming open, strong
 * beats, and the legs tucked as it climbs. Returns the height above the ground (real m) and the
 * speed along (real m/s); the caller walks the bird on and passes the gait phase.
 * @param {number} t @param {number} u 0..1 @param {number} phase metres along / run stride @param {any} M
 * @returns {{ pose: BirdPose, y: number, v: number }}
 */
export function takeoffPose(t, u, phase, M) {
  const K = M.takeoff, F = M.flap, run = gaitPose(t, phase, M, 'run');
  const spring = 0.42;
  const crouch = hump(u, 0.26, spring - 0.02, spring, spring + 0.08);
  const aloft = ramp(u, spring, spring + 0.06);
  const P = run;
  P.gait.w = 1 - aloft;
  P.bodyLift += -0.012 * crouch;
  P.bodyPitch = mix(M.run.leanDeg * DEG + K.crouchDeg * DEG * crouch, -K.climbDeg * DEG * (1 - ramp(u, 0.7, 1)), aloft);
  P.air = ramp(u, spring + 0.04, 0.78);
  // The wings start to open in the last strides, then beat hard (a little faster than cruising).
  const beat = ((u * K.s) * F.hz * 1.2);
  P.wing = mixWing({ ...FOLDED }, flapAt(beat, F, 1.15), ramp(u, spring - 0.12, spring + 0.02));
  P.wing.spread = ramp(u, spring - 0.12, spring);
  P.neckPitch = mix(-10 * DEG, 8 * DEG, aloft);
  P.tailFan = 1 + (M.tail.fan - 1) * aloft;
  const k = clamp01((u - spring) / (1 - spring));
  return { pose: P, y: 0.25 * Math.pow(k, 1.4), v: mix(M.run.mps * 0.6, K.climbMps, ramp(u, 0, spring)) };
}

/**
 * Landing: a glide in, a flare (body up, wings forward, quick beats, tail spread down, legs
 * reaching), touchdown with a few running steps, the wings held high a moment, then folded.
 * Returns the height (real m) and the speed along; `fromM` is the height it starts at.
 * @param {number} t @param {number} u 0..1 @param {number} phase metres along / run stride @param {any} M @param {number} [fromM]
 * @returns {{ pose: BirdPose, y: number, v: number }}
 */
export function landPose(t, u, phase, M, fromM = 0.25) {
  const K = M.land, F = M.flap;
  const touch = 0.5;
  const P = gaitPose(t, phase, M, 'run');
  const flare = hump(u, 0.3, 0.44, touch, touch + 0.08);
  const ground = ramp(u, touch - 0.02, touch + 0.02);
  // Wings held high for wingsUpS after touching down, then folded.
  const upTo = Math.min(0.8, touch + 0.06 + K.wingsUpS / K.s);
  const wingsUp = hump(u, touch, touch + 0.06, upTo, upTo + 0.1);
  const fold = ramp(u, upTo + 0.02, upTo + 0.16);
  P.gait.w = ground * (1 - ramp(u, 0.62, 0.72));
  P.air = 1 - ground;
  P.reach = ramp(u, 0.2, 0.42);
  P.bodyPitch = mix(-F.bodyPitchDeg * DEG, -K.flareDeg * DEG, flare) * (1 - ground) + ground * (1 - fold) * 6 * DEG;
  // Glide, then two quick flaring beats, then wings up and folded.
  const beats = hump(u, 0.36, 0.4, 0.48, touch);
  let w = mixWing(glideWing(F), { ...flapAt(u * K.s * F.hz * 1.3, F, 0.8), sweep: 18 * DEG }, beats);
  w = mixWing(w, { spread: 1, up: K.wingsUpDeg * DEG, sweep: -6 * DEG, handUp: 10 * DEG, handFold: 18 * DEG }, wingsUp);
  w = mixWing(w, { ...FOLDED }, fold);
  if (ground > 0.5 && wingsUp < 0.05) w.spread = Math.min(w.spread, 1 - fold);
  P.wing = w;
  P.tailUp = (-14 * flare + 4 * ground) * DEG;
  P.tailFan = 1 + (M.tail.fan - 1) * Math.max(flare, 1 - ground) * (1 - fold);
  P.neckPitch = (6 * (1 - ground) - 6 * flare) * DEG;
  P.bodyLift += -0.01 * hump(u, touch, touch + 0.03, touch + 0.06, touch + 0.14);
  const k = clamp01(u / touch);
  const y = u < touch ? fromM * Math.pow(1 - k, 1.6) : 0;
  const v = u < touch ? mix(0.9, 0.55, ramp(u, 0.3, touch)) : 0.55 * (1 - ramp(u, touch, 0.7));
  return { pose: P, y, v };
}

// @ts-check
// The teal's own clips (B3 wave 3), on the small-bird rig's bone roles and the shared clips
// (src/world/creatures/bird-motion.js), tuned by recipes/birds/teal.json motion. On the water:
// swimming (the feet paddle under it, the head bobs a little), dabbling (the bill dipped to the
// surface and sieving), up-ending (tipped forward until only the tail and kicking feet show),
// preening and sleeping with the head turned back on the back. Off it: the rise (a dabbling duck
// springs up steeply off the water, wings beating hard at once, moving on as it climbs), fast
// whirring flight stretched out flat (the neck forward, the head level, never upright as it sits
// on the water), and the landing (the shared glide, flare and wings-up, onto the water, still
// stretched out until the flare). Live animation only.

import { restPose, idlePose, preenPose, flyPose, landPose, flapAt, mixWing } from '../creatures/bird-motion.js';

const DEG = Math.PI / 180;
const clamp01 = (/** @type {number} */ x) => Math.max(0, Math.min(1, x));
const ease = (/** @type {number} */ x) => { const k = clamp01(x); return k * k * (3 - 2 * k); };
/** 0 before a, rising to 1 at b. @param {number} u @param {number} a @param {number} b */
const ramp = (u, a, b) => ease((u - a) / (b - a));
/** Up from 0 at a to 1 between b and c, down to 0 at d. @param {number} u @param {number} a @param {number} b @param {number} c @param {number} d */
const hump = (u, a, b, c, d) => ramp(u, a, b) * (1 - ramp(u, c, d));
const FOLDED = { spread: 0, up: 0, sweep: 0, handUp: 0, handFold: 0 };

/**
 * Swimming or floating: the feet paddle at a phase (metres swum / swim.strideM), the body a little
 * nose down, the head looking about. paddle 0 floats still, the feet hanging.
 * @param {number} t @param {number} phase @param {number} paddle 0..1 @param {any} M @param {number} [seed]
 */
export function swimPose(t, phase, paddle, M, seed = 0) {
  const S = M.swim, P = idlePose(t, M, seed);
  P.gait = { phase, w: paddle, strideM: S.strideM, duty: 0.5, liftM: 0 };
  P.bodyPitch = S.pitchDeg * DEG;
  P.neckPitch += Math.sin(phase * Math.PI * 2) * S.bobDeg * DEG * paddle;
  P.tailUp = 6 * DEG;
  return P;
}

/**
 * Dabbling: the bill dipped to the water's skin a few times, sieving while it is down.
 * @param {number} t @param {number} u 0..1 through it @param {any} M
 */
export function dabblePose(t, u, M) {
  const D = M.dabble, P = swimPose(t, t * 0.6, 0.4, M);
  const v = (u * D.dips) % 1;
  const down = hump(v, 0, 0.25, 0.8, 1);
  P.bodyPitch += D.bodyDeg * DEG * down;
  P.neckPitch = D.neckDeg * DEG * down;
  P.headPitch = D.headDeg * DEG * down;
  P.headYaw = Math.sin(t * D.sieveHz * Math.PI * 2) * 6 * DEG * down;
  P.tailUp = 10 * DEG * down;
  return P;
}

/**
 * Up-ending: tipped forward over the hips until the head and neck are under and the tail stands
 * up, the feet kicking to hold it there, then back upright. @param {number} t @param {number} u @param {any} M
 */
export function upendPose(t, u, M) {
  const U = M.upend, P = restPose();
  P.t = t;
  const tip = hump(u, 0, 0.16, 0.84, 1);
  P.bodyPitch = U.bodyDeg * DEG * tip;
  P.neckPitch = U.neckDeg * DEG * tip;
  // The head goes down with the neck (it no longer holds level in the world).
  P.headPitch = (U.bodyDeg + U.neckDeg) * DEG * tip;
  P.tailUp = U.tailDeg * DEG * tip;
  P.tailFan = 1 + 0.2 * tip;
  P.bodyLift = U.liftM * tip;
  // The feet, tucked against the body, paddle hard to keep it tipped.
  P.air = tip;
  P.reach = tip * (0.35 + 0.35 * Math.sin(t * U.kickHz * Math.PI * 2));
  return P;
}

/** Asleep on the water: the head turned back and laid on the back, breathing slowly. @param {number} t @param {any} M */
export function sleepPose(t, M) {
  const P = preenPose(t, 0.25, M);
  P.headPitch = M.sleep.headDeg * DEG;
  P.wingL = null;
  P.breath = 0.6;
  return P;
}

/**
 * Flying: fast whirring beats, no glide, stretched out flat as a duck flies: the body tipped a
 * little nose down from its floating trim, the neck reaching forward so the head rides level
 * ahead of it, the tail lifted in line and the feet tucked back. Never the upright shape it has
 * on the water. @param {number} t @param {number} beat @param {any} M
 */
export function tealFlyPose(t, beat, M) {
  const S = M.fly, P = flyPose(t, beat, 0, M);
  P.bodyPitch = S.bodyDeg * DEG;
  P.neckPitch = S.neckDeg * DEG;
  P.headPitch = S.headDeg * DEG;
  P.tailUp = S.tailDeg * DEG;
  return P;
}

/**
 * The rise: up off the water steeply but moving on (the caller carries it forward and up), wings
 * open and beating hard at once, the body tipped up a little and the neck coming forward as it
 * climbs, then stretched out flat into flight. Returns the share of the climb made (the caller
 * sets the height). @param {number} t @param {number} u 0..1 @param {number} beat @param {any} M
 * @returns {{ pose: ReturnType<typeof restPose>, climb: number }}
 */
export function risePose(t, u, beat, M) {
  const R = M.rise, F = M.flap, P = tealFlyPose(t, beat * R.beatK, M);
  const open = ramp(u, 0, 0.12), flat = ramp(u, 0.3, 0.9), reach = ramp(u, 0.05, 0.4);
  P.wing = mixWing({ ...FOLDED }, flapAt(beat * R.beatK, F, 1.15), open);
  P.bodyPitch = -R.pitchDeg * DEG * (1 - flat) + M.fly.bodyDeg * DEG * flat;
  P.neckPitch = M.fly.neckDeg * DEG * reach;
  P.tailUp = M.fly.tailDeg * DEG * reach;
  P.air = ramp(u, 0.15, 0.6);
  P.reach = 0;
  return { pose: P, climb: 1 - Math.pow(1 - u, 2) };
}

/**
 * Landing on the water: the shared glide in, flare, wings held up and folded. The caller moves it
 * down onto the water by the touch share. @param {number} t @param {number} u @param {any} M
 */
export function splashPose(t, u, M) {
  const r = landPose(t, u, 0, M);
  // Stretched out flat on the glide in, the neck coming up into the flare.
  const S = M.fly, flat = 1 - ramp(u, 0.25, 0.42), P = r.pose;
  P.bodyPitch += (S.bodyDeg * DEG - P.bodyPitch) * flat;
  P.neckPitch += (S.neckDeg * DEG - P.neckPitch) * flat;
  P.tailUp += (S.tailDeg * DEG - P.tailUp) * flat;
  // On the water the feet do not run on: they hang still under it once down.
  r.pose.gait.w = 0;
  return r.pose;
}

/** The landing's touchdown, as a share of its time (bird-motion.js landPose). */
export const TOUCH = 0.5;

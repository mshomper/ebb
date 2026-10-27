// @ts-check
// A silt crawler alive (H2, doc 16; CLAUDE.md, the creature rule): what its rig does from moment to
// moment, read from its steps in foes.js (rest, notice, close in, wind-up, strike, recover) and the
// hits it takes. Its feet are planted on the ground in the world and step only when the body has
// moved on from them, in diagonal pairs, so they never slide (a shuffle). Resting, it breathes, a
// stalk twitches now and then and its tail curls to a side. Its tell is a rear-up: the front rises
// about the hind hips, the forelegs lift and the soft pale underside shows. The lunge drives plate
// first; if it meets the walker it bounces off and recoils; stuck after it, the plate is dug into the silt and the back is up and soft. A front hit
// glances off the plate in sparks and rocks it back; a side or back hit makes it flinch. Breaking,
// it slumps into grey sand and motes of light. The tail lags on a spring; the eye stalks bob and turn
// to look at the walker. Every bit of variation is seeded (src/core/rng.js). Pure: the caller gives
// the clock, the ground and you. Numbers: recipes/world/hollow.json foes.lunger.crawler.

import { stream } from '../../core/rng.js';
import { axisAngle } from '../creatures/pose.js';
import { LEGS, poseCrawler, restPose, rot, qmul, rootTurn, underRoot } from './crawler-rig.js';
import { createDust } from './crawler-dust.js';

const DEG = Math.PI / 180, TAU = Math.PI * 2;
/** Floats per crawler for the pass: at (x, y, z, yaw), look (flash, slump, first bone, glow). */
export const CRAWLER_FLOATS = 8;
/** Bones a crawler (the pass keeps this many matrices each). */
export const CRAWLER_BONES = 16;
const ease = (/** @type {number} */ x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const clamp = (/** @type {number} */ v, /** @type {number} */ m) => Math.max(-m, Math.min(m, v));
const wrap = (/** @type {number} */ a) => Math.atan2(Math.sin(a), Math.cos(a));
/** The other pair: fl with hr, fr with hl, so it steps in diagonals. */
const PAIR = /** @type {Record<string, number>} */ ({ fl: 0, hr: 0, fr: 1, hl: 1 });

/**
 * @typedef {{ x: number, z: number, yaw: number, step: string, t: number, stunS: number, broken: boolean,
 *   hits: { front: number, side: number, back: number }, recoilS?: number }} CrawlerFoe the lunger as foes.js gives it
 * @typedef {{ ground: (x: number, z: number) => number, you: { x: number, z: number } }} CrawlerWorld
 */

/**
 * @param {CrawlerFoe} foe @param {import('./crawler-model.js').CrawlerModel} model
 * @param {any} K recipes/world/hollow.json foes.lunger (read live; its crawler block is the drawing's) @param {number} seed
 */
export function createCrawlerMotion(foe, model, K, seed) {
  const C = K.crawler;
  const pose = restPose(model);
  const bones = new Float32Array(CRAWLER_BONES * 16);
  const dust = createDust(seed);
  const rnd = (/** @type {number} */ key, /** @type {number} */ n) => stream(seed, 0x637277, key, n).next();
  const feet = Object.fromEntries(LEGS.map((l) => [l, {
    /** Planted here (world), or stepping from `from` (t 0..1 through the step). */
    p: /** @type {number[] | null} */ (null), from: /** @type {number[] | null} */ (null), t: 0, dur: 0.1,
    /** Where it belonged last frame, and how fast that moves (m/s; turning on the spot moves it too). */
    was: /** @type {number[] | null} */ (null), mps: 0,
    /** How far it is off the ground for a move of its own (the tell, the lunge), 0..1. */ free: 0,
  }]));
  const tail = [0, 0, 0, 0].map(() => ({ a: 0, v: 0 }));
  const look = { l: 0, r: 0 };
  let lastYaw = foe.yaw, lastX = foe.x, lastZ = foe.z, speed = 0, turnRate = 0;
  let hits = { ...foe.hits }, glanceT = 9, flinchT = 9, flinchSide = 1, flash = 0, brokenT = -1;
  let prevStep = foe.step, fromStrike = false;
  let curl = 0, curlGoal = 0, curlAt = 2 + rnd(1, 0) * 3, curlN = 0;
  let twitchAt = 1 + rnd(2, 0) * 2, twitchN = 0, twitchT = 9, twitchWho = /** @type {'l' | 'r'} */ ('l'), twitchSign = 1;
  let instY = 0;
  /** Where each foot belongs (model space): tucked in toward its hip by tuckShare, so the knee bends and
   * the foot has room to lag; and how far it can lag from there and still be reached (m), from the leg. */
  const homeOf = /** @type {Record<string, number[]>} */ ({}), reachOf = /** @type {Record<string, number>} */ ({});
  const tuck = () => {
    const g = C.motion.gait;
    for (const leg of LEGS) {
      const L = model.legs[leg], s = g.tuckShare;
      homeOf[leg] = [L.hip[0] + (L.foot[0] - L.hip[0]) * s, L.foot[1], L.hip[2] + (L.foot[2] - L.hip[2]) * s];
      const len = Math.hypot(L.knee[0] - L.hip[0], L.knee[1] - L.hip[1], L.knee[2] - L.hip[2]) + Math.hypot(L.foot[0] - L.knee[0], L.foot[1] - L.knee[1], L.foot[2] - L.knee[2]);
      const dv = L.hip[1] - C.motion.crouchM - L.foot[1], h0 = Math.hypot(homeOf[leg][0] - L.hip[0], homeOf[leg][2] - L.hip[2]);
      reachOf[leg] = Math.max(0.01, Math.sqrt(Math.max(0, (0.97 * len) ** 2 - dv * dv)) - h0);
    }
  };
  tuck();

  /** Model space to the world, and back. @param {number[]} p */
  const toWorld = (p) => { const c = Math.cos(foe.yaw), s = Math.sin(foe.yaw); return [foe.x + c * p[0] + s * p[2], instY + p[1], foe.z - s * p[0] + c * p[2]]; };
  const toModel = (/** @type {number[]} */ w) => { const c = Math.cos(foe.yaw), s = Math.sin(foe.yaw), dx = w[0] - foe.x, dz = w[2] - foe.z; return [c * dx - s * dz, w[1] - instY, s * dx + c * dz]; };

  /** @param {number} dt @param {number} clock @param {CrawlerWorld} w */
  function update(dt, clock, w) {
    if (dt <= 0) return;
    const M = C.motion, G = M.gait, step = foe.step, into = foe.t;
    instY = w.ground(foe.x, foe.z);
    // How it is moving, eased.
    const mv = Math.hypot(foe.x - lastX, foe.z - lastZ) / dt, yr = wrap(foe.yaw - lastYaw) / dt;
    speed += (mv - speed) * (1 - Math.exp(-dt * 12));
    turnRate += (yr - turnRate) * (1 - Math.exp(-dt * 10));
    lastX = foe.x; lastZ = foe.z; lastYaw = foe.yaw;
    if (step !== prevStep) { if (step === 'recover') fromStrike = prevStep === 'strike'; prevStep = step; }
    // Hits: a front one glanced off the plate; a side or back one landed.
    const h = foe.hits;
    if (h.front > hits.front) {
      glanceT = 0;
      const tip = toWorld(underRoot(model, pose.root, [0, model.heightM * 0.42, model.lengthM * 0.3]));
      dust.sparks(M.glance, tip[0], tip[1], tip[2], Math.sin(foe.yaw), Math.cos(foe.yaw));
    }
    if (h.side + h.back > hits.side + hits.back) {
      flinchT = 0; flash = 1;
      flinchSide = toModel([w.you.x, 0, w.you.z])[0] >= 0 ? 1 : -1;
    }
    hits = { ...h };
    glanceT += dt; flinchT += dt; flash = Math.max(0, flash - dt / 0.18);
    if (foe.broken && brokenT < 0) {
      brokenT = 0;
      const from = [];
      for (let i = 0; i < model.count; i += 23) from.push(toWorld([model.positions[i * 3], model.positions[i * 3 + 1], model.positions[i * 3 + 2]]));
      dust.breakup(M.breakup, from);
    }
    dust.update(dt, w.ground);
    if (brokenT >= 0) { brokenT += dt; return; }

    // ---- the root: rearing, the lunge's dive, stuck in the silt ----
    const T = M.tell, Lg = M.lunge, S = M.stuck;
    let up = 0, lift = -M.crouchM, roll = 0;
    let foreFree = 0, hindFree = 0, foreAim = 0, hindAim = 0;
    if (step === 'wind') {
      const r = ease(into / T.riseS);
      up = T.rearDeg * DEG * r + Math.sin(clock * T.quiverHz * TAU) * T.quiverDeg * DEG * r;
      lift += T.riseM * r; foreFree = 1; foreAim = T.foreLiftDeg * DEG;
    } else if (step === 'strike') {
      const u = ease(into / 0.12);
      up = T.rearDeg * DEG * (1 - u) - Lg.diveDeg * DEG * u;
      foreFree = 1; hindFree = 1; foreAim = Lg.reachDeg * DEG * (1 - u * 0.4); hindAim = -Lg.reachDeg * DEG * 0.6;
    } else if (step === 'recover' && fromStrike) {
      const dig = ease(into / 0.1) * (1 - ease((into - (K.recoverS - S.freeS)) / S.freeS));
      up = -S.digDeg * DEG * dig + Math.sin(clock * S.struggleHz * TAU) * S.struggleDeg * DEG * dig;
      roll = Math.sin(clock * S.struggleHz * TAU * 0.5 + 1) * S.struggleDeg * DEG * dig;
      lift -= S.sinkM * dig;
    }
    // A glance rocks the front back; a flinch rolls it away from the hit.
    const gl = glanceT < M.glance.s ? Math.sin(Math.PI * glanceT / M.glance.s) : 0;
    const fl = flinchT < M.flinch.s ? Math.sin(Math.PI * flinchT / M.flinch.s) : 0;
    up += gl * M.glance.recoilDeg * DEG;
    // A lunge that hit the walker bounced off: the front rocks back as it recoils.
    const rc = (foe.recoilS ?? 0) > 0 ? Math.sin(Math.PI * (1 - /** @type {number} */ (foe.recoilS) / (K.recoilS ?? 0.25))) : 0;
    up += rc * M.bounce.recoilDeg * DEG;
    roll += -flinchSide * fl * M.flinch.flinchDeg * DEG;
    pose.root.up = up; pose.root.lift = lift; pose.root.roll = roll; pose.root.fwd = 0;

    // ---- the feet: planted, stepping in diagonal pairs, or lifted for a move ----
    // A foot steps once it is this far from where it belongs: further at speed (its own, as turning on
    // the spot moves it too), early enough to wait out the other pair's step and still be in reach.
    const pace = Math.max(G.strideM, speed * G.stepS * 1.3);
    tuck(); // read live, so the tuning sliders take at once
    const qr = rootTurn(pose.root);
    let bob = 0;
    for (const leg of LEGS) {
      const f = feet[leg], L = model.legs[leg], front = leg[0] === 'f';
      const goal = front ? foreFree : hindFree;
      f.free += (goal - f.free) * (1 - Math.exp(-dt * (goal > f.free ? 22 : 10)));
      const home = toWorld(homeOf[leg]);
      if (f.was) f.mps += (Math.hypot(home[0] - f.was[0], home[2] - f.was[2]) / dt - f.mps) * (1 - Math.exp(-dt * 12));
      f.was = home.slice();
      const fast = Math.max(speed, mv, f.mps);
      const trigger = Math.min(reachOf[leg] * 0.4, Math.max(pace, fast * G.stepS * 1.3));
      home[1] = w.ground(home[0], home[2]) + L.footLiftM;
      if (!f.p || f.free > 0.5) { f.p = home; f.from = null; }
      else if (!f.from && !(step === 'recover' && fromStrike) && (() => {
        // Off by more than the trigger, it steps when the other pair is down; past its reach (a sudden
        // start), at once.
        const off = Math.hypot(f.p[0] - home[0], f.p[2] - home[2]);
        return off > reachOf[leg] * 0.9 || (off > trigger && !LEGS.some((o) => PAIR[o] !== PAIR[leg] && feet[o].from));
      })()) {
        f.from = f.p.slice(); f.t = 0;
        // Quicker steps the faster it goes, so a foot is down again before the other pair must lift.
        f.dur = Math.max(0.04, Math.min(G.stepS, 0.8 * trigger * (1 + G.leadShare) / Math.max(fast, 1e-3)));
      }
      let at = f.p;
      if (f.from) {
        f.t += dt / f.dur;
        const dx = home[0] - f.from[0], dz = home[2] - f.from[2], dl = Math.hypot(dx, dz) || 1;
        const land = [home[0] + dx / dl * trigger * G.leadShare, 0, home[2] + dz / dl * trigger * G.leadShare];
        land[1] = w.ground(land[0], land[2]) + L.footLiftM;
        const e = ease(f.t), arc = Math.sin(Math.PI * Math.min(1, f.t));
        at = [f.from[0] + (land[0] - f.from[0]) * e, f.from[1] + (land[1] - f.from[1]) * e + arc * G.liftM, f.from[2] + (land[2] - f.from[2]) * e];
        bob += arc;
        if (f.t >= 1) { f.p = land; f.from = null; }
      }
      const planted = toModel(at);
      // Lifted: the leg swung about its hip by aim (forward up), a little bent.
      const aim = front ? foreAim : hindAim;
      const H = underRoot(model, pose.root, L.hip);
      const swing = qmul(qr, axisAngle([1, 0, 0], -aim));
      const lifted = H.map((v, k) => v + rot(swing, [L.foot[0] - L.hip[0], L.foot[1] - L.hip[1], L.foot[2] - L.hip[2]])[k] * 0.86);
      const e = ease(f.free);
      pose.feet[leg] = planted.map((v, k) => v + (lifted[k] - v) * e);
    }

    // ---- the body: breathing, the plate's bob a step, a flinch's squash ----
    const B = M.breath, calm = step === 'rest' || step === 'notice' ? 1 : 0.4;
    pose.body.breath = B.share * calm * (0.5 + 0.5 * Math.sin(clock * B.hz * TAU + rnd(3, 0) * TAU));
    pose.body.bob = bob * G.plateBobM * 0.5;
    pose.body.up = bob * G.plateBobDeg * DEG * 0.5;
    pose.body.squash = fl * M.flinch.squash;
    pose.body.roll = 0;
    pose.body.turn = flinchSide * fl * M.flinch.flinchDeg * DEG * 0.5;

    // ---- the tail: a lagging spring, a slow sway, a curl at rest; it stays down in the silt ----
    const Tl = M.tail;
    if (step === 'rest' && clock >= curlAt) {
      curlGoal = curlGoal !== 0 ? 0 : (rnd(4, curlN) < 0.5 ? -1 : 1);
      curlAt = clock + Math.max(1, Tl.curlEveryS + (rnd(5, curlN++) * 2 - 1) * Tl.curlJitterS);
    }
    if (step !== 'rest') curlGoal = 0;
    curl += (curlGoal - curl) * (1 - Math.exp(-dt * 1.5));
    tail.forEach((b, i) => {
      const want = clamp(-turnRate * 0.07 * (1 + i * 0.5), 1) + Math.sin(clock * Tl.swayHz * TAU - i * 0.8) * Tl.swayDeg * DEG + curl * Tl.curlDeg * DEG * (0.5 + 0.25 * i)
        + (step === 'strike' ? Math.sin(clock * 20 + i) * 0.15 : 0);
      b.v += (Tl.stiffness * (want - b.a) - Tl.damping * b.v) * dt;
      b.a = clamp(b.a + b.v * dt, 1.1);
      // Tilted to keep it down on the ground however the root tips.
      pose.tail[i] = [b.a, i === 0 ? up * 1.05 - (lift + M.crouchM) * 2 : 0];
    });

    // ---- the eye stalks: a bob, a look at you, a twitch now and then ----
    const Sk = M.stalks, youM = toModel([w.you.x, 0, w.you.z]);
    if (step === 'rest' && clock >= twitchAt) {
      twitchT = 0; twitchWho = rnd(6, twitchN) < 0.5 ? 'l' : 'r'; twitchSign = rnd(7, twitchN) < 0.5 ? -1 : 1;
      twitchAt = clock + Math.max(0.5, Sk.twitchEveryS + (rnd(8, twitchN++) * 2 - 1) * Sk.twitchJitterS);
    }
    twitchT += dt;
    for (const s of /** @type {const} */ (['l', 'r'])) {
      const base = model.stalks[s].base;
      const want = clamp(Math.atan2(youM[0] - base[0], youM[2] - base[2]), Sk.lookDeg * DEG);
      look[s] += (want - look[s]) * (1 - Math.exp(-dt * Sk.lookRate));
      const tw = s === twitchWho && twitchT < Sk.twitchS ? Math.sin(Math.PI * twitchT / Sk.twitchS) * Sk.twitchDeg * DEG * twitchSign : 0;
      const bobA = Math.sin(clock * Sk.bobHz * TAU + (s === 'l' ? 0 : 1.9)) * Sk.bobDeg * DEG;
      // Rearing, they lean forward to keep looking ahead; stuck, they lean back.
      pose.stalks[s] = [look[s] + tw, bobA - up * 0.6 + tw * 0.3];
    }
    poseCrawler(model, pose, bones, 0);
  }

  /** Where it is and how it looks, for the pass. @param {Float32Array} out @param {number} o @param {number} firstBone */
  function instance(out, o, firstBone) {
    const slump = brokenT < 0 ? 0 : ease(brokenT / C.motion.breakup.slumpS);
    out.set([foe.x, instY, foe.z, foe.yaw, flash, slump, firstBone, 1], o);
  }

  return {
    update, instance, pose, bones, dust, feet,
    /** Gone: broken and slumped away (its sand and motes may still be falling and rising). */
    get gone() { return brokenT >= C.motion.breakup.slumpS; },
    get glancing() { return glanceT < C.motion.glance.s; },
    get flinching() { return flinchT < C.motion.flinch.s; },
    toWorld,
  };
}

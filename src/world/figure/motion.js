// @ts-check
// The walker's motion (doc 23, W5): reads the walker (where you are, which way you face, how fast,
// the ground and water under each foot) and poses the figure's 20 bones, gently. Nothing snaps:
// pace, posture, facing and gaze all ease. The feet never slide: walking is a stride driven by
// distance; standing, the feet stay pinned and step to turn or to settle. Legs reach the ground by
// two-bone IK, the pelvis drops for the lower foot, and the hat tip, coat skirt and pack follow a
// beat late on springs. Postures (sit, kneel) and short acts (Feed, the arrival's look about and
// tug of the brim, the look up after you leave) blend over the walk. It never changes the walker.
// Live animation only; plain Math is fine (nothing here is simulated or saved).

import { moveMatrix, mul } from '../creatures/pose.js';
import { hash32 } from '../../core/rng.js';
import {
  qmul, qrot, qfromTo, qaxis, qconj, qslerp, matQuat, matPoint, matPointInv, twoBone,
  sub, norm, lerp, smooth, DEG, QI, Spring,
} from './kinematics.js';
import { paceAt, footInCycle, createPlantedFeet } from './gait.js';
import { createEyes } from './eyes.js';

/**
 * @typedef {Object} FigureInput
 * @property {number} x @property {number} z @property {number} y   feet height under the walker (m)
 * @property {number} yaw  facing (radians, body +z forward) @property {number} speed m/s
 * @property {boolean} moving @property {boolean} [retreating]
 * @property {(x: number, z: number) => number} ground  land height (m)
 * @property {(x: number, z: number) => number} [depth] water over a spot now (m)
 * @property {{ yaw: number } | null} [look]  where you look below (world yaw), if anywhere
 * @property {'stand' | 'sit' | 'kneel'} [posture]
 * @property {boolean} [below]  you are on foot (false: you went up, and the figure waits)
 * @property {boolean} [sleepy] it is night, for half lids while sitting
 */

const ID = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const wrap = (/** @type {number} */ a) => Math.atan2(Math.sin(a), Math.cos(a));
const approach = (/** @type {number} */ v, /** @type {number} */ goal, /** @type {number} */ step) => v + Math.max(-step, Math.min(step, goal - v));
const unit = (/** @type {number} */ h) => (h >>> 8) / 16777216;
/** In, hold, out: 0..1 over a short act. @param {number} u seconds in @param {number} a @param {number} hold @param {number} b */
const envelope = (u, a, hold, b) => (u < 0 ? 0 : u < a ? smooth(u / a) : u < a + hold ? 1 : 1 - smooth((u - a - hold) / b));

/**
 * @param {any} R recipes/world/figure.json
 * @param {{ name: string, parent: number, pivot: number[] }[]} skeleton from rig.js
 */
export function createFigureMotion(R, skeleton) {
  const I = /** @type {Record<string, number>} */ (Object.fromEntries(skeleton.map((b, i) => [b.name, i])));
  const out = new Float32Array(skeleton.length * 16);
  const G = R.gait, PO = R.poses;
  const piv = (/** @type {string} */ n) => skeleton[I[n]].pivot;
  const SIDE = [1, -1];
  const LEG = [['thigh.l', 'shin.l', 'foot.l'], ['thigh.r', 'shin.r', 'foot.r']].map((n) => n.map((k) => I[k]));
  const ARM = [['upperArm.l', 'foreArm.l', 'hand.l'], ['upperArm.r', 'foreArm.r', 'hand.r']].map((n) => n.map((k) => I[k]));
  const legLen = LEG.map(([a, b, c]) => Math.hypot(...sub(skeleton[b].pivot, skeleton[a].pivot)) + Math.hypot(...sub(skeleton[c].pivot, skeleton[b].pivot)));
  const restPelvisY = piv('pelvis')[1];
  // The arms hang from the A-pose by one turn at the shoulder; the elbow bends about the axis that
  // brings the hand forward once the arm hangs.
  const HANG = [0, 1].map((i) => {
    const [u, f] = ARM[i];
    const axis = norm(sub(skeleton[f].pivot, skeleton[u].pivot));
    const q0 = qfromTo(axis, [R.hang.dir[0] * SIDE[i], R.hang.dir[1], R.hang.dir[2]]);
    return { q0, flex: qrot(qconj(q0), [-1, 0, 0]) };
  });

  const eyes = createEyes(R.eyes);
  const planted = createPlantedFeet(G);
  const springs = {
    tip: new Spring(2, R.springs.hatTip), skirt: new Spring(2, R.springs.skirt), pack: new Spring(1, R.springs.pack),
    pelvis: new Spring(1, { stiffness: 420, damping: 1 }),
  };

  // Live state.
  let t = 0, phase = 0, m = 0, wade = 0, sitW = 0, kneelW = 0, aboveS = 0;
  let visYaw = /** @type {number | null} */ (null), prevYaw = 0, prevSpeed = 0, prevPelvis = 0, lookYaw = 0;
  let mode = /** @type {'plant' | 'gait'} */ ('plant');
  let last = /** @type {{ x: number, z: number } | null} */ (null);
  let footWorld = [[0, 0], [0, 0]];
  let startPins = [[0, 0], [0, 0]];
  const wasDown = [true, true];
  /** @type {{ feed: number | null, arrive: number | null, leave: number | null, retreat: number | null, retreatSide: number }} */
  const acts = { feed: null, arrive: null, leave: null, retreat: null, retreatSide: 1 };
  let wasRetreating = false;
  let info = {};

  /** Set bone i's move and its matrix (parents are always set first). @param {number} i @param {import('../creatures/pose.js').BoneMove | null} mv */
  function set(i, mv) {
    const b = skeleton[i], o = i * 16;
    const local = mv ? moveMatrix(b.pivot, mv) : null;
    if (b.parent < 0) out.set(local ?? ID, o);
    else if (local) mul(out.subarray(b.parent * 16, b.parent * 16 + 16), local, out, o);
    else out.set(out.subarray(b.parent * 16, b.parent * 16 + 16), o);
  }

  return {
    /** The bone matrices (16 floats a bone), as last posed. */
    bones: out,
    /** Kneel and offer food from an open hand. */
    feed() { acts.feed = t; },
    /** You just went down: a look about and a tug of the brim. */
    arrive() { acts.arrive = t; acts.leave = null; aboveS = 0; },
    /** You just went up: the figure looks up after you, and in a while sits to wait. */
    leave() { acts.leave = t; },
    /** @param {import('./eyes.js').Expression} e @param {number} [forS] */
    express(e, forS) { eyes.show(e, forS); },
    /** For the tools page: what the motion is doing. */
    get info() { return info; },

    /**
     * Step and pose. Returns the facing to draw with (it eases after the walker's), the eye state
     * for the shader, and any footfalls (a foot that landed this frame: world x and z, its facing and
     * which foot, 1 left and -1 right).
     * @param {number} dtIn seconds @param {FigureInput} s
     */
    update(dtIn, s) {
      const dt = Math.min(Math.max(dtIn, 0), 0.1);
      t += dt;
      // Placed somewhere new (going down elsewhere): start from rest, facing the walker's way.
      const jumped = !last || Math.hypot(s.x - last.x, s.z - last.z) > 1.5;
      last = { x: s.x, z: s.z };
      if (visYaw === null || jumped) { visYaw = s.yaw; prevYaw = s.yaw; mode = 'plant'; }

      // Facing: quick while walking, a stepped turn on the spot while standing.
      const rate = (m > 0.5 ? 360 : G.turnDegPerS) * DEG * dt;
      visYaw = /** @type {number} */ (visYaw) + Math.max(-rate, Math.min(rate, wrap(s.yaw - /** @type {number} */ (visYaw))));
      const yawRate = dt > 0 ? wrap(visYaw - prevYaw) / dt : 0;
      prevYaw = visYaw;
      const c = Math.cos(visYaw), sn = Math.sin(visYaw);
      const toWorld = (/** @type {number} */ bx, /** @type {number} */ bz) => [s.x + c * bx + sn * bz, s.z - sn * bx + c * bz];
      const toBody = (/** @type {number} */ wx, /** @type {number} */ wz) => { const dx = wx - s.x, dz = wz - s.z; return [c * dx - sn * dz, sn * dx + c * dz]; };
      const gnd = (/** @type {number} */ bx, /** @type {number} */ bz) => { const w = toWorld(bx, bz); return s.ground(w[0], w[1]) - s.y; };

      // Water, postures and pace.
      const depth = s.depth ? s.depth(s.x, s.z) : 0;
      wade = approach(wade, smooth((depth - G.wade.depthM[0]) / (G.wade.depthM[1] - G.wade.depthM[0])), dt * 3);
      aboveS = s.below === false && !s.moving ? aboveS + dt : 0;
      const still = !s.moving && s.speed < 0.05;
      const feeding = acts.feed !== null && t - acts.feed < PO.feed.reachS * 2 + PO.feed.holdS;
      if (acts.feed !== null && !feeding) acts.feed = null;
      const wantSit = still && (s.posture === 'sit' || aboveS > PO.leave.sitAfterS);
      const wantKneel = still && !wantSit && (s.posture === 'kneel' || feeding);
      const pr = dt / R.ease.postureS;
      sitW = approach(sitW, wantSit ? 1 : 0, pr);
      kneelW = approach(kneelW, wantKneel ? 1 : 0, pr);
      const standW = Math.max(0, 1 - sitW - kneelW);
      const speed = s.speed;
      m = approach(m, speed > 0.05 ? 1 : 0, dt / R.ease.settleS);
      const P = paceAt(G, speed, wade);
      const accel = dt > 0 ? (speed - prevSpeed) / dt : 0;
      prevSpeed = speed;

      // Walking and standing hand over: start a stride with the left foot about to lift; pin both
      // feet where they are when you stop, so the next step is a closing step.
      const rest = [0, 1].map((i) => skeleton[LEG[i][2]].pivot);
      if (jumped) planted.pin(rest.map((p) => toWorld(p[0], p[2])), visYaw);
      if (mode === 'plant' && speed > 0.05 && standW > 0.5) {
        mode = 'gait'; phase = G.stance; wasDown[0] = false; wasDown[1] = true;
        startPins = footWorld.map((p) => p.slice());
      }
      else if (mode === 'gait' && (speed < 0.03 || standW < 0.5)) { mode = 'plant'; planted.pin(footWorld, visYaw); }
      phase = (phase + (speed * dt) / (2 * Math.max(P.stepM, 0.05))) % 1;

      /** @type {{ x: number, z: number, yaw: number, side: number }[]} */ const footfalls = [];
      // Each foot's target: ankle (body m), toe pitch and its turn about y relative to the body.
      let plantRes = null;
      if (mode === 'plant') {
        plantRes = planted.update(dt, rest.map((p) => toWorld(p[0], p[2])), visYaw);
        plantRes.landed.forEach((l, i) => { if (l) footfalls.push({ x: plantRes.feet[i].x, z: plantRes.feet[i].z, yaw: plantRes.feet[i].yaw, side: SIDE[i] }); });
      }
      const cyc = [0, 1].map((i) => footInCycle((phase + i * 0.5) % 1, G.stance, P.stepM, P.liftM));
      const feet = [0, 1].map((i) => {
        let bx, bz, lift, pitch, yawRel;
        if (plantRes) {
          const f = plantRes.feet[i];
          [bx, bz] = toBody(f.x, f.z);
          lift = f.lift; pitch = 0; yawRel = wrap(f.yaw - visYaw);
        } else {
          const cy = cyc[i];
          bx = rest[i][0] * 0.95; bz = rest[i][2] + cy.fz; lift = cy.lift; pitch = cy.pitch; yawRel = 0;
          // The first steps ease out of where the feet stood.
          if (m < 1) { const p = toBody(startPins[i][0], startPins[i][1]); bx = lerp(p[0], bx, m); bz = lerp(p[1], bz, m); lift *= m; }
          if (cy.down && !wasDown[i]) { const w = toWorld(bx, bz); footfalls.push({ x: w[0], z: w[1], yaw: /** @type {number} */ (visYaw), side: SIDE[i] }); }
          wasDown[i] = cy.down;
        }
        // The ground under the foot, and a look ahead so a swing clears a step up.
        let g = gnd(bx, bz);
        if (lift > 0.01 && !plantRes) g = Math.max(g, gnd(bx, bz + 0.12));
        const slope = Math.atan((gnd(bx, bz + 0.1) - gnd(bx, bz - 0.1)) / 0.2);
        const lim = R.legs.footPitchMaxDeg * DEG;
        return { a: [bx, g + R.legs.ankleM + lift, bz], pitch: pitch * m + Math.max(-lim, Math.min(lim, slope)), yawRel, ground: g };
      });
      // Postures: sit (knees up, feet forward) and kneel (the right foot forward, the left knee down).
      const S = PO.sit, K = PO.kneel;
      const sitFeet = [0, 1].map((i) => { const x = S.feetX * SIDE[i]; return { a: [x, gnd(x, S.feetZ) + R.legs.ankleM, S.feetZ], pitch: 0.2 }; });
      const kneelFeet = [
        { a: [K.backAnkle[0], gnd(K.backAnkle[0], K.backAnkle[2]) + K.backAnkle[1], K.backAnkle[2]], pitch: -1.3 },
        { a: [K.front[0], gnd(K.front[0], K.front[1]) + R.legs.ankleM, K.front[1]], pitch: 0 },
      ];
      const target = [0, 1].map((i) => ({
        a: [0, 1, 2].map((k) => feet[i].a[k] * standW + sitFeet[i].a[k] * sitW + kneelFeet[i].a[k] * kneelW),
        pitch: feet[i].pitch * standW + sitFeet[i].pitch * sitW + kneelFeet[i].pitch * kneelW,
        yawRel: feet[i].yawRel * standW,
      }));
      footWorld = target.map((f) => toWorld(f.a[0], f.a[2]));

      // Pelvis: over the feet, rising and falling with each step, no higher than both legs reach.
      const bob = P.bobM * Math.cos(2 * Math.PI * 2 * (phase - G.stance / 2)) * m;
      const shift = R.idle.shiftM * Math.sin((2 * Math.PI * t) / R.idle.shiftS) * (1 - m) * standW;
      let standY = (feet[0].ground + feet[1].ground) / 2 + restPelvisY - R.legs.hipDrop - P.crouchM * m + bob;
      for (let i = 0; i < 2; i++) {
        const hip = skeleton[LEG[i][0]].pivot, f = feet[i].a;
        const horiz = Math.hypot(f[0] - hip[0] - (i === 0 ? shift : shift), f[2] - hip[2]);
        const reachY = f[1] + Math.sqrt(Math.max(0, (legLen[i] - 0.004) ** 2 - horiz * horiz));
        standY = Math.min(standY, reachY + (restPelvisY - hip[1]));
      }
      const centre = gnd(0, 0);
      const pelvisTarget = standY * standW + (centre + S.pelvisY) * sitW + (centre + K.pelvisY) * kneelW;
      const pelvisY = springs.pelvis.step([s.y + pelvisTarget], dt)[0] - s.y;
      const pelvisWorldY = s.y + pelvisY;
      const pelvisVy = dt > 0 ? (pelvisWorldY - prevPelvis) / dt : 0;
      prevPelvis = pelvisWorldY;
      const twist = P.twistDeg * DEG * Math.sin(2 * Math.PI * phase) * m * standW;
      const qPelvis = qaxis([0, 1, 0], twist);
      set(I.pelvis, { q: qPelvis, t: [shift, pelvisY - restPelvisY, 0] });

      // Leg IK in the pelvis's rest frame (worked out now, applied once the arms are posed).
      const legIK = [0, 1].map((i) => {
        const [th, sh, ft] = LEG[i];
        const T = matPointInv(out, 0, target[i].a);
        const kneelBack = i === 0 ? kneelW : 0;
        const pole = qrot(qconj(qPelvis), norm([0.15 * SIDE[i], -0.6 * kneelBack, 1]));
        const r = twoBone(skeleton[th].pivot, skeleton[sh].pivot, skeleton[ft].pivot, T, pole);
        return { ...r, knee: matPoint(out, 0, r.joint) };
      });

      // Spine and chest: the lean of the pace or posture, breathing, a counter-twist to the hips.
      const br = Math.sin((2 * Math.PI * t) / R.idle.breathS);
      const lean = ((P.leanDeg * m + 1.5 * (1 - m)) * standW + S.leanDeg * sitW + K.leanDeg * kneelW) * DEG;
      set(I.spine, { q: qaxis([1, 0, 0], lean * 0.5 + br * R.idle.breathDeg * 0.3 * DEG) });
      set(I.chest, { q: qmul(qaxis([1, 0, 0], lean * 0.5), qaxis([0, 1, 0], -twist * 0.8)), s: [1 + 0.006 * br, 1 + 0.004 * br, 1 + 0.008 * br] });

      // Head: where you look below (less while walking), idle glances, and the short acts.
      if (s.retreating && !wasRetreating) { acts.retreat = t; acts.retreatSide = unit(hash32(Math.floor(t * 10))) < 0.5 ? -1 : 1; }
      wasRetreating = !!s.retreating;
      const L = R.look;
      let yawGoal = 0, pitch = (P.headDeg * m * standW + S.headDeg * sitW + K.headDeg * kneelW) * DEG;
      if (s.look) yawGoal = Math.max(-L.maxYawDeg, Math.min(L.maxYawDeg, wrap(s.look.yaw - visYaw) / DEG)) * DEG * (1 - 0.7 * m);
      const gEvery = R.idle.glanceEveryS, beat = Math.floor(t / gEvery[1]);
      const gAt = beat * gEvery[1] + unit(hash32(11, beat)) * (gEvery[1] - 2.5);
      pitch += R.idle.glanceDeg * DEG * envelope(t - gAt, 0.6, 1.2, 0.7) * (1 - m) * standW;
      if (acts.arrive !== null) {
        const u = t - acts.arrive, A = PO.arrive;
        yawGoal += A.lookDeg * DEG * Math.sin((2 * Math.PI * u) / A.lookS) * envelope(u, 0.3, A.lookS - 0.6, 0.3);
        if (u > A.lookS + A.tugS + 1) acts.arrive = null;
      }
      if (acts.leave !== null) {
        const u = t - acts.leave, Lv = PO.leave;
        pitch += Lv.lookUpDeg * DEG * envelope(u, 0.5, Lv.lookUpS - 1, 0.5);
        if (u > Lv.lookUpS) acts.leave = null;
      }
      if (acts.retreat !== null) {
        const u = t - acts.retreat;
        yawGoal += 50 * DEG * acts.retreatSide * envelope(u, 0.4, 0.8, 0.5);
        if (u > 1.8) acts.retreat = null;
      }
      const feedU = acts.feed !== null ? t - acts.feed : -1;
      const reach = feedU >= 0 ? envelope(feedU, PO.feed.reachS, PO.feed.holdS, PO.feed.reachS) : 0;
      pitch += PO.feed.headDeg * DEG * reach;
      lookYaw = approach(lookYaw, yawGoal, L.degPerS * DEG * dt);
      const headPitch = Math.max(-L.maxPitchDeg * DEG, Math.min(L.maxPitchDeg * DEG, pitch)) - lean * 0.7;
      set(I.head, { q: qmul(qaxis([0, 1, 0], lookYaw), qaxis([1, 0, 0], headPitch)) });
      set(I.hat, null);
      // The hat tip lags: it tips back as you speed up, dips as the body rises, and swings out on a turn.
      const tip = springs.tip.step([(-0.05 * speed - 0.03 * accel + 0.5 * pelvisVy) * R.springs.hatTip.gain, -0.08 * yawRate * R.springs.hatTip.gain], dt);
      set(I.hatTip, { q: qmul(qaxis([1, 0, 0], tip[0]), qaxis([0, 0, 1], tip[1])) });

      // Arms: hanging from the A-pose and swinging with the opposite foot, or reaching by IK for a
      // knee, the brim or the ground in front.
      const chestQ = matQuat(out, I.chest * 16);
      const tugW = acts.arrive !== null ? envelope(t - acts.arrive - PO.arrive.lookS, 0.5, PO.arrive.tugS - 1, 0.5) : 0;
      const kneeHand = (/** @type {number} */ k, /** @type {number} */ dx) => [legIK[k].knee[0] + dx, legIK[k].knee[1] + 0.03, legIK[k].knee[2] + 0.06];
      for (let i = 0; i < 2; i++) {
        const [u, f, h] = ARM[i];
        const opp = cyc[1 - i];
        const swing = P.armDeg * DEG * (opp.fz / Math.max(G.stance * P.stepM, 1e-3)) * m * standW;
        const out1 = (P.armOutDeg + 3) * DEG * SIDE[i];
        let qU = qmul(qaxis([1, 0, 0], -swing), qmul(qaxis([0, 0, 1], out1), HANG[i].q0));
        const elbow = ((R.hang.elbowDeg * (1 - m) + P.elbowDeg * m) * DEG + 0.4 * Math.max(0, swing)) * standW + 0.9 * (sitW + kneelW);
        let qF = qaxis(HANG[i].flex, elbow);
        // Hand targets (body m) with a weight.
        /** @type {{ at: number[], w: number }[]} */ const goals = [];
        if (sitW > 0) goals.push({ at: kneeHand(i, -0.02 * SIDE[i]), w: sitW });
        if (kneelW > 0) goals.push({ at: i === 1 && reach > 0 ? [0, 1, 2].map((k) => lerp(kneeHand(1, 0.03)[k], [PO.feed.hand[0], centre + PO.feed.hand[1], PO.feed.hand[2]][k], reach)) : kneeHand(1, i === 0 ? 0.06 : -0.02), w: kneelW });
        if (i === 0 && tugW > 0) goals.push({ at: PO.arrive.tugHand, w: tugW });
        const w = Math.min(1, goals.reduce((a, g) => a + g.w, 0));
        if (w > 0.001) {
          const at = [0, 1, 2].map((k) => goals.reduce((a, g) => a + g.at[k] * g.w, 0) / goals.reduce((a, g) => a + g.w, 0));
          const T = matPointInv(out, I.chest * 16, at);
          const pole = qrot(qconj(chestQ), norm([0.4 * SIDE[i], -0.3, -1]));
          const r = twoBone(skeleton[u].pivot, skeleton[f].pivot, skeleton[h].pivot, T, pole);
          qU = qslerp(qU, r.q1, w);
          qF = qslerp(qF, r.q2, w);
        }
        set(u, { q: qU });
        set(f, { q: qF });
        set(h, null);
      }

      // Legs: the IK turns, then each foot set to the ground's slope and its own facing.
      for (let i = 0; i < 2; i++) {
        const [th, sh, ft] = LEG[i];
        set(th, { q: legIK[i].q1 });
        set(sh, { q: legIK[i].q2 });
        const want = qmul(qaxis([0, 1, 0], target[i].yawRel), qaxis([1, 0, 0], -target[i].pitch));
        set(ft, { q: qmul(qconj(matQuat(out, sh * 16)), want) });
      }

      // The coat skirt: pushed forward by the front knee, dragged back a little by speed, swung on
      // a turn; over the thighs when sitting.
      const kneeFwd = Math.max(legIK[0].knee[2], legIK[1].knee[2]) - 0.04;
      const sk = springs.skirt.step([
        ((Math.max(0, kneeFwd) * 1.4 - 0.03 * speed) * standW + S.skirtDeg * DEG * sitW + 0.25 * kneelW) * R.springs.skirt.gain,
        -0.05 * yawRate * R.springs.skirt.gain,
      ], dt);
      set(I.skirt, { q: qmul(qaxis([1, 0, 0], -sk[0]), qaxis([0, 0, 1], sk[1])) });
      // The pack follows the body's rise and fall a beat late.
      const pk = springs.pack.step([pelvisWorldY], dt)[0];
      set(I.pack, { t: [0, (pk - pelvisWorldY) * R.springs.pack.gain, 0], q: qaxis([1, 0, 0], -0.01 * accel) });

      const eyeState = eyes.update(dt, { sleepy: !!s.sleepy && sitW > 0.5 });
      info = { mode, m, wade, sitW, kneelW, phase, pace: P, expression: eyes.expression };
      return { yaw: visYaw, eyes: eyeState, footfalls };
    },
  };
}

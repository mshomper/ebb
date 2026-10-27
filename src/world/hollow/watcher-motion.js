// @ts-check
// A hagstone watcher alive (H2, doc 16; CLAUDE.md, the creature rule): what its rig and its light do from
// moment to moment, read from its steps in foes.js (rest, notice, close, wind, strike, recover) and the
// hits it takes. The stone is rigid, so its life is the float, the turn and the weed, plus the hole's
// light. It hovers, bobbing and drifting a little, rolling slowly, and tilts to look at the light it has
// noticed. Each wrack blade is a chain of bones on lagging springs: it sways in its own slow current,
// streams back from the stone's movement and its turn, keeps hanging however the stone tilts, and flares
// out in the tell. The hole's light: faint and slowly breathing at rest, cool; warmer as it notices the
// lantern; building bright over the 1.5 s tell; a pulse for the call with a ring of light running out
// over the floor (and a cue for a sound); dim when the lantern is snuffed or it is Unmade, when it can't
// build the call. A hit rocks it back and flashes it; breaking, it drops to the floor dark and sinks
// away in grit and motes of light. Every bit of variation is seeded (src/core/rng.js). Pure: the caller
// gives the clock, the ground, the lamp and you. Numbers: recipes/world/hollow.json foes.watcher.stone.

import { stream } from '../../core/rng.js';
import { axisAngle, poseSkeleton } from '../creatures/pose.js';
import { qmul } from './crawler-rig.js';
import { createDust } from './crawler-dust.js';

const DEG = Math.PI / 180, TAU = Math.PI * 2;
/** Floats per watcher for the pass: at (x, y, z, yaw), look (flash, hole cd/m2, first bone, warmth), floor (ring radius, ring cd/m2, pool cd/m2, ground y), hole (its middle in the world, radius). */
export const WATCHER_FLOATS = 16;
/** Bones a watcher: the root and four blades of five (the pass keeps this many matrices each). */
export const WATCHER_BONES = 21;
const ease = (/** @type {number} */ x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const clamp = (/** @type {number} */ v, /** @type {number} */ m) => Math.max(-m, Math.min(m, v));
const wrap = (/** @type {number} */ a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * @typedef {{ x: number, z: number, yaw: number, step: string, t: number, stunS: number, broken: boolean,
 *   hits: { front: number, side: number, back: number }, lureS?: number, unmade?: boolean }} WatcherFoe the watcher as foes.js gives it
 * @typedef {{ ground: (x: number, z: number) => number, you: { x: number, z: number },
 *   lamp: { x: number, z: number, y?: number, snuffed?: boolean } }} WatcherWorld
 */

/**
 * @param {WatcherFoe} foe @param {import('./watcher-model.js').WatcherModel} model
 * @param {any} K recipes/world/hollow.json foes.watcher (read live; its stone block is the drawing's) @param {number} seed
 * @param {(cue: 'tell' | 'call', at: number[]) => void} [onCue] a hook for sounds: the tell starting, the call
 */
export function createWatcherMotion(foe, model, K, seed, onCue) {
  const S = K.stone;
  const bones = new Float32Array(WATCHER_BONES * 16);
  const dust = createDust(seed);
  const rnd = (/** @type {number} */ key) => stream(seed, 0x776174, key).next();
  const NB = (model.skeleton.length - 1) / model.blades.length;
  const blades = model.blades.map((b, i) => ({ root: b.root, phase: rnd(i + 1) * TAU, chain: Array.from({ length: NB }, () => ({ a: 0, b: 0, va: 0, vb: 0 })) }));
  const phase = { bob: rnd(10) * TAU, dx: rnd(11) * TAU, dz: rnd(12) * TAU, roll: rnd(13) * TAU, breath: rnd(14) * TAU };
  let lastX = foe.x, lastZ = foe.z, lastYaw = foe.yaw, vx = 0, vz = 0, yawRate = 0;
  let nits = S.look.restNits, warm = 0, flare = 0, pitch = 0, prevStep = foe.step;
  let callT = 9, hits = { ...foe.hits }, flinchT = 9, flash = 0, brokenT = -1, instY = 0, groundY = 0, dropFrom = 0;
  /** @type {import('../creatures/pose.js').BoneMove[]} */
  const moves = model.skeleton.map(() => ({}));

  /** Model space to the world. @param {number[]} p */
  const toWorld = (p) => { const c = Math.cos(foe.yaw), s = Math.sin(foe.yaw); return [foe.x + c * p[0] + s * p[2], instY + p[1], foe.z - s * p[0] + c * p[2]]; };

  /** @param {number} dt @param {number} clock @param {WatcherWorld} w */
  function update(dt, clock, w) {
    if (dt <= 0) return;
    const L = S.look, M = S.motion, Wd = M.weed, step = foe.step;
    groundY = w.ground(foe.x, foe.z);
    // How it is moving (world), eased, and how fast it turns.
    const ax = (foe.x - lastX) / dt, az = (foe.z - lastZ) / dt, k = 1 - Math.exp(-dt * 8);
    vx += (ax - vx) * k; vz += (az - vz) * k;
    yawRate += (wrap(foe.yaw - lastYaw) / dt - yawRate) * (1 - Math.exp(-dt * 8));
    lastX = foe.x; lastZ = foe.z; lastYaw = foe.yaw;
    if (step !== prevStep) {
      if (step === 'wind') onCue?.('tell', toWorld([model.hole.x, model.hole.y, 0]));
      if (step === 'strike' && prevStep === 'wind') { callT = 0; onCue?.('call', toWorld([model.hole.x, model.hole.y, 0])); }
      prevStep = step;
    }
    callT += dt;
    // Hits: it rocks back and flashes.
    const h = foe.hits;
    if (h.front + h.side + h.back > hits.front + hits.side + hits.back) { flinchT = 0; flash = 1; }
    hits = { ...h };
    flinchT += dt; flash = Math.max(0, flash - dt / 0.18);
    if (foe.broken && brokenT < 0) {
      brokenT = 0; dropFrom = instY - groundY;
      const from = [];
      for (let i = 0; i < model.stoneVerts; i += 29) from.push(toWorld([model.positions[i * 3], model.positions[i * 3 + 1], model.positions[i * 3 + 2]]));
      dust.breakup(M.breakup, from);
    }
    dust.update(dt, w.ground);

    // ---- the hole's light ----
    const dim = !!(w.lamp.snuffed || foe.unmade);
    const lured = (foe.lureS ?? 0) > 0;
    let want = L.restNits * (1 + L.breathShare * Math.sin(clock * L.breathHz * TAU + phase.breath));
    let warmWant = lured ? 0.6 : 0;
    if (step === 'notice' || step === 'close') { want = L.noticeNits; warmWant = 1; }
    if (step === 'wind') { want = L.noticeNits + (L.tellNits - L.noticeNits) * ease(foe.t / K.windS); warmWant = 1; }
    if (step === 'strike' || (step === 'recover' && callT < M.call.pulseS * 3)) {
      // The call: a pulse at its brightest, falling back.
      want = L.tellNits + (L.callNits - L.tellNits) * Math.exp(-callT / M.call.pulseS) * (callT < 0.06 ? callT / 0.06 : 1);
      warmWant = 1;
    } else if (step === 'recover') want = L.restNits * 0.6;
    if (dim) { want = L.dimNits; warmWant = 0; }
    if (brokenT >= 0) want = 0;
    // The tell and the call follow at once; anything else eases (so a snuff fades it).
    const quick = (step === 'wind' || step === 'strike') && !dim;
    // Breaking puts it out quickly; a snuff fades it.
    nits = quick ? want : nits + (want - nits) * (1 - Math.exp(-dt * M.warmRate * (brokenT >= 0 ? 6 : want < nits ? 2 : 1)));
    warm += (warmWant - warm) * (1 - Math.exp(-dt * M.warmRate));
    // The weed flares out in the tell and settles after the call.
    const flareWant = step === 'wind' && !dim ? ease(foe.t / K.windS) : step === 'strike' ? 1 : 0;
    flare += (flareWant - flare) * (1 - Math.exp(-dt * (flareWant > flare ? 6 : 1.5)));

    // ---- the float: hover, bob, drift, roll; it tilts to look at the light it has noticed ----
    const hover = M.hoverM;
    let lift = M.bobM * Math.sin(clock * M.bobHz * TAU + phase.bob);
    const kick = callT < M.call.pulseS ? Math.sin(Math.PI * callT / M.call.pulseS) * M.call.kickM : 0;
    lift += kick;
    instY = groundY + hover;
    if (brokenT >= 0) {
      // Breaking: it drops to the floor, dark (falling faster as it goes), then sinks away into it.
      brokenT += dt;
      const Bk = M.breakup, u = Math.min(1, brokenT / Bk.dropS), restY = model.heightM * 0.5 - 0.02;
      instY = groundY + dropFrom + (restY - dropFrom) * u * u;
      if (brokenT > Bk.dropS) instY -= (model.heightM + 0.05) * ease((brokenT - Bk.dropS) / Bk.goneS);
      lift = 0;
    }
    const lookAt = (step === 'notice' || step === 'close' || step === 'wind' || step === 'strike') && !dim;
    let pitchWant = 0;
    if (lookAt) {
      const ly = w.lamp.y ?? groundY + 1, d = Math.hypot(w.lamp.x - foe.x, w.lamp.z - foe.z);
      pitchWant = clamp(Math.atan2(ly - (instY + lift), Math.max(d, 0.5)), M.lookDeg * DEG);
    }
    pitch += (pitchWant - pitch) * (1 - Math.exp(-dt * M.lookRate));
    const fl = flinchT < M.flinch.s ? Math.sin(Math.PI * flinchT / M.flinch.s) : 0;
    const roll = Math.sin(clock * M.bobHz * 0.6 * TAU + phase.roll) * M.rollDeg * DEG;
    const tilt = pitch + fl * M.flinch.tiltDeg * DEG;
    const drift = brokenT >= 0 ? [0, 0] : [Math.sin(clock * M.driftHz * TAU + phase.dx) * M.driftM, Math.sin(clock * M.driftHz * 0.8 * TAU + phase.dz) * M.driftM];
    moves[0] = { q: qmul(axisAngle([0, 0, 1], roll), axisAngle([1, 0, 0], -tilt)), t: [drift[0], lift, drift[1]] };

    // ---- the weed: lagging springs on each bone ----
    const c = Math.cos(foe.yaw), s = Math.sin(foe.yaw);
    const lvx = c * vx - s * vz, lvz = s * vx + c * vz; // its velocity in model space
    blades.forEach((b, bi) => {
      // The blade's root moves with the stone and with its turn (round the middle).
      const rvx = lvx + yawRate * b.root[2], rvz = lvz - yawRate * b.root[0];
      const sp = Math.hypot(rvx, rvz), drag = Wd.dragDeg * DEG * Math.min(1, sp / Wd.dragMps);
      // Where the tip should swing (radians toward +x and toward +z): back against its way...
      let toX = sp > 1e-4 ? -rvx / sp * drag : 0, toZ = sp > 1e-4 ? -rvz / sp * drag : 0;
      // ...round against the turn (the turn's own push, so blades near the middle stream too)...
      const rl = Math.hypot(b.root[0], b.root[2]) || 1, ox = b.root[0] / rl, oz = b.root[2] / rl;
      const turn = clamp(yawRate / (Wd.turnDegPerS * DEG), 1) * Wd.turnDeg * DEG;
      toX -= oz * turn; toZ += ox * turn;
      // ...and out from the middle in the tell.
      toX += ox * flare * Wd.flareDeg * DEG; toZ += oz * flare * Wd.flareDeg * DEG;
      b.chain.forEach((bone, j) => {
        const cur = Wd.currentDeg * DEG, ph = clock * Wd.currentHz * TAU + b.phase - j * 0.7;
        // A hanging bone turned about z swings its tip toward +x; about x, toward -z.
        let wantB = toX / NB + Math.sin(ph) * cur / NB * (1 + j * 0.3);
        let wantA = -toZ / NB + Math.cos(ph * 0.8 + 1) * cur * 0.7 / NB * (1 + j * 0.3);
        // The first bone keeps the blade hanging however the stone tips.
        if (j === 0) { wantA += tilt * 0.85; wantB += -roll * 0.85; }
        // Later bones lag: softer springs down the chain.
        const st = Wd.stiffness * (1 - Wd.lagShare * j / Math.max(1, NB - 1));
        bone.va += (st * (wantA - bone.a) - Wd.damping * bone.va) * dt;
        bone.vb += (st * (wantB - bone.b) - Wd.damping * bone.vb) * dt;
        bone.a = clamp(bone.a + bone.va * dt, Wd.maxDeg * DEG / NB * 1.2);
        bone.b = clamp(bone.b + bone.vb * dt, Wd.maxDeg * DEG / NB * 1.2);
        moves[1 + bi * NB + j] = { q: qmul(axisAngle([0, 0, 1], bone.b), axisAngle([1, 0, 0], bone.a)) };
      });
    });
    poseSkeleton(model.skeleton, moves, bones, 0);
  }

  /** Where it is and how it looks, for the pass. @param {Float32Array} out @param {number} o @param {number} firstBone */
  function instance(out, o, firstBone) {
    const M = S.motion.call, ringU = callT / M.ringS;
    const ring = ringU < 1 ? [M.ringM * ease(Math.sqrt(ringU)), M.ringNits * (1 - ringU)] : [0, 0];
    const h = holeAt();
    out.set([foe.x, instY, foe.z, foe.yaw, flash, nits, firstBone, warm, ring[0], ring[1], nits * S.look.floorLight, groundY, h[0], h[1], h[2], model.hole.rM], o);
  }
  /** The hole's middle in the world, as the root carries it. */
  function holeAt() {
    const p = [model.hole.x, model.hole.y, 0], B = bones;
    return toWorld([0, 1, 2].map((r) => B[r] * p[0] + B[4 + r] * p[1] + B[8 + r] * p[2] + B[12 + r]));
  }

  return {
    update, instance, bones, dust, blades,
    /** The hole's light now (cd/m2), how warm it is (0 cool, 1 warm), the weed's flare (0..1). */
    get nits() { return nits; }, get warm() { return warm; }, get flare() { return flare; }, get pitch() { return pitch; },
    /** Seconds since the call (large when it has not called). */
    get callT() { return callT; },
    /** The hole's middle in the world now. */
    holeAt,
    /** Gone: broken and sunk away (its grit and motes may still be falling and rising). */
    get gone() { return brokenT >= S.motion.breakup.dropS + S.motion.breakup.goneS; },
    toWorld,
  };
}

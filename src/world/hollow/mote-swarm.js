// @ts-check
// A mote cluster's motes, one by one (H2, doc 16: a swarm of 5 that drifts in, bunches up, darts in
// to nip and scatters from the light). The cluster's steps run in foes.js and say where the swarm is
// and what it is doing; this works out each mote round it for drawing: where it floats, how fast it
// moves, which way it faces, its squash and stretch, its eyes and the smoky trail behind it. The
// shader (lib-mote.wgsl) does the rest. Each mote has its own seeded phase, swirl and lag, so a
// swarm never moves in lockstep; blinks are seeded too (src/core/rng.js, never Math.random). Pure:
// the caller gives the clock, the ground, the lantern and you. Numbers: recipes/world/hollow.json
// foes.motes.mote.

import { stream } from '../../core/rng.js';

/** Floats per mote for the shader (lib-mote.wgsl Mote), and per trail puff (x, y, z, size, alpha, 0, 0, 0). */
export const MOTE_FLOATS = 16;
export const PUFF_FLOATS = 8;
const TAU = Math.PI * 2;
const ease = (/** @type {number} */ x) => x * x * (3 - 2 * x);

/**
 * @typedef {{ x: number, z: number, yaw: number, step: string, t: number, stunS: number, hurtS: number, broken: boolean,
 *   members: number[][] }} SwarmFoe the cluster as foes.js gives it (members: [phase, speed, radius], seeded)
 * @typedef {{ ground: (x: number, z: number) => number, lamp: { x: number, z: number, reachM: number, raised: boolean },
 *   you: { x: number, z: number } }} SwarmWorld
 */

/**
 * @param {SwarmFoe} foe @param {any} M recipes/world/hollow.json foes.motes.mote (read live) @param {number} seed
 * @param {number} acrossM the model's own size across (mote-model.js), so a mote follows M.sizeM live
 */
export function createSwarm(foe, M, seed, acrossM) {
  const motes = foe.members.map(([phase, speed, radius], i) => {
    const rnd = stream(seed, 0x6d6f7465, i);
    return {
      phase, speed, radius, i,
      /** Its own lag behind the swarm (0..1 of offsetS). */ lag: rnd.next(),
      x: foe.x, y: 0, z: foe.z, vx: 0, vy: 0, vz: 0, yaw: foe.yaw, placed: false,
      blinkAt: 0, blinkN: 0, widen: 0, opening: false, squint: 0, nipS: 0, lit: false,
      /** @type {{ x: number, y: number, z: number, age: number, k: number }[]} */ puffs: [], puffWait: 0,
    };
  });
  for (const m of motes) m.blinkAt = nextBlink(m, 0);
  let lastStep = foe.step, lastStun = 0;
  const out = new Float32Array(motes.length * MOTE_FLOATS);

  /** When this mote next blinks, seeded. @param {typeof motes[0]} m @param {number} now */
  function nextBlink(m, now) {
    const E = M.eyes, u = stream(seed, 0x626c6e6b, m.i, m.blinkN++).next();
    return now + Math.max(0.6, E.blinkEveryS + (u * 2 - 1) * E.blinkJitterS);
  }

  /**
   * Where a mote should be now, round the swarm's middle. @param {typeof motes[0]} m @param {number} clock
   * @param {SwarmWorld} w @returns {[number, number, number]}
   */
  function target(m, clock, w) {
    const D = M.drift, step = foe.step;
    const a = m.phase + clock * D.swirlHz * TAU * m.speed;
    let spread = 1;
    let ox = 0, oz = 0;
    if (step === 'wind') spread = M.tell.tightShare;
    else if (step === 'strike') spread = M.tell.tightShare * 1.3;
    else if (step === 'recover') {
      // Scatter: a burst outward, away from the light if it is raised near, else away from you.
      const burst = foe.t < M.scatter.burstS ? ease(foe.t / M.scatter.burstS) : 1;
      const back = Math.max(0, 1 - Math.max(0, foe.t - M.scatter.burstS) / 1.2);
      spread = 1 + (M.scatter.scatterShare - 1) * burst * back;
      const lampD = Math.hypot(foe.x - w.lamp.x, foe.z - w.lamp.z);
      const fromLamp = w.lamp.raised && lampD < w.lamp.reachM + 1.5;
      const fx = fromLamp ? w.lamp.x : w.you.x, fz = fromLamp ? w.lamp.z : w.you.z, l = Math.hypot(foe.x - fx, foe.z - fz) || 1;
      ox = ((foe.x - fx) / l) * m.radius * (spread - 1) * 0.6;
      oz = ((foe.z - fz) / l) * m.radius * (spread - 1) * 0.6;
    }
    const r = m.radius * spread;
    const x = foe.x + Math.sin(a) * r + ox, z = foe.z + Math.cos(a) * r + oz;
    // Each floats at its own height round heightM, a little higher the further out it swirls.
    const y = w.ground(x, z) + M.heightM + (m.radius - 0.3) * 0.5 + Math.sin(a * 1.7 + m.i) * 0.08 * spread;
    return [x, y, z];
  }

  /**
   * One step. @param {number} dt @param {number} clock seconds (the arena's clock; holds still in a hit-stop) @param {SwarmWorld} w
   */
  function update(dt, clock, w) {
    if (dt <= 0) return;
    const step = foe.step, F = M.follow, E = M.eyes;
    // The nip: a dart that just ended.
    if (lastStep === 'strike' && step !== 'strike') for (const m of motes) m.nipS = M.dart.nipS;
    // A light move (a stun with the light: Kindling burst, Wick snare) or a fresh hit: eyes wide.
    const stunned = foe.stunS > lastStun + 0.05 || foe.hurtS > 0.15;
    lastStep = step; lastStun = foe.stunS;
    for (const m of motes) {
      const [tx, ty, tz] = target(m, clock, w);
      if (!m.placed) { m.x = tx; m.y = ty; m.z = tz; m.placed = true; }
      const tau = 1 / (step === 'strike' ? F.dartRate : F.rate) + F.offsetS * m.lag;
      const k = 1 - Math.exp(-dt / tau);
      const nx = m.x + (tx - m.x) * k, ny = m.y + (ty - m.y) * k, nz = m.z + (tz - m.z) * k;
      // Its speed, eased a little so a single jump never flickers the stretch.
      const s = 1 - Math.exp(-dt * 20);
      m.vx += ((nx - m.x) / dt - m.vx) * s; m.vy += ((ny - m.y) / dt - m.vy) * s; m.vz += ((nz - m.z) / dt - m.vz) * s;
      m.x = nx; m.y = ny; m.z = nz;
      // Facing: at you while it winds up and darts, else along its way once it moves, else as it was.
      const flat = Math.hypot(m.vx, m.vz);
      const want = step === 'wind' || step === 'strike' ? Math.atan2(w.you.x - m.x, w.you.z - m.z)
        : flat > 0.25 ? Math.atan2(m.vx, m.vz) : m.yaw;
      const dy = Math.atan2(Math.sin(want - m.yaw), Math.cos(want - m.yaw));
      m.yaw += dy * (1 - Math.exp(-dt * 6));
      // Eyes: a seeded blink now and then; wide when the raised lantern first reaches it, or a light move lands.
      if (clock >= m.blinkAt + E.blinkS) m.blinkAt = nextBlink(m, clock);
      const lit = w.lamp.raised && Math.hypot(m.x - w.lamp.x, m.z - w.lamp.z) < w.lamp.reachM;
      if ((lit && !m.lit) || stunned) m.opening = true;
      m.lit = lit;
      // Quick to open (widenInS), slow to settle (widenOutS).
      if (m.opening) { m.widen = Math.min(1, m.widen + dt / E.widenInS); if (m.widen >= 1) m.opening = false; }
      else m.widen = Math.max(0, m.widen - dt / E.widenOutS);
      const squintTo = step === 'wind' ? 1 : 0;
      m.squint += (squintTo - m.squint) * (1 - Math.exp(-dt * (squintTo ? 12 : 6)));
      m.nipS = Math.max(0, m.nipS - dt);
      // The trail: puffs left behind while it moves fast.
      const T = M.trail, speed = Math.hypot(m.vx, m.vy, m.vz), share = Math.min(1, Math.max(0, (speed - T.fromMps) / (T.fullMps - T.fromMps)));
      for (const p of m.puffs) p.age += dt;
      m.puffs = m.puffs.filter((p) => p.age < T.lifeS);
      m.puffWait -= dt;
      if (share > 0 && m.puffWait <= 0) {
        m.puffs.push({ x: m.x, y: m.y, z: m.z, age: 0, k: share });
        m.puffWait = T.lifeS / T.puffs;
        if (m.puffs.length > T.puffs) m.puffs.shift();
      }
    }
  }

  /** The motes for the shader, MOTE_FLOATS each. @param {number} clock */
  function instances(clock) {
    const D = M.dart, E = M.eyes, scale = M.sizeM / acrossM;
    motes.forEach((m, i) => {
      const o = i * MOTE_FLOATS, speed = Math.hypot(m.vx, m.vy, m.vz);
      const stretch = Math.min(1, speed / D.stretchMps) * D.stretch;
      const wind = foe.step === 'wind' ? Math.min(1, foe.t / 0.15) : 0;
      const nip = m.nipS > 0 ? Math.sin(Math.PI * (1 - m.nipS / D.nipS)) : 0;
      const squash = M.tell.squash * wind + D.nipSquash * nip;
      const into = clock - m.blinkAt, lids = into >= 0 && into < E.blinkS ? Math.sin(Math.PI * into / E.blinkS) : 0;
      out.set([m.x, m.y, m.z, m.yaw,
        speed > 1e-3 ? m.vx / speed : 0, speed > 1e-3 ? m.vy / speed : 0, speed > 1e-3 ? m.vz / speed : 0, stretch,
        squash, m.phase, scale, M.tell.quiverM * wind,
        lids, ease(m.widen), m.squint, 1], o);
    });
    return out;
  }

  /** The trail's puffs, PUFF_FLOATS each, oldest first. */
  function puffs() {
    const T = M.trail, all = motes.flatMap((m) => m.puffs), f = new Float32Array(all.length * PUFF_FLOATS);
    all.forEach((p, i) => {
      const life = p.age / T.lifeS;
      f.set([p.x, p.y, p.z, T.sizeM * (0.6 + 0.8 * life), T.alpha * p.k * (1 - life) * (1 - life), 0, 0, 0], i * PUFF_FLOATS);
    });
    return f;
  }

  return { update, instances, puffs, get count() { return motes.length; }, motes };
}

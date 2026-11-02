// @ts-check
// The teal on their pond, live (B3 wave 3): a small flock on the water, each bird swimming to a
// spot near the others and dabbling, up-ending, preening or floating there; at night most sleep
// with their heads on their backs. Birds that come later fly in and land on the water.
//   flush    the walker inside the flock's ring at Wary (or inside panicShare of it): each bird
//            springs up steeply off the water a moment after the last, climbing on round the pond
//            the way that leads away from you, the flock circles it fast and low, leaning into the
//            turn, then drops onto the water on the side furthest from you
//   aside    past Wary, a bird inside the ring swims off to the far side instead
//   around   once they know you (their group moment), with you standing still near the water,
//            they swim in close to where you stand
//   leave    a visit's birds (or birds no longer wanted) rise and fly off away from the pond
// No two birds on the water come closer than spacingM. Positions are drawn metres; the poses are
// real metres on the rig (motion.js). Live only: seeded for its own looks, never saved.

import { hash32 } from '../../core/rng.js';
import { ringScale } from '../creatures/presence.js';
import { poseBird, preenPose } from '../creatures/bird-motion.js';
import { swimPose, dabblePose, upendPose, sleepPose, risePose, tealFlyPose, splashPose, TOUCH } from './motion.js';

/**
 * @typedef {{ id: number, x: number, z: number, y: number, yaw: number, mode: string, t: number, dur: number,
 *   tx: number, tz: number, dist: number, beat: number, lag: number, then: string, gone: boolean,
 *   a: number, turned: number, h: number, from: number[] | null, spin: number, roll: number, pose?: any }} Bird
 *   y: drawn metres above the water's surface; mode: swim, float, dabble, upend, preen, sleep, wait,
 *   rise, fly, land, away; a: its angle round the pond in flight; turned: how far round it has flown;
 *   h: how high it flies this time; from: where a rise or a landing began; spin: which way round
 *   the pond it flies (1 or -1); roll: its lean into a turn now; pose: its pose this frame
 */

/**
 * @param {{ L: any, P: any, M: any, k: number, seed: number, water: (x: number, z: number) => { surface: number, depth: number } }} o
 *   L: the species recipe's life; P: its presence; M: recipes/birds/teal.json motion; k: drawn size
 */
export function createTealLife(o) {
  const { L, P, M, k } = o;
  /** @type {Bird[]} */ let birds = [];
  let clock = 0, n = 0, nextId = 1, settleIn = 0;
  const rnd = () => (hash32(o.seed, 0x7ea1 + n++) >>> 8) / 16777216;
  /** @param {number[]} r */ const between = (r) => r[0] + rnd() * (r[1] - r[0]);
  /** @type {{ x: number, z: number, r: number } | null} */ let pond = null;

  const wet = (/** @type {number} */ x, /** @type {number} */ z) => o.water(x, z).depth >= L.minDepthM;
  /** A spot on the pond near (x, z) within r, on water deep enough. @param {number} x @param {number} z @param {number} r */
  function spotNear(x, z, r) {
    for (let i = 0; i < 14; i++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r, px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d;
      if (wet(px, pz) && (!pond || Math.hypot(px - pond.x, pz - pond.z) <= pond.r)) return { x: px, z: pz };
    }
    return pond && wet(pond.x, pond.z) ? { x: pond.x, z: pond.z } : { x, z };
  }
  /** The pond's water furthest from (x, z). @param {number} x @param {number} z */
  function farSide(x, z) {
    if (!pond) return { x, z };
    let best = { x: pond.x, z: pond.z }, bd = -1;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      for (const s of [0.8, 0.55, 0.3]) {
        const px = pond.x + Math.sin(a) * pond.r * s, pz = pond.z + Math.cos(a) * pond.r * s;
        if (!wet(px, pz)) continue;
        const d = Math.hypot(px - x, pz - z);
        if (d > bd) { bd = d; best = { x: px, z: pz }; }
        break;
      }
    }
    return best;
  }

  /** Begin a mode. @param {Bird} b @param {string} mode @param {number} dur */
  const begin = (b, mode, dur) => { b.mode = mode; b.t = 0; b.dur = dur; };
  /** The middle of the birds on the water (or the pond's). */
  function middle() {
    const on = birds.filter((b) => !b.gone);
    if (!on.length) return pond ? { x: pond.x, z: pond.z } : { x: 0, z: 0 };
    return { x: on.reduce((s, b) => s + b.x, 0) / on.length, z: on.reduce((s, b) => s + b.z, 0) / on.length };
  }

  /** Add a bird: on the water now (start) or flying in from far off. @param {boolean} now */
  function add(now) {
    if (!pond) return;
    const s = spotNear(pond.x, pond.z, pond.r * 0.7);
    /** @type {Bird} */ const b = { id: nextId++, x: s.x, z: s.z, y: 0, yaw: rnd() * Math.PI * 2, mode: 'float', t: 0, dur: between(L.idleS),
      tx: s.x, tz: s.z, dist: 0, beat: rnd(), lag: 0, then: 'float', gone: false, a: 0, turned: 0, h: 0, from: null, spin: 1, roll: 0 };
    if (!now) {
      // In from far off, low, onto the water at s.
      const a = rnd() * Math.PI * 2;
      b.from = [s.x + Math.sin(a) * L.inFromM, between(L.flyUpM) * 1.5, s.z + Math.cos(a) * L.inFromM];
      b.x = b.from[0]; b.z = b.from[2]; b.y = b.from[1];
      b.yaw = Math.atan2(s.x - b.x, s.z - b.z);
      begin(b, 'land', Math.max(L.landS, (3 * L.inFromM) / L.flyMps));
    }
    birds.push(b);
  }

  /** Lift a bird off: after its lag it rises, then circles (then 'land' at tx, tz) or flies away. @param {Bird} b @param {number} lag @param {string} then */
  function rise(b, lag, then) {
    b.then = then;
    begin(b, 'wait', lag);
  }

  /** Choose what a bird on the water does next. @param {Bird} b @param {{ night: boolean, around?: { x: number, z: number } | null }} c */
  function next(b, c) {
    const r = rnd();
    if (c.night && r < L.sleepShare) { begin(b, 'sleep', between(L.sleepS)); return; }
    if (c.around) {
      const a = rnd() * Math.PI * 2, d = between([P.around.nearM, P.around.farM]);
      const px = c.around.x + Math.sin(a) * d, pz = c.around.z + Math.cos(a) * d;
      if (wet(px, pz)) { b.tx = px; b.tz = pz; begin(b, 'swim', 0); return; }
    }
    if (r < L.dabbleShare) begin(b, 'dabble', M.dabble.s);
    else if (r < L.dabbleShare + L.upendShare) begin(b, 'upend', M.upend.s);
    else if (r < L.dabbleShare + L.upendShare + L.preenShare) begin(b, 'preen', M.preen.s);
    else if (r < 0.85) {
      const m = middle(), s = spotNear(m.x, m.z, L.spreadM);
      b.tx = s.x; b.tz = s.z; begin(b, 'swim', 0);
    } else begin(b, 'float', between(L.idleS));
  }

  /** In the air this frame (rising, circling, leaving or gliding in). @param {Bird} b */
  const flyingNow = (b) => ['rise', 'fly', 'away', 'land'].includes(b.mode);
  /** Turn toward a heading, eased. @param {Bird} b @param {number} want @param {number} rate */
  const steer = (b, want, rate) => { let d = want - b.yaw; d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2; b.yaw += d * Math.min(1, rate); };

  /**
   * One frame. @param {number} dt real seconds
   * @param {{ count: number, pond: { x: number, z: number, r: number } | null, night: boolean,
   *   walker: import('../creatures/presence.js').PresenceSource | null, trust: number, band: number,
   *   leave?: boolean, around?: { x: number, z: number } | null, placeNow?: boolean }} c
   *   count: birds wanted; pond: where they live (its middle and reach, drawn metres); band: 0 Wary,
   *   1 Tolerant, 2 Curious; leave: all of them fly off; around: swim in near this spot; placeNow: birds
 *   added now are on the water already (a flock already here when the island opens), not flying in
   * @returns {string[]} what happened this frame ('flushed' when the flock rose from you)
   */
  function step(dt, c) {
    clock += dt;
    /** @type {string[]} */ const said = [];
    const first = !!c.placeNow;
    if (c.pond) pond = c.pond;
    const live = () => birds.filter((b) => !b.gone && b.mode !== 'away');
    while (!c.leave && live().length < c.count && pond) add(first);
    for (const b of live().slice(c.count)) if (b.mode !== 'rise' && b.mode !== 'wait') rise(b, rnd() * 0.5, 'away');
    if (c.leave) for (const b of live()) if (b.mode !== 'rise' && b.mode !== 'wait' && b.mode !== 'fly') rise(b, rnd() * 0.6, 'away');

    // The walker: a flush at Wary (or too close), swimming off past it.
    const w = c.walker;
    settleIn -= dt;
    const ring = Math.max(P.ringMinM, P.ringM * (1 - P.ringTrustShrink * c.trust));
    const onWater = (/** @type {Bird} */ b) => !['wait', 'rise', 'fly', 'land', 'away'].includes(b.mode);
    if (w && !c.leave && pond) {
      let flush = false;
      for (const b of live()) {
        if (!onWater(b)) continue;
        const d = Math.hypot(w.pos[0] - b.x, w.pos[2] - b.z), rr = ring * (w.ringK ?? 1) * ringScale(w, b.x, b.z, P.multipliers);
        if (d > rr) continue;
        if (c.band === 0 || d < rr * P.panicShare * (c.band >= 2 ? 0.5 : 1)) flush = true;
        else if (b.then !== 'aside' || b.mode !== 'swim') {
          const far = farSide(w.pos[0], w.pos[2]), s = spotNear(far.x, far.z, L.spreadM * 0.6);
          b.tx = s.x; b.tz = s.z; b.then = 'aside'; begin(b, 'swim', 0);
        }
      }
      if (flush && settleIn <= 0) {
        const far = farSide(w.pos[0], w.pos[2]), m = middle();
        // Round the pond the way that leads away from you: the circle's heading at the flock's
        // middle (a turning +1, sin a, cos a out from the pond) against the line from you to it.
        const am = Math.atan2(m.x - pond.x, m.z - pond.z);
        const spin = Math.cos(am) * (m.x - w.pos[0]) - Math.sin(am) * (m.z - w.pos[2]) >= 0 ? 1 : -1;
        let lag = 0;
        for (const b of live()) {
          if (!onWater(b)) continue;
          const s = spotNear(far.x, far.z, L.spreadM * 0.7);
          b.tx = s.x; b.tz = s.z; b.spin = spin;
          rise(b, lag, 'circle');
          lag += between(L.riseLagS);
        }
        settleIn = between(L.settleS) + L.riseS + L.lapS + L.landS;
        said.push('flushed');
      }
    }

    for (const b of birds) {
      if (b.gone) continue;
      b.t += dt;
      const yaw0 = b.yaw;
      const u = b.dur > 0 ? Math.min(1, b.t / b.dur) : 0;
      /** @type {any} */ let P0;
      if (b.mode === 'wait') {
        // Turning on the water to the way it will go: on round the pond (or on as it was, leaving).
        if (b.then === 'circle' && pond) { const a = Math.atan2(b.x - pond.x, b.z - pond.z); steer(b, Math.atan2(b.spin * Math.cos(a), -b.spin * Math.sin(a)), dt * 6); }
        P0 = swimPose(clock, b.dist / M.swim.strideM, 0.6, M, b.id);
        if (b.t >= b.dur) { b.h = between(L.flyUpM); b.from = [b.x, b.y, b.z]; begin(b, 'rise', L.riseS); }
      } else if (b.mode === 'rise') {
        b.beat += dt * M.flap.hz;
        const r = risePose(clock, u, b.beat, M);
        P0 = r.pose;
        b.y = r.climb * b.h;
        // Up steeply but moving on, as far along as climbDeg makes of its height: the climb comes
        // first (r.climb), so the path is steepest off the water and levels out into flight.
        const f = b.from ?? [b.x, 0, b.z], on = (b.h / Math.tan(M.rise.climbDeg * Math.PI / 180)) * u;
        b.x = f[0] + Math.sin(b.yaw) * on; b.z = f[2] + Math.cos(b.yaw) * on;
        if (u >= 1) {
          if (b.then === 'away' || !pond) { begin(b, 'away', L.awayS); }
          else {
            b.a = Math.atan2(b.x - pond.x, b.z - pond.z);
            b.turned = 0;
            begin(b, 'fly', L.lapS);
          }
        }
      } else if (b.mode === 'fly' && pond) {
        // Round the pond, fast and low, the way it rose: always flying forward, steering for a
        // point a little ahead on the circle, so it swings out onto it and round (never slid sideways).
        const R = pond.r + L.circleOutM;
        const a = Math.atan2(b.x - pond.x, b.z - pond.z), ahead = a + b.spin * L.aheadRad;
        b.turned += Math.abs(((a - b.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI); b.a = a;
        steer(b, Math.atan2(pond.x + Math.sin(ahead) * R - b.x, pond.z + Math.cos(ahead) * R - b.z), dt * L.steerK);
        b.x += Math.sin(b.yaw) * L.flyMps * dt; b.z += Math.cos(b.yaw) * L.flyMps * dt;
        b.beat += dt * M.flap.hz;
        P0 = tealFlyPose(clock, b.beat, M);
        // The glide in takes long enough that it never comes in faster than it flew (it slows
        // as it comes down, so it starts at about 1.5 times the glide's mean speed).
        if (b.t >= b.dur) { b.from = [b.x, b.y, b.z]; begin(b, 'land', Math.max(L.landS, (3 * Math.hypot(b.tx - b.x, b.tz - b.z)) / L.flyMps)); }
      } else if (b.mode === 'away') {
        b.beat += dt * M.flap.hz;
        b.x += Math.sin(b.yaw) * L.flyMps * dt; b.z += Math.cos(b.yaw) * L.flyMps * dt;
        b.y += L.climbMps * dt;
        P0 = tealFlyPose(clock, b.beat, M);
        if (b.t >= b.dur) { b.gone = true; continue; }
      } else if (b.mode === 'land' && b.from) {
        // Glide in from where it was to its spot on the water, touching down at TOUCH, skidding on.
        const f = b.from, s = Math.min(1, u / TOUCH), e = 1 - Math.pow(1 - s, 2);
        const skid = u > TOUCH ? Math.min(1, (u - TOUCH) / (1 - TOUCH)) : 0;
        const dx = b.tx - f[0], dz = b.tz - f[2], dl = Math.hypot(dx, dz) || 1;
        b.x = f[0] + dx * e + (dx / dl) * L.skidM * Math.sin(skid * Math.PI / 2);
        b.z = f[2] + dz * e + (dz / dl) * L.skidM * Math.sin(skid * Math.PI / 2);
        b.y = u < TOUCH ? f[1] * Math.pow(1 - s, 1.6) : 0;
        if (u < TOUCH) steer(b, Math.atan2(dx, dz), dt * 4);
        P0 = splashPose(clock, u, M);
        if (u >= 1) { b.y = 0; b.from = null; b.then = 'float'; begin(b, 'float', between(L.idleS)); }
      } else if (b.mode === 'swim') {
        const dx = b.tx - b.x, dz = b.tz - b.z, d = Math.hypot(dx, dz);
        const v = Math.min(d, L.swimMps * (b.then === 'aside' ? 1.6 : 1) * dt);
        if (d > 1e-3) steer(b, Math.atan2(dx, dz), dt * 3);
        const nx = b.x + Math.sin(b.yaw) * v, nz = b.z + Math.cos(b.yaw) * v;
        if (wet(nx, nz)) { b.x = nx; b.z = nz; } else { b.tx = b.x; b.tz = b.z; }
        b.dist += v / k;
        P0 = swimPose(clock, b.dist / M.swim.strideM, 1, M, b.id);
        if (d - v < 0.05 || b.t > 40) { b.then = 'float'; next(b, c); }
      } else {
        // On the water in place: dabbling, up-ending, preening, asleep or floating.
        if (b.mode === 'dabble') P0 = dabblePose(clock, u, M);
        else if (b.mode === 'upend') P0 = upendPose(clock, u, M);
        else if (b.mode === 'preen') P0 = preenPose(clock, u, M);
        else if (b.mode === 'sleep') P0 = sleepPose(clock, M);
        else P0 = swimPose(clock, b.dist / M.swim.strideM, 0, M, b.id);
        if (b.t >= b.dur) next(b, c);
      }
      // Leaning into a turn in the air (as fast as it turns, up to bankDeg), level on the water.
      const turn = flyingNow(b) ? ((b.yaw - yaw0 + Math.PI * 3) % (Math.PI * 2) - Math.PI) / Math.max(dt, 1e-4) : 0;
      const bank = Math.max(-1, Math.min(1, Math.atan(L.flyMps * turn / 9.8) / (M.fly.bankDeg * Math.PI / 180))) * M.fly.bankDeg * Math.PI / 180;
      b.roll += (-bank - b.roll) * Math.min(1, dt * 4);
      if (P0) P0.bodyRoll = b.roll;
      b.pose = P0;
    }
    birds = birds.filter((b) => !b.gone);

    // No two on the water closer than spacingM: each pair pushed apart along the line between them.
    const on = birds.filter(onWater);
    for (let i = 0; i < on.length; i++) for (let j = i + 1; j < on.length; j++) {
      const a = on[i], b = on[j], dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      if (d >= L.spacingM) continue;
      const push = (L.spacingM - d) / 2, ux = d > 1e-4 ? dx / d : 1, uz = d > 1e-4 ? dz / d : 0;
      if (wet(a.x - ux * push, a.z - uz * push)) { a.x -= ux * push; a.z -= uz * push; }
      if (wet(b.x + ux * push, b.z + uz * push)) { b.x += ux * push; b.z += uz * push; }
    }
    return said;
  }

  return {
    step,
    middle,
    /** The birds now (drawn metres; y above the water). */
    birds: () => birds,
    /** One bird's bone moves now. @param {import('../creatures/bird-rig.js').BirdRig} rig @param {Bird & { pose?: any }} b */
    moves: (rig, b) => poseBird(rig, b.pose ?? swimPose(clock, 0, 0, M, b.id), M),
    /** Is it in the air? @param {Bird} b */
    flying: (b) => ['rise', 'fly', 'land', 'away'].includes(b.mode) && b.y > 0.01,
  };
}

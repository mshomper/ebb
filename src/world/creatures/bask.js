// @ts-check
// Turtles basking (M2 European pond turtles; docs 12, 23; turtle life TL2 to TL6): by day each one
// swims to a basking spot near its group's home (a stone, a log or the raft: the seats the pieces
// publish in the store, src/world/creatures/spring-live.js), climbs out and rests there in the sun.
// When spots are few they stack, one on another's back. At night and in winter they sit low in the
// water. A fast swoop close by or an edit beside them sends them sliding into the water, to stay
// under a while.
//
// Basking (TL4) it breathes, its limbs pumping in and out, blinks, turns its head slowly or stretches it\n// up to the sun, yawns now and then, and dries from glossy to matte.\n//\n// Startled (TL5), they slip off one by one, a plop each, hide under the water, then pop their heads up\n// to peek back at the spot before they come back.\n//\n// Swimming (TL2) is stroke and glide: the diagonal pairs of legs sweep in turn and push it on, then
// it glides with its flippers laid back until it slows. Now and then one dives and swims along
// under the surface, then comes up to hang at the periscope, nose and eyes out, sometimes turned to
// face you. Its pose follows what it is doing (rigs/turtle.js).
//
// Live animation only (never saved): a seeded stream per group and a fixed step rate, as patrol.js.
// Plain Math is fine here. Numbers from turtle.json's motion block. Same shape as school.js and
// patrol.js, so the live schools system (schools.js) runs it.

import { stream } from '../../core/rng.js';
import { poseState, easeWeights, poseTurtle, noseY, haulPath, haulS, slidePath } from './rigs/turtle.js';

const DEG = Math.PI / 180;

/**
 * @typedef {{ x: number, y: number, z: number, r: number, kind?: string, room?: number, yaw?: number, inWater?: boolean }} Seat
 *   a basking spot: its top's middle (y), how far across it is (r), how many turtles it holds (room),
 *   and for a log or the raft the way its length runs (yaw)
 * @typedef {{ x: number, y: number, z: number, vx: number, vy: number, vz: number, roll: number, pitch: number, yaw: number,
 *   look: number, lookTo: number, nextLook: number, mode: string, until: number,
 *   goal: { x: number, z: number }, seat: number, from: { x: number, y: number, z: number } | null, under: number,
 *   spd: number, depth: number, gliding: boolean, glideUntil: number, facing: boolean, faceTo?: number, lookUpTo?: number,
 *   slideAt?: number, calm?: boolean, rest?: { x: number, y: number, z: number }, peekAt?: { x: number, z: number },
 *   id: number, t: number, w: Record<string, number>, ph: number, stroke: number, haulK: number, slideK: number,
 *   lookUp: number, jaw: number, wet: number }} Turtle
 *   and its pose (rigs/turtle.js TurtlePose). seat: the spot it is bound for or on (-1 none); from:
 *   where a climb or slide began; under: until when it stays under; spd: its speed through the water;
 *   depth: how far under the surface it means to swim (0 at the surface); facing: the periscope
 *   turned toward you
 * @typedef {{ water: (x: number, z: number) => { surface: number, depth: number }, ground: (x: number, z: number) => number,
 *   seats: () => Seat[], ring?: (x: number, z: number) => void, viewer?: () => ArrayLike<number> | null }} BaskEnv
 *   ring: rings on the water where one slid in; viewer: where you are (the camera's eye, or you on foot)
 */

/**
 * @param {{ id: number, seed: number, count: number, home: { x: number, z: number }, deep: { x: number, z: number },
 *   size: number, M: any, env: BaskEnv, bones?: { name: string, pivot: number[] }[] }} o
 *   bones: the recipe's body.bones (for the periscope's nose height)
 */
export function createBask(o) {
  const { M, env } = o;
  const P = M.pose, SW = M.swim, W = M.walk, B = M.bask, S5 = M.startle;
  const rng = stream(o.seed >>> 0, 0xba5c, o.id);
  /** @type {Turtle[]} */ const fish = [];
  let home = { ...o.home }, t = 0, fleeUntil = -1;
  /** @type {'day'|'night'|'winter'} */ let mood = 'day';
  const range = (/** @type {number[]} */ r) => r[0] + (r[1] - r[0]) * rng.next();
  // The shell's height, drawn: how far one turtle sits above the one it stacks on.
  const shellH = 0.045 * o.size;
  const bones = o.bones ?? [];

  /** A point in water near home, at least minDepthM deep (home if none turns up). */
  function wanderPoint() {
    for (let i = 0; i < 12; i++) {
      const a = rng.next() * Math.PI * 2, d = Math.sqrt(rng.next()) * M.leashM;
      const x = home.x + Math.cos(a) * d, z = home.z + Math.sin(a) * d;
      if (env.water(x, z).depth >= M.minDepthM) return { x, z };
    }
    return { ...home };
  }

  /** Whether each spot is by the water, kept a while by its place. @type {Map<string, { ok: boolean, at: number }>} */
  const nearWater = new Map();
  /**
   * A spot a turtle will walk to: in the water, or on the shore within W.landReachM of water deep
   * enough to swim (never up a hill). @param {Seat} s
   */
  function byWater(s) {
    if (s.inWater) return true;
    const key = `${s.x.toFixed(2)},${s.z.toFixed(2)}`;
    const c = nearWater.get(key);
    if (c && t - c.at < 5) return c.ok;
    let ok = false;
    for (let k = 0; k < 12 && !ok; k++) {
      const a = (k / 12) * Math.PI * 2;
      for (const d of [W.landReachM * 0.5, W.landReachM]) if (env.water(s.x + Math.cos(a) * d, s.z + Math.sin(a) * d).depth >= W.swimDepthM) ok = true;
    }
    nearWater.set(key, { ok, at: t });
    return ok;
  }

  /**
   * The places to bask near home, nearest spot first: each spot holds `room` turtles (a stone's top
   * one or two, the second on the first's back; a log or the raft a few side by side). Turtles past
   * the places there are stay in the water.
   * @returns {{ s: Seat, k: number }[]}
   */
  function placesNear() {
    const r2 = M.baskReachM * M.baskReachM;
    return env.seats().filter((s) => (s.x - home.x) ** 2 + (s.z - home.z) ** 2 <= r2 && byWater(s))
      .sort((a, b) => ((a.x - home.x) ** 2 + (a.z - home.z) ** 2) - ((b.x - home.x) ** 2 + (b.z - home.z) ** 2))
      .flatMap((s) => Array.from({ length: Math.max(1, s.room ?? 1) }, (_, k) => ({ s, k })));
  }

  /**
   * Where a turtle rests in place k on a spot: on a stone the second climbs onto the first's back; on
   * a log or the raft they lie side by side. @param {Seat} s @param {number} k
   */
  function restOn(s, k) {
    if (s.kind === 'log' || s.kind === 'raft') {
      const a = s.yaw ?? 0, off = (k - ((s.room ?? 1) - 1) / 2) * M.sideM;
      return { x: s.x + Math.sin(a) * off, y: s.y, z: s.z + Math.cos(a) * off };
    }
    const a = (o.id * 1.7) % (Math.PI * 2), off = Math.min(s.r * 0.4, k * M.stackM);
    return { x: s.x + Math.cos(a) * off, y: s.y + k * shellH * 0.7, z: s.z + Math.sin(a) * off };
  }

  function spawn(/** @type {number} */ n) {
    for (let i = 0; i < n; i++) {
      const p = wanderPoint();
      const w = env.water(p.x, p.z);
      fish.push({ ...poseState(o.id * 100 + fish.length, 'swim'), x: p.x, y: w.surface - SW.surfaceM * o.size, z: p.z, vx: 0, vy: 0, vz: 0,
        roll: 0, pitch: 0, yaw: rng.next() * 6.283, look: 0, lookTo: 0, nextLook: range(M.lookEveryS), mode: 'swim', until: range(M.turnEveryS),
        goal: wanderPoint(), seat: -1, from: null, under: 0, spd: 0, depth: 0, gliding: false, glideUntil: 0, facing: false });
    }
  }
  spawn(o.count);

  /**
   * Send every turtle on a seat back into the water, one by one (TL5): each slips off a moment after
   * the one before, in no set order. Startled (not calm) they then hide under the water.
   * @param {boolean} calm evening or winter coming on: in without hiding
   */
  function slideAll(calm) {
    const on = fish.filter((f) => (f.mode === 'bask' || f.mode === 'climb' || f.mode === 'shuffle') && f.slideAt === undefined);
    let at = t + (calm ? range(S5.calmFirstS) : range(S5.firstS));
    for (let n = on.length; n > 0; n--) {
      const f = on.splice(Math.floor(rng.next() * n), 1)[0];
      f.slideAt = at; f.calm = calm;
      at += range(calm ? S5.calmGapS : S5.gapS);
    }
  }

  /**
   * Startled: dive and hide under the water a while, swimming off away from the spot it left (or
   * anywhere), then up to peek back at it. @param {Turtle} f @param {{ x: number, z: number }} [from]
   */
  function hide(f, from) {
    f.mode = 'hide'; f.depth = range(S5.hideDepthM); f.under = t + range(S5.hideS); f.gliding = false; f.seat = -1;
    f.peekAt = from ? { x: from.x, z: from.z } : undefined;
    f.goal = wanderPoint();
    if (from) {
      const d = range(S5.fleeM), gx = f.x + Math.sin(f.yaw) * d, gz = f.z + Math.cos(f.yaw) * d;
      if (env.water(gx, gz).depth >= M.minDepthM) f.goal = { x: gx, z: gz };
    }
  }

  /** Begin the slip off its spot, forward, the way it faces the water. @param {Turtle} f */
  function startSlide(f) {
    f.mode = 'slide'; f.from = { x: f.x, y: f.y, z: f.z }; f.slideK = 0; f.slideAt = undefined; f.seat = -1;
    f.goal = wanderPoint();
  }

  /** Turn the yaw toward a heading by at most rate*dt. @param {Turtle} f @param {number} to @param {number} rate rad/s @param {number} dt */
  function turnToward(f, to, rate, dt) {
    let d = to - f.yaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    f.yaw += Math.max(-rate * dt, Math.min(rate * dt, d));
    return Math.abs(d);
  }

  /**
   * Stroke and glide toward (tx, tz) wanting speed `want`: the pairs of legs sweep in turn (the
   * stroke's phase f.ph), each sweep a push; after a full stroke at speed it may glide, flippers
   * laid back, until it slows. It swims the way it faces, turning as it goes.
   * @param {Turtle} f @param {number} tx @param {number} tz @param {number} want m/s @param {number} dt
   */
  function paddle(f, tx, tz, want, dt) {
    const dx = tx - f.x, dz = tz - f.z, d = Math.hypot(dx, dz);
    if (d > 0.02) turnToward(f, Math.atan2(dx, dz), SW.turnRadS * (f.gliding ? 0.3 : 1), dt);
    const pS = P.swim.strokeS / Math.max(0.4, want / Math.max(1e-3, M.paddleMps));
    if (f.gliding) {
      if (t >= f.glideUntil || f.spd < want * SW.glideUntilShare || want <= 0) f.gliding = false;
    } else if (want > 0) {
      const before = f.ph % 1;
      f.ph += dt / pS;
      const after = f.ph % 1;
      // Each sweep pushes it on: the two pairs' power strokes, a half-sine each.
      const pw = (/** @type {number} */ s) => (s >= 0 && s < P.swim.power ? Math.sin((s / P.swim.power) * Math.PI) : 0);
      const push = pw(after) + pw((after - P.swim.pairGap + 1) % 1);
      f.spd += push * SW.thrustMps2 * (want / Math.max(1e-3, M.paddleMps)) * dt;
      // Past the stroke, at speed: a glide, now and then.
      const hold = P.swim.pairGap + P.swim.power + 0.05;
      if (before < hold && after >= hold && f.spd >= want * 0.8 && rng.next() < SW.glideChance) {
        f.gliding = true; f.glideUntil = t + range(SW.glideS);
      }
    } else {
      // Hanging still: a slow scull keeps the legs turning over.
      f.ph += dt / (P.swim.strokeS * 2.5);
    }
    f.spd -= f.spd * SW.dragPerS * dt;
    if (d < 0.05) f.spd *= 1 - Math.min(1, dt * 3);
    f.stroke = f.gliding ? 1 : want > 0 ? 1 : 0.15;
    // A glide holds the stroke at its laid-back hold.
    if (f.gliding) f.ph = Math.floor(f.ph) + P.swim.pairGap + P.swim.power + 0.1;
    let nx = f.x + Math.sin(f.yaw) * f.spd * dt, nz = f.z + Math.cos(f.yaw) * f.spd * dt;
    // A turtle swims; it does not run aground.
    if (env.water(nx, nz).depth < 0.04 && f.seat < 0) { nx = f.x; nz = f.z; f.spd *= 0.5; f.goal = wanderPoint(); }
    f.vx = (nx - f.x) / Math.max(dt, 1e-6); f.vz = (nz - f.z) / Math.max(dt, 1e-6);
    f.x = nx; f.z = nz;
    return d;
  }

  /**
   * Hold it at its depth: at the surface the shell top just under and the head out; under, as deep
   * as it means to go and clear of the bottom, pitched nose down going down and up coming up.
   * @param {Turtle} f @param {number} dt @param {number} sink extra meters under (night, winter)
   */
  function holdDepth(f, dt, sink) {
    const w = env.water(f.x, f.z);
    const floor = w.surface - w.depth + SW.bottomClearM * o.size;
    const top = w.surface - SW.surfaceM * o.size - sink;
    const want = f.depth > 0 ? Math.max(floor, top - f.depth) : top;
    const dy = want - f.y;
    const vy = Math.max(-SW.diveMps, Math.min(SW.riseMps, dy * 2));
    f.vy = vy;
    f.y += vy * dt;
    // Nose down diving, nose up rising, level otherwise; a swimming turtle's shell is level.
    const pitch = Math.atan2(vy, Math.max(0.05, f.spd)) * SW.pitchShare;
    f.pitch += (Math.max(-SW.maxPitchDeg * DEG, Math.min(SW.maxPitchDeg * DEG, pitch)) - f.pitch) * Math.min(1, dt * 2);
    f.roll *= 0.9;
  }

  /** Up to the periscope: nose and eyes just out, shell tipped up. @param {Turtle} f @param {number} dt */
  function holdPeriscope(f, dt) {
    const w = env.water(f.x, f.z);
    f.pitch += (P.peri.pitchDeg * DEG - f.pitch) * Math.min(1, dt * 1.5);
    const y = w.surface + P.peri.noseM * o.size - noseY(bones, f, M) * o.size;
    f.y += (y - f.y) * Math.min(1, dt * 2.5);
    f.vy = 0;
    f.spd *= 1 - Math.min(1, dt * 2);
    f.x += Math.sin(f.yaw) * f.spd * dt; f.z += Math.cos(f.yaw) * f.spd * dt;
    f.ph += dt / (P.swim.strokeS * 2.5);
    f.stroke = 0.15;
    // Turned to face you (or, peeking after a fright, back at the spot it left): the whole body
    // comes round by sculling, the head straight at it.
    const v = f.facing ? env.viewer?.() : f.peekAt ? [f.peekAt.x, 0, f.peekAt.z] : null;
    if (v) {
      const to = Math.atan2(v[0] - f.x, v[2] - f.z);
      turnToward(f, to, SW.faceRadS, dt);
      // The head gets there first.
      let d = to - f.yaw;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      f.lookTo = Math.max(-M.headTurnRad, Math.min(M.headTurnRad, d));
    }
  }

  /**
   * Start the haul-out onto place i: turned to face the spot, from where it is now.
   * @param {Turtle} f @param {number} i
   */
  function startClimb(f, i) {
    f.mode = 'climb'; f.seat = i; f.from = { x: f.x, y: f.y, z: f.z }; f.haulK = 0; f.spd = 0; f.depth = 0;
  }

  /** A wander in the water: a new goal, and now and then a dive. @param {Turtle} f */
  function newWander(f) {
    f.goal = wanderPoint(); f.until = t + range(M.turnEveryS);
    const w = env.water(f.goal.x, f.goal.z);
    f.depth = mood === 'day' && rng.next() < SW.diveChance && w.depth > SW.diveMinM ? range(SW.diveM) : 0;
  }

  return {
    id: o.id,
    fish,
    centre() {
      let x = 0, y = 0, z = 0;
      for (const f of fish) { x += f.x; y += f.y; z += f.z; }
      const n = Math.max(1, fish.length);
      return { x: x / n, y: y / n, z: z / n };
    },
    rehome(/** @type {{ x: number, z: number }} */ h) {
      if ((h.x - home.x) ** 2 + (h.z - home.z) ** 2 < 1) return;
      home = { ...h };
      for (const f of fish) if (f.mode === 'swim') f.goal = wanderPoint();
    },
    resize(/** @type {number} */ n) { if (n > fish.length) spawn(n - fish.length); else fish.length = Math.max(0, n); },
    setMood(/** @type {'day'|'night'|'winter'} */ m) {
      if (m !== 'day' && mood === 'day') slideAll(true);
      mood = m;
    },
    startle() {
      fleeUntil = t + M.fleeS;
      // Those on a spot slip off one by one; those swimming dive at once and hide.
      slideAll(false);
      for (const f of fish) {
        if (f.mode === 'climb') f.slideAt = t;
        if (['swim', 'under', 'peri', 'peek', 'graze', 'bottom'].includes(f.mode)) hide(f);
      }
    },
    get darting() { return fleeUntil > t; },
    setVisit() {},
    /** Turtles take no food from you (yet: lily leaves, doc 12). */
    feed() {},
    get feeding() { return false; },
    /** @param {number} dt */
    step(dt) {
      t += dt;
      // Who rests where: by day, out of the water, the places near home are shared out in turn.
      const places = mood === 'day' && t >= fleeUntil ? placesNear() : [];
      fish.forEach((f, i) => {
        f.t += dt;
        // The head looks about now and then; basking, slower, and often stretched up to the sun.
        const basking = f.mode === 'bask';
        if (t >= f.nextLook) {
          f.lookTo = (rng.next() * 2 - 1) * M.headTurnRad;
          f.lookUpTo = basking ? range(B.lookUpRad) : 0;
          f.nextLook = t + range(basking ? B.lookEveryS : M.lookEveryS);
        }
        const ease = Math.min(1, dt * (basking ? B.lookEaseHz : 1.5));
        f.look += (f.lookTo - f.look) * ease;
        f.lookUp += ((f.lookUpTo ?? 0) - f.lookUp) * ease;
        // Wet from the water, it dries in the sun: glossy to matte (the creature shader's dry).
        if (basking || f.mode === 'shuffle' || f.mode === 'walk') f.wet = Math.max(0, f.wet - dt / B.dryS);
        else if (f.mode !== 'climb') f.wet = Math.min(1, f.wet + dt / B.wetS);
        easeWeights(f, dt, P);
        if (f.mode === 'bask' || f.mode === 'climb' || f.mode === 'shuffle') {
          // Its turn to slip off (one by one after a startle, or as evening comes on); till then it
          // stays put where it rests.
          if (f.slideAt !== undefined) {
            if (t >= f.slideAt) startSlide(f);
            else if (f.mode !== 'climb' && f.rest) { f.x = f.rest.x; f.y = f.rest.y; f.z = f.rest.z; }
            return;
          }
          const p = places[f.seat];
          if (!p) { slideAll(true); return; }
          const at = restOn(p.s, p.k);
          f.rest = at;
          if (f.mode === 'climb') {
            // The haul-out (TL3): front claws reach over the edge, the shell tips up, the hind legs
            // heave it over in two shoves, a pause (rigs/turtle.js haulPath). A low step goes quicker.
            const rise = at.y - (f.from?.y ?? at.y);
            f.haulK = Math.min(1, f.haulK + (dt / haulS(P)) * (rise < W.lowStepM * o.size ? W.lowStepPace : 1));
            const path = haulPath(f.haulK, P), from = f.from ?? at;
            turnToward(f, Math.atan2(at.x - from.x, at.z - from.z), W.turnRadS * 2, dt);
            f.x = from.x + (at.x - from.x) * path.h; f.z = from.z + (at.z - from.z) * path.h;
            f.y = from.y + (at.y - from.y) * path.v;
            f.pitch = path.pitch;
            if (f.haulK >= 1) {
              // Then round to face the water it came from, as they bask, ready to slip back in.
              f.mode = 'shuffle';
              f.faceTo = Math.atan2(from.x - at.x, from.z - at.z);
              // On a log or the raft they lie across it, side by side, on the side they came from.
              if (p.s.kind === 'log' || p.s.kind === 'raft') {
                const across = (p.s.yaw ?? 0) + Math.PI / 2;
                f.faceTo = Math.cos(f.faceTo - across) >= 0 ? across : across + Math.PI;
              }
            }
          } else if (f.mode === 'shuffle') {
            f.x = at.x; f.y = at.y; f.z = at.z; f.pitch *= 0.9;
            f.ph += dt / P.walk.strideS;
            if (turnToward(f, f.faceTo ?? f.yaw, W.turnRadS, dt) < 0.05) { f.mode = 'bask'; }
          } else { f.x = at.x; f.y = at.y; f.z = at.z; f.pitch *= 0.9; }
          return;
        }
        if (f.mode === 'walk') {
          // On land or in the shallows (TL3): a slow diagonal walk, to its spot or back to the water.
          const p = places[f.seat];
          const target = p ? p.s : f.goal;
          const dx = target.x - f.x, dz = target.z - f.z, d = Math.hypot(dx, dz);
          turnToward(f, Math.atan2(dx, dz), W.turnRadS, dt);
          f.ph += dt / P.walk.strideS;
          const nx = f.x + Math.sin(f.yaw) * W.walkMps * dt, nz = f.z + Math.cos(f.yaw) * W.walkMps * dt;
          f.vx = (nx - f.x) / dt; f.vz = (nz - f.z) / dt;
          f.x = nx; f.z = nz;
          const g = env.ground(f.x, f.z);
          f.y += (g - f.y) * Math.min(1, dt * 4);
          // The shell follows the slope under it.
          const L = 0.09 * o.size;
          const slope = Math.atan2(env.ground(f.x + Math.sin(f.yaw) * L, f.z + Math.cos(f.yaw) * L) - env.ground(f.x - Math.sin(f.yaw) * L, f.z - Math.cos(f.yaw) * L), 2 * L);
          f.pitch += (slope - f.pitch) * Math.min(1, dt * 3);
          if (p && d <= p.s.r + W.reachM * o.size) startClimb(f, f.seat);
          else if (env.water(f.x, f.z).depth > W.swimDepthM) { f.mode = 'swim'; f.spd = W.walkMps; }
          else if (!p && d < 0.1) f.goal = wanderPoint();
          return;
        }
        if (f.mode === 'slide') {
          // The slip off (TL5): forward the way it faces, nose dipping, down into the water
          // (rigs/turtle.js slidePath).
          f.slideK = Math.min(1, f.slideK + dt / P.slide.s);
          const k = f.slideK, from = f.from ?? f, path = slidePath(k, P);
          const out = S5.slideM * o.size;
          const ex = from.x + Math.sin(f.yaw) * out, ez = from.z + Math.cos(f.yaw) * out;
          const ew = env.water(ex, ez);
          const endY = ew.depth > 0.02 ? ew.surface - (SW.surfaceM + 0.01) * o.size : env.ground(ex, ez);
          f.x = from.x + (ex - from.x) * path.h; f.z = from.z + (ez - from.z) * path.h;
          f.y = from.y + (endY - from.y) * path.v;
          f.pitch = path.pitch;
          // In with a plop and rings on the water (heard as a plop, recipes/audio/game.json pond.plops);
          // off a spot on the shore it lands on its feet and walks to the water.
          if (k >= 1) {
            newWander(f);
            if (env.water(f.x, f.z).depth > 0.02) {
              env.ring?.(f.x, f.z);
              f.spd = 0.1;
              if (f.calm) f.mode = 'swim';
              else hide(f, from);
            } else f.mode = 'walk';
            f.calm = undefined;
          }
          return;
        }
        if (f.mode === 'hide') {
          // Under, tucked, swimming off; then up for a look.
          paddle(f, f.goal.x, f.goal.z, M.paddleMps * S5.hideSpeedShare, dt);
          holdDepth(f, dt, 0);
          if (t >= f.under) { f.mode = 'peek'; f.until = t + range(S5.peekS); f.depth = 0; f.facing = !!env.viewer && rng.next() < S5.peekFaceChance; }
          return;
        }
        if (f.mode === 'peri' || f.mode === 'peek') {
          holdPeriscope(f, dt);
          if (t >= f.until) { f.mode = 'swim'; f.facing = false; f.peekAt = undefined; newWander(f); }
          return;
        }
        // Swimming: to its place by day (if there is one for it), else about home.
        const seatI = i < places.length && t >= f.under ? i : -1;
        f.seat = seatI;
        const target = seatI >= 0 ? places[seatI].s : f.goal;
        if (seatI < 0 && t >= f.until) newWander(f);
        const tx = target.x, tz = target.z;
        if (seatI >= 0 && Math.hypot(tx - f.x, tz - f.z) <= places[seatI].s.r + W.reachM * o.size) { startClimb(f, seatI); return; }
        // Too shallow to swim: it walks out (to a spot on the shore).
        if (env.water(f.x, f.z).depth < W.walkDepthM) { f.mode = 'walk'; f.spd = 0; return; }
        // Bound for a spot it swims at the surface; at night and in winter it barely moves.
        if (seatI >= 0) f.depth = 0;
        const want = mood === 'day' ? M.paddleMps : M.paddleMps * SW.nightShare;
        const d = paddle(f, tx, tz, want, dt);
        holdDepth(f, dt, mood === 'day' ? 0 : SW.nightSinkM * o.size);
        f.mode = f.depth > 0 && f.y < env.water(f.x, f.z).surface - (SW.surfaceM + 0.03) * o.size ? 'under' : 'swim';
        // Reaching its goal at the surface (or coming up from a dive), now and then it stops to look
        // about at the periscope, sometimes turned to you.
        if (seatI < 0 && mood === 'day' && d < 0.3 && rng.next() < SW.periPerS * dt) {
          f.mode = 'peri'; f.until = t + range(SW.periS); f.depth = 0;
          f.facing = !!env.viewer && rng.next() < SW.faceChance;
        }
      });
    },
  };
}

/**
 * The bone moves for one turtle (rigs/turtle.js): its layers blended, its head looking about.
 * @param {{ name: string, parent: number, pivot?: number[] }[]} rig @param {Turtle} f @param {any} M
 * @param {number[]} q the root's turn (pitch and roll)
 * @param {(a: number[], angle: number) => number[]} axisAngle
 */
export function poseBask(rig, f, M, q, axisAngle) {
  return poseTurtle(rig, /** @type {any} */ (f), M, q, axisAngle);
}

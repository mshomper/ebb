// @ts-check
// Live frogs (S6b-2, docs 11, 12): what each frog the hourly tick keeps is doing right now. They
// run on a steady step of real time (recipe motion.stepHz), so at 4x speed the sun races but a
// hop takes as long as ever; their moods follow the hour of the day and the frog's mood from the
// tick. Each frog draws its choices from its own seeded stream, so a test run repeats.
//   rest     by day: still at its spot near its home on the bank, now and then a small shuffle
//   forage   when active: a short hop along the bank, then a flick or two of the tongue
//   call     content frogs at dusk: the throat swells; no call starts within gapS of another
//   swim     a hop into the shallows (never deeper than lilies grow), a few kicks, an eyes-up float,
//            then a hop back out
//   arrive   a frog new to the pond comes up out of the water near its home and hops ashore
//   leave    a frog that moves on (or goes to sleep for the winter) slips into the water and sinks
// Hops never land within spacing.hopBodies body lengths of another frog or its landing, and frogs
// sitting too close drift apart. Nothing is saved: each frog's day starts from its home.

import { stream } from '../../core/rng.js';

/**
 * @typedef {Object} Hop
 * @property {number} fx @property {number} fz @property {number} fy  from (world m)
 * @property {number} tx @property {number} tz @property {number} ty  to
 * @property {number} t0 @property {number} dur @property {number} h  start time, length (s), apex lift (m)
 * @property {boolean} toWater  lands in the water (then swims)
 */

/**
 * @typedef {Object} Agent
 * @property {number} id
 * @property {{ x: number, z: number, yaw: number }} home
 * @property {number} mood     from the tick, 0..1
 * @property {number} x @property {number} z @property {number} y @property {number} yaw
 * @property {'rest'|'forage'|'call'|'swim'|'float'|'leave'} mode
 * @property {Hop | null} hop
 * @property {{ tx: number, tz: number, kickT0: number } | null} swim
 * @property {number} sq @property {number} sqv     landing squash spring
 * @property {number} sac @property {number} sacv   throat sac spring
 * @property {number} pulseUntil  a call swells the sac until then
 * @property {number} tongueT0     the last flick began then (-1 never)
 * @property {number} flicks @property {number} nextFlick
 * @property {number} nextAt       next choice
 * @property {number} until        the end of a bout, a float or a sink
 * @property {number} sink         how far it has sunk (m), leaving
 * @property {boolean} gone        sunk out of sight: drop it
 * @property {ReturnType<typeof stream>} r
 */

/**
 * @param {any} recipe recipes/species/frog.json @param {number} seed world seed (sub-seeded per frog)
 */
export function createFrogAgents(recipe, seed) {
  const M = recipe.motion;
  const scale = recipe.body.displayScale ?? 1;
  const bodyLen = ((recipe.body.scaleReal[0] + recipe.body.scaleReal[1]) / 2) * scale;
  const dt = 1 / (M.stepHz ?? 30);
  /** @type {Map<number, Agent>} */ const agents = new Map();
  /** Every call started (for the chorus timeline): frog id and time. @type {{ id: number, t: number }[]} */
  const calls = [];
  const stats = { hops: 0, hopM: 0, swims: 0, flicks: 0 };
  let lastCall = -Infinity, clock = 0, owed = 0, synced = false;

  const rand = (/** @type {Agent} */ a, /** @type {number[]} */ r) => r[0] + (r[1] - r[0]) * a.r.next();

  /**
   * Line up the agents with the frogs the tick keeps. The first time, frogs are simply at home; later
   * ones arrive from the water, and ones gone from the list (or all, for winter) leave.
   * @param {any[]} frogs state.creatures.frogs.frogs @param {boolean} dormant @param {any} env
   */
  function sync(frogs, dormant, env) {
    const ids = new Set(dormant ? [] : frogs.map((f) => f.id));
    for (const a of agents.values()) if (!ids.has(a.id) && a.mode !== 'leave') leave(a, env);
    if (dormant) { synced = true; return; }
    for (const f of frogs) {
      let a = agents.get(f.id);
      if (a && a.mode === 'leave') { agents.delete(f.id); a = undefined; }
      if (!a) {
        a = make(f, env);
        agents.set(f.id, a);
        if (synced) arrive(a, env);
      }
      a.home = { x: f.x, z: f.z, yaw: f.yaw };
      a.mood = f.mood;
    }
    synced = true;
  }

  /** @param {any} f @param {any} env @returns {Agent} */
  function make(f, env) {
    const r = stream(seed, 0xf20, f.id);
    return { id: f.id, home: { x: f.x, z: f.z, yaw: f.yaw }, mood: f.mood, x: f.x, z: f.z, y: env.ground(f.x, f.z), yaw: f.yaw,
      mode: 'rest', hop: null, swim: null, sq: 0, sqv: 0, sac: 0, sacv: 0, pulseUntil: -1, tongueT0: -1, flicks: 0, nextFlick: 0,
      nextAt: clock + 0.5 + 3 * r.next(), until: 0, sink: 0, gone: false, r };
  }

  /** A new frog comes up from the water in front of its home, floats a moment, then hops ashore. @param {Agent} a @param {any} env */
  function arrive(a, env) {
    const wx = a.home.x + Math.sin(a.home.yaw) * 0.7, wz = a.home.z + Math.cos(a.home.yaw) * 0.7;
    const w = env.water(wx, wz);
    if (w.depth < 0.02) return;
    Object.assign(a, { x: wx, z: wz, y: floatY(w.surface), yaw: a.home.yaw + Math.PI, mode: 'float', until: clock + 1.5, nextAt: clock + 1.5 });
  }

  /** Slip into the water ahead and sink out of sight. @param {Agent} a @param {any} env */
  function leave(a, env) {
    a.mode = 'leave';
    a.until = Infinity;
    if (a.hop) return;
    const spot = findSpot(a, env, true, a.yaw);
    if (spot) startHop(a, spot, env, true);
    else a.until = clock;
  }

  /** The body's height in the water so only the eyes and the top of the head are out. @param {number} surface */
  const floatY = (surface) => surface - (0.039 * scale - M.swim.eyesUpM * scale);

  /** Is (x, z) clear of every other frog and its landing? @param {Agent} self @param {number} x @param {number} z */
  function clear(self, x, z) {
    const min = M.spacing.hopBodies * bodyLen;
    for (const o of agents.values()) {
      if (o === self || o.mode === 'leave') continue;
      const ox = o.hop ? o.hop.tx : o.x, oz = o.hop ? o.hop.tz : o.z;
      if ((ox - x) ** 2 + (oz - z) ** 2 < min * min) return false;
    }
    return true;
  }

  /**
   * A place to hop to: on the bank (or in the shallows), within reach and the leash, clear of others.
   * @param {Agent} a @param {any} env @param {boolean} water @param {number} [toward] a bearing to prefer
   * @param {number} [far] share of a full hop (a shuffle is short)
   */
  function findSpot(a, env, water, toward, far = 1) {
    const D = M.hop.distM;
    const homeD = Math.hypot(a.x - a.home.x, a.z - a.home.z);
    const back = homeD > M.leashM ? Math.atan2(a.home.x - a.x, a.home.z - a.z) : null;
    for (let i = 0; i < 10; i++) {
      const bearing = back ?? toward ?? a.yaw;
      const ang = bearing + (a.r.next() - 0.5) * (back !== null ? 0.8 : 2.6);
      const d = (D[0] + (D[1] - D[0]) * a.r.next()) * scale * far;
      const x = a.x + Math.sin(ang) * d, z = a.z + Math.cos(ang) * d;
      const w = env.water(x, z);
      if (water ? w.depth < 0.02 || w.depth > M.swim.maxDepthM : w.depth > 0.005) continue;
      if (!water && Math.hypot(x - a.home.x, z - a.home.z) > M.leashM && back === null) continue;
      if (!water && Math.abs(env.ground(x, z) - a.y) > 0.2 * scale) continue;
      if (!clear(a, x, z)) continue;
      return { x, z, y: water ? floatY(w.surface) : env.ground(x, z) };
    }
    return null;
  }

  /** @param {Agent} a @param {{ x: number, z: number, y: number }} to @param {any} env @param {boolean} toWater */
  function startHop(a, to, env, toWater) {
    void env;
    const d = Math.hypot(to.x - a.x, to.z - a.z);
    const D = M.hop.distM, S = M.hop.s;
    const share = Math.min(1, Math.max(0, (d / scale - D[0]) / (D[1] - D[0])));
    a.hop = { fx: a.x, fz: a.z, fy: a.y, tx: to.x, tz: to.z, ty: to.y, t0: clock, dur: S[0] + (S[1] - S[0]) * share,
      h: M.hop.heightM * scale * (0.7 + 0.3 * share) + Math.max(0, to.y - a.y), toWater };
    a.yaw = Math.atan2(to.x - a.x, to.z - a.z);
    a.sqv = -2;   // a stretch as it leaves
    stats.hops++;
    stats.hopM += d;
  }

  /** The hop is over: down, squash, and if in the water, a splash and a swim. @param {Agent} a @param {any} env */
  function land(a, env) {
    const h = /** @type {Hop} */ (a.hop);
    a.x = h.tx; a.z = h.tz; a.y = h.ty;
    a.hop = null;
    a.sqv = M.squash.amount * Math.sqrt(M.squash.k);
    if (a.mode === 'leave') {
      // Moving on: once in the water it sinks; if it was mid-hop on land, it heads for the water.
      if (h.toWater) { env.plop(a.x, a.z); a.until = clock; return; }
      const spot = findSpot(a, env, true, a.yaw);
      if (spot) startHop(a, spot, env, true); else a.until = clock;
      return;
    }
    if (h.toWater) {
      env.plop(a.x, a.z);
      stats.swims++;
      const tgt = findSpot(a, env, true, a.yaw);
      a.mode = 'swim';
      a.swim = { tx: tgt ? tgt.x : a.x, tz: tgt ? tgt.z : a.z, kickT0: clock };
      a.nextAt = Infinity;
    } else if (a.mode === 'swim' || a.mode === 'float') {
      a.mode = 'rest';
      a.nextAt = clock + 1 + a.r.next() * 2;
    }
  }

  /** What to do next. @param {Agent} a @param {any} env */
  function choose(a, env) {
    const hour = env.hourOfDay;
    const active = inHours(hour, recipe.ecology.activity.hours);
    const sinceDusk = ((hour - env.duskHour) % 24 + 36) % 24 - 12;
    const callTime = sinceDusk >= M.moods.callAfterDuskH[0] && sinceDusk < M.moods.callAfterDuskH[1] && a.mood >= M.moods.callFromMood;
    const homeD = Math.hypot(a.x - a.home.x, a.z - a.home.z);
    if (homeD > M.leashM + 0.3) {
      const spot = findSpot(a, env, false);
      if (spot) { startHop(a, spot, env, false); a.mode = 'forage'; a.nextAt = clock + 0.8; return; }
    }
    if (!active && !callTime) {
      // Resting frogs think again every few seconds (so dusk wakes them), shuffling now and then.
      a.mode = 'rest';
      const think = 3 + 5 * a.r.next();
      const mean = (M.rest.shuffleEveryS[0] + M.rest.shuffleEveryS[1]) / 2;
      if (a.r.next() < think / mean) { const s = findSpot(a, env, false, undefined, 0.45); if (s) startHop(a, s, env, false); }
      a.nextAt = clock + think;
      return;
    }
    if (callTime && a.r.next() < 0.6) {
      a.mode = 'call';
      a.until = clock + rand(a, M.call.boutS);
      a.nextAt = a.until;
      return;
    }
    if (a.r.next() < M.moods.swimShare) {
      const s = findSpot(a, env, true);
      if (s) { a.mode = 'swim'; startHop(a, s, env, true); return; }
    }
    a.mode = 'forage';
    const s = findSpot(a, env, false);
    if (s) startHop(a, s, env, false);
    a.flicks = Math.round(rand(a, M.forage.flicks));
    a.nextFlick = clock + 0.8 + a.r.next();
    a.nextAt = clock + rand(a, M.forage.everyS);
  }

  /** One step of one frog. @param {Agent} a @param {any} env */
  function stepOne(a, env) {
    // Springs: the landing squash, and the sac swelling toward its call.
    a.sqv += (-M.squash.k * a.sq - M.squash.d * a.sqv) * dt;
    a.sq += a.sqv * dt;
    const want = clock < a.pulseUntil ? 1 : 0;
    a.sacv += (M.call.k * (want - a.sac) - M.call.d * a.sacv) * dt;
    a.sac = Math.max(0, a.sac + a.sacv * dt);
    if (a.hop) { if (clock >= a.hop.t0 + a.hop.dur) land(a, env); return; }
    if (a.mode === 'leave') {
      if (clock >= a.until) { a.sink += 0.05 * dt; if (a.sink > 0.08 * scale) a.gone = true; }
      return;
    }
    if (a.mode === 'swim' && a.swim) {
      const S = M.swim;
      const ph = ((clock - a.swim.kickT0) % S.kickS) / S.kickS;
      const v = S.speedMps * scale * 2 * (1 - ph);
      const dx = a.swim.tx - a.x, dz = a.swim.tz - a.z, d = Math.hypot(dx, dz);
      if (d < 0.03) { a.mode = 'float'; a.swim = null; a.until = clock + rand(a, S.floatS); a.nextAt = a.until; return; }
      a.yaw = Math.atan2(dx, dz);
      a.x += (dx / d) * v * dt; a.z += (dz / d) * v * dt;
      a.y = floatY(env.water(a.x, a.z).surface);
      return;
    }
    if (a.mode === 'float') {
      a.y = floatY(env.water(a.x, a.z).surface);
      if (clock >= a.until) {
        const s = findSpot(a, env, false, Math.atan2(a.home.x - a.x, a.home.z - a.z));
        if (s) startHop(a, s, env, false);
        else a.until = clock + 2;
      }
      return;
    }
    // On land: drift apart from a frog sitting too close.
    const near = M.spacing.driftBodies * bodyLen;
    for (const o of agents.values()) {
      if (o === a || o.hop || o.mode === 'leave' || o.mode === 'swim' || o.mode === 'float') continue;
      const dx = a.x - o.x, dz = a.z - o.z, d = Math.hypot(dx, dz);
      if (d > 1e-6 && d < near) { a.x += (dx / d) * M.spacing.driftMps * dt; a.z += (dz / d) * M.spacing.driftMps * dt; }
    }
    if (a.mode === 'call' && clock >= a.pulseUntil + 0.15 && a.r.next() < M.call.perS * dt && clock - lastCall >= M.call.gapS) {
      a.pulseUntil = clock + M.call.pulseS;
      lastCall = clock;
      calls.push({ id: a.id, t: clock });
      if (calls.length > 400) calls.splice(0, calls.length - 400);
    }
    if (a.mode === 'forage' && a.flicks > 0 && clock >= a.nextFlick) {
      a.tongueT0 = clock;
      a.flicks--;
      a.nextFlick = clock + 0.6 + a.r.next() * 0.9;
      stats.flicks++;
    }
    if (clock >= a.nextAt) choose(a, env);
  }

  return {
    sync,
    /**
     * Run the steps owed for `realDt` seconds.
     * @param {number} realDt @param {any} env { ground, water, plop, hourOfDay, duskHour }
     */
    advance(realDt, env) {
      // Time carries over between frames, so a frame shorter than a step still counts.
      owed = Math.min(owed + realDt, 0.25);
      while (owed >= dt - 1e-9) {
        clock += dt;
        owed -= dt;
        for (const a of agents.values()) stepOne(a, env);
        for (const [id, a] of agents) if (a.gone) agents.delete(id);
      }
    },
    /** The agents now. */
    list: () => [...agents.values()],
    /** Seconds of frog time so far. */
    now: () => clock,
    /** Calls started, oldest first (the frog lab's chorus timeline). */
    calls: () => calls.slice(),
    /** Hops, metres hopped, swims and tongue flicks so far. */
    stats: () => ({ ...stats }),
    /**
     * Where a frog is drawn now and how it is posed: between steps, a hop follows its arc smoothly.
     * @param {Agent} a
     */
    view(a) {
      let { x, y, z } = a;
      let hopT = -1;
      if (a.hop) {
        const p = Math.min(1, Math.max(0, (clock - a.hop.t0) / a.hop.dur));
        x = a.hop.fx + (a.hop.tx - a.hop.fx) * p;
        z = a.hop.fz + (a.hop.tz - a.hop.fz) * p;
        y = a.hop.fy + (a.hop.ty - a.hop.fy) * p + 4 * a.hop.h * p * (1 - p);
        hopT = p;
      }
      const swimming = a.mode === 'swim' || a.mode === 'float';
      const kick = a.mode === 'swim' && a.swim ? ((clock - a.swim.kickT0) % M.swim.kickS) / M.swim.kickS : -1;
      const tongue = a.tongueT0 >= 0 && clock - a.tongueT0 < M.tongue.s ? Math.sin(Math.PI * (clock - a.tongueT0) / M.tongue.s) : 0;
      return { x, y: y - a.sink, z, yaw: a.yaw, hopT, kick, sq: a.sq, sac: a.sac, swimming, tongue };
    },
  };
}

/** Is an hour of the day inside any of the windows ([from, to), to past 24 wraps)? @param {number} h @param {number[][]} windows */
export function inHours(h, windows) {
  return windows.some(([a, b]) => (h >= a && h < b) || (h + 24 >= a && h + 24 < b));
}

/** @typedef {ReturnType<typeof createFrogAgents>} FrogAgents */

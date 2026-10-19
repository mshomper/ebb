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
 * @property {import('./perches.js').Perch | null} perch  lands on this seat on a lily pad (followed as the pad moves)
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
 * @property {import('./perches.js').Perch | null} perch  sitting on a lily pad (S6b-3), riding it
 * @property {number} under        how far under the surface it swims (ducking under a pad)
 * @property {string | null} seek   the pad it is swimming over to, to climb on
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
  const stats = { hops: 0, hopM: 0, swims: 0, flicks: 0, perches: 0 };
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
      nextAt: clock + 0.5 + 3 * r.next(), until: 0, sink: 0, gone: false, perch: null, under: 0, seek: null, r };
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
    a.perch = null;
    if (a.hop) return;
    const spot = findSpot(a, env, true, a.yaw);
    if (spot) startHop(a, spot, env, true);
    else a.until = clock;
  }

  /** The body's height in the water so only the eyes and the top of the head are out. @param {number} surface */
  const floatY = (surface) => surface - (0.039 * scale - M.swim.eyesUpM * scale);

  /**
   * In the water: under a lily pad (or about to be) it swims down out of the way and comes up
   * again past it, never through it. Returns whether a pad is over it.
   * @param {Agent} a @param {any} env @param {number} dt
   */
  function duck(a, env, dt) {
    const over = !!env.pads?.underPad(a.x, a.z, 0.04);
    const want = over ? M.pads.submergeM * scale : 0;
    a.under += (want - a.under) * Math.min(1, dt * (over ? 20 : 8));
    a.y = floatY(env.water(a.x, a.z).surface) - a.under;
    return over;
  }

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
      // Open water only (never under a lily pad); on land, never inside a reed or iris clump.
      if (water && env.pads?.underPad(x, z, 0.05)) continue;
      if (!water && env.pads?.inClump(x, z)) continue;
      if (!water && Math.hypot(x - a.home.x, z - a.home.z) > M.leashM && back === null) continue;
      if (!water && Math.abs(env.ground(x, z) - a.y) > 0.2 * scale) continue;
      if (!clear(a, x, z)) continue;
      return { x, z, y: water ? floatY(w.surface) : env.ground(x, z) };
    }
    return null;
  }

  /**
   * A floating frog with no bank in reach (past the reeds, or out too far): it swims to the open
   * water nearest its home, and from within a hop of home, hops home. Returns whether it set off.
   * @param {Agent} a @param {any} env
   */
  function swimHome(a, env) {
    const hx = a.home.x, hz = a.home.z, d = Math.hypot(a.x - hx, a.z - hz);
    if (d < M.hop.distM[1] * scale) { startHop(a, { x: hx, z: hz, y: env.ground(hx, hz) }, env, false); return true; }
    for (let s = 0.05; s < d; s += 0.05) {
      const x = hx + ((a.x - hx) * s) / d, z = hz + ((a.z - hz) * s) / d;
      if (env.water(x, z).depth < 0.02 || env.pads?.underPad(x, z, 0.05)) continue;
      if (Math.hypot(x - a.x, z - a.z) < 0.05) return false;
      a.mode = 'swim';
      a.swim = { tx: x, tz: z, kickT0: clock };
      return true;
    }
    return false;
  }

  /**
   * @param {Agent} a @param {{ x: number, z: number, y: number }} to @param {any} env @param {boolean} toWater
   * @param {import('./perches.js').Perch | null} [perch] landing on this seat on a lily pad
   */
  function startHop(a, to, env, toWater, perch = null) {
    void env;
    const d = Math.hypot(to.x - a.x, to.z - a.z);
    const D = M.hop.distM, S = M.hop.s;
    const share = Math.min(1, Math.max(0, (d / scale - D[0]) / (D[1] - D[0])));
    a.perch = null;
    a.under = 0;
    a.hop = { fx: a.x, fz: a.z, fy: a.y, tx: to.x, tz: to.z, ty: to.y, t0: clock, dur: S[0] + (S[1] - S[0]) * share,
      h: M.hop.heightM * scale * (0.7 + 0.3 * share) + Math.max(0, to.y - a.y), toWater, perch };
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
    if (h.perch) {
      // On a lily pad: it rides the pad from now on; a small ring as it lands.
      a.perch = h.perch;
      a.mode = 'rest';
      env.plop(a.x, a.z);
      stats.perches++;
      a.nextAt = clock + 2 + a.r.next() * 3;
      return;
    }
    if (h.toWater) {
      env.plop(a.x, a.z);
      stats.swims++;
      // Swimming over to a pad: to its rim; otherwise somewhere nearby in the shallows.
      const tgt = (a.seek && padEdge(a, env, a.seek)) || findSpot(a, env, true, a.yaw);
      if (!tgt) a.seek = null;
      a.mode = 'swim';
      a.swim = { tx: tgt ? tgt.x : a.x, tz: tgt ? tgt.z : a.z, kickT0: clock };
      a.nextAt = Infinity;
    } else if (a.mode === 'swim' || a.mode === 'float') {
      a.mode = 'rest';
      a.nextAt = clock + 1 + a.r.next() * 2;
    }
  }

  /**
   * Onto a free lily pad (if not too many frogs are on pads already): a hop onto one within reach,
   * or, for one further out (up to pads.seekM), into the water and a swim over to its edge, to climb
   * on from there.
   * @param {Agent} a @param {any} env @returns {boolean} on its way
   */
  function toPad(a, env) {
    /** @type {Set<string>} */ const taken = new Set();
    for (const o of agents.values()) {
      if (o.perch) taken.add(o.perch.key);
      if (o.hop?.perch) taken.add(o.hop.perch.key);
      if (o.seek && o !== a) taken.add(o.seek);
    }
    if (taken.size >= M.pads.maxOn) return false;
    const perch = env.pads.freeSeat(a.x, a.z, M.hop.distM[1] * scale, taken);
    const at = perch && env.pads.seatOf(perch);
    if (perch && at) {
      a.seek = null;
      a.mode = 'rest';
      startHop(a, at, env, false, perch);
      return true;
    }
    const far = env.pads.freeSeat(a.x, a.z, M.pads.seekM, taken);
    const edge = far && padEdge(a, env, far.key);
    if (!far || !edge) return false;
    const inWater = a.mode === 'swim' || a.mode === 'float';
    if (inWater) {
      a.seek = far.key;
      a.mode = 'swim';
      a.swim = { tx: edge.x, tz: edge.z, kickT0: clock };
      return true;
    }
    const w = findSpot(a, env, true, Math.atan2(edge.x - a.x, edge.z - a.z));
    if (!w) return false;
    a.seek = far.key;
    a.mode = 'swim';
    startHop(a, w, env, true);
    return true;
  }

  /**
   * The open water just off a pad's rim on the frog's side, where it comes up to climb on.
   * @param {Agent} a @param {any} env @param {string} key @returns {{ x: number, z: number } | null}
   */
  function padEdge(a, env, key) {
    const pad = env.pads.padOf(key);
    if (!pad) return null;
    const d = Math.hypot(a.x - pad.x, a.z - pad.z) || 1;
    const out = pad.radius + M.pads.edgeM * scale;
    return { x: pad.x + ((a.x - pad.x) / d) * out, z: pad.z + ((a.z - pad.z) / d) * out };
  }

  /** What to do next. @param {Agent} a @param {any} env */
  function choose(a, env) {
    const hour = env.hourOfDay;
    const active = inHours(hour, recipe.ecology.activity.hours);
    const sinceDusk = ((hour - env.duskHour) % 24 + 36) % 24 - 12;
    const callTime = sinceDusk >= M.moods.callAfterDuskH[0] && sinceDusk < M.moods.callAfterDuskH[1] && a.mood >= M.moods.callFromMood;
    if (a.perch) {
      // On a lily pad: call or sit a while, then hop off to the bank, or into the water.
      if (callTime && a.r.next() < 0.6) { a.mode = 'call'; a.until = clock + rand(a, M.call.boutS); a.nextAt = a.until; return; }
      if (!active || a.r.next() < 0.5) { a.mode = 'rest'; a.nextAt = clock + 4 + 6 * a.r.next(); return; }
      const land = findSpot(a, env, false, Math.atan2(a.home.x - a.x, a.home.z - a.z));
      if (land) { a.mode = 'forage'; startHop(a, land, env, false); a.nextAt = clock + rand(a, M.forage.everyS); return; }
      const water = findSpot(a, env, true);
      if (water) { a.mode = 'swim'; startHop(a, water, env, true); return; }
      a.nextAt = clock + 3;
      return;
    }
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
    if (env.pads && a.r.next() < M.pads.share && toPad(a, env)) return;
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
    if (a.hop) {
      // A hop onto a lily pad lands where the pad is by then: its end follows the moving seat.
      if (a.hop.perch) {
        const s = env.pads?.seatOf(a.hop.perch);
        if (s) { a.hop.tx = s.x; a.hop.tz = s.z; a.hop.ty = s.y; }
        else { a.hop.perch = null; a.hop.toWater = true; a.hop.ty = floatY(env.water(a.hop.tx, a.hop.tz).surface); }
      }
      if (clock >= a.hop.t0 + a.hop.dur) land(a, env);
      return;
    }
    if (a.mode === 'leave') {
      if (clock >= a.until) { a.sink += 0.05 * dt; if (a.sink > 0.08 * scale) a.gone = true; }
      return;
    }
    if (a.perch) {
      // Riding its lily pad as it swings, bobs and turns; if the pad is gone, into the water.
      const s = env.pads?.seatOf(a.perch);
      if (!s) {
        a.perch = null;
        env.plop(a.x, a.z);
        const tgt = findSpot(a, env, true, a.yaw);
        a.mode = 'swim';
        a.swim = { tx: tgt ? tgt.x : a.x, tz: tgt ? tgt.z : a.z, kickT0: clock };
        a.y = floatY(env.water(a.x, a.z).surface);
        return;
      }
      a.x = s.x; a.z = s.z; a.y = s.y; a.yaw = s.yaw;
    }
    if (a.mode === 'swim' && a.swim) {
      const S = M.swim;
      const ph = ((clock - a.swim.kickT0) % S.kickS) / S.kickS;
      const v = S.speedMps * scale * 2 * (1 - ph);
      const dx = a.swim.tx - a.x, dz = a.swim.tz - a.z, d = Math.hypot(dx, dz);
      if (d < 0.03) {
        // At the pad it swam to: climb on (or, if that pad is gone or taken now, carry on).
        if (a.seek) {
          a.seek = null;
          if (toPad(a, env)) return;
        }
        // Float only in open water; under a pad, swim on to somewhere open.
        if (env.pads?.underPad(a.x, a.z, 0.03)) {
          const tgt = findSpot(a, env, true, a.yaw);
          if (tgt) { a.swim.tx = tgt.x; a.swim.tz = tgt.z; return; }
        }
        a.mode = 'float'; a.swim = null; a.until = clock + rand(a, S.floatS); a.nextAt = a.until; return;
      }
      a.yaw = Math.atan2(dx, dz);
      a.x += (dx / d) * v * dt; a.z += (dz / d) * v * dt;
      duck(a, env, dt);
      return;
    }
    if (a.mode === 'float') {
      // A pad swinging over a floating frog: it ducks and swims off to open water.
      if (duck(a, env, dt)) {
        const tgt = findSpot(a, env, true, a.yaw);
        if (tgt) { a.mode = 'swim'; a.swim = { tx: tgt.x, tz: tgt.z, kickT0: clock }; return; }
      }
      if (clock >= a.until) {
        if (env.pads && a.r.next() < M.pads.share && toPad(a, env)) return;
        const s = findSpot(a, env, false, Math.atan2(a.home.x - a.x, a.home.z - a.z));
        if (s) startHop(a, s, env, false);
        else if (!swimHome(a, env)) a.until = clock + 2;
      }
      return;
    }
    // On land: drift apart from a frog sitting too close (not on a pad: it rides the pad).
    const near = M.spacing.driftBodies * bodyLen;
    for (const o of agents.values()) {
      if (a.perch) break;
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

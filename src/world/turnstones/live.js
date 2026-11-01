// @ts-check
// The turnstones' flock, alive (B3 wave 2): each bird's moment to moment on the strand, posed by the
// small-bird rig's code clips (src/world/creatures/bird-motion.js). No GPU and no DOM, so the unit
// tests drive it. Live animation only: nothing here is saved or touches the world, so a small hash
// stream per bird is enough (never Math.random, so a test sees the same flock twice).
//
// What a bird does (recipes/species/turnstone.json life, presence; recipes/birds/turnstone.json motion):
//   forage   run to a spot near the flock's middle (on the wrack where there is some), then turn
//            the wrack over with its bill (flip), peck, look about, or preen; the middle drifts
//            along the strand from one wrack spot to the next
//   roost    at night, or with the tide past roostTideM, they stand close on the highest spot near,
//            looking about and preening now and then
//   flush    the walker inside the flock's ring at Wary: each bird takes off a moment after the
//            last, flies low out over the water and lands flushM along the strand, away from you;
//            past Wary a bird inside the ring runs aside, and flies only inside panicShare of it
//   around   once the flock knows you (presence.knownTrust), a walker standing still near them
//            draws them to forage around your boots
//   leave    a visit's birds (or the whole flock when told) fly off out over the sea and are gone
// Lengths in the motion block are real metres; on the island everything is drawn displayScale
// times, so a bird covers displayScale times the ground its legs walk.

import { hash32 } from '../../core/rng.js';
import { poseBird, idlePose, gaitPose, peckPose, flipPose, preenPose, flyPose, takeoffPose, landPose } from '../creatures/bird-motion.js';
import { ringScale } from '../creatures/presence.js';

/** The golden angle, for the roost's spiral. */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** The roost's spiral spacing, as a share of a body's width (the check then lets each stand clear). */
const ROOST_PACK = 1.1;

/**
 * How far a bird's body reaches from its middle toward a direction (radians, as yaw): its half
 * width side on, its half length nose or tail on, between them as the heading turns.
 * @param {number} yaw @param {number} dir @param {number[]} half [half width, half length] drawn metres
 */
export const reachOf = (yaw, dir, half) => half[0] + (half[1] - half[0]) * Math.abs(Math.cos(yaw - dir));

/**
 * The interference check: no two birds' bodies overlap. Each pair at about the same height (a bird
 * flying over another is no clash) closer than their two reaches along the line between them
 * (reachOf: side by side they may stand close, nose to tail they need a body length) is pushed
 * apart along that line, half each, a few passes so a crowd settles. Changes the birds in place.
 * @param {{ x: number, z: number, y: number, yaw: number, gone?: boolean }[]} list @param {number[]} half [half width, half length]
 * @param {number} [passes]
 */
export function separate(list, half, passes = 10) {
  for (let p = 0; p < passes; p++) {
    let moved = false;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.gone) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.gone || Math.abs(a.y - b.y) > half[1]) continue;
        let dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        // Two on the very same spot part along a fixed direction of their own.
        if (d < 1e-6) { dx = Math.sin(i * 2.4 + j); dz = Math.cos(i * 2.4 + j); d = 1e-6; }
        const dir = Math.atan2(dx, dz), need = reachOf(a.yaw, dir, half) + reachOf(b.yaw, dir + Math.PI, half);
        if (d >= need) continue;
        const push = (need - d) / 2 / Math.max(d, 1e-6);
        a.x -= dx * push; a.z -= dz * push; b.x += dx * push; b.z += dz * push;
        moved = true;
      }
    }
    if (!moved) return;
  }
}

/** A bird's own small stream, 0..1. @param {number} seed */
function streamOf(seed) {
  let n = 0;
  return () => (hash32(seed, n++) >>> 8) / 16777216;
}

/** @param {() => number} r @param {number[]} a [lo, hi] */
const between = (r, a) => a[0] + (a[1] - a[0]) * r();

/**
 * @typedef {{ id: number, x: number, z: number, y: number, yaw: number, mode: string, t: number, dur: number,
 *   tx: number, tz: number, dist: number, beat: number, n: number, r: () => number, glideAt: number,
 *   path: { x0: number, z0: number, cx: number, cz: number, x1: number, z1: number, up: number, len: number } | null,
 *   gone: boolean, lag: number, then: string }} Bird
 */

/** How far a landing carries a bird along the ground (real m), measured once from the clip. @param {any} M */
function landM(M) {
  let d = 0;
  const n = 200;
  for (let i = 0; i < n; i++) d += landPose(0, (i + 0.5) / n, 0, M).v * (M.land.s / n);
  return d;
}

/**
 * @param {{ L: any, P: any, M: any, k: number, seed: number,
 *   ground: (x: number, z: number) => number, tide: () => number }} o
 *   L: the species recipe's life; P: its presence; M: the bird's motion; k: displayScale; ground:
 *   terrain height; tide: the sea's level now
 */
export function createFlockLife(o) {
  const { L, P, M, k } = o;
  const LAND = landM(M) * k, CRUISE = 0.25 * k;
  /** @type {Bird[]} */ let birds = [];
  let nextId = 1, mid = { x: 0, z: 0 }, driftTo = { x: 0, z: 0 }, driftIn = 0, settleIn = 0, clock = 0;
  const flock = streamOf(hash32(o.seed, 0x7a11));

  /** Dry strand: above the water, not far up the beach. @param {number} x @param {number} z */
  const strand = (x, z) => { const g = o.ground(x, z) - o.tide(); return g > 0.03 && g < 1.4; };

  /** How far a spot is from the nearest other bird and where it is going. @param {Bird} b @param {number} x @param {number} z */
  const roomAt = (b, x, z) => birds.reduce((m, q) => (q === b || q.gone ? m : Math.min(m, Math.hypot(q.x - x, q.z - z), Math.hypot(q.tx - x, q.tz - z))), Infinity);

  /**
   * A spot near (x, z) for a bird: on a wrack spot within reach (most of the time), else dry strand,
   * the roomiest of a few tries, so they keep spacingM apart as a feeding flock does.
   * @param {Bird} b @param {number} x @param {number} z @param {number} spread @param {{ x: number, z: number }[]} spots
   */
  function spotNear(b, x, z, spread, spots) {
    const near = spots.filter((s) => Math.hypot(s.x - x, s.z - z) <= spread);
    const onWrack = near.length > 0 && b.r() < 0.75;
    let best = { x, z }, bestRoom = -1;
    for (let i = 0; i < 6; i++) {
      let px, pz;
      if (onWrack) {
        const s = near[Math.floor(b.r() * near.length)];
        px = s.x + (b.r() - 0.5) * 1.2; pz = s.z + (b.r() - 0.5) * 1.2;
      } else {
        const a = b.r() * Math.PI * 2, d = Math.sqrt(b.r()) * spread;
        px = x + Math.sin(a) * d; pz = z + Math.cos(a) * d;
        if (!strand(px, pz)) continue;
      }
      const room = roomAt(b, px, pz);
      if (room > bestRoom) { best = { x: px, z: pz }; bestRoom = room; }
      if (room >= L.spacingM) break;
    }
    return best;
  }

  /** Begin a mode. @param {Bird} b @param {string} mode @param {number} dur */
  const begin = (b, mode, dur) => { b.mode = mode; b.t = 0; b.dur = dur; };

  /** A bird new to the flock, standing at (x, z). @param {number} x @param {number} z */
  function add(x, z) {
    const id = nextId++, r = streamOf(hash32(o.seed, id));
    /** @type {Bird} */ const b = { id, x, z, y: 0, yaw: r() * Math.PI * 2, mode: 'idle', t: 0, dur: between(r, L.idleS), tx: x, tz: z,
      dist: 0, beat: r() * 10, n: 0, r, glideAt: r() * 3, path: null, gone: false, lag: 0, then: 'idle' };
    birds.push(b);
    return b;
  }

  /** Fly a bird from where it is to (x1, z1): a take-off toward it, a low arc out over the sea, a landing. @param {Bird} b @param {number} x1 @param {number} z1 @param {string} then */
  function flyTo(b, x1, z1, then) {
    b.lag = between(b.r, L.takeoffLagS);
    b.then = then;
    b.yaw = Math.atan2(x1 - b.x, z1 - b.z);
    b.tx = x1; b.tz = z1;
    begin(b, 'wait', b.lag);
  }

  /** Lay the flight's path once the bird is up: out over the lower side, ending a landing short of the spot. @param {Bird} b */
  function plan(b) {
    const dx = b.tx - b.x, dz = b.tz - b.z, d = Math.max(0.1, Math.hypot(dx, dz));
    const ux = dx / d, uz = dz / d;
    const end = b.then === 'gone' ? { x: b.tx, z: b.tz } : { x: b.tx - ux * LAND, z: b.tz - uz * LAND };
    // Out over whichever side is lower (the sea), so the flock swings out over the water.
    const sx = -uz, sz = ux, mx = (b.x + end.x) / 2, mz = (b.z + end.z) / 2;
    const side = o.ground(mx + sx * 3, mz + sz * 3) < o.ground(mx - sx * 3, mz - sz * 3) ? 1 : -1;
    const out = L.seaOutM * (0.7 + 0.6 * b.r());
    const cx = mx + sx * side * out, cz = mz + sz * side * out;
    const len = Math.hypot(cx - b.x, cz - b.z) + Math.hypot(end.x - cx, end.z - cz);
    b.path = { x0: b.x, z0: b.z, cx, cz, x1: end.x, z1: end.z, up: between(b.r, L.flyUpM), len };
    begin(b, 'fly', len / L.flyMps);
  }

  /** What a foraging bird does next. @param {Bird} b @param {{ x: number, z: number }} c @param {any} ctx */
  function nextForage(b, c, ctx) {
    const u = b.r();
    if (b.mode === 'run' || b.mode === 'idle') {
      const onWrack = ctx.spots.some((/** @type {any} */ s) => Math.hypot(s.x - b.x, s.z - b.z) < 1);
      if (onWrack && u < L.flipShare) return begin(b, 'flip', M.flip.s);
      if (u < L.flipShare + 0.3) { b.n = Math.round(between(b.r, L.pecks)); return begin(b, 'peck', M.peck.s * b.n); }
      if (u < L.flipShare + 0.3 + L.preenShare) return begin(b, 'preen', M.preen.s);
    }
    if (u < 0.35) return begin(b, 'idle', between(b.r, L.idleS));
    const t = spotNear(b, c.x, c.z, ctx.spread, ctx.spots);
    b.tx = t.x; b.tz = t.z;
    return begin(b, 'run', 0);
  }

  /** Where the flock forages around: the drifting middle, or around the still walker. @param {any} ctx */
  function forageMiddle(ctx) {
    if (ctx.around) return { x: ctx.around.x, z: ctx.around.z };
    return mid;
  }

  /** Move a running bird on toward its target. @param {Bird} b @param {number} dt */
  function stepRun(b, dt) {
    const dx = b.tx - b.x, dz = b.tz - b.z, d = Math.hypot(dx, dz);
    const kind = d > L.runOverM ? 'run' : 'walk', G = M[kind];
    const v = Math.min(d, G.mps * k * dt);
    if (d > 1e-3) { const want = Math.atan2(dx, dz); let dy = want - b.yaw; dy -= Math.round(dy / (Math.PI * 2)) * Math.PI * 2; b.yaw += dy * Math.min(1, dt * 10); }
    b.x += Math.sin(b.yaw) * v; b.z += Math.cos(b.yaw) * v;
    b.dist += v / k;
    return { done: d - v < 0.05, P: gaitPose(clock, b.dist / G.strideM, M, kind) };
  }

  /**
   * One frame. @param {number} dt real seconds
   * @param {{ count: number, home: { x: number, z: number } | null, spots: { x: number, z: number }[], roost: boolean,
   *   walker: import('../creatures/presence.js').PresenceSource | null, trust: number, band: number, known: boolean,
   *   leave?: boolean, around?: { x: number, z: number } | null }} ctx
   *   count: birds wanted; spots: wrack lying on the strand; roost: night or a high tide;
   *   band: 0 Wary, 1 Tolerant, 2 Curious; leave: all of them fly off out over the sea; around: forage
   *   around this spot (the still walker, once they know you)
   * @returns {string[]} what happened this frame ('flushed' when the flock took off from you)
   */
  function step(dt, ctx) {
    clock += dt;
    /** @type {string[]} */ const said = [];
    // Birds to add (walking in from the middle) or let go.
    while (birds.filter((b) => !b.gone).length < ctx.count && ctx.home) {
      const r = flock(), a = r * Math.PI * 2;
      add(ctx.home.x + Math.sin(a) * L.spacingM * (1 + birds.length * 0.3), ctx.home.z + Math.cos(a) * L.spacingM * (1 + birds.length * 0.3));
      if (birds.length === 1) { mid = { ...ctx.home }; driftTo = { ...ctx.home }; }
    }
    const live = birds.filter((b) => !b.gone);
    for (const b of live.slice(ctx.count)) if (b.mode !== 'fly' && b.mode !== 'takeoff') flyTo(b, b.x + Math.sin(b.yaw) * 40, b.z + Math.cos(b.yaw) * 40, 'gone');

    // The middle drifts from one wrack spot to the next.
    driftIn -= dt;
    if (driftIn <= 0 && ctx.spots.length) {
      driftIn = between(flock, L.drift.turnS);
      const near = ctx.spots.filter((s) => Math.hypot(s.x - mid.x, s.z - mid.z) < 8);
      const s = (near.length ? near : ctx.spots)[Math.floor(flock() * (near.length || ctx.spots.length))];
      driftTo = { x: s.x, z: s.z };
    }
    const ddx = driftTo.x - mid.x, ddz = driftTo.z - mid.z, dd = Math.hypot(ddx, ddz);
    if (dd > 0.01) { const v = Math.min(dd, L.drift.mps * dt); mid.x += (ddx / dd) * v; mid.z += (ddz / dd) * v; }

    // The walker: a flush at Wary (or inside the panic share), a run aside past it.
    const w = ctx.walker;
    const ring = Math.max(P.ringMinM, P.ringM * (1 - P.ringTrustShrink * ctx.trust));
    settleIn -= dt;
    if (w && ctx.leave !== true) {
      let flush = false;
      for (const b of live) {
        if (b.mode === 'fly' || b.mode === 'takeoff' || b.mode === 'wait' || b.mode === 'land') continue;
        const d = Math.hypot(w.pos[0] - b.x, w.pos[2] - b.z), rr = ring * (w.ringK ?? 1) * ringScale(w, b.x, b.z, P.multipliers);
        if (d > rr) continue;
        if (ctx.band === 0 || d < rr * P.panicShare * (ctx.band >= 2 ? 0.5 : 1)) flush = true;
        else if (b.mode !== 'run' || b.then !== 'aside') {
          const ax = (b.x - w.pos[0]) / Math.max(d, 0.01), az = (b.z - w.pos[2]) / Math.max(d, 0.01);
          b.tx = b.x + ax * L.runAsideM; b.tz = b.z + az * L.runAsideM; b.then = 'aside';
          begin(b, 'run', 0);
        }
      }
      if (flush && settleIn <= 0) {
        // Land flushM along the strand, on the wrack spot furthest from you in that reach.
        const fr = between(flock, L.flushM);
        const cands = ctx.spots.filter((s) => { const d = Math.hypot(s.x - mid.x, s.z - mid.z); return d >= fr * 0.6 && d <= fr * 1.4; });
        const far = (cands.length ? cands : ctx.spots).slice().sort((a, b) => Math.hypot(b.x - w.pos[0], b.z - w.pos[2]) - Math.hypot(a.x - w.pos[0], a.z - w.pos[2]))[0];
        const away = { x: mid.x - w.pos[0], z: mid.z - w.pos[2] }, al = Math.hypot(away.x, away.z) || 1;
        const dest = far && Math.hypot(far.x - w.pos[0], far.z - w.pos[2]) > ring * 2 ? far : { x: mid.x + (away.x / al) * fr, z: mid.z + (away.z / al) * fr };
        for (const b of live) {
          if (b.mode === 'fly' || b.mode === 'takeoff' || b.mode === 'wait' || b.mode === 'land') continue;
          const s = spotNear(b, dest.x, dest.z, L.spreadM * 0.7, []);
          flyTo(b, s.x, s.z, ctx.home ? 'idle' : 'gone');
        }
        mid = { x: dest.x, z: dest.z }; driftTo = { ...mid }; driftIn = between(flock, L.drift.turnS);
        settleIn = between(flock, L.settleS) + 3;
        said.push('flushed');
      }
    }
    if (ctx.leave) for (const b of live) if (b.mode !== 'fly' && b.mode !== 'takeoff' && b.mode !== 'wait') {
      const a = Math.atan2(b.x - mid.x, b.z - mid.z);
      flyTo(b, b.x + Math.sin(a) * 40, b.z + Math.cos(a) * 40, 'gone');
    }

    // Roost: the highest spot near the middle, everyone close.
    const roostAt = ctx.roost ? (ctx.spots.filter((s) => Math.hypot(s.x - mid.x, s.z - mid.z) < 10).sort((a, b) => o.ground(b.x, b.z) - o.ground(a.x, a.z))[0] ?? mid) : null;

    for (const b of live) {
      b.t += dt;
      /** @type {any} */ let P0;
      const u = b.dur > 0 ? Math.min(1, b.t / b.dur) : 0;
      if (b.mode === 'wait') { P0 = idlePose(clock, M, b.id); if (b.t >= b.dur) begin(b, 'takeoff', M.takeoff.s); }
      else if (b.mode === 'takeoff') {
        const r = takeoffPose(clock, u, b.dist / M.run.strideM, M);
        b.dist += r.v * dt; b.x += Math.sin(b.yaw) * r.v * k * dt; b.z += Math.cos(b.yaw) * r.v * k * dt; b.y = r.y * k;
        P0 = r.pose;
        if (u >= 1) plan(b);
      } else if (b.mode === 'fly' && b.path) {
        const p = b.path, s = u, a = 1 - s;
        const nx = a * a * p.x0 + 2 * a * s * p.cx + s * s * p.x1, nz = a * a * p.z0 + 2 * a * s * p.cz + s * s * p.z1;
        if (Math.hypot(nx - b.x, nz - b.z) > 1e-4) b.yaw = Math.atan2(nx - b.x, nz - b.z);
        b.x = nx; b.z = nz;
        b.y = CRUISE + p.up * Math.sin(Math.PI * s);
        b.beat += dt * M.flap.hz;
        const cyc = ((clock + b.glideAt) % 2.8) / 2.8;
        P0 = flyPose(clock, b.beat, Math.max(Math.min(1, Math.max(0, (cyc - 0.7) * 10) * Math.max(0, (1 - cyc) * 10)), s > 0.85 ? 1 : 0), M);
        if (u >= 1) { if (b.then === 'gone') { b.gone = true; continue; } begin(b, 'land', M.land.s); }
      } else if (b.mode === 'land') {
        const r = landPose(clock, u, b.dist / M.run.strideM, M, CRUISE / k);
        b.dist += r.v * dt; b.x += Math.sin(b.yaw) * r.v * k * dt; b.z += Math.cos(b.yaw) * r.v * k * dt; b.y = r.y * k;
        P0 = r.pose;
        if (u >= 1) { b.y = 0; begin(b, 'idle', between(b.r, L.idleS)); }
      } else if (roostAt && b.mode !== 'run') {
        // Roosting: walk in close, then stand, preening now and then.
        // A sunflower's spiral by rank, so no two share a place and the gaps stay even.
        const rank = live.indexOf(b), rr = 2 * L.bodyHalfM[0] * ROOST_PACK * Math.sqrt(rank + 0.5), ra = rank * GOLDEN;
        const off = { x: Math.sin(ra) * rr, z: Math.cos(ra) * rr };
        const tx = roostAt.x + off.x, tz = roostAt.z + off.z;
        if (Math.hypot(tx - b.x, tz - b.z) > 0.25) { b.tx = tx; b.tz = tz; b.then = 'roost'; begin(b, 'run', 0); P0 = idlePose(clock, M, b.id); }
        else if (b.mode === 'preen') { P0 = preenPose(clock, u, M); if (u >= 1) begin(b, 'roost', between(b.r, [6, 20])); }
        else { if (b.mode !== 'roost') begin(b, 'roost', between(b.r, [6, 20])); P0 = idlePose(clock * 0.5, M, b.id); if (b.t >= b.dur) begin(b, b.r() < 0.4 ? 'preen' : 'roost', b.r() < 0.4 ? M.preen.s : between(b.r, [6, 20])); }
      } else if (b.mode === 'run') {
        const r = stepRun(b, dt);
        P0 = r.P;
        if (r.done && roostAt) { b.dist = 0; begin(b, 'roost', between(b.r, [6, 20])); }
        else if (r.done) { b.then = 'idle'; nextForage(b, forageMiddle(ctx), { ...ctx, spread: ctx.around ? P.around.farM : L.spreadM }); if (b.mode !== 'run') b.dist = 0; }
      } else {
        if (b.mode === 'flip') P0 = flipPose(clock, u, M).pose;
        else if (b.mode === 'peck') P0 = peckPose(clock, (b.t / M.peck.s) % 1, M);
        else if (b.mode === 'preen') P0 = preenPose(clock, u, M);
        else P0 = idlePose(clock, M, b.id);
        if (b.mode === 'roost') begin(b, 'idle', 0);
        if (b.t >= b.dur) {
          const c = forageMiddle(ctx);
          // Around the walker, keep out of arm's reach.
          nextForage(b, c, { ...ctx, spread: ctx.around ? P.around.farM : L.spreadM });
          if (ctx.around && b.mode === 'run' && Math.hypot(b.tx - c.x, b.tz - c.z) < P.around.nearM) {
            const a = Math.atan2(b.tx - c.x, b.tz - c.z);
            b.tx = c.x + Math.sin(a) * P.around.nearM; b.tz = c.z + Math.cos(a) * P.around.nearM;
          }
        }
      }
      /** @type {any} */ (b).pose = P0;
    }
    birds = birds.filter((b) => !b.gone);
    separate(birds, L.bodyHalfM);
    return said;
  }

  return {
    step,
    /** The birds now (for drawing, taps and watching). */
    birds: () => birds,
    /** The flock's middle. */
    middle: () => ({ ...mid }),
    /** Every bird gone at once (the flock away, a load). */
    clear() { birds = []; },
    /** One bird's bone moves now. @param {import('../creatures/bird-rig.js').BirdRig} rig @param {Bird} b */
    moves: (rig, b) => poseBird(rig, /** @type {any} */ (b).pose ?? idlePose(clock, M, b.id), M),
  };
}

/** @typedef {ReturnType<typeof createFlockLife>} FlockLife */

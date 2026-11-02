// @ts-check
// The grey seals, alive (B3 wave 3): each seal's moment to moment on the home bar and in the sea
// around it, posed by the clips in motion.js. No GPU and no DOM, so the unit tests drive it. Live
// animation only: nothing here is saved or touches the world, so a small hash stream per seal is
// enough (never Math.random, so a test sees the same seals twice).
//
// What a seal does (recipes/species/seal.json life, presence, motion):
//   lie      hauled out at its own spot near home (spacingM apart, dry ground above the tide), curved
//            like a banana, breathing; now and then it looks about, scratches with a fore flipper,
//            yawns or shifts how it lies
//   move     to a target: humping on land and in the shallows, swimming where the water is deeper
//            than swimDepthM (y follows the ground on land, sits under the surface in the water)
//   bottle   in the water: mostly swimming about near where it is (cruise), coming up now and then
//            to hang upright with the head out, bobbing and looking about, for bottleS (Matt,
//            November 2, 2026: never a seal parked bottling); when the tide covers every spot near
//            home, after a flush, on a visit, and in the group moment (that one stays up, watching)
//   gone     a seal leaving swims out to sea and is gone
// Each seal keeps its own time (tOff), breath and bob (rate) and pace, and waits a moment of its
// own (hold) before it sets off, so a group never humps, breathes or bobs in step (Matt, November 2, 2026).
// They swim only in the sea (sea), never off into a pond dug below sea level.
// The walker inside the wary ring at Wary sends them humping into the water; they swim out flushM
// and bottle there, watching, and come back once you are beyond twice the ring for settleS. Past
// Wary they only lift their heads. A mother with her pup stays by it. The pup lies beside its
// mother, nurses, waves a flipper and rolls; where she bottles, it bottles beside her.

import { hash32 } from '../../core/rng.js';
import { ringScale } from '../creatures/presence.js';
import { separate } from '../turnstones/live.js';
import { lieMoves, humpMoves, swimMoves, bottleMoves, bottleBob } from './motion.js';

/** The golden angle, for the spots' spiral. */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** How often each seal looks at where it should be again (s). */
const THINK_S = 1.5;

/** A seal's own small stream, 0..1. @param {number} seed */
function streamOf(seed) {
  let n = 0;
  return () => (hash32(seed, n++) >>> 8) / 16777216;
}
/** @param {() => number} r @param {number[]} a [lo, hi] */
const between = (r, a) => a[0] + (a[1] - a[0]) * r();
/** The shortest turn from a to b (radians). @param {number} a @param {number} b */
const turnTo = (a, b) => { let d = b - a; d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2; return d; };

/**
 * @typedef {{ id: number, pup: boolean, x: number, z: number, y: number, yaw: number, mode: 'lie'|'move'|'bottle'|'gone',
 *   tx: number, tz: number, then: 'lie'|'bottle'|'gone', phase: number, t: number, think: number, r: () => number,
 *   banana: number, side: number, act: string, actT: number, actDur: number, look: { yaw: number, lift: number },
 *   lookTo: { yaw: number, lift: number }, wetT: number, fled: boolean, face: { x: number, z: number } | null,
 *   swim: boolean, gone: boolean, pose: any, tOff: number, rate: number, pace: number, hold: number,
 *   ax: number, az: number, upFor: number }} Seal
 *   tOff: its own clock's offset (s); rate: how fast its clock runs (its breath and bob); pace: its
 *   speed against the recipe's; hold: seconds it waits before it sets off on a move; ax, az: where
 *   it was sent to in the water (it swims about there); upFor: how long this bottle lasts (s)
 */

/**
 * @param {{ L: any, P: any, M: any, seed: number, pupK: number, ground: (x: number, z: number) => number, tide: () => number,
 *   sea?: (x: number, z: number) => boolean }} o
 *   L: the species recipe's life; P: its presence; M: its motion; pupK: the pup's size against an adult's;
 *   sea: whether (x, z) is the sea (never a pond dug below sea level); every water if not given
 */
export function createSealLife(o) {
  const { L, P, M } = o;
  /** @type {Seal[]} */ let seals = [];
  let nextId = 1, clock = 0, settleIn = 0, fledAt = /** @type {{ x: number, z: number } | null} */ (null), placed = false;
  const group = streamOf(hash32(o.seed, 0x5ea0));

  /** Water depth here (m; 0 or less on land). @param {number} x @param {number} z */
  const depth = (x, z) => o.tide() - o.ground(x, z);
  /** Dry enough to lie on. @param {number} x @param {number} z */
  const dry = (x, z) => -depth(x, z) > L.dryAboveM;
  /** Deep enough to swim to, and the sea. @param {number} x @param {number} z */
  const swimmable = (x, z) => depth(x, z) >= L.swimDepthM + 0.15 && (!o.sea || o.sea(x, z));

  /**
   * Water deep enough to swim near (x, z): searched in rings out to 40 m, preferring the side away
   * from `from` (a walker), then `out` metres further the same way where it stays deep. Null if none.
   * @param {number} x @param {number} z @param {{ x: number, z: number } | null} from @param {number} out
   */
  function waterNear(x, z, from, out) {
    const away = from ? Math.atan2(x - from.x, z - from.z) : 0;
    for (let r = 1; r <= 40; r += 1) {
      let best = null, bestK = Infinity;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
        if (!swimmable(px, pz)) continue;
        const k = from ? Math.abs(turnTo(away, a)) : i;
        if (k < bestK) { bestK = k; best = { x: px, z: pz, a }; }
      }
      if (best && (!from || bestK < 2.2)) {
        let px = best.x, pz = best.z;
        for (let s = 1; s <= out; s += 1) {
          const qx = best.x + Math.sin(best.a) * s, qz = best.z + Math.cos(best.a) * s;
          if (!swimmable(qx, qz)) break;
          px = qx; pz = qz;
        }
        return { x: px, z: pz };
      }
    }
    return null;
  }

  /**
   * Each adult's lying spot near home: down a sunflower spiral spacingM apart, within dryReachM, the
   * ones dry but no more than lieAboveM above the tide (the beach just above the water, never up the
   * bank: Matt, November 2, 2026), lowest first, one each (the mother first, so her pup lies by her).
   * @param {{ x: number, z: number }} home
   */
  function spots(home) {
    /** @type {{ x: number, z: number, h: number }[]} */ const out = [];
    for (let i = 0; i < 160; i++) {
      const r = L.spacingM * 0.62 * Math.sqrt(i + 0.5), a = i * GOLDEN;
      if (r > L.dryReachM) break;
      const x = home.x + Math.sin(a) * r, z = home.z + Math.cos(a) * r, h = -depth(x, z);
      if (h > L.lieAboveM) continue;
      if (dry(x, z) && dry(x + 0.8, z) && dry(x - 0.8, z) && dry(x, z + 0.8) && dry(x, z - 0.8)) out.push({ x, z, h });
    }
    // Lowest first, so the group lies along the water's edge; spaced by the spiral already.
    return out.sort((p, q) => p.h - q.h).slice(0, 12);
  }

  /** A new seal at (x, z), doing `mode`. @param {number} x @param {number} z @param {boolean} pup @param {'lie'|'bottle'} mode */
  function add(x, z, pup, mode) {
    const id = nextId++, r = streamOf(hash32(o.seed, id));
    /** @type {Seal} */ const s = { id, pup, x, z, y: 0, yaw: r() * Math.PI * 2, mode, tx: x, tz: z, then: mode, phase: 0, t: 0, think: r() * THINK_S, r,
      banana: 0.35 + 0.6 * r(), side: r() < 0.5 ? -1 : 1, act: 'rest', actT: 0, actDur: between(r, L.lieS), look: { yaw: 0, lift: 0 },
      lookTo: { yaw: 0, lift: 0 }, wetT: mode === 'bottle' ? 0 : 1e6, fled: false, face: null, swim: false, gone: false, pose: null,
      tOff: r() * 60, rate: between(r, L.rateK), pace: between(r, L.paceK), hold: 0, ax: x, az: z, upFor: between(r, L.bottleS) };
    seals.push(s);
    return s;
  }

  /** Send a seal to (x, z), to do `then` there. @param {Seal} s @param {number} x @param {number} z @param {'lie'|'bottle'|'gone'} then */
  function go(s, x, z, then) {
    s.tx = x; s.tz = z; s.then = then;
    if (then === 'bottle') { s.ax = x; s.az = z; }
    // Setting off: at its own point in the stride, after a moment of its own.
    if (Math.hypot(x - s.x, z - s.z) > 0.15) { if (s.mode !== 'move') { s.phase = s.r(); s.hold = s.r() * L.startJitterS; } s.mode = 'move'; }
    else s.mode = then === 'gone' ? 'gone' : then;
  }

  /**
   * Swim on to a spot of open sea within cruiseM of where it was sent (its anchor stays put), to
   * bottle there in its turn. @param {Seal} s
   */
  function cruise(s) {
    for (let i = 0; i < 8; i++) {
      const a = s.r() * Math.PI * 2, d = between(s.r, [L.cruiseM * 0.4, L.cruiseM]);
      const x = s.ax + Math.sin(a) * d, z = s.az + Math.cos(a) * d;
      if (!swimmable(x, z) || Math.hypot(x - s.x, z - s.z) < 1.5) continue;
      const ax = s.ax, az = s.az;
      go(s, x, z, 'bottle');
      s.ax = ax; s.az = az; s.hold = 0;
      return;
    }
    s.t = 0;
  }

  /** Step a moving seal toward its target. @param {Seal} s @param {number} dt */
  function move(s, dt) {
    const dx = s.tx - s.x, dz = s.tz - s.z, d = Math.hypot(dx, dz);
    const deep = depth(s.x, s.z) > L.swimDepthM;
    s.swim = deep;
    const v = Math.min(d, (deep ? L.swimMps : s.pup ? L.pupHumpMps : L.humpMps) * s.pace * dt);
    if (d > 1e-3) s.yaw += turnTo(s.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * (deep ? 1.5 : 2.5));
    // On land a seal moves only in the forward half of each hump, as the chest reaches.
    const push = deep ? 1 : Math.max(0, Math.sin(Math.PI * 2 * s.phase)) * 2;
    s.x += Math.sin(s.yaw) * v * push; s.z += Math.cos(s.yaw) * v * push;
    s.phase += deep ? dt * M.swim.hz * s.pace : (v / (M.hump.strideM * (s.pup ? 0.6 : 1)));
    if (Math.hypot(s.tx - s.x, s.tz - s.z) < 0.2) {
      if (s.then === 'gone') { s.gone = true; return; }
      s.mode = s.then; s.t = 0; s.actT = 0; s.act = 'rest'; s.upFor = between(s.r, L.bottleS);
    }
  }

  /** A seal's own clock now (its breath, its bob, its looks). @param {Seal} s */
  const own = (s) => clock * s.rate + s.tOff;

  /** The height a seal's origin sits at now. @param {Seal} s @param {number} k its size */
  function heightOf(s, k) {
    const g = o.ground(s.x, s.z), sea = o.tide();
    if (s.mode === 'bottle') return Math.max(g, sea - L.bottleBelowM * k + bottleBob(M, own(s)));
    if (s.mode === 'move' && s.swim) return Math.max(g, sea - L.swimBelowM * k);
    return g;
  }

  /**
   * One frame. @param {number} dt real seconds
   * @param {{ count: number, pup: { white: number } | null, home: { x: number, z: number } | null, walker: import('../creatures/presence.js').PresenceSource | null,
   *   band: number, trust: number, visit: { x: number, z: number, leaving: boolean } | null, around: { x: number, z: number } | null, leave?: boolean, place?: boolean }} ctx
   *   count: adults wanted; pup: the pup here and how white; home: the bar spot; band: 0 Wary, 1 Tolerant, 2 Curious;
   *   visit: a visit's seal bottling at (x, z); around: the still walker at the water's edge, once they know you
   *   (one seal comes to bottle near); leave: every seal swims off; place: set the seals at their spots at once (a load or a test)
   * @returns {string[]} what happened this frame ('flushed', 'came')
   */
  function step(dt, ctx) {
    clock += dt;
    /** @type {string[]} */ const said = [];
    const home = ctx.home;
    const adults = seals.filter((s) => !s.pup && !s.gone && !(s.mode === 'move' && s.then === 'gone'));
    const wantAdults = ctx.count + (ctx.pup && ctx.count === 0 ? 1 : 0) + (ctx.visit && !ctx.visit.leaving && !home ? L.visitSeals : 0);
    const where = home ? spots(home) : [];
    // Seals to bring: at their spots on a load, else swimming in from the sea.
    const instant = !!ctx.place || !placed;
    while (adults.length < wantAdults) {
      const n = adults.length;
      if (!home && ctx.visit) { adults.push(add(ctx.visit.x, ctx.visit.z, false, 'bottle')); continue; }
      if (!home) break;
      const at = instant ? where[n] ?? null : null;
      if (at) { const s = add(at.x, at.z, false, 'lie'); s.yaw = group() * Math.PI * 2; adults.push(s); continue; }
      const sea = waterNear(home.x, home.z, null, 8) ?? home;
      adults.push(add(sea.x + (group() - 0.5) * 3, sea.z + (group() - 0.5) * 3, false, 'bottle'));
    }
    if (home || ctx.visit) placed = true;
    // Seals to let go: the last ones first, swimming off.
    for (const s of adults.slice(wantAdults)) {
      const sea = waterNear(s.x, s.z, null, 30) ?? { x: s.x + Math.sin(s.yaw) * 30, z: s.z + Math.cos(s.yaw) * 30 };
      go(s, sea.x, sea.z, 'gone');
    }
    const mother = ctx.pup ? adults[0] ?? null : null;
    let pup = seals.find((s) => s.pup && !s.gone) ?? null;
    if (ctx.pup && !pup && mother) { pup = add(mother.x + 0.9, mother.z, true, mother.mode === 'bottle' ? 'bottle' : 'lie'); pup.banana = 0.6; }
    if (!ctx.pup && pup) {
      const sea = waterNear(pup.x, pup.z, null, 30);
      go(pup, sea?.x ?? pup.x, sea?.z ?? pup.z, 'gone');
    }

    // The walker: a flush at Wary (not a mother with her pup), heads lifted past it.
    const w = ctx.walker;
    const ring = Math.max(P.ringMinM, P.ringM * (1 - P.ringTrustShrink * ctx.trust));
    settleIn -= dt;
    let near = false;
    if (w && !ctx.leave) {
      for (const s of adults) {
        const d = Math.hypot(w.pos[0] - s.x, w.pos[2] - s.z), rr = ring * (w.ringK ?? 1) * ringScale(w, s.x, s.z, P.multipliers);
        if (d < rr) near = true;
      }
      if (near && ctx.band === 0 && home) {
        let fled = false;
        for (const s of adults) {
          if (s.fled || s === mother || s.mode === 'bottle' && depth(s.x, s.z) > L.swimDepthM) continue;
          const sea = waterNear(s.x, s.z, { x: w.pos[0], z: w.pos[2] }, between(group, L.flushM));
          if (!sea) continue;
          s.fled = true; s.face = { x: w.pos[0], z: w.pos[2] };
          go(s, sea.x + (s.r() - 0.5) * 3, sea.z + (s.r() - 0.5) * 3, 'bottle');
          fled = true;
        }
        if (fled) { said.push('flushed'); fledAt = { x: w.pos[0], z: w.pos[2] }; }
        settleIn = between(group, L.settleS);
      }
      if (fledAt) fledAt = { x: w.pos[0], z: w.pos[2] };
    }
    // Back once you are well away for a while.
    const farOff = !w || Math.hypot(w.pos[0] - (home?.x ?? 0), w.pos[2] - (home?.z ?? 0)) > ring * 2;
    if (!farOff) settleIn = Math.max(settleIn, 2);
    if (fledAt && farOff && settleIn <= 0) { for (const s of adults) { s.fled = false; s.face = null; } fledAt = null; }
    if (ctx.leave) for (const s of [...adults, ...(pup ? [pup] : [])]) if (s.then !== 'gone') {
      const sea = waterNear(s.x, s.z, null, 30);
      go(s, sea?.x ?? s.x, sea?.z ?? s.z, 'gone');
    }

    // The group moment: one seal comes in to bottle near you.
    const comer = ctx.around && home ? adults.find((s) => s !== mother && !s.fled) ?? null : null;
    let nextSpot = 0;
    for (const s of seals) {
      if (s.gone) continue;
      s.t += dt;
      s.think -= dt;
      if (s.mode === 'bottle' || (s.mode === 'move' && s.swim)) s.wetT = 0; else s.wetT += dt;
      // Where it should be, now and then.
      if (s.think <= 0 && s.then !== 'gone') {
        s.think = THINK_S;
        if (s.pup && mother) {
          const side = { x: Math.cos(mother.yaw) * 0.95 * mother.side, z: -Math.sin(mother.yaw) * 0.95 * mother.side };
          const tx = mother.x + side.x, tz = mother.z + side.z;
          if (mother.mode === 'bottle' || !dry(tx, tz)) go(s, mother.x + side.x * 1.2, mother.z + side.z * 1.2, 'bottle');
          else if (Math.hypot(tx - s.x, tz - s.z) > 0.5) go(s, tx, tz, 'lie');
        } else if (s === comer && ctx.around) {
          const sea = waterNear(ctx.around.x, ctx.around.z, null, 1);
          if (sea && Math.hypot(sea.x - ctx.around.x, sea.z - ctx.around.z) <= P.joinM + 2) {
            if (Math.hypot(sea.x - s.tx, sea.z - s.tz) > 1.5) { go(s, sea.x, sea.z, 'bottle'); said.push('came'); }
            s.face = { x: ctx.around.x, z: ctx.around.z };
          }
        } else if (!s.fled && !s.pup && home) {
          const i = adults.indexOf(s);
          const at = where[i] ?? null;
          if (at) { if (Math.hypot(at.x - s.x, at.z - s.z) > 0.6 || s.mode === 'bottle') go(s, at.x, at.z, 'lie'); }
          else if (s.mode !== 'bottle' || Math.hypot(s.x - home.x, s.z - home.z) > L.dryReachM + 12) {
            const sea = waterNear(home.x, home.z, null, 2);
            if (sea) go(s, sea.x + Math.sin(nextSpot * 2.4) * L.spacingM, sea.z + Math.cos(nextSpot * 2.4) * L.spacingM, 'bottle');
            nextSpot++;
          }
        }
      }
      // What it does.
      if (s.mode === 'move') {
        // A moment of its own before it sets off, still in the pose it had.
        if (s.hold > 0) { s.hold -= dt; if (s.pose) continue; }
        // Cruising in the water: on to the next spot round where it was sent, the way seals swim
        // about, until its next turn to bottle.
        const cruising = s.then === 'bottle' && s.swim && s !== comer;
        move(s, dt);
        // (move() may have brought it there: its mode is read afresh.)
        if (cruising && /** @type {Seal['mode']} */ (s.mode) === 'bottle' && s.r() > L.upShare) cruise(s);
        s.pose = s.swim ? swimMoves(M, s.phase) : humpMoves(M, s.phase, own(s));
        continue;
      }
      if (s.mode === 'bottle') {
        // Look at what it watches (you, after a flush), else about.
        let yaw = 0;
        if (s.face) { yaw = turnTo(s.yaw, Math.atan2(s.face.x - s.x, s.face.z - s.z)); s.yaw += Math.sign(yaw) * Math.min(Math.abs(yaw), dt * 0.4); yaw = Math.max(-1, Math.min(1, yaw)); }
        else yaw = Math.sin(own(s) * 0.23) * 0.8;
        s.pose = bottleMoves(M, own(s), yaw);
        // Up for a while, then down and swimming about again (the one come in to you stays up).
        if (s.t >= s.upFor && s !== comer && s.then !== 'gone') cruise(s);
        continue;
      }
      // Lying: its acts one after another.
      s.actT += dt;
      if (s.actT >= s.actDur) {
        s.actT = 0;
        const u = s.r();
        if (s.pup) {
          s.act = mother && u < L.nurseShare ? 'nurse' : u < L.nurseShare + 0.25 ? 'wave' : u < L.nurseShare + 0.4 ? 'roll' : 'rest';
          s.actDur = s.act === 'wave' ? 2.4 : s.act === 'roll' ? 6 : between(s.r, [5, 12]);
        } else {
          s.act = u < L.lookShare ? 'look' : u < L.lookShare + L.scratchShare ? 'scratch' : u < L.lookShare + L.scratchShare + L.shiftShare ? 'shift' : u < 0.8 ? 'rest' : 'yawn';
          s.actDur = s.act === 'scratch' ? M.scratch.s : s.act === 'yawn' ? 2.5 : between(s.r, L.lieS);
          if (s.act === 'look') s.lookTo = { yaw: (s.r() - 0.5) * 2, lift: s.r() * M.look.lift };
          if (s.act === 'shift') { s.banana = 0.35 + 0.6 * s.r(); if (s.r() < 0.4) s.side = -s.side; }
        }
      }
      // Heads up while you are near (past Wary): they watch you.
      if (near && w && !s.pup) {
        const yw = turnTo(s.yaw, Math.atan2(w.pos[0] - s.x, w.pos[2] - s.z));
        s.lookTo = { yaw: Math.max(-1.2, Math.min(1.2, yw)), lift: M.look.lift };
      } else if (s.act !== 'look') s.lookTo = { yaw: 0, lift: 0 };
      s.look.yaw += (s.lookTo.yaw - s.look.yaw) * Math.min(1, dt * 2);
      s.look.lift += (s.lookTo.lift - s.look.lift) * Math.min(1, dt * 2);
      // A nursing pup turns to lie head to its mother's belly.
      if (s.pup && s.act === 'nurse' && mother) s.yaw += turnTo(s.yaw, mother.yaw + Math.PI * 0.5 * mother.side) * Math.min(1, dt);
      const f = s.actDur > 0 ? s.actT / s.actDur : 0;
      s.pose = lieMoves(M, own(s), { banana: s.pup && s.act === 'nurse' ? 0.2 : s.banana, side: s.side, look: s.look,
        scratch: s.act === 'scratch' ? f : -1, yawn: s.act === 'yawn' ? Math.sin(Math.PI * f) : 0, pup: s.pup,
        wave: s.act === 'wave' ? f : -1, rollOver: s.act === 'roll' ? Math.sin(Math.PI * f) : 0 });
    }
    seals = seals.filter((s) => !s.gone);
    // No two bodies overlap, but a pup may lie close by its mother.
    const adultsNow = seals.filter((s) => !s.pup);
    separate(/** @type {any} */ (adultsNow), L.bodyHalfM, 6);
    const pupNow = seals.find((s) => s.pup);
    if (pupNow) separate(/** @type {any} */ ([...adultsNow.filter((s) => s !== mother), pupNow]), [L.bodyHalfM[0] * o.pupK + 0.2, L.bodyHalfM[1] * o.pupK + 0.3], 3);
    return said;
  }

  return {
    step,
    /** The seals now (for drawing, taps and watching). */
    seals: () => seals,
    /** The middle of the group (where they are watched from). */
    middle() {
      if (!seals.length) return { x: 0, z: 0 };
      let x = 0, z = 0;
      for (const s of seals) { x += s.x; z += s.z; }
      return { x: x / seals.length, z: z / seals.length };
    },
    /** A seal's height now. @param {Seal} s @param {number} k its size */
    heightOf,
    /** Every seal gone at once (a load). */
    clear() { seals = []; placed = false; },
    /** How wet a seal's coat is (1 fresh from the water .. 0 dry). @param {Seal} s @param {number} dryS */
    wetOf: (s, dryS) => Math.max(0, 1 - s.wetT / dryS),
  };
}

/** @typedef {ReturnType<typeof createSealLife>} SealLife */

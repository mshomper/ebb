// @ts-check
// The hen's life (docs/future/15, slice 1): a wary hen in the scrub. By day she forages about her
// home: walks to a seeded spot, scratches (kick, kick, a step back, a look down with one eye, a peck
// or a few), stands a while, walks on. The walker coming inside her ring makes her freeze upright,
// then run away toward cover; the camera above never counts. At night she goes to the middle of the
// scrub and stands there. The head lock is kept here, from the distance she moves.
//
// Slice 2, her bands (bands.js chooses, this walks it): past Wary she only steps aside when you come
// close, forages near you, comes to see you, waits by soil you dig, follows you, settles by the fire
// at dusk (the settle pose), and at Fond greets you at dawn and settles beside you by the fire. A
// treat set out (treatAt) brings her to peck it up. Every move is her walk, run, peck, look and
// settle clips, timed to the distance she covers.
//
// Live animation only (never saved): her own seeded stream, so she does the same on every device
// for the same moves. Plain Math is fine here. Numbers: recipes/species/hen.json life, wary, motion.

import { stream } from '../../core/rng.js';
import { ringScale } from '../creatures/presence.js';
import { choosePlan, asideSpot, nearYouSpot, bandRec, isDusk, sitsByFire, PRIORITY } from './bands.js';

/** How often she thinks about what to do next (seconds). */
const THINK_S = 0.4;
/** How long a hole stays fresh enough to bring her (Curious on), seconds. */
const DIG_FRESH_S = 6;

/**
 * The scrub she lives in: the middle of the largest cluster of grown bushes, or null while there is
 * none. Pure. @param {{ sp: string, x: number, z: number, size: number }[]} plants
 * @param {{ species: string[], minSize: number, minBushes: number, clusterM: number }} H recipes/species/hen.json home
 * @returns {{ x: number, z: number, bushes: number } | null}
 */
export function scrubHome(plants, H) {
  const bushes = plants.filter((p) => H.species.includes(p.sp) && p.size >= H.minSize);
  let best = null, bestN = 0;
  for (const b of bushes) {
    const near = bushes.filter((c) => (c.x - b.x) ** 2 + (c.z - b.z) ** 2 <= H.clusterM * H.clusterM);
    if (near.length > bestN) { bestN = near.length; best = near; }
  }
  if (!best || bestN < H.minBushes) return null;
  return { x: best.reduce((s, c) => s + c.x, 0) / bestN, z: best.reduce((s, c) => s + c.z, 0) / bestN, bushes: bestN };
}

/** Wrap an angle to -pi..pi. @param {number} a */
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/**
 * @param {{ R: any, seed: number, ground: (x: number, z: number) => number, wet: (x: number, z: number) => boolean }} o
 *   R: recipes/species/hen.json; wet: water where she will not step (the sea, a pond)
 */
export function createHenLife(o) {
  const R = o.R, L = R.life, W = R.wary, M = R.motion, HL = M.headLock;
  const k = R.body.displayScale ?? 1;
  const rng = stream(o.seed >>> 0, 0x4e4);
  const range = (/** @type {number[]} */ r) => r[0] + (r[1] - r[0]) * rng.next();
  /** @type {{ x: number, z: number, r: number }} */ let home = { x: 0, z: 0, r: R.home.rangeM };
  const hen = {
    x: 0, y: 0, z: 0, yaw: 0, t: 0,
    /** @type {'idle'|'walk'|'act'|'alert'|'flee'|'go'|'settle'} */ mode: 'idle',
    /** What a 'go' (and the act or settle after it) is for (bands.js Plan). @type {import('./bands.js').Plan | null} */ plan: null,
    settle: 0, thinkAt: 0, greetedDay: -1, visitAt: 0, band: 0,
    /** A treat she is going for, and what to say when it is eaten. @type {{ x: number, z: number, tid: number, treat: string, from: number, eaten: (tid: number, treat: string) => void } | null} */ treat: null,
    /** A fresh hole she noticed. @type {{ x: number, z: number, at: number } | null} */ dig: null,
    /** @type {{ x: number, z: number, speed: number, sit: boolean } | null} */ walker: null,
    until: 0, target: { x: 0, z: 0 }, speed: 0, phase: 0, walk: 0, run: 0,
    /** @type {{ a: string, side?: 'l'|'r', s: number }[]} */ queue: [],
    /** @type {{ a: string, side?: 'l'|'r', s: number, u: number } | null} */ act: null,
    kick: /** @type {{ side: 'l'|'r', u: number } | null} */ (null), peck: 0,
    look: { yaw: 0, tilt: 0, down: 0 }, lookTo: { yaw: 0, tilt: 0, down: 0 }, nextLook: 0,
    alert: 0, alertTo: 0, lockM: 0, snapping: false, snapTo: 0, fleeT: 0, night: false,
    /** @type {[number, number] | null} */ from: null,
  };

  /** Pick a dry spot in her range, at least minLegM away, or null. */
  function pickTarget() {
    for (let i = 0; i < L.targetTries; i++) {
      const a = rng.next() * Math.PI * 2, r = home.r * Math.sqrt(rng.next());
      const x = home.x + Math.sin(a) * r, z = home.z + Math.cos(a) * r;
      if (Math.hypot(x - hen.x, z - hen.z) < L.minLegM || o.wet(x, z)) continue;
      return { x, z };
    }
    return null;
  }

  /** The scratch, cycles times, then a pause. */
  function forage() {
    hen.queue = [];
    const cycles = Math.round(range(L.cycles));
    for (let c = 0; c < cycles; c++) {
      const first = rng.next() < 0.5 ? 'l' : 'r';
      hen.queue.push({ a: 'kick', side: first, s: L.kickS }, { a: 'kick', side: first === 'l' ? 'r' : 'l', s: L.kickS },
        { a: 'back', s: L.backS }, { a: 'look', s: range(L.lookS) });
      const pecks = Math.round(range(L.pecks));
      for (let p = 0; p < pecks; p++) hen.queue.push({ a: 'peck', s: L.peckS });
    }
    hen.mode = 'act';
    hen.act = null;
  }

  /** Stand a while. @param {number} [s] */
  function idle(s) { hen.mode = 'idle'; hen.until = hen.t + (s ?? range(L.idleS)); hen.queue = []; hen.act = null; hen.plan = null; }

  /** Walk on to a new spot (near you, past Wary, when you are close), or stand if none. */
  function wander() {
    const near = nearYouSpot(R, hen.band, hen, hen.walker, rng.next(), rng.next());
    const to = near && !o.wet(near.x, near.z) ? near : pickTarget();
    if (to) { hen.mode = 'walk'; hen.target = to; hen.plan = null; } else idle();
  }

  /** Take up a plan: walk (or run) to its spot. @param {import('./bands.js').Plan} p */
  function take(p) {
    if (o.wet(p.x, p.z)) return;
    hen.mode = 'go'; hen.plan = p; hen.target = { x: p.x, z: p.z }; hen.queue = []; hen.act = null;
  }

  /** Turn to face a point. @param {number} x @param {number} z @param {number} dt */
  function face(x, z, dt) {
    const off = wrap(Math.atan2(x - hen.x, z - hen.z) - hen.yaw);
    hen.yaw = wrap(hen.yaw + Math.max(-L.turnRadS * dt, Math.min(L.turnRadS * dt, off)));
  }

  /** The head turned to look at a point, with a curious tilt. @param {number} x @param {number} z @param {number} tilt */
  function gazeAt(x, z, tilt) {
    hen.lookTo = { yaw: Math.max(-1, Math.min(1, wrap(Math.atan2(x - hen.x, z - hen.z) - hen.yaw))), tilt, down: -0.2 };
  }

  /** Arrived where a plan led: what she does there. @param {import('./bands.js').Plan} p */
  function arrive(p) {
    const B = R.bands;
    if (p.purpose === 'treat') {
      const n = R.treat?.pecks ?? 3;
      hen.queue = [{ a: 'look', s: range(L.lookS) }];
      for (let i = 0; i < n; i++) hen.queue.push({ a: 'peck', s: L.peckS });
      hen.mode = 'act'; hen.act = null;
    } else if (p.purpose === 'dig') {
      // At the edge of the turned soil: looks, and pecks at the spoil, a while.
      hen.queue = [];
      for (let s = 0; s < B.dig.waitS;) {
        const look = range(L.lookS);
        hen.queue.push({ a: 'look', s: look }, { a: 'peck', s: L.peckS }, { a: 'stand', s: range(L.idleS) * 0.6 });
        s += look + L.peckS + 2;
      }
      hen.mode = 'act'; hen.act = null;
    } else if (p.purpose === 'visit' || p.purpose === 'greet') {
      hen.queue = [{ a: 'gaze', s: p.purpose === 'greet' ? 2.4 : 1.6 }, { a: 'stand', s: 0.8 }];
      if (p.purpose === 'greet') hen.queue.push({ a: 'gaze', s: 1.2 });
      hen.mode = 'act'; hen.act = null;
    } else if (p.purpose === 'ring' || p.purpose === 'beside') {
      hen.mode = 'settle'; hen.queue = []; hen.act = null;
    } else idle(range(W.settleS) * 0.5);
  }

  /**
   * Move toward her target at a pace, turning as she goes; she never steps into water.
   * @param {number} dt @param {number} pace m/s @param {number} turnRate rad/s @returns {boolean} arrived
   */
  function go(dt, pace, turnRate) {
    const dx = hen.target.x - hen.x, dz = hen.target.z - hen.z, d = Math.hypot(dx, dz);
    if (d < 0.05) { hen.speed += (0 - hen.speed) * Math.min(1, dt * 10); return true; }
    const off = wrap(Math.atan2(dx, dz) - hen.yaw);
    hen.yaw = wrap(hen.yaw + Math.max(-turnRate * dt, Math.min(turnRate * dt, off)));
    // Slower while still turning toward it, and slowing into the spot.
    const want = pace * Math.max(0.25, Math.cos(Math.min(Math.abs(off), Math.PI / 2))) * Math.min(1, d / 0.25 + 0.3);
    hen.speed += (want - hen.speed) * Math.min(1, dt * 6);
    const step = Math.min(d, hen.speed * dt);
    const nx = hen.x + Math.sin(hen.yaw) * step, nz = hen.z + Math.cos(hen.yaw) * step;
    if (o.wet(nx, nz)) { hen.speed = 0; return true; }
    move(nx, nz, step);
    return false;
  }

  /** Step to a spot, counting the stride and the head lock. @param {number} nx @param {number} nz @param {number} signed metres along her heading */
  function move(nx, nz, signed) {
    hen.x = nx; hen.z = nz;
    const stride = M.strideM + (M.runStrideM - M.strideM) * hen.run;
    hen.phase += signed / stride;
    // The head holds still in the world while the body walks under it, then jumps forward.
    if (hen.run < 0.5 && !hen.snapping) {
      hen.lockM -= signed / k;
      if (hen.lockM < -HL.lockM || hen.lockM > HL.lockM) { hen.snapping = true; hen.snapTo = hen.lockM < 0 ? HL.leadM : -HL.leadM; }
    }
  }

  /**
   * The walker inside her ring (her band's), as a ratio of it (under 1 is inside), or Infinity with no
   * walker; keeps hen.walker. The camera above is never felt. @param {import('../creatures/presence.js').PresenceSource[]} sources
   */
  function walkerRatio(sources) {
    let best = Infinity;
    hen.walker = null;
    const ringM = hen.band > 0 ? bandRec(R.bands, hen.band).ringM : W.ringM;
    for (const s of sources) {
      if (s.kind !== 'walker' || !s.body) continue;
      hen.walker = { x: s.pos[0], z: s.pos[2], speed: s.speed ?? 0, sit: s.posture === 'sit' };
      const ring = ringM * (s.ringK ?? 1) * ringScale(s, hen.x, hen.z, W.multipliers);
      const d = Math.hypot(s.pos[0] - hen.x, s.pos[2] - hen.z);
      if (d / ring < best) { best = d / ring; hen.from = [s.pos[0], s.pos[2]]; }
    }
    return best;
  }

  /** A flee target: away from the walker, drawn back toward her home's side if she strays far. */
  function fleeTarget() {
    const f = hen.from ?? [hen.x - Math.sin(hen.yaw), hen.z - Math.cos(hen.yaw)];
    let ax = hen.x - f[0], az = hen.z - f[1];
    const al = Math.hypot(ax, az) || 1;
    ax /= al; az /= al;
    // Toward home when home is not behind the walker.
    const hx = home.x - hen.x, hz = home.z - hen.z, hl = Math.hypot(hx, hz);
    if (hl > 0.5 && (hx * ax + hz * az) / hl > -0.2) { ax += (hx / hl) * 0.6; az += (hz / hl) * 0.6; }
    for (let i = 0; i < 8; i++) {
      const a = Math.atan2(ax, az) + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.5;
      const x = hen.x + Math.sin(a) * 3, z = hen.z + Math.cos(a) * 3;
      if (!o.wet(x, z)) return { x, z };
    }
    return { x: hen.x, z: hen.z };
  }

  return {
    hen,
    get home() { return home; },
    /**
     * Put her down at a home (her scrub), on a dry spot near its middle; or change her home in place.
     * @param {{ x: number, z: number }} at @param {number} r her range (m) @param {boolean} [fresh] stand her there
     */
    setHome(at, r, fresh = false) {
      home = { x: at.x, z: at.z, r };
      if (!fresh) return;
      hen.x = at.x; hen.z = at.z; hen.y = o.ground(at.x, at.z); hen.yaw = rng.next() * Math.PI * 2;
      idle();
    },

    /**
     * A treat set out near her (treats.js): she comes for it if it is within treat.reachM, after
     * treat.noticeS; at Wary only once you are treat.waryClearM from it. `eaten` is called when she
     * has pecked it up. @param {number} x @param {number} z @param {{ tid: number, treat: string }} t
     * @param {(tid: number, treat: string) => void} eaten @returns {'coming'|'waiting'|'none'}
     */
    treatAt(x, z, t, eaten) {
      const T = R.treat;
      if (!T || hen.night || Math.hypot(x - hen.x, z - hen.z) > T.reachM) return 'none';
      hen.treat = { x, z, tid: t.tid, treat: t.treat, from: hen.t + T.noticeS, eaten };
      const w = hen.walker;
      return hen.band === 0 && w && Math.hypot(w.x - x, w.z - z) < T.waryClearM ? 'waiting' : 'coming';
    },
    /** A treat gone from the ground before she reached it (eaten by another, faded). @param {number} tid */
    treatGone(tid) {
      if (hen.treat?.tid !== tid) return;
      hen.treat = null;
      if (hen.plan?.purpose === 'treat') idle();
    },
    /** A hole just dug at (x, z): Curious on, she comes to wait at its edge if it is near. @param {number} x @param {number} z */
    dugAt(x, z) {
      if (hen.band >= 2 && Math.hypot(x - hen.x, z - hen.z) <= R.bands.dig.noticeM) hen.dig = { x, z, at: hen.t };
    },

    /**
     * One frame of her life. @param {number} dt seconds
     * @param {{ night: boolean, sources: import('../creatures/presence.js').PresenceSource[], band?: number,
     *   ring?: { x: number, z: number } | null, hourOfDay?: number, day?: number }} c
     *   band: 0 Wary .. 4 Fond (trust.js henBand); ring: the laid fire ring; hourOfDay, day: the game clock
     */
    step(dt, c) {
      hen.t += dt;
      hen.band = c.band ?? 0;
      const B = R.bands, hourOfDay = c.hourOfDay ?? 12, ring = c.ring ?? null;
      const ratio = walkerRatio(c.sources);
      const w = hen.walker;
      // At Familiar her night is by the fire, so the scrub's night does not call her home.
      const fireNight = hen.band >= 3 && !!ring && !!B && isDusk(B, hourOfDay);
      const night = c.night && !fireNight;
      if (hen.band === 0) {
        // Wary: inside the ring she freezes upright, then runs; well inside it she runs at once.
        if (hen.mode !== 'flee' && ratio <= 1) {
          if (ratio <= W.panicShare || (hen.mode === 'alert' && hen.t >= hen.until)) {
            hen.mode = 'flee'; hen.fleeT = 0; hen.target = fleeTarget(); hen.queue = []; hen.act = null; hen.plan = null;
          } else if (hen.mode !== 'alert') {
            hen.mode = 'alert'; hen.until = hen.t + W.alertS; hen.queue = []; hen.act = null; hen.plan = null;
          }
        } else if (hen.mode === 'alert' && ratio > 1) idle(range(W.settleS));
      } else {
        if (hen.mode === 'alert' || hen.mode === 'flee') idle(range(W.settleS) * 0.5);
        // Past Wary she only steps aside, briskly, out to her keeping distance; settled, greeting you,
        // at a treat, waiting by a hole or coming to see you, only if you come right up to her.
        const near = hen.mode === 'settle' || ['beside', 'ring', 'greet', 'treat', 'dig', 'visit'].includes(hen.plan?.purpose ?? '');
        if (w && ratio <= (near ? 0.5 : 1) && hen.plan?.purpose !== 'aside') take(asideSpot(R, hen.band, hen, w));
      }
      // Night (before Familiar, or no ring laid): to the middle of the scrub, and stand.
      if (night && !hen.night && hen.mode !== 'flee' && hen.mode !== 'alert') { hen.mode = 'walk'; hen.target = { x: home.x, z: home.z }; hen.queue = []; hen.act = null; hen.plan = null; }
      hen.night = night;
      if (hen.dig && hen.t - hen.dig.at > DIG_FRESH_S && hen.plan?.purpose !== 'dig') hen.dig = null;

      // What next, every so often: a plan with a higher purpose than the one in hand takes over.
      if (B && hen.mode !== 'alert' && hen.mode !== 'flee' && hen.t >= hen.thinkAt) {
        hen.thinkAt = hen.t + THINK_S;
        // Settled for a reason that has gone (you stood up; dawn came): she gets up first.
        const besideGone = hen.plan?.purpose === 'beside' && !(ring && w && hen.band >= 4 && sitsByFire(B, { walker: w, ring }));
        const ringGone = hen.plan?.purpose === 'ring' && !fireNight;
        if (hen.mode === 'settle' && (besideGone || ringGone)) idle();
        const waits = hen.band === 0 && !!w && !!hen.treat && Math.hypot(w.x - hen.treat.x, w.z - hen.treat.z) < (R.treat?.waryClearM ?? 0);
        const T = hen.treat && hen.t >= hen.treat.from && !waits ? hen.treat : null;
        if (hen.band >= 2 && hen.visitAt === 0) hen.visitAt = hen.t + range(bandRec(B, hen.band).visitEveryS);
        const plan = night && !T ? null : choosePlan(R, { band: hen.band, hen, home, walker: w, ring, hourOfDay, day: c.day ?? 0,
          greetedDay: hen.greetedDay, treat: T, dig: hen.dig, visitDue: hen.band >= 2 && hen.visitAt > 0 && hen.t >= hen.visitAt,
          following: hen.plan?.purpose === 'follow' });
        const cur = hen.plan ? PRIORITY[hen.plan.purpose] : 0;
        if (plan) {
          const same = hen.plan?.purpose === plan.purpose;
          // The same plan re-aimed (you moved on); a settled one stays put unless its spot moved off.
          if (same && hen.mode === 'go') { hen.plan = plan; hen.target = { x: plan.x, z: plan.z }; }
          else if (same && hen.mode === 'settle' && Math.hypot(plan.x - hen.x, plan.z - hen.z) > 0.6) take(plan);
          else if (!same && PRIORITY[plan.purpose] > cur) {
            if (plan.purpose === 'visit') hen.visitAt = hen.t + range(bandRec(B, hen.band).visitEveryS);
            if (plan.purpose === 'greet') hen.greetedDay = c.day ?? 0;
            take(plan);
          }
        } else if (hen.mode === 'go' && hen.plan?.purpose === 'follow') idle(range(L.idleS) * 0.5);
      }

      hen.kick = null;
      let peck = 0;
      hen.alertTo = hen.mode === 'alert' ? 1 : hen.mode === 'flee' ? 0.6 : 0;
      const settleTo = hen.mode === 'settle' ? 1 : 0;
      if (hen.mode === 'alert') {
        hen.speed += (0 - hen.speed) * Math.min(1, dt * 12);
        if (hen.from) hen.lookTo = { yaw: Math.max(-1, Math.min(1, wrap(Math.atan2(hen.from[0] - hen.x, hen.from[1] - hen.z) - hen.yaw))), tilt: 0, down: -0.15 };
      } else if (hen.mode === 'flee') {
        hen.fleeT += dt;
        if (hen.fleeT % 0.5 < dt) hen.target = fleeTarget();
        go(dt, W.runMps, L.turnRadS * 2);
        const far = hen.from ? Math.hypot(hen.from[0] - hen.x, hen.from[1] - hen.z) : Infinity;
        if (far >= W.calmM && hen.fleeT >= W.fleeMinS) idle(range(W.settleS));
      } else if (hen.mode === 'go' && hen.plan) {
        const p = hen.plan;
        // She gets up from settling before she walks off.
        if (hen.settle > 0.05) hen.speed += (0 - hen.speed) * Math.min(1, dt * 10);
        else if (go(dt, p.pace, L.turnRadS * (p.pace > L.walkMps ? 1.6 : 1))) {
          if (p.purpose === 'follow' || p.purpose === 'aside') { hen.plan = null; if (rng.next() < 0.6) forage(); else idle(); }
          else arrive(p);
        }
      } else if (hen.mode === 'settle') {
        // Settled by the fire (or beside you): facing the ring, glancing now and then.
        hen.speed += (0 - hen.speed) * Math.min(1, dt * 10);
        if (ring) face(ring.x, ring.z, dt);
        if (hen.t >= hen.nextLook) { hen.lookTo = { yaw: (rng.next() * 2 - 1) * L.lookYawRad * 0.6, tilt: 0, down: 0.1 }; hen.nextLook = hen.t + range(L.lookEveryS) * 3; }
      } else if (hen.mode === 'walk') {
        if (go(dt, L.walkMps, L.turnRadS)) { if (hen.night) idle(); else if (rng.next() < 0.75) forage(); else idle(); }
      } else if (hen.mode === 'idle') {
        hen.speed += (0 - hen.speed) * Math.min(1, dt * 10);
        if (hen.t >= hen.until && !hen.night) { if (rng.next() < 0.35) forage(); else wander(); }
        else if (hen.night && Math.hypot(home.x - hen.x, home.z - hen.z) > 0.6 && hen.t >= hen.until) { hen.mode = 'walk'; hen.target = { x: home.x, z: home.z }; }
      } else if (hen.mode === 'act') {
        if (!hen.act) {
          const next = hen.queue.shift();
          if (!next) {
            // A treat pecked up: eaten. Soil waited at: done with.
            const tr = hen.plan?.purpose === 'treat' ? hen.treat : null;
            if (tr) { hen.treat = null; tr.eaten(tr.tid, tr.treat); }
            if (hen.plan?.purpose === 'dig') hen.dig = null;
            idle();
          } else {
            hen.act = { ...next, u: 0 };
            if (next.a === 'look') hen.lookTo = { yaw: 0, tilt: (rng.next() < 0.5 ? -1 : 1) * M.lookTiltRad, down: M.lookDownRad };
            if (next.a === 'gaze' && w) gazeAt(w.x, w.z, (rng.next() < 0.5 ? -1 : 1) * M.lookTiltRad * 0.6);
          }
        }
        const a = hen.act;
        if (a) {
          a.u += dt / a.s;
          const u = Math.min(1, a.u);
          if (a.a === 'kick') hen.kick = { side: /** @type {'l'|'r'} */ (a.side), u };
          else if (a.a === 'peck') peck = u < 0.35 ? u / 0.35 : 1 - (u - 0.35) / 0.65;
          else if (a.a === 'gaze' && w) face(w.x, w.z, dt);
          else if (a.a === 'back') {
            const v = -L.backM / L.backS;
            hen.speed = v;
            const nx = hen.x + Math.sin(hen.yaw) * v * dt, nz = hen.z + Math.cos(hen.yaw) * v * dt;
            if (!o.wet(nx, nz)) move(nx, nz, v * dt);
          }
          if (a.a !== 'back') hen.speed += (0 - hen.speed) * Math.min(1, dt * 12);
          if (a.u >= 1) {
            if (a.a === 'look' && hen.queue[0]?.a !== 'peck') hen.lookTo = { yaw: 0, tilt: 0, down: 0 };
            if (a.a === 'peck' && hen.queue[0]?.a !== 'peck') hen.lookTo = { yaw: 0, tilt: 0, down: 0 };
            if (a.a === 'gaze') hen.lookTo = { yaw: 0, tilt: 0, down: 0 };
            hen.act = null;
          }
        }
      }
      // Glances: a new small turn of the head every so often, snapped to and held (not while scratching or alert).
      if ((hen.mode === 'idle' || hen.mode === 'walk' || hen.mode === 'go') && hen.t >= hen.nextLook) {
        hen.lookTo = { yaw: (rng.next() * 2 - 1) * L.lookYawRad, tilt: 0, down: 0 };
        hen.nextLook = hen.t + range(L.lookEveryS);
      }
      const snap = Math.min(1, dt * 14);
      hen.look = { yaw: hen.look.yaw + (hen.lookTo.yaw - hen.look.yaw) * snap, tilt: hen.look.tilt + (hen.lookTo.tilt - hen.look.tilt) * snap,
        down: hen.look.down + (hen.lookTo.down - hen.look.down) * snap };
      hen.alert += (hen.alertTo - hen.alert) * Math.min(1, dt * 10);
      // Settling down and getting up take settleS, never a pop.
      hen.settle += Math.sign(settleTo - hen.settle) * Math.min(Math.abs(settleTo - hen.settle), dt / (M.settleS ?? 0.8));
      hen.peck = peck;
      // How much the legs swing and how much of it is a run, from her speed.
      const sp = Math.abs(hen.speed);
      hen.walk += (Math.min(1, sp / (L.walkMps * 0.6)) - hen.walk) * Math.min(1, dt * 10);
      hen.run = Math.min(1, Math.max(0, (sp - L.walkMps) / (W.runMps - L.walkMps)));
      // The head lock's jump forward, and its ease home when she stops or runs.
      if (hen.snapping) {
        const goal = hen.snapTo, rate = (HL.lockM + HL.leadM) / HL.snapS;
        const d = goal - hen.lockM;
        hen.lockM += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
        if (Math.abs(goal - hen.lockM) < 1e-4) hen.snapping = false;
      } else if (sp < 0.03 || hen.run > 0.5) hen.lockM += (0 - hen.lockM) * Math.min(1, dt * 8);
      hen.y = o.ground(hen.x, hen.z);
    },

    /** What the clips need this frame (motion.js HenPose). @returns {import('./motion.js').HenPose} */
    poseInput: () => ({ t: hen.t, phase: hen.phase, walk: hen.walk, run: hen.run, kick: hen.kick, peck: hen.peck, look: hen.look, alert: hen.alert, lockM: hen.lockM, settle: hen.settle }),
  };
}

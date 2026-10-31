// @ts-check
// The walker's feet (doc 23, the walker; W1 and W2): where you stand, where you are walking to and
// how fast. One calm pace, a stroll, that eases to a creep by itself near a creature, so a tap never
// scares anything; a double tap hurries (brisk) until you arrive. The water is read live: if the
// tide comes up over the way ahead, or over where you stand, you wade back to the nearest ground
// you can stand on by yourself (a move the game makes). Numbers: recipes/world/walker.json.
// Pure: no DOM, no GPU; safe to import from tools pages and tests.

import { findPath, nearestOpen, isOpen } from './path.js';

/**
 * @typedef {Object} WalkerEnv
 * @property {import('./grid.js').WalkGrid} grid
 * @property {(k: number) => number} depth water over a cell right now (m)
 * @property {(x: number, z: number) => number} ground the land's height (m)
 * @property {(x: number, z: number) => number} [nearest] distance to the nearest creature (m)
 * @property {import('./solids.js').Solids} [solids] solid things you cannot walk through
 * @property {() => number} [paceK] a lift on every pace (a tea's boon, P2e; 1 without one)
 * @property {() => { x: number, z: number, r: number }[]} [bodies] solid round bodies this frame, slid
 *   round (r includes the walker's own radius; the Hollow's things holding their ground, H2)
 */

/**
 * @param {any} R recipes/world/walker.json
 * @param {WalkerEnv} env
 */
export function createWalker(R, env) {
  const G = R.grid, P = R.pace, ST = R.steer;
  /** @type {import('./path.js').WalkRules} */
  const rules = { depth: env.depth, wadeM: G.wadeM, wadeCost: G.wadeCost, maxStepM: G.maxStepM, snapM: G.snapM,
    wadeEnterCost: G.wadeEnterCost, dryM: G.dryM, footCost: G.footCost };
  const s = {
    placed: false, x: 0, z: 0, y: 0, yaw: 0, speed: 0,
    /** @type {[number, number][]} */ path: [],
    brisk: false,
    /** Wading back to dry ground on its own, as the tide comes in. */
    retreating: false,
    /** Standing, kneeling or sitting (W4); walking always stands you up. @type {'stand'|'kneel'|'sit'} */
    posture: /** @type {'stand'|'kneel'|'sit'} */ ('stand'),
    /** Steering (keys): the way wanted this frame (world x, z, length 0..1) and whether Shift runs. */
    want: { x: 0, z: 0, run: false },
    /** Steering: the pace being driven toward (m/s); speed is what the feet really cover. */
    v: 0,
    /** A dodge roll under way: its way (unit x, z) and time into it (s); null when none. @type {{ x: number, z: number, t: number } | null} */
    roll: null,
    /** Seconds until another roll may start. */
    rollWait: 0,
    /** Coming out of a roll: its way, kept for steer.roll.carryS. @type {{ x: number, z: number, t: number } | null} */
    carry: null,
    /** Falling (off an edge a roll went over): the feet's speed down (m/s). */
    fallV: 0,
  };

  /** The feet onto the ground: at once when it is near, falling when it drops away (off an edge). @param {number} dt */
  function settle(dt) {
    const g = env.ground(s.x, s.z);
    // A drop past the step is a fall; steps and slopes are walked down as before.
    if ((s.fallV > 0 || g < s.y - G.maxStepM) && g < s.y && dt > 0) {
      s.fallV += ST.fallMps2 * dt;
      s.y = Math.max(g, s.y - s.fallV * dt);
    } else s.y = g;
    if (s.y <= g) s.fallV = 0;
  }
  /** The feel in use (recipes/world/walker.json steer.profiles): island now, hollow later. */
  let feel = ST.profiles[ST.profile];

  /**
   * Could you step from one spot to another, one short step (grid rules: open, no cliff, no cut
   * corner)? Rolling (Matt, October 26, 2026), steep ground is no bar and you may drop off any edge;
   * only climbing past the step, deep water and solid things stop you.
   */
  function canStep(/** @type {number} */ x0, /** @type {number} */ z0, /** @type {number} */ x1, /** @type {number} */ z1, rolling = false) {
    // A solid thing (solids.js), tested exactly: never into one (stepping out of one is fine).
    if (env.solids && env.solids.hit(x1, z1) && !env.solids.hit(x0, z0)) return false;
    const g = env.grid, k0 = g.cellAt(x0, z0), k1 = g.cellAt(x1, z1);
    if (k1 < 0) return false;
    if (k1 === k0) return true;
    // The ground's own rules here; solids were tested above, finer than their closed cells.
    const open = (/** @type {number} */ k) => k >= 0 && (rolling || !g.steep[k]) && env.depth(k) < G.wadeM;
    // Never up past the step, wherever you stand (a roll may have left you on a steep slope).
    const climb = k0 >= 0 ? g.height[k1] - g.height[k0] : 0;
    if (climb > G.maxStepM) return false;
    // Left on a steep slope by a roll, you may still walk down it, never up.
    const downSlope = k0 >= 0 && g.steep[k0] && g.steep[k1] && climb <= 0 && env.depth(k1) < G.wadeM;
    if (!open(k1) && !downSlope) return false;
    // Standing somewhere closed (a stroke, the tide, a slope a roll left you on), any open cell beside you is a way out.
    if (!open(k0)) return true;
    if (!rolling && -climb > G.maxStepM) return false;
    const i0 = k0 % g.w, j0 = Math.floor(k0 / g.w), i1 = k1 % g.w, j1 = Math.floor(k1 / g.w);
    // Across a corner: both cells beside it open, as the paths never cut one.
    if (i0 !== i1 && j0 !== j1) return open(j0 * g.w + i1) && open(j1 * g.w + i0);
    return true;
  }

  /**
   * A step round solid bodies (env.bodies: circles, the walker's own radius included; in the Hollow a
   * thing holding its ground): the part of the step going into one is taken off, so you slide round it
   * and never stop dead; head on, you slide to its left (a fixed side, so a walk is repeatable). A step
   * never ends deeper in one than it started (stepping out of one is fine). A roll obeys it too.
   * @param {number} sx @param {number} sz @returns {[number, number]}
   */
  function roundBodies(sx, sz) {
    const bodies = env.bodies?.();
    if (!bodies?.length) return [sx, sz];
    const len = Math.hypot(sx, sz);
    for (const b of bodies) {
      const nx0 = s.x + sx - b.x, nz0 = s.z + sz - b.z, d = Math.hypot(nx0, nz0);
      if (d >= b.r || d < 1e-9) continue;
      const nx = nx0 / d, nz = nz0 / d, into = sx * nx + sz * nz;
      if (into >= 0) continue;
      sx -= into * nx; sz -= into * nz;
      // Head on: what is left is too little to slide on, so slide to its left at half the step.
      if (Math.hypot(sx, sz) < len * 0.3) { sx += -nz * len * 0.5; sz += nx * len * 0.5; }
    }
    // Still deeper in one than before (a curve's bend): back onto its edge.
    for (const b of bodies) {
      const x1 = s.x + sx, z1 = s.z + sz, d1 = Math.hypot(x1 - b.x, z1 - b.z), d0 = Math.hypot(s.x - b.x, s.z - b.z);
      if (d1 < b.r && d1 < d0 && d1 > 1e-9) { const e = Math.min(b.r, d0); sx = b.x + (x1 - b.x) / d1 * e - s.x; sz = b.z + (z1 - b.z) / d1 * e - s.z; }
    }
    return [sx, sz];
  }

  /**
   * Move by (dx, dz), sliding along whatever blocks the way: the step is tried whole, then along each
   * axis (the grid's edges), the longer first. slide false: all or nothing (a roll stops short).
   * rolling: a roll's rules (canStep).
   * @returns {number} meters moved
   */
  function moveBy(/** @type {number} */ dx, /** @type {number} */ dz, slide = true, rolling = false) {
    // Long steps (a roll, a slow frame) go in pieces under half a cell, so no cell is jumped.
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (G.cellM * 0.4)));
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const [sx, sz] = roundBodies(dx / n, dz / n);
      /** @type {[number, number][]} */
      const tries = !slide ? [[sx, sz]] : Math.abs(sx) >= Math.abs(sz) ? [[sx, sz], [sx, 0], [0, sz]] : [[sx, sz], [0, sz], [sx, 0]];
      const ok = tries.find(([a, b]) => (a || b) && canStep(s.x, s.z, s.x + a, s.z + b, rolling));
      if (!ok) break;
      s.x += ok[0]; s.z += ok[1];
      moved += Math.hypot(ok[0], ok[1]);
    }
    return moved;
  }

  /** Turn toward a facing by at most degPerS this frame. @param {number} face @param {number} dt @param {number} degPerS */
  function turnToward(face, dt, degPerS) {
    let turn = face - s.yaw;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    const most = (degPerS * Math.PI / 180) * dt;
    s.yaw += Math.max(-most, Math.min(most, turn));
  }

  /** The pace to steer at here: run, creep near a creature (unless running), slower when wading. @param {boolean} run */
  function steerPace(run) {
    const near = env.nearest ? env.nearest(s.x, s.z) : Infinity;
    let pace = run ? P.briskMps : feel.creep && near < P.creepNearM ? P.creepMps : P.strollMps;
    const here = env.grid.cellAt(s.x, s.z);
    if (here >= 0 && env.depth(here) > P.wadeAnkleM) pace = Math.min(pace, P.wadeMps);
    return pace * (env.paceK?.() ?? 1);
  }

  /** Steering and rolling, when there is no way to follow (keys, doc 23). @param {number} dt */
  function steerUpdate(dt) {
    s.rollWait = Math.max(0, s.rollWait - dt);
    const RL = ST.roll, rollMps = RL.distM / RL.durS;
    if (s.roll) {
      // The way is set when the roll starts: keys and the camera cannot turn it (Matt, October 26, 2026).
      const r = s.roll;
      const step = Math.min(dt, RL.durS - r.t);
      r.t += dt;
      const want = rollMps * step;
      const moved = moveBy(r.x * want, r.z * want, false, true);
      s.speed = moved / dt;
      s.yaw = Math.atan2(r.x, r.z);
      // Stopped short (deep water, a solid thing, a face too high), or done: up again, still going.
      const stopped = want > 1e-6 && moved < want * 0.5;
      if (stopped || r.t >= RL.durS - 1e-6) {
        s.roll = null;
        s.rollWait = RL.waitS;
        s.carry = stopped ? null : { x: r.x, z: r.z, t: 0 };
        if (stopped) { s.v = 0; s.speed = 0; }
      }
      return;
    }
    if (s.carry) {
      // Out of a roll: on along its way, easing from the roll's pace to the pace the keys ask for
      // (or to a stop) over carryS, before the keys steer again. Its momentum, kept.
      const c = s.carry;
      c.t += dt;
      const f = Math.min(1, c.t / RL.carryS), keys = Math.hypot(s.want.x, s.want.z) > 0.01;
      const exit = keys ? steerPace(s.want.run) : 0;
      s.v = rollMps + (exit - rollMps) * f;
      s.yaw = Math.atan2(c.x, c.z);
      s.speed = moveBy(c.x * s.v * dt, c.z * s.v * dt, true, true) / dt;
      if (f >= 1 || s.speed < 1e-3) s.carry = null;
      return;
    }
    const w = s.want, mag = Math.min(1, Math.hypot(w.x, w.z));
    let want = 0;
    if (mag > 0.01) {
      s.posture = 'stand';
      const face = Math.atan2(w.x, w.z);
      if (feel.eightWay) s.yaw = Math.round(face / (Math.PI / 4)) * (Math.PI / 4);
      else turnToward(face, dt, feel.turnDegPerS);
      // Slower while turning sharply, so a U-turn is a tight arc, never a spin in place at full pace.
      let err = face - s.yaw;
      err = Math.abs(Math.atan2(Math.sin(err), Math.cos(err)));
      want = steerPace(w.run) * mag * Math.max(feel.turnSlowFloor, Math.cos(err));
    }
    const pace = Math.max(P.strollMps, want);
    const dv = want - s.v;
    s.v += Math.sign(dv) * Math.min(Math.abs(dv), (dv > 0 ? pace / feel.accelS : Math.max(s.v, P.strollMps) / feel.stopS) * dt);
    if (s.v < 1e-3) { s.v = 0; s.speed = 0; return; }
    const step = s.v * dt;
    s.speed = moveBy(Math.sin(s.yaw) * step, Math.cos(s.yaw) * step) / dt;
  }

  /**
   * The cell the next step lands in: up to one cell along the way to the next point of the path
   * (the cell you stand in when there is no way ahead). @param {number} here
   */
  function aheadCell(here) {
    const next = s.path[0];
    if (!next) return here;
    const dx = next[0] - s.x, dz = next[1] - s.z, d = Math.hypot(dx, dz);
    if (d < 1e-6) return here;
    const a = Math.min(d, G.cellM) / d;
    return env.grid.cellAt(s.x + dx * a, s.z + dz * a);
  }

  /** Back to the nearest ground to stand on, by the shortest way there is. */
  function retreat() {
    s.posture = 'stand';
    const k = nearestOpen(env.grid, rules, s.x, s.z, 12);
    if (k < 0) { s.path = []; return; }
    const r = findPath(env.grid, rules, [s.x, s.z], env.grid.center(k));
    s.path = r.ok ? r.points : [env.grid.center(k)];
    s.brisk = false;
    s.retreating = true;
  }

  return {
    rules,
    /** Has the figure been put on the island yet? */
    get placed() { return s.placed; },
    get x() { return s.x; },
    get z() { return s.z; },
    /** Feet height (m). */
    get y() { return s.y; },
    /** Facing, radians about +y (body +z forward, as the creatures). */
    get yaw() { return s.yaw; },
    /** m/s, now. */
    get speed() { return s.speed; },
    /** Walking a way, steering, or rolling. */
    get moving() { return s.path.length > 0 || s.speed > 1e-3 || !!s.roll || !!s.carry; },
    /** Following a way (a click, the tide), not steered by keys. */
    get pathing() { return s.path.length > 0; },
    /** Falling (off an edge a roll went over): the feet over the ground. */
    get airborne() { return s.fallV > 0; },
    /** How far into a dodge roll (0..1), or -1 when not rolling. */
    get rolling() { return s.roll ? Math.min(1, s.roll.t / ST.roll.durS) : -1; },
    /** The feel in use: 'island' or 'hollow'. */
    get feel() { return feel === ST.profiles.hollow ? 'hollow' : 'island'; },
    /** Switch the feel (the walk lab tries the Hollow's today). @param {string} name */
    setFeel(name) { feel = ST.profiles[name] ?? feel; },
    /**
     * Steer this frame (keys, camera-relative, turned into the world by the caller): the way you want
     * to go (length up to 1; 0 lets you stop) and whether Shift runs. Ignored while wading back from
     * the tide. A way to follow (a click) wins until the caller stops it.
     * @param {number} x @param {number} z @param {boolean} [run]
     */
    steer(x, z, run = false) { s.want.x = x; s.want.z = z; s.want.run = run; },
    /**
     * Dodge roll (Space): about roll.distM along (x, z), or the way you face when that is 0. Not while
     * one is waiting, wading back, or after placing; stops a walk. Returns whether it started.
     * @param {number} x @param {number} z
     */
    roll(x, z) {
      if (!s.placed || s.roll || s.rollWait > 0 || s.retreating) return false;
      const l = Math.hypot(x, z);
      const [rx, rz] = l > 1e-3 ? [x / l, z / l] : [Math.sin(s.yaw), Math.cos(s.yaw)];
      s.path = []; s.brisk = false; s.posture = 'stand';
      s.roll = { x: rx, z: rz, t: 0 };
      s.carry = null;
      s.yaw = Math.atan2(rx, rz);
      return true;
    },
    get brisk() { return s.brisk; },
    get retreating() { return s.retreating; },
    /** Standing, kneeling or sitting. */
    get posture() { return s.posture; },
    /**
     * Kneel or sit where you are (stops a walk), or stand up again.
     * @param {'stand'|'kneel'|'sit'} p
     */
    setPosture(p) {
      if (p !== 'stand') { s.path = []; s.brisk = false; s.speed = 0; s.v = 0; s.roll = null; s.carry = null; }
      s.posture = p;
    },
    /** Turn to face a way where you are (kneeling to lift a log, L3a). @param {number} yaw */
    face(yaw) { s.yaw = yaw; },
    /** Where the walk is going (a copy), for drawing the way. */
    path: () => s.path.map((p) => /** @type {[number, number]} */ ([p[0], p[1]])),

    /**
     * Stand here, at the nearest spot you can stand on within reachM. False if there is none.
     * @param {number} x @param {number} z @param {number} [yaw] @param {number} [reachM]
     */
    place(x, z, yaw = s.yaw, reachM = 8) {
      const k = nearestOpen(env.grid, rules, x, z, reachM);
      if (k < 0) return false;
      const [cx, cz] = env.grid.cellAt(x, z) === k ? [x, z] : env.grid.center(k);
      Object.assign(s, { placed: true, x: cx, z: cz, y: env.ground(cx, cz), yaw, speed: 0, v: 0, roll: null, carry: null, fallV: 0, path: [], brisk: false, retreating: false, posture: 'stand' });
      return true;
    },

    /**
     * Walk to a spot. brisk: hurry (a double tap).
     * @param {number} x @param {number} z @param {boolean} [brisk]
     * @returns {import('./path.js').PathResult}
     */
    walkTo(x, z, brisk = false) {
      const r = findPath(env.grid, rules, [s.x, s.z], [x, z]);
      if (r.ok) {
        s.path = r.points;
        s.brisk = brisk;
        s.retreating = false;
        s.posture = 'stand';
        s.roll = null; s.carry = null; s.v = 0;
      }
      return r;
    },

    /** Stop where you are (a walk, a steer or a roll). */
    stop() { s.path = []; s.brisk = false; s.v = 0; s.speed = 0; s.roll = null; s.carry = null; },

    /** Pushed by (dx, dz) (a hit's shove in the Hollow), over the walk grid as a step is: never into rock. Returns metres moved. @param {number} dx @param {number} dz */
    shove(dx, dz) { return moveBy(dx, dz, true, false); },

    /** @param {number} dt seconds */
    update(dt) {
      if (!s.placed || dt <= 0) return;
      // Steered by keys, or rolling: no way to follow. The tide still sends you back to dry ground.
      if (!s.path.length) {
        const here = env.grid.cellAt(s.x, s.z);
        if (here >= 0 && env.depth(here) >= G.wadeM && !s.roll) retreat();
        else {
          steerUpdate(dt);
          settle(dt);
          return;
        }
      }
      // The water came up over where you stand, or over the next step: wade back to dry ground.
      if (!s.retreating) {
        const here = env.grid.cellAt(s.x, s.z);
        // The next step is up to a cell along the way you are walking. (It was a cell along each
        // axis apart, which on a diagonal leg over stones read the deep water beside the way and
        // turned you back where you stood: F10, stuck on pond stones.)
        const ahead = aheadCell(here);
        if (here >= 0 && env.depth(here) >= G.wadeM) retreat();
        else if (ahead >= 0 && ahead !== here && !isOpen(env.grid, rules, ahead)) {
          // The way ahead closed (the tide over it): find another to the same place, else wade back.
          const goal = s.path[s.path.length - 1];
          const r = goal ? findPath(env.grid, rules, [s.x, s.z], goal) : null;
          if (r && r.ok) s.path = r.points;
          else retreat();
        }
      }
      let want = 0;
      if (s.path.length) {
        const near = env.nearest ? env.nearest(s.x, s.z) : Infinity;
        want = s.brisk ? P.briskMps : near < P.creepNearM ? P.creepMps : P.strollMps;
        // Wading past the ankle is slower, hurrying or not.
        const here = env.grid.cellAt(s.x, s.z);
        if (here >= 0 && env.depth(here) > P.wadeAnkleM) want = Math.min(want, P.wadeMps);
        want *= env.paceK?.() ?? 1;
        // Slow down into the last stop, so arriving is gentle.
        const [gx, gz] = s.path[s.path.length - 1];
        const left = s.path.length === 1 ? Math.hypot(gx - s.x, gz - s.z) : Infinity;
        want = Math.min(want, Math.sqrt(2 * P.accelMps2 * Math.max(left, 0)) + 0.05);
      }
      // Easing up is gentle; slowing down for a creature is quick, so a creep is a creep at once.
      const dv = want - s.speed;
      s.speed += Math.sign(dv) * Math.min(Math.abs(dv), (dv > 0 ? P.accelMps2 : P.accelMps2 * 3) * dt);
      let step = s.speed * dt;
      while (step > 0 && s.path.length) {
        const [tx, tz] = s.path[0];
        const dx = tx - s.x, dz = tz - s.z, d = Math.hypot(dx, dz);
        if (d > 1e-6) {
          const face = Math.atan2(dx, dz);
          let turn = face - s.yaw;
          turn = Math.atan2(Math.sin(turn), Math.cos(turn));
          const most = (P.turnDegPerS * Math.PI / 180) * dt;
          s.yaw += Math.max(-most, Math.min(most, turn));
        }
        if (d <= step) {
          s.x = tx; s.z = tz; step -= d;
          s.path.shift();
        } else {
          s.x += (dx / d) * step; s.z += (dz / d) * step; step = 0;
        }
      }
      if (!s.path.length) {
        if (s.speed > 0 && want === 0) s.speed = 0;
        s.brisk = false;
        s.retreating = false;
      }
      settle(dt);
    },
  };
}

/** @typedef {ReturnType<typeof createWalker>} Walker */

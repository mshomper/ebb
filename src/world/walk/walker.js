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
 */

/**
 * @param {any} R recipes/world/walker.json
 * @param {WalkerEnv} env
 */
export function createWalker(R, env) {
  const G = R.grid, P = R.pace;
  /** @type {import('./path.js').WalkRules} */
  const rules = { depth: env.depth, wadeM: G.wadeM, wadeCost: G.wadeCost, maxStepM: G.maxStepM, snapM: G.snapM };
  const s = {
    placed: false, x: 0, z: 0, y: 0, yaw: 0, speed: 0,
    /** @type {[number, number][]} */ path: [],
    brisk: false,
    /** Wading back to dry ground on its own, as the tide comes in. */
    retreating: false,
    /** Standing, kneeling or sitting (W4); walking always stands you up. @type {'stand'|'kneel'|'sit'} */
    posture: /** @type {'stand'|'kneel'|'sit'} */ ('stand'),
  };

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
    get moving() { return s.path.length > 0; },
    get brisk() { return s.brisk; },
    get retreating() { return s.retreating; },
    /** Standing, kneeling or sitting. */
    get posture() { return s.posture; },
    /**
     * Kneel or sit where you are (stops a walk), or stand up again.
     * @param {'stand'|'kneel'|'sit'} p
     */
    setPosture(p) {
      if (p !== 'stand') { s.path = []; s.brisk = false; s.speed = 0; }
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
      Object.assign(s, { placed: true, x: cx, z: cz, y: env.ground(cx, cz), yaw, speed: 0, path: [], brisk: false, retreating: false, posture: 'stand' });
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
      }
      return r;
    },

    /** Stop where you are. */
    stop() { s.path = []; s.brisk = false; },

    /** @param {number} dt seconds */
    update(dt) {
      if (!s.placed || dt <= 0) return;
      // The water came up over where you stand, or over the next step: wade back to dry ground.
      if (!s.retreating) {
        const here = env.grid.cellAt(s.x, s.z);
        const next = s.path[0];
        const ahead = next ? env.grid.cellAt(s.x + Math.sign(next[0] - s.x) * Math.min(Math.abs(next[0] - s.x), G.cellM),
          s.z + Math.sign(next[1] - s.z) * Math.min(Math.abs(next[1] - s.z), G.cellM)) : here;
        if ((here >= 0 && env.depth(here) >= G.wadeM) || (ahead >= 0 && ahead !== here && !isOpen(env.grid, rules, ahead))) retreat();
      }
      let want = 0;
      if (s.path.length) {
        const near = env.nearest ? env.nearest(s.x, s.z) : Infinity;
        want = s.brisk ? P.briskMps : near < P.creepNearM ? P.creepMps : P.strollMps;
        // Wading past the ankle is slower, hurrying or not.
        const here = env.grid.cellAt(s.x, s.z);
        if (here >= 0 && env.depth(here) > P.wadeAnkleM) want = Math.min(want, P.wadeMps);
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
      s.y = env.ground(s.x, s.z);
    },
  };
}

/** @typedef {ReturnType<typeof createWalker>} Walker */

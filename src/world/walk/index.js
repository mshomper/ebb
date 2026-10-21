// @ts-check
// The walker in the game (doc 23, presence below; W2): two views. Above is the diorama where you
// shape; Go down lands you on foot where you are looking, and the camera glides down behind you.
// Below, a tap walks you there (a double tap hurries), a drag looks around and the shaping tools
// are put away; Go up glides back up over where you stand, and your figure stays there, seen
// from above. The walk grid follows every stroke, and the water is read live: the sea at the
// tide now, the ponds from the live water, so the sandbar opens and closes with the tide. W2 is
// the feel test: the figure is a plain stand-in, and presence below (W3) comes next.
// Writes the store slice `walk` { below, placed }. Numbers and words: recipes/world/walker.json.

import { on, emitDeferred } from '../../core/events.js';
import { update as updateStore } from '../../core/store.js';
import { createWalkGrid } from './grid.js';
import { createWalker } from './walker.js';
import { isOpen } from './path.js';
import { mainland, nearestJoined } from './reach.js';
import { crossingNote, depthAtLow, hoursToLow } from './crossing.js';
import { bakeBody } from '../creatures/body-bake.js';
import { createCreaturePass } from '../../render/passes/creatures.js';
import { level as tideLevel, tideParams } from '../tide.js';

/**
 * @param {{ recipe: any, terrain: import('../terrain/index.js').Terrain, water: any, camera: import('../../render/camera.js').OrbitCamera,
 *   tide: any, hours: () => number, creatures: () => { x: number, z: number }[] }} o
 *   recipe: recipes/world/walker.json; tide: recipes/world/water.json tide; hours: display time in game hours;
 *   creatures: where the animals near you are (the walk eases to a creep within pace.creepNearM)
 */
export function createWalk(o) {
  const R = o.recipe, { terrain, water, camera } = o;
  const ground = (/** @type {number} */ x, /** @type {number} */ z) => terrain.sampleHeight(x, z);
  const b = terrain.openBounds();
  let grid = createWalkGrid({ ground, minX: b.openMin[0], minZ: b.openMin[1], maxX: b.openMax[0], maxZ: b.openMax[1],
    cellM: R.grid.cellM, maxSlopeDeg: R.grid.maxSlopeDeg });
  const tideP = tideParams(o.tide);
  /** Water over a cell right now: the live water where it runs, and the sea at the tide now everywhere. */
  const depth = (/** @type {number} */ k) => {
    const [x, z] = grid.center(k);
    return Math.max(0, water.tide - grid.height[k], water.sim.live ? water.sampleLive(x, z).depth : 0);
  };
  const nearest = (/** @type {number} */ x, /** @type {number} */ z) => {
    let best = Infinity;
    for (const c of o.creatures()) best = Math.min(best, Math.hypot(c.x - x, c.z - z));
    return best;
  };
  const walker = createWalker(R, { get grid() { return grid; }, depth, ground, nearest });

  // The stand-in figure, drawn with the creatures' pass.
  const mesh = bakeBody(R.body, R.body.cellM);
  const pass = createCreaturePass({ recipe: { body: R.body }, mesh, name: 'walker' });

  let below = false;
  /** The last tap, for a double tap. @type {{ t: number, x: number, y: number, to: [number, number] } | null} */
  let lastTap = null;
  const publish = () => updateStore('walk', () => ({ below, placed: walker.placed }));
  publish();

  /** @param {string} text */
  const say = (text) => emitDeferred('island:notice', { text, showS: R.words.noticeS });
  /** Where the view aims at you: about chest height over your feet. */
  const head = () => [walker.x, walker.y + R.camera.lookHeightM, walker.z];

  /** The walk rules with the water as it will be at the next low water. */
  const lowRules = () => {
    const hours = o.hours();
    const low = tideLevel(hours + hoursToLow(hours, o.tide), tideP);
    return { ...walker.rules, depth: depthAtLow(depth, (k) => grid.height[k], water.tide, low) };
  };
  /** Stand on a mainland cell; below, the view glides after you (a move the game makes). @param {number} k */
  function moveTo(k) {
    const [x, z] = grid.center(k);
    walker.place(x, z, walker.yaw, R.grid.snapM);
    if (below) camera.setGround(R.camera, head());
    emitDeferred('walk:moved-out', { x, z });
  }
  /**
   * Never trapped: after a stroke, a figure whose spot no longer joins the mainland, even at low
   * water (walled in by terraces, or left on a new cliff face), steps out to the nearest that does.
   */
  function keepFree() {
    if (!walker.placed) return;
    const land = mainland(grid, lowRules());
    if (land.joined(grid.cellAt(walker.x, walker.z))) return;
    const k = nearestJoined(grid, land, walker.x, walker.z, (c) => isOpen(grid, walker.rules, c));
    const any = k >= 0 ? k : nearestJoined(grid, land, walker.x, walker.z);
    if (any >= 0) moveTo(any);
  }

  // Every stroke (and undo) changes the ground: re-read that part of the grid, and make sure the
  // figure isn't walled in.
  const offStroke = on('terrain:stroke-ended', (/** @type {{ rect: { x0: number, z0: number, x1: number, z1: number } }} */ p) => {
    grid.refresh(p.rect.x0, p.rect.z0, p.rect.x1, p.rect.z1);
    keepFree();
  });

  /** Is the figure in view? (Go down then lands on it.) */
  function figureOnScreen() {
    if (!walker.placed) return false;
    const m = camera.viewProj, x = walker.x, y = walker.y + 0.9, z = walker.z;
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w <= 1e-4) return false;
    const cx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w, cy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    return Math.abs(cx) < 0.95 && Math.abs(cy) < 0.95;
  }

  return {
    id: 'walk',
    pass,
    walker,
    get below() { return below; },
    /** The walk grid now (tools). */
    get grid() { return grid; },

    /**
     * Go down: back to your figure when it is in view, else where you are looking. False (and a
     * line on the island) if there is nowhere to stand.
     */
    down() {
      if (below) return true;
      const t = camera.target, e = camera.eye;
      // You land facing the way you were looking.
      if (!figureOnScreen() && !walker.place(t[0], t[2], Math.atan2(t[0] - e[0], t[2] - e[2]), R.grid.snapM * 3)) {
        say(R.words.noGround);
        return false;
      }
      below = true;
      camera.setGround(R.camera, head());
      publish();
      emitDeferred('walk:went-down', { x: walker.x, z: walker.z });
      return true;
    },

    /**
     * I'm stuck: to the nearest spot that joins the mainland with the water as it is now (off the
     * islet at high tide too), or a line saying you can walk on from here.
     */
    stuck() {
      if (!below || !walker.placed) return;
      walker.stop();
      const land = mainland(grid, walker.rules);
      if (land.joined(grid.cellAt(walker.x, walker.z))) { say(R.words.stuckFine); return; }
      const k = nearestJoined(grid, land, walker.x, walker.z);
      if (k >= 0) moveTo(k);
      else say(R.words.noGround);
    },

    /** Go back up over where you stand; the figure stays. */
    up() {
      if (!below) return;
      below = false;
      walker.stop();
      camera.setGround(null, [walker.x, walker.y, walker.z]);
      publish();
      emitDeferred('walk:went-up', { x: walker.x, z: walker.z });
    },

    /**
     * A tap below: walk there (a second tap close by, soon after, hurries).
     * @param {number} sx @param {number} sy CSS pixels @param {number[] | null} point the ground the tap landed on
     */
    tap(sx, sy, point) {
      if (!below || !point) return;
      const now = performance.now();
      const double = !!lastTap && now - lastTap.t < R.pace.doubleTapMs && Math.hypot(sx - lastTap.x, sy - lastTap.y) < 40;
      const to = /** @type {[number, number]} */ (double && lastTap ? lastTap.to : [point[0], point[2]]);
      lastTap = { t: now, x: sx, y: sy, to };
      const r = walker.walkTo(to[0], to[1], double);
      if (r.ok) return;
      const hours = o.hours();
      const lowDepth = depthAtLow(depth, (k) => grid.height[k], water.tide, tideLevel(hours + hoursToLow(hours, o.tide), tideP));
      say(crossingNote(grid, walker.rules, [walker.x, walker.z], to, { reason: r.reason, lowDepth, hoursToLow: hoursToLow(hours, o.tide), words: R.words }));
    },

    /** Each frame, before the camera: walk, and keep the view on you. @param {number} realDt */
    update(realDt) {
      walker.update(realDt);
      if (below) camera.follow(head());
      pass.setBeings(walker.placed ? [{ x: walker.x, y: walker.y, z: walker.z, yaw: walker.yaw, size: R.body.displayScale ?? 1 }] : []);
    },

    dispose() { offStroke(); },
  };
}

/** @typedef {ReturnType<typeof createWalk>} Walk */

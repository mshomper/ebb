// @ts-check
// The walker in the game (doc 23, presence below; W2): two views. Above is the diorama where you
// shape; Go down lands you on foot where you are looking, and the camera glides down behind you.
// Below, a tap walks you there (a double tap hurries), a drag looks around and the shaping tools
// are put away; Go up glides back up over where you stand, and your figure stays there, seen
// from above. The walk grid follows every stroke, and the water is read live: the sea at the
// tide now, the ponds from the live water, so the sandbar opens and closes with the tide. W2 is
// the feel test: the figure is a plain stand-in, and presence below (W3) comes next. Stepping
// stones and Steps' slabs (o.footing) are ground too: you stand on their tops, and leave no prints.
// Writes the store slice `walk` { below, placed }. Numbers and words: recipes/world/walker.json.

import { on, emitDeferred } from '../../core/events.js';
import { update as updateStore } from '../../core/store.js';
import { createWalkGrid } from './grid.js';
import { createWalker } from './walker.js';
import { isOpen } from './path.js';
import { mainland, nearestJoined } from './reach.js';
import { crossingNote, depthAtLow, hoursToLow } from './crossing.js';
import { createFigurePass, createFigure, loadFigureModel } from '../figure/index.js';
import { createFootprints } from '../figure/footprints.js';
import { createFootprintsPass } from '../../render/passes/footprints.js';
import { level as tideLevel, tideParams } from '../tide.js';

/**
 * @param {{ recipe: any, figure: any, terrain: import('../terrain/index.js').Terrain, water: any, camera: import('../../render/camera.js').OrbitCamera,
 *   tide: any, hours: () => number, creatures: () => { x: number, z: number }[], footing?: (x: number, z: number) => number }} o
 *   recipe: recipes/world/walker.json; figure: recipes/world/figure.json (W5, the figure you are on foot);
 *   tide: recipes/world/water.json tide; hours: display time in game hours;
 *   creatures: where the animals near you are (the walk eases to a creep within pace.creepNearM);
 *   footing: the top of a stepping stone or Steps slab there (m), -Infinity where there is none
 */
export function createWalk(o) {
  const R = o.recipe, { terrain, water, camera } = o;
  /** The land alone (terrain), and the ground you stand on: the land, or a stone or slab over it. */
  const rawGround = (/** @type {number} */ x, /** @type {number} */ z) => terrain.sampleHeight(x, z);
  const ground = (/** @type {number} */ x, /** @type {number} */ z) => Math.max(rawGround(x, z), o.footing ? o.footing(x, z) : -Infinity);
  const b = terrain.openBounds();
  let grid = createWalkGrid({ ground: rawGround, footing: o.footing, minX: b.openMin[0], minZ: b.openMin[1], maxX: b.openMax[0], maxZ: b.openMax[1],
    cellM: R.grid.cellM, maxSlopeDeg: R.grid.maxSlopeDeg });
  const tideP = tideParams(o.tide);
  /**
   * Water over a cell right now: the live water where it runs, and the sea at the tide now
   * everywhere. The live water is a column over the land, so it is measured from its surface.
   */
  const depth = (/** @type {number} */ k) => {
    const [x, z] = grid.center(k);
    const live = water.sim.live ? rawGround(x, z) + water.sampleLive(x, z).depth - grid.height[k] : 0;
    return Math.max(0, water.tide - grid.height[k], live);
  };
  const nearest = (/** @type {number} */ x, /** @type {number} */ z) => {
    let best = Infinity;
    for (const c of o.creatures()) best = Math.min(best, Math.hypot(c.x - x, c.z - z));
    return best;
  };
  const walker = createWalker(R, { get grid() { return grid; }, depth, ground, nearest });

  // The figure (W5): its pass is ready at once; the model loads alongside and appears when it has.
  // Drawing only: it reads the walker and never changes it.
  const pass = createFigurePass(o.figure, 'walker');
  /** @type {import('../figure/index.js').Figure | null} */ let figure = null;
  loadFigureModel(o.figure)
    .then((glb) => { figure = createFigure({ recipe: o.figure, glb, pass }); })
    .catch((err) => console.error('The walker figure did not load:', err));
  /** Water over a world spot now (the cell it falls in). @param {number} x @param {number} z */
  const depthAt = (x, z) => { const k = grid.cellAt(x, z); return k >= 0 ? depth(k) : 0; };
  // Footprints (W6): each step on sand or mud leaves one, fading over a day, gone under the tide.
  const FP = o.figure.footprints;
  // Prints lie on the land, never on a stone or slab (there, read as deep water: no print).
  const prints = createFootprints(FP, { ground: rawGround, material: (x, z) => terrain.sampleMaterial(x, z),
    depth: (x, z) => (o.footing && o.footing(x, z) > rawGround(x, z) + 0.01 ? Infinity : depthAt(x, z)) });
  const printsPass = createFootprintsPass({ max: FP.max });
  /** The ground under a print's four corners, as footprints.wgsl lays the quad. @param {{ x: number, z: number, yaw: number }} p */
  const corners = (p) => {
    const [w, l] = FP.soleM, f = [Math.sin(p.yaw), Math.cos(p.yaw)], r = [f[1], -f[0]];
    const cx = p.x + f[0] * l * 0.28, cz = p.z + f[1] * l * 0.28;
    return [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) =>
      rawGround(cx + r[0] * a * w * 0.65 + f[0] * b * l * 0.6, cz + r[1] * a * w * 0.65 + f[1] * b * l * 0.6));
  };
  /** @type {WeakMap<object, number[]>} */ const printCorners = new WeakMap();
  // Grass underfoot (W6): the last few steps, with when they landed (seconds of walking time).
  const GR = o.figure.grass;
  /** @type {{ x: number, z: number, t: number }[]} */ let steps = [];
  let walkT = 0;
  /** When a reach (setting a net) stands you up again, in walkT seconds; 0 for none. */
  let standAt = 0;

  let below = false;
  /** Look (W4): while on, a tap names what it lands on instead of walking there. */
  let look = false;
  /** The last tap, for a double tap. @type {{ t: number, x: number, y: number, to: [number, number] } | null} */
  let lastTap = null;
  /** What the buttons last showed, so the store changes only when something does. */
  let shown = '';
  const publish = () => {
    const now = { below, placed: walker.placed, posture: walker.posture, look };
    const key = JSON.stringify(now);
    if (key !== shown) { shown = key; updateStore('walk', () => now); }
  };
  publish();

  /** @param {string} text */
  const say = (text) => emitDeferred('island:notice', { text, showS: R.words.noticeS });
  /** How far your body sits over your feet, by posture (doc 23: lower is gentler). */
  const H = R.presence.heightM;
  /** Where the view aims at you: about chest height over your feet, lower when you kneel or sit. */
  const head = () => [walker.x, walker.y + R.camera.lookHeightM - (H.stand - (H[walker.posture] ?? H.stand)), walker.z];

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
  // A stepping stone or slab put down, moved or taken away: the same, over the ground it covers.
  const offFooting = on('pieces:footing-changed', (/** @type {{ rect: { x0: number, z0: number, x1: number, z1: number } }} */ p) => {
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
    printsPass,
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
      figure?.motion.arrive();
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

    /**
     * Kneel or sit where you are (W4), or stand again if you already are. Sitting is the old seat:
     * low and still, so trust grows fastest there. @param {'kneel'|'sit'} p
     */
    posture(p) {
      if (!below || !walker.placed) return;
      standAt = 0;
      walker.setPosture(walker.posture === p ? 'stand' : p);
      camera.follow(head());
      publish();
    },

    /**
     * The ground point aheadM in front of you, or null while you are above.
     * @param {number} aheadM @returns {number[] | null}
     */
    aheadPoint(aheadM) {
      if (!below || !walker.placed) return null;
      const x = walker.x + Math.sin(walker.yaw) * aheadM, z = walker.z + Math.cos(walker.yaw) * aheadM;
      return [x, ground(x, z), z];
    },

    /** Kneel and reach down in front of you (setting a net), then stand again after standS seconds. @param {number} standS */
    reach(standS) {
      if (!below || !walker.placed) return;
      walker.setPosture('kneel');
      camera.follow(head());
      publish();
      figure?.motion.feed();
      standAt = walkT + standS;
    },

    /**
     * Kneel facing a spot beside you (Lift on a log's or stone's card, L3a), then stand again after
     * standS seconds. @param {number} x @param {number} z @param {number} standS
     */
    kneelToward(x, z, standS) {
      if (!below || !walker.placed) return;
      walker.stop();
      if (Math.hypot(x - walker.x, z - walker.z) > 1e-3) walker.face(Math.atan2(x - walker.x, z - walker.z));
      this.reach(standS);
    },

    /** Look on or off (W4). */
    toggleLook() {
      if (!below) return;
      look = !look;
      publish();
    },

    /**
     * Feed from the hand (W4): you kneel, and the food goes down just in front of you.
     * @returns {number[] | null} the ground point for the food
     */
    feedPoint() {
      if (!below || !walker.placed) return null;
      walker.setPosture('kneel');
      camera.follow(head());
      publish();
      figure?.motion.feed();
      const x = walker.x + Math.sin(walker.yaw) * R.ground.feedAheadM, z = walker.z + Math.cos(walker.yaw) * R.ground.feedAheadM;
      return [x, ground(x, z), z];
    },

    /**
     * You on foot, for presence (doc 23, W3): where you stand, how fast, your posture and where you
     * look (along the ground, the way the camera faces). Null while you are above.
     * @returns {import('../creatures/presence.js').WalkerNow | null}
     */
    presenceNow() {
      if (!below || !walker.placed) return null;
      const e = camera.eye, t = camera.target;
      const gx = t[0] - e[0], gz = t[2] - e[2], l = Math.hypot(gx, gz);
      return { x: walker.x, y: walker.y, z: walker.z, speed: walker.speed, posture: walker.posture, gaze: l > 1e-6 ? [gx / l, gz / l] : null };
    },

    /** Where you are felt on foot (finds, food, finding by watching), or null while you are above. */
    you() {
      return below && walker.placed ? [walker.x, walker.y + (H[walker.posture] ?? H.stand), walker.z] : null;
    },

    /**
     * Where your figure presses the grass now (W6): under the body, and where the last steps
     * landed, each easing off as the blades spring back. For the grass and rush passes.
     * @returns {{ x: number, z: number, r: number, k: number }[]}
     */
    pushes() {
      if (!walker.placed || !figure) return [];
      const body = { x: walker.x, z: walker.z, r: walker.posture === 'sit' ? GR.sitM : GR.bodyM, k: 0.9 };
      return [body, ...steps.map((s) => ({ x: s.x, z: s.z, r: GR.footM, k: Math.max(0, 1 - (walkT - s.t) / GR.springS) }))];
    },

    /**
     * Where your figure stands, for the save (kept with the view, doc 18): null if it has never
     * been put down. A save always opens above, so being below is not kept.
     * @returns {{ x: number, z: number, yaw: number, posture: 'stand' | 'kneel' | 'sit' } | null}
     */
    spot() {
      return walker.placed ? { x: walker.x, z: walker.z, yaw: walker.yaw, posture: walker.posture } : null;
    },

    /**
     * Put your figure back where the save left it (above, so it is seen from the diorama). Ignores a
     * spot that is no longer ground you can stand on nearby.
     * @param {any} s spot() from the save
     */
    restoreSpot(s) {
      if (!s || ![s.x, s.z, s.yaw].every(Number.isFinite)) return;
      if (!walker.place(s.x, s.z, s.yaw, R.grid.snapM)) return;
      if (s.posture === 'kneel' || s.posture === 'sit') walker.setPosture(s.posture);
      publish();
    },

    /** Go back up over where you stand; the figure stays. */
    up() {
      if (!below) return;
      below = false;
      look = false;
      walker.stop();
      camera.setGround(null, [walker.x, walker.y, walker.z]);
      publish();
      figure?.motion.leave();
      emitDeferred('walk:went-up', { x: walker.x, z: walker.z });
    },

    /**
     * A tap below: walk there (a second tap close by, soon after, hurries). With Look on, it names
     * what it lands on instead, if that is near enough to see well: returns 'look' for the app to
     * pass to the journal.
     * @param {number} sx @param {number} sy CSS pixels @param {number[] | null} point the ground the tap landed on
     * @returns {'look' | void}
     */
    tap(sx, sy, point) {
      if (!below || !point) return;
      if (look) {
        if (Math.hypot(point[0] - walker.x, point[2] - walker.z) <= R.ground.lookReachM) return 'look';
        say(R.words.lookFar);
        return;
      }
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
      publish();
      // The figure: posed from the walker (where, how fast, posture), the ground and water under
      // each foot, and where you look below. Each step that lands is a footfall (for footsteps by
      // ground, doc 17).
      walkT += realDt;
      if (standAt && walkT >= standAt) {
        standAt = 0;
        if (below && walker.posture === 'kneel') { walker.setPosture('stand'); camera.follow(head()); publish(); }
      }
      // Prints age with game time; the tide takes the ones it covers.
      const hours = o.hours();
      const live = prints.update(hours, water.tide);
      printsPass.setPrints(live.map((p) => ({ x: p.x, z: p.z, yaw: p.yaw, side: p.side, strength: prints.strength(p, hours), corners: printCorners.get(p) ?? [p.y, p.y, p.y, p.y] })), FP.soleM);
      if (!figure) return;
      const e = camera.eye, t = camera.target;
      const hour = ((hours % 24) + 24) % 24;
      const falls = figure.update(realDt, {
        placed: walker.placed, x: walker.x, z: walker.z, y: walker.y, yaw: walker.yaw, speed: walker.speed,
        moving: walker.moving, retreating: walker.retreating, ground, depth: depthAt,
        look: below ? { yaw: Math.atan2(t[0] - e[0], t[2] - e[2]) } : null,
        posture: walker.posture, below, sleepy: hour < 6 || hour > 21,
      });
      for (const f of falls) {
        const p = prints.step(f, hours);
        if (p) printCorners.set(p, corners(p));
        steps.push({ x: f.x, z: f.z, t: walkT });
        emitDeferred('walk:footfall', f);
      }
      if (steps.length > 3) steps = steps.slice(-3);
    },

    dispose() { offStroke(); offFooting(); },
  };
}

/** @typedef {ReturnType<typeof createWalk>} Walk */

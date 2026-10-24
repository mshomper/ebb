// @ts-check
// The walker in the game (doc 23, presence below; W2): two views. Above is the diorama where you
// shape; Go down lands you on foot where you are looking, and the camera glides down behind you.
// Below, a tap walks you there (a double tap hurries; a tap on a thing stops beside it, src/app.js
// opens its card on arrival), a drag looks around and the shaping tools
// are put away; Go up glides back up over where you stand, and your figure stays there, seen
// from above. The walk grid follows every stroke, and the water is read live: the sea at the
// tide now, the ponds from the live water, so the sandbar opens and closes with the tide. W2 is
// the feel test: the figure is a plain stand-in, and presence below (W3) comes next. Stepping
// stones and Steps' slabs (o.footing) are ground too: you stand on their tops, and leave no prints.
// The keeper's camp hooks (docs/future/13-keepers-camp.md 2.3): walk:arrived at the end of a walk,
// act(name) for the evening's acts (walk:act-done when one ends), placeAt and downHere for the
// director's own moves.
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
import { actLength } from '../figure/acts.js';
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
    .then((glb) => {
      figure = createFigure({ recipe: o.figure, glb, pass });
      // Already put down (a save, placeAt): appear in that posture, not easing into it.
      if (walker.placed) figure.motion.place(walker.posture);
    })
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
  // Where the figure looks (look.js): things near you worth a look, set by the game (setInterests),
  // and creatures arriving (their events), each looked at a little over the ground.
  const LK = o.figure.look.kinds;
  /** @type {() => { x: number, z: number, kind: string }[]} */ let interests = () => [];
  const lift = (/** @type {number} */ x, /** @type {number} */ z, /** @type {string} */ kind) => ground(x, z) + (LK[kind]?.liftM ?? 0);
  /** Look at a spot for a while (a thing clicked, an action's target). @param {number} x @param {number} z */
  const lookAt = (x, z) => figure?.motion.lookAt(x, lift(x, z, 'focus'), z);
  const onArrive = (/** @type {any} */ p) => { if (below && Number.isFinite(p?.x) && Number.isFinite(p?.z)) figure?.motion.notice(p.x, lift(p.x, p.z, 'arrival'), p.z); };
  const offArrivals = [on('creature:arrived', onArrive), on('creature:joined', onArrive)];
  // Grass underfoot (W6): the last few steps, with when they landed (seconds of walking time).
  const GR = o.figure.grass;
  /** @type {{ x: number, z: number, t: number }[]} */ let steps = [];
  let walkT = 0;
  /** When a reach (setting a net) stands you up again, in walkT seconds; 0 for none. */
  let standAt = 0;
  /** A keeper's camp act playing: its name, when it ends (walkT seconds) and the posture after. @type {{ name: string, endAt: number, after: 'stand'|'kneel'|'sit' } | null} */
  let acting = null;

  let below = false;
  /** The last tap, for a double tap. @type {{ t: number, x: number, y: number, to: [number, number] } | null} */
  let lastTap = null;
  /** What the buttons last showed, so the store changes only when something does. */
  let shown = '';
  const publish = () => {
    const now = { below, placed: walker.placed, posture: walker.posture };
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
      return this.downHere();
    },

    /**
     * Go down where your figure stands now, in view or not (the evening director: after placeAt on
     * a new island, or restoreSpot after a reload mid-evening). False if it was never put down.
     */
    downHere() {
      if (below) return true;
      if (!walker.placed) return false;
      below = true;
      camera.setGround(R.camera, head());
      publish();
      figure?.motion.arrive();
      emitDeferred('walk:went-down', { x: walker.x, z: walker.z });
      return true;
    },

    /**
     * Put your figure at a spot at once (the evening director: at the tent's flap, on the seat). A
     * move the game makes, never a startle: the walker's speed stays 0 (presence reads only that, not
     * the jump), below the view glides there (camera.setGround is a driven glide, so the camera's
     * speed reads 0 too), and the figure lands already in its posture, with no steps to get there.
     * The nearest spot you can stand on within grid.snapM. False if there is none.
     * @param {number} x @param {number} z @param {number} yaw @param {'stand'|'sit'|'kneel'} [posture]
     */
    placeAt(x, z, yaw, posture = 'stand') {
      if (!walker.place(x, z, yaw, R.grid.snapM)) return false;
      if (posture === 'kneel' || posture === 'sit') walker.setPosture(posture);
      standAt = 0;
      if (below) camera.setGround(R.camera, head());
      figure?.motion.place(walker.posture);
      publish();
      return true;
    },

    /**
     * Play a keeper's camp act on the figure: drink, pitch, lay, strike (the fire steel), crawlIn or
     * climbOut (recipes/world/figure.json poses). It stops any walk and takes the act's posture, and
     * `walk:act-done { name }` comes after the act's length, whether the model has loaded or not.
     * While it plays, taps that would walk (and Sit and Kneel) are ignored, and so is another act:
     * the walker never walks off mid-pose and every act reports its end. Tap again once it is done.
     * Unknown names are ignored. @param {string} name @returns {boolean} whether it plays
     */
    act(name) {
      const len = actLength(o.figure.poses, name);
      if (!len || acting || !walker.placed) return false;
      const P = o.figure.poses[name];
      walker.stop();
      standAt = 0;
      walker.setPosture(P.posture ?? 'stand');
      if (below) camera.follow(head());
      publish();
      figure?.motion.act(name);
      acting = { name, endAt: walkT + len, after: P.after ?? 'stand' };
      return true;
    },

    /**
     * What near you is worth a look (look.js kinds: creature, fire, find), from the game each frame.
     * @param {() => { x: number, z: number, kind: string }[]} fn
     */
    setInterests(fn) { interests = fn; },

    /** The act playing, or null. */
    get acting() { return acting ? acting.name : null; },
    /** Where one of your figure's hands is now (what it holds: the lantern, the fire steel), or null. @param {'l' | 'r'} side */
    hand: (side) => figure?.hand(side) ?? null,

    /**
     * I'm stuck: back to dry land that joins the mainland (where the camp is) with the water as it
     * is now. Standing on dry mainland already, a line says you can walk on from here. Out on pond
     * stones or wading, it walks you back to the nearest dry ground when there is a way, and when
     * there is none (a stone nobody could step back from, the islet at high tide) puts you there
     * (F10: it once looked only at whether your own cell joined the mainland).
     */
    stuck() {
      if (!below || !walker.placed) return;
      walker.stop();
      const land = mainland(grid, walker.rules);
      const here = grid.cellAt(walker.x, walker.z);
      /** Dry ground of the land itself: no stone or slab under you, no water over it. @param {number} k */
      const dry = (k) => {
        const [x, z] = grid.center(k);
        return depth(k) < 0.01 && !(o.footing && o.footing(x, z) > rawGround(x, z) + 0.01);
      };
      if (land.joined(here) && dry(here)) { say(R.words.stuckFine); return; }
      const k = nearestJoined(grid, land, walker.x, walker.z, (c) => dry(c) && isOpen(grid, walker.rules, c));
      const to = k >= 0 ? k : nearestJoined(grid, land, walker.x, walker.z);
      if (to < 0) { say(R.words.noGround); return; }
      const [x, z] = grid.center(to);
      if (land.joined(here) && walker.walkTo(x, z).ok) { publish(); return; }
      moveTo(to);
    },

    /**
     * Kneel or sit where you are (W4), or stand again if you already are. Sitting is the old seat:
     * low and still, so trust grows fastest there. @param {'kneel'|'sit'} p
     */
    posture(p) {
      if (!below || !walker.placed || acting) return;
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
      lookAt(x, z);
      this.reach(standS);
    },

    /** Turn to face a ground point where you stand (before a camp act: pitching, laying, striking). @param {number} x @param {number} z */
    faceToward(x, z) {
      if (!walker.placed || Math.hypot(x - walker.x, z - walker.z) < 1e-3) return;
      walker.stop();
      walker.face(Math.atan2(x - walker.x, z - walker.z));
      lookAt(x, z);
    },

    /** How far you stand from a ground point, in meters (Infinity while above). @param {number} x @param {number} z */
    distTo(x, z) {
      return below && walker.placed ? Math.hypot(x - walker.x, z - walker.z) : Infinity;
    },

    /** Still on the way somewhere (a walk or an approach not yet ended), or playing an act. */
    busy() {
      return below && (walker.moving || !!acting);
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
      walker.stop();
      camera.setGround(null, [walker.x, walker.y, walker.z]);
      publish();
      figure?.motion.leave();
      emitDeferred('walk:went-up', { x: walker.x, z: walker.z });
    },

    /**
     * A tap below: walk there (a second tap close by, soon after, hurries). With `reachM`, walk only
     * until you are that close to the point (a thing you clicked on: you stop beside it, not on it);
     * already that close, you stay where you are. Returns false when there is no way there.
     * @param {number} sx @param {number} sy CSS pixels @param {number[] | null} point the ground the tap landed on
     * @param {number} [reachM]
     */
    tap(sx, sy, point, reachM = 0) {
      if (!below || !point) return false;
      // An act playing keeps you where you are until it ends (act()).
      if (acting) return false;
      const now = performance.now();
      const double = !!lastTap && now - lastTap.t < R.pace.doubleTapMs && Math.hypot(sx - lastTap.x, sy - lastTap.y) < 40;
      let to = /** @type {[number, number]} */ (double && lastTap ? lastTap.to : [point[0], point[2]]);
      lastTap = { t: now, x: sx, y: sy, to };
      if (reachM > 0) {
        // A thing: you look at it as you go.
        lookAt(to[0], to[1]);
        // Stop short, on the line from the thing back toward you; already in reach, stay.
        const dx = walker.x - to[0], dz = walker.z - to[1], d = Math.hypot(dx, dz);
        if (d <= reachM) { walker.stop(); return true; }
        const k = (reachM * 0.8) / d;
        const near = /** @type {[number, number]} */ ([to[0] + dx * k, to[1] + dz * k]);
        if (walker.walkTo(near[0], near[1], double).ok) return true;
      }
      const r = walker.walkTo(to[0], to[1], double);
      if (r.ok) return true;
      const hours = o.hours();
      const lowDepth = depthAtLow(depth, (k) => grid.height[k], water.tide, tideLevel(hours + hoursToLow(hours, o.tide), tideP));
      say(crossingNote(grid, walker.rules, [walker.x, walker.z], to, { reason: r.reason, lowDepth, hoursToLow: hoursToLow(hours, o.tide), words: R.words }));
      return false;
    },

    /** Each frame, before the camera: walk, and keep the view on you. @param {number} realDt */
    update(realDt) {
      const wasMoving = walker.moving;
      walker.update(realDt);
      // The end of a walk (keeper's camp 2.3): the way ran out this frame, a tapped walk or a wade
      // back from the tide. A stop (Go up, I'm stuck, kneeling, an act, placeAt) clears the way
      // outside update(), so it never reads as arriving.
      if (wasMoving && !walker.moving) emitDeferred('walk:arrived', { x: walker.x, z: walker.z });
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
      if (acting && walkT >= acting.endAt) {
        const { name, after } = acting;
        acting = null;
        walker.setPosture(after);
        if (below) camera.follow(head());
        publish();
        emitDeferred('walk:act-done', { name });
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
        interests: below ? interests().filter((it) => Math.abs(it.x - walker.x) < 8 && Math.abs(it.z - walker.z) < 8).map((it) =>({ x: it.x, z: it.z, kind: it.kind, y: lift(it.x, it.z, it.kind) })) : [],
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

    dispose() { offStroke(); offFooting(); for (const off of offArrivals) off(); },
  };
}

/** @typedef {ReturnType<typeof createWalk>} Walk */

// @ts-check
// Fishing, live (docs/future/17). The line is a belt tool (made at the workbench, cook.json
// makes.line); on foot its button on the ground bar holds the worms you carry, and picking one puts
// the line in hand (store slice `hand`, kind 'line'; src/world/sowing draws its ring). A click on the
// sea walks you to the water's edge and you cast: the float flies out and settles, and after a
// short seeded wait it dips. Click the float, or Ease it in on the bar, while it is under, and the
// fish comes in, wriggling at the end of the line (a four-bone swim, fish-mesh.js), to the tray
// (store slice `catch`, src/ui/haul-tray.js). A missed dip only means waiting for the next; nothing
// is lost, and a worm is used only by a fish eased in. Walking off, Go up or the button again reels
// the line in. Which fish bites is pure (bite.js), from the world seed and the island's cast count.
//
// Keeps the saved store slice `fishing` (model.js) and `fishingUi` for the bar; the rod and float
// are drawn by its props pass, the hooked fish by its creature pass, the line and ripples by
// src/ui/fishing-overlay.js from visuals().

import { get, update } from '../../core/store.js';
import { emitDeferred, on } from '../../core/events.js';
import { dispatch } from '../../input/actions.js';
import { WATER_CLASS } from '../water/summary.js';
import { waterCellOf } from '../water/grid.js';
import { groundOfCell } from '../water/shore.js';
import { packMesh } from '../creatures/bodies.js';
import { createCreaturePass } from '../../render/passes/creatures.js';
import { createPropsPass } from '../../render/passes/props.js';
import { cleanFishing, castOnce, sketch, finer, glimpse } from './model.js';
import { classifyWater, sampleWater } from './waters.js';
import { biteOf, missWaitS } from './bite.js';
import { allFish } from './roster.js';
import { rodMesh, floatHalf } from './rod-mesh.js';
import { fishNumbers, fishMeshOf, fieldAsync, hasField } from '../nets/living/fish2.js';
import { fishSkin, swimBones } from '../nets/living/fish-mesh.js';
import { run } from '../../core/workers.js';

/** How long the float flies, s. */
const FLY_S = 0.75;
/** How long a ripple ring spreads, s. */
const RING_S = 1.6;

/**
 * @param {{ recipe: any, water: any, terrain: any, walk: any, pack: any, shore: () => any, worldSeed: number, seed: number,
 *   now: () => import('./bite.js').Now, nowH: () => number,
 *   passRecipe: any, propsRecipe: any, shadowBias?: any, test?: string | null }} o
 *   recipe: fishing.json; shore: the shore zones now (water/shore-live.js zones()); seed: subSeed(world seed, 'fishing');
 *   now: the conditions now for a bite; test: the ?fishing link's value (null without it)
 */
export function createFishing(o) {
  const FR = o.recipe, L = FR.line, W = FR.words;
  const fish = allFish(o.worldSeed, FR);
  const byId = new Map(fish.map((f) => [f.id, f]));
  update('fishing', (v) => cleanFishing(v));
  /** @returns {import('./model.js').FishingState} */
  const state = () => get('fishing');
  const testWaits = o.test !== null && o.test !== undefined;
  const rareBoost = o.test === 'rare' ? FR.test.rareOdds : 0;

  const props = createPropsPass({ name: 'fishing-props', recipe: o.propsRecipe, bias: o.shadowBias });
  props.addMesh('rod', rodMesh(L.rodM), [122, 104, 72], 0.8);
  props.addMesh('float-cap', floatHalf(L.floatR, true), [196, 58, 38], 0.6);
  props.addMesh('float-body', floatHalf(L.floatR, false), [232, 222, 196], 0.7);
  const pass = createCreaturePass({ recipe: o.passRecipe, maxBones: 4 });

  /**
   * @typedef {{ stage: 'walk' | 'fly' | 'wait' | 'dip' | 'ease', p: number[], S: number[], water: string, bait: string, t: number,
   *   at: number, dips: number, cast: number, bite: ReturnType<typeof biteOf>, n: any, mesh: boolean, from?: number[] }} Cast
   */
  /** @type {Cast | null} */ let cast = null;
  /** @type {{ x: number, y: number, z: number, t: number }[]} */ let rings = [];
  let clock = 0;
  // A fish glimpsed in a net (src/world/nets): kept, and its page pencilled (journal flag glimpse:<id>).
  const offGlimpse = on('fish:glimpsed', (/** @type {{ kind: string, hour: number }} */ p) => {
    if (!byId.has(p.kind)) return;
    update('fishing', (s) => glimpse(cleanFishing(s), p.kind, p.hour));
    dispatch(/** @type {any} */ ({ type: 'journal.flag', flag: `glimpse:${p.kind}` }));
  });
  const say = (/** @type {string} */ text, showS = 4) => { if (text) emitDeferred('island:notice', { text, showS }); };
  const sound = (/** @type {string} */ name, /** @type {number} */ seed) => emitDeferred('keepsake:sound', { name, seed });
  const hasLine = () => !!(o.test !== null && o.test !== undefined) || (get('cook')?.tools ?? []).includes('line');

  /** Is a point open sea, and how deep is it now? @param {number} x @param {number} z */
  function seaAt(x, z) {
    const s = o.water.getSummary?.();
    const ground = o.terrain.sampleHeight(x, z);
    const depth = Math.max(0, o.water.tide - ground);
    if (!s) return { sea: depth > 0, depth, band: false, ground };
    const i = waterCellOf(x) - s.rect.x, j = waterCellOf(z) - s.rect.y;
    if (i < 0 || j < 0 || i >= s.rect.w || j >= s.rect.h) return { sea: true, depth, band: false, ground };
    const k = j * s.rect.w + i, cls = s.cls[k];
    // Fresh water (a pond, a stream) is never the sea, even low in the tide band.
    const fresh = cls === WATER_CLASS.still || cls === WATER_CLASS.slow || cls === WATER_CLASS.running;
    return { sea: cls === WATER_CLASS.sea || (!!s.band[k] && !fresh && depth > 0), fresh, depth, band: !!s.band[k], ground };
  }

  /** The water a cast at a point lands in. @param {number} x @param {number} z */
  function waterAt(x, z) {
    const zones = o.shore();
    const material = get('terrainLive')?.mirror?.material;
    const read = {
      ground: (/** @type {number} */ px, /** @type {number} */ pz) => o.terrain.sampleHeight(px, pz),
      inBand: (/** @type {number} */ px, /** @type {number} */ pz) => seaAt(px, pz).band,
      zoneAt: (/** @type {number} */ px, /** @type {number} */ pz) => {
        if (!zones) return null;
        const i = waterCellOf(px) - zones.rect.x, j = waterCellOf(pz) - zones.rect.y;
        if (i < 0 || j < 0 || i >= zones.rect.w || j >= zones.rect.h) return null;
        const v = zones.zone[j * zones.rect.w + i];
        return v ? zones.ids[v - 1] : null;
      },
      rockAt: (/** @type {number} */ px, /** @type {number} */ pz) => {
        // Shore ground: within a meter or so of sea level, either side.
        const g = o.terrain.sampleHeight(px, pz);
        if (!material || g > 1.6 || g < -1.6) return null;
        return groundOfCell(material, waterCellOf(px), waterCellOf(pz)) === 2;
      },
    };
    return classifyWater(sampleWater(x, z, read, FR.waters), FR.waters);
  }

  /** How far you can cast from a stand point. @param {number[]} S [x, z] @param {boolean} here standing there now */
  function reachFrom(S, here) {
    const g = o.terrain.sampleHeight(S[0], S[1]);
    const foot = here ? o.walk.footY?.() ?? g : g;
    const high = foot - o.water.tide >= L.headlandM;
    const onStone = here && foot - g > 0.08 && g < o.water.tide;
    return high || onStone ? L.longCastM : L.castM;
  }

  /** Where you would stand to cast at a point: where you are if it is in reach, else the water's edge toward you. @param {number[]} p */
  function standFor(p) {
    const me = o.walk.spot();
    if (!me) return null;
    const meDepth = seaAt(me.x, me.z).depth;
    const dHere = Math.hypot(p[0] - me.x, p[2] - me.z);
    if (meDepth <= L.wadeM && dHere <= reachFrom([me.x, me.z], true)) return { S: [me.x, me.z], here: true };
    // March from the cast point toward you to the first ground the tide leaves (or ankle deep).
    const n = Math.max(1, Math.ceil(dHere / 0.5));
    for (let i = 1; i <= n; i++) {
      const t = i / n, x = p[0] + (me.x - p[0]) * t, z = p[2] + (me.z - p[2]) * t;
      if (seaAt(x, z).depth <= L.wadeM) {
        const back = Math.min(1, t + L.edgeM / Math.max(dHere, 1e-3));
        return { S: [p[0] + (me.x - p[0]) * back, p[2] + (me.z - p[2]) * back], here: false };
      }
    }
    return null;
  }

  /** Would a cast at a point take, with what the line carries? The ring's check. @param {number[]} p */
  function check(p) {
    const s = seaAt(p[0], p[2]);
    if (!s.sea) return { ok: false, message: s.fresh ? W.refused.fresh : W.refused.land };
    if (s.depth < L.minDepthM) return { ok: false, message: W.refused.shallow };
    const st = standFor(p);
    if (!st || Math.hypot(p[0] - st.S[0], p[2] - st.S[1]) > reachFrom(st.S, st.here)) return { ok: false, message: W.refused.far };
    return { ok: true, message: '' };
  }

  /** The bar's slice: whether the line is out, and what it is doing. */
  function publish() {
    const s = cast?.stage ?? null;
    const u = get('fishingUi');
    const baits = api.baitItems().map((b) => ({ id: b.id, label: b.label }));
    const next = { has: hasLine(), out: !!cast, stage: s, dip: s === 'dip', ease: W.ease, baits };
    if (!u || u.has !== next.has || u.out !== next.out || u.stage !== next.stage || JSON.stringify(u.baits) !== JSON.stringify(baits)) update('fishingUi', () => next);
  }

  /** Reel the line in: the cast ends, nothing is lost. @param {boolean} [quiet] */
  function reel(quiet = false) {
    if (!cast) return;
    if (!quiet && cast.stage !== 'walk') { say(W.reeledIn, 3); sound('fish-reel', cast.cast); }
    cast = null;
    pass.setBeings([]);
    publish();
  }

  /** The rod's butt (the right hand) and tip now, or null. */
  function rodNow() {
    const r = o.walk.hand?.('r');
    const me = o.walk.spot();
    if (!r || !me) return null;
    let dx = Math.sin(me.yaw), dz = Math.cos(me.yaw);
    if (cast && cast.stage !== 'walk') { const ax = cast.p[0] - r.x, az = cast.p[2] - r.z, l = Math.hypot(ax, az) || 1; dx = ax / l; dz = az / l; }
    // Raised back over the shoulder as the cast begins, then whipped forward and held out.
    let up = 0.62;
    if (cast?.stage === 'fly') { const k = cast.t / FLY_S; up = k < 0.3 ? 0.62 + 0.9 * (k / 0.3) : 1.52 - 1.0 * Math.min(1, (k - 0.3) / 0.4); }
    if (cast?.stage === 'ease') up = 0.95;
    if (!cast) up = 1.25;
    const c = Math.cos(up), s = Math.sin(up);
    const dir = [dx * c, s, dz * c];
    return { r, dir, tip: [r.x + dir[0] * L.rodM, r.y + dir[1] * L.rodM, r.z + dir[2] * L.rodM] };
  }

  /** Where the float is now. @param {Cast} c @param {number[]} tip */
  function floatAt(c, tip) {
    const surf = o.water.tide;
    if (c.stage === 'fly') {
      const k = Math.min(1, c.t / FLY_S), from = c.from ?? tip;
      return [from[0] + (c.p[0] - from[0]) * k, from[1] + (surf - from[1]) * k + Math.sin(Math.PI * k) * 1.2, from[2] + (c.p[2] - from[2]) * k];
    }
    if (c.stage === 'ease') {
      const k = Math.min(1, c.t / FR.bite.easeS), S = c.S;
      const ex = c.p[0] + (S[0] - c.p[0]) * k * 0.85, ez = c.p[2] + (S[1] - c.p[2]) * k * 0.85;
      return [ex, surf + 0.01 * Math.sin(c.t * 18), ez];
    }
    const bob = c.stage === 'dip' ? -0.03 - 0.012 * Math.sin(c.t * 9) : 0.006 * Math.sin(clock * 2.1);
    return [c.p[0], surf + bob, c.p[2]];
  }

  const api = {
    id: 'fishing',
    props, pass,

    /** The worms the line can carry now (the bar's Line menu), red first. */
    baitItems() {
      if (!hasLine()) return [];
      return ['worms', 'bigworms'].filter((k) => o.pack.has(k, 1)).map((k) => ({ kind: 'line', id: k, icon: k, label: W.baitItem[k] }));
    },
    hasLine,
    check,

    /**
     * Cast at a sea point with a worm (the line in hand, a click; src/world/sowing). Walks you to the
     * edge first when you are not in reach. Returns whether it started. @param {number} sx @param {number} sy
     * @param {number[]} p the ground point @param {string} bait worms or bigworms
     */
    cast(sx, sy, p, bait) {
      const c = check(p);
      if (!c.ok) return false;
      const st = /** @type {{ S: number[], here: boolean }} */ (standFor(p));
      reel(true);
      cast = { stage: 'walk', p: [p[0], o.water.tide, p[2]], S: st.S, water: waterAt(p[0], p[2]), bait, t: 0, at: 0, dips: 0, cast: state().casts, bite: null, n: null, mesh: false };
      if (!st.here) {
        if (!o.walk.tap(sx, sy, [st.S[0], o.terrain.sampleHeight(st.S[0], st.S[1]), st.S[1]], 0)) { cast = null; return false; }
        say(W.walk, 3);
      }
      publish();
      return true;
    },

    /** Ease the fish in while the float is under (a click on the float, or Ease it in). Returns whether it took. */
    ease() {
      if (!cast || cast.stage !== 'dip' || !cast.bite) return false;
      const f = byId.get(cast.bite.id);
      if (!f) return false;
      // The fish takes the worm.
      if (!o.test) o.pack.take(cast.bait, 1);
      cast.n = fishNumbers(f.id, f.ref, cast.bite.seed, FR);
      cast.stage = 'ease';
      cast.t = 0;
      sound('fish-flop', cast.n.seed);
      if (!hasField(cast.n)) fieldAsync(cast.n, FR, run).catch(() => {});
      publish();
      return true;
    },

    /** Is a ground point on the float (a click there eases the fish in)? @param {number} x @param {number} z */
    onFloat(x, z) { return !!cast && cast.stage !== 'walk' && Math.hypot(x - cast.p[0], z - cast.p[2]) < 0.9; },

    /** Reel the line in (the button again, Go up, a walk elsewhere). */
    reel,
    /** Is the line out? */
    out: () => !!cast,

    /** @param {import('../../sim/live-sim.js').FrameInfo} f */
    tick(f) {
      const dt = f.realDt;
      clock += dt;
      rings = rings.filter((g) => clock - g.t < RING_S);
      const me = o.walk.spot();
      if (cast && !me) reel(true);
      if (cast && me) {
        cast.t += dt;
        // Walked off (a click elsewhere, the keys): the line comes in.
        if (cast.stage !== 'walk' && Math.hypot(me.x - cast.S[0], me.z - cast.S[1]) > 1.2) reel();
      }
      if (cast) {
        const c = cast;
        if (c.stage === 'walk' && !o.walk.busy()) {
          if (Math.hypot((me?.x ?? 1e9) - c.S[0], (me?.z ?? 1e9) - c.S[1]) > 1.5) { reel(true); }
          else {
            if (me) c.S = [me.x, me.z];
            o.walk.faceToward(c.p[0], c.p[2]);
            o.walk.gesture('cast', { x: c.p[0], z: c.p[2] });
            c.stage = 'fly'; c.t = 0; c.from = rodNow()?.tip;
            update('fishing', (s) => castOnce(cleanFishing(s)));
            c.bite = biteOf({ seed: o.seed, cast: c.cast, water: c.water, now: o.now(), bait: c.bait, rareBoost }, fish, FR, testWaits);
            sound('fish-cast', c.cast);
            publish();
          }
        } else if (c.stage === 'fly' && c.t >= FLY_S) {
          c.stage = 'wait'; c.t = 0; c.at = c.bite?.waitS ?? 10;
          rings.push({ x: c.p[0], y: o.water.tide, z: c.p[2], t: clock });
          sound('fish-plip', c.cast);
          say(W.cast, 4);
          publish();
        } else if (c.stage === 'wait' && c.t >= c.at && c.bite) {
          c.stage = 'dip'; c.t = 0;
          rings.push({ x: c.p[0], y: o.water.tide, z: c.p[2], t: clock });
          sound('fish-dip', c.cast * 7 + c.dips);
          publish();
        } else if (c.stage === 'dip' && c.t >= FR.bite.dipS) {
          c.dips++;
          c.stage = 'wait'; c.t = 0; c.at = missWaitS(o.seed, c.cast, c.dips, FR);
          if (c.dips === 1) say(W.missed, 3);
          publish();
        } else if (c.stage === 'ease') {
          if (!c.mesh && hasField(c.n)) {
            const m = fishMeshOf(c.n, FR), sk = fishSkin(m, c.n.lengthM);
            pass.setMesh('hooked', { data: packMesh(m, sk.joints, sk.weights), indices: m.indices });
            c.mesh = true;
          }
          if (c.t >= FR.bite.easeS) { api.landed(c); return; }
        }
      }
      // The rod in hand while the line is out, the float on the water, the hooked fish under it.
      const rod = (cast || get('hand')?.kind === 'line') ? rodNow() : null;
      /** @type {any[]} */ const list = [];
      if (rod) {
        const pitch = Math.acos(Math.max(-1, Math.min(1, rod.dir[1]))), yaw = Math.atan2(rod.dir[0], rod.dir[2]);
        list.push({ key: 'rod', x: rod.r.x, y: rod.r.y, z: rod.r.z, yaw, pitch, scale: 1 });
        if (cast && cast.stage !== 'walk') {
          const fl = floatAt(cast, rod.tip);
          for (const key of ['float-cap', 'float-body']) list.push({ key, x: fl[0], y: fl[1], z: fl[2], yaw: 0, scale: 1 });
        }
      }
      props.setProps(list);
      if (cast?.stage === 'ease' && cast.mesh && rod) {
        const fl = floatAt(cast, rod.tip), yaw = Math.atan2(cast.S[0] - cast.p[0], cast.S[1] - cast.p[2]);
        pass.setBeings([{ x: fl[0], y: o.water.tide - 0.04, z: fl[2], yaw, size: 1, mesh: 'hooked', bones: swimBones(clock, cast.n.lengthM, 2) }]);
      } else pass.setBeings([]);
      if ((f.realDt && (clock % 0.5) < dt) || !cast) publish();
    },

    /**
     * The fish is in: onto the tray, with whether it is a first of its species (sketched now) or finer
     * than the one on its page. @param {Cast} c
     */
    landed(c) {
      const n = c.n, f = /** @type {import('./roster.js').RosterFish} */ (byId.get(n.kind));
      const had = state().sketched[f.id];
      const first = !had;
      const better = finer(had, n, FR.sketch.finerLength);
      if (first) {
        update('fishing', (s) => sketch(cleanFishing(s), f.id, { seed: n.seed, hour: o.nowH(), cm: Math.round(n.lengthM * 100), ...(n.morphId ? { morph: n.morphId } : {}) }));
        emitDeferred('fish:sketched', { id: f.id, page: f.page, kind: f.kind, water: f.water, first: true });
      }
      update('catch', () => ({ haul: { netId: 0, tideId: 0, living: [{ id: `line:${c.cast}`, n, first, finer: better }], keepsake: null, weed: n.seed }, hour: o.nowH(), water: c.water,
        released: [], kept: true, line: true, at: performance.now() }));
      sound('fish-flop', n.seed + 1);
      cast = null;
      pass.setBeings([]);
      publish();
    },

    /** Let the fish on the tray go. @param {string} itemId */
    release(itemId) {
      const h = get('catch');
      if (!h || h.released.includes(itemId)) return;
      update('catch', () => ({ ...h, released: [...h.released, itemId] }));
      sound('fish-release', h.haul.living[0]?.n.seed ?? 0);
    },

    /** Redraw the page from the fish on the tray (a redraw replaces the sketch). @param {string} itemId */
    redraw(itemId) {
      const h = get('catch');
      const c = h?.haul.living.find((/** @type {any} */ l) => l.id === itemId);
      if (!c || c.redrawn) return;
      const n = c.n, f = byId.get(n.kind);
      if (!f) return;
      update('fishing', (s) => sketch(cleanFishing(s), f.id, { seed: n.seed, hour: o.nowH(), cm: Math.round(n.lengthM * 100), ...(n.morphId ? { morph: n.morphId } : {}) }));
      emitDeferred('fish:sketched', { id: f.id, page: f.page, kind: f.kind, water: f.water, first: false });
      update('catch', () => ({ ...h, haul: { ...h.haul, living: h.haul.living.map((/** @type {any} */ l) => (l.id === itemId ? { ...l, redrawn: true } : l)) } }));
      say(W.redrawn, 3);
    },

    /** Close the tray: the fish goes back too. */
    closeTray() {
      const h = get('catch');
      if (!h) return;
      for (const c of h.haul.living) if (!h.released.includes(c.id)) api.release(c.id);
      update('catch', () => null);
    },

    /** What the overlay draws: the line from the rod's tip to the float, and the ripples. */
    visuals() {
      const rod = cast && cast.stage !== 'walk' ? rodNow() : null;
      if (!cast || !rod) return { line: null, rings: rings.map((g) => ({ ...g, k: (clock - g.t) / RING_S })) };
      const fl = floatAt(cast, rod.tip);
      // A sagging line: lower in the middle the slacker it is.
      const sag = cast.stage === 'ease' ? 0.05 : cast.stage === 'fly' ? 0.02 : 0.35;
      /** @type {number[][]} */ const pts = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        pts.push([rod.tip[0] + (fl[0] - rod.tip[0]) * t, rod.tip[1] + (fl[1] + 0.03 - rod.tip[1]) * t - sag * 4 * t * (1 - t), rod.tip[2] + (fl[2] - rod.tip[2]) * t]);
      }
      return { line: pts, rings: rings.map((g) => ({ ...g, k: (clock - g.t) / RING_S })) };
    },

    /** The island's species (the journal, the chart, tests). */
    fish: () => fish,
    byId: (/** @type {string} */ id) => byId.get(id) ?? null,

    dispose() { offGlimpse(); },
  };
  publish();
  // On the ?fishing link only, a handle for the console and tools.
  if (testWaits) {
    /** @type {any} */ (globalThis).ebbFishing = {
      ...api, now: () => cast, state, me: () => o.walk.spot(),
      /** The cast check and the water d meters ahead of you, for each d. @param {number[]} ds */
      probe(ds) {
        const me = o.walk.spot();
        if (!me) return null;
        return ds.map((d) => { const x = me.x + Math.sin(me.yaw) * d, z = me.z + Math.cos(me.yaw) * d; return { d, x, z, ...seaAt(x, z), check: check([x, 0, z]), water: waterAt(x, z) }; });
      },
      /**
       * Cast toward the nearest sea at least minDepth deep (walking to the edge as a click would);
       * want: a water to look for. @param {string} [bait] @param {string} [want] @param {number} [minDepth]
       */
      castToSea(bait = 'worms', want, minDepth = 0.6) {
        const me = o.walk.spot();
        if (!me) return null;
        let best = null;
        for (let r = 4; r <= 60 && !best; r += 2) for (let a = 0; a < 32; a++) {
          const x = me.x + Math.cos((a / 32) * Math.PI * 2) * r, z = me.z + Math.sin((a / 32) * Math.PI * 2) * r;
          const s = seaAt(x, z);
          if (!s.sea || s.depth < minDepth || !check([x, 0, z]).ok) continue;
          if (want && waterAt(x, z) !== want) continue;
          best = [x, 0, z]; break;
        }
        if (!best) return null;
        return api.cast(0, 0, best, bait) ? best : null;
      },
      /** Cast d meters ahead of you with a worm, as a click would. @param {number} d @param {string} [bait] */
      castAhead(d, bait = 'worms') {
        const me = o.walk.spot();
        if (!me) return false;
        return api.cast(0, 0, [me.x + Math.sin(me.yaw) * d, 0, me.z + Math.cos(me.yaw) * d], bait);
      },
    };
  }
  return api;
}

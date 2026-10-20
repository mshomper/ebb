// @ts-check
// Live side of creatures (S6a, S6b; docs 11, 23): the frogs the hourly tick keeps (coarse.js), alive.
// Each one is an agent (agents.js: resting, foraging, calling, swimming, arriving, leaving) drawn in
// one of its species' seeded body variants, baked in the background at a few levels of detail
// (bodies.js) and posed by its bones each frame (motion.js: hops by IK, the landing squash, the
// call, the kick; pose.js: breathing and blinking), with a tongue for its flicks. It makes the plop
// and rings when one comes at dusk (the journal's sign), says whether a tap landed on a frog, and
// notices when you watch one closely, which finds it for the journal (`creature:found`). A fast
// swoop or an edit right beside a frog startles it (presence.js; `creature:startled`); watching one
// quietly from close by earns it trust (watching.js), recorded in the world for the next hourly tick
// to apply (trust.js). Otherwise nothing here changes the world (the frogs live in the tick), except
// the `?frogs=N` test shortcut. The camera never moves.

import { on, emitDeferred } from '../../core/events.js';
import { get as getStore, update as updateStore } from '../../core/store.js';
import { hourIndex, display, animT, seasonOf, SECONDS_PER_HOUR, HOURS_PER_DAY } from '../../core/clock.js';
import { createReturn } from './reveal-return.js';
import { hash32 } from '../../core/rng.js';
import { run } from '../../core/workers.js';
import { createCreaturePass } from '../../render/passes/creatures.js';
import { MAX_BONES, bodyFor, packMesh } from './bodies.js';
import { bakeBody } from './body-bake.js';
import { poseSkeleton, moveMatrix, mul } from './pose.js';
import { frogMoves, legsOf } from './motion.js';
import { createFrogAgents } from './agents.js';
import { createPerches } from './perches.js';
import { bringFrogs } from './coarse.js';
import { createWatching } from './watching.js';
import { createFeeding } from './feeding.js';
import { addTrustEvent } from './trust.js';
import { findHide } from './day-hide.js';
import { FROG_BONES } from './rigs/frog.js';

const SEASON_IDS = ['spring', 'summer', 'autumn', 'winter'];
const BAKE_JOB ={ module: './world/creatures/bodies.js', fn: 'bakeVariant' };
/** The tongue mesh is baked this long (m) along +z from the mouth, then stretched to its reach. */
const TONGUE_M = 0.01;

/**
 * @param {{ world: { state: any, env: any }, recipe: any,
 *   terrain: { sampleHeight: (x: number, z: number) => number },
 *   water: { sim: { live: any }, sampleLive: (x: number, z: number) => { surface: number, depth: number } },
 *   ripples: { addImpulse: (x: number, z: number, strength?: number, radiusM?: number) => void } | null,
 *   camera: { target: ArrayLike<number>, eye: ArrayLike<number>, distance: number }, testFrogs?: number,
 *   flora?: Record<string, any>, floraFrame?: () => { time: number, wind: number, windDir: number } | null,
 *   presence?: import('./presence.js').Presence }} opts
 *   recipe: recipes/species/frog.json; testFrogs: `?frogs=N`, for click-testing only: once the island
 *   and the journal are up, N frogs come at once (coarse.js bringFrogs) instead of over days;
 *   flora: the flora recipes (lily pads, reed and iris clumps); floraFrame: the time and wind the
 *   flora pass drew this frame with, so frogs on lily pads move exactly with them; presence: the
 *   sources frogs react to (presence.js), updated by the app each frame
 */
export function createCreatures(opts) {
  const { world, recipe, terrain, water, ripples, camera } = opts;
  const perches = opts.flora?.lilies
    ? createPerches({ lily: opts.flora.lilies, P: { ...recipe.motion.pads, clumps: recipe.motion.clumps }, water: (x, z) => water.sampleLive(x, z) })
    : null;
  let testFrogs = opts.testFrogs ?? 0;
  const pass = createCreaturePass({ recipe, eyeBones: ['eye.l', 'eye.r'].map((n) => FROG_BONES.findIndex((b) => b.name === n)) });
  const body = recipe.body, M = recipe.motion;
  const variants = Math.max(1, body.variants ?? 1);
  const lods = recipe.bake.lods ?? [{ cellM: recipe.bake.cellM }];
  const find = recipe.find;
  const agents = createFrogAgents(recipe, world.env.seed >>> 0);
  const watching = createWatching(recipe.presence.watch);
  /** Each variant's skeleton and leg geometry, once its first bake is back. @type {({ skeleton: any[], legs: ReturnType<typeof legsOf> } | null)[]} */
  const rigs = Array.from({ length: variants }, () => null);
  /** Per frog: its variant, size and bone matrices (kept between frames). @type {Map<number, { variant: number, size: number, bones: Float32Array, tongue: Float32Array }>} */
  const own = new Map();
  /** @type {any} */ let shown = null;
  let watched = 0, testWait = 0;

  // Bake every variant in the background, coarsest first, so frogs can show within a moment and
  // gain detail as the finer bakes come back.
  for (let lod = lods.length - 1; lod >= 0; lod--) {
    for (let v = 0; v < variants; v++) {
      run(BAKE_JOB, { id: recipe.id, body, variant: v, cellM: lods[lod].cellM }, { lane: 'background' })
        .then((r) => {
          if (!rigs[v]) {
            const prims = bodyFor(recipe.id, body, v).prims;
            const tip = (/** @type {string} */ side) => prims.find((/** @type {any} */ q) => q.bone === `foot.${side}`).b;
            rigs[v] = { skeleton: r.bones, legs: legsOf(r.bones, { l: tip('l'), r: tip('r') }) };
          }
          pass.setMesh(`${v}:${lod}`, r);
        })
        .catch((err) => { if (err?.name !== 'Disposed') console.warn('creature bake failed', err); });
    }
  }
  // The tongue: a short pink capsule from the mouth, stretched out for a flick.
  {
    const T = M.tongue, m = T.mouth;
    const mesh = bakeBody({ prims: [{ type: 'capsule', bone: 'tongue', a: m, b: [m[0], m[1], m[2] + TONGUE_M], r: [T.radiusM, T.radiusM * 0.8], k: 0, region: 'tongue' }],
      albedo: { back: T.albedo, tongue: T.albedo }, blotch: { scale: 1, amount: 0 }, bellyBelowNormalY: -2 }, T.radiusM / 3);
    pass.setMesh('tongue', { data: packMesh(mesh), indices: mesh.indices });
  }
  // Food you offer (S6c-2): one small dark speck, drawn a few times where the food lies.
  if (recipe.feed) {
    const Fd = recipe.feed, r = Fd.speckM * 0.3;
    const mesh = bakeBody({ prims: [{ type: 'capsule', bone: 'tongue', a: [0, 0, -Fd.speckM / 2], b: [0, 0, Fd.speckM / 2], r: [r, r * 0.8], k: 0, region: 'tongue' }],
      albedo: { back: Fd.speckAlbedo, tongue: Fd.speckAlbedo }, blotch: { scale: 1, amount: 0 }, bellyBelowNormalY: -2 }, r / 2);
    pass.setMesh('speck', { data: packMesh(mesh), indices: mesh.indices });
  }

  /** The tick's frogs (none while they sleep in winter). */
  const tickFrogs = () => world.state?.creatures?.frogs?.frogs ?? [];

  /** Plops into the water, newest last, for the sound. @type {{ n: number, t: number, x: number, z: number }[]} */
  const plops = [];
  let plopCount = 0;
  /** For the sound (src/audio): where and when a frog went into the water. @param {number} x @param {number} z */
  const heardPlop = (x, z) => {
    plops.push({ n: plopCount++, t: agents.now(), x, z });
    if (plops.length > 40) plops.shift();
  };

  /** What the agents ask of the island. */
  const env = {
    ground: (/** @type {number} */ x, /** @type {number} */ z) => terrain.sampleHeight(x, z),
    water: (/** @type {number} */ x, /** @type {number} */ z) => water.sampleLive(x, z),
    plop(/** @type {number} */ x, /** @type {number} */ z) {
      ripples?.addImpulse(x, z, undefined, 0.1);
      heardPlop(x, z);
    },
    hourOfDay: 12,
    duskHour: 19,
    /** How often a calling frog calls this season (the voice recipe's seasons, doc 25): 1 in summer. */
    callRate: 1,
    /** Lily pads as perches, reed and iris clumps (perches.js), or null on a world with no lilies recipe. */
    pads: perches,
    /** Where a frog sits out the day, tucked into cover near home (day-hide.js), or null with none. */
    hide: (/** @type {{ x: number, z: number }} */ home, /** @type {number} */ id) =>
      findHide({ growth: world.state?.growth, flora: opts.flora ?? {}, water: env.water }, home, id, M.dayHide),
  };
  const feeding = recipe.feed ? createFeeding({ recipe, agents, ground: env.ground, water: env.water }) : null;

  /** Hour of the day (display time) and dusk, for the agents' moods. */
  function setHours() {
    const h = display() / SECONDS_PER_HOUR;
    env.hourOfDay = h - Math.floor(h / HOURS_PER_DAY) * HOURS_PER_DAY;
    env.duskHour = 12 + (world.state?.seasons?.dayLengthH ?? 12) / 2 + (recipe.ecology.arrival.duskOffsetH ?? 1);
    // Spring's chorus calls more, autumn's less (recipe voice.seasons[...].rate; winter's frogs sleep).
    const rates = recipe.voice?.seasons;
    if (rates) env.callRate = rates[SEASON_IDS[seasonOf(display()).index]]?.rate ?? 1;
  }

  /** A frog's own numbers. @param {number} id */
  function ownOf(id) {
    let o = own.get(id);
    if (!o) {
      const jitter = ((hash32(id, 0x51e) >>> 8) / 16777216) * 2 - 1;
      o = { variant: hash32(id, 0x7a) % variants, size: (body.displayScale ?? 1) * (1 + (body.sizeJitter ?? 0) * jitter),
        bones: new Float32Array(MAX_BONES * 16), tongue: new Float32Array(16) };
      own.set(id, o);
    }
    return o;
  }

  /**
   * The mesh a frog wears: its variant at the detail its distance from the eye asks for, else the
   * nearest detail of it that is baked, else any variant at that detail.
   * @param {number} v @param {number} dist
   */
  function meshFor(v, dist) {
    let want = lods.findIndex((/** @type {any} */ l) => l.toM === undefined || dist <= l.toM);
    if (want < 0) want = lods.length - 1;
    for (let step = 0; step < lods.length; step++) {
      for (const lod of [want + step, want - step]) if (lod >= 0 && lod < lods.length && pass.hasMesh(`${v}:${lod}`)) return `${v}:${lod}`;
    }
    for (let u = 0; u < variants; u++) if (pass.hasMesh(`${u}:${lods.length - 1}`)) return `${u}:${lods.length - 1}`;
    return undefined;
  }

  // The reveal on return (S7c): hidden while the plants grow in, then back with the rest of the
  // animals; the few the reveal picks plop (recipe `reveal`).
  const comeBack = createReturn(recipe.reveal?.growS ?? 0.3);

  /** Pose every frog for this frame and hand them to the pass. @param {number} t animation seconds */
  function draw(t) {
    const eye = camera.eye;
    /** @type {import('../../render/passes/creatures.js').Being[]} */ const beings = [];
    for (const a of agents.list()) {
      const back = comeBack.at(a.id, t);
      if (back.k <= 0) continue;
      const o = ownOf(a.id);
      const v = agents.view(a);
      if (back.effect && ripples) { ripples.addImpulse(v.x, v.z); ripples.addImpulse(v.x + 0.08, v.z - 0.05, undefined, 0.12); }
      // A frog on a lily pad is drawn where its pad is this very frame.
      const seat = a.perch && !a.hop ? perches?.seatOf(a.perch) : null;
      if (seat) { v.x = seat.x; v.y = seat.y; v.z = seat.z; v.yaw = seat.yaw; }
      const mesh = meshFor(o.variant, Math.hypot(v.x - eye[0], v.y - eye[1], v.z - eye[2]));
      if (!mesh) continue;
      const rig = rigs[o.variant] ?? rigs.find((r) => r) ?? null;
      if (rig) poseSkeleton(rig.skeleton, frogMoves(rig.skeleton, rig.legs, { id: a.id, hopT: v.hopT, kick: v.kick, sq: v.sq, sac: v.sac, swimming: v.swimming }, t, M), o.bones, 0);
      beings.push({ x: v.x, y: v.y, z: v.z, yaw: v.yaw, size: o.size * back.k, mesh, bones: rig ? o.bones : null });
      // A tongue flick: the tongue rides the head bone, stretched out of the mouth.
      if (v.tongue > 0 && rig) {
        const head = rig.skeleton.findIndex((/** @type {any} */ b) => b.name === 'head');
        const reach = (M.tongue.reachM * M.tongue.readability) / TONGUE_M;
        const stretch = moveMatrix(M.tongue.mouth, { s: [1, 1, Math.max(0.01, reach * v.tongue)] });
        mul(o.bones.subarray(head * 16, head * 16 + 16), stretch, o.tongue, 0);
        beings.push({ x: v.x, y: v.y, z: v.z, yaw: v.yaw, size: o.size * back.k, mesh: 'tongue', bones: o.tongue });
      }
    }
    if (feeding && pass.hasMesh('speck')) for (const s of feeding.specks()) beings.push({ ...s, size: 1, mesh: 'speck', bones: null });
    pass.setBeings(beings);
  }

  /** A frog comes at dusk: a plop and rings on the water just in front of it. @param {any} p */
  function plop(p) {
    if (p?.species !== 'frogs' || !ripples) return;
    const f = tickFrogs().find((/** @type {any} */ g) => g.id === p.id);
    const yaw = f?.yaw ?? 0;
    const x = p.x + Math.sin(yaw) * 0.5, z = p.z + Math.cos(yaw) * 0.5;
    ripples.addImpulse(x, z);
    ripples.addImpulse(x + 0.08, z - 0.05, undefined, 0.12);
    heardPlop(x, z);
  }

  const offs = [on('creature:arrived', plop), on('creature:joined', plop)];

  return {
    id: 'creatures',
    /** The creatures pass, for the frame graph. */
    pass,
    /** The frogs out now, where they are this moment: { id, x, z, yaw, mode, ... } (agents.js). */
    frogs: () => agents.list().filter((a) => a.mode !== 'leave'),
    /** The live frogs (the frog lab reads calls and stats from them). */
    agents,
    /** The lily pads as perches (the frog lab draws their outlines). */
    perches,
    /**
     * What the frogs did that can be heard, after frog time `since` (src/audio reads it a few dozen
     * times a second): each call where its frog sits now, with the frog's mood, and the recent plops.
     * Times are frog time (agents.now()); `now` is frog time at this moment.
     * @param {number} since
     */
    sounds(since) {
      /** @type {{ id: number, t: number, pos: number[], mood: number }[]} */ const calls = [];
      for (const c of agents.calls()) {
        if (c.t <= since) continue;
        const a = agents.list().find((g) => g.id === c.id);
        if (!a) continue;
        const v = agents.view(a);
        const seat = a.perch && !a.hop ? perches?.seatOf(a.perch) : null;
        calls.push({ id: c.id, t: c.t, pos: seat ? [seat.x, seat.y, seat.z] : [v.x, v.y, v.z], mood: a.mood ?? 0.7 });
      }
      // Plops are numbered (one can come before the frogs' clock starts, at an arrival): all the
      // recent ones, for the reader to take those numbered past the last it played.
      const heard = plops.map((p) => ({ n: p.n, t: p.t, pos: [p.x, env.water(p.x, p.z).surface, p.z] }));
      return { now: agents.now(), calls, plops: heard };
    },
    /** Pads frogs sit on, for the lily drawing to dip (flora pass, at most four). */
    pressedPads: () => (perches ? perches.pressed(agents.list()) : []),

    /** @type {import('./reveal-return.js').RevealHooks} the reveal on return (src/ui/reveal.js) */
    reveal: {
      species: 'frogs',
      style: recipe.reveal?.return ?? 'plop',
      spots: () => agents.list().filter((a) => a.mode !== 'leave').map((a) => { const v = agents.view(a); return { id: a.id, x: v.x, z: v.z }; }),
      hide: () => comeBack.hide(),
      back: (o) => comeBack.back(animT(), agents.list().map((a) => a.id), o.windowS, o.effects),
      end: () => comeBack.end(),
    },

    /**
     * The frog a tap on the ground at (x, z) lands on, or null: within tapM of it, more when the
     * camera is far (a far frog is small on screen).
     * @param {number} x @param {number} z
     */
    frogAt(x, z) {
      const r = find.tapM + find.tapPerM * camera.distance;
      let best = null, bestD = r * r;
      for (const a of agents.list()) {
        if (a.mode === 'leave') continue;
        const v = agents.view(a);
        const d = (v.x - x) * (v.x - x) + (v.z - z) * (v.z - z);
        if (d < bestD) { bestD = d; best = { x: v.x, z: v.z, id: a.id }; }
      }
      return best;
    },

    /**
     * The Feed tool tapped the ground at (x, z) (S6c-2): food lands there and a frog may come.
     * Returns the line the tool card shows.
     * @param {number} x @param {number} z
     */
    feed(x, z) {
      if (!feeding) return '';
      const key = feeding.offer(x, z, { known: !!getStore('journal')?.species?.frogs?.ever, dormant: !!world.state?.creatures?.frogs?.dormant, eye: camera.eye });
      return recipe.feed.messages[key] ?? '';
    },
    /** Soft rings where food lies, for the terrain marks: [x, z, radius, opacity]. */
    foodRings: () => (feeding ? feeding.rings() : []),

    /** @param {import('../../sim/live-sim.js').FrameInfo} f */
    tick(f) {
      // `?frogs=N`: bring the frogs now, once the island, its water and the journal are up (a tools
      // page has no journal: there it goes ahead after a few seconds).
      if (testFrogs && world.env.habitat?.() && water.sim.live) testWait += f.realDt;
      if (testFrogs && testWait > 0 && (getStore('journal') || testWait > 3)) {
        const r = bringFrogs(world.state, hourIndex(), world.env, testFrogs);
        testFrogs = 0;
        world.state = r.state;
        updateStore('world', () => world.state);
        for (const e of r.events) emitDeferred(e.name, e.payload);
        emitDeferred('world:ticked', { hour: hourIndex(), events: r.events, state: world.state });
      }
      if (!water.sim.live) return;   // the water's surface tells a frog where the bank ends
      setHours();
      const fl = opts.floraFrame?.();
      if (perches && fl) perches.update(fl, world.state?.growth?.plants ?? [], opts.flora ?? {});
      const F = world.state?.creatures?.frogs;
      if (F !== shown) { shown = F; agents.sync(F?.frogs ?? [], !!F?.dormant, env); }
      // Presence (doc 23): a fast swoop through a frog's ring, or an edit beside it, startles it.
      if (opts.presence) {
        const sources = opts.presence.sources();
        const r = agents.sense(sources, env);
        for (const id of r.startled) emitDeferred('creature:startled', { species: 'frogs', id });
        if (r.hushed.length) emitDeferred('creature:hushed', { species: 'frogs', ids: r.hushed });
        // Quiet watching close by earns trust (S6c): recorded now, applied by the next hourly tick.
        const watched = watching.step(agents.list(), sources, f.realDt);
        if (watched.length) {
          for (const w of watched) world.state = addTrustEvent(world.state, { kind: 'watched', id: w.id, minutes: w.minutes, hour: hourIndex() });
          updateStore('world', () => world.state);
        }
      }
      // Food you offered (S6c-2): frogs come for it; each meal is recorded for the next hour.
      if (feeding) {
        const ate = feeding.step(f.realDt, camera.eye, (id) => tickFrogs().find((/** @type {any} */ g) => g.id === id), hourIndex());
        if (ate.length) {
          for (const m of ate) world.state = addTrustEvent(world.state, { kind: 'fed', id: m.id, hour: hourIndex() });
          updateStore('world', () => world.state);
        }
      }
      agents.advance(f.realDt, env);
      draw(f.animT);
      // Watching one closely finds it: in the middle of the view, zoomed in, for a moment.
      if (getStore('journal')?.species?.frogs?.ever) return;
      const near = camera.distance <= find.lookDistM && agents.list().some((a) =>
        a.mode !== 'leave' && (a.x - camera.target[0]) ** 2 + (a.z - camera.target[2]) ** 2 <= find.lookM * find.lookM);
      watched = near ? watched + f.realDt : 0;
      if (watched >= find.holdS) {
        watched = 0;
        emitDeferred('creature:found', { species: 'frogs', how: 'watched' });
      }
    },

    dispose() { for (const off of offs) off(); },
  };
}

/** @typedef {ReturnType<typeof createCreatures>} Creatures */

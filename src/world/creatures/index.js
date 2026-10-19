// @ts-check
// Live side of creatures (S6a, S6b; docs 11, 23): draws each frog the hourly tick keeps (coarse.js)
// at its home on the bank, in one of its species' seeded body variants, baked in the background at
// a few levels of detail (bodies.js) and posed by its bones each frame (pose.js: breathing and
// blinking for now); makes the plop and rings when one comes at dusk (the journal's sign); says
// whether a tap landed on a frog; and notices when you watch one closely, which finds it for the
// journal (`creature:found`). Nothing here changes the world (the frogs live in the tick), except
// the `?frogs=N` test shortcut. The camera never moves.

import { on, emitDeferred } from '../../core/events.js';
import { get as getStore, update as updateStore } from '../../core/store.js';
import { hourIndex } from '../../core/clock.js';
import { hash32 } from '../../core/rng.js';
import { run } from '../../core/workers.js';
import { createCreaturePass } from '../../render/passes/creatures.js';
import { MAX_BONES } from './bodies.js';
import { idleMoves, poseSkeleton } from './pose.js';
import { bringFrogs } from './coarse.js';

const BAKE_JOB = { module: './world/creatures/bodies.js', fn: 'bakeVariant' };

/**
 * @param {{ world: { state: any, env: any }, recipe: any,
 *   terrain: { sampleHeight: (x: number, z: number) => number },
 *   water: { sim: { live: any }, sampleLive: (x: number, z: number) => { surface: number } },
 *   ripples: { addImpulse: (x: number, z: number, strength?: number, radiusM?: number) => void } | null,
 *   camera: { target: ArrayLike<number>, eye: ArrayLike<number>, distance: number }, testFrogs?: number }} opts
 *   recipe: recipes/species/frog.json; testFrogs: `?frogs=N`, for click-testing only: once the island
 *   and the journal are up, N frogs come at once (coarse.js bringFrogs) instead of over days
 */
export function createCreatures(opts) {
  const { world, recipe, terrain, water, ripples, camera } = opts;
  let testFrogs = opts.testFrogs ?? 0;
  const pass = createCreaturePass({ recipe });
  const body = recipe.body;
  const variants = Math.max(1, body.variants ?? 1);
  const lods = recipe.bake.lods ?? [{ cellM: recipe.bake.cellM }];
  const find = recipe.find;
  /** Each variant's skeleton, once its first bake is back. @type {({ name: string, parent: number, pivot: number[] }[] | null)[]} */
  const skeletons = Array.from({ length: variants }, () => null);
  /** @type {any} */ let shown = null;
  let hadWater = false, frame = 0, watched = 0;
  /** Each frog's spot and own numbers, kept between game hours. @type {{ f: any, y: number, size: number, variant: number, bones: Float32Array }[]} */
  let spots = [];

  // Bake every variant in the background, coarsest first, so frogs can show within a moment and
  // gain detail as the finer bakes come back.
  for (let lod = lods.length - 1; lod >= 0; lod--) {
    for (let v = 0; v < variants; v++) {
      run(BAKE_JOB, { id: recipe.id, body, variant: v, cellM: lods[lod].cellM }, { lane: 'background' })
        .then((r) => {
          skeletons[v] ??= r.bones;
          pass.setMesh(`${v}:${lod}`, r);
        })
        .catch((err) => { if (err?.name !== 'Disposed') console.warn('creature bake failed', err); });
    }
  }

  /** The frogs out now (none while they sleep in winter). */
  const frogs = () => {
    const F = world.state?.creatures?.frogs;
    return F && !F.dormant ? F.frogs : [];
  };

  /** Set each frog on the ground, or half in the water where the bank is awash. */
  function place() {
    const F = world.state?.creatures?.frogs;
    shown = F;
    hadWater = !!water.sim.live;
    spots = frogs().map((/** @type {any} */ f) => {
      const ground = terrain.sampleHeight(f.x, f.z);
      const surface = hadWater ? water.sampleLive(f.x, f.z).surface : -Infinity;
      const jitter = ((hash32(f.id, 0x51e) >>> 8) / 16777216) * 2 - 1;
      return { f, y: surface > ground + 0.01 ? surface - 0.016 : ground, size: (body.displayScale ?? 1) * (1 + (body.sizeJitter ?? 0) * jitter),
        variant: hash32(f.id, 0x7a) % variants, bones: new Float32Array(MAX_BONES * 16) };
    });
  }

  /**
   * The mesh a frog wears: its variant at the detail its distance from the eye asks for, else the
   * nearest detail of it that is baked, else any baked mesh.
   * @param {number} v @param {number} dist
   */
  function meshFor(v, dist) {
    let want = lods.findIndex((l) => l.toM === undefined || dist <= l.toM);
    if (want < 0) want = lods.length - 1;
    for (let step = 0; step < lods.length; step++) {
      for (const lod of [want + step, want - step]) if (lod >= 0 && lod < lods.length && pass.hasMesh(`${v}:${lod}`)) return `${v}:${lod}`;
    }
    return undefined;
  }

  /** Pose every frog for this frame and hand them to the pass. @param {number} t animation seconds */
  function draw(t) {
    const eye = camera.eye;
    pass.setBeings(spots.map((s) => {
      const sk = skeletons[s.variant];
      if (sk) poseSkeleton(sk, idleMoves(sk, t, s.f.id, recipe.motion), s.bones, 0);
      const dist = Math.hypot(s.f.x - eye[0], s.y - eye[1], s.f.z - eye[2]);
      return { x: s.f.x, y: s.y, z: s.f.z, yaw: s.f.yaw, size: s.size, mesh: meshFor(s.variant, dist), bones: sk ? s.bones : null };
    }));
  }

  /** A frog comes at dusk: a plop and rings on the water just in front of it. @param {any} p */
  function plop(p) {
    if (p?.species !== 'frogs' || !ripples) return;
    const f = frogs().find((/** @type {any} */ g) => g.id === p.id);
    const yaw = f?.yaw ?? 0;
    const x = p.x + Math.sin(yaw) * 0.5, z = p.z + Math.cos(yaw) * 0.5;
    ripples.addImpulse(x, z);
    ripples.addImpulse(x + 0.08, z - 0.05, undefined, 0.12);
  }

  const offs = [on('creature:arrived', plop), on('creature:joined', plop)];

  return {
    id: 'creatures',
    /** The creatures pass, for the frame graph. */
    pass,
    /** The frogs out now: { id, x, z, yaw, mood, ... } from the hourly tick. */
    frogs,

    /**
     * The frog a tap on the ground at (x, z) lands on, or null: within tapM of it, more when the
     * camera is far (a far frog is small on screen).
     * @param {number} x @param {number} z
     */
    frogAt(x, z) {
      const r = find.tapM + find.tapPerM * camera.distance;
      let best = null, bestD = r * r;
      for (const f of frogs()) {
        const d = (f.x - x) * (f.x - x) + (f.z - z) * (f.z - z);
        if (d < bestD) { bestD = d; best = f; }
      }
      return best;
    },

    /** @param {import('../../sim/live-sim.js').FrameInfo} f */
    tick(f) {
      frame++;
      // `?frogs=N`: bring the frogs now, once the island, its water and the journal are up.
      if (testFrogs && world.env.habitat?.() && water.sim.live && getStore('journal')) {
        const r = bringFrogs(world.state, hourIndex(), world.env, testFrogs);
        testFrogs = 0;
        world.state = r.state;
        updateStore('world', () => world.state);
        for (const e of r.events) emitDeferred(e.name, e.payload);
        emitDeferred('world:ticked', { hour: hourIndex(), events: r.events, state: world.state });
      }
      // The frogs change each game hour; the water's surface settles over the first seconds.
      if (world.state?.creatures?.frogs !== shown || (!hadWater && water.sim.live) || frame % 240 === 0) place();
      draw(f.animT);
      // Watching one closely finds it: in the middle of the view, zoomed in, for a moment.
      if (getStore('journal')?.species?.frogs?.ever) return;
      const near = camera.distance <= find.lookDistM && frogs().some((/** @type {any} */ g) =>
        (g.x - camera.target[0]) ** 2 + (g.z - camera.target[2]) ** 2 <= find.lookM * find.lookM);
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

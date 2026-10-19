// @ts-check
// Live side of creatures (S6a, docs 11, 23): draws each frog the hourly tick keeps (coarse.js) at
// its home on the bank, in the posed preview body until S6b animates it; makes the plop and rings
// when one comes at dusk (the journal's sign); says whether a tap landed on a frog; and notices when
// you watch one closely, which finds it for the journal (`creature:found`). Nothing here changes the
// world: the frogs live in the tick. The camera is never moved.

import { on, emitDeferred } from '../../core/events.js';
import { get as getStore } from '../../core/store.js';
import { createCreaturePass } from '../../render/passes/creatures.js';
import { bakeBody } from './body-bake.js';

/**
 * @param {{ world: { state: any, env: any }, recipe: any,
 *   terrain: { sampleHeight: (x: number, z: number) => number },
 *   water: { sim: { live: any }, sampleLive: (x: number, z: number) => { surface: number } },
 *   ripples: { addImpulse: (x: number, z: number, strength?: number, radiusM?: number) => void } | null,
 *   camera: { target: ArrayLike<number>, distance: number } }} opts
 *   recipe: recipes/species/frog.json
 */
export function createCreatures(opts) {
  const { world, recipe, terrain, water, ripples, camera } = opts;
  const mesh = bakeBody(recipe.body, recipe.bake.cellM);
  const pass = createCreaturePass({ mesh, recipe });
  const size = recipe.body.displayScale ?? 1;
  const find = recipe.find;
  /** @type {any} */ let shown = null;
  let hadWater = false, frame = 0, watched = 0;

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
    pass.setBeings(frogs().map((/** @type {any} */ f) => {
      const ground = terrain.sampleHeight(f.x, f.z);
      const surface = hadWater ? water.sampleLive(f.x, f.z).surface : -Infinity;
      return { x: f.x, y: surface > ground + 0.01 ? surface - 0.016 : ground, z: f.z, yaw: f.yaw, size };
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
      // The frogs change each game hour; the water's surface settles over the first seconds.
      if (world.state?.creatures?.frogs !== shown || (!hadWater && water.sim.live) || frame % 240 === 0) place();
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

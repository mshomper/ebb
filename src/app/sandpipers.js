// @ts-check
// The purple sandpipers (B3 wave 3): a winter flock on a Terrace sea wall you build in the splash
// zone. Their visits and the wall check are S0's (src/app/shaped.js); this records what each look
// found as the flock's home for the hourly tick (src/world/creatures/flock.js), shows a visit, and
// makes the live flock: the turnstones' code (src/world/turnstones) with the sandpipers' recipes and
// the wall's rock as the spots they feed over and roost on (src/world/sandpipers/wall.js). It joins
// the schools so taps, Show me and the reveal find it.
// Run in order from src/app/systems.js, after shaped.tests; reads and adds to the start-up context.

import * as clock from '../core/clock.js';
import { on, emitDeferred } from '../core/events.js';
import { get as getStore, update as updateStore } from '../core/store.js';
import { loadRecipe } from '../core/recipes.js';
import { homeOf } from '../world/ecology/shaped.js';
import { recordHome, bringFlock } from '../world/creatures/flock.js';
import { createTurnstones } from '../world/turnstones/index.js';
import { wallOf, wallSpots } from '../world/sandpipers/wall.js';

/** @param {import('./context.js').AppContext} ctx */
export async function start(ctx) {
  const { camera, params, presence, schools, seed, shapedAfterLook, sim, speciesRecipes, terrain, water, world } = ctx;
  const R = speciesRecipes['purple-sandpiper'];
  if (!R) return;
  const key = R.key, V = R.ecology.visit, W = R.life.wall;
  const bird = await loadRecipe(`birds/${R.body.birds}`);
  // Their voice (recipes/audio/purple-sandpiper.json): when they call; src/audio makes the calls in code.
  const sounds = await loadRecipe('audio/purple-sandpiper');

  /** The wall they live on, as the last look found it: its squares. @type {number[]} */
  let cells = [];
  /** The rock of their wall standing out of the water now (the flock life's spots). */
  const spots = () => {
    const hab = world.env.habitat?.();
    return hab && cells.length ? wallSpots(cells, hab.n, (x, z) => terrain.sampleHeight(x, z), water.tide, W) : [];
  };

  const sandpipers = createTurnstones({ recipe: R, bird, seed, world, camera, presence, ground: (x, z) => terrain.sampleHeight(x, z), tide: () => water.tide,
    hours: () => clock.display() / clock.SECONDS_PER_HOUR, wrack: spots, you: () => ctx.walk?.below ? ctx.walk.you() : null,
    record: () => updateStore('world', () => world.state), sounds });
  updateStore('creatureSound', (c) => ({ ...(c ?? {}), sandpipers: () => sandpipers.voiced() }));
  sim.addSystem(sandpipers);
  // With the schools, so the journal's taps and Show me, the reveal and the frame graph find it.
  schools.push(/** @type {any} */ (sandpipers));

  // Each look at the shaped ground: the wall home for the hourly tick (met, metres of wall, its middle).
  /** `?sandpipers` placed its flock: its home is the test's, not what the looks find. */
  let testing = false;
  shapedAfterLook.push((report) => {
    const w = wallOf(report, V.home);
    if (w) cells = w.cells;
    if (testing) return;
    const home = homeOf(report, V.home);
    const at = w ? { x: w.wall.x, z: w.wall.z } : world.state?.creatures?.[key]?.home ?? null;
    if (!at) return;
    const next = recordHome(world.state, key, { met: home.met, m: w?.wall.lengthM ?? 0, x: at.x, z: at.z });
    if (next !== world.state) { world.state = next; updateStore('world', () => world.state); }
  });
  on('visit:start', (/** @type {{ sp: string, show: any, x: number, z: number }} */ v) => sandpipers.visit(v));

  // `?sandpipers` (testing, unsaved): a flock of 6 (or `?sandpipers=N`) settles now on the nearest
  // wall (with `?shape=wall`, the one it builds), else on the shore ahead of the view, whatever the
  // season; `&trust=` starts them knowing you that well (0.2 Tolerant, 0.45 Curious, 0.5 their
  // group moment).
  if (params.has(key)) {
    const n = Math.max(1, Math.min(10, Number.parseInt(params.get(key) ?? '6', 10) || 6));
    const wantWall = (params.get('shape') ?? '').includes('wall');
    let wait = 0;
    sim.addSystem({ id: 'sandpipers-test', tick(/** @type {any} */ f) {
      if (wait < 0 || !world.env.habitat?.() || !water.sim.live || getStore('testGrow')?.done === false) return;
      wait += f.realDt;
      if (!getStore('journal') && wait < 3) return;
      // With `?shape=wall`, wait (up to 20 s) for the wall to be built and looked at.
      if (wantWall && !cells.length && wait < 20) return;
      const s = spots();
      const at = s.length ? s[Math.floor(s.length / 2)] : shoreNear(camera.target[0], camera.target[2]);
      if (!at) return;
      wait = -1;
      const r = bringFlock(world.state, clock.hourIndex(), world.env, R, n, at.x, at.z);
      // Seen in any season: the test keeps them here while they would be away north.
      world.state = { ...r.state, creatures: { ...r.state.creatures, [key]: { ...r.state.creatures[key], dormant: false } } };
      sandpipers.placeTest(at.x, at.z);
      testing = true;
      updateStore('world', () => world.state);
      for (const e of r.events) emitDeferred(e.name, e.payload);
      emitDeferred('world:ticked', { hour: clock.hourIndex(), events: r.events, state: world.state });
    } });
  }

  /** Dry ground just above the water near (x, z). @param {number} x @param {number} z */
  function shoreNear(x, z) {
    for (let r = 2; r < 60; r += 2) for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2, px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
      const g = terrain.sampleHeight(px, pz) - water.tide;
      if (g > 0.1 && g < 0.6) return { x: px, z: pz };
    }
    return null;
  }

  Object.assign(ctx, { sandpipers });
}

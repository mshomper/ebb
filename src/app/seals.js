// @ts-check
// The grey seals (B3 wave 3): a few that haul out on a quiet sandbar you raised, and a white pup in
// early autumn. Their visits and the ground they want are S0's (src/app/shaped.js); this records the
// best bar each look found as the group's home for the hourly tick (src/world/creatures/flock.js;
// the meadow islet's bar counts while you keep off it), shows a visit, and makes the live seals
// (src/world/seals), which join the schools so taps, Show me and the reveal find them.
// Run in order from src/app/systems.js, after shaped.tests; reads and adds to the start-up context.

import * as clock from '../core/clock.js';
import { on, emitDeferred } from '../core/events.js';
import { get as getStore, update as updateStore } from '../core/store.js';
import { loadRecipe } from '../core/recipes.js';
import { homeOf } from '../world/ecology/shaped.js';
import { recordHome, bringFlock } from '../world/creatures/flock.js';
import { createSeals } from '../world/seals/index.js';
import { bringPup } from '../world/seals/pup.js';

/** @param {import('./context.js').AppContext} ctx */
export async function start(ctx) {
  const { camera, params, presence, schools, seed, shapedAfterLook, sim, speciesRecipes, terrain, water, world } = ctx;
  const R = speciesRecipes.seal;
  if (!R) return;
  const key = R.key, V = R.ecology.visit;
  // Their voice (recipes/audio/seal.json): when they call; src/audio makes the sounds in code.
  const sounds = await loadRecipe('audio/seal');

  const seals = createSeals({ recipe: R, seed, world, camera, presence, ground: (x, z) => terrain.sampleHeight(x, z), tide: () => water.tide,
    hours: () => clock.display() / clock.SECONDS_PER_HOUR, you: () => ctx.walk?.below ? ctx.walk.you() : null,
    record: () => updateStore('world', () => world.state), sounds });
  updateStore('creatureSound', (c) => ({ ...(c ?? {}), seals: () => seals.voiced() }));
  sim.addSystem(seals);
  // With the schools, so the journal's taps and Show me, the reveal and the frame graph find it.
  schools.push(/** @type {any} */ (seals));

  // Each look at the shaped ground: the best bar as the home for the hourly tick (met, how big, where).
  /** `?seals` placed its group: its home is the test's, not what the looks find. */
  let testing = false;
  shapedAfterLook.push((report) => {
    if (testing) return;
    const home = homeOf(report, V.home);
    if (!home.best) return;
    const next = recordHome(world.state, key, { met: home.met, m: home.best.areaM2 ?? 0, x: home.best.x, z: home.best.z });
    if (next !== world.state) { world.state = next; updateStore('world', () => world.state); }
  });
  on('visit:start', (/** @type {{ sp: string, show: any, x: number, z: number }} */ v) => seals.visit(v));

  // `?seals` (testing, unsaved): four seals (or `?seals=N`) haul out now on the nearest dry shore
  // ahead of the view, whatever the season; `&trust=` starts them knowing you that well (0.2
  // Tolerant, 0.45 Curious, 0.5 their group moment); `&pup` brings the pup with them
  // (`&pup=16`: sixteen days old, moulting).
  if (params.has(key)) {
    const n = Math.max(1, Math.min(8, Number.parseInt(params.get(key) ?? '4', 10) || 4));
    let wait = 0;
    sim.addSystem({ id: 'seals-test', tick(/** @type {any} */ f) {
      if (wait < 0 || !world.env.habitat?.() || !water.sim.live || getStore('testGrow')?.done === false) return;
      wait += f.realDt;
      if (!getStore('journal') && wait < 3) return;
      const at = shoreNear(camera.target[0], camera.target[2]);
      if (!at) return;
      wait = -1;
      const r = bringFlock(world.state, clock.hourIndex(), world.env, R, n, at.x, at.z);
      let state = { ...r.state, creatures: { ...r.state.creatures, [key]: { ...r.state.creatures[key], dormant: false } } };
      if (params.has('pup')) state = bringPup(state, clock.hourIndex(), key, at.x, at.z, Number.parseFloat(params.get('pup') ?? '0') || 0);
      world.state = state;
      seals.placeTest(at.x, at.z);
      testing = true;
      updateStore('world', () => world.state);
      for (const e of r.events) emitDeferred(e.name, e.payload);
      emitDeferred('world:ticked', { hour: clock.hourIndex(), events: r.events, state: world.state });
    } });
  }

  /**
   * A shore spot near (x, z) for a test: dry sand a little above the water with room around it,
   * the nearest found in rings. @param {number} x @param {number} z
   */
  function shoreNear(x, z) {
    for (let r = 2; r < 80; r += 2) for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2, px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
      const g = terrain.sampleHeight(px, pz) - water.tide;
      if (g > 0.15 && g < 0.9 && terrain.sampleHeight(px + 2, pz) - water.tide > 0.08 && terrain.sampleHeight(px - 2, pz) - water.tide > 0.08) return { x: px, z: pz };
    }
    return null;
  }

  Object.assign(ctx, { seals });
}

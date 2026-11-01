// @ts-check
// The turnstones (B3 wave 2): a winter flock on the strandline wrack you leave lying. Their visits
// and the ground they want are S0's (src/app/shaped.js); this records what each look found as the
// flock's home for the hourly tick (src/world/creatures/flock.js), shows a visit, and makes the
// live flock (src/world/turnstones), which joins the schools so taps, Show me and the reveal find it.
// Run in order from src/app/systems.js, after shaped.tests; reads and adds to the start-up context.

import * as clock from '../core/clock.js';
import { on, emitDeferred } from '../core/events.js';
import { get as getStore, update as updateStore } from '../core/store.js';
import { loadRecipe } from '../core/recipes.js';
import { HABITAT_ORIGIN } from '../world/growth/habitat.js';
import { openBox } from '../world/ecology/fields.js';
import { homeOf } from '../world/ecology/shaped.js';
import { recordHome, bringFlock } from '../world/creatures/flock.js';
import { createTurnstones } from '../world/turnstones/index.js';
import { wrackMiddle } from '../world/turnstones/home.js';

/** @param {import('./context.js').AppContext} ctx */
export async function start(ctx) {
  const { camera, gather, params, presence, schools, seed, shapedAfterLook, sim, speciesRecipes, terrain, water, world } = ctx;
  const R = speciesRecipes.turnstone;
  if (!R) return;
  const key = R.key, V = R.ecology.visit;
  const bird = await loadRecipe(`birds/${R.body.birds}`);
  // Their voice (recipes/audio/turnstone.json): when they call; src/audio makes the calls in code.
  const sounds = await loadRecipe('audio/turnstone');

  /** The wrack lying on the strand now, nobody's gathered (the gather spots over the island's box). */
  function wrack() {
    const hab = world.env.habitat?.();
    if (!hab) return [];
    const b = openBox(hab);
    const cx = HABITAT_ORIGIN + (b.i0 + b.i1 + 1) / 2, cz = HABITAT_ORIGIN + (b.j0 + b.j1 + 1) / 2;
    const r = Math.sqrt((b.i1 - b.i0 + 1) ** 2 + (b.j1 - b.j0 + 1) ** 2) / 2;
    return gather.near(cx, cz, r).filter((s) => s.kind === 'wrack' && s.source === 'strand' && s.left > 0).map((s) => ({ x: s.x, z: s.z }));
  }

  const turnstones = createTurnstones({ recipe: R, bird, seed, world, camera, presence, ground: (x, z) => terrain.sampleHeight(x, z), tide: () => water.tide,
    hours: () => clock.display() / clock.SECONDS_PER_HOUR, wrack, you: () => ctx.walk?.below ? ctx.walk.you() : null,
    record: () => updateStore('world', () => world.state), sounds });
  updateStore('creatureSound', (c) => ({ ...(c ?? {}), turnstones: () => turnstones.voiced() }));
  sim.addSystem(turnstones);
  // With the schools, so the journal's taps and Show me, the reveal and the frame graph find it.
  schools.push(/** @type {any} */ (turnstones));

  // Each look at the shaped ground: the wrack home for the hourly tick (met, how much, where).
  /** `?turnstones` placed its flock: its home is the test's, not what the looks find. */
  let testing = false;
  shapedAfterLook.push((report) => {
    if (testing) return;
    const home = homeOf(report, V.home);
    const at = wrackMiddle(wrack(), R.life.spreadM * 3) ?? world.state?.creatures?.[key]?.home ?? null;
    if (!at) return;
    const next = recordHome(world.state, key, { met: home.met, m: report.wrack?.lyingM ?? 0, x: at.x, z: at.z });
    if (next !== world.state) { world.state = next; updateStore('world', () => world.state); }
  });
  on('visit:start', (/** @type {{ sp: string, show: any, x: number, z: number }} */ v) => turnstones.visit(v));

  // `?turnstones` (testing, unsaved): a flock of 8 (or `?turnstones=N`) settles now on the strand
  // ahead of the view, whatever the season; `&trust=` starts them knowing you that well (0.2
  // Tolerant, 0.45 Curious, 0.5 their group moment).
  if (params.has(key)) {
    const n = Math.max(1, Math.min(12, Number.parseInt(params.get(key) ?? '8', 10) || 8));
    let wait = 0;
    sim.addSystem({ id: 'turnstones-test', tick(/** @type {any} */ f) {
      // After a `?day=` island has finished growing (its catch-up replaces the world).
      if (wait < 0 || !world.env.habitat?.() || !water.sim.live || getStore('testGrow')?.done === false) return;
      wait += f.realDt;
      if (!getStore('journal') && wait < 3) return;
      const at = strandNear(camera.target[0], camera.target[2]);
      if (!at) return;
      wait = -1;
      const r = bringFlock(world.state, clock.hourIndex(), world.env, R, n, at.x, at.z);
      // Seen in any season: the test keeps them here while they would be away north.
      world.state = { ...r.state, creatures: { ...r.state.creatures, [key]: { ...r.state.creatures[key], dormant: false } } };
      turnstones.placeTest(at.x, at.z);
      testing = true;
      updateStore('world', () => world.state);
      for (const e of r.events) emitDeferred(e.name, e.payload);
      emitDeferred('world:ticked', { hour: clock.hourIndex(), events: r.events, state: world.state });
    } });
  }

  /** A strand spot near (x, z): the nearest wrack lying, else dry ground just above the water. @param {number} x @param {number} z */
  function strandNear(x, z) {
    const w = wrack().sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
    if (w) return w;
    for (let r = 2; r < 60; r += 2) for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2, px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
      const g = terrain.sampleHeight(px, pz) - water.tide;
      if (g > 0.1 && g < 0.6) return { x: px, z: pz };
    }
    return null;
  }

  Object.assign(ctx, { turnstones });
}

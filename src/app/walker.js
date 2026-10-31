// @ts-check
// The walker on foot, the shaper's trail offers, the boat at its mooring, the first evening and the
// morning hints.
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import * as clock from '../core/clock.js';
import { emitDeferred } from '../core/events.js';
import { get as getStore, update as updateStore, subscribe as subscribeStore } from '../core/store.js';
import { loadRecipe } from '../core/recipes.js';
import { subSeed } from '../core/rng.js';
import { firstsOf, trailLine } from '../world/trails.js';
import { TEST_PARAMS } from '../save/autosave.js';
import { createIntroBoot } from '../world/intro/boot.js';
import { createMorningHints } from '../world/hints/morning-live.js';
import { createBoat } from '../world/intro/boat.js';
import { createWalk } from '../world/walk/index.js';

/** @param {import('./context.js').AppContext} ctx */
export async function start(ctx) {
  const { back, camera, campRecipe, creatures, introRecipe, landRecipe, params, pieces, seed, shaperRecipe, sim, skyRecipe, terrain, walkerRecipe, water, waterRecipe } = ctx;
  // The walker (doc 23, presence below; W2): Go down puts you on foot where you are looking, and
  // the camera glides down behind you; a tap walks you there. Go up glides back over you.
  const figureRecipe = await loadRecipe('world/figure');
  const walk = createWalk({ recipe: walkerRecipe, figure: figureRecipe, terrain, water, camera, tide: waterRecipe.tide,
    hours: () => clock.display() / clock.SECONDS_PER_HOUR, creatures: () => creatures.frogs(),
    // Pond stones are footing: you step across on them (src/world/pieces/stepping.js).
    footing: (x, z) => pieces.footing(x, z) });
  // Pond stones and Steps are the shaper's trail's first and fourth stops (shaper.json, built):
  // offered once the trail reaches them, or with `?sandbox`, or `?pondstones` and `?steps`, for this visit.
  // Reaching one while you play shows a quiet gift card that opens the shaper's trail (a stop
  // reached before this visit, or in a catch-up the island already showed, makes none).
  /** @type {Set<string> | null} */ let shapeReached = null;
  const shapingOffers = () => {
    const u = getStore('unlocks') ?? {};
    const reached = new Set(trailLine(firstsOf(u.earned ?? {}, 'shape'), shaperRecipe.stops, [])
      .flatMap((e) => (e.type === 'station' ? [e.stop.id] : [])));
    for (const id of ['stones', 'steps', 'lantern']) {
      const stop = shaperRecipe.stops.find((/** @type {any} */ s) => s.id === id);
      if (shapeReached && !shapeReached.has(id) && reached.has(id) && stop?.gift) emitDeferred('progress:gifted', { ...stop.gift, icon: stop.icon, trail: 'shape' });
    }
    shapeReached = reached;
    const pondStones = reached.has('stones') || params.has('sandbox') || params.has('pondstones');
    const steps = reached.has('steps') || params.has('sandbox') || params.has('steps');
    // The lantern (B2 L1): the workbench makes one once the trail reaches its stop; `?lantern` too.
    const lantern = reached.has('lantern') || params.has('sandbox') || params.has('lantern');
    if (u.pondStones !== pondStones || u.steps !== steps || u.lantern !== lantern) updateStore('unlocks', (v) => ({ ...v, pondStones, steps, lantern }));
    // The reed raft is the turtles' gift (`unlocks.raft`, given by the spring creatures); `?sandbox`
    // or `?raft` open its Water mode early, for this visit.
    if (!u.raft && (params.has('sandbox') || params.has('raft'))) updateStore('unlocks', (v) => ({ ...v, raft: true }));
  };
  subscribeStore('unlocks', shapingOffers);
  shapingOffers();
  // Presence and `you` read the walker from here on (src/app/creatures.js).
  ctx.walk = walk;
  // Your figure stays where you left it (kept with the view; the save still opens above).
  walk.restoreSpot(back?.view?.walker);
  // The first evening (docs/future/13 section 2; src/world/intro): the boat at its mooring, a new
  // island's walker on the beach below the camp, and the director, started once the journal is up.
  const boatRecipe = await loadRecipe('world/boat');
  const boat = createBoat({ recipe: boatRecipe, ground: (/** @type {number} */ x, /** @type {number} */ z) => terrain.sampleHeight(x, z), water });
  sim.addSystem({ id: 'boat', tick: (/** @type {any} */ f) => boat.update(f.realDt, clock.animT()) });
  const intro = createIntroBoot({ R: introRecipe, boatR: boatRecipe, campRecipe, params, testParams: TEST_PARAMS, back, walk, terrain, water,
    land: landRecipe, terrainSeed: subSeed(seed, 'terrain'), orbit: skyRecipe.orbit, clock, camera, boat });
  sim.addSystem(intro);
  // Morning hints (src/world/hints): one line from the keeper each morning after the first evening.
  // Not on a test link (they open unsaved, so every visit would be a first morning), except `?nointro`.
  const morningHints = createMorningHints({ R: await loadRecipe('world/morning-hints'), clock, orbit: skyRecipe.orbit,
    journalWords: await loadRecipe('world/journal'), enabled: !TEST_PARAMS.some((k) => k !== 'nointro' && params.has(k)) });
  sim.addSystem(morningHints);
  Object.assign(ctx, { figureRecipe, boatRecipe, boat, intro });
}

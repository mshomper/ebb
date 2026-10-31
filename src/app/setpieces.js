// @ts-check
// Set pieces (docs/future/14): the runner, the cairn builder and the passing boat.
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import * as clock from '../core/clock.js';
import { get as getStore, update as updateStore } from '../core/store.js';
import { loadRecipe } from '../core/recipes.js';
import { trailEndFor } from '../world/dig/story.js';
import { createSetpiecesLive } from '../world/setpieces/live.js';
import { createCairnsLive } from '../world/setpieces/cairns-live.js';
import { createBoatLive } from '../world/setpieces/boat-live.js';

/** @param {import('./context.js').AppContext} ctx */
export async function start(ctx) {
  const { back, boat, boatRecipe, camera, dig, digRecipe, pack, params, pieces, seed, shadowPass, sim, terrain, walk, water, world } = ctx;
  // Set pieces (docs/future/14; src/world/setpieces): written events over game days, run in the
  // hourly tick from recipes/setpieces/<id>.json. The cairn builder and the passing boat live here;
  // `?setpiece=<id>&beat=N` (a test link, unsaved) starts one now at step N.
  const spWorld = await loadRecipe('world/setpieces');
  const spList = Object.fromEntries(await Promise.all(spWorld.order.map(async (/** @type {string} */ id) => [id, await loadRecipe(`setpieces/${id}`)])));
  const setpieces = createSetpiecesLive({ world, recipes: { world: spWorld, list: spList }, hourIndex: () => clock.hourIndex(),
    record: () => updateStore('world', () => world.state),
    test: params.has('setpiece') && !back ? { id: params.get('setpiece') ?? '', beat: Number.parseInt(params.get('beat') ?? '0', 10) || 0 } : null });
  sim.addSystem(setpieces);
  // The trail ends on the rise just above the spring's head, where the way down is (the spring-ore
  // plan, O2): a little short of it, so the last cairn stands just below the worn mark.
  const cairnsTrailEnd = () => {
    const sp = dig.story.spring(), pad = getStore('campPad');
    return sp ? trailEndFor(sp, pad ? { x: pad.x, z: pad.z } : sp, digRecipe.story.spring.trailBackM) : null;
  };
  const cairns = createCairnsLive({ R: spList.cairns, sp: setpieces, seed, pieces, pack, walk, terrain, camera, hourIndex: () => clock.hourIndex(), trailEnd: cairnsTrailEnd });
  sim.addSystem(cairns);
  const passingBoat = createBoatLive({ R: spList.boat, sp: setpieces, seed, pieces, pack, walk, terrain, water, boatRecipe, mooring: () => boat.mooring });
  sim.addSystem(passingBoat);
  // Its lantern joins the camp's lights (src/app/lights.js).
  ctx.passingBoat = passingBoat;
  shadowPass.addCaster(dig.props.caster);
  Object.assign(ctx, { setpieces, cairns });
}

// @ts-check
// Fishing (docs/future/17): the line, the bait and the five waters.
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import * as clock from '../core/clock.js';
import { loadRecipe } from '../core/recipes.js';
import { subSeed } from '../core/rng.js';
import { weatherAt } from '../world/weather.js';
import { state as tideState, tideParams } from '../world/tide.js';
import { createFishing } from '../world/fishing/index.js';

/** @param {import('./context.js').AppContext} ctx */
export async function start(ctx) {
  const { camera, campRecipe, findsRecipe, pack, params, seasonsRecipe, seed, shadowPass, sim, terrain, walk, water, waterRecipe, world, ww } = ctx;
  // Fishing (docs/future/17; src/world/fishing): the line made at the workbench, worms from the dig
  // for bait, a cast into one of five waters, every fish sketched and let go. `?fishing` (testing,
  // unsaved) gives the line, both worms and short waits; `?fishing=rare` makes every rare fish
  // bite often in its water; `?fishing=chart:N` sketches N of the island's fish for the chart.
  const fishingRecipe = await loadRecipe('world/fishing');
  const fishingTest = params.has('fishing') ? params.get('fishing') ?? '' : null;
  const fishing = createFishing({ recipe: fishingRecipe, water, terrain, walk, pack, shore: () => ww.shore.zones(), worldSeed: seed, seed: subSeed(seed, 'fishing'),
    nowH: () => clock.worldT() / clock.SECONDS_PER_HOUR,
    now: () => {
      const t = clock.worldT(), w = weatherAt(world.state?.weather, t, seasonsRecipe), y = world.state?.weather?.yesterday;
      const ts = tideState(t / clock.SECONDS_PER_HOUR, tideParams(waterRecipe.tide));
      return { hourOfDay: (t / clock.SECONDS_PER_HOUR) % 24, season: ['spring', 'summer', 'autumn', 'winter'][clock.seasonOf(t).index], rain: w.rain ?? 0, mist: w.mist ?? 0,
        cloud: w.cloud ?? 0, wind: w.wind ?? 0, yRain: y?.rainAmount ?? 0, yWind: y?.windStrength ?? 0, tideLevel: ts.level, tideAmp: ts.amp, sign: null };
    },
    passRecipe: findsRecipe, propsRecipe: campRecipe.props, shadowBias: shadowPass.bias, test: fishingTest, camera });
  sim.addSystem(fishing);
  Object.assign(ctx, { fishingRecipe, fishingTest, fishing });
}

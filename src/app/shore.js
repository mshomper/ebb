// @ts-check
// The shore: finds, keepsakes and bottle letters, beach glints, the nets and the placed pieces.
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import * as clock from '../core/clock.js';
import { get as getStore } from '../core/store.js';
import { loadRecipe } from '../core/recipes.js';
import { subSeed } from '../core/rng.js';
import { createFinds } from '../world/finds/index.js';
import { createKeepsakes } from '../world/keepsakes/index.js';
import { keepsakeGlints, findGlints } from '../world/glints.js';
import { createGlintsPass } from '../render/passes/glints.js';
import { keepsakeWords } from '../world/keepsakes/families/index.js';
import { createNets } from '../world/nets/index.js';
import { createPieces } from '../world/pieces/index.js';
import { history } from '../input/actions.js';

/** @param {import('./context.js').AppContext} ctx */
export async function start(ctx) {
  const { camera, groundDetail, params, seasonsRecipe, seed, sim, terrain, terrainPass, terrainRecipe, water, waterRecipe, world, ww, you } = ctx;
  // Finds (docs/future/11): anemones in rock pools, periwinkles on the wrack, lugworm casts on the
  // sand, where the shore zones say, near the view; a tap finds them for the journal.
  // `?shells=rare` or `?shells=<id>` (testing, unsaved): the strandline is thick with those shells,
  // whatever the tide, so a rare one can be seen and its page checked.
  const findsRecipe = await loadRecipe('species/finds');
  const shellTest = params.get('shells');
  if (shellTest && findsRecipe.kinds.shells) {
    const S = findsRecipe.kinds.shells;
    const keep = S.items.filter((/** @type {any} */ it) => (shellTest === 'rare' ? it.springMin !== undefined : it.id === shellTest));
    if (keep.length) findsRecipe.kinds.shells = { ...S, density: 0.3, items: keep.map((/** @type {any} */ it) => ({ ...it, springMin: undefined })) };
  }
  // Shells wash up once the naturalist's notes give them (world/expansion.js); `?shells` shows them anyway.
  const finds = createFinds({ water, shore: ww.shore, terrain, camera, recipe: findsRecipe, seed: subSeed(seed, 'finds'), tide: waterRecipe.tide,
    shellsOn: () => !!shellTest || !!getStore('unlocks')?.shells,
    // Winter storm tides read the weather of the day each high water came (world/finds/strand.js).
    weather: () => ({ weatherSeed: world.env.weatherSeed, weather: seasonsRecipe.weather, state: world.state?.weather }), you });
  sim.addSystem(finds);
  terrainPass.setCasts(finds.casts(), finds.castShape);
  // Keepsakes (docs/future/12): one-of-a-kind trinkets each high tide leaves on its strandline, a
  // few for the whole island. They come with the shells (the naturalist's reward at three finds);
  // `?keepsakes` (testing, unsaved) shows them at once, several to a tide.
  const keepsakesRecipe = await loadRecipe('world/keepsakes');
  const keepsakeTest = params.has('keepsakes');
  // Sheltered coves catch more of them (the cove field, src/world/water/cove.js).
  const coveRecipe = await loadRecipe('world/cove');
  // The shaper's trail notices the kinds of place you make (src/world/shaper.js, wired below).
  const shaperRecipe = await loadRecipe('world/shaper');
  const keepsakes = createKeepsakes({ water, shore: ww.shore, terrain, camera, recipe: keepsakesRecipe, passRecipe: findsRecipe,
    seed: subSeed(seed, 'keepsakes'), tide: waterRecipe.tide, test: keepsakeTest, coveRecipe,
    on: () => keepsakeTest || !!getStore('unlocks')?.shells });
  const keepsakesApi = { ...keepsakes, words: (/** @type {any} */ n) => keepsakeWords(n, keepsakesRecipe) };
  // Bottle letters (recipes/world/bottle-messages.json): which letter a bottle on the beach turned
  // out to hold, once read, so reading it again (or keeping it) gives the same one.
  const bottleMessages = await loadRecipe('world/bottle-messages');
  /** @type {Map<string, string>} */ const shoreLetters = new Map();
  sim.addSystem(keepsakes);
  // Beach glints (src/world/glints.js): the keepsakes, bottles most, and a few finds now and then
  // catch the light, so the eye finds them among the stones and wrack; ground pickups never do.
  // `?glints=steady` (testing): every glint flashes, one slow two-second pulse after another.
  const glintsRecipe = params.get('glints') === 'steady' ? { ...(await loadRecipe('world/glints')), everyS: [2, 2], flashS: 2, chance: 1 } : await loadRecipe('world/glints');
  const glints = createGlintsPass({ recipe: glintsRecipe, time: () => clock.animT() });
  sim.addSystem({ id: 'glints', tick() {
    glints.set([...keepsakeGlints(keepsakes.lying(), glintsRecipe), ...findGlints(finds.shown(), (x, z) => terrain.sampleHeight(x, z), glintsRecipe)]);
  } });
  // The nets (docs/future/12, K6; src/world/nets): cast with the Water tool's Net mode once the
  // beachcomber's trail gives the general net; `?nets` (testing, unsaved) gives it at once, and a
  // net cast there is ready to lift straight away.
  const netsRecipe = await loadRecipe('world/nets');
  const nets = createNets({ water, terrain, camera, seed: subSeed(seed, 'nets'), recipe: netsRecipe, keepsakes: keepsakesRecipe,
    passRecipe: findsRecipe, tide: waterRecipe.tide, nowH: () => clock.worldT() / clock.SECONDS_PER_HOUR, test: params.has('nets') });
  sim.addSystem(nets);
  // Placed pieces (doc 09, docs/future/10): loose stones, set with Sculpt's Loose stone mode and
  // lifted with a tap; a handful comes by itself with the naturalist's reward (src/world/pieces).
  // Driftwood washes up on the strandline after high tides (the reward at ten finds), and the
  // turtles' gift carries a stone or a log to where you tap next.
  const pieces = createPieces({ terrain, water, camera, history, seed, recipe: await loadRecipe('world/pieces'), ground: groundDetail, terrainRecipe,
    shore: ww.shore, tide: waterRecipe.tide });
  sim.addSystem(pieces);
  Object.assign(ctx, { findsRecipe, finds, keepsakesRecipe, coveRecipe, shaperRecipe, keepsakes, keepsakesApi, bottleMessages, shoreLetters, glints, netsRecipe, nets, pieces });
}

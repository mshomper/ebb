// @ts-check
// The keeper's camp (docs/future/13 section 3): what lies on the ground, the camp itself and its small
// lights (src/app/lights.js), then the solids, glances, gestures and the stores once the hen's props are in.
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import * as clock from '../core/clock.js';
import { on } from '../core/events.js';
import { loadRecipe } from '../core/recipes.js';
import { scrubHome } from '../world/hen/life.js';
import { createSolidsLive } from '../world/walk/solids-live.js';
import { createWhere } from '../world/camp/where.js';
import { createStores } from '../world/pack/stores.js';
import { createCamp } from '../world/camp/index.js';
import { createPackDraw } from '../world/pack/draw.js';
import { LIGHTS } from './lights.js';

/** @param {import('./context.js').AppContext} ctx */
export async function start(ctx) {
  const { camera, campRecipe, gather, intro, keepsakesRecipe, lighting, pack, piles, seasonsRecipe, seed, shadowPass, sim, skyRecipe, sowingRecipe, speciesRecipes, terrain, tier, treats, walk, water, world } = ctx;
  // What lies on the ground to gather, the piles at camp and the heaps you left (src/world/pack/draw.js).
  const packDraw = createPackDraw({ terrain, camera, recipe: pack.recipe, gather, pack, treats, water: (x, z) => water.sampleLive(x, z), you: () => walk.you() });
  sim.addSystem(packDraw);
  /** How far a ground spot's pickups lie from its middle, for what its card lifts (F5). @param {string} kind */
  const spreadOf = (kind) => pack.recipe.pickups?.kinds?.[kind]?.spreadM ?? 0.4;
  // The keeper's camp (docs/future/13 section 3; src/world/camp): the tent and the fire ring in their
  // slots, the fire and the lantern as small lights, smoke and moths, and a night's rest in the tent.
  const camp = createCamp({ recipe: campRecipe, seed, walk, terrain, water, clock, orbit: skyRecipe.orbit, camera, world, piles,
    // The camp sets the small lights each frame; the other systems' lights join them (src/app/lights.js).
    seasons: seasonsRecipe, lighting: { setPoints: (/** @type {any[]} */ l) => lighting.setPoints([...l, ...LIGHTS.flatMap((f) => f(ctx))]) }, pack, shadowBias: shadowPass.bias, low: tier === 'low', tier, poses: (await loadRecipe('world/figure')).poses,
    beat: () => intro.live?.intro.current?.id ?? null, cook: await loadRecipe('world/cook'), sowing: sowingRecipe, keepsakes: keepsakesRecipe,
    // The nest box goes on the camp's rim on the side of the hen's home bushes (docs/future/15 slice 4).
    rimToward: (/** @type {string} */ slot) => (slot === 'nest' && speciesRecipes.hen?.home ? scrubHome(world.state?.growth?.plants ?? [], speciesRecipes.hen.home) : null) });
  sim.addSystem(camp);
  ctx.ringPlace = camp.ringPlace;
  Object.assign(ctx, { packDraw, spreadOf, camp });
}

/** @param {import('./context.js').AppContext} ctx */
export function after(ctx) {
  const { boat, boatRecipe, camp, campRecipe, creatures, finds, intro, midges, pack, pieces, piles, shadowPass, sim, terrain, walk } = ctx;
  ctx.keeps = camp.stations.keeps;
  // Solid things the walker cannot pass through (src/world/walk/solids-live.js): camp pieces, logs,
  // stones and the boat.
  const solidsLive = createSolidsLive({ walk, where: createWhere({ terrain }), benchAt: camp.stations.benchAt, rackYawDeg: campRecipe.rack?.yawDeg ?? 0,
    strand: () => pieces.strandLogs(), boat: () => (boat.visible ? boat.mooring?.boat ?? null : null), boatSize: boatRecipe.boat.hull,
    // The boulders round the way down above the spring (the dig, made below).
    extra: () => ctx.dig?.story.mouthSolids() ?? [] });
  sim.addSystem({ id: 'solids', tick: (/** @type {any} */ f) => solidsLive.update(f.realDt) });
  shadowPass.addCaster(camp.props.caster);
  midges.keepClear(() => camp.smokeClear());
  // What your figure glances at on foot (src/world/figure/look.js): frogs near you, the fire while it
  // burns, and the finds drawn about you.
  walk.setInterests(() => {
    const fire = camp.smokeClear();
    return [
      ...creatures.frogs().map((f) => ({ x: f.x, z: f.z, kind: 'creature' })),
      ...(fire ? [{ x: fire.x, z: fire.z, kind: 'fire' }] : []),
      ...finds.shown().map((f) => ({ x: f.x, z: f.z, kind: 'find' })),
    ];
  });
  // Its gestures for the pouches (src/world/figure/acts.js): setting one down onto a pile at camp,
  // and emptying one.
  on('pack:set-down', (/** @type {{ pile: string | null, at?: { x: number, z: number } | null }} */ p) => walk.gesture('setDown', p.pile ? ctx.pieceSpot(p.pile) : p.at ?? undefined));
  on('pack:emptied', () => walk.gesture('empty'));
  intro.useCamp(camp);
  // The stores (section 3.12; src/world/pack/stores.js): the wood store, the stone pile and the clay
  // slab, places with a card from the first frame (drawn by packDraw), glowing while the pack holds
  // their kind near camp.
  const stores = createStores({ recipe: pack.recipe, piles, walk, glow: campRecipe.glow, ringLaid: () => camp.ringLaid() });
  Object.assign(ctx, { stores });
}

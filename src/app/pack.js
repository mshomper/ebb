// @ts-check
// The walker's pack and the piles at camp, gathering, the forager's knife and the knife on the belt.
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import * as clock from '../core/clock.js';
import { on } from '../core/events.js';
import { get as getStore, update as updateStore, subscribe as subscribeStore } from '../core/store.js';
import { loadRecipe } from '../core/recipes.js';
import { pickedFirsts, noteFirsts, knifed, hasForage } from '../world/forager.js';
import { createForagerBelt } from '../world/forager-belt.js';
import { createPack } from '../world/pack/index.js';
import { createGather } from '../world/gather/index.js';
import { createPiles } from '../world/pack/piles-live.js';
import { setDownAtCamp } from '../world/pack/route.js';

/** @param {import('./context.js').AppContext} ctx */
export async function start(ctx) {
  const { boat, figureRecipe, flora, intro, seasonsRecipe, seed, sim, terrain, walk, water, waterRecipe, world, ww } = ctx;
  // The walker's pack (docs/future/13 section 4.1): cloth pouches on the ground bar, filled by Gather.
  // Set down at camp puts a pouch onto its kind's pile in the camp's slots (src/world/pack/piles-live.js).
  // A pouch goes to its kind's own place first (the drying rack, its store's pile), then the hamper;
  // the heaps take the rest until a hamper stands (src/world/pack/route.js, P2j).
  /** @type {ReturnType<typeof createPiles> | null} */ let piles = null;
  /** The camp's keeps (the rack and the hamper), set once the camp is made (src/app/camp.js). @type {any} */
  ctx.keeps = null;
  const pack = createPack({ recipe: await loadRecipe('world/pack'), you: () => walk.you(), day: () => clock.dayIndexOf(clock.worldT()),
    speciesName: (sp) => flora[sp]?.name ?? world.env.recipes?.covers?.[sp]?.name,
    setDown: (k, h) => (piles && ctx.keeps ? setDownAtCamp(k, h, { campOf: pack.kinds.campOf, piles, rack: ctx.keeps.rack, hamper: ctx.keeps.hamper })
      : piles?.setDown(k, h) ?? { moved: 0, refuse: 'noSlot' }) });
  piles = createPiles({ recipe: pack.recipe, kinds: pack.kinds, seed, noHeaps: () => !!ctx.keeps?.hamper.here() });
  intro.usePack(pack);
  /** The camp's ring for gathering, set once the camp is made (src/app/camp.js). @type {(() => any) | null} */
  ctx.ringPlace = null;
  // Gathering on foot (section 4.2): Gather on a card walks you there, you kneel, a handful goes in.
  const gather = createGather({ recipe: await loadRecipe('world/gather'), seed, world, worldT: () => clock.worldT(), water, terrain, pack, walk,
    tide: waterRecipe.tide, strandline: ww.shore.recipe?.look?.strandline ?? null,
    weather: () => ({ weatherSeed: world.env.weatherSeed, weather: seasonsRecipe.weather, state: world.state?.weather }),
    center: () => { const b = terrain.openBounds(); return [(b.openMin[0] + b.openMax[0]) / 2, (b.openMin[1] + b.openMax[1]) / 2]; },
    // Where the boat lands the keeper: the beach there always has something to gather (F6).
    boat: () => { const s = boat.mooring?.stand; return s ? [s.x, s.z] : null; },
    // The fire ring's charcoal and ash the morning after a fire-night (P2i), once the camp exists.
    ring: () => ctx.ringPlace?.() ?? null });
  // Picked reeds grow back slowly, faster in rain (the growth step reads the gather recipe). The
  // forager's trail's gathering knife changes it (src/world/forager.js knifed): ready again sooner,
  // less bare; picking, growing back and catch-up all read it from here.
  const foragerRecipe = await loadRecipe('world/forager');
  const hasKnife = () => hasForage(getStore('unlocks')?.earned, 'knife');
  /** @type {boolean | null} */ let knifeOn = null;
  const applyKnife = () => {
    if (hasKnife() === knifeOn) return;
    knifeOn = hasKnife();
    world.env.recipes.gather = knifed(gather.recipe, knifeOn ? foragerRecipe.knife : null);
  };
  applyKnife();
  subscribeStore('unlocks', applyKnife);
  // The forager's trail (doc 13 "Trails"): a picked handful writes its plant, part and season firsts, once, for good.
  on('plant:picked', (/** @type {{ sp: string, part: string }} */ p) => updateStore('unlocks', (u) => {
    const earned = noteFirsts(u?.earned ?? {}, pickedFirsts(p.sp, p.part, world.state?.seasons?.index ?? 0, clock.hourIndex()));
    return earned === u?.earned ? u : { ...u, earned };
  }));
  // The knife on the walker's belt, once given.
  const belt = createForagerBelt({ recipe: foragerRecipe, figure: figureRecipe, walk, has: hasKnife });
  sim.addSystem({ id: 'forager-belt', tick() { belt.update(); } });
  // Flax steeping in the shallows (F1): where a minnow school keeps clear, for school.js.
  let avoidKey = '';
  const publishAvoid = () => {
    const a = gather.steepAvoid(), k = JSON.stringify(a);
    if (k !== avoidKey) { avoidKey = k; updateStore('steepAvoid', () => a); }
  };
  publishAvoid();
  subscribeStore('gather', publishAvoid);
  on('world:ticked', () => gather.expire());
  on('world:caught-up', () => gather.expire());
  Object.assign(ctx, { piles, pack, gather, belt });
}

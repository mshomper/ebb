// @ts-check
// The Hollow (H3a; docs/future/16-the-sea-cave.md; src/world/hollow/zone-live.js): a zone of seeded
// floors through the stack's arch, its own pass (and the veil after the walker), the arch's line and
// Go through. Made after the stack's mouth room. `?hollow` (testing, unsaved) puts you on floor 1 of
// a trip with the driftwood staff made and the old lantern hung; `?hollow=3` on floor 3 (higher
// numbers reach the deeper depths: 5 the dripstone, 8 the silt, 11 the glass halls); `?hollow=dark`
// on floor 1 with the lantern nearly out.
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import { get as getStore, update as updateStore } from '../core/store.js';
import { loadRecipe } from '../core/recipes.js';
import { run } from '../core/workers.js';
import { dispatch } from '../input/actions.js';
import { createHollowZone } from '../world/hollow/zone-live.js';
import { createHollowPass } from '../render/passes/hollow.js';

/** @param {import('./context.js').AppContext} ctx */
export async function start(ctx) {
  const { seed, sim, stackMouth, walk, zones } = ctx;
  if (!stackMouth) return;
  const H = await loadRecipe('world/hollow');
  // The Hollow's rock wears the island's rock scan, as the stack's mouth does (decision 0001).
  const TL = ctx.terrainRecipe.detail.layers;
  const hollowPass = createHollowPass({ active: () => zones.active() === 'hollow', ground: ctx.groundDetail,
    scan: { rockTileM: TL.rock.tileMeters, cliffTileM: TL.cliff.tileMeters, mean: ctx.terrainRecipe.materials.albedoRock, ...H.zone.scan } });
  const hollowVeil = hollowPass.veilPass();
  const hollow = createHollowZone({ H, seed, walk, zones, pass: hollowPass, run, mouth: stackMouth, stackMouthId: stackMouth.id });
  stackMouth.setArchLine(hollow.archLine);
  /** A test link's trip, started once the mouth room holds you. @type {{ floor: number, fuel: number } | null} */
  ctx.hollowPut = null;
  sim.addSystem({ id: 'hollow', tick: () => {
    const p = ctx.hollowPut;
    if (p && zones.active() === stackMouth.id && !zones.busy()) {
      ctx.hollowPut = null;
      // The arch seen (the journal is up by now), as walking up to it would.
      if (!(getStore('journal')?.flags ?? []).includes('setpiece:stack:arch')) dispatch(/** @type {any} */ ({ type: 'journal.flag', flag: 'setpiece:stack:arch' }));
      hollow.test(p);
    }
    hollow.prepare();
  } });
  Object.assign(ctx, { hollow, hollowPass, hollowVeil, hollowRecipe: H });
}

/** `?hollow`, `?hollow=3`, `?hollow=dark` (test links, unsaved). @param {import('./context.js').AppContext} ctx */
export function tests(ctx) {
  const { params, stack, hollow, hollowRecipe: H } = ctx;
  if (!hollow || !stack || !params.has('hollow')) return;
  const v = params.get('hollow') ?? '';
  const floor = /^\d+$/.test(v) ? Math.max(1, Number(v)) : 1;
  const fuel = v === 'dark' ? H.trip.fuel * 0.04 : H.trip.fuel;
  // The staff made and the old lantern hung (the arch is seen once in the mouth): what Go through asks for.
  updateStore('cook', (c) => (c?.tools?.includes('driftwood-staff') ? c : { ...c, tools: [...(c?.tools ?? []), 'driftwood-staff'] }));
  updateStore('stack', (s) => ({ ...s, lantern: 'hung' }));
  // Up at once with no reveal, then into the mouth room (as `?stack=lamp`), then the trip.
  if (!stack.risen) { const from = stack.startRoad(); stack.writeRoad(1); stack.roadDone(from, false); }
  const L = stack.layout;
  ctx.stackPut = { x: L.stand[0], z: L.stand[1], yaw: Math.atan2(L.x - L.stand[0], L.z - L.stand[1]), mouth: true, tries: 3000 };
  ctx.hollowPut = { floor, fuel };
}

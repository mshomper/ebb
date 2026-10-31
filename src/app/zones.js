// @ts-check
// Zones (docs/26-zones.md): the spring's cave, its pass and its own lighting, and a tap or a card down
// in a zone.
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import { makeBuffer } from '../core/gpu.js';
import * as clock from '../core/clock.js';
import { update as updateStore } from '../core/store.js';
import { loadRecipe } from '../core/recipes.js';
import { createLighting } from '../render/lighting.js';
import { createZones } from '../world/zones/live.js';
import { createSpringCave } from '../world/spring/cave-live.js';
import { createCavePass } from '../render/passes/cave.js';

/** @param {import('./context.js').AppContext} ctx */
export async function start(ctx) {
  const { atmosphere, camera, canvas, dig, gpu, keepsakesRecipe, lighting, pack, seed, shadowPass, sim, smallLights, terrain, walk, walkerRecipe } = ctx;
  // Zones (docs/26-zones.md, src/world/zones): places below the island you go to and come back from,
  // through a fade. The island keeps simulating; only what is drawn, walked and heard swaps. The
  // first is the spring's cave (src/world/spring, the spring-ore plan O3), under the hole where the
  // ground gave way: its own pass (drawn first while it is the zone, so it clears the frame), its
  // own light (a lighting group on the same layout: the bounce as its fill, no sun and no shadows).
  const zones = createZones({ R: await loadRecipe('world/zones'), host: canvas.parentElement });
  const cavePass = createCavePass({ active: () => zones.active() === 'spring-cave' });
  const caveBeam = cavePass.beamPass();
  const caveSH = makeBuffer(gpu.device, { label: 'cave-sh9', size: 9 * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  // The cave's own lighting keeps its own small lights (none yet) apart from the island's.
  const caveLighting = createLighting(gpu.device, { transmittance: atmosphere.transmittance, aerial: atmosphere.aerial, sh: caveSH }, shadowPass.resources(gpu.device), lighting.layout, smallLights);
  const caveSHData = new Float32Array(36);
  const caveRecipe = await loadRecipe('world/spring-cave');
  const springCave = createSpringCave({ R: caveRecipe, seed, dig, terrain, walk, pack, pass: cavePass, zones, K: keepsakesRecipe,
    hour: () => clock.worldT() / 3600, day: () => clock.dayIndexOf(clock.worldT()), walkerCamera: walkerRecipe.camera });
  // The cave is built in a worker as soon as the ground has given way, so climbing down is quick.
  sim.addSystem({ id: 'spring-cave', tick: () => springCave.prepare() });
  /** A card down in a zone, opened once you arrive beside it (the frame opens it). @type {{ card: any, x: number, y: number } | null} */
  ctx.zoneCardOnArrival = null;
  /** A tap in a zone: walk on its floor, or to a card of its own and open it there. @param {number} sx @param {number} sy */
  /**
   * What a tap or a rest at a screen point meets in the zone: its card (a thing the ray picks out
   * first, then whatever is on the floor there) and the floor point. Shared by the tap and the hover,
   * so what the hand names is what a click opens. @param {number} sx @param {number} sy CSS pixels
   */
  function zoneCardAt(sx, sy) {
    const z = zones.zone(), r = camera.ray(sx, sy), p = z?.groundAt?.(r.o, r.d) ?? null;
    if (!z) return { card: null, p: null };
    // A thing the ray picks out counts even where the ray meets no floor (the rope, high against the wall).
    const card = z.rayCard?.(r.o, r.d) ?? (p ? z.cardAt?.(p[0], p[2]) : null) ?? null;
    return { card, p: p ?? (card ? [card.wx, ctx.zoneGround ? ctx.zoneGround(card.wx, card.wz) : 0, card.wz] : null) };
  }
  function zoneTap(sx, sy) {
    const { card, p } = zoneCardAt(sx, sy);
    if (!p) return;
    ctx.zoneCardOnArrival = null;
    if (card) {
      const reach = card.reachR ?? 0.5;
      if (walk.distTo(card.wx, card.wz) <= reach + 0.15) updateStore('identify', () => ({ ...card, x: sx, y: sy, at: performance.now() }));
      else if (walk.tap(sx, sy, [card.wx, p[1], card.wz], reach)) ctx.zoneCardOnArrival = { card, x: sx, y: sy };
      return;
    }
    updateStore('identify', () => null);
    walk.tap(sx, sy, p);
  }
  Object.assign(ctx, { zones, cavePass, caveBeam, caveSH, caveLighting, caveSHData, caveRecipe, springCave, zoneCardAt, zoneTap });
}

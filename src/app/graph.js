// @ts-check
// The frame graph: the passes in draw order (src/app/passes.js), and only a zone's own passes while
// you are down in one.
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import { createFrameGraph } from '../render/frame-graph.js';
import { passes, zonePasses } from './passes.js';

/** @param {import('./context.js').AppContext} ctx */
export async function start(ctx) {
  const { camp, caveLighting, gpu, lighting, tier, tonemap, zones } = ctx;
  // In a zone only the zone's own passes, the walker and the post passes run (src/world/zones); its
  // lighting group stands in for the island's.
  const ZONE_PASSES = new Set(zonePasses(ctx));
  /** @param {import('../render/frame-graph.js').Pass[]} list */
  const zoned = (list) => list.map((p) => {
    if (ZONE_PASSES.has(p)) return p;
    const on = p.enabled.bind(p);
    p.enabled = (t) => !zones.active() && on(t);
    return p;
  });
  const zoneLighting = { layout: lighting.layout, get group() { return zones.active() ? caveLighting.group : lighting.group; } };
  const graph = createFrameGraph(gpu, zoned(passes(ctx)), { tier, lighting: zoneLighting });
  // The banded flame is painted in the tonemap from the fire sim's heat (camp-fire.js).
  tonemap.setFire(camp.firePass);
  await graph.setup();
  Object.assign(ctx, { graph });
}

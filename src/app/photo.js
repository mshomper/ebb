// @ts-check
// Photo mode (B2 P1, src/render/photo-mode.js).
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import * as clock from '../core/clock.js';
import { get as getStore, update as updateStore } from '../core/store.js';
import { createPhotoMode } from '../render/photo-mode.js';
import { dispatch } from '../input/actions.js';

/** @param {import('./context.js').AppContext} ctx */
export function start(ctx) {
  const { camRecipe, camera, dof, gpu, photoRecipe, pieces, terrain, tonemap, walk, water } = ctx;
  // Photo mode (B2 P1, src/render/photo-mode.js): P or Photo on the ground bar; a free camera that
  // never startles, world time paused, the lens, a filter and the shot. Opening it puts the shaping
  // tools, cards and panels away.
  const photo = createPhotoMode({
    recipe: photoRecipe, camera, clock, dof, tonemap, device: gpu.device, format: gpu.format,
    // The ground, a pond's surface or the sea's (the tide), whichever is highest.
    ground: (x, z) => Math.max(terrain.sampleHeight(x, z), water.tide, water.sim.live ? water.sampleLive(x, z).surface : -Infinity),
    island: { center: camRecipe.worldCenter ?? [0, 0], radius: camRecipe.worldRadius + camRecipe.targetMargin },
    walker: () => { const y = walk.below ? walk.you() : null; return y ? [y[0], y[2]] : null; },
    viewSize: () => [ctx.size.cssW, ctx.size.cssH],
    // The tools, the pointer and planting are made below (src/app/tools.js, pointer.js); this runs later.
    onOpen: () => {
      ctx.finishStroke();
      ctx.input.pouring = null;
      pieces.cancelCarry();
      updateStore('tools', (t) => { t.tool = null; });
      terrain.setRing({ visible: false, level: null });
      updateStore('identify', () => null);
      ctx.hoverOff();
      // A seed, a gift or the net in hand is put away, so no ring lies on the ground in the picture.
      ctx.sowing.putAway();
      if (getStore('journalUi')?.open) dispatch({ type: 'ui.journal', open: false });
      if (getStore('keeperUi')?.open) dispatch(/** @type {any} */ ({ type: 'ui.keeper', open: false }));
    },
  });
  Object.assign(ctx, { photo });
}

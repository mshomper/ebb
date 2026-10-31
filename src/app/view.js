// @ts-check
// The orbit camera, its ground probe, and the store slice `view` (the screen point of a ground point).
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import { update as updateStore } from '../core/store.js';
import { createOrbitCamera } from '../render/camera.js';

/** @param {import('./context.js').AppContext} ctx */
export function start(ctx) {
  const { back, camRecipe, canvas, terrain, water } = ctx;
  const camera = createOrbitCamera(camRecipe);
  if (back?.view) camera.setPose(back.view);   // the view you left
  // The ground, or the water's surface where it stands higher, so a close-up never dips under a pond.
  /** A zone's floor under a point while you are in one (src/world/zones), else null: the view keeps above it, not the island over it; the frame sets it. @type {((x: number, z: number) => number) | null} */
  ctx.zoneGround = null;
  camera.setGroundProbe((x, z) => (ctx.zoneGround ? ctx.zoneGround(x, z) : Math.max(terrain.sampleHeight(x, z), water.sim.live ? water.sampleLive(x, z).surface : -Infinity)));
  // The view, for the UI (store slice `view`): the ground point in the middle of the screen, and
  // where a ground point lands on screen in CSS pixels (behind: it is behind the camera, and x, y
  // are mirrored so they still say which way to turn).
  updateStore('view', () => ({
    center: () => [camera.target[0], camera.target[2]],
    /** @param {number} x @param {number} z @returns {{ x: number, y: number, behind: boolean }} */
    project(x, z) {
      // Down in a zone, the zone's own floor (the hover tag over the cave's pan, not the island above).
      const m = camera.viewProj, y = ctx.zoneGround ? ctx.zoneGround(x, z) : terrain.sampleHeight(x, z);
      const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13];
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      const behind = w <= 1e-4, s = behind ? -1 / Math.max(Math.abs(w), 1e-4) : 1 / w;
      const r = canvas.getBoundingClientRect();
      return { x: r.left + (cx * s * 0.5 + 0.5) * r.width, y: r.top + (0.5 - cy * s * 0.5) * r.height, behind };
    },
    /** A world point on screen (CSS pixels), as project() but at its own height. @param {number} x @param {number} y @param {number} z */
    project3(x, y, z) {
      const m = camera.viewProj;
      const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13];
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      const behind = w <= 1e-4, s = behind ? -1 / Math.max(Math.abs(w), 1e-4) : 1 / w;
      const r = canvas.getBoundingClientRect();
      return { x: r.left + (cx * s * 0.5 + 0.5) * r.width, y: r.top + (0.5 - cy * s * 0.5) * r.height, behind };
    },
  }));
  Object.assign(ctx, { camera });
}

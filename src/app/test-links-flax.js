// @ts-check
// The flax test link (F1, a test link, unsaved). Run in order from src/app/systems.js.
//
// `?flax`: a pouch of flax stems in the pack, and you on a pond's bank facing its shallows (by the
// minnows' home when they live there), with two bundles already in the water beside you: one laid a
// day ago, still steeping, and one laid four days ago, retted and ready to lift. Steep here on the
// stems' pouch card lays a third. `?flax&camp=bench`: two handfuls of flax fibre instead, standing
// at the built workbench, to weave cloth.

import * as clock from '../core/clock.js';
import { update as updateStore } from '../core/store.js';
import { WATER_CLASS } from '../world/water/summary.js';
import { waterCellCenter } from '../world/water/grid.js';

/** @param {import('./context.js').AppContext} ctx */
export function flax(ctx) {
  const { back, camera, campRecipe, gather, pack, params, sim, terrain, walk, water, world } = ctx;
  if (!params.has('flax') || back) return;
  if (params.has('camp')) { pack.add('flax-fibre', 2); return; }
  pack.add('flax.stems', 3);
  const RT = gather.rettingRecipe;
  // Tried every second until a pond has filled and you stand at it.
  let stood = false, wait = 0;
  sim.addSystem({ id: 'flax-test', tick() {
    if (stood || (wait = (wait + 1) % 30) !== 1) return;
    const s = water.getSummary?.();
    if (!s?.rect) return;
    const deep = (/** @type {number} */ x, /** @type {number} */ z) => water.sampleLive(x, z)?.depth ?? 0;
    // Still water cells, nearest the minnows' home first (or the island's middle).
    const home = world.state?.creatures?.minnows?.groups?.[0] ?? null;
    const b = terrain.openBounds(), mid = home ? [home.x, home.z] : [(b.openMin[0] + b.openMax[0]) / 2, (b.openMin[1] + b.openMax[1]) / 2];
    /** @type {number[][]} */ const cells = [];
    for (let j = 0; j < s.rect.h; j++) for (let i = 0; i < s.rect.w; i++) {
      if (s.cls[j * s.rect.w + i] !== WATER_CLASS.still) continue;
      const x = waterCellCenter(s.rect.x + i), z = waterCellCenter(s.rect.y + j);
      cells.push([x, z, (x - mid[0]) ** 2 + (z - mid[1]) ** 2]);
    }
    cells.sort((p, q) => p[2] - q[2]);
    for (const [cx, cz] of cells.slice(0, 400)) {
      for (let i = 0; i < 16; i++) {
        // Dry ground a step back from a shallow cell, facing it.
        const a = (i / 16) * 2 * Math.PI, x = cx + Math.sin(a) * 1.2, z = cz + Math.cos(a) * 1.2, yaw = a + Math.PI;
        const w = deep(x + Math.sin(yaw) * RT.aheadM, z + Math.cos(yaw) * RT.aheadM);
        if (deep(x, z) > 0.01 || w < RT.minDepthM || w > RT.maxDepthM || !walk.placeAt(x, z, yaw, 'stand')) continue;
        // The two bundles to either side of where you face, in the shallows.
        const hour = clock.worldT() / 3600, list = [];
        for (const [side, ago] of [[1, 24], [-1, RT.hours + 24]]) {
          const ax = x + Math.sin(yaw + side * 0.55) * (RT.aheadM + 0.3), az = z + Math.cos(yaw + side * 0.55) * (RT.aheadM + 0.3);
          if (deep(ax, az) >= RT.minDepthM && deep(ax, az) <= RT.maxDepthM) list.push([Math.round(ax * 100) / 100, Math.round(az * 100) / 100, Math.round((hour - ago) * 100) / 100, 3]);
        }
        updateStore('gather', (g) => ({ ...(g ?? { version: 1, events: [] }), retting: list }));
        camera.setPose({ ...camera.pose(), target: [x, terrain.sampleHeight(x, z), z], yaw: yaw + Math.PI, distance: campRecipe.rest.viewDistanceM, pitch: (campRecipe.rest.viewPitchDeg * Math.PI) / 180 });
        walk.downHere();
        stood = true;
        return;
      }
    }
  } });
}

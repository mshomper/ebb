// @ts-check
// Where the frog size preview (?frogscale) sets its frogs, and how long the pond's edge is. Pure:
// it reads the habitat grid (1 m squares, src/world/growth/habitat.js), the plants, and height
// lookups it is given. Four frogs sit on the bank on the side the camera looks from, one on a lily
// pad and one half in the shallows, so the sizes can be judged against grass, reeds, water and pads.

import { HABITAT_ORIGIN } from '../growth/habitat.js';

/**
 * @typedef {{ x: number, y: number, z: number, yaw: number, where: string }} Spot
 */

/**
 * @param {any} hab the habitat grid
 * @param {{ plants?: any[] } | null | undefined} growth the world state's growth (plants)
 * @param {{ ground: (x: number, z: number) => number, surface: (x: number, z: number) => number, from: number[] }} at
 *   ground and water surface heights (m); from: the point the camera looks from (x, z)
 * @returns {{ spots: Spot[], edgeM: number, pondM2: number } | null} null until the island has fresh water
 */
export function previewSpots(hab, growth, at) {
  if (!hab) return null;
  const n = hab.n;
  const fresh = (/** @type {number} */ k) => k >= 0 && hab.open[k] && !hab.sea[k] && hab.depthCm[k] > 0;
  const land = (/** @type {number} */ k) => k >= 0 && hab.open[k] && !hab.sea[k] && hab.depthCm[k] === 0;
  const xOf = (/** @type {number} */ k) => HABITAT_ORIGIN + (k % n) + 0.5;
  const zOf = (/** @type {number} */ k) => HABITAT_ORIGIN + Math.floor(k / n) + 0.5;
  const nb = (/** @type {number} */ k) => {
    const i = k % n, j = Math.floor(k / n);
    return [i > 0 ? k - 1 : -1, i < n - 1 ? k + 1 : -1, j > 0 ? k - n : -1, j < n - 1 ? k + n : -1];
  };

  // The pond: its middle, area, and the land squares along its edge.
  let cx = 0, cz = 0, area = 0, faces = 0;
  /** @type {{ k: number, w: number }[]} */ const bank = [];
  /** @type {number[]} */ const shallows = [];
  for (let k = 0; k < n * n; k++) {
    if (fresh(k)) {
      cx += xOf(k); cz += zOf(k); area++;
      const d = hab.depthCm[k];
      if (d >= 2 && d <= 12 && nb(k).some(land)) shallows.push(k);
    } else if (land(k)) {
      const w = nb(k).find(fresh);
      if (w !== undefined) { bank.push({ k, w }); faces += nb(k).filter(fresh).length; }
    }
  }
  if (!area || !bank.length) return null;
  cx /= area; cz /= area;
  // Square edges overcount a smooth shore by about 4 / pi.
  const edgeM = Math.round(faces * Math.PI / 4);

  // Bank squares on the camera's side of the pond, spread a little around it.
  const view = Math.atan2(at.from[1] - cz, at.from[0] - cx);
  const turn = (/** @type {number} */ a) => Math.atan2(Math.sin(a), Math.cos(a));
  const angleOf = (/** @type {number} */ k) => Math.atan2(zOf(k) - cz, xOf(k) - cx);
  /** @type {Spot[]} */ const spots = [];
  [-0.38, -0.12, 0.12, 0.38].forEach((da, i) => {
    let best = bank[0], bestD = Infinity;
    for (const b of bank) {
      const d = Math.abs(turn(angleOf(b.k) - view - da));
      if (d < bestD) { bestD = d; best = b; }
    }
    // Sit at the water's edge of the bank square, facing the water or along the bank.
    const wx = xOf(best.w), wz = zOf(best.w), x0 = xOf(best.k), z0 = zOf(best.k);
    const x = x0 + (wx - x0) * 0.35, z = z0 + (wz - z0) * 0.35;
    const toWater = Math.atan2(wx - x0, wz - z0);
    spots.push({ x, y: at.ground(x, z), z, yaw: toWater + [0, Math.PI, 1.2, -0.6][i], where: 'bank' });
  });

  // One on the lily pad nearest the camera's side, one half in the shallows.
  const lilies = (growth?.plants ?? []).filter((p) => p.sp === 'lilies');
  if (lilies.length) {
    let best = lilies[0], bestD = Infinity;
    for (const p of lilies) {
      const d = Math.abs(turn(Math.atan2(p.z - cz, p.x - cx) - view));
      if (d < bestD) { bestD = d; best = p; }
    }
    spots.push({ x: best.x, y: at.surface(best.x, best.z) + 0.012, z: best.z, yaw: 0.8, where: 'lily pad' });
  }
  if (shallows.length) {
    let best = shallows[0], bestD = Infinity;
    for (const k of shallows) {
      const d = Math.abs(turn(angleOf(k) - view - 0.25));
      if (d < bestD) { bestD = d; best = k; }
    }
    const x = xOf(best), z = zOf(best);
    spots.push({ x, y: at.surface(x, z) - 0.016, z, yaw: Math.atan2(cx - x, cz - z) + Math.PI, where: 'shallows' });
  }
  return { spots, edgeM, pondM2: area };
}

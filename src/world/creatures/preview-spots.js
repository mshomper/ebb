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
 * @returns {{ spots: Spot[], edgeM: number, pondM2: number, islandEdgeM: number, waters: number } | null}
 *   edgeM and pondM2: the pond the frogs sit by (the one nearest the camera); islandEdgeM: every fresh
 *   water's edge; waters: how many bodies of at least 30 m2. Null until the island has fresh water.
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

  // Every body of fresh water (4-connected squares), and the island's whole fresh-water edge.
  const label = new Int32Array(n * n);
  /** @type {{ area: number, cx: number, cz: number }[]} */ const bodies = [{ area: 0, cx: 0, cz: 0 }];
  let allFaces = 0;
  for (let k0 = 0; k0 < n * n; k0++) {
    if (land(k0)) allFaces += nb(k0).filter(fresh).length;
    if (!fresh(k0) || label[k0]) continue;
    const id = bodies.length, body = { area: 0, cx: 0, cz: 0 };
    const queue = [k0];
    label[k0] = id;
    while (queue.length) {
      const k = /** @type {number} */ (queue.pop());
      body.area++; body.cx += xOf(k); body.cz += zOf(k);
      for (const q of nb(k)) if (fresh(q) && !label[q]) { label[q] = id; queue.push(q); }
    }
    body.cx /= body.area; body.cz /= body.area;
    bodies.push(body);
  }
  // The pond: the body of at least 30 m2 nearest the camera (the island may have several ponds
  // and marshes), its middle, area, and the land squares along its edge.
  let pick = 0, pickD = Infinity;
  bodies.forEach((b, id) => {
    if (!id || b.area < 30) return;
    const d = Math.hypot(b.cx - at.from[0], b.cz - at.from[1]);
    if (d < pickD) { pickD = d; pick = id; }
  });
  if (!pick) return null;
  const { cx, cz, area } = bodies[pick];
  const inPond = (/** @type {number} */ k) => k >= 0 && label[k] === pick;
  let faces = 0;
  /** @type {{ k: number, w: number }[]} */ const bank = [];
  /** @type {number[]} */ const shallows = [];
  for (let k = 0; k < n * n; k++) {
    if (inPond(k)) {
      const d = hab.depthCm[k];
      if (d >= 2 && d <= 12 && nb(k).some(land)) shallows.push(k);
    } else if (land(k)) {
      const w = nb(k).find(inPond);
      if (w !== undefined) { bank.push({ k, w }); faces += nb(k).filter(inPond).length; }
    }
  }
  if (!bank.length) return null;
  // Square edges overcount a smooth shore by about 4 / pi.
  const edgeM = Math.round(faces * Math.PI / 4);
  const islandEdgeM = Math.round(allFaces * Math.PI / 4);
  const waters = bodies.filter((b, id) => id && b.area >= 30).length;

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
  const cellOf = (/** @type {number} */ x, /** @type {number} */ z) => Math.floor(z - HABITAT_ORIGIN) * n + Math.floor(x - HABITAT_ORIGIN);
  const lilies = (growth?.plants ?? []).filter((p) => p.sp === 'lilies' && inPond(cellOf(p.x, p.z)));
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
  return { spots, edgeM, pondM2: area, islandEdgeM, waters };
}

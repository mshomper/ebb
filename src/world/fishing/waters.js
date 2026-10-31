// @ts-check
// The five waters (docs/future/17, "Reading the water"), read where the float lands, from ground the
// player shaped (doc 13, "Shaped, not found"): deep water past the drop-off, open water past the
// tide band, and in the shallows the kelp where the shore's kelp and wrack zones lie, the reef off
// rock and cliff, the sand flats otherwise. Raise a cliff headland and the reef comes; carve a
// sheltered sandy cove and the flats come. Pure; the live module samples the island for it.

/**
 * @typedef {{ depthM: number, inBand: boolean, kelpShare: number, rockShare: number }} WaterAt
 *   depthM: how far the bed lies below mean sea level; inBand: in the tide band; kelpShare: the share
 *   of water cells within kelpM that are the shore's kelp or wrack zones; rockShare: the share of
 *   shore cells within shoreM painted rock
 */

/**
 * Which water a cast lands in. @param {WaterAt} at @param {any} W recipes/world/fishing.json waters
 * @returns {'reef' | 'sand' | 'kelp' | 'open' | 'deep'}
 */
export function classifyWater(at, W) {
  if (at.depthM >= W.deepM) return 'deep';
  if (!at.inBand && at.depthM >= W.openM) return 'open';
  if (at.kelpShare >= W.kelpShare) return 'kelp';
  if (at.rockShare >= W.rockShare) return 'reef';
  return 'sand';
}

/**
 * Sample the island around a point for classifyWater. Pure, given the readers.
 * @param {number} x @param {number} z
 * @param {{ ground: (x: number, z: number) => number, inBand: (x: number, z: number) => boolean,
 *   zoneAt: (x: number, z: number) => string | null, rockAt: (x: number, z: number) => boolean | null }} read
 *   ground: height (m, mean sea level 0); zoneAt: the shore zone there (shore.js ids), or null;
 *   rockAt: is the ground there painted rock (null where it is not shore: dry land far up, or open sea)
 * @param {any} W fishing.json waters
 * @returns {import('./waters.js').WaterAt}
 */
export function sampleWater(x, z, read, W) {
  let kelp = 0, wet = 0, rock = 0, shore = 0;
  const step = 1;
  for (let dz = -W.shoreM; dz <= W.shoreM; dz += step) for (let dx = -W.shoreM; dx <= W.shoreM; dx += step) {
    const d2 = dx * dx + dz * dz, px = x + dx, pz = z + dz;
    if (d2 <= W.kelpM * W.kelpM) {
      const zn = read.zoneAt(px, pz);
      wet++;
      if (zn === 'kelp' || zn === 'wrack' || zn === 'channelled') kelp++;
    }
    if (d2 <= W.shoreM * W.shoreM) {
      const r = read.rockAt(px, pz);
      if (r !== null) { shore++; if (r) rock++; }
    }
  }
  return { depthM: Math.max(0, -read.ground(x, z)), inBand: read.inBand(x, z), kelpShare: wet ? kelp / wet : 0, rockShare: shore ? rock / shore : 0 };
}

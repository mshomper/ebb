// @ts-check
// The two islands of the chunk bench (tools/chunk-bench.html), both real: today's island, which an
// island made before the keeper's camp update keeps (recipes/land/starter-island.json, 3 x 3
// chunks), and the larger island every new island now grows from (recipes/land/starter-island-2.json,
// 4 x 4 chunks, centered off the origin). Each land recipe carries its own chunk range, center and
// camera reach, so nothing here sets them. Shared by the bench page (CPU side, no GPU) and its frame
// page (the real app, GPU side). Nothing here changes a recipe file.

/**
 * @typedef {{ id: string, name: string, title: string, land: string, meters: number, color: string }} BenchSize
 *   name: the short tag on each bar; title: the island's name in the legend;
 *   land: the land recipe it grows from (recipes/land/<land>.json); meters: the open land's width (label only)
 */

/** @type {BenchSize[]} */
export const SIZES = [
  { id: 'today', name: '3 x 3', title: 'Today\'s island', land: 'starter-island', meters: 96, color: '#5F7F5B' },
  { id: 'larger', name: '4 x 4', title: 'The larger island', land: 'starter-island-2', meters: 128, color: '#5F8196' },
];

/**
 * The terrain recipe as this island wants it, in memory only: the starter island's entry in
 * islands.list grows from this island's land. A new island picks its land from that entry
 * (src/world/terrain/chunks.js islandLand), so the frame page's island is this one.
 * @param {any} terrain recipes/world/terrain.json @param {BenchSize} size
 */
export function sizedTerrain(terrain, size) {
  const starterId = String(terrain.starter?.land ?? 'land/starter-island').replace(/^land\//, '');
  const list = (terrain.islands?.list ?? []).map((/** @type {any} */ i) => (i.id === starterId ? { ...i, land: size.land } : i));
  return { ...terrain, islands: { ...terrain.islands, list } };
}

/**
 * Whether a fetched URL is the terrain recipe, the one recipe the frame page overrides.
 * @param {string} pathname
 */
export function isTerrainRecipe(pathname) {
  return pathname.endsWith('/recipes/world/terrain.json');
}

// @ts-check
// What of the shore the island holds now, for the journal's Web (web.js presenceOf): how many water
// cells of each shore zone (recipes/world/shore.json zone ids) and of rock pool floor ("pool", the
// finds' own test, world/finds/index.js). Pure; cached on the zones and summary it was given.

import { poolCells } from '../finds/index.js';
import { groundOfCell } from '../water/shore.js';

/** @type {{ zones: any, summary: any, out: Record<string, number> } | null} */ let cache = null;

/**
 * @param {{ rect: any, zone: Uint8Array, ids: string[] } | null} zones shore-live zones()
 * @param {any} summary the water summary @param {Uint8Array | null} material the terrain's painted materials
 * @returns {Record<string, number> | null} cells by zone id, plus pool; null before the shore is known
 */
export function shorePresence(zones, summary, material) {
  if (!zones || !summary) return null;
  if (cache && cache.zones === zones && cache.summary === summary) return cache.out;
  /** @type {Record<string, number>} */ const out = { pool: 0 };
  for (const id of zones.ids) out[id] = 0;
  for (let k = 0; k < zones.zone.length; k++) if (zones.zone[k]) out[zones.ids[zones.zone[k] - 1]]++;
  const R = zones.rect;
  const pools = poolCells(summary, zones, (k) => !!material && groundOfCell(material, R.x + (k % R.w), R.y + Math.floor(k / R.w)) === 2);
  for (let k = 0; k < pools.length; k++) out.pool += pools[k];
  cache = { zones, summary, out };
  return out;
}

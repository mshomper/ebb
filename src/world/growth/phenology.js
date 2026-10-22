// @ts-check
// Per-plant phenology (doc 10, Seasons): each plant keeps its own calendar, a few game days ahead of
// or behind its species, so a meadow does not flower, set seed or die back on the same hour. Pure
// and worker-safe; computed from the plant's id, never stored.
//
// The offset comes from the plant's draw hash (the same hash32(id, 0x51ed) the instance buffer
// carries as its hash 0..1, world/growth/index.js), so a shader can shift its own season windows
// (the willow's leaf-out and leaf fall) by exactly the plant's offset without another float.
// The spread is the species recipe's `phenology.jitterDays`: the offset is uniform in
// [-jitterDays, +jitterDays) game days; 0 or missing keeps the species in lockstep.

import { hash32 } from '../../core/rng.js';
import { DAYS_PER_SEASON, SEASONS_PER_YEAR } from '../../core/clock.js';

/** Salt of the plant's draw hash (shared with the instance upload and the shrub shader). */
export const PLANT_HASH_SALT = 0x51ed;

/** The plant's draw hash, 0..1. @param {number} id */
export const plantHash = (id) => hash32(id, PLANT_HASH_SALT) / 4294967296;

/**
 * How many game days a plant runs ahead of (negative) or behind (positive) its species' calendar.
 * @param {any} rec the species recipe @param {number} id the plant's id
 */
export function phenologyOffsetDays(rec, id) {
  const J = rec?.phenology?.jitterDays ?? 0;
  if (!(J > 0)) return 0;
  return J * (2 * plantHash(id) - 1);
}

/**
 * The season position (0 spring .. 4) as this plant feels it: the world's, less its offset, so a
 * plant with a positive offset reaches each window later. Wrapped into [0, 4).
 * @param {any} rec @param {number} id @param {number} pos the world's season position
 */
export function plantSeasonPos(rec, id, pos) {
  const off = phenologyOffsetDays(rec, id);
  if (off === 0) return pos;
  let p = pos - off / DAYS_PER_SEASON;
  p -= Math.floor(p / SEASONS_PER_YEAR) * SEASONS_PER_YEAR;
  return p;
}

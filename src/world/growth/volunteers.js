// @ts-check
// Plants that come by themselves (docs/future/10). A new island starts with only the starters
// (recipes/world/growth.json `starters`, with grass); every other plant arrives later as a
// volunteer: a seed blown in, dropped by a bird or washed up, that lands on a square that suits it.
// The journal notes the first one, and from then on the Plant tool offers it.
//
// Pace (growth.json `volunteers`): none before firstAfterH hours of the island, then at least gapH
// hours between two arrivals, and in any hour after that a chance of chancePerH. The species come
// in `order`, skipping any the island has no ground for yet (each waits until it has), and any
// whose recipe names the seasons it comes in (volunteer.seasons, 0 spring .. 3 winter) when it is
// another season, so the year has something new in each (doc 13, "The year"). Some come only by a
// real route (volunteer.cause, causeOf: nettles by a fire lit on enough days), and meadow,
// woodland and shore plants wait for their land (volunteer.land). Seeded by
// the hour (core/rng.js), so a watched hour and an hour run while away bring the same plant to the
// same square. Pure and worker-safe.

import { stream, subSeed, hash32 } from '../../core/rng.js';
import { seasonOf, SECONDS_PER_HOUR } from '../../core/clock.js';
import { openBox } from '../ecology/fields.js';
import { HABITAT_ORIGIN } from './habitat.js';

/**
 * The species on the island by now, by the hour each came. A growth state from before volunteers
 * (an older save) has none recorded: every species with a plant or a cover then counts as come at
 * this hour, so a save keeps its plants and only the missing ones arrive later.
 * @param {any} g the growth state @param {any} env @param {number} hourIndex
 * @returns {Record<string, number>}
 */
export function arrivedOf(g, env, hourIndex) {
  if (g.arrived) return g.arrived;
  /** @type {Record<string, number>} */ const out = {};
  for (const sp of env.recipes.growth.starters ?? []) out[sp] = hourIndex;
  for (const p of g.plants ?? []) out[p.sp] ??= hourIndex;
  for (const [sp, c] of Object.entries(g.cover ?? {})) if (/** @type {Uint8Array} */ (c).some((v) => v > 0)) out[sp] ??= hourIndex;
  return out;
}

/**
 * This hour's volunteer, if one lands: the species and the habitat cell, or null.
 * @param {any} g the growth state (arrived and since already set)
 * @param {import('./habitat.js').Habitat} hab @param {any} env @param {number} hourIndex
 * @param {(rec: any, k: number) => number} suitCell how well a recipe likes a cell, 0..1
 * @param {(k: number) => boolean} taken whether a cell already holds a plant
 * @param {(rec: any, k: number) => boolean} [allow] whether a recipe may land on a cell (gather plants' rules, rules.js)
 * @returns {{ sp: string, k: number } | null}
 */
export function volunteerAt(g, hab, env, hourIndex, suitCell, taken, allow) {
  const V = env.recipes.growth.volunteers;
  if (!V?.order?.length) return null;
  const waiting = V.order.filter((/** @type {string} */ sp) => !(sp in g.arrived));
  if (!waiting.length || hourIndex - g.since < V.firstAfterH) return null;
  const last = Math.max(g.since, ...Object.values(/** @type {Record<string, number>} */ (g.arrived)));
  if (hourIndex - last < V.gapH) return null;
  const seed = subSeed(env.seed, 'growth-volunteer');
  if (stream(seed, hourIndex).next() >= V.chancePerH) return null;
  const season = seasonOf(hourIndex * SECONDS_PER_HOUR).index;
  for (const sp of waiting) {
    const rec = env.recipes.flora?.[sp] ?? env.recipes.covers?.[sp];
    if (!rec) continue;
    // A plant may come only in some seasons (its recipe's volunteer.seasons; gorse in summer).
    if (rec.volunteer?.seasons && !rec.volunteer.seasons.includes(season)) continue;
    // A plant whose land piece is not on the island yet waits (docs/future/13 PR-39).
    if (rec.volunteer?.land && !hab.land) continue;
    const cause = causeOf(rec, hab);
    if (cause === false) continue;
    // The square it lands on: the suitable one first in this hour's hash order.
    let best = -1, bestH = 0;
    // Only open squares can take one: the opened island's box, in grid order, finds the same square.
    const b = openBox(hab);
    for (let j = b.j0; j <= b.j1; j++) for (let k = j * hab.n + b.i0; k <= j * hab.n + b.i1; k++) {
      // Never on the camp pad (CP-16, habitat.js padClearMask).
      if (!hab.open[k] || hab.clear?.[k] || taken(k) || suitCell(rec, k) < V.minSuit) continue;
      if ((cause && !cause(k)) || (allow && !allow(rec, k))) continue;
      const h = hash32(seed, hourIndex, k);
      if (best < 0 || h < bestH) { best = k; bestH = h; }
    }
    if (best >= 0) return { sp, k: best };
  }
  return null;
}

/**
 * Where a volunteer with a cause may land (docs/future/13 PR-40, recipe `volunteer.cause`): a filter
 * on habitat cells, null when it has no cause, or false when its cause is not met anywhere yet (it
 * waits). fire: within reachM of the fire ring once it has been lit on `days` game days; camp:
 * within reachM of the pad's edge; path: as camp until worn paths exist (CP-10). The other causes
 * (perch, strandline) wait for what they need.
 * @param {any} rec @param {import('./habitat.js').Habitat} hab
 * @returns {((k: number) => boolean) | null | false}
 */
export function causeOf(rec, hab) {
  const C = rec.volunteer?.cause;
  if (!C) return null;
  const n = hab.n, o = HABITAT_ORIGIN;
  /** @param {number} x @param {number} z @param {number} r */
  const within = (x, z, r) => (/** @type {number} */ k) => {
    const dx = o + (k % n) + 0.5 - x, dz = o + Math.floor(k / n) + 0.5 - z;
    return dx * dx + dz * dz <= r * r;
  };
  if (C.kind === 'fire') {
    const f = hab.fire;
    if (!f || f.days < (C.days ?? C.nights ?? 0)) return false;
    return within(f.x, f.z, C.reachM ?? 0);
  }
  if (C.kind === 'camp' || C.kind === 'path') {
    const p = hab.pad;
    return p ? within(p.x, p.z, p.r + (C.reachM ?? 0)) : false;
  }
  return false;
}

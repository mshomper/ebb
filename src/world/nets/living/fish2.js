// @ts-check
// Catch gen 2 (docs/future/17): a fish from the one generator. Its numbers name its species by
// reference (an ordinary species' seed and water, one of the twelve rare species, or one of the
// five named net fish) and its own seed; the species, the individual, its grown pattern and its
// mesh all rebuild from those (fish-species.js, fish-field.js, fish-mesh.js), so a page, the tray
// and the chart draw the same fish from the save. Gen 1 catches (the nets' bodies.js) still rebuild
// as they were. The grown field is the slow part; it is cached by seed, and fieldAsync grows it in
// a worker. Pure, apart from that cache.

import { ordinarySpecies, rareSpecies, namedSpecies, fishIndividual } from './fish-species.js';
import { growField } from './fish-field.js';
import { fishMesh } from './fish-mesh.js';

/**
 * @typedef {{ water: string, seed?: number, rare?: string, named?: string }} SpeciesRef
 *   an ordinary species (its seed and water), a rare one by its fishing.json rare id, or a named one by its named id
 * @typedef {{ kind: string, gen: 2, seed: number, sp: SpeciesRef, rarity: string, lengthM: number, morph: boolean, morphId: string | null, plan: string }} FishNumbers
 *   kind: the roster species id; seed: this individual's; morph: a rarer morph (leucistic, golden, melanistic, giant)
 */

/** @type {Map<string, any>} */
const SPECIES = new Map();
/** @type {Map<string, { Nu: number, Nv: number, field: Float32Array }>} */
const FIELDS = new Map();
const FIELD_CAP = 64;

/** A species from its reference (cached). @param {SpeciesRef} ref @param {any} FR recipes/world/fishing.json */
export function speciesOf(ref, FR) {
  const key = ref.rare ? `rare:${ref.rare}` : ref.named ? `named:${ref.named}` : `${ref.water}:${ref.seed}`;
  let sp = SPECIES.get(key);
  if (sp) return sp;
  const G = FR.gen;
  if (ref.rare) sp = rareSpecies(FR.rare.find((/** @type {any} */ r) => r.id === ref.rare), G);
  else if (ref.named) sp = namedSpecies(FR.named.find((/** @type {any} */ r) => r.id === ref.named), G);
  else sp = ordinarySpecies(/** @type {number} */ (ref.seed), ref.water, G);
  SPECIES.set(key, sp);
  return sp;
}

/**
 * A caught fish's numbers. Pure. @param {string} kind its roster id @param {SpeciesRef} ref @param {number} seed this individual's
 * @param {any} FR fishing.json @returns {FishNumbers}
 */
export function fishNumbers(kind, ref, seed, FR) {
  const sp = speciesOf(ref, FR), ind = fishIndividual(sp, seed >>> 0, FR.gen);
  return { kind, gen: 2, seed: seed >>> 0, sp: { ...ref }, rarity: sp.rarity, lengthM: Math.round(ind.sizeCm * 10) / 1000, morph: !!ind.morph, morphId: ind.morph, plan: sp.plan };
}

/** The species and individual behind numbers. @param {FishNumbers} n @param {any} FR */
export function fishOf(n, FR) {
  const sp = speciesOf(n.sp, FR);
  return { sp, ind: fishIndividual(sp, n.seed, FR.gen) };
}

/** The cache key of a fish's field. @param {FishNumbers} n */
const fieldKey = (n) => `${n.sp.rare ?? n.sp.named ?? `${n.sp.water}:${n.sp.seed}`}:${n.seed}`;

/** Its grown field, grown here now if not cached. @param {FishNumbers} n @param {any} FR */
export function fieldOf(n, FR) {
  const k = fieldKey(n);
  let f = FIELDS.get(k);
  if (!f) {
    const { sp, ind } = fishOf(n, FR);
    f = growField(sp, n.seed, ind.g, FR.gen);
    keepField(k, f);
  }
  return f;
}

/** @param {string} k @param {{ Nu: number, Nv: number, field: Float32Array }} f */
function keepField(k, f) {
  FIELDS.set(k, f);
  if (FIELDS.size > FIELD_CAP) FIELDS.delete(/** @type {string} */ (FIELDS.keys().next().value));
}

/** Is its field grown yet? @param {FishNumbers} n */
export const hasField = (n) => FIELDS.has(fieldKey(n));

/**
 * Grow its field in a worker (src/core/workers.js run), then cache it; resolves when it is there.
 * @param {FishNumbers} n @param {any} FR @param {(job: any, args: any, opts?: any) => Promise<any>} run
 */
export async function fieldAsync(n, FR, run) {
  const k = fieldKey(n);
  if (FIELDS.has(k)) return FIELDS.get(k);
  const { sp, ind } = fishOf(n, FR);
  const f = await run({ module: './world/nets/living/fish-field.js', fn: 'growFieldJob' }, { sp, seed: n.seed, g: ind.g, G: FR.gen }, { lane: 'interactive', key: `fish:${k}` });
  keepField(k, { Nu: f.Nu, Nv: f.Nv, field: f.field });
  return FIELDS.get(k);
}

/** Its mesh (its field grown here if not cached). @param {FishNumbers} n @param {any} FR */
export function fishMeshOf(n, FR) {
  const { sp, ind } = fishOf(n, FR);
  return fishMesh(sp, ind, fieldOf(n, FR));
}

/** Its name. @param {FishNumbers} n @param {any} FR */
export const fishName = (n, FR) => speciesOf(n.sp, FR).name;

/** Is it see-through (a ghost fish)? @param {FishNumbers} n @param {any} FR */
export const fishClear = (n, FR) => speciesOf(n.sp, FR).special === 'ghost';

// @ts-check
// The pack's kinds (docs/future/13, section 4.1): what each pouch kind is called on its card, which
// sketch it wears, where its pile goes at camp, and the fixed order pouches sort in. Pure. Built from
// recipes/world/pack.json `kinds`, plus any plant-part kinds ('<species>.<part>') the flora recipes
// give, which take their group from `partGroups`. A kind nobody knows (from a newer build) still
// works: it sorts last, wears the plain sketch and keeps its id.

/**
 * @typedef {{ id: string, group: string, sketch: string, camp: string, line: string }} Kind
 * @typedef {{ list: Kind[], byId: Map<string, Kind>, groups: string[],
 *   groupOf: (id: string) => string | null, order: (id: string) => number, compare: (a: string, b: string) => number,
 *   sketchOf: (id: string) => string, lineOf: (id: string) => string, campOf: (id: string) => string }} Kinds
 */

/** Where a kind of each group goes at camp when the recipe does not say. */
const GROUP_CAMP = /** @type {Record<string, string>} */ ({ herbs: 'rack', living: 'bowl' });

/** A group's own sketch, worn by plant parts the recipe does not list. @param {string} group */
const groupSketch = (group) => group;

/**
 * A kind made from a plant part id such as 'mint.leaves', or null when the part has no group.
 * @param {string} id @param {Record<string, string>} partGroups @returns {Kind | null}
 */
function partKind(id, partGroups) {
  const dot = id.lastIndexOf('.');
  if (dot <= 0) return null;
  const part = id.slice(dot + 1), group = partGroups[part];
  if (!group) return null;
  const camp = part === 'seed' || part === 'clump' ? 'pouch' : (GROUP_CAMP[group] ?? 'heap');
  return { id, group, sketch: groupSketch(group), camp, line: '' };
}

/**
 * The registry of every kind the pack knows.
 * @param {any} recipe recipes/world/pack.json
 * @param {Array<string | { id: string, line?: string, sketch?: string }>} [plantParts] plant-part kinds
 *   from the flora recipes, as ids or with their journal line
 * @returns {Kinds}
 */
export function makeKinds(recipe, plantParts = []) {
  /** @type {string[]} */
  const groups = Array.isArray(recipe?.groups) ? recipe.groups.slice() : [];
  /** @type {Record<string, string>} */
  const partGroups = recipe?.partGroups ?? {};
  /** @type {Map<string, Kind>} */
  const byId = new Map();
  /** @type {Map<string, number>} */
  const rank = new Map();
  /** @param {Kind} k */
  const put = (k) => { if (!byId.has(k.id)) { byId.set(k.id, k); rank.set(k.id, rank.size); } };
  for (const k of Array.isArray(recipe?.kinds) ? recipe.kinds : []) {
    if (!k || typeof k.id !== 'string') continue;
    put({ id: k.id, ...(k.name ? { name: String(k.name) } : {}), group: String(k.group), sketch: String(k.sketch ?? groupSketch(k.group)), camp: String(k.camp ?? 'heap'), line: String(k.line ?? '') });
  }
  for (const p of plantParts) {
    const id = typeof p === 'string' ? p : p?.id;
    if (typeof id !== 'string' || byId.has(id)) continue;
    const k = partKind(id, partGroups);
    if (!k) continue;
    if (typeof p === 'object') { if (p.line) k.line = p.line; if (p.sketch) k.sketch = p.sketch; }
    put(k);
  }

  /** @param {string} id @returns {Kind | null} */
  const find = (id) => byId.get(id) ?? partKind(id, partGroups);
  const LISTED = 100000;
  /** @param {string} id */
  const order = (id) => {
    const k = find(id);
    const gi = k ? groups.indexOf(k.group) : -1;
    const g = gi < 0 ? groups.length : gi;
    return g * (LISTED + 1) + (rank.get(id) ?? LISTED);
  };
  /** @param {string} a @param {string} b */
  const compare = (a, b) => order(a) - order(b) || (a < b ? -1 : a > b ? 1 : 0);

  return {
    list: [...byId.values()],
    byId,
    groups,
    groupOf: (id) => find(id)?.group ?? null,
    order,
    compare,
    sketchOf: (id) => find(id)?.sketch ?? 'plain',
    lineOf: (id) => find(id)?.line ?? '',
    campOf: (id) => find(id)?.camp ?? 'heap',
  };
}

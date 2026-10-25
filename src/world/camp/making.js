// @ts-check
// Making at camp, pure (docs/future/13 sections 3.12 and 6.5; S1). A station's surface holds the
// handfuls laid on it (kinds, nothing taken yet). layout() says which known make they point to, what
// is there and what is missing (the pencil outlines); drawPlan() says where each handful comes from
// when the action is pressed: the pack first, then the camp's piles, then the store (P2j). The cook
// section of the save keeps what was made first and when (the camp page), how many of each, and the
// tools made. Recipes: recipes/world/cook.json.

/**
 * @typedef {{ version: number, made: Record<string, number>, count: Record<string, number>, tools: string[] }} Cook
 *   made: the game hour each thing was first made or built; count: how many; tools: tools made (the shovel)
 * @typedef {{ make: string | null, have: number[], missing: string[][], extra: number[], complete: boolean }} Layout
 *   make: the make shown (null: none uses what is laid); have: for each laid handful, the part it fills
 *   (-1 for none); missing: the kinds that would serve each part not yet laid (the pencil outlines);
 *   extra: laid handfuls the make does not use; complete: every part laid and nothing extra
 */

/**
 * A saved (or new) cook section made safe: firsts by make, counts, tools. Fields this build does not
 * know are kept. @param {any} v @returns {Cook}
 */
export function cleanCook(v) {
  const c = v && typeof v === 'object' && !Array.isArray(v) ? structuredClone(v) : {};
  /** @type {Record<string, number>} */ const made = {};
  for (const [k, h] of Object.entries(c.made && typeof c.made === 'object' ? c.made : {})) if (Number.isFinite(h)) made[k] = /** @type {number} */ (h);
  /** @type {Record<string, number>} */ const count = {};
  for (const [k, n] of Object.entries(c.count && typeof c.count === 'object' ? c.count : {})) if (Number.isInteger(n) && /** @type {number} */ (n) > 0) count[k] = /** @type {number} */ (n);
  const tools = Array.isArray(c.tools) ? [...new Set(c.tools.filter((/** @type {any} */ t) => typeof t === 'string'))] : [];
  return { ...c, version: 1, made, count, tools };
}

/**
 * @typedef {string | string[] | { group: string, shows?: string }} Part a kind, kinds that serve, or any kind of a
 *   group (the apothecary's Dry takes any herb; shows: the kind its pencil outline wears)
 * @typedef {{ filled?: (slot: string) => boolean, groupOf?: (kind: string) => string | null }} MakeCtx
 *   filled: is a camp slot built (a make's `after`); groupOf: a kind's pack group
 */

/** The kinds that serve a part, for its pencil outline. @param {Part} part @returns {string[]} */
export const partKinds = (part) => (Array.isArray(part) ? part : typeof part === 'object' ? [part.shows ?? `@${part.group}`] : [part]);

/** Does a laid kind serve a part? @param {Part} part @param {string} kind @param {MakeCtx} [ctx] */
export const serves = (part, kind, ctx = {}) => (part && typeof part === 'object' && !Array.isArray(part)
  ? !!ctx.groupOf && ctx.groupOf(kind) === part.group : partKinds(part).includes(kind));

/** The makes at a station, in cook.json's order. @param {any} cook recipes/world/cook.json @param {string} station */
export const makesAt = (cook, station) => Object.entries(cook.makes ?? {}).filter(([, m]) => /** @type {any} */ (m).at === station).map(([id]) => id);

/**
 * May this make be made now: under its max, and what it waits for built (after: a camp slot, such as
 * the apothecary bench for the mortar)? @param {any} cook @param {Cook} state @param {string} id @param {MakeCtx} [ctx]
 */
export const open = (cook, state, id, ctx = {}) => (state.count[id] ?? 0) < (cook.makes[id]?.max ?? Infinity)
  && (!cook.makes[id]?.after || !!ctx.filled?.(cook.makes[id].after));

/**
 * Fit laid handfuls to a make's parts: each laid kind fills the first open part that takes it.
 * @param {string[]} laid @param {Part[]} parts @param {MakeCtx} ctx
 */
function fit(laid, parts, ctx) {
  const filled = parts.map(() => false);
  const have = laid.map((k) => {
    const i = parts.findIndex((p, j) => !filled[j] && serves(p, k, ctx));
    if (i >= 0) filled[i] = true;
    return i;
  });
  return { have, filled };
}

/**
 * The make a station shows for what is laid (TR-16): of the open makes there that use at least one
 * laid handful, the one with the most parts present, then the lower tier, then the recipe's order.
 * Nothing laid shows nothing. @param {any} cook @param {string} station @param {string[]} laid
 * @param {Cook} state @param {MakeCtx} [ctx] @returns {Layout}
 */
export function layout(cook, station, laid, state, ctx = {}) {
  const none = { make: null, have: laid.map(() => -1), missing: [], extra: laid.map((_, i) => i), complete: false };
  if (!laid.length) return none;
  let best = null, bestScore = -1;
  for (const id of makesAt(cook, station)) {
    if (!open(cook, state, id, ctx)) continue;
    const m = cook.makes[id], f = fit(laid, m.parts, ctx);
    const used = f.have.filter((i) => i >= 0).length;
    if (!used) continue;
    // More parts present first; then the lower tier (a later make in the file loses a tie).
    const score = used * 100 - (parseInt(String(m.tier ?? 'T9').slice(1), 10) || 9);
    if (score > bestScore) { best = { id, f, m }; bestScore = score; }
  }
  if (!best) return none;
  const missing = best.m.parts.filter((/** @type {any} */ _, /** @type {number} */ j) => !best.f.filled[j]).map(partKinds);
  const extra = best.f.have.map((i, k) => (i < 0 ? k : -1)).filter((k) => k >= 0);
  return { make: best.id, have: best.f.have, missing, extra, complete: !missing.length && !extra.length };
}

/**
 * Where each handful comes from when the action is pressed: for each kind wanted, the first source
 * (in order: the pack, the piles, the store) that still holds one. Null if any is short.
 * @param {string[]} kinds one per handful
 * @param {{ id: string, holds: Record<string, number> }[]} sources in the order they are drawn from
 * @returns {{ kind: string, from: string }[] | null}
 */
export function drawPlan(kinds, sources) {
  const left = sources.map((s) => ({ id: s.id, holds: { ...s.holds } }));
  const out = [];
  for (const k of kinds) {
    const s = left.find((q) => (q.holds[k] ?? 0) > 0);
    if (!s) return null;
    s.holds[k] -= 1;
    out.push({ kind: k, from: s.id });
  }
  return out;
}

/**
 * How many handfuls of each kind there are to lay, across the sources, less what is already laid.
 * @param {{ holds: Record<string, number> }[]} sources @param {string[]} laid
 * @returns {Record<string, number>}
 */
export function available(sources, laid) {
  /** @type {Record<string, number>} */ const n = {};
  for (const s of sources) for (const [k, h] of Object.entries(s.holds)) n[k] = (n[k] ?? 0) + h;
  for (const k of laid) n[k] = (n[k] ?? 0) - 1;
  return n;
}

/**
 * A make (or a build) recorded: its first hour kept, its count up one, a tool added.
 * @param {Cook} state @param {string} id @param {number} hour @param {boolean} [tool]
 * @returns {Cook}
 */
export function recordMade(state, id, hour, tool = false) {
  return { ...state, made: { ...state.made, [id]: state.made[id] ?? hour }, count: { ...state.count, [id]: (state.count[id] ?? 0) + 1 },
    tools: tool && !state.tools.includes(id) ? [...state.tools, id] : state.tools };
}

/**
 * The kinds a build takes, one per handful: [['flat-stones', 2]] gives two flat stones.
 * @param {any} build cook.json builds.<id> @returns {string[]}
 */
export const buildKinds = (build) => (build.parts ?? []).flatMap((/** @type {[string, number]} */ [k, n]) => Array(n).fill(k));

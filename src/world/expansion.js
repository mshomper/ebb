// @ts-check
// Progress (doc 13, docs/future/11): what the island has given you, and when. Two lines feed it:
// the naturalist's notes, a mark for each kind of find you discover, with a reward at some marks
// (recipes/world/naturalist.json); and species gifts, given the first time a species is happy (its
// recipe's `gift`). Both are read from the journal alone, so live play, catch-up and an old save
// give the same: nothing here is counted twice and nothing is ever taken back. What is given is
// merged into the saved unlocks (store slice `unlocks`, `earned`); each gift is written once as a
// journal note of kind 'gift', which the island shows as a quiet card (src/ui/island-notes.js).
//
// The model is pure (naturalistLine, due, grant); createProgress wires it to the store and bus.
// Land pieces (doc 13's tier milestones) will join here when M3 brings the meadow islet.

import { emitDeferred } from '../core/events.js';
import { get, update, subscribe } from '../core/store.js';

/**
 * @typedef {{ id: string, at: number, icon: string, hint: string, page?: string, give?: Record<string, any>, title?: string, line?: string }} Reward
 * @typedef {{ id: string, kind: 'reward'|'gift', give: Record<string, any>, title: string, line: string, icon: string, page: string | null }} Grant
 */

/**
 * The kinds of finds known, in the order you found them (ties keep findOrder).
 * @param {any} journal @param {any} words recipes/world/journal.json
 * @returns {string[]}
 */
export function findsFound(journal, words) {
  const order = words?.findOrder ?? [];
  const sp = journal?.species ?? {};
  return order.filter((/** @type {string} */ id) => sp[id]?.ever)
    .map((/** @type {string} */ id, /** @type {number} */ i) => ({ id, i, first: sp[id].first ?? -1 }))
    .sort((/** @type {any} */ a, /** @type {any} */ b) => a.first - b.first || a.i - b.i)
    .map((/** @type {any} */ e) => e.id);
}

/** Is a reward built yet (does it give anything)? @param {Reward} r */
export const ready = (r) => !!r.give && Object.keys(r.give).length > 0;

/**
 * The line at the top of Small lives, as the journal draws it: an inked mark per find, an inked
 * station after the mark that earned each reward, then pencil gaps only as far as the next reward
 * and that reward in pencil. Never a number. A reward reached but not built yet sits in pencil
 * where it falls, and the gaps lead on to the one after it.
 * @param {string[]} found findsFound
 * @param {Reward[]} rewards naturalist.json rewards
 * @param {Record<string, any>} earned the saved unlocks
 * @returns {({ type: 'mark', id: string } | { type: 'station', id: string, icon: string, inked: boolean, hint: string } | { type: 'gap' })[]}
 */
export function naturalistLine(found, rewards, earned) {
  const sorted = rewards.slice().sort((a, b) => a.at - b.at);
  /** @type {any[]} */ const out = [];
  const station = (/** @type {Reward} */ r) => ({ type: 'station', id: r.id, icon: r.icon, inked: !!earned?.naturalist?.includes(r.id), hint: r.hint });
  let ri = 0;
  for (let n = 1; n <= found.length; n++) {
    out.push({ type: 'mark', id: found[n - 1] });
    while (ri < sorted.length && sorted[ri].at <= n) out.push(station(sorted[ri++]));
  }
  // The next reward ahead: pencil gaps up to it, and it in pencil. Nothing past it.
  const next = sorted[ri];
  if (next) {
    for (let n = found.length + 1; n <= next.at; n++) out.push({ type: 'gap' });
    out.push(station(next));
  }
  return out;
}

/**
 * What is due now and not given yet: rewards whose mark is reached, and the gift of every species
 * the journal knows is happy.
 * @param {{ found: number, flags: string[], earned: Record<string, any>, rewards: Reward[],
 *   gifts: Record<string, { kind: string, id: string }>, words: any, giftWords: any }} p
 *   gifts: each species' gift (its recipe's `gift`); words: journal.json (names); giftWords: naturalist.json gifts
 * @returns {Grant[]}
 */
export function due(p) {
  /** @type {Grant[]} */ const out = [];
  const given = p.earned?.naturalist ?? [];
  for (const r of p.rewards) {
    if (p.found < r.at || given.includes(r.id) || !ready(r)) continue;
    out.push({ id: r.id, kind: 'reward', give: /** @type {any} */ (r.give), title: r.title ?? '', line: r.line ?? '', icon: r.icon, page: r.page ?? null });
  }
  for (const [sp, g] of Object.entries(p.gifts ?? {})) {
    if (!g || !p.flags.includes(`${sp}:happy`) || p.earned?.gifts?.[sp]) continue;
    // Seeds share one set of words; a tool has its own, and its own icon (naturalist.json gifts).
    const seed = g.kind === 'seed';
    const W = seed ? p.giftWords?.seed : p.giftWords?.[g.kind]?.[g.id];
    const fill = (/** @type {string} */ s) => (s ?? '').replace('{species}', lower(p.words?.species?.[sp]?.plural ?? p.words?.species?.[sp]?.name ?? sp))
      .replace('{plant}', lower(p.words?.species?.[g.id]?.name ?? g.id));
    const give = seed ? { seeds: { [g.id]: true } } : { [g.id]: true };
    const icon = (seed ? p.words?.species?.[g.id]?.icon : W?.icon) ?? 'find';
    out.push({ id: sp, kind: 'gift', give, title: fill(W?.title), line: fill(W?.line), icon, page: sp });
  }
  return out;
}

/** @param {string} s */
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * The saved unlocks with a grant merged in, for good. Pure: a new object.
 * @param {Record<string, any>} earned @param {Grant} g
 */
export function grant(earned, g) {
  const e = structuredClone(earned ?? {});
  for (const [k, v] of Object.entries(g.give)) {
    e[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...(e[k] ?? {}), ...v } : v;
  }
  if (g.kind === 'reward') e.naturalist = [...(e.naturalist ?? []), g.id];
  else e.gifts = { ...(e.gifts ?? {}), [g.id]: true };
  return e;
}

/**
 * Live: watches the journal, and when something is due, gives it (store slice `unlocks`) and says
 * so (`progress:gifted`, which the journal writes as a note and the island shows as a card).
 * @param {{ words: any, recipe: any, gifts: Record<string, { kind: string, id: string }> }} opts
 *   words: journal.json; recipe: naturalist.json; gifts: each species' gift, by journal id
 * @returns {{ line: () => ReturnType<typeof naturalistLine>, dispose: () => void }}
 */
export function createProgress(opts) {
  const { words, recipe } = opts;
  function check() {
    const journal = get('journal');
    if (!journal) return;
    const u = get('unlocks') ?? {};
    const grants = due({ found: findsFound(journal, words).length, flags: journal.flags ?? [], earned: u.earned ?? {},
      rewards: recipe.rewards, gifts: opts.gifts, words, giftWords: recipe.gifts });
    if (!grants.length) return;
    let earned = u.earned ?? {};
    for (const g of grants) earned = grant(earned, g);
    // What is earned shows at once; test switches (?sandbox, ?cliffs, ?stones) stay as they were.
    update('unlocks', (/** @type {any} */ v) => ({ ...v, ...earned, springs: !!earned.springs || !!v?.springs,
      cliffs: !!earned.cliffs || !!v?.cliffs, stones: !!earned.stones || !!v?.stones, earned }));
    for (const g of grants) emitDeferred('progress:gifted', g);
  }
  const off = subscribe('journal', check);
  check();
  return {
    line: () => naturalistLine(findsFound(get('journal'), words), recipe.rewards, get('unlocks')?.earned ?? {}),
    dispose: off,
  };
}

// @ts-check
// Progress (doc 13, docs/future/11): what the island has given you, and when. Three lines feed it:
// the naturalist's notes, a mark for each kind of find you discover, with a reward at some marks
// (recipes/world/naturalist.json); species gifts (its recipe's `gift`), given the first time one of
// that species comes to know you: a frog or a turtle named, a school of minnows or the dragonflies
// trusting you to presence.knownTrust (the journal flag `<species>:known`; Matt, October 27, 2026;
// before then a gift came when the species was first happy, and a save that had one keeps it); and
// the beachcomber's trail (recipes/world/beachcomber.json), its stops reached
// by the firsts in the saved unlocks (src/world/trails.js: families and rarities kept, marks seen),
// and the forager's (recipes/world/forager.json, src/world/forager.js: plants and seasons gathered).
// The first two are read from the journal alone, so live play, catch-up and an old save
// give the same: nothing here is counted twice and nothing is ever taken back. What is given is
// merged into the saved unlocks (store slice `unlocks`, `earned`); each gift is written once as a
// journal note of kind 'gift', which the island shows as a quiet card (src/ui/island-notes.js).
//
// The model is pure (naturalistLine, due, grant); createProgress wires it to the store and bus.
// Land pieces (doc 13's tier milestones): milestoneReached says when a tier's land is earned (the
// meadow islet, src/world/islet); a species being happy (`<species>:happy`) counts only toward those.

import { emitDeferred } from '../core/events.js';
import { get, update, subscribe } from '../core/store.js';
import { counts, reached, trailLine, firstsOf } from './trails.js';
import { forageLineFirsts } from './forager.js';

/**
 * @typedef {{ id: string, at: number, icon: string, hint: string, page?: string, give?: Record<string, any>, title?: string, line?: string }} Reward
 * @typedef {{ id: string, kind: 'reward'|'gift'|'stop'|'forage', give: Record<string, any>, title: string, line: string, icon: string, page: string | null, trail?: string }} Grant
 *   forage: a stop on the forager's trail; its card and note open that trail (trail 'forage')
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
 * @param {(id: string) => number} [firstOf] the game hour a kind of find was first found (layer marks fall in by hour)
 * @returns {({ type: 'mark', id: string } | { type: 'layer', id: string, hour: number } | { type: 'station', id: string, icon: string, inked: boolean, hint: string } | { type: 'gap' })[]}
 */
export function naturalistLine(found, rewards, earned, firstOf = () => Infinity) {
  const sorted = rewards.slice().sort((a, b) => a.at - b.at);
  /** @type {any[]} */ const out = [];
  const station = (/** @type {Reward} */ r) => ({ type: 'station', id: r.id, icon: r.icon, inked: !!earned?.naturalist?.includes(r.id), hint: r.hint });
  // Layers dug for the first time (src/world/dig) show on the line in the order they came, but never
  // count toward its rewards (the orchestrator's call, Matt OK'd, October 24, 2026).
  const layers = (earned?.firsts ?? []).filter((/** @type {any} */ f) => f.trail === 'nature' && f.kind === 'layer').slice().sort((/** @type {any} */ a, /** @type {any} */ b) => a.hour - b.hour);
  let li = 0;
  const layersBefore = (/** @type {number} */ hour) => { while (li < layers.length && layers[li].hour < hour) { out.push({ type: 'layer', id: layers[li].id, hour: layers[li].hour }); li++; } };
  let ri = 0;
  for (let n = 1; n <= found.length; n++) {
    layersBefore(firstOf(found[n - 1]));
    out.push({ type: 'mark', id: found[n - 1] });
    while (ri < sorted.length && sorted[ri].at <= n) out.push(station(sorted[ri++]));
  }
  layersBefore(Infinity);
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
 * the journal knows has come to know you (`<species>:known`).
 * @param {{ found: number, flags: string[], earned: Record<string, any>, rewards: Reward[],
 *   gifts: Record<string, { kind: string, id: string }>, words: any, giftWords: any, stops?: Reward[], forage?: Reward[], stone?: boolean }} p
 *   gifts: each species' gift (its recipe's `gift`); words: journal.json (names); giftWords: naturalist.json gifts;
 *   stops: the beachcomber's (beachcomber.json), each reached when its need is met by the firsts
 *   (src/world/trails.js; families kept before the firsts were written count too); forage: the
 *   forager's (forager.json), each reached by the forager's firsts; stone: the gift stone stands at
 *   camp (B1 C1), so a gift for the gift spot is laid there first and its words say so (stoneLine)
 * @returns {Grant[]}
 */
export function due(p) {
  /** @type {Grant[]} */ const out = [];
  const given = p.earned?.naturalist ?? [];
  for (const r of p.rewards) {
    if (p.found < r.at || given.includes(r.id) || !ready(r)) continue;
    out.push({ id: r.id, kind: 'reward', give: /** @type {any} */ (r.give), title: r.title ?? '', line: r.line ?? '', icon: r.icon, page: r.page ?? null });
  }
  const c = counts(p.earned?.firsts ?? [], p.earned?.kept ?? []), stopped = p.earned?.beachcomber ?? [];
  for (const r of /** @type {any[]} */ (p.stops ?? [])) {
    if (!reached(r.need ?? {}, c) || stopped.includes(r.id) || !ready(r)) continue;
    out.push({ id: r.id, kind: 'stop', give: /** @type {any} */ (r.give), title: r.title ?? '', line: r.line ?? '', icon: r.icon, page: r.page ?? null });
  }
  const foraged = p.earned?.forager ?? [];
  for (const r of /** @type {any[]} */ (p.forage ?? [])) {
    if (!reached(r.need ?? {}, c) || foraged.includes(r.id) || !ready(r)) continue;
    out.push({ id: r.id, kind: 'forage', give: /** @type {any} */ (r.give), title: r.title ?? '', line: r.line ?? '', icon: r.icon, page: null, trail: 'forage' });
  }
  for (const [sp, g] of Object.entries(p.gifts ?? {})) {
    if (!g || !p.flags.includes(`${sp}:known`) || p.earned?.gifts?.[sp]) continue;
    // Seeds share one set of words; a tool has its own, and its own icon (naturalist.json gifts).
    const seed = g.kind === 'seed';
    const W = seed ? p.giftWords?.seed : p.giftWords?.[g.kind]?.[g.id];
    const fill = (/** @type {string} */ s) => (s ?? '').replace('{species}', lower(p.words?.species?.[sp]?.plural ?? p.words?.species?.[sp]?.name ?? sp))
      .replace('{plant}', lower(p.words?.species?.[g.id]?.name ?? g.id));
    const give = seed ? { seeds: { [g.id]: true } } : { [g.id]: true };
    const icon = (seed ? p.words?.species?.[g.id]?.icon : W?.icon) ?? 'find';
    out.push({ id: sp, kind: 'gift', give, title: fill(W?.title), line: fill(p.stone && W?.stoneLine ? W.stoneLine : W?.line), icon, page: sp });
  }
  return out;
}

/** @param {string} s */
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * A tier milestone (doc 13): reached once `need` of its species are happy (their journal flags,
 * `<species>:happy`, set for good). The meadow islet reads the first (recipes/land/meadow-islet.json
 * milestone, src/world/islet). @param {string[]} flags @param {{ flags: string[], need: number }} m
 */
export function milestoneReached(flags, m) {
  return m.flags.filter((f) => flags.includes(f)).length >= m.need;
}

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
  else if (g.kind === 'stop') e.beachcomber = [...(e.beachcomber ?? []), g.id];
  else if (g.kind === 'forage') e.forager = [...(e.forager ?? []), g.id];
  else e.gifts = { ...(e.gifts ?? {}), [g.id]: true };
  return e;
}

/**
 * The saved unlocks with a keepsake family noted as kept, for good (the beachcomber's trail counts
 * families ever kept, so letting one go takes nothing back). Pure: the same object if already noted.
 * @param {Record<string, any>} earned @param {string} family
 */
export function keptFamily(earned, family) {
  const kept = earned?.kept ?? [];
  if (!family || kept.includes(family)) return earned ?? {};
  return { ...(earned ?? {}), kept: [...kept, family] };
}

/**
 * Live: watches the journal, and when something is due, gives it (store slice `unlocks`) and says
 * so (`progress:gifted`, which the journal writes as a note and the island shows as a card).
 * @param {{ words: any, recipe: any, gifts: Record<string, { kind: string, id: string }>, beachcomber?: any, shaper?: any, forager?: any, stone?: () => boolean }} opts
 *   words: journal.json; recipe: naturalist.json; gifts: each species' gift, by journal id;
 *   beachcomber: beachcomber.json (its stops); shaper: shaper.json (its stops); forager: forager.json (its stops);
 *   stone: whether the camp's gift stone stands (B1 C1)
 * @returns {{ line: () => ReturnType<typeof naturalistLine>, beachLine: () => import('./trails.js').TrailEntry[],
 *   shapeLine: () => import('./trails.js').TrailEntry[], forageLine: () => import('./trails.js').TrailEntry[], dispose: () => void }}
 */
export function createProgress(opts) {
  const { words, recipe } = opts;
  function check() {
    const journal = get('journal');
    if (!journal) return;
    const u = get('unlocks') ?? {};
    const grants = due({ found: findsFound(journal, words).length, flags: journal.flags ?? [], earned: u.earned ?? {},
      rewards: recipe.rewards, gifts: opts.gifts, words, giftWords: recipe.gifts, stops: opts.beachcomber?.stops, forage: opts.forager?.stops, stone: !!opts.stone?.() });
    if (!grants.length) return;
    let earned = u.earned ?? {};
    for (const g of grants) earned = grant(earned, g);
    // What is earned shows at once; test switches (?sandbox, ?cliffs, ?stones) stay as they were.
    update('unlocks', (/** @type {any} */ v) => ({ ...v, ...earned, springs: !!earned.springs || !!v?.springs,
      cliffs: !!earned.cliffs || !!v?.cliffs, stones: !!earned.stones || !!v?.stones,
      nets: { ...(v?.nets ?? {}), ...(earned.nets ?? {}) }, earned }));
    for (const g of grants) emitDeferred('progress:gifted', g);
  }
  // A keepsake kept (its family noted in the unlocks) can reach a beachcomber's stop.
  const offs = [subscribe('journal', check), subscribe('unlocks', check)];
  check();
  return {
    line: () => { const j = get('journal'); return naturalistLine(findsFound(j, words), recipe.rewards, get('unlocks')?.earned ?? {}, (id) => j?.species?.[id]?.first ?? -1); },
    beachLine: () => { const e = get('unlocks')?.earned ?? {}; return trailLine(firstsOf(e, 'beach'), opts.beachcomber?.stops ?? [], e.beachcomber ?? [], e.kept ?? []); },
    shapeLine: () => { const e = get('unlocks')?.earned ?? {}; return trailLine(firstsOf(e, 'shape'), opts.shaper?.stops ?? [], []); },
    forageLine: () => { const e = get('unlocks')?.earned ?? {}; return trailLine(forageLineFirsts(e), opts.forager?.stops ?? [], e.forager ?? []); },
    dispose: () => { for (const off of offs) off(); },
  };
}

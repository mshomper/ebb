// @ts-check
// The forager's trail (doc 13 "Trails", P2k; recipes/world/forager.json). Pure. What you gather is
// written as firsts in the saved unlocks (src/world/trails.js, trail 'forage'): the first handful of
// each plant, of each part ('<species>.<part>', for the almanac only) and in each season; the first
// seed of each plant saved will join when seed saving comes (P2g). The gathering knife changes how
// you gather, never where a plant can grow: a picked plant is ready again sooner and looks less bare.

import { addFirst, firstsOf } from './trails.js';
import { windowsOf } from './gather/plants.js';

/** The seasons a first can name, in the order of the world's season index. */
export const SEASON_KEYS = /** @type {const} */ (['spring', 'summer', 'autumn', 'winter']);

/**
 * The firsts a picked handful brings: its plant, its part and the season it was picked in.
 * @param {string} sp @param {string} part @param {number} season the world's season index (0 spring)
 * @param {number} hour @returns {import('./trails.js').First[]}
 */
export function pickedFirsts(sp, part, season, hour) {
  const s = SEASON_KEYS[((Math.floor(season) % 4) + 4) % 4];
  return [
    { trail: 'forage', kind: 'plant', id: sp, hour },
    { trail: 'forage', kind: 'part', id: `${sp}.${part}`, hour },
    { trail: 'forage', kind: 'season', id: s, hour },
  ];
}

/** The saved unlocks with a picked handful's firsts written (each once, for good). @param {Record<string, any>} earned @param {import('./trails.js').First[]} fs */
export function noteFirsts(earned, fs) {
  let e = earned;
  for (const f of fs) e = addFirst(e, f);
  return e;
}

/** The forager's firsts the trail line shows (parts feed the almanac only). @param {Record<string, any>} earned */
export const forageLineFirsts = (earned) => firstsOf(earned, 'forage').filter((f) => f.kind !== 'part');

/** Has the forager's trail given this stop? @param {Record<string, any>} earned @param {string} id */
export const hasForage = (earned, id) => !!earned?.forage?.[id];

/**
 * The gather recipe as the knife leaves it: every part ready again at knife.readyShare of its best
 * (where its own share is higher) and a picked plant drawn bareLook as bare. Without the knife, the
 * recipe itself. A new object; the recipe given is not changed.
 * @param {any} gather gather.json @param {{ readyShare: number, bareLook: number } | null} knife
 */
export function knifed(gather, knife) {
  if (!knife || !gather?.plants) return gather;
  const P = gather.plants;
  const cap = (/** @type {number | undefined} */ v) => (v === undefined ? v : Math.min(v, knife.readyShare));
  const defaults = Object.fromEntries(Object.entries(P.defaults ?? {}).map(([k, d]) => [k, { ...d, readyShare: cap(/** @type {any} */ (d).readyShare) ?? knife.readyShare }]));
  const parts = Object.fromEntries(Object.entries(P.parts ?? {}).map(([k, p]) => {
    const q = /** @type {any} */ (p);
    return [k, q.readyShare === undefined ? q : { ...q, readyShare: cap(q.readyShare) }];
  }));
  return { ...gather, plants: { ...P, defaults, parts, bareLook: knife.bareLook } };
}

/**
 * The herbarium's sprigs: one per plant gathered, in the order first gathered, each with the parts
 * of it you have gathered. @param {Record<string, any>} earned
 * @returns {{ sp: string, hour: number, parts: string[] }[]} parts as '<species>.<part>'
 */
export function sprigs(earned) {
  const fs = firstsOf(earned, 'forage');
  return fs.filter((f) => f.kind === 'plant').map((f) => ({
    sp: f.id, hour: f.hour,
    parts: fs.filter((p) => p.kind === 'part' && p.id.startsWith(`${f.id}.`)).map((p) => p.id),
  }));
}

/**
 * The almanac's arcs: each part gathered, with the windows of the year it is ready in (season
 * positions 0 spring .. 4, as gather.json). Parts never gathered are not there at all.
 * @param {Record<string, any>} earned @param {any} gather gather.json
 * @returns {{ id: string, windows: number[][] }[]}
 */
export function almanacArcs(earned, gather) {
  return firstsOf(earned, 'forage').filter((f) => f.kind === 'part').map((f) => {
    const P = gather?.plants?.parts?.[f.id];
    return { id: f.id, windows: P ? windowsOf(P.window ?? [0, 4]) : [[0, 4]] };
  });
}

/**
 * The ?forager test link's unlocks: four plants gathered over a year, so the herbarium, the knife
 * and the almanac are reached. Pure. @param {Record<string, any>} earned
 */
export function sampleForager(earned) {
  const at = (/** @type {number} */ d, /** @type {number} */ h) => d * 24 + h;
  /** @type {[string, string, number, number][]} */ const picks = [
    ['nettle', 'tops', 0, at(2, 10)], ['watermint', 'leaves', 1, at(16, 9)], ['chamomile', 'flowers', 1, at(20, 15)],
    ['reeds', 'down', 2, at(31, 11)], ['nettle', 'tops', 2, at(33, 8)], ['willow', 'withies', 3, at(45, 14)],
  ];
  let e = earned ?? {};
  for (const [sp, part, season, hour] of picks) e = noteFirsts(e, pickedFirsts(sp, part, season, hour));
  return e;
}

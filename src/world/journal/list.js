// @ts-check
// The journal's Living things list, tidied as it grows: groups that fold shut, filter chips (all,
// found, not yet; and by place) and a sort (recently found, A to Z, by place). Pure; the groups,
// places and words are in recipes/world/journal-list.json ("list"). Small lives list only what you
// have found, and nothing anywhere shows a count.

import { isAnimal } from './observe.js';

/**
 * @typedef {{ shut: Record<string, boolean>, status: 'all'|'found'|'notYet', place: string | null, sort: 'recent'|'az'|'place' }} ListChoice
 * @typedef {{ id: string, known: boolean, name: string, pencil?: boolean }} ListEntry pencil: not found, but hinted (a fish glimpsed in a net)
 */

/** The choice on a new device. @type {ListChoice} */
export const DEFAULT_CHOICE = { shut: {}, status: 'all', place: null, sort: 'recent' };

/** A kept choice made safe to use (the recipe may have changed since). @param {any} c @param {any} list @returns {ListChoice} */
export function cleanChoice(c, list) {
  const o = c && typeof c === 'object' ? c : {};
  return {
    shut: o.shut && typeof o.shut === 'object' ? { ...o.shut } : {},
    status: o.status in list.filters ? o.status : 'all',
    place: o.place in list.places ? o.place : null,
    sort: o.sort in list.sorts ? o.sort : 'recent',
  };
}

/**
 * The pages each group holds, in the recipe's order; groups with none left out.
 * @param {any} list @param {any} words @returns {{ group: any, ids: string[] }[]}
 */
export function groupsOf(list, words) {
  const named = new Set(list.groups.flatMap((/** @type {any} */ g) => g.ids ?? []));
  /** @type {Record<string, string[]>} */
  const from = {
    plants: words.order.filter((/** @type {string} */ id) => !isAnimal(words.species[id])),
    animals: words.order.filter((/** @type {string} */ id) => isAnimal(words.species[id])),
    finds: words.findOrder ?? [],
    // The island's fish (docs/future/17), written from its roster when it loads (src/world/fishing/pages.js).
    fish: words.fishOrder ?? [],
  };
  return list.groups.map((/** @type {any} */ g) => ({
    group: g,
    ids: [...(g.ids ?? []), ...(g.from ? from[g.from] ?? [] : []).filter((id) => !named.has(id))].filter((id) => !!words.species[id]),
  })).filter((/** @type {{ ids: string[] }} */ x) => x.ids.length);
}

/** A page's place. @param {any} list @param {any} group @param {string} id */
export const placeOf = (list, group, id) => list.placeOf[id] ?? group.place ?? null;

/**
 * The list as the page shows it: each group with its rows after the filter and sort, whether it is
 * shut, and the pencil line it shows when it has no rows.
 * @param {any} list @param {any} words @param {ListChoice} choice
 * @param {(id: string) => ListEntry} entry what the page knows of each id
 * @param {(id: string) => number} first the hour each was first seen (-1 never)
 * @param {Record<string, any> | null} [unlocks] what the island has given (world/expansion.js): a
 *   group with `unlock` (Shells) stays out of the list until it is given, unless something in it is found
 */
export function livingList(list, words, choice, entry, first, unlocks = null) {
  const order = Object.keys(list.places);
  return groupsOf(list, words).flatMap(({ group, ids }) => {
    let rows = ids.map(entry);
    const anyFound = rows.some((r) => r.known);
    if (group.unlock && unlocks && !unlocks[group.unlock] && !anyFound) return [];
    // Small lives never list what is still to find; a fish glimpsed in a net shows in pencil (F17).
    if (group.foundOnly) rows = rows.filter((r) => r.known || r.pencil);
    if (choice.status === 'found') rows = rows.filter((r) => r.known);
    if (choice.status === 'notYet') rows = rows.filter((r) => !r.known);
    if (choice.place) rows = rows.filter((r) => placeOf(list, group, r.id) === choice.place);
    const az = (/** @type {ListEntry} */ p, /** @type {ListEntry} */ q) => Number(!p.known) - Number(!q.known) || p.name.localeCompare(q.name);
    const by = {
      recent: (/** @type {ListEntry} */ p, /** @type {ListEntry} */ q) => Number(!p.known) - Number(!q.known) || first(q.id) - first(p.id) || ids.indexOf(p.id) - ids.indexOf(q.id),
      az,
      place: (/** @type {ListEntry} */ p, /** @type {ListEntry} */ q) => {
        const a = order.indexOf(placeOf(list, group, p.id) ?? ''), b = order.indexOf(placeOf(list, group, q.id) ?? '');
        return (a < 0 ? 99 : a) - (b < 0 ? 99 : b) || az(p, q);
      },
    };
    rows = rows.slice().sort(by[choice.sort] ?? by.recent);
    const hint = rows.length ? null : group.foundOnly && !anyFound ? (group.hint ?? words.smallLives?.none ?? list.empty) : list.empty;
    return [{ id: group.id, label: group.label, tint: group.tint, icon: group.icon ?? null, shut: !!choice.shut[group.id], rows: rows.map((r) => r.id), hint,
      foundOnly: !!group.foundOnly, many: !!group.from }];
  });
}

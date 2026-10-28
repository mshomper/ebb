// @ts-check
// One turtle's own trust and name inside its group (docs 12, 13 section 8; October 27, 2026). Turtles
// live as a group per pool (swarms.js), and the group's trust is what watching them earns. Each
// turtle knows you at least that well, and the one that takes a treat from you knows you that much
// better again: its trust is the group's plus its own share (`own`), which only treats it ate add
// to, once a game day each (as the group's). One that knows you well enough (presence.namingTrust)
// can be named, and keeps its name across saves and catch-up.
//
// A turtle is known by its group and its place in it: id = group id x 1000 + its index, the same
// number the live turtles are drawn with (schools.js). The group's state keeps a bond only for a
// turtle that has had a treat or a name (`bonds`), so a save with none reads as before. Pure and
// worker-safe.

import { maxTrust, treatGain } from './trust.js';

/**
 * @typedef {{ id: number, own: number, treatDay?: number, name?: string, namedAt?: number }} Bond
 *   own: trust from treats it ate itself, on top of its group's; treatDay: the game day it last had
 *   one; name, namedAt: what you called it, and the game hour you did
 */

/** Rounded to four places, as trust is kept. @param {number} v */
const r4 = (v) => Math.round(v * 10000) / 10000;

/** A turtle's id from its group and its place in it. @param {number} group @param {number} i */
export const turtleId = (group, i) => group * 1000 + i;

/** The group a turtle's id belongs to. @param {number} id */
export const groupOfTurtle = (id) => Math.floor(id / 1000);

/** A turtle's bond, if it has one. @param {any} S the group's state @param {number} id @returns {Bond | undefined} */
export const bondOf = (S, id) => (S?.bonds ?? []).find((/** @type {Bond} */ b) => b.id === id);

/**
 * How well one turtle knows you: its group's trust and its own share, never past the ceiling.
 * @param {any} S state.creatures.turtles @param {number} id @param {any} P the recipe's presence
 */
export function turtleTrust(S, id, P) {
  return r4(Math.min(maxTrust(P), (S?.trust ?? 0) + (bondOf(S, id)?.own ?? 0)));
}

/**
 * Each turtle that ate a treat gains its own share (applySwarmTrust calls this for a treat event
 * naming who ate it): what the treat earns, once a game day per turtle. Changes S in place.
 * @param {any} S @param {any} P @param {number[]} who turtle ids @param {number} hour @param {string} [treat]
 * @param {number} [boost] a tea boon's multiplier (P2e)
 */
export function bondTreat(S, P, who, hour, treat, boost = 1) {
  const bonds = (S.bonds ?? []).map((/** @type {Bond} */ b) => ({ ...b }));
  for (const id of who) {
    let b = bonds.find((/** @type {Bond} */ x) => x.id === id);
    if (!b) { b = { id, own: 0 }; bonds.push(b); }
    const g = treatGain(P, b.treatDay, hour, treat);
    b.own = r4(Math.min(maxTrust(P), b.own + g.gain * boost));
    b.treatDay = g.day;
  }
  S.bonds = bonds;
}

/**
 * Give a turtle a name. Pure: a new state, or the same one if it cannot be named (no such group,
 * already named).
 * @param {any} state @param {number} id @param {string} name already clean @param {number} hour
 */
export function nameTurtle(state, id, name, hour) {
  const S = state?.creatures?.turtles;
  if (!S || !name || !S.groups?.some((/** @type {any} */ g) => g.id === groupOfTurtle(id)) || bondOf(S, id)?.name) return state;
  const had = bondOf(S, id);
  const bonds = had ? S.bonds.map((/** @type {Bond} */ b) => (b.id === id ? { ...b, name, namedAt: hour } : b))
    : [...(S.bonds ?? []), { id, own: 0, name, namedAt: hour }];
  return { ...state, creatures: { ...state.creatures, turtles: { ...S, bonds } } };
}

/** The named turtles, oldest name first. @param {any} S @returns {Bond[]} */
export const namedTurtles = (S) => (S?.bonds ?? []).filter((/** @type {Bond} */ b) => b.name).sort((/** @type {Bond} */ a, /** @type {Bond} */ b) => (a.namedAt ?? 0) - (b.namedAt ?? 0));

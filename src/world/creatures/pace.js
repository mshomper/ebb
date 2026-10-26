// @ts-check
// Friendship pace (P2h, docs/future/13 section 8.6): how a creature's trust grows over played days
// for a keeper who keeps the same habit each day. Each day's habit becomes the trust events live play
// records (watched stretches capped at watch.capS, meals fullH apart, a treat) and the game's own
// rules apply them: applyTrust (trust.js) for a frog, applySwarmTrust (swarms.js) for a school or
// swarm. For tools/trust-lab.html and the tests; the game never calls it. Pure.

import { TRUST_WORDS, applyTrust } from './trust.js';
import { applySwarmTrust } from './swarms.js';
import { HOURS_PER_DAY } from '../../core/clock.js';

/**
 * @typedef {Object} Habit  what the keeper does on each played day
 * @property {number} sitMin    real minutes sitting near it (each counts watch.sitBoost)
 * @property {number} standMin  real minutes standing near it
 * @property {number} feeds     meals offered, fullH game hours apart
 * @property {boolean} treat    a treat it likes, set out once
 * @property {number} [boost]   a tea boon's multiplier on every gain (1 without one)
 */

/** The hour of the day the keeper's visit starts. */
const VISIT_H = 8;

/**
 * Trust at the end of each played day from nothing, and the played day (fractional, gains spread
 * evenly through the day) each word after Wary is first reached; words past the ceiling are absent.
 * @param {any} rec the species recipe @param {Habit} h @param {number} [days]
 * @returns {{ trust: number[], at: Record<string, number> }}
 */
export function paceCurve(rec, h, days = 14) {
  const P = rec.presence, W = P.watch ?? {};
  const swarm = rec.ecology?.kind === 'swarm';
  const fullH = (swarm ? P.fullH : rec.feed?.fullH) ?? 6;
  const counted = h.sitMin * (W.sitBoost ?? 1) + h.standMin, cap = (W.capS ?? 600) / 60;
  const canFeed = (P.feedTrust ?? 0) > 0, canTreat = (P.treatFeeds ?? 0) > 0;
  /** @type {any} */ const fr = { frogs: [{ id: 1, x: 0, z: 0, trust: 0 }], pending: [] };
  /** @type {any} */ const S = { trust: 0 };
  /** @type {number[]} */ const trust = [0];
  for (let d = 0; d < days; d++) {
    const h0 = d * HOURS_PER_DAY + VISIT_H;
    /** @type {any[]} */ const evs = [];
    for (let left = counted, i = 0; left > 1e-9; left -= cap, i++) evs.push({ kind: 'watched', id: 1, minutes: Math.min(left, cap), hour: h0 + i });
    if (canFeed) for (let i = 0; i < h.feeds; i++) evs.push({ kind: 'fed', id: 1, hour: h0 + i * fullH });
    if (canTreat && h.treat) evs.push({ kind: 'treat', id: 1, hour: h0 + 1, treat: 'lab' });
    if (swarm) { S.pending = evs; applySwarmTrust(S, P, 'lab', h.boost ?? 1); trust.push(S.trust ?? 0); }
    else { fr.pending = evs; applyTrust(fr, P, 0, fullH, h.boost ?? 1); trust.push(fr.frogs[0].trust); }
  }
  /** @type {Record<string, number>} */ const at = {};
  P.bands.forEach((/** @type {number} */ b, /** @type {number} */ i) => {
    const d = trust.findIndex((t) => t >= b);
    if (d > 0) at[TRUST_WORDS[i + 1]] = d - 1 + (b - trust[d - 1]) / Math.max(1e-9, trust[d] - trust[d - 1]);
  });
  return { trust, at };
}

/** The top word a species can reach (its ceiling). @param {any} rec */
export const topWord = (rec) => /** @type {string} */ (rec.presence.ceiling ?? 'bonded');

/**
 * Played days to the top word, or Infinity if it is not reached within `days`.
 * @param {any} rec @param {Habit} h @param {number} [days]
 */
export const daysToTop = (rec, h, days = 60) => paceCurve(rec, h, days).at[topWord(rec)] ?? Infinity;

// @ts-check
// Letters in bottles (docs/future/12): which letter a bottle's message turns out to be, chosen when
// it is first read (not when the bottle is rolled), because some letters answer others: a reply
// comes only once the letter it answers has been read, so the player sees a thread they helped
// connect. Pure: the same bottle, season, island age and letters read give the same letter.
// recipes/world/bottle-messages.json holds the letters.

import { hash32 } from '../../core/rng.js';

/**
 * @typedef {{ id: string, title: string, form: string, rarity: string, season: string,
 *   after: string | null, lateGame: boolean, preface: string[], body: string[] }} Letter
 * @typedef {{ rarity: string, season: string, hour: number, read: string[] }} LetterContext
 *   rarity: the bottle's tier; season: the season of the tide that left it; hour: the island's game
 *   hour now; read: the ids of letters already read
 */

/**
 * The letters this bottle could hold: its rarity or below, its season or any, replies only after
 * what they answer, late ones only on an old island.
 * @param {LetterContext} ctx @param {any} M bottle-messages.json @param {string[]} order rarity order
 * @returns {Letter[]}
 */
export function eligibleLetters(ctx, M, order) {
  const tier = Math.max(0, order.indexOf(ctx.rarity));
  const read = new Set(ctx.read);
  return (M.letters ?? []).filter((/** @type {Letter} */ l) =>
    order.indexOf(l.rarity) <= tier
    && (l.season === 'any' || l.season === ctx.season)
    && (!l.after || read.has(l.after))
    && (!l.lateGame || ctx.hour >= (M.lateGameDays ?? 56) * 24));
}

/**
 * The letter a bottle holds, by its own number (n.messageIndex). Unread letters come first; once
 * every one it could hold has been read, it holds one of those again.
 * @param {number} index the bottle's messageIndex @param {LetterContext} ctx @param {any} M
 * @param {string[]} order @returns {Letter | null}
 */
export function chooseLetter(index, ctx, M, order) {
  const all = eligibleLetters(ctx, M, order);
  if (!all.length) return null;
  const read = new Set(ctx.read);
  const fresh = all.filter((l) => !read.has(l.id));
  const pool = fresh.length ? fresh : all;
  // A reply that has just become possible is the likeliest letter: threads should close.
  const replies = pool.filter((l) => l.after);
  const from = replies.length && (hash32(index, 7) & 3) !== 0 ? replies : pool;
  return from[hash32(index, 11) % from.length];
}

/** A letter by id. @param {string} id @param {any} M @returns {Letter | null} */
export const letterById = (id, M) => (M.letters ?? []).find((/** @type {Letter} */ l) => l.id === id) ?? null;

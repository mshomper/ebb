// @ts-check
// The composer names the pieces it grows (doc 24, Naming): a title drawn from the word lists in
// recipes/music/names.json by the piece's seed, season and slot, so the same piece always has the
// same name and a player can find it again. Swap the lists to change every name; nothing else
// depends on them. Pure and deterministic (src/core/rng.js), never Math.random.

import { stream, hash32 } from '../../core/rng.js';

const SMALL = new Set(['a', 'an', 'and', 'the', 'by', 'over', 'for', 'of', 'at', 'in', 'on', 'across', 'beneath', 'beyond', 'along']);

/** @param {string} s */
function strHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = hash32(h, s.charCodeAt(i));
  return h;
}

/**
 * A name for a grown piece.
 * @param {number} seed the piece's seed
 * @param {{season: string, slot: string}} where
 * @param {any} recipe recipes/music/names.json
 * @returns {string}
 */
export function pieceName(seed, where, recipe) {
  const r = stream(seed >>> 0, 0x6e61, strHash(`${where.season}:${where.slot}`));
  const W = recipe.words;
  const avoid = new Set((recipe.avoid ?? []).map((/** @type {string} */ w) => w.toLowerCase()));
  const used = new Set();
  /** @param {string} key */
  const pick = (key) => {
    // Seasonal and slot words count seasonWeight times, so names lean to the season.
    const w = recipe.seasonWeight ?? 2;
    /** @type {string[]} */
    const pool = [...(W.common?.[key] ?? [])];
    for (const extra of [W[where.season]?.[key], W.slots?.[where.slot]?.[key]]) for (const x of extra ?? []) for (let k = 0; k < w; k++) pool.push(x);
    const ok = pool.filter((x) => !used.has(x) && !avoid.has(x.toLowerCase()));
    const list = ok.length ? ok : pool;
    if (!list.length) return '';
    const word = list[Math.floor(r.next() * list.length)];
    used.add(word);
    return word;
  };
  // Draw templates until one can be filled (a slot without 'when' words skips that template).
  const templates = [...recipe.templates];
  for (let tries = 0; tries < 8; tries++) {
    const t = templates[Math.floor(r.next() * templates.length)];
    let ok = true;
    const text = t.replace(/\{(\w+)\}/g, (/** @type {string} */ _m, /** @type {string} */ key) => {
      const w = pick(key);
      if (!w) ok = false;
      return w;
    });
    if (ok) return titleCase(text);
  }
  return 'Untitled';
}

/** Title case, keeping small words lower except first. @param {string} s */
export function titleCase(s) {
  return s.split(' ').map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}

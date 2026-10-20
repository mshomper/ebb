// @ts-check
// The development engine's judge for harmony (phase 4a; the full critic of doc 24 grows from this in
// 4c): scores a walked progression so the engine can keep the best of its candidates. Higher is
// better. A banned loop (such as I V vi IV) rules a candidate out. Every term is in
// recipes/music/develop.json "score", and the lab shows each term so Matt can see why one won.

import { changes } from './harmony.js';

/**
 * @param {any} material @param {any} rules recipes/music/develop.json
 * @param {{bars: import('./harmony.js').HBar[], forced: number}} walked
 * @returns {{total: number, banned: boolean, terms: Record<string, number>}}
 */
export function judgeHarmony(material, rules, walked) {
  const S = rules.score ?? {};
  const { bars } = walked;
  const seq = changes(bars);
  /** @type {Record<string, number>} */
  const terms = {};

  // Banned loops anywhere in the chord changes.
  let banned = false;
  for (const loop of S.bannedLoops ?? []) {
    for (let i = 0; i + loop.length <= seq.length && !banned; i++) {
      if (loop.every((/** @type {string} */ p, /** @type {number} */ k) => seq[i + k] === p)) banned = true;
    }
  }

  // Variety: how many different places it uses, against how many it could.
  const distinct = new Set(seq).size;
  terms.variety = (S.variety ?? 0) * distinct / Math.min(Object.keys(material.chords).length, Math.max(1, bars.length));

  // Tension: distance of each bar's (first) chord from the plan's target.
  let err = 0;
  for (const b of bars) err += Math.abs(material.chords[b.chords[0].place].tension - b.target);
  terms.tensionFit = -(S.tensionFit ?? 0) * err / Math.max(1, bars.length);

  // A run of four chord changes that comes back is a loop. Bars a return brings back on purpose
  // and the rocking figure don't count; what the walk writes freely does.
  const free = changes(bars.filter((b) => !b.kept && !b.figure));
  const seen = new Map();
  let repeats = 0;
  for (let i = 0; i + 4 <= free.length; i++) {
    const key = free.slice(i, i + 4).join(' ');
    if (seen.has(key) && i - seen.get(key) >= 4) repeats++;
    if (!seen.has(key)) seen.set(key, i);
  }
  terms.repeatWindow = -(S.repeatWindow ?? 0) * repeats;

  // The same chord three bars running.
  let stuck = 0;
  for (let i = 2; i < bars.length; i++) {
    const p = (/** @type {number} */ k) => bars[k].chords[bars[k].chords.length - 1].place;
    // A written line (sus4, sus2, home) stays on one place on purpose.
    if (bars[i].figure && bars[i].figure !== 'rock') continue;
    if (bars[i].chords.length === 1 && p(i) === p(i - 1) && p(i - 1) === p(i - 2)) stuck++;
  }
  terms.stuck = -(S.stuck ?? 0) * stuck;

  // Too many color chords.
  // A written line's colors are the line itself, so they are not counted.
  const all = bars.filter((b) => !b.figure || b.figure === 'rock').flatMap((b) => b.chords);
  const share = all.filter((c) => c.color).length / Math.max(1, all.length);
  terms.colorCrowd = -(S.colorCrowd ?? 0) * Math.max(0, share - (S.colorCrowdShare ?? 0.4)) * 10;

  // A return that starts where the grammar has no move from the chord before it.
  let rough = 0;
  for (let i = 1; i < bars.length; i++) {
    if (!bars[i].kept || bars[i - 1].phrase === bars[i].phrase) continue;
    const a = bars[i - 1].chords[bars[i - 1].chords.length - 1].place, b = bars[i].chords[0].place;
    if (a !== b && b !== 'I' && !material.moves[a]?.[b]) rough++;
  }
  terms.roughReturn = -(S.roughReturn ?? 0) * rough;

  // A cadence the walk could not reach properly.
  terms.forced = -10 * walked.forced;

  const total = Object.values(terms).reduce((s, v) => s + v, 0);
  return { total: banned ? -Infinity : total, banned, terms };
}

// @ts-check
// Development engine tests (doc 24, "The development engine", phase 4a): a grown piece regenerates
// exactly from its seed, slot and season; its harmony never strands a cadence, never plays a banned
// loop, lands every phrase on its planned cadence, and plays through the realizer like any piece.

import { grow } from '../src/audio/music/develop/index.js';
import { reach } from '../src/audio/music/develop/harmony.js';
import { realize } from '../src/audio/music/realize.js';

const G = 'music: development engine';

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addDevelopTests(test, assert, eq) {
  /** @type {Promise<any> | null} */
  let loaded = null;
  const load = () => {
    // The browser fetches the recipe; Node (tools/run-audio-tests.mjs) reads it from disk.
    const j = async (/** @type {string} */ p) => {
      const url = new URL(`../${p}`, import.meta.url);
      if (url.protocol === 'file:') { const fs = await import('node:fs/promises'); return JSON.parse(await fs.readFile(url, 'utf8')); }
      return (await fetch(url)).json();
    };
    loaded ??= Promise.all(['recipes/music/material/spring.json', 'recipes/music/develop.json', 'recipes/music/names.json', 'recipes/music/realize.json', 'recipes/music/voicing.json'].map(j))
      .then(([material, rules, names, rz, vo]) => ({ material, rules, names, recipes: { realize: rz, voicing: vo } }));
    return loaded;
  };
  const SLOTS = ['morning', 'interlude', 'evening'];

  test(G, 'the same seed, slot and season grow the same piece and the same name', async () => {
    const { material, rules, names } = await load();
    for (const slot of SLOTS) {
      const a = grow(material, rules, { slot, seed: 4127 }, names);
      const b = grow(material, rules, { slot, seed: 4127 }, names);
      eq(JSON.stringify(a.piece), JSON.stringify(b.piece), `${slot}:`);
    }
  });

  test(G, 'different seeds and different slots grow different harmony', async () => {
    const { material, rules, names } = await load();
    const key = (/** @type {any} */ g) => g.piece.grown.report.bars.map((/** @type {any} */ b) => b.chords.map((/** @type {any} */ c) => c.place).join('+')).join(' ');
    const seen = new Set();
    for (const slot of SLOTS) for (let s = 1; s <= 10; s++) seen.add(key(grow(material, rules, { slot, seed: s }, names)));
    assert(seen.size >= 27, `only ${seen.size} different progressions in 30 seeds`);
  });

  test(G, 'every place in the grammar can reach home', async () => {
    const { material } = await load();
    const d = reach(material);
    for (const p of Object.keys(material.chords)) assert(d[p].I !== undefined, `${p} cannot reach I`);
  });

  test(G, '200 seeds: no forced cadence, no banned loop, every phrase lands its cadence, the piece ends at home', async () => {
    const { material, rules, names } = await load();
    for (const slot of SLOTS) for (let s = 1; s <= 67; s++) {
      const g = grow(material, rules, { slot, seed: s }, names);
      const rep = g.piece.grown.report;
      const at = `${slot} seed ${s}`;
      eq(rep.judged.banned, false, `${at} banned loop:`);
      eq(rep.judged.terms.forced, 0, `${at} forced:`);
      rep.plan.forEach((/** @type {any} */ ph, /** @type {number} */ i) => {
        const bars = rep.bars.filter((/** @type {any} */ b) => b.phrase === i);
        eq(bars.length, ph.bars, `${at} phrase ${i + 1} length:`);
        const last = bars[bars.length - 1].chords;
        eq(last[last.length - 1].place, material.cadences[ph.cadence].to, `${at} phrase ${i + 1} cadence:`);
        const before = bars[bars.length - 2]?.chords;
        if (before) assert(material.cadences[ph.cadence].from.includes(before[before.length - 1].place), `${at} phrase ${i + 1}: the cadence's approach is missing`);
      });
      assert(material.cadences[rep.plan[rep.plan.length - 1].cadence].final, `${at}: the last cadence cannot close a piece`);
      // Every move is one the grammar allows (or a hold).
      const seq = rep.bars.flatMap((/** @type {any} */ b) => b.chords.map((/** @type {any} */ c) => c.place));
      for (let i = 1; i < seq.length; i++) assert(seq[i] === seq[i - 1] || material.moves[seq[i - 1]]?.[seq[i]] !== undefined, `${at}: ${seq[i - 1]} to ${seq[i]} is not a move`);
    }
  });

  test(G, 'a grown piece plays through the realizer, harmony only', async () => {
    const { material, rules, names, recipes } = await load();
    const g = grow(material, rules, { slot: 'interlude', seed: 9 }, names);
    const p = realize(g.piece, { seed: 9, dayColor: { register: 69, density: 3, tempo: 1, voices: 6 }, available: ['piano', 'pad', 'strings'] }, recipes);
    assert(p.durationS > 20, `only ${p.durationS.toFixed(1)} s`);
    assert(!p.notes.some((n) => n.voice === 'mel'), 'the melody should be silent in phase 4a');
    assert(p.notes.some((n) => n.voice === 'bed'), 'no bed under the chords');
  });

  test(G, 'tuning a cadence to zero removes it', async () => {
    const { material, rules, names } = await load();
    const tuned = { ...rules, harmony: { ...rules.harmony, cadenceWeights: { ...rules.harmony.cadenceWeights, deceptive: 0 } } };
    for (let s = 1; s <= 30; s++) {
      const g = grow(material, tuned, { slot: 'interlude', seed: s }, names);
      assert(!g.piece.grown.report.plan.some((/** @type {any} */ ph) => ph.cadence === 'deceptive'), `seed ${s} still has a deceptive cadence`);
    }
  });
}

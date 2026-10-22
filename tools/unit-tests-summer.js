// @ts-check
// Summer's material for the composer (doc 24, The four seasons; recipes/music/material/summer.json):
// every slot grows in F with valid cadences, mornings lift and evenings settle in tempo, the written
// lines (the bass walk, sus4 to sus2) and the electric piano turn up, and the same seed grows the
// same piece.

import { grow } from '../src/audio/music/develop/index.js';
import { heartOf } from '../src/audio/music/hearts.js';

const G = 'music: summer';
const SLOTS = ['morning', 'interlude', 'evening', 'nocturne'];

/** @type {Promise<any> | null} */
let loaded = null;
function load() {
  const j = async (/** @type {string} */ p) => {
    const url = new URL(`../${p}`, import.meta.url);
    // Node reads from disk; the page and the test workers fetch.
    if (url.protocol === 'file:') {
      // @ts-ignore Node only
      const fs = await import('node:fs');
      return JSON.parse(fs.readFileSync(url, 'utf8'));
    }
    return (await fetch(url)).json();
  };
  loaded ??= Promise.all(['recipes/music/material/summer.json', 'recipes/music/develop.json', 'recipes/music/names.json'].map(j))
    .then(([material, rules, names]) => ({ material, rules, names }));
  return loaded;
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(c: any, m?: string) => void} assert
 * @param {(a: any, b: any, m?: string) => void} eq
 */
export function addSummerTests(test, assert, eq) {
  test(G, 'every slot grows a summer piece in F whose phrases land their cadences', async () => {
    const { material, rules, names } = await load();
    for (const slot of SLOTS) for (let s = 1; s <= 8; s++) {
      const g = grow(material, rules, { slot, seed: s }, names);
      eq(g.piece.keys[0], 'F', `${slot} ${s} key`);
      eq(g.piece.seasons[0], 'summer', `${slot} ${s} season`);
      const rep = g.piece.grown.report;
      rep.plan.forEach((/** @type {any} */ ph, /** @type {number} */ i) => {
        const bars = rep.bars.filter((/** @type {any} */ b) => b.phrase === i);
        const last = bars[bars.length - 1].chords;
        eq(last[last.length - 1].place, material.cadences[ph.cadence].to, `${slot} ${s} phrase ${i + 1}`);
      });
    }
  });

  test(G, 'mornings lift and evenings settle: the tempo bands by slot', async () => {
    const { material, rules, names } = await load();
    for (let s = 1; s <= 10; s++) {
      const m = grow(material, rules, { slot: 'morning', seed: s }, names).piece.tempo;
      const e = grow(material, rules, { slot: 'evening', seed: s }, names).piece.tempo;
      assert(m[0] >= 70 && m[1] <= 84, `morning ${m}`);
      assert(e[0] >= 58 && e[1] <= 72, `evening ${e}`);
    }
  });

  test(G, 'the bass walk, the sus lines and the electric piano all turn up', async () => {
    const { material, rules, names } = await load();
    const figs = new Set();
    let ep = 0;
    for (const slot of ['morning', 'interlude']) for (let s = 1; s <= 30; s++) {
      const p = grow(material, rules, { slot, seed: s }, names).piece;
      for (const b of p.grown.report.bars) if (b.figure) figs.add(b.figure);
      if (p.palette.accomp[0] === 'fm-piano') ep++;
    }
    assert(figs.has('walk') || figs.has('walk-down'), `walk: ${[...figs]}`);
    assert(figs.has('sus-turn') || figs.has('sus-slow'), `sus: ${[...figs]}`);
    assert(ep >= 6 && ep <= 36, `electric piano in ${ep} of 60`);
  });

  test(G, 'the same seed grows the same summer piece; a summer heart names its season', async () => {
    const { material, rules, names } = await load();
    const a = grow(material, rules, { slot: 'interlude', seed: 77 }, names).piece;
    const b = grow(material, rules, { slot: 'interlude', seed: 77 }, names).piece;
    eq(JSON.stringify(a), JSON.stringify(b), 'same piece');
    eq(heartOf({ id: a.id, title: a.title, grown: true, grownSlot: 'interlude', weather: 'clear', seed: 77, season: 'summer' }).key, 'grown:summer:interlude:clear:77', 'summer key');
    eq(heartOf({ id: 'x', title: 'y', grown: true, grownSlot: 'interlude', weather: 'clear', seed: 77 }).key, 'grown:interlude:clear:77', 'spring key unchanged');
  });
}

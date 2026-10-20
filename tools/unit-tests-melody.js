// @ts-check
// Melody tests (phase 4b, src/audio/music/develop/song.js): a singing piece regrows exactly from its
// seed; its melody leaves the piece's chords, form, ending and name as they are without it; every
// section's ABC reads cleanly; strong-beat notes sit on chord tones (or a suspension); every phrase
// ends on a goal note of its cadence's chord; the critic's choice is among its best; the frogs'
// band stays clear at night; and the counter-line stays under the melody.

import { grow } from '../src/audio/music/develop/index.js';
import { parseAbc } from '../src/audio/music/score.js';
import { realize } from '../src/audio/music/realize.js';
import { fitMotif, TECHNIQUES } from '../src/audio/music/develop/motifs.js';
import { stream } from '../src/core/rng.js';

const G = 'music: melody (4b)';

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addMelodyTests(test, assert, eq) {
  /** @type {Promise<any> | null} */
  let loaded = null;
  const load = () => {
    const j = async (/** @type {string} */ p) => {
      const url = new URL(`../${p}`, import.meta.url);
      if (url.protocol === 'file:') { const fs = await import('node:fs/promises'); return JSON.parse(await fs.readFile(url, 'utf8')); }
      return (await fetch(url)).json();
    };
    loaded ??= Promise.all(['recipes/music/material/spring.json', 'recipes/music/material/summer.json', 'recipes/music/develop.json', 'recipes/music/names.json', 'recipes/music/realize.json', 'recipes/music/voicing.json'].map(j))
      .then(([spring, summer, rules, names, rz, vo]) => ({ mats: { spring, summer }, rules, names, recipes: { realize: rz, voicing: vo } }));
    return loaded;
  };
  const SLOTS = ['morning', 'interlude', 'evening', 'nocturne'];

  test(G, 'a singing piece regrows exactly, and its melody leaves the chords, form and name as they were', async () => {
    const { mats, rules, names } = await load();
    for (const [season, mat] of Object.entries(mats)) for (const slot of SLOTS) for (let seed = 1; seed <= 6; seed++) {
      const a = grow(mat, rules, { slot, seed, melody: true }, names).piece;
      const b = grow(mat, rules, { slot, seed, melody: true }, names).piece;
      eq(JSON.stringify(a), JSON.stringify(b), `${season} ${slot} ${seed}:`);
      const c = grow(mat, rules, { slot, seed, melody: false }, names).piece;
      eq(a.title, c.title, 'title');
      eq(JSON.stringify(a.tempo), JSON.stringify(c.tempo), 'tempo');
      eq(JSON.stringify(a.form), JSON.stringify(c.form), 'form');
      eq(JSON.stringify(a.grown.report.bars), JSON.stringify(c.grown.report.bars), 'chords');
      eq(a.grown.report.ending.id, c.grown.report.ending.id, 'ending');
      eq(JSON.stringify(a.palette.bed), JSON.stringify(c.palette.bed), 'bed');
      assert(!c.grown.report.melody, 'no melody when told not to sing');
    }
  });

  test(G, 'most pieces sing, about as often as melody.chance says', async () => {
    const { mats, rules, names } = await load();
    let sing = 0, n = 0;
    for (let seed = 1; seed <= 60; seed++) for (const slot of ['morning', 'interlude', 'evening']) {
      n++;
      if (grow(mats.summer, rules, { slot, seed }, names).piece.grown.report.melody) sing++;
    }
    const want = rules.melody.chance.default;
    assert(Math.abs(sing / n - want) < 0.12, `sang ${sing} of ${n}, want about ${want}`);
  });

  test(G, 'every section reads cleanly, strong beats sit on chord tones, phrases end on goal notes', async () => {
    const { mats, rules, names } = await load();
    for (const [season, mat] of Object.entries(mats)) for (const slot of SLOTS) for (const weather of ['clear', 'rain', 'mist']) for (let seed = 1; seed <= 8; seed++) {
      const g = grow(mat, rules, { slot, weather, seed, melody: true }, names);
      const where = `${season} ${slot} ${weather} ${seed}`;
      for (const [name, s] of Object.entries(g.piece.sections)) {
        const p = parseAbc(/** @type {any} */ (s).abc);
        eq(p.warnings.length, 0, `${where} ${name} warnings ${p.warnings.join('; ')}`);
      }
      const m = g.piece.grown.report.melody;
      const goals = m.notes.filter((/** @type {any} */ x) => x.job === 'goal').length;
      assert(goals >= g.piece.grown.report.plan.length, `${where}: ${goals} goal notes for ${g.piece.grown.report.plan.length} phrases`);
      // No note held through a chord that does not have it, on the downbeat of a bar.
      const bad = m.notes.filter((/** @type {any} */ x) => x.job !== 'suspension' && x.job !== 'passing' && x.t % m.len === 0 && !chordPcsAt(g, x.t).includes(x.midi % 12));
      eq(bad.length, 0, `${where}: downbeat notes off the chord at ${bad.map((/** @type {any} */ x) => x.t).join(', ')}`);
    }
  });

  test(G, 'the critic chooses among its best, and evenings keep clear of the frogs', async () => {
    const { mats, rules, names } = await load();
    for (let seed = 1; seed <= 12; seed++) {
      const m = grow(mats.summer, rules, { slot: 'evening', seed, melody: true }, names).piece.grown.report.melody;
      assert(m.chosen < m.keep, `seed ${seed}: chose ${m.chosen}`);
      const high = m.notes.filter((/** @type {any} */ x) => x.midi >= rules.melody.score.frogBand[0]).length;
      assert(high <= 2, `seed ${seed}: ${high} notes in the frogs' band`);
    }
  });

  test(G, 'a counter-line stays under the melody, and the guitar never strums and sings at once', async () => {
    const { mats, recipes, rules, names } = await load();
    let counters = 0;
    for (let seed = 1; seed <= 80 && counters < 6; seed++) for (const slot of ['morning', 'interlude']) {
      const g = grow(mats.summer, rules, { slot, seed, melody: true }, names);
      const pal = g.piece.palette, m = g.piece.grown.report.melody;
      assert(!(pal.strum && (pal.melody?.includes('guitar') || m.withCounter)), `seed ${seed}: the guitar has two jobs`);
      if (!m.withCounter) continue;
      counters++;
      for (const c of m.counter) {
        const over = m.notes.find((/** @type {any} */ x) => x.t <= c.t && x.t + x.d > c.t);
        if (over) assert(c.midi <= over.midi - 3, `seed ${seed}: counter ${c.midi} not under ${over.midi} at ${c.t}`);
      }
      const p = realize(g.piece, { seed, dayColor: { register: 67, density: 3, tempo: 1 }, available: ['piano', 'guitar', 'strings', 'pad', 'vibraphone', 'fm-piano'] }, recipes);
      assert(p.notes.some((/** @type {any} */ n) => n.voice === 'counter'), `seed ${seed}: the counter-line plays`);
    }
    assert(counters > 0, 'no counter-line in 160 summer pieces');
  });

  test(G, 'motifs fit other meters and the techniques keep their length', () => {
    const m = { meter: '3/4', notes: /** @type {[number, number][]} */ ([[0, 3], [1, 1], [2, 2], [3, 2], [4, 4]]) };
    const c = fitMotif(m, '4/4');
    eq(c.bars, 2);
    eq(c.notes.length, 5);
    eq(c.notes.map((n) => n.deg).join(' '), '0 1 2 3 4');
    eq(c.notes.reduce((s, n) => s + n.d, 0), 16, 'fills two 4/4 bars');
    const r = stream(7, 1);
    for (const [k, f] of Object.entries(TECHNIQUES)) {
      const out = f(fitMotif(m, '3/4'), 6, r, { dir: 1, maxBars: 4 });
      if (!out) continue;
      for (const n of out.notes) assert(n.t >= 0 && n.t + n.d <= out.bars * 6, `${k}: a note outside its cell`);
    }
  });
}

/** The chord's pitch classes at t (global eighths) in a grown piece. @param {any} g @param {number} t */
function chordPcsAt(g, t) {
  let pcs = [];
  for (const e of g.piece.grown.report.melody.chords) { if (e.t <= t) pcs = e.pcs; else break; }
  return pcs;
}
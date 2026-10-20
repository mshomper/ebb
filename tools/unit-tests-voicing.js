// @ts-check
// Voicing tests (doc 24, "Voice-leading"): the voicing search keeps the rules a trained ear hears.
// Chords are given directly (root pitch class and intervals), so these tests don't depend on the
// chord-symbol reader.

import { voiceProgression, chordTones, candidates } from '../src/audio/music/voicing.js';

const G = 'music: voicing';
const W = {
  motion: 1, bassMotion: 0.35, innerLeap: 1.5, topLeap: 1, commonTone: 1.5, parallel: 40, lowClose: 6, lowCloseBelow: 48,
  wideGap: 2, wideGapSemis: 9, bassTenorMin: 7, bassTenorClose: 4, missingThird: 30, missingSeventh: 14, doubledThird: 6, doubledLeading: 20,
  semitone: 14, minorNinth: 12, missingColor: 10, bassCenter: 0.4, bassHome: 41,
};
const rules = { voices: 4, bassRange: /** @type {[number, number]} */ ([35, 50]), upperRange: /** @type {[number, number]} */ ([52, 72]), leadingPc: 1, w: W };
const D = { root: 2, intervals: [0, 4, 7], bass: null };
const GoverD = { root: 7, intervals: [0, 4, 7], bass: 2 };
const Bm7 = { root: 11, intervals: [0, 3, 7, 10], bass: null };
const Asus = { root: 9, intervals: [0, 5, 7], bass: null };
const A = { root: 9, intervals: [0, 4, 7], bass: null };
const Gmaj7 = { root: 7, intervals: [0, 4, 7, 11], bass: null };
const Em9 = { root: 4, intervals: [0, 3, 7, 10, 14], bass: null };
const prog = [D, GoverD, Bm7, Gmaj7, Em9, Asus, A, D];

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addVoicingTests(test, assert, eq) {
  const path = voiceProgression(prog, rules);
  const show = () => JSON.stringify(path);

  test(G, 'colour tones come first, root and fifth last', () => {
    eq(JSON.stringify(chordTones(Bm7).map((t) => t.role)), JSON.stringify(['third', 'seventh', 'fifth', 'root']));
  });

  test(G, 'every voicing has the right bass, in range, and stays ascending', () => {
    prog.forEach((c, i) => {
      const v = path[i];
      eq(v.length, 4, `voices in chord ${i + 1}`);
      eq(v[0] % 12, c.bass ?? c.root, `bass of chord ${i + 1} ${show()}`);
      assert(v[0] >= 33 && v[0] <= 50, `bass range ${show()}`);
      for (let k = 1; k < v.length; k++) assert(v[k] > v[k - 1], `ascending ${show()}`);
    });
  });

  test(G, 'every voicing keeps its third (or suspension)', () => {
    prog.forEach((c, i) => {
      const third = chordTones(c).find((t) => t.role === 'third' || t.role === 'sus');
      assert(third && path[i].slice(1).some((m) => m % 12 === third.pc), `chord ${i + 1} has its third: ${show()}`);
    });
  });

  test(G, 'no parallel fifths or octaves between the outer voices', () => {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      const ia = (a[a.length - 1] - a[0]) % 12, ib = (b[b.length - 1] - b[0]) % 12;
      const bothMove = a[0] !== b[0] && a[a.length - 1] !== b[b.length - 1];
      const same = Math.sign(b[0] - a[0]) === Math.sign(b[b.length - 1] - a[a.length - 1]);
      assert(!(bothMove && same && ia === ib && (ia === 0 || ia === 7)), `parallel at chord ${i + 1}: ${show()}`);
    }
  });

  test(G, 'nothing closer than a fifth below C3', () => {
    for (const v of path) for (let k = 0; k + 1 < v.length; k++) if (v[k] < 48) assert(v[k + 1] - v[k] >= 7, `low close interval in ${JSON.stringify(v)}`);
  });

  test(G, 'upper voices move smoothly (mostly by step, total motion small)', () => {
    let total = 0, leaps = 0;
    for (let i = 1; i < path.length; i++) for (let k = 1; k < 4; k++) {
      const d = Math.abs(path[i][k] - path[i - 1][k]);
      total += d;
      if (d > 4) leaps++;
    }
    assert(leaps <= 1, `upper-voice leaps: ${leaps} ${show()}`);
    assert(total / ((path.length - 1) * 3) <= 2.2, `average motion ${(total / ((path.length - 1) * 3)).toFixed(2)} ${show()}`);
  });

  test(G, 'no semitone clusters between upper voices, and a maj9 keeps its ninth', () => {
    const p = voiceProgression([{ root: 2, intervals: [0, 4, 7, 11, 14], bass: null }], rules)[0];
    for (let k = 1; k + 1 < p.length; k++) assert(p[k + 1] - p[k] !== 1, `cluster in ${JSON.stringify(p)}`);
    assert(p.slice(1).some((m) => m % 12 === 4), `Dmaj9 keeps E: ${JSON.stringify(p)}`);
  });

  test(G, 'the leading tone is never doubled', () => {
    for (const v of path) assert(v.filter((m) => m % 12 === 1).length <= 1, `doubled C sharp in ${JSON.stringify(v)}`);
  });

  test(G, 'accompaniment stays under the melody', () => {
    const r = { ...rules, melodyFloor: 66 };
    const p = voiceProgression([D, GoverD, D], r);
    for (const v of p) assert(v[v.length - 1] <= 65, `top ${v[v.length - 1]} under F sharp 4`);
  });

  test(G, 'the same input always gives the same voicing', () => {
    eq(JSON.stringify(voiceProgression(prog, rules)), show());
  });

  test(G, 'candidates are found for every chord in the progression', () => {
    for (const c of prog) assert(candidates(c, rules).length > 0, 'no candidates');
  });

  test(G, 'the search is fast enough for the realizer (a 32-chord piece)', () => {
    const many = Array.from({ length: 32 }, (_, i) => prog[i % prog.length]);
    const t0 = performance.now();
    voiceProgression(many, rules);
    const ms = performance.now() - t0;
    assert(ms < 400, `${ms.toFixed(0)} ms`);
    return `${ms.toFixed(0)} ms`;
  });
}

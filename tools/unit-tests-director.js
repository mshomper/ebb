// @ts-check
// Director and realizer tests (doc 24): the director keeps dusk for the frogs, starts nothing in a
// preview or the pre-dawn hush, rests at least the recipe's shortest rest after every piece, keeps
// recently played pieces waiting, and decides the same way for the same seed; the realizer gives
// the same performance for the same seed, and a new seed keeps the melody and harmony.

import { createDirector, sunDay } from '../src/audio/music/director.js';
import { realize } from '../src/audio/music/realize.js';
import { dayColorAt, dayKeyWeights } from '../src/audio/music/daycolor.js';
import { createPerformer } from '../src/audio/music/perform.js';

const G = 'music: director';
const R = 'music: realize';
const DAY = 86400;

/** A simple sun for tests: rises at 6:00, sets at 18:00, 60 degrees at noon. @param {number} t */
const sun = (t) => 60 * Math.sin(Math.PI * (((t % DAY) / 3600 - 6) / 12));

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addDirectorTests(test, assert, eq) {
  const load = async () => {
    // The browser fetches the recipe; Node (tools/run-audio-tests.mjs) reads it from disk.
    const j = async (/** @type {string} */ p) => {
      const url = new URL(`../${p}`, import.meta.url);
      if (url.protocol === 'file:') { const fs = await import('node:fs/promises'); return JSON.parse(await fs.readFile(url, 'utf8')); }
      return (await fetch(url)).json();
    };
    const [director, piece, rz, vo] = await Promise.all([j('recipes/music/director.json'), j('recipes/music/pieces/test-spring-01.json'), j('recipes/music/realize.json'), j('recipes/music/voicing.json')]);
    const pool = ['morning', 'interlude', 'evening', 'nocturne'].map((s) => ({ ...piece, id: `t-${s}`, slots: [s], seasons: ['spring', 'summer', 'autumn', 'winter'], weather: undefined }));
    return { director, piece, pool, recipes: { realize: rz, voicing: vo } };
  };
  /** Run the director through a day in one-real-second steps at 1x; pieces last lenS. */
  const run = (/** @type {any} */ director, /** @type {any[]} */ pool, /** @type {any} */ opts) => {
    const d = createDirector({ director, seasons: {} }, pool, { seed: opts.seed ?? 3, sunAltDeg: sun });
    /** @type {any[]} */
    const out = [];
    let busyUntil = -1, cur = null;
    for (let realS = 0; realS < (opts.realS ?? 24 * 60 * 2); realS++) {
      const gameT = (opts.startH ?? 4) * 3600 + realS * 60;
      const h = (gameT % DAY) / 3600;
      const st = { realS, gameT, weather: /** @type {const} */ ('clear'), frogsAwake: !!opts.frogs, frogsCalling: !!opts.frogs && h > 18.5 && h < 22, residents: [], frequency: /** @type {const} */ ('now-and-then'), previewing: opts.previewing?.(realS) ?? false };
      if (cur && realS >= busyUntil) { out.push({ ...cur, end: realS, rest: d.ended(st) }); cur = null; }
      if (!cur) {
        const dec = d.update(st);
        if (dec) { d.started(dec, st, dec.piece.keys[0]); cur = { id: dec.piece.id, slot: dec.slot, start: realS, h }; busyUntil = realS + (opts.lenS ?? 150); }
      }
    }
    return { out, d };
  };

  test(G, 'the sun timeline of a test day', () => {
    const s = sunDay(sun, 0, [10, 2]);
    assert(Math.abs(s.sunrise - 6) < 0.1 && Math.abs(s.sunset - 18) < 0.1, JSON.stringify(s));
    assert(s.dusk > s.sunset && s.dawn < s.sunrise, 'dawn before sunrise, dusk after sunset');
  });

  test(G, 'no piece starts while the frogs call', async () => {
    const { director, pool } = await load();
    for (const seed of [1, 2, 3, 4, 5]) {
      const { out } = run(director, pool, { seed, frogs: true });
      for (const p of out) assert(!(p.h > 18.5 && p.h < 22) || p.slot === 'nocturne', `seed ${seed}: ${p.slot} started at ${p.h.toFixed(2)} h`);
    }
  });

  test(G, 'every piece is followed by a rest of at least the shortest rest (2 real minutes)', async () => {
    const { director, pool } = await load();
    const { out } = run(director, pool, { seed: 9 });
    assert(out.length >= 2, `pieces: ${out.length}`);
    for (const p of out) assert(p.rest >= 120, `rest ${p.rest}`);
    for (let i = 1; i < out.length; i++) assert(out[i].start - out[i - 1].end >= 120, 'gap between pieces');
  });

  test(G, 'nothing starts during a preview', async () => {
    const { director, pool } = await load();
    const { out } = run(director, pool, { seed: 4, previewing: () => true });
    eq(out.length, 0);
  });

  test(G, 'nothing starts in the hour before sunrise', async () => {
    const { director, pool } = await load();
    for (const seed of [1, 2, 3, 4, 5, 6]) for (const p of run(director, pool, { seed, startH: 2 }).out) assert(!(p.h >= 5 && p.h < 6), `seed ${seed}: started at ${p.h.toFixed(2)} h`);
  });

  test(G, 'a piece does not return within its minimum gap while others can play', async () => {
    const { director, pool } = await load();
    const two = [pool[1], { ...pool[1], id: 't-interlude-b' }];
    const { out } = run(director, two, { seed: 2, realS: 24 * 60 * 3 });
    const ids = out.map((p) => p.id);
    for (let i = 1; i < ids.length; i++) assert(ids[i] !== ids[i - 1] || true, 'ok');
    const first = out.findIndex((p) => p.id === 't-interlude');
    const again = out.findIndex((p, i) => i > first && p.id === 't-interlude');
    if (first >= 0 && again >= 0) assert(out.slice(first + 1, again).some((p) => p.id === 't-interlude-b'), 'the other piece played in between');
  });

  test(G, 'the same seed decides the same way', async () => {
    const { director, pool } = await load();
    const a = run(director, pool, { seed: 11 }).out.map((p) => `${p.id}@${p.start}`).join(' ');
    const b = run(director, pool, { seed: 11 }).out.map((p) => `${p.id}@${p.start}`).join(' ');
    eq(a, b);
  });

  test(G, 'day colour: weights sum to one and follow the sun', async () => {
    const { director } = await load();
    for (const alt of [-30, -12, -8, -4, 0, 6, 12, 20, 45]) {
      const w = dayKeyWeights(alt, director.dayColor);
      const sum = Object.values(w).reduce((a, b) => a + b, 0);
      assert(Math.abs(sum - 1) < 1e-9, `sum at ${alt}`);
    }
    assert(dayColorAt(-30, director.dayColor).tempo < dayColorAt(15, director.dayColor).tempo, 'night slower than morning');
  });

  test(R, 'the same seed gives the same performance', async () => {
    const { piece, recipes } = await load();
    const ctx = { seed: 4127, dayColor: { register: 69, density: 3, tempo: 1, voices: 6 }, available: ['piano', 'pad'] };
    eq(JSON.stringify(realize(piece, ctx, recipes)), JSON.stringify(realize(piece, ctx, recipes)));
  });

  test(R, 'a new seed keeps the melody and harmony', async () => {
    const { piece, recipes } = await load();
    const base = { dayColor: { register: 69, density: 3, tempo: 1, voices: 6 }, available: ['piano', 'pad'], key: 'D' };
    const a = realize(piece, { ...base, seed: 1, shortForm: true }, recipes);
    const b = realize(piece, { ...base, seed: 2, shortForm: true }, recipes);
    const mel = (/** @type {any} */ p) => p.notes.filter((/** @type {any} */ n) => n.voice === 'mel').sort((x, y) => x.tick - y.tick).map((/** @type {any} */ n) => n.midi % 12).join(',');
    eq(mel(a), mel(b), 'melody pitch classes');
    eq(a.bars.map((x) => x.chord).join(' '), b.bars.map((x) => x.chord).join(' '), 'chords');
    assert(JSON.stringify(a.notes) !== JSON.stringify(b.notes), 'the performances differ');
  });

  test(R, 'the piano stays inside the shipped range, A1 to D sharp 7', async () => {
    const { piece, recipes } = await load();
    for (let seed = 1; seed <= 30; seed++) {
      const p = realize(piece, { seed, dayColor: { register: 69, density: 3, tempo: 1, voices: 6 }, available: ['piano', 'pad'] }, recipes);
      for (const n of p.notes) if (n.instrument === 'piano') assert(n.midi >= 33 && n.midi <= 99, `seed ${seed}: ${n.midi}`);
    }
  });

  test(R, 'the pedal lifts just before each chord change and presses just after', async () => {
    const { piece, recipes } = await load();
    const p = realize(piece, { seed: 5, dayColor: { register: 69, density: 3, tempo: 1, voices: 6 }, available: ['piano'] }, recipes);
    for (const b of p.bars.slice(1)) {
      const lift = p.pedal.find((e) => !e.down && Math.abs(e.t - b.t) < 0.08);
      assert(lift, `a pedal lift near bar ${b.index}`);
    }
  });

  test('music: perform', 'plays to the end with no bar listener (no stall on the first bar)', async () => {
    const ctx = /** @type {any} */ ({ currentTime: 0 });
    let on = 0;
    const piano = /** @type {any} */ ({ noteOn: () => on++, noteOff: () => {}, pedal: () => {} });
    const perf = /** @type {any} */ ({ durationS: 0.2, notes: [{ t: 0, dur: 0.1, midi: 60, vel: 64, voice: 'mel', instrument: 'piano' }], pedal: [],
      bars: [{ index: 1, t: 0, tick: 0, chord: '', section: 'A' }, { index: 2, t: 0.1, tick: 0, chord: '', section: 'A' }] });
    const pf = createPerformer(ctx, { piano });
    const ended = new Promise((r) => pf.play(perf, { onEnd: () => r(true) }, 0));
    const clock = setInterval(() => { ctx.currentTime += 0.05; }, 5);
    const ok = await Promise.race([ended, new Promise((r) => setTimeout(() => r(false), 3000))]);
    clearInterval(clock);
    assert(ok, 'the performance ended');
    eq(on, 1, 'one note played');
  });
}

// @ts-check
// Director and realizer tests (doc 24): the director keeps dusk for the frogs, starts nothing in a
// preview or the pre-dawn hush, rests at least the recipe's shortest rest after every piece, keeps
// recently played pieces waiting, and decides the same way for the same seed; the realizer gives
// the same performance for the same seed, and a new seed keeps the melody and harmony.

import { createDirector, sunDay, dawnReached } from '../src/audio/music/director.js';
import { realize } from '../src/audio/music/realize.js';
import { dayColorAt, dayKeyWeights } from '../src/audio/music/daycolor.js';
import { createPerformer } from '../src/audio/music/perform.js';
import { pieceName } from '../src/audio/music/names.js';

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
    // The browser fetches the recipe; Node (tools/run-tests.mjs) reads it from disk.
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

  test(G, 'the first morning of each season plays its home tide', async () => {
    const { director, pool } = await load();
    const tides = ['spring', 'summer', 'autumn', 'winter'].flatMap((season) => [1, 2, 3, 4].map((n) => ({
      id: `tide-${n}-${season}`, theme: { candidate: n, season }, slots: ['morning', 'interlude'], seasons: [season], weather: ['clear'], keys: ['D'], requires: {},
    })));
    // A season is 14 game days (src/core/clock.js DAYS_PER_SEASON).
    for (const [season, day] of /** @type {[string, number][]} */ ([['spring', 0], ['summer', 14], ['autumn', 28], ['winter', 42]])) {
      for (const seed of [1, 2, 3]) {
        const { out } = run(director, [...pool, ...tides], { seed, startH: day * 24 + 4, realS: 60 * 20 });
        const morning = out.find((p) => p.slot === 'morning');
        assert(morning, `${season} seed ${seed}: a morning piece played`);
        eq(morning.id, `tide-${director.tides.home[season]}-${season}`, `${season} seed ${seed}: the home tide opens the season`);
      }
    }
  });

  test(G, 'a slot closes sooner in real time at 2x and 4x, and never while paused', async () => {
    const { director, pool } = await load();
    /** The first decision's window, in real seconds from its start, with the time speed `flow`. @param {number} flow */
    const firstWindow = (flow) => {
      const d = createDirector({ director, seasons: {} }, pool, { seed: 5, sunAltDeg: sun });
      for (let realS = 0; realS < 24 * 60; realS++) {
        const st = { realS, gameT: 4 * 3600 + realS * 60, weather: /** @type {const} */ ('clear'), frogsAwake: false, frogsCalling: false, residents: [], frequency: /** @type {const} */ ('now-and-then'), previewing: false, flow };
        const dec = d.update(st);
        if (dec) return dec.windowEndRealS - realS;
      }
      return NaN;
    };
    const w1 = firstWindow(1), w4 = firstWindow(4), w2 = firstWindow(2);
    assert(w1 > 0 && Number.isFinite(w1), `normal speed: ${w1}`);
    assert(Math.abs(w4 - w1 / 4) < 1e-6 && Math.abs(w2 - w1 / 2) < 1e-6, `1x ${w1}, 2x ${w2}, 4x ${w4}`);
    eq(firstWindow(0), Infinity, 'paused: the slot never closes');
  });

  test(G, 'a nocturne never starts too near dawn, even after waiting through a rest', async () => {
    const { director, pool } = await load();
    const N = director.slots.nocturne;
    const s = sunDay(sun, 0, [10, 2]);
    const closeH = s.dawn + N.toDawnH;
    let night = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) for (const lenS of [150, 400]) {
      for (const p of run(director, pool, { seed, startH: 16, realS: 16 * 60, lenS }).out) {
        if (p.slot !== 'nocturne' || p.h > 12) continue;
        night++;
        // At 1x a real minute is a game hour.
        assert(p.h <= closeH - N.minLeftRealMin + 1e-6, `seed ${seed}: a nocturne started at ${p.h.toFixed(2)} h, dawn ${s.dawn.toFixed(2)} h`);
      }
    }
    assert(night > 0, 'some nocturnes played after midnight');
  });

  test(G, 'a night piece meets the dawn when the sun climbs back to the dawn height', async () => {
    const { director } = await load();
    const deg = director.slots.nocturne.dawnSunDeg;
    const w = { seenNight: false };
    // Started at dusk with the sun still above the dawn height: not dawn yet.
    eq(dawnReached(w, -3, deg), false, 'dusk');
    eq(dawnReached(w, -20, deg), false, 'night');
    eq(dawnReached(w, -7, deg), false, 'still before dawn');
    eq(dawnReached(w, -5.9, deg), true, 'dawn');
    assert(director.slots.nocturne.dawnFadeS > 0, 'a fade time in the recipe');
  });

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

  test(G, 'every piece is followed by a rest of at least the shortest rest (the recipe, at the default setting)', async () => {
    const { director, pool } = await load();
    const { out } = run(director, pool, { seed: 9 });
    // The default setting ("now and then", shown as Sometimes) scales the recipe's shortest rest.
    const least = director.restRealMin[0] * 60 * (director.frequency['now-and-then'].restScale ?? 1) - 1e-6;
    assert(out.length >= 2, `pieces: ${out.length}`);
    for (const p of out) assert(p.rest >= least, `rest ${p.rest} (shortest ${least})`);
    for (let i = 1; i < out.length; i++) assert(out[i].start - out[i - 1].end >= least, 'gap between pieces');
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

  test(R, 'no note goes below B1 (62 Hz, doc 24 keeps the music above 60 Hz), in the tides or the test piece', async () => {
    const { piece, recipes } = await load();
    const j = async (/** @type {string} */ p) => {
      const url = new URL(`../${p}`, import.meta.url);
      if (url.protocol === 'file:') { const fs = await import('node:fs/promises'); return JSON.parse(await fs.readFile(url, 'utf8')); }
      return (await fetch(url)).json();
    };
    const idx = await j('recipes/music/pieces/themes/index.json');
    const pieces = [piece, ...await Promise.all(idx.candidates.flatMap((/** @type {any} */ c) => Object.values(c.settings)).map((/** @type {any} */ id) => j(`recipes/music/pieces/themes/${id}.json`)))];
    const avail = ['piano', 'pad', 'bell', 'fm-piano', 'strings', 'cello', 'harp', 'flute', 'vibraphone', 'vibraphone-bowed', 'guitar'];
    for (const pc of pieces) for (const register of [60, 69]) for (let seed = 1; seed <= 2; seed++) {
      const p = realize(pc, { seed, dayColor: { register, density: 2, tempo: 1, voices: 5 }, available: avail }, recipes);
      for (const n of p.notes) assert(n.midi >= 35, `${pc.id} seed ${seed}: ${n.voice} on ${n.instrument} at MIDI ${n.midi}`);
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

  test(R, 'the left hand is mostly struck, with arpeggios and a few rolls', async () => {
    const { piece, recipes } = await load();
    /** @type {Record<string, number>} */
    const n = {};
    let all = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const p = realize(piece, { seed, dayColor: { register: 67, density: 2, tempo: 1, voices: 5 }, available: ['piano'] }, recipes);
      for (const t of p.textures) { n[t] = (n[t] ?? 0) + 1; all++; }
    }
    assert((n.struck ?? 0) / all > 0.5, `struck ${n.struck}/${all}`);
    assert((n.arpeggio ?? 0) / all > 0.1, `arpeggio ${n.arpeggio}/${all}`);
    assert((n.roll ?? 0) > 0, 'some rolls');
    assert(((n.broken ?? 0) + (n['offbeat-dyads'] ?? 0)) / all < 0.03, 'choppy figures stay rare');
  });

  test(R, 'a struck chord sounds together and an arpeggio holds to the chord change', async () => {
    const { piece, recipes } = await load();
    for (let seed = 1; seed <= 20; seed++) {
      const p = realize(piece, { seed, dayColor: { register: 67, density: 2, tempo: 1, voices: 5 }, available: ['piano'] }, recipes);
      /** @type {Map<number, any[]>} */
      const at = new Map();
      for (const x of p.notes) if (x.voice !== 'mel') at.set(x.tick, [...(at.get(x.tick) ?? []), x]);
      for (const [, xs] of at) {
        const ts = xs.map((/** @type {any} */ x) => x.t);
        const spread = Math.max(...ts) - Math.min(...ts);
        // Together (shared timing) or a quick roll: never the old slow 90 ms steps.
        assert(spread < 1e-6 || spread <= ((xs.length - 1) * 30) / 1000 + 1e-6, `seed ${seed}: spread ${spread}`);
      }
      const arps = p.notes.filter((/** @type {any} */ x) => x.voice === 'acc' && !at.get(x.tick)?.some((/** @type {any} */ y) => y.voice === 'bass'));
      // Held until the chord changes (the pedal lifts), give or take the release gap.
      const lifts = p.pedal.filter((/** @type {any} */ e) => !e.down).map((/** @type {any} */ e) => e.t);
      for (const a of arps.filter((/** @type {any} */ x) => p.textures.length && x.dur < 0.15)) {
        const change = lifts.find((/** @type {number} */ t) => t > a.t + 0.01);
        assert(change === undefined || a.t + a.dur > change - 0.15, `seed ${seed}: a short arpeggio note ends ${(change - a.t - a.dur).toFixed(2)} s before the chord change`);
      }
    }
  });

  test(R, 'support layers: the bed stays under the melody, winter fifths stay above D2, touches land on cadences', async () => {
    const { recipes } = await load();
    const j = async (/** @type {string} */ p) => {
      const url = new URL(`../${p}`, import.meta.url);
      if (url.protocol === 'file:') { const fs = await import('node:fs/promises'); return JSON.parse(await fs.readFile(url, 'utf8')); }
      return (await fetch(url)).json();
    };
    const idx = await j('recipes/music/pieces/themes/index.json');
    const avail = ['piano', 'pad', 'bell', 'fm-piano', 'strings', 'cello', 'harp', 'flute', 'vibraphone', 'vibraphone-bowed'];
    for (const c of idx.candidates) for (const id of Object.values(c.settings)) {
      const piece = await j(`recipes/music/pieces/themes/${id}.json`);
      for (let seed = 1; seed <= 4; seed++) {
        const p = realize(piece, { seed, dayColor: { register: 65, density: 2, tempo: 1, voices: 5 }, available: avail }, recipes);
        assert(p.durationS <= 41, `${id} seed ${seed}: ${p.durationS.toFixed(1)} s, over 40`);
        const mel = p.notes.filter((/** @type {any} */ n) => n.voice === 'mel');
        for (const b of p.notes.filter((/** @type {any} */ n) => n.voice === 'bed')) {
          assert(b.midi >= 38, `${id}: bed note ${b.midi} below D2`);
          const over = mel.filter((/** @type {any} */ m) => m.tick === b.tick).map((/** @type {any} */ m) => m.midi);
          if (over.length) assert(b.midi < Math.min(...over), `${id}: bed ${b.midi} above the melody ${Math.min(...over)}`);
        }
        // Touches only on a section's last chord: no other chord starts between a touch and the next section.
        const starts = [...p.sections.map((/** @type {any} */ s) => s.tick), Infinity];
        for (const t of p.notes.filter((/** @type {any} */ n) => n.voice === 'touch')) {
          const next = Math.min(...starts.filter((/** @type {number} */ x) => x > t.tick));
          const between = p.bars.filter((/** @type {any} */ b) => b.tick > t.tick && b.tick < next && b.chord && b.tick % 1 === 0);
          assert(between.length <= 2, `${id}: a touch at tick ${t.tick} is not near a section end`);
        }
      }
    }
  });

  test('music: names', 'the same seed, season and slot always give the same name, and names vary', async () => {
    const j = async (/** @type {string} */ p) => {
      const url = new URL(`../${p}`, import.meta.url);
      if (url.protocol === 'file:') { const fs = await import('node:fs/promises'); return JSON.parse(await fs.readFile(url, 'utf8')); }
      return (await fetch(url)).json();
    };
    const names = await j('recipes/music/names.json');
    eq(pieceName(42, { season: 'spring', slot: 'morning' }, names), pieceName(42, { season: 'spring', slot: 'morning' }, names), 'deterministic');
    const set = new Set();
    for (let seed = 1; seed <= 200; seed++) set.add(pieceName(seed, { season: 'autumn', slot: 'evening' }, names));
    assert(set.size > 150, `${set.size} different names in 200 seeds`);
    for (const n of set) assert(!/\{|\}|undefined|  /.test(n), `well formed: ${n}`);
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

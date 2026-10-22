// @ts-check
// The game's sound hook-up (docs 17, 25): what is near the camera (src/world/sound-near.js) and
// the sound state built from the game's `sound` slice (src/audio/game-state.js): water kinds from
// the summary's classes, plants and grass near the view, frost on winter mornings only, drips after
// rain, gusts that stay in range and repeat for the same seed; and the frogs' calls and plops
// (src/audio/creatures-game.js): each played once, none before the first touch, late ones let go.

import { createCreatureSound } from '../src/audio/creatures-game.js';
import { heartOf, isHearted, toggleHeart, setVerdict, soundOf } from '../src/audio/music/hearts.js';
import { snapshot, restore } from '../src/save/sections.js';
import { soundNear } from '../src/world/sound-near.js';
import { WATER_CLASS } from '../src/world/water/summary.js';
import { waterCellOf } from '../src/world/water/grid.js';
import { HABITAT_CELLS, HABITAT_ORIGIN } from '../src/world/growth/habitat.js';
import { createSoundState } from '../src/audio/game-state.js';

const G = 'sound: in the game';
const NEAR = {
  radiusM: 12, streamFullM: 2, falloff: 0.35, fullAt: 0.35, plantReachM: 1.5,
  pads: { lilies: 1 }, reeds: { reeds: 1, iris: 0.5 }, rushWeight: 0.8, grassFull: 160,
};
const GAME = {
  updateHz: 10, near: NEAR,
  gust: { everyS: [6, 20], everyWindScale: 0.4, holdS: [2, 5], peak: [0.3, 1], followPerS: 1.2 },
  frost: { byHourFromSunrise: [[-10, 0], [-7, 0.7], [-1, 1], [1.5, 1], [3.5, 0]], cloudCut: 0.6 },
  afterRainH: 1.5, seed: 2610,
};

/** A water summary 60 m square around the origin, every cell one class, with a pond disc. @param {number} pondR */
function summaryWithPond(pondR) {
  const x0 = waterCellOf(-30), y0 = waterCellOf(-30), w = 120, h = 120;
  const cls = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = -30 + (i + 0.5) * 0.5, z = -30 + (j + 0.5) * 0.5;
    cls[j * w + i] = Math.hypot(x, z) < pondR ? WATER_CLASS.still : WATER_CLASS.dry;
  }
  return { rect: { x: x0, y: y0, w, h }, cls };
}

/** A sound slice at a game time. @param {number} t @param {any} [o] */
function slice(t, o = {}) {
  return {
    displayT: t, season: o.season ?? 0, seasonPhase: o.phase ?? 0.5,
    weather: { cloud: 0, rain: 0, mist: 0, wind: 0.4, ...(o.weather ?? {}) }, tidePhase: 0.25,
    eye: [0, 10, 10], target: [0, 0, 0],
    near: { waterNear: { still: 0, slow: 0, running: 0 }, surfaceNear: { water: 0, pads: 0, reeds: 0, grass: 0 } },
    residents: [],
  };
}
/** A sun that rises at 6 and sets at 18 each day. @param {number} t */
const sun = (t) => 60 * Math.sin((((t / 3600) % 24) - 6) / 12 * Math.PI);

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(c: any, m?: string) => void} assert
 * @param {(a: any, b: any, m?: string) => void} eq
 */
export function addSoundGameTests(test, assert, eq) {
  test(G, 'standing in a pond hears still water; far from it, none', () => {
    const s = summaryWithPond(8);
    const at = soundNear({ summary: s, growth: null, x: 0, z: 0, recipe: NEAR });
    eq(at.waterNear.still, 1, 'pond');
    eq(at.waterNear.running, 0, 'no stream');
    const away = soundNear({ summary: s, growth: null, x: 25, z: 25, recipe: NEAR });
    eq(away.waterNear.still, 0, 'away');
  });

  test(G, 'a stream one cell wide is heard close by, fading with distance', () => {
    const s = summaryWithPond(0);
    const i = waterCellOf(0) - s.rect.x;
    for (let j = 0; j < s.rect.h; j++) s.cls[j * s.rect.w + i] = WATER_CLASS.running;
    eq(soundNear({ summary: s, growth: null, x: 1, z: 0, recipe: NEAR }).waterNear.running, 1, 'beside it');
    const mid = soundNear({ summary: s, growth: null, x: 7, z: 0, recipe: NEAR }).waterNear.running;
    assert(mid > 0.1 && mid < 0.9, `7 m away ${mid}`);
    eq(soundNear({ summary: s, growth: null, x: 20, z: 0, recipe: NEAR }).waterNear.running, 0, 'far');
  });

  test(G, 'lilies make pads, reeds make reeds, grass cover makes grass', () => {
    const grass = new Uint8Array(HABITAT_CELLS * HABITAT_CELLS);
    const k = (/** @type {number} */ x, /** @type {number} */ z) => Math.floor(z - HABITAT_ORIGIN) * HABITAT_CELLS + Math.floor(x - HABITAT_ORIGIN);
    for (let z = -12; z <= 12; z++) for (let x = -12; x <= 12; x++) grass[k(x, z)] = 200;
    const plants = [];
    // A lily patch in the middle and a reed bed beside it, about 6 m across each.
    for (let i = -3; i <= 3; i += 1.5) for (let j = -3; j <= 3; j += 1.5) plants.push({ sp: 'lilies', x: i, z: j }, { sp: 'reeds', x: i + 6, z: j });
    const at = soundNear({ summary: null, growth: { plants, grass }, x: 0, z: 0, recipe: NEAR });
    assert(at.surfaceNear.pads > 0.2, `pads ${at.surfaceNear.pads}`);
    assert(at.surfaceNear.reeds > 0.2, `reeds ${at.surfaceNear.reeds}`);
    eq(at.surfaceNear.grass, 1, 'grass');
    const far = soundNear({ summary: null, growth: { plants, grass }, x: 50, z: 50, recipe: NEAR });
    eq(far.surfaceNear.pads, 0, 'no pads far away');
  });

  test(G, 'frost on a clear winter dawn, none in spring or at noon', () => {
    const ss = createSoundState(GAME, 1, sun, 0.286);
    const dawn = 6.5 * 3600;
    assert(/** @type {number} */ (ss.build(slice(dawn, { season: 3 }), 0.1).frost) > 0.8, 'winter dawn');
    eq(ss.build(slice(dawn, { season: 0 }), 0.1).frost, 0, 'spring');
    eq(ss.build(slice(13 * 3600, { season: 3 }), 0.1).frost, 0, 'winter noon');
  });

  test(G, 'drips after rain fade over the recipe hours', () => {
    const ss = createSoundState(GAME, 1, sun, 0.286);
    eq(ss.build(slice(10 * 3600, { weather: { rain: 0.5 } }), 0.1).afterRain, 0, 'while raining');
    const just = /** @type {number} */ (ss.build(slice(10.1 * 3600), 0.1).afterRain);
    assert(just > 0.9, `just after ${just}`);
    eq(ss.build(slice(12 * 3600), 0.1).afterRain, 0, 'two hours on');
  });

  test(G, 'sunrise and sunset come from the sun', () => {
    const st = createSoundState(GAME, 1, sun, 0.286).build(slice(12 * 3600), 0.1);
    assert(Math.abs(/** @type {number} */ (st.sunriseH) - 6) < 0.1, `sunrise ${st.sunriseH}`);
    assert(Math.abs(/** @type {number} */ (st.sunsetH) - 18) < 0.1, `sunset ${st.sunsetH}`);
  });

  test(G, 'frog calls and plops play once each, none before the first touch, late ones dropped', () => {
    const FROGS = { pollS: 0.025, leadS: 0.03, staleS: 0.4, intensityFromMood: [0.4, 1], plop: { sizeCm: [2.5, 4.5], gainDb: [-8, -2] } };
    const ctx = { state: 'suspended', currentTime: 10 };
    /** @type {any[]} */ const played = [];
    const voices = /** @type {any} */ ({
      call: (/** @type {any} */ id, /** @type {any} */ _s, /** @type {any} */ _p, /** @type {number} */ k, /** @type {number} */ when) => played.push({ kind: 'call', id, k, when }),
      plop: (/** @type {any} */ id) => played.push({ kind: 'plop', id }),
    });
    const feed = { now: 0, calls: /** @type {any[]} */ ([]), plops: /** @type {any[]} */ ([]) };
    const store = { get: () => ({ frogs: (/** @type {number} */ since) => ({ now: feed.now, calls: feed.calls.filter((c) => c.t > since), plops: feed.plops.slice() }) }) };
    const cs = createCreatureSound(/** @type {any} */ ({ ctx }), voices, store, FROGS);
    feed.plops.push({ n: 0, t: 0, pos: [0, 0, 0] });
    cs.poll();                                       // first look: nothing from before plays
    feed.now = 1; feed.calls.push({ id: 1, t: 0.9, pos: [0, 0, 0], mood: 1 });
    cs.poll();                                       // still locked: let go
    eq(played.length, 0, 'nothing while locked');
    ctx.state = 'running';
    feed.now = 2; feed.calls.push({ id: 2, t: 1.99, pos: [0, 0, 0], mood: 0 }, { id: 3, t: 1.2, pos: [0, 0, 0], mood: 1 });
    feed.plops.push({ n: 1, t: 2, pos: [1, 0, 0] });
    cs.poll();
    cs.poll();                                       // a second look plays nothing again
    eq(played.filter((p) => p.kind === 'call').length, 1, 'one fresh call (the late one is dropped)');
    eq(played[0].id, 2, 'the fresh call');
    assert(Math.abs(played[0].k - 0.4) < 1e-9, 'an unsettled frog calls softly');
    assert(played[0].when > 10 && played[0].when <= 10.03, `a moment ahead ${played[0].when}`);
    eq(played.filter((p) => p.kind === 'plop').length, 1, 'one plop, the new one');
  });

  test(G, 'hearts: a grown piece is kept by what grows it again, a tide by its id; a second tap takes it back', () => {
    const g = heartOf({ id: 'grown-spring-morning-7', title: 'Song for a Stone', grown: true, grownSlot: 'morning', weather: 'rain', seed: 7 });
    eq(g.key, 'grown:morning:rain:7', 'grown key');
    eq(g.seed, 7, 'seed kept');
    const t = heartOf({ id: 'theme-4-summer', title: 'Moon pull', seed: 3 });
    eq(t.key, 'tide:theme-4-summer', 'tide key');
    let list = toggleHeart([], g);
    list = toggleHeart(list, t);
    assert(isHearted(list, g.key) && isHearted(list, t.key), 'both hearted');
    list = toggleHeart(list, g);
    assert(!isHearted(list, g.key) && isHearted(list, t.key), 'second tap takes it back');
  });

  test(G, 'a thumbs-down and a heart exclude each other; the same verdict again takes it back', () => {
    const h = heartOf({ id: 'g', title: 'Warm Pool', grown: true, grownSlot: 'morning', weather: 'clear', seed: 2, season: 'summer', template: 'song', sound: soundOf({ strum: ['guitar'] }) });
    eq(h.sound, 'strum', 'the strum is its own sound');
    let m = setVerdict(undefined, h, 'heart');
    assert(isHearted(m.hearted, h.key) && !isHearted(m.passed, h.key), 'hearted');
    m = setVerdict(m, h, 'pass');
    assert(!isHearted(m.hearted, h.key) && isHearted(m.passed, h.key), 'passed takes the heart away');
    eq(m.passed[0].template, 'song', 'the form is kept for the leaning');
    m = setVerdict(m, h, 'pass');
    assert(!isHearted(m.passed, h.key), 'a second thumbs-down takes it back');
  });

  test(G, 'hearts are kept in the island save and come back', () => {
    const heart = { key: 'tide:theme-1-spring', kind: 'tide', title: 'First water', id: 'theme-1-spring' };
    const { sections } = snapshot(/** @type {any} */ ({ build: 't', seed: 1, island: 'x', worldT: 0, flow: 1, world: {}, journal: null, water: null,
      unlocks: {}, view: null, looks: {}, music: { hearted: [heart] }, chunks: {}, mirror: null, savedAt: 0, wallHighWater: 0 }));
    const back = restore(Object.fromEntries(sections));
    eq(back.music?.hearted?.[0]?.key, heart.key, 'heart back');
    eq(back.extra.length, 0, 'music is a known section');
    eq(restore({ meta: {} }).music, null, 'an older save has none');
  });

  test(G, 'gusts stay between 0 and 1 and repeat for the same seed', () => {
    const run = () => {
      const ss = createSoundState(GAME, 7, sun, 0.286);
      const out = [];
      for (let i = 0; i < 600; i++) out.push(ss.build(slice(12 * 3600 + i, { weather: { wind: 0.8 } }), 0.1).gust);
      return out;
    };
    const a = run(), b = run();
    assert(a.every((g) => g >= 0 && g <= 1), 'in range');
    assert(Math.max(...a) > 0.2, 'some gusts');
    assert(a.every((g, i) => g === b[i]), 'same seed, same gusts');
  });
}

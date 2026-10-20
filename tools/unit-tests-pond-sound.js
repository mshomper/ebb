// @ts-check
// The pond tier's small sounds (M2; doc 25 "Creature voices"): a minnow's sip each time one rises
// and rings the surface, and a southern hawker's wing rattle heard only when one flies close by
// (src/audio/creatures-game.js, src/audio/voices.js, src/audio/voices/dragonfly.js). The first
// tests run anywhere; the ones that render sound need a browser (an OfflineAudioContext) and say
// "skipped" in Node.

import { createCreatureSound } from '../src/audio/creatures-game.js';
import { createVoices } from '../src/audio/voices.js';
import { createWingVoice, rattleBuffer, wingRecipe } from '../src/audio/voices/dragonfly.js';
import { stream } from '../src/core/rng.js';

const G = 'sound: pond life';
const FROGS = { pollS: 0.025, leadS: 0.03, staleS: 0.4, intensityFromMood: [0.4, 1], duckNearM: 8, duckHoldS: 4 };
const POND = { sips: ['minnows'], wings: ['dragonflies'], leadS: 0.03, staleS: 0.4 };

/** A recipe file, by fetch in the browser and from disk in Node. @param {string} path e.g. 'species/minnow' */
async function recipe(path) {
  const url = new URL(`../recipes/${path}.json`, import.meta.url);
  if (typeof window === 'undefined') {
    const fs = await import('node:fs');
    return JSON.parse(fs.readFileSync(url, 'utf8'));
  }
  return (await fetch(url, { cache: 'no-cache' })).json();
}

const noBrowser = () => typeof OfflineAudioContext === 'undefined';
const SR = 48000;

/** RMS (dBFS) of a rendered buffer from t0 to t1 seconds. @param {AudioBuffer} b @param {number} t0 @param {number} t1 */
function rmsDb(b, t0, t1) {
  const d = b.getChannelData(0);
  let s = 0, n = 0;
  for (let i = Math.floor(t0 * b.sampleRate); i < Math.min(d.length, t1 * b.sampleRate); i++) { s += d[i] * d[i]; n++; }
  const r = Math.sqrt(s / Math.max(1, n));
  return r > 1e-9 ? 20 * Math.log10(r) : -180;
}
/** Peak (dBFS) of a rendered buffer. @param {AudioBuffer} b */
function peakDb(b) {
  let p = 0;
  for (let c = 0; c < b.numberOfChannels; c++) for (const v of b.getChannelData(c)) p = Math.max(p, Math.abs(v));
  return p > 1e-9 ? 20 * Math.log10(p) : -180;
}

/** @param {(g: string, n: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addPondSoundTests(test, assert, eq) {
  test(G, 'minnow sips: one per new rise, none on the first look or before the first touch, late ones let go', () => {
    const ctx = { state: 'suspended', currentTime: 10 };
    /** @type {{pos: number[], when: number}[]} */ const sips = [];
    const voices = /** @type {any} */ ({ sip: (/** @type {number[]} */ pos, /** @type {number} */ when) => sips.push({ pos, when }), setFlyers() {}, setSwarms() {}, setListener() {}, setSeason() {} });
    const school = { species: 'minnows', id: 1, each: [], now: 0, rises: /** @type {any[]} */ ([]) };
    const store = { get: () => ({ schools: () => [school] }) };
    const cs = createCreatureSound(/** @type {any} */ ({ ctx }), voices, store, FROGS, POND);
    school.rises.push({ n: 0, t: 0, pos: [0, 0, 0] });
    cs.poll();                                        // first look: nothing from before plays
    school.now = 1; school.rises.push({ n: 1, t: 1, pos: [1, 0, 0] });
    cs.poll();                                        // still locked: let go
    eq(sips.length, 0, 'nothing while locked');
    ctx.state = 'running';
    school.now = 3; school.rises.push({ n: 2, t: 2.99, pos: [2, 0, 0] }, { n: 3, t: 2, pos: [3, 0, 0] });
    cs.poll();
    cs.poll();                                        // a second look plays nothing again
    eq(sips.length, 1, 'one fresh sip (the late one is let go)');
    eq(sips[0].pos[0], 2, 'the fresh one, at its ring');
    assert(sips[0].when > 10 && sips[0].when <= 10.03, `a moment ahead ${sips[0].when}`);
  });

  test(G, 'the first rise of a new school is heard once the minnows have been looked at', () => {
    const ctx = { state: 'running', currentTime: 5 };
    let n = 0;
    const voices = /** @type {any} */ ({ sip: () => n++ });
    const school = { species: 'minnows', id: 1, each: [], now: 0, rises: /** @type {any[]} */ ([]) };
    const cs = createCreatureSound(/** @type {any} */ ({ ctx }), voices, { get: () => ({ schools: () => [school] }) }, FROGS, POND);
    cs.poll();                                        // first look, no rises yet
    school.now = 0.1; school.rises.push({ n: 0, t: 0.05, pos: [0, 0, 0] });
    cs.poll();
    eq(n, 1, 'the very first ring sips');
  });

  test(G, 'dragonflies: each one goes to the wings with its place and speed; minnows never do', () => {
    /** @type {any[]} */ let flyers = [];
    const voices = /** @type {any} */ ({ setFlyers: (/** @type {any[]} */ f) => { flyers = f; }, setSwarms() {}, setListener() {}, setSeason() {} });
    const schools = [
      { species: 'dragonflies', id: 4, each: [[1, 1, 1, 1, 2.5], [2, 1, 2, 0, 0]], rises: [] },
      { species: 'minnows', id: 1, each: [[0, -0.2, 0, 1, 0.1]], rises: [] },
    ];
    const cs = createCreatureSound(/** @type {any} */ ({ ctx: { state: 'running', currentTime: 0 } }), voices, { get: () => ({ schools: () => schools }) }, FROGS, POND);
    cs.update([0, 1, 0], [0, 0, -1], [0, 1, 0, 0]);
    eq(flyers.length, 2, 'both dragonflies, no minnows');
    eq(flyers[0].id, 'dragonflies:4:0', 'a lasting id per dragonfly');
    assert(flyers[0].flying && Math.abs(flyers[0].speed - 2.5) < 1e-9, 'the first darts');
    assert(!flyers[1].flying, 'the second is on a perch');
  });

  test(G, 'recipes: the wings beat at the drawn rate, are heard within about 2 m, louder darting', async () => {
    const df = await recipe('species/dragonfly');
    const mn = await recipe('species/minnow');
    const game = await recipe('audio/game');
    const W = wingRecipe(df);
    eq(W.model, 'wing-rattle', 'model');
    eq(W.wingHz, df.motion.wingHz, 'beat rates from the motion');
    eq(W.dartMps, df.motion.dartMps, 'dart speed from the motion');
    assert(W.reachM >= 1.5 && W.reachM <= 3, `reach about 2 m (${W.reachM})`);
    assert(W.dartDb > W.hoverDb, 'louder darting than hovering');
    eq(mn.voice.model, 'surface-sip', 'the minnow sips');
    assert(game.pond.sips.includes(mn.key) && game.pond.wings.includes(df.key), 'the game hears both species');
  });

  test(G, 'wing rattle: the same dragonfly always sounds the same, another a little different', () => {
    if (noBrowser()) return 'skipped: needs a browser';
    return recipe('species/dragonfly').then((df) => {
      const R = wingRecipe(df);
      const ctx = new OfflineAudioContext(1, SR, SR);
      const a = rattleBuffer(ctx, R, stream(7, 3)).getChannelData(0);
      const b = rattleBuffer(ctx, R, stream(7, 3)).getChannelData(0);
      const c = rattleBuffer(ctx, R, stream(8, 3)).getChannelData(0);
      eq(a.length, Math.round((R.beats / R.baseHz) * SR), 'a whole number of beats');
      let same = true, diff = false;
      for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) same = false; if (a[i] !== c[i]) diff = true; }
      assert(same, 'same seed, same rattle');
      assert(diff, 'another seed, another rattle');
    });
  });

  test(G, 'wing rattle: louder darting than hovering, silent on a perch and beyond about 2 m', async () => {
    if (noBrowser()) return 'skipped: needs a browser';
    const R = wingRecipe(await recipe('species/dragonfly'));
    /** @param {number[]} pos @param {number} speed @param {boolean} flying */
    const render = async (pos, speed, flying) => {
      const ctx = new OfflineAudioContext(2, SR * 1.2, SR);
      const v = createWingVoice(ctx, ctx.destination, R, 12345, 'desktop');
      v.set(pos, [0, 0, 0], speed, flying);
      return rmsDb(await ctx.startRendering(), 0.4, 1.2);
    };
    const hover = await render([0, 0, -1], 0.1, true);
    const dart = await render([0, 0, -1], R.dartMps, true);
    const perched = await render([0, 0, -1], 0, false);
    const far = await render([0, 0, -(R.reachM + 0.5)], R.dartMps, true);
    assert(dart > hover + 5, `darting ${dart.toFixed(1)} dB over hovering ${hover.toFixed(1)} dB`);
    assert(perched < hover - 40, `perched ${perched.toFixed(1)} dB`);
    assert(far < hover - 40, `beyond reach ${far.toFixed(1)} dB`);
    return `at 1 m: hovering ${hover.toFixed(1)} dB, darting ${dart.toFixed(1)} dB (RMS)`;
  });

  test(G, 'minnow sip: a tiny soft plop, well under a frog plop, heard only near the school', async () => {
    if (noBrowser()) return 'skipped: needs a browser';
    const [frog, mn, proc, game] = await Promise.all([recipe('species/frog'), recipe('species/minnow'), recipe('audio/procedural'), recipe('audio/game')]);
    /** @param {(v: ReturnType<typeof createVoices>) => boolean} play */
    const render = async (play) => {
      const ctx = new OfflineAudioContext(2, SR * 1.5, SR);
      const mixer = /** @type {any} */ ({ ctx, input: () => ctx.destination, setListener() {} });
      const v = createVoices(mixer, { frog: frog.voice, minnow: mn.voice, proc, plop: game.frogs.plop }, 1, { tier: 'desktop' });
      v.setListener([0, 0.5, 0], [0, 0, -1]);
      const ok = play(v);
      return { ok, peak: peakDb(await ctx.startRendering()) };
    };
    const sip = await render((v) => v.sip([0, 0, -2], 0.1));
    const plop = await render((v) => v.plop('f', [0, 0, -2], 0.1));
    const far = await render((v) => v.sip([0, 0, -(mn.voice.reachM + 1)], 0.1));
    assert(sip.ok && sip.peak > -70, `the sip sounds (${sip.peak.toFixed(1)} dB)`);
    assert(sip.peak < plop.peak - 4, `sip ${sip.peak.toFixed(1)} dB under the frog plop ${plop.peak.toFixed(1)} dB`);
    assert(!far.ok && far.peak < -150, 'too far: no sip');
    return `at 2 m: sip peak ${sip.peak.toFixed(1)} dB, frog plop ${plop.peak.toFixed(1)} dB`;
  });
}

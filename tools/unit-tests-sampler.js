// @ts-check
// Sampler math tests (doc 24, "Sampler rules"): no layer steps on a slow crescendo, files leveled
// by their measured attack, tuning policies, damping and voice stealing.

import {
  layerWeights, evenBounds, velocityDb, fileGainDb, registerTiltDb, velocityCutoffHz, nearestZone,
  stretchCents, correctionCents, playbackRate, damperTau, pickVictim, midiToHz, dbToGain,
} from '../src/audio/music/sampler-math.js';
import { createSampler } from '../src/audio/music/sampler.js';

const G = 'music: sampler';

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addSamplerTests(test, assert, eq) {
  const close = (/** @type {number} */ a, /** @type {number} */ b, tol = 1e-9, msg = '') =>
    assert(Math.abs(a - b) <= tol, `${msg} expected ${b}, got ${a}`);

  test(G, 'three layers split 1..127 evenly', () => {
    eq(JSON.stringify(evenBounds(3)), JSON.stringify([43, 85]));
    eq(JSON.stringify(evenBounds(1)), JSON.stringify([]));
  });

  test(G, 'blend laws: equal power keeps power, straight line keeps amplitude', () => {
    for (const v of [38, 40, 43, 46, 48]) {
      const ep = layerWeights(v, [43, 85], 12, 1).reduce((s, x) => s + x.weight * x.weight, 0);
      const ln = layerWeights(v, [43, 85], 12, 0).reduce((s, x) => s + x.weight, 0);
      close(ep, 1, 1e-9, `equal power at ${v}`);
      close(ln, 1, 1e-9, `straight line at ${v}`);
    }
  });

  test(G, 'one layer outside a crossfade, two inside, always equal power', () => {
    const b = [43, 85];
    for (let v = 1; v <= 127; v++) {
      const w = layerWeights(v, b, 12);
      const p = w.reduce((s, x) => s + x.weight * x.weight, 0);
      close(p, 1, 1e-9, `power at velocity ${v}`);
      if (Math.abs(v - 43) >= 6 && Math.abs(v - 85) >= 6) eq(w.length, 1, `layers at velocity ${v}`);
    }
    eq(layerWeights(1, b, 12)[0].layer, 0);
    eq(layerWeights(64, b, 12)[0].layer, 1);
    eq(layerWeights(127, b, 12)[0].layer, 2);
  });

  test(G, 'a slow crescendo has no step: each layer\'s weight changes by at most 0.2 per velocity step', () => {
    const b = [43, 85];
    /** @param {number} v */
    const vec = (v) => { const r = [0, 0, 0]; for (const x of layerWeights(v, b, 12)) r[x.layer] = x.weight; return r; };
    let worst = 0;
    for (let v = 1; v < 127; v++) {
      const a = vec(v), c = vec(v + 1);
      for (let i = 0; i < 3; i++) worst = Math.max(worst, Math.abs(a[i] - c[i]));
    }
    assert(worst <= 0.2, `largest jump ${worst.toFixed(3)}`);
  });

  test(G, 'velocity curve runs from floor to top and only rises', () => {
    const c = { floorDb: -38, topDb: -6, gamma: 1.6 };
    close(velocityDb(1, c), -38);
    close(velocityDb(127, c), -6);
    for (let v = 2; v <= 127; v++) assert(velocityDb(v, c) > velocityDb(v - 1, c), `rises at ${v}`);
  });

  test(G, 'files are leveled by their measured attack', () => {
    // Two recordings of different measured loudness land at the same level once gained.
    const target = -20;
    close(fileGainDb(target, -12) + -12, target);
    close(fileGainDb(target, -18) + -18, target);
  });

  test(G, 'register tilt: zero at the pivot, bass and treble at the ends', () => {
    const t = { bassDb: 2, trebleDb: -3, pivotMidi: 60 };
    close(registerTiltDb(60, t), 0);
    close(registerTiltDb(21, t), 2);
    close(registerTiltDb(108, t), -3);
  });

  test(G, 'brightness opens with velocity but never cuts below a note\'s own harmonics', () => {
    const f = { lowHz: 1800, highHz: 12000, minHarmonic: 4, gamma: 1 };
    close(velocityCutoffHz(1, 48, f), 1800, 1e-6);
    close(velocityCutoffHz(127, 48, f), 12000, 1e-6);
    assert(velocityCutoffHz(1, 96, f) >= 4 * midiToHz(96) - 1e-6, 'C7 keeps four harmonics');
  });

  test(G, 'nearest zone, and the zone below wins a tie', () => {
    const zones = [21, 23, 25, 27, 29];
    eq(nearestZone(23, zones), 1);
    eq(nearestZone(24, zones), 1);
    eq(nearestZone(26, zones), 2);
    eq(nearestZone(40, zones), 4);
    eq(nearestZone(60, []), -1);
  });

  test(G, 'stretch curve: flat in the bass, sharp in the treble, almost exact in the middle', () => {
    const s = { bassCents: -12, trebleCents: 20, pivotMidi: 64 };
    close(stretchCents(21, s), -12);
    close(stretchCents(108, s), 20);
    close(stretchCents(64, s), 0);
    assert(Math.abs(stretchCents(52, s)) < 0.5 && Math.abs(stretchCents(76, s)) < 0.5, 'middle octave within half a cent');
  });

  test(G, 'tuning policies', () => {
    const t = { minConfidence: 0.5, stretch: { bassCents: -12, trebleCents: 20, pivotMidi: 64 } };
    close(correctionCents('recorded', 60, 7, 1, t), 0);
    close(correctionCents('equal', 60, 7, 1, t), -7);
    close(correctionCents('equal', 60, -2.5, 1, t), 2.5);
    close(correctionCents('stretch', 108, 14, 1, t), 6);
    close(correctionCents('equal', 60, 7, 0.2, t), 0, 0, 'low confidence leaves a zone as recorded');
  });

  test(G, 'playback rate: a semitone up, and a cents correction', () => {
    close(playbackRate(61, 60, 0), Math.pow(2, 1 / 12));
    close(playbackRate(60, 60, -1200), 0.5);
  });

  test(G, 'dampers: slow in the bass, quick in the treble, none at the top', () => {
    const d = { bassS: 0.35, trebleS: 0.07, undampedFromMidi: 89 };
    close(damperTau(21, d), 0.35);
    assert(damperTau(70, d) < damperTau(40, d), 'treble damps faster');
    eq(damperTau(89, d), Infinity);
    eq(damperTau(100, d), Infinity);
  });

  test(G, 'voice stealing takes the quietest released voice first', () => {
    eq(pickVictim([{ released: false, levelDb: -40 }, { released: true, levelDb: -20 }, { released: true, levelDb: -30 }]), 2);
    eq(pickVictim([{ released: false, levelDb: -10 }, { released: false, levelDb: -25 }]), 1);
    eq(pickVictim([]), -1);
  });

  test(G, 'decibels to gain', () => {
    close(dbToGain(0), 1);
    close(dbToGain(-20), 0.1, 1e-12);
  });

  test(G, 'the sampler always plays the full set (an old phone set in a recipe is ignored)', () => {
    // A tiny made-up recipe: three layers every whole tone, and a leftover phone set of two layers
    // every major third. Nothing is decoded; filesFor only names the recordings a note would use.
    const zone = (/** @type {number} */ midi, /** @type {number[]} */ ls, /** @type {string} */ tag) =>
      ({ midi, layers: ls.map((l, i) => ({ file: `${tag}/${midi}-v${l}`, layer: i + 1, attackRmsDb: -16 })) });
    const full = [60, 62, 64, 66, 68].map((m) => zone(m, [1, 2, 3], 'sus'));
    const recipe = {
      root: 'full/', layers: 3, sets: { sus: { zones: full } },
      mobile: { root: 'phone/', layers: 2, sets: { sus: { zones: [60, 64, 68].map((m) => zone(m, [1, 3], 'sus')) } } },
    };
    const settings = { layers: { bounds: [], fadeWidth: 20, law: 0.5, blend: 'mix', seed: 1 }, exclude: [] };
    const ctx = /** @type {any} */ ({ currentTime: 0 });
    const s = createSampler(ctx, /** @type {any} */ (null), recipe, settings, { format: 'ogg' });
    eq(s.zones('sus').length, 5, 'full zones');
    eq(s.instrument.root, 'full/', 'full folder');
    eq(s.filesFor(62, 64, true).join(' '), 'sus/62-v2', 'middle velocity uses its middle layer');
  });
}

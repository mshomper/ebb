// @ts-check
// The sound of the waterfalls (M2 Cliff tool; docs/07, 17): lips read back from the GPU joined into
// falls (src/world/falls-near.js), the nearest kept, and each fall's level (src/audio/ambience/falls.js):
// louder with flow and height, fading to silence with distance, rumbling only when big.

import { groupFalls, fallsNear, LIP_FLOATS } from '../src/world/falls-near.js';
import { fallLevel, fallsLoudness } from '../src/audio/ambience/falls.js';
import { createSoundState } from '../src/audio/game-state.js';

const G = 'sound: waterfalls';
const JOIN = { joinM: 1, topM: 0.6, reachM: 40, voices: 3, minFlowM3s: 0.0001 };
const F = {
  voices: 3, refPowerM4s: 0.05, dbAtRef: 0, dbRange: [-24, 3],
  distance: { refM: 3, fadeFromM: 25, reachM: 40 },
  roar: { fromPowerM4s: [0.004, 0.12] },
};

/** Lips in a row along x at z, each 0.5 m apart, falling from top to land, flow q m2/s. */
function row(/** @type {number} */ n, /** @type {number} */ x0, /** @type {number} */ z, /** @type {number} */ top, /** @type {number} */ land, /** @type {number} */ q) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(x0 + i * 0.5, top, z, land, 0, 1, 1, q, 0, 0, 0, 0);
  return out;
}

/** @param {(g: string, n: string, fn: () => void) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addFallsSoundTests(test, assert, eq) {
  test(G, 'lips side by side are one fall; a fall far off is another', () => {
    const lips = [...row(4, 0, 0, 5, 1, 0.02), ...row(2, 20, 0, 3, 2, 0.002)];
    const falls = groupFalls(lips, lips.length / LIP_FLOATS, JOIN);
    eq(falls.length, 2, 'falls');
    const big = falls.find((f) => f.widthM === 2);
    assert(big, 'a four-lip fall');
    assert(Math.abs(big.heightM - 4) < 1e-6, 'drop of 4 m');
    assert(Math.abs(big.flowM3s - 4 * 0.02 * 0.5) < 1e-9, 'flow adds up across its lips');
    assert(Math.abs(big.pos[1] - 3) < 1e-6, 'placed halfway down');
  });

  test(G, 'a lip at another height beside a fall is a separate fall', () => {
    const lips = [...row(2, 0, 0, 5, 1, 0.01), ...row(1, 1, 0, 2, 1, 0.01)];
    eq(groupFalls(lips, 3, JOIN).length, 2);
  });

  test(G, 'the same lips give the same falls', () => {
    const lips = [...row(3, 0, 0, 5, 1, 0.01), ...row(3, 8, 2, 4, 1, 0.005)];
    eq(JSON.stringify(groupFalls(lips, 6, JOIN)), JSON.stringify(groupFalls(lips, 6, JOIN)));
  });

  test(G, 'only the nearest few within reach, nearest first', () => {
    const falls = [10, 50, 5, 30, 20].map((x) => ({ pos: [x, 0, 0], heightM: 2, flowM3s: 0.01, widthM: 1 }));
    const near = fallsNear(falls, 0, 0, 0, JOIN);
    eq(near.length, 3, 'voices');
    eq(near.map((f) => f.pos[0]).join(','), '5,10,20', 'order');
    eq(fallsNear(falls, 0, 0, 0, { ...JOIN, minFlowM3s: 1 }).length, 0, 'too little water');
  });

  test(G, 'louder with more water and a longer drop; silent at reach', () => {
    /** @param {number} q @param {number} h @param {number} d */
    const at = (q, h, d) => fallLevel({ pos: [0, 0, 0], flowM3s: q, heightM: h, distM: d }, F);
    assert(at(0.02, 4, 3).gain > at(0.002, 4, 3).gain, 'more water is louder');
    assert(at(0.01, 6, 3).gain > at(0.01, 1, 3).gain, 'a longer drop is louder');
    assert(at(0.01, 3, 3).gain > at(0.01, 3, 15).gain, 'nearer is louder');
    eq(at(0.01, 3, 40).gain, 0, 'silent at reach');
    assert(at(0.04, 4, 3).roar > 0.5 && at(0.0005, 1, 3).roar === 0, 'only a big fall rumbles');
    eq(fallsLoudness([], F), 0, 'no falls, no dip');
  });

  test(G, 'the sound state carries the falls from the game', () => {
    const st = createSoundState({
      updateHz: 10, gust: { everyS: [6, 20], everyWindScale: 0.4, holdS: [2, 5], peak: [0.3, 1], followPerS: 1.2 },
      frost: { byHourFromSunrise: [[0, 0]], cloudCut: 0.6 }, afterRainH: 1.5, seed: 1,
    }, 1, (t) => Math.sin(((t % 86400) / 86400 - 0.25) * 2 * Math.PI) * 60, 0.15);
    const fall = { pos: [1, 2, 3], heightM: 3, flowM3s: 0.01, distM: 4 };
    const s = st.build({
      displayT: 43200, season: 1, seasonPhase: 0.5, weather: { cloud: 0, rain: 0, mist: 0, wind: 0 }, tidePhase: 0,
      eye: [0, 10, 10], target: [0, 0, 0], residents: [],
      near: { waterNear: { still: 0, slow: 0, running: 0 }, surfaceNear: { water: 0, pads: 0, reeds: 0, grass: 0 }, falls: [fall] },
    }, 0.1);
    eq(s.falls?.length, 1);
    eq(s.falls?.[0].flowM3s, 0.01);
  });
}

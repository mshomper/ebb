// @ts-check
// Canvas weathering (B1 C2; docs/future/13 C-35, section 9.3): the seasons since the tent was first
// pitched, the canvas's fade and the poles' silver eased to their caps after about a year, patches
// sewn on from patchAtSeasons, placed the same for a tent seed, the dye hook's fade, and the tent
// prop's fields from the camp's firstPitchedHour.

import { seasonsSince, easeTo, canvasWear, canvasPatches, dyeFadeShare, dyeTint, tentWeather } from '../src/world/camp/canvas.js';

const G = 'camp: canvas weathering';
const H = 24 * 14;
/** @param {string} p */
const load = async (p) => (await fetch(new URL(`../recipes/${p}.json`, import.meta.url))).json();

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addCampCanvasTests(test, assert, eq) {
  test(G, 'seasons since the first pitch: 14 game days a season, none before it or with no pitch', () => {
    eq(seasonsSince(100, 100), 0, 'just pitched');
    eq(seasonsSince(100 + H, 100), 1, 'one season');
    eq(seasonsSince(100 + 4 * H, 100), 4, 'a year');
    eq(seasonsSince(50, 100), 0, 'never negative');
    eq(seasonsSince(500, null), 0, 'not pitched yet');
  });

  test(G, 'the knobs are the spec\'s: fade over 4 seasons, the first patch at 2, poles silver over 3', async () => {
    const R = await load('world/camp');
    eq(R.canvas.fadeSeasons, 4, 'canvas.fadeSeasons');
    eq(R.canvas.patchAtSeasons, 2, 'canvas.patchAtSeasons');
    eq(R.poles.silverSeasons, 3, 'poles.silverSeasons');
  });

  test(G, 'the fade and the silver ease out, rise every season and stop at their caps after about a year', async () => {
    const R = await load('world/camp'), C = R.canvas, P = R.poles;
    const at = (/** @type {number} */ s) => canvasWear(s, C, P);
    eq(at(0).fade, 0, 'a new tent has not faded');
    eq(at(0).silver, 0, 'new poles are not silvered');
    eq(at(0).patches, 0, 'no patches on a new tent');
    let last = -1;
    for (let s = 0; s <= 4; s += 0.25) { assert(at(s).fade > last || s === 0, `the fade rises at ${s} seasons`); last = at(s).fade; }
    assert(at(1).fade > 0.3 * C.fadeCap && at(1).fade < 0.6 * C.fadeCap, 'about two fifths faded after one season (eased out)');
    eq(at(4).fade, C.fadeCap, 'fully faded at a year');
    eq(at(9).fade, C.fadeCap, 'and no further after');
    eq(at(3).silver, P.silverCap, 'the poles fully silver at three seasons (doc 09)');
    assert(at(1.5).silver < P.silverCap && at(1.5).silver > at(1).silver, 'silvering on the way at a season and a half');
    eq(easeTo(-1, 4), 0, 'the ease never goes below 0');
  });

  test(G, 'patches: the first at patchAtSeasons, one more each patchEverySeasons, never more than patchMax', async () => {
    const R = await load('world/camp'), C = R.canvas, P = R.poles;
    const n = (/** @type {number} */ s) => canvasWear(s, C, P).patches;
    eq(n(1), 0, 'none after one season');
    eq(n(C.patchAtSeasons - 0.01), 0, 'none just before');
    eq(n(C.patchAtSeasons), 1, 'the first');
    eq(n(C.patchAtSeasons + C.patchEverySeasons), 2, 'the second');
    eq(n(40), C.patchMax, 'never more than patchMax');
  });

  test(G, 'patches sit on the tent\'s slopes, the same for one seed and different for another', async () => {
    const C = (await load('world/camp')).canvas;
    const a = canvasPatches(1234, C), b = canvasPatches(1234, C), c = canvasPatches(99, C);
    eq(a.length, C.patchMax, 'patchMax of them');
    eq(JSON.stringify(a), JSON.stringify(b), 'deterministic for a seed');
    assert(JSON.stringify(a) !== JSON.stringify(c), 'another island wears other patches');
    for (const q of a) {
      assert(q.side === 1 || q.side === -1, 'on one slope or the other');
      assert(q.z >= C.patchZ[0] && q.z <= C.patchZ[1] && q.y >= C.patchY[0] && q.y <= C.patchY[1], 'within the slope');
      assert(q.hw >= C.patchHalfM[0][0] && q.hw <= C.patchHalfM[0][1] && q.hh >= C.patchHalfM[1][0] && q.hh <= C.patchHalfM[1][1], 'patch sized');
      assert(Math.abs(q.turn) <= C.patchTurn, 'only a little turned');
    }
  });

  test(G, 'the dye hook fades as section 9.3 says: about a third after a season, never past 0.6', async () => {
    const D = (await load('world/camp')).canvas.dye;
    eq(dyeFadeShare(0, D), 0, 'fresh');
    assert(Math.abs(dyeFadeShare(1, D) - (1 - Math.exp(-1 / 2.5))) < 1e-12, 'one season: 1 - exp(-1/2.5)');
    eq(dyeFadeShare(50, D), 0.6, 'capped at 0.6');
    const t = dyeTint([1, 0, 0], 50, D);
    eq(t[3], 1, 'marked dyed');
    assert(Math.abs(t[1] - D.weathered[1] * 0.6) < 1e-12, 'slid 0.6 of the way toward weathered canvas');
  });

  test(G, 'the tent prop\'s fields from the camp\'s firstPitchedHour: undyed, and the same at the same hour', async () => {
    const R = await load('world/camp');
    const w = tentWeather(1000 + 4 * H, 1000, R.canvas, R.poles);
    eq(w.wear.length, 4, 'wear: fade, silver, patches, spare');
    eq(w.wear[0], R.canvas.fadeCap, 'a year on: faded');
    eq(w.wear[2], R.canvas.patchMax, 'and patched');
    eq(JSON.stringify(w.dye), JSON.stringify([0, 0, 0, 0]), 'undyed until Phase 4');
    eq(JSON.stringify(tentWeather(1000, null, R.canvas, R.poles).wear), JSON.stringify([0, 0, 0, 0]), 'an older save with no first pitch: a new tent');
  });
}

// @ts-check
// Shaped ground and visits tests for tools/unit-tests.html (B3 S0; src/world/ecology/shaped.js,
// shaped-live.js, visits.js, src/world/hints/morning.js visit hints): on the starter island as it
// begins nothing counts (its spit, rocky point and pond are scenery); a raised bar, a Terrace sea
// wall and a dug pond, shaped as the `?shape=` links shape them, each read with their numbers; a wall
// takes coast (homes compete); pond ages, wrack streaks and the seals' quiet are kept; a visit day
// comes from the seed alone, a visit while away leaves flags but is not shown, visits stop once the
// home is made; and a visit hint waits for the morning after, repeats now and then, and rings the spot.

import { patchOf, patches, shapedReport, homeOf, homeFit } from '../src/world/ecology/shaped.js';
import { rememberPonds, wrackSince, noteStep, quietAt, cleanShaped, emptyShaped } from '../src/world/ecology/shaped-live.js';
import { visitInWindow, visitsBetween, visitStep, visitorsOf } from '../src/world/ecology/visits.js';
import { pickHint, showMeOf, visitAt, hintDone, shownFlag } from '../src/world/hints/morning.js';
import { SECTIONS9, clean9 } from '../src/save/migrate-format9.js';
import { seasonOf, SECONDS_PER_DAY } from '../src/core/clock.js';
import { loadShapedRecipes, shapedIsland } from './shaped-world.js';

const G = 'shaped';

/** A visit block like a seal's, for the tests. */
const SEAL = { seasons: [2, 3], everyDays: 4, chance: 1, hours: [9, 15], show: { kind: 'surface', lastsH: 1, where: 'sea' },
  home: { check: 'bar', need: { areaM2: 18, lengthM: 6, widthM: 3, quiet: true } } };

/** The first autumn game day. */
const AUTUMN = 28;

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addShapedTests(test, assert, eq) {
  const RP = loadShapedRecipes();
  /** @type {Map<string, any>} */ const islands = new Map();
  /** An island shaped with these grounds, built once. @param {string[]} kinds */
  const island = async (kinds) => {
    const key = kinds.join(',');
    if (!islands.has(key)) islands.set(key, shapedIsland(await RP, kinds));
    return islands.get(key);
  };

  test(G, 'a patch reads its length and width from its spread', () => {
    const n = 20, cells = [];
    for (let j = 5; j < 8; j++) for (let i = 2; i < 8; i++) cells.push(j * n + i);
    const p = patchOf(cells, n);
    eq(p.lengthM, 6, 'a 6 x 3 rectangle is 6 long');
    eq(p.widthM, 3, 'and 3 wide');
    eq(p.areaM2, 18, '18 square meters');
    const mask = new Uint8Array(n * n);
    for (const k of cells) mask[k] = 1;
    mask[0] = 1;
    eq(patches(mask, n, { i0: 0, j0: 0, i1: n - 1, j1: n - 1 }).length, 2, 'two separate patches');
  });

  test(G, 'the starter island as it begins: no bar, no wall, its pond not dug', async () => {
    const R = await RP, { model } = await island([]);
    const r = shapedReport({ hab: model.habitat }, R.shaped);
    eq(r.bars.length, 0, 'the spit is scenery, not a raised bar');
    eq(r.walls.length, 0, 'the rocky point is rock, but nobody shaped it');
    assert(r.ponds.length > 0 && r.ponds.every((/** @type {any} */ p) => !p.dug), 'the starter pond is no dug pond');
    assert(r.shore.coastM > 100 && r.shore.wallM === 0, `a whole coast free (${r.shore.coastM} m)`);
  });

  test(G, 'a raised bar in the tide band reads at least 6 x 3 m, sandy, and quiet', async () => {
    const R = await RP, { model } = await island(['bar']);
    const r = shapedReport({ hab: model.habitat }, R.shaped);
    const b = r.bars[0];
    assert(b, 'a bar');
    assert(b.lengthM >= 6 && b.widthM >= 3, `${b.lengthM} x ${b.widthM} m`);
    assert(b.sand > 0.5, 'sandy');
    eq(b.quiet, true, 'nobody walked near it');
    eq(homeOf(r, SEAL.home).met, true, "the seals' home is made");
  });

  test(G, 'a Terrace sea wall is measured at the waterline, and takes coast', async () => {
    const R = await RP;
    const plain = shapedReport({ hab: (await island([])).model.habitat }, R.shaped);
    const r = shapedReport({ hab: (await island(['wall'])).model.habitat }, R.shaped);
    assert(r.walls[0]?.lengthM >= 8, `a wall at least 8 m long (${r.walls[0]?.lengthM})`);
    eq(r.bars.length, 0, 'its foot is no bar');
    assert(r.shore.wallM >= 8, `the wall holds ${r.shore.wallM} m of coast`);
    assert(r.shore.sandM < plain.shore.sandM, 'sandy shore given up for it');
  });

  test(G, 'a dug pond near the sea: dug, its distance, and its age kept', async () => {
    const R = await RP, { model } = await island(['pond']);
    const first = shapedReport({ hab: model.habitat }, R.shaped);
    const dug = first.ponds.filter((/** @type {any} */ p) => p.dug);
    eq(dug.length, 1, 'one dug pond');
    assert(dug[0].seaM <= 30, `within 30 m of the sea (${dug[0].seaM})`);
    const m0 = rememberPonds([], first.ponds, 100, R.shaped);
    eq(m0.ponds.length, 1, 'remembered from now');
    const later = rememberPonds(m0.ponds, first.ponds, 100 + 56 * 24, R.shaped);
    eq(later.ageOf(dug[0]), 56, 'a game year old a year on');
    const r = shapedReport({ hab: model.habitat, ageOf: later.ageOf }, R.shaped);
    eq(r.ponds.find((/** @type {any} */ p) => p.dug).ageDays, 56, 'the report carries the age');
    eq(homeOf(r, { check: 'pond', need: { ageDays: 56 }, max: { seaM: 30 } }).met, true, 'an eel pond');
    const gone = rememberPonds(later.ponds, [], 100 + 60 * 24, R.shaped);
    eq(gone.ponds.length, 0, 'a pond gone for longer than forgetDays is forgotten');
  });

  test(G, 'wrack lies on, the seals keep their quiet, the meadow islet counts as a bar', async () => {
    const R = (await RP).shaped;
    eq(wrackSince(null, 12, 50, R), 50, 'wrack enough: lying from now');
    eq(wrackSince(50, 12, 140, R), 50, 'and still from then');
    eq(wrackSince(50, 4, 141, R), null, 'gathered below the least: over');
    const bar = { x: 10, z: 10, lengthM: 6 };
    let steps = noteStep([], 40, 40, 10, R);
    eq(quietAt(bar, steps, 10, R).quiet, true, 'a walk far off keeps it quiet');
    steps = noteStep(steps, 12, 12, 11, R);
    eq(quietAt(bar, steps, 11, R).quiet, false, 'a walk on it breaks the quiet');
    eq(quietAt(bar, steps, 11 + R.bar.quietH + 1, R).quiet, true, 'a day on, quiet again');
    const { model } = await island([]);
    const r = shapedReport({ hab: model.habitat, islet: { risen: true, riseDay: 30, bar: { from: [20, 0], to: [40, 0], halfWidthM: 1.5 } } }, R);
    assert(r.bars.some((/** @type {any} */ b) => b.islet && b.areaM2 === 60 && b.lengthM === 20 && b.widthM === 3 && b.risenDay === 30), "the islet's bar is read from B3a's store slice (from, to, halfWidthM, riseDay)");
  });

  test(G, 'home fit: the weakest need decides, max fields cap, booleans must hold', () => {
    eq(homeFit({ areaM2: 9, quiet: true }, { need: { areaM2: 18, quiet: true } }), 0.5, 'half the area');
    eq(homeFit({ areaM2: 30, quiet: false }, { need: { areaM2: 18, quiet: true } }), 0, 'not quiet');
    eq(homeFit({ seaM: 60 }, { max: { seaM: 30 } }), 0.5, 'twice too far');
  });

  test(G, 'visit days come from the seed alone, in season, at most one a window', () => {
    const a = visitsBetween(7, 'seals', SEAL, 0, 56 * 24), b = visitsBetween(7, 'seals', SEAL, 0, 56 * 24);
    eq(JSON.stringify(a), JSON.stringify(b), 'the same seed, the same visits');
    assert(a.length >= 5, `several over a year (${a.length})`);
    for (const v of a) {
      assert([2, 3].includes(seasonOf(v.day * SECONDS_PER_DAY + 43200).index), `day ${v.day} in autumn or winter`);
      const h = v.hour % 24;
      assert(h >= 9 && h < 15, `starts in its hours (${h})`);
    }
    const split = [...visitsBetween(7, 'seals', SEAL, 0, 40 * 24), ...visitsBetween(7, 'seals', SEAL, 40 * 24, 56 * 24)];
    eq(JSON.stringify(split), JSON.stringify(a), 'looked at in two pieces, the same visits');
    assert(visitInWindow(7, 'seals', 2, SEAL) === null, 'none in spring');
  });

  test(G, 'a visit while away leaves its flags unseen; one while watched is shown; home ends them', async () => {
    const R = (await RP).shaped, { model } = await island([]), hab = model.habitat;
    const visitors = visitorsOf({ seal: { ecology: { visit: { ...SEAL, sp: 'seals' } } } });
    eq(visitors[0].sp, 'seals', 'keyed by its journal page');
    const v = visitsBetween(3, 'seals', SEAL, AUTUMN * 24, (AUTUMN + 8) * 24)[0];
    const base = { seed: 3, by: {}, visitors, report: { bars: [] }, hab, flags: [], ever: () => false, awayGapH: R.visits.awayGapH };
    const away = visitStep({ ...base, nowH: v.hour + 30, lookedH: v.hour - 30 });
    eq(away.show.length, 0, 'away: nothing shown');
    assert(away.flags.includes('seals:visited') && away.by.seals.last === v.day, 'but flagged and remembered');
    const live = visitStep({ ...base, nowH: v.hour, lookedH: v.hour - 1 });
    eq(live.show.length, 1, 'watched: shown');
    assert(typeof live.show[0].x === 'number', 'at a spot');
    const home = visitStep({ ...base, nowH: v.hour, lookedH: v.hour - 1, report: { bars: [{ areaM2: 40, lengthM: 10, widthM: 4, quiet: true }] } });
    eq(home.show.length, 0, 'home made: no visit');
    assert(home.flags.includes('seals:home'), 'and the home is flagged');
  });

  test(G, 'a visit hint comes the morning after, repeats now and then, rings the spot, ends with the home', () => {
    const H = { visitAgainDays: 6, flagPrefix: 'hint:', tests: {}, hints: [{ id: 'seal-visit', visit: 'seals', text: 'A quiet bar.' }] };
    const J = (/** @type {string[]} */ flags) => ({ born: 0, flags, species: {}, notes: [] });
    const visits = { seals: { last: 30, x: 4, z: 5 } };
    eq(pickHint(H, { journal: J(['seals:visited']), visits, day: 30 }, 30), null, 'not on the day itself');
    const h = pickHint(H, { journal: J(['seals:visited']), visits, day: 31 }, 31);
    eq(h?.id, 'seal-visit', 'the next morning');
    const s = { journal: J(['seals:visited']), visits, day: 31 };
    eq(showMeOf(h, s), 'seals', 'Show me rings the visitor');
    eq(JSON.stringify(visitAt(h, s)), JSON.stringify({ x: 4, z: 5 }), 'where it showed itself');
    const shown = ['seals:visited', shownFlag(H, 'seal-visit', 31)];
    eq(pickHint(H, { journal: J(shown), visits, day: 40 }, 40), null, 'no newer visit: never again');
    eq(pickHint(H, { journal: J(shown), visits: { seals: { last: 34, x: 4, z: 5 } }, day: 35 }, 35), null, 'a newer visit, but too soon');
    eq(pickHint(H, { journal: J(shown), visits: { seals: { last: 36, x: 4, z: 5 } }, day: 37 }, 37)?.id, 'seal-visit', 'a newer visit, days on: again');
    assert(hintDone(H, H.hints[0], { journal: J([...shown, 'seals:home']) }), 'done once the home is made');
  });

  test(G, 'the save keeps the memory; an older save reads as nothing remembered', () => {
    assert(SECTIONS9.includes(/** @type {any} */ ('shaped')), 'a save section');
    eq(JSON.stringify(clean9(/** @type {any} */ ('shaped'), undefined)), JSON.stringify(emptyShaped()), 'missing: empty');
    eq(JSON.stringify(cleanShaped({ version: 1, ponds: [{ x: 1, z: 2, born: 5 }, { x: 'no' }], wrack: { since: 'x' } }).ponds), JSON.stringify([{ x: 1, z: 2, born: 5, seen: 5 }]), 'bad entries dropped');
  });
}

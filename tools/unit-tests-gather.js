// @ts-check
// Gathering tests for tools/unit-tests.html (docs/future/13 4.2, 4.4, 4.5): a ground spot's share is
// seeded by the world, the kind, the spot and the period; the empty rate follows the table; a windy
// day adds a stick and empties no shrub's foot; an onshore tide adds drift twigs; a season with no
// handfuls has none; picked events record, expire, cap and clean; model B picks and the words a
// plant gives; the card's word for what is left; and the rest a picked plant takes in growth.

import { KINDS, gatherSeed, share, spotsNear, spotAt, spotsAt, binOf, binCenter, binKey, BINS, wordFor, isOnshore } from '../src/world/gather/spots.js';
import { record, taken, expire, cap, cleanGather, periodOf, periodTag, periodIndex, PERIOD } from '../src/world/gather/events.js';
import { pickable, pick, partOf, partsOf } from '../src/world/gather/plants.js';
import { recoverFactor, STAGE } from '../src/world/growth/coarse.js';
import { WATER_ORIGIN, WATER_CELL } from '../src/world/water/grid.js';

const G = 'gather';
/** @param {string} path */
const json = (path) => fetch(new URL(`../recipes/${path}.json`, import.meta.url)).then((r) => r.json());

/** A calm day record. @param {number} day @param {number} [wind] @param {number} [dir] */
const dayRec = (day, wind = 0.2, dir = 0) => /** @type {any} */ ({ day, mood: 'clear', windStrength: wind, windDir: dir, rainAmount: 0 });

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addGatherTests(test, assert, eq) {
  const recipeP = json('world/gather');
  const seed = gatherSeed(1207);
  /** @param {any} [o] */
  const ctxOf = (o = {}) => /** @type {any} */ ({ seed, day: 10, season: 0, today: dayRec(10), yesterday: dayRec(9), ...o });
  const day10 = periodOf(PERIOD.day, 10);

  test(G, 'the kinds list starts with the Phase 1 kinds, and the recipe has them all', async () => {
    const R = await recipeP;
    eq(KINDS.slice(0, 4).join(), 'sticks,drift-twigs,pebbles,flat-stones', 'append-only order');
    for (const k of KINDS) assert(R.kinds[k], `${k} in gather.json`);
    eq(R.reachM, 0.9, 'arm reach');
    eq(R.nearLookM, 2.5, 'near look');
  });

  test(G, 'a share is the same for the same inputs, and the kind salts it apart', async () => {
    const R = await recipeP;
    const ctx = ctxOf();
    for (let key = 0; key < 50; key++) eq(share('pebbles', key, day10, ctx, R), share('pebbles', key, day10, ctx, R), `key ${key}`);
    // The same table under two kinds rolls apart.
    const R2 = { ...R, kinds: { ...R.kinds, 'flat-stones': R.kinds.pebbles } };
    let differ = 0;
    for (let key = 0; key < 400; key++) if (share('pebbles', key, day10, ctx, R2) !== share('flat-stones', key, day10, ctx, R2)) differ++;
    assert(differ > 100, `kinds roll apart (${differ} of 400 differ)`);
    // And the next day re-rolls.
    let moved = 0;
    for (let key = 0; key < 400; key++) if (share('pebbles', key, day10, ctx, R) !== share('pebbles', key, periodOf(PERIOD.day, 11), ctx, R)) moved++;
    assert(moved > 100, `a new day re-rolls (${moved} of 400)`);
  });

  test(G, 'the empty rate follows the table', async () => {
    const R = await recipeP;
    const ctx = ctxOf();
    for (const [kind, want, full] of /** @type {[string, number, number][]} */ ([['pebbles', 0.3, 2], ['flat-stones', 0.5, 1], ['sticks', 0.25, 1]])) {
      let empty = 0;
      const N = 4000;
      for (let key = 0; key < N; key++) {
        const s = share(kind, key, day10, ctx, R);
        if (s === 0) empty++; else eq(s, full, `${kind} holds ${full}`);
      }
      assert(Math.abs(empty / N - want) < 0.03, `${kind} empty ${(empty / N).toFixed(3)} near ${want}`);
    }
  });

  test(G, 'a windy day, today or yesterday, adds a stick and empties no shrub', async () => {
    const R = await recipeP;
    for (const ctx of [ctxOf({ today: dayRec(10, 0.8) }), ctxOf({ yesterday: dayRec(9, 0.6) })]) {
      for (let id = 1; id < 500; id++) eq(share('sticks', id, day10, ctx, R), 2, `plant ${id}`);
    }
    // Wind does nothing for pebbles.
    let empty = 0;
    for (let key = 0; key < 1000; key++) if (share('pebbles', key, day10, ctxOf({ today: dayRec(10, 0.9) }), R) === 0) empty++;
    assert(empty > 200, 'pebbles keep their empties');
  });

  test(G, 'an onshore tide adds drift twigs and fewer empty stretches', async () => {
    const R = await recipeP;
    // East of the centre: outward is +x, so wind blowing toward -x (windDir pi) is onshore.
    const keys = [];
    for (let bi = 60; bi < 90; bi++) for (let bj = 40; bj < 56; bj++) keys.push(binKey(bi, bj));
    assert(isOnshore(dayRec(0, 0.8, Math.PI), binCenter(keys[0]), [0, 0], R.weather), 'onshore');
    assert(!isOnshore(dayRec(0, 0.8, 0), binCenter(keys[0]), [0, 0], R.weather), 'offshore');
    assert(!isOnshore(dayRec(0, 0.3, Math.PI), binCenter(keys[0]), [0, 0], R.weather), 'calm is never onshore');
    /** @param {number} dir */
    const run = (dir) => {
      const line = { tideId: 40, level: 0.6, spring: 0, season: 1, day: dayRec(20, 0.8, dir) };
      const ctx = ctxOf({ lines: [line], center: [0, 0] });
      let empty = 0, sum = 0;
      for (const k of keys) { const s = share('drift-twigs', k, periodOf(PERIOD.tide, 40), ctx, R); if (!s) empty++; sum += s; }
      return { empty: empty / keys.length, mean: sum / (keys.length - empty) };
    };
    const on = run(Math.PI), off = run(0);
    assert(Math.abs(on.empty - 0.3) < 0.06 && Math.abs(off.empty - 0.6) < 0.06, `empties ${on.empty.toFixed(2)} onshore, ${off.empty.toFixed(2)} off`);
    eq(on.mean, 2, 'two handfuls a stretch onshore');
    eq(off.mean, 1, 'one offshore');
    // A line no longer lying gives nothing.
    eq(share('drift-twigs', keys[0], periodOf(PERIOD.tide, 39), ctxOf({ lines: [] }), R), 0, 'no line, nothing');
  });

  test(G, 'a season with no handfuls has none, windy or not', async () => {
    const R = await recipeP;
    const R2 = { ...R, kinds: { ...R.kinds, sticks: { ...R.kinds.sticks, handfuls: [1, 0, 1, 1] } } };
    for (let id = 1; id < 300; id++) {
      eq(share('sticks', id, day10, ctxOf({ season: 1, today: dayRec(10, 0.9) }), R2), 0, `summer, plant ${id}`);
    }
    assert([...Array(300).keys()].some((id) => share('sticks', id, day10, ctxOf({ season: 2 }), R2) > 0), 'autumn has some');
  });

  test(G, 'spots: sticks at a young host, pebbles on shore sand, flat stones on band rock, twigs on the line', async () => {
    const R = await recipeP;
    // 16 x 16 water cells: columns 0-3 rock in the tide band, 4-11 shore sand, 12-15 grass.
    const rect = { x: 180, y: 180, w: 16, h: 16 }, n = rect.w * rect.h;
    const cls = new Uint8Array(n), band = new Uint8Array(n), shore = new Uint8Array(n), targetMm = new Uint16Array(n);
    for (let k = 0; k < n; k++) { const i = k % 16; if (i < 4) { band[k] = 1; shore[k] = 20; } else if (i < 12) shore[k] = 120; }
    const groundOf = (/** @type {number} */ k) => ((k % 16) < 4 ? 2 : (k % 16) < 12 ? 1 : 0);
    const line = { tideId: 7, level: 0.5, spring: 0, season: 0, day: dayRec(3) };
    // Column 9 sits on the line.
    const heightOf = (/** @type {number} */ k) => ((k % 16) === 9 ? 0.55 : 0.1);
    const cx = WATER_ORIGIN + 180 * WATER_CELL;   // the rect's west (and north) edge
    const plants = [
      { id: 3, sp: 'gorse', x: cx + 7, z: cx + 2, stage: STAGE.young },
      { id: 4, sp: 'gorse', x: cx + 7.5, z: cx + 5, stage: STAGE.sprout },
      { id: 5, sp: 'reeds', x: cx + 7, z: cx + 3, stage: STAGE.mature },
    ];
    const ctx = ctxOf({ summary: { rect, cls, band, shore, targetMm }, groundOf, heightOf, lines: [line], plants, runupM: 0.05 });
    const near = spotsNear(cx + 4, cx + 4, 10, ctx, R);
    const count = (/** @type {string} */ kind) => near.filter((s) => s.kind === kind).length;
    eq(count('sticks'), 1, 'one host: the young gorse (not the sprout, not the reeds)');
    eq(count('flat-stones'), 4 * 1, 'flat stones in each bin of band rock (one column of 4 bins)');
    eq(count('pebbles'), 4 * 2, 'pebbles in each bin of shore sand');
    eq(count('drift-twigs'), 4, 'drift twigs along the line, a stretch per bin');
    const tw = near.find((s) => s.kind === 'drift-twigs');
    eq(tw?.period, periodOf(PERIOD.tide, 7), 'a stretch rolls by its tide');
    eq(Math.round(((tw?.x ?? 0) - cx) * 4), 19, 'drawn at the line cell');
    const fs = near.find((s) => s.kind === 'flat-stones');
    assert(fs && fs.cell >= 0 && band[fs.cell] === 1, 'a flat stone spot sits on band rock');
    // A tap at the gorse's foot is the gorse; a tap on bare sand is the bin's pebbles.
    eq(spotAt(cx + 7.2, cx + 2.1, ctx, R)?.kind, 'sticks', 'the foot stands out');
    eq(spotAt(cx + 3, cx + 7, ctx, R)?.kind, 'pebbles', 'sand bin');
    eq(spotsAt(cx + 1, cx + 1, ctx, R).map((s) => s.kind).join(), 'flat-stones', 'rock bin');
    eq(binOf(-1000, 0), -1, 'off the grid');
    eq(binOf(WATER_ORIGIN + 0.1, WATER_ORIGIN + 0.1), 0, 'first bin');
    eq(BINS, 96, '96 bins a side');
    // The same world gives the same spots.
    eq(JSON.stringify(spotsNear(cx + 4, cx + 4, 10, ctx, R)), JSON.stringify(near), 'spots are stable');
  });

  test(G, 'picked events record, expire, cap and clean', () => {
    let ev = record([], 11, day10, 1);
    ev = record(ev, 11, day10, 1);
    ev = record(ev, 12, periodOf(PERIOD.tide, 30), 1);
    eq(ev.length, 6, 'a second handful raises the count, not the list');
    eq(taken(ev, 11, day10), 2, 'two taken');
    eq(taken(ev, 11, periodOf(PERIOD.day, 11)), 0, 'nothing taken tomorrow');
    eq(periodTag(periodOf(PERIOD.tide, -3)), PERIOD.tide, 'negative tide ids keep their tag');
    eq(periodIndex(periodOf(PERIOD.tide, -3)), -3, 'and their index');
    eq(expire(ev, { day: 10, tides: [30, 29] }).length, 6, 'nothing over yet');
    eq(expire(ev, { day: 11, tides: [30] }).join(), [12, periodOf(PERIOD.tide, 30), 1].join(), 'the day passed');
    eq(expire(ev, { day: 10, tides: [31] }).join(), [11, day10, 2].join(), 'the line was swept');
    let many = [];
    for (let i = 0; i < 300; i++) many = record(many, i, day10, 1);
    const c = cap(many, 256);
    eq(c.length, 256 * 3, 'capped');
    eq(c[0], 44, 'the oldest went first');
    eq(cleanGather(null).events.length, 0, 'unreadable comes back empty');
    eq(cleanGather({ version: 1, events: [1, 2, 3, -1, 2, 3, 4, 2.5, 1, 5, 6, 0, 7, 8] }).events.join(), '1,2,3', 'malformed and partial triples dropped');
    eq(cleanGather({ version: 1, events: [[3, 4, 50]] }).events.join(), '3,4,50', 'nested triples flattened');
    eq(cleanGather({ events: 'x' }).version, 1, 'version 1');
  });

  test(G, 'model B: reed down is picked in late autumn and winter, rests, and keeps its floor', async () => {
    const [R, reeds] = await Promise.all([recipeP, json('flora/reeds')]);
    const P = partOf('reeds', 'down', R);
    eq(P?.share, 0.05, 'share');
    eq(P?.readyShare, 0.9, 'ready share');
    eq(partsOf('reeds', R).join(), 'down', 'reeds give down');
    const env = { flora: reeds, pos: 3.2 };
    let p = { id: 9, sp: 'reeds', x: 0, z: 0, size: 1, best: 1, stage: STAGE.dormant };
    eq(pickable({ ...p, best: 0.5, size: 0.5 }, 'down', env, R).why, 'young', 'never mature: young');
    eq(pickable(p, 'down', { flora: reeds, pos: 1.0 }, R).why, 'season', 'summer: out of season');
    assert(pickable(p, 'down', env, R).ok, 'winter: ok');
    let n = 0;
    while (pickable(p, 'down', env, R).ok && n < 10) { p = pick(p, 'down', env, R); n++; }
    assert(n >= 2 && n <= 3, `a few handfuls before a rest (${n})`);
    eq(pickable(p, 'down', env, R).why, 'rest', 'then it rests');
    eq(p.best, 1, 'best stays');
    eq(p.stage, STAGE.dormant, 'stage stays');
    eq(pick({ ...p, size: 0.41 }, 'down', env, R).size, reeds.growth.floor, 'never below the floor');
    eq(pickable(p, 'nope', env, R).ok, false, 'an unknown part');
    const words = R.words;
    assert(words.rest === 'Let it rest a while.' && words.young === 'Still small. Let it grow first.', 'plant words');
  });

  test(G, 'a picked plant rests: slower growth, faster in rain; a growing plant is never slowed', async () => {
    const R = await recipeP;
    const P = R.plants;
    eq(recoverFactor(0.5, 0.5, 0.7, 0.9, P, 0, 0), 1, 'still growing to its best');
    eq(recoverFactor(0.95, 1, 0.7, 0.9, P, 0, 0), 1, 'ready again');
    eq(recoverFactor(0.8, 1, 0.7, 0.9, P, 0, 0), P.recoverRate, 'resting');
    eq(recoverFactor(0.8, 1, 0.7, 0.9, P, 1, 0), P.recoverRate * (1 + P.rainBoost), 'faster in rain');
    assert(recoverFactor(0.8, 1, 0.7, 0.9, P, 0, 1) > P.recoverRate, 'a little faster in mist');
  });

  test(G, 'the card word for what is left', async () => {
    const W = (await recipeP).words;
    eq(wordFor(3, 3, 'bin', W), 'Plenty here.', 'plenty');
    eq(wordFor(2, 2, 'foot', W), 'Plenty here.', 'two is plenty');
    eq(wordFor(1, 2, 'bin', W), 'A little left.', 'a little');
    eq(wordFor(0, 2, 'bin', W), 'Picked over for today.', 'picked over');
    eq(wordFor(0, 1, 'strand', W), 'Picked over. The next tide will bring more.', 'strand picked over');
    eq(wordFor(0, 0, 'bin', W), 'Nothing lies here today.', 'nothing');
    eq(wordFor(0, 0, 'strand', W), 'The tide left nothing here.', 'strand nothing');
  });
}

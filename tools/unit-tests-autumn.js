// @ts-check
// Autumn tests for tools/unit-tests.html (doc 13, The year, season by season): fungi fruit on a kept
// log only in autumn, after it has rested out of the tide and the weather has been damp, grow in and
// fade in winter, sit where the log's own seed says, on the wood itself; dewy orb webs come in the
// tall grass only on misty autumn mornings, seeded by the cell and the day; the journal has both
// pages, their sketches, icons and ties.

import { moodsOf, autumnStartOf, dampBy, fungiBloom, fungiChance, fungusSize, fungiLayout, websNear, webDew, mistyAutumnMorning } from '../src/world/finds/autumn.js';
import { fungusMeshes } from '../src/world/finds/autumn-meshes.js';
import { logSurface } from '../src/world/pieces/log-surface.js';
import { bakeLogSeed, logLook } from '../src/world/pieces/log-bake.js';
import { logBone, makeLog, addPiece, movePiece } from '../src/world/pieces/model.js';
import { seasonOf, SECONDS_PER_DAY } from '../src/core/clock.js';
import { subSeed } from '../src/core/rng.js';
import { drawSketch, hasSketch } from '../src/ui/sketches/index.js';
import { ICON_NAMES } from '../src/ui/icons/icons.js';

const AUTUMN = 'autumn';
/** @param {string} path */
const json = (path) => fetch(new URL(`../recipes/${path}.json`, import.meta.url)).then((r) => r.json());

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addAutumnTests(test, assert, eq) {
  test(AUTUMN, 'fungi fruit on a rested log after damp autumn days, grow in, and fade in winter', async () => {
    const F = (await json('species/autumn-finds')).fungi;
    // Year 0: autumn is days 28 to 41, winter 42 to 55. Damp on days 33 and 34 only.
    const moodOf = (/** @type {number} */ d) => (d === 33 || d === 34 ? 'rain' : 'clear');
    eq(autumnStartOf(20), null, 'summer is no autumn');
    eq(autumnStartOf(30), 28, 'autumn starts on day 28');
    eq(autumnStartOf(45), 28, 'and winter looks back to it');
    assert(!dampBy(33, moodOf, F) && dampBy(34, moodOf, F), 'two damp days in the last four make it damp');
    eq(fungiBloom({ dayNow: 20, placedHour: 0, moodOf, F }), null, 'none in summer');
    eq(fungiBloom({ dayNow: 33, placedHour: 0, moodOf, F }), null, 'none before it is damp');
    const b = fungiBloom({ dayNow: 36, placedHour: 0, moodOf, F });
    eq(b?.day0, 34, 'a log set down in spring fruits on the first damp day');
    eq(b?.winter0, 42, 'and fades from the first day of winter');
    // Set down on day 34: it must rest restDays first, and the damp spell has passed by then.
    eq(fungiBloom({ dayNow: 41, placedHour: 34 * 24, moodOf, F }), null, 'a log just set down waits for its rest, then for damp');
    const wet = (/** @type {number} */ d) => (d >= 30 ? 'mist' : 'clear');
    eq(fungiBloom({ dayNow: 40, placedHour: 33 * 24, moodOf: wet, F })?.day0, 33 + F.restDays, 'it fruits once rested, if the damp holds');
    if (!b) return;
    eq(fungusSize(34 * 24 - 1, b, 0, 0, F), 0, 'nothing before its bloom');
    eq(fungusSize((34 + F.growDays) * 24, b, 0, 0, F), 1, 'full grown after growDays');
    assert(fungusSize((34 + F.growDays * 0.5) * 24, b, 0, 0, F) > 0.2, 'half way in, it is growing');
    assert(fungusSize((34 + F.growDays * 0.5) * 24, b, 1, 0, F) < fungusSize((34 + F.growDays * 0.5) * 24, b, 0, 0, F), 'a late one is smaller');
    eq(fungusSize(41 * 24, b, 1, 1, F), 1, 'still there at the end of autumn');
    eq(fungusSize((42 + F.winter.spreadDays + F.winter.fadeDays) * 24, b, 1, 1, F), 0, 'gone by the end of the winter fade');
    eq(fungiBloom({ dayNow: 57, placedHour: 0, moodOf: wet, F }), null, 'none next spring');
    return `bloom day ${b.day0}`;
  });

  test(AUTUMN, 'a log carried off the strand and set down fruits; moving it later keeps its rest', async () => {
    const F = (await json('species/autumn-finds')).fungi;
    const wet = (/** @type {number} */ d) => (d >= 30 ? 'mist' : 'clear');
    // As the Carry button does it (pieces/index.js setDown): a strand log becomes a kept piece.
    const strand = { x: 4, z: -2, yaw: 0.3, seed: 987654321, size: 0.14, length: 1.3 };
    let s = /** @type {any} */ ({ list: [], nextId: 1 });
    const log = makeLog(s.nextId, { ...strand, x: 1, z: 2 }, 31 * 24);
    s = addPiece(s, log, 8);
    assert(s, 'the log was kept');
    const kept = s.list.find((/** @type {any} */ p) => p.kind === 'log');
    eq(kept.seed, strand.seed, 'the kept log keeps the strand log\'s seed (its fungi follow it)');
    const b = fungiBloom({ dayNow: 40, placedHour: kept.placedHour, moodOf: wet, F });
    eq(b?.day0, 31 + F.restDays, 'it fruits once rested in damp autumn weather');
    // Carried again later: the move keeps when it was first set down.
    const moved = movePiece(s, kept.id, 6, 6).list.find((/** @type {any} */ p) => p.id === kept.id);
    eq(moved.placedHour, kept.placedHour, 'moving it keeps its rest');
    return `kept on day 31, fruits on day ${b?.day0}`;
  });

  test(AUTUMN, 'age and damp make a log likelier to fruit: an old or damp log always can, a young dry one some autumns', async () => {
    const C = (await json('species/autumn-finds')).fungi.chance;
    let young = 0, again = 0;
    for (let s = 1; s <= 400; s++) {
      assert(fungiChance(s, 28, 1, 0, C) && fungiChance(s, 28, 0, 1, C), 'old, or damp: always');
      if (fungiChance(s, 28, 0, 0, C)) young++;
      if (fungiChance(s, 28, 0, 0, C) === fungiChance(s, 28, 0, 0, C)) again++;
    }
    assert(young > 120 && young < 280, `a young dry log fruits some autumns: ${young} of 400`);
    eq(again, 400, 'the same log and autumn roll the same');
    const years = [28, 84, 140, 196].map((a0) => fungiChance(7, a0, 0, 0, C));
    return `${young} of 400 young dry logs fruit; log 7 over four autumns: ${years.join(', ')}`;
  });

  test(AUTUMN, 'a log\'s fungi come from its own seed: the same every time, on its flanks or its top', async () => {
    const F = (await json('species/autumn-finds')).fungi;
    const a = fungiLayout({ seed: 12345, length: 1.2 }, F), a2 = fungiLayout({ seed: 12345, length: 1.2 }, F);
    eq(JSON.stringify(a), JSON.stringify(a2), 'the same seed gives the same fungi');
    /** @type {Record<string, number>} */ const kinds = { turkeytail: 0, sulphurtuft: 0 };
    let n = 0;
    for (let s = 1; s <= 200; s++) {
      const L = fungiLayout({ seed: s * 7919, length: 1 }, F);
      kinds[L.species]++;
      assert(L.clusters.length >= 1 && L.clusters.length <= F.clustersMax, `clusters ${L.clusters.length}`);
      for (const c of L.clusters) for (const m of c.members) {
        n++;
        assert(m.t > 0 && m.t < 1, `along the log: ${m.t}`);
        const up = Math.sin(m.a);
        if (L.species === 'turkeytail') assert(Math.abs(Math.cos(m.a)) > 0.45 && up > -0.3, `a bracket sits on a flank (a ${m.a.toFixed(2)})`);
        else assert(up > 0.25, `a cap stands on the top half (a ${m.a.toFixed(2)})`);
        assert(m.size > 0.3 && m.size < 1.5, `size ${m.size}`);
      }
    }
    assert(kinds.turkeytail > 60 && kinds.sulphurtuft > 50, `both kinds come: ${kinds.turkeytail} turkey tail, ${kinds.sulphurtuft} sulphur tuft`);
    return `${n} fungi on 200 logs`;
  });

  test(AUTUMN, 'fungus meshes are real size with their roots at the wood', async () => {
    const F = (await json('species/autumn-finds')).fungi;
    const all = fungusMeshes(F);
    eq(Object.keys(all).sort().join(','), 'bracket-0,bracket-1,cap-0,cap-1,cap-2', 'two brackets and three caps');
    for (const [key, m] of Object.entries(all)) {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < m.count; i++) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], m.vertices[i * 9 + c]); hi[c] = Math.max(hi[c], m.vertices[i * 9 + c]); }
      assert(m.vertices.every(Number.isFinite), `${key} is finite`);
      assert(Math.max(...m.indices) < m.count, `${key} indices in range`);
      if (key.startsWith('bracket')) {
        const B = F.shape.bracket;
        assert(Math.abs(hi[0] - lo[0] - 2 * B.radiusM) < B.radiusM * 0.6, `${key} is about ${2 * B.radiusM} m across: ${(hi[0] - lo[0]).toFixed(3)}`);
        assert(lo[2] > -0.002 && hi[2] > B.radiusM * 0.5, `${key} reaches out along +z from its root`);
      } else {
        const C = F.shape.cap;
        assert(lo[1] < 0 && lo[1] > -0.006, `${key}'s foot sits just into the wood`);
        assert(Math.abs(hi[1] - C.stemM - C.capHeightM) < 0.006, `${key} stands stem and cap high: ${hi[1].toFixed(3)}`);
      }
    }
  });

  test(AUTUMN, 'a point on a log\'s surface is on the wood, its normal facing out', async () => {
    const D = (await json('world/pieces')).driftwood;
    const len = 1.2, thick = 0.15, a = thick / len;
    // Every form carries its fungi on the trunk: one log of each.
    const seeds = [];
    for (let s = 1; seeds.length < 4 && s < 400; s++) if (!seeds.some((q) => logLook(q, D).form === logLook(s, D).form)) seeds.push(s);
    eq(seeds.length, 4, 'a log of each form');
    for (const seed of seeds) {
    const { mesh, form } = bakeLogSeed(D, seed, a);
    const pose = { bone: logBone(0, 1, a, D.sink), size: len, yaw: 0.6, at: [3, 1, -2] };
    const top = logSurface(mesh, D.shape.rings, D.shape.around, pose, 0.5, Math.PI / 2);
    const side = logSurface(mesh, D.shape.rings, D.shape.around, pose, 0.5, 0);
    const y = top.p[1] - 1;
    assert(y > thick * 0.45 && y < thick * 1.6, `${form}: the top is about a thickness up: ${y.toFixed(3)} m`);
    assert(top.n[1] > 0.7, `${form}: the top faces up: ${top.n[1].toFixed(2)}`);
    assert(Math.abs(side.n[1]) < 0.5, `${form}: the flank faces sideways: ${side.n[1].toFixed(2)}`);
    // The log lies along its yaw: two points far apart along it lie along (sin yaw, cos yaw).
    const p0 = logSurface(mesh, D.shape.rings, D.shape.around, pose, 0.1, Math.PI / 2).p, p1 = logSurface(mesh, D.shape.rings, D.shape.around, pose, 0.9, Math.PI / 2).p;
    const dx = p1[0] - p0[0], dz = p1[2] - p0[2], l = Math.hypot(dx, dz);
    assert(l > len * 0.6, `${form}: points along it are ${l.toFixed(2)} m apart`);
    assert(Math.abs(dx / l - Math.sin(0.6)) < 0.25 && Math.abs(dz / l - Math.cos(0.6)) < 0.25, `${form}: along the yaw`);
    }
    return seeds.map((s) => logLook(s, D).form).join(', ');
  });

  test(AUTUMN, 'dewy webs: in thick lush grass, seeded by cell and day, only on misty autumn mornings', async () => {
    const W = (await json('species/autumn-finds')).webs;
    const cells = 64, origin = -32;
    const grass = new Uint8Array(cells * cells).fill(255), lush = new Uint8Array(cells * cells).fill(200);
    const at = (/** @type {number} */ day, /** @type {any} */ o = {}) => websNear({ seed: 99, day, x: 0, z: 0, nearM: 14, grass, lush, cells, origin, W, ...o });
    const a = at(40), b = at(40), c = at(41);
    assert(a.length > 0 && a.length <= W.max, `some webs: ${a.length}`);
    eq(JSON.stringify(a), JSON.stringify(b), 'the same day gives the same webs');
    assert(JSON.stringify(a) !== JSON.stringify(c), 'the next misty day gives new ones');
    for (const w of a) {
      assert(w.r >= W.radiusM[0] && w.r <= W.radiusM[1], `radius ${w.r}`);
      assert(w.hub > w.r, 'the hub stands higher than the web is wide, so the rim clears the ground');
      assert(Math.hypot(w.x, w.z) <= 14, 'near the view');
    }
    eq(at(40, { grass: new Uint8Array(cells * cells) }).length, 0, 'none without grass');
    eq(at(40, { lush: new Uint8Array(cells * cells).fill(10) }).length, 0, 'none in short, dry grass');
    eq(webDew({ season: 2, mood: 'clear', mist: 0.8 }, W), 0, 'no dew on a clear day');
    eq(webDew({ season: 1, mood: 'mist', mist: 0.8 }, W), 0, 'nor on a misty summer morning');
    eq(webDew({ season: 2, mood: 'mist', mist: 0 }, W), 0, 'nor once the mist has gone');
    eq(webDew({ season: 2, mood: 'mist', mist: 0.8 }, W), 1, 'full dew in thick mist');
    const half = webDew({ season: 2, mood: 'mist', mist: (W.dewMist[0] + W.dewMist[1]) / 2 }, W);
    assert(half > 0.3 && half < 0.7, `half dew as it lifts: ${half.toFixed(2)}`);
    return `${a.length} webs`;
  });

  test(AUTUMN, 'the test morning is misty, in autumn, with fungi grown', async () => {
    const [seasons, F] = await Promise.all([json('world/seasons'), json('species/autumn-finds').then((r) => r.fungi)]);
    const moodOf = moodsOf(subSeed(1, 'weather'), 0, seasons.weather);
    const d = mistyAutumnMorning({ fromDay: 0, moodOf, F });
    assert(d !== null, 'a misty autumn morning comes');
    if (d === null) return;
    eq(seasonOf(d * SECONDS_PER_DAY).index, 2, 'in autumn');
    eq(moodOf(d), 'mist', 'and misty');
    const b = fungiBloom({ dayNow: d, placedHour: -Infinity, moodOf, F });
    assert(b && d - b.day0 >= F.growDays + F.spreadDays, 'with the fungi grown in by then');
    return `day ${d}`;
  });

  test(AUTUMN, 'the journal has both pages, with sketches, icons and true ties', async () => {
    const [words, web, list] = await Promise.all([json('world/journal'), json('world/journal-web'), json('world/journal-list')]);
    for (const id of ['fungi', 'webs']) {
      const rec = words.species[id];
      assert(rec && rec.kind === 'find', `${id} is a find`);
      assert(words.findOrder.includes(id), `${id} counts on the naturalist's line`);
      assert(ICON_NAMES.includes(rec.icon), `${id}'s icon ${rec.icon} is drawn`);
      assert(web.nodes[id]?.page === id, `${id} has a Web node`);
      assert(web.links.some((/** @type {any} */ l) => l.b === id), `${id} needs something in the Web`);
      assert(list.placeOf[id], `${id} has a place`);
      assert(hasSketch(id), `${id} has a sketch`);
      const labels = Object.fromEntries(Object.entries(rec.sketch.labels).map(([k, v]) => [k, /** @type {any} */ (v).text]));
      for (const stage of /** @type {(0|1|2)[]} */ ([0, 1, 2])) {
        const svg = drawSketch(id, { stage, labels: stage ? labels : {}, scale: rec.sketch.scale });
        assert(svg.startsWith('<svg') && !/NaN|undefined|Infinity/.test(svg), `${id}'s sketch draws clean at stage ${stage}`);
      }
      for (const word of JSON.stringify(rec).match(/genuine/gi) ?? []) assert(false, `a banned word: ${word}`);
    }
    eq(words.species.fungi.collection.map((/** @type {any} */ c) => c.id).join(','), 'turkeytail,sulphurtuft', 'the fungi are found one kind at a time');
    assert(web.links.some((/** @type {any} */ l) => l.a === 'logs' && l.b === 'fungi'), 'fungi need the logs');
    assert(web.links.some((/** @type {any} */ l) => l.a === 'grass' && l.b === 'webs'), 'webs need the grass');
  });
}

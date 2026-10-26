// @ts-check
// Digging tests for tools/unit-tests.html (docs/future/13 section 10, P2c): the ground class table
// cell by cell; the layer stacks and the word at the bottom; the same seed, cell, day and layer give
// the same find; clay refused in winter; worms by season and summer rain; the island's budget never
// passes its day's draw; a patch thins at the 6th and 12th dig; a spot rests a day; events stay in
// their season and clean on load; a hole's stages dry and wet, water and strokes close it, the cap;
// the dig motion keeps its limits and ends at rest; and the rush pick lowers a cell and waits for it.

import { groundClass, stackOf, bottomOf, nextLayer, cellOf, strongestPaint } from '../src/world/dig/layers.js';
import { rested, thinning, budgetOf, budgetLeft, addEvent, seasonEvents, cleanDig, emptyDig, patchOf } from '../src/world/dig/rest.js';
import { digFinds, digRarityWeights } from '../src/world/dig/finds.js';
import { holeNow, closeHole, capHoles, holeAt, rainHoursIn, wetSince, cleanHoleFields } from '../src/world/dig/holes.js';
import { cleanPieces } from '../src/world/pieces/model.js';
import { coverPickable, coverPick } from '../src/world/gather/plants.js';
import { actLength, actPose } from '../src/world/figure/acts.js';
import { subSeed } from '../src/core/rng.js';
import { cleanCook, layout, recordMade } from '../src/world/camp/making.js';
import { HABITAT_CELLS, HABITAT_ORIGIN } from '../src/world/growth/habitat.js';

const G = 'dig';
/** @param {string} path */
const json = (path) => fetch(new URL(`../recipes/${path}.json`, import.meta.url)).then((r) => r.json());

/** A habitat of soil everywhere, open, dry and fresh; set cells to change it. */
function habitat() {
  const N = HABITAT_CELLS * HABITAT_CELLS, z = () => new Uint8Array(N);
  const h = { n: HABITAT_CELLS, open: z().fill(1), depthCm: z(), moisture: z().fill(80), salt: z(), still: z(), sea: z(), grass: z().fill(200), band: z(), sand: z(), rock: z(), soil: z(), clear: z(), hash: 0 };
  return /** @type {any} */ (h);
}
/** The middle of a cell's square, a few meters from the origin. @param {number} i @param {number} j */
const at = (i, j) => [HABITAT_ORIGIN + 80 + i + 0.5, HABITAT_ORIGIN + 80 + j + 0.5];

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addDigTests(test, assert, eq) {
  const RP = json('world/dig'), KP = json('world/keepsakes'), FP = json('world/figure'), GP = json('world/gather');
  const seed = subSeed(1207, 'dig');

  test(G, 'the ground class, cell by cell: soil, damp bank, sand; never rock, water, the camp, the tide band or a piece', async () => {
    const R = await RP, h = habitat();
    const set = (/** @type {number} */ i, /** @type {number} */ j, /** @type {Record<string, number>} */ v) => { const [x, z] = at(i, j), k = cellOf(x, z); for (const [f, n] of Object.entries(v)) h[f][k] = n; return [x, z]; };
    const cls = (/** @type {number[]} */ p, /** @type {any} */ g = {}) => { const c = groundClass(p[0], p[1], { hab: h, ...g }, R); return c.cls ?? c.why; };
    eq(cls(set(0, 0, {})), 'soil', 'plain grass ground');
    eq(cls(set(1, 0, { moisture: 150 })), 'bank', 'wet grass by fresh water');
    eq(cls(set(2, 0, { moisture: 150, salt: 120 })), 'soil', 'wet but salty is not a bank');
    eq(cls(set(3, 0, { sand: 230 })), 'sand', 'painted sand');
    eq(cls(set(4, 0, { rock: 230 })), 'rock', 'painted rock');
    eq(cls(set(5, 0, { sand: 230, band: 1 })), 'flats', 'the tide band is the rake\'s');
    eq(cls(set(6, 0, { depthCm: 20 })), 'water', 'standing water over the ankle');
    eq(cls(set(7, 0, { depthCm: 5 })), 'soil', 'a film of water under the ankle');
    const p = set(8, 0, {});
    eq(cls(p, { depthAt: () => 0.2 }), 'water', 'live water over it');
    eq(cls(p, { pad: { x: p[0], z: p[1], r: 4 } }), 'camp', 'the camp pad');
    eq(cls(p, { pieces: [{ x: p[0] + 0.3, z: p[1], r: 0.1 }] }), 'piece', 'a stone in the way');
    eq(cls(p, { pieces: [{ x: p[0] + 0.9, z: p[1], r: 0.1 }] }), 'soil', 'a stone clear of the hole');
    eq(strongestPaint(h, cellOf(...set(9, 0, { soil: 240 }))), 'soil', 'the strongest paint');
  });

  test(G, 'layer stacks: soil and the bank two spades, sand one; the word under the last', async () => {
    const R = await RP;
    eq(stackOf('soil', R).join(), 'topsoil,subsoil'); eq(bottomOf('soil', R), 'stones');
    eq(stackOf('bank', R).join(), 'topsoil,clay'); eq(bottomOf('bank', R), 'harder');
    eq(stackOf('sand', R).join(), 'sand'); eq(bottomOf('sand', R), 'sand');
    eq(JSON.stringify(nextLayer('bank', 1, R)), JSON.stringify({ layer: 'clay', depth: 2 }));
    eq(JSON.stringify(nextLayer('sand', 1, R)), JSON.stringify({ bottom: 'sand' }));
  });

  /** @param {any} o */
  const dig = (o) => ({ seed, cell: 9000, day: 4, layer: 'topsoil', depth: 1, season: 0, moisture: 0.5, rainBefore: false, frost: false, thin: 1, budgetLeft: 1, ...o });

  test(G, 'the same seed, cell, day and layer give the same find; another day may not', async () => {
    const R = await RP, K = await KP;
    for (let c = 0; c < 40; c++) {
      const a = digFinds(dig({ cell: c, layer: 'subsoil', depth: 2 }), R, K), b = digFinds(dig({ cell: c, layer: 'subsoil', depth: 2 }), R, K);
      eq(JSON.stringify(a), JSON.stringify(b), `cell ${c}`);
    }
    let differ = 0;
    for (let d = 0; d < 30; d++) if (digFinds(dig({ day: d }), R, K).worm !== digFinds(dig({ day: d + 1 }), R, K).worm) differ++;
    assert(differ > 0, 'days roll apart');
  });

  test(G, 'worms follow the seasons and summer rain; clay comes spring to autumn, not in winter', async () => {
    const R = await RP, K = await KP;
    const rate = (/** @type {any} */ o) => { let n = 0; for (let c = 0; c < 2000; c++) if (digFinds(dig({ cell: c, ...o }), R, K).worm) n++; return n / 2000; };
    const spring = rate({ season: 0 }), summer = rate({ season: 1 }), wetSummer = rate({ season: 1, rainBefore: true }), winter = rate({ season: 3 });
    assert(Math.abs(spring - 0.7) < 0.05, `spring topsoil ${spring}`);
    assert(Math.abs(summer - 0.15) < 0.04, `summer ${summer}`);
    assert(Math.abs(wetSummer - 0.45) < 0.05, `summer after rain ${wetSummer}`);
    eq(winter, 0, 'no worms in winter topsoil');
    eq(digFinds(dig({ layer: 'subsoil', depth: 2, season: 0 }), R, K).worm ?? 'big', 'big', 'subsoil worms are big ones');
    eq(digFinds(dig({ layer: 'clay', depth: 2, season: 2 }), R, K).clay, 'yes', 'clay in autumn');
    eq(digFinds(dig({ layer: 'clay', depth: 2, season: 3 }), R, K).clay, 'winter', 'too stiff in winter');
    eq(digFinds(dig({ layer: 'clay', depth: 2, moisture: 0.8 }), R, K).seep, true, 'a seep on the wettest bank');
    eq(digFinds(dig({ layer: 'clay', depth: 2, moisture: 0.6 }), R, K).seep, false, 'none on a drier one');
  });

  test(G, 'keepsakes: none without budget, thinned by the patch, rarity gated by depth and leaned by weather', async () => {
    const R = await RP, K = await KP;
    let rolled = 0, given = 0, thinned = 0;
    for (let c = 0; c < 3000; c++) {
      const a = digFinds(dig({ cell: c, layer: 'subsoil', depth: 2 }), R, K);
      if (a.rolled) rolled++;
      if (a.keepsake) { given++; eq(a.keepsake.family, 'stone', 'subsoil gives stones'); }
      eq(digFinds(dig({ cell: c, layer: 'subsoil', depth: 2, budgetLeft: 0 }), R, K).keepsake, null, 'none when the day is spent');
      if (digFinds(dig({ cell: c, layer: 'subsoil', depth: 2, thin: 0.25 }), R, K).keepsake) thinned++;
    }
    assert(Math.abs(rolled / 3000 - 0.12) < 0.025, `subsoil chance ${rolled / 3000}`);
    eq(given, rolled, 'with budget, every roll is given');
    assert(thinned < given * 0.4, `a quarter-thinned patch gives fewer (${thinned} of ${given})`);
    const clay = digFinds(dig({ cell: [...Array(4000).keys()].find((c) => digFinds(dig({ cell: c, layer: 'clay', depth: 2 }), R, K).keepsake) ?? 0, layer: 'clay', depth: 2 }), R, K);
    eq(clay.keepsake?.form, 'belemnite', 'the clay gives belemnites');
    const w1 = digRarityWeights(dig({ layer: 'topsoil', depth: 1 }), R), ws = digRarityWeights(dig({ layer: 'sand', depth: 1 }), R), w2 = digRarityWeights(dig({ depth: 2, layer: 'subsoil' }), R);
    eq(w1[2], 0, 'rare needs depth 2'); assert(ws[2] > 0, 'sand\'s rare drift seeds are the exception');
    eq(w2[3], 0, 'very rare needs depth 3'); eq(w2[4], 0, 'once in a lifetime needs depth 3');
    const wet = digRarityWeights(dig({ depth: 2, layer: 'subsoil', rainBefore: true }), R);
    assert(wet[2] > w2[2] && wet[0] === w2[0], 'rain yesterday leans rare in, never common');
  });

  test(G, 'the island\'s budget: 0, 1 or 2 a day by its weights, and never passed', async () => {
    const R = await RP;
    const n = [0, 0, 0];
    for (let d = 0; d < 4000; d++) n[budgetOf(seed, d, R)]++;
    assert(Math.abs(n[0] / 4000 - 0.2) < 0.03 && Math.abs(n[1] / 4000 - 0.65) < 0.03 && Math.abs(n[2] / 4000 - 0.15) < 0.03, `weights ${n.join(',')}`);
    let ev = /** @type {any[]} */ ([]);
    for (let c = 0; c < 50; c++) {
      const left = budgetLeft(ev, seed, 7, R);
      ev = addEvent(ev, { c, d: 7, l: 2, k: left > 0 ? 1 : 0 }, R);
    }
    eq(ev.filter((e) => e.k).length, budgetOf(seed, 7, R), 'no more than the day\'s draw');
  });

  test(G, 'a spot rests a day per layer; a patch thins at the 6th and the 12th dig, and says so once', async () => {
    const R = await RP;
    const ev = [{ c: 5, d: 3, l: 1, k: 0 }];
    eq(rested(ev, 5, 3, 1), true, 'same cell, day and layer');
    eq(rested(ev, 5, 3, 2), false, 'the next layer down');
    eq(rested(ev, 5, 4, 1), false, 'the next day');
    let e = /** @type {any[]} */ ([]);
    const shares = [];
    let firsts = 0;
    for (let i = 0; i < 13; i++) { const t = thinning(e, 1000, R); shares.push(t.share); if (t.firstThin) firsts++; e = addEvent(e, { c: 1000 + (i % 3), d: 3, l: 1, k: 0 }, R); }
    eq(shares.slice(0, 5).join(), '1,1,1,1,1', 'full for the first five');
    eq(shares[5], 0.5, 'half from the 6th'); eq(shares[11], 0.25, 'a quarter from the 12th');
    eq(firsts, 1, 'the thinning line once');
    assert(patchOf(1000, R) !== patchOf(1000 + 20, R), 'another patch 20 m on');
  });

  test(G, 'events keep to their season and the cap, and the dig section cleans on load', async () => {
    const R = await RP;
    let ev = /** @type {any[]} */ ([]);
    ev = addEvent(ev, { c: 1, d: 13, l: 1, k: 0 }, R);
    ev = addEvent(ev, { c: 1, d: 14, l: 1, k: 0 }, R);
    eq(ev.length, 1, 'the season\'s turn drops last season\'s');
    eq(seasonEvents([{ c: 1, d: 2, l: 1, k: 0 }], 20).length, 0, 'a later season sees none');
    for (let i = 0; i < R.events.cap + 20; i++) ev = addEvent(ev, { c: i, d: 15, l: 1, k: 0 }, R);
    eq(ev.length, R.events.cap, 'capped');
    eq(JSON.stringify(cleanDig(null)), JSON.stringify(emptyDig()), 'unreadable comes back empty');
    const c = cleanDig({ version: 1, events: [{ c: 3, d: 2, l: 1, k: 1 }, { c: -1, d: 2, l: 1 }, { c: 1.5, d: 2, l: 1 }, 'x'], firsts: ['layer:clay', 4, 'layer:clay'] });
    eq(c.events.length, 1, 'bad events left out'); eq(c.firsts.join(), 'layer:clay', 'firsts once each');
  });

  /** @param {any} o */
  const hole = (o = {}) => ({ id: 'p1', kind: 'hole', x: 0, z: 0, yaw: 0, seed: 1, size: 0.4, placedHour: 100, depth: 1, layer: 'topsoil', cls: 'soil', dugHour: 100, closedHour: -1, wetH: 0, seep: false, side: 1, ...o });

  test(G, 'a hole fills a third a day, faster in rain, then its dark patch fades and it goes', async () => {
    const R = await RP, h = hole();
    eq(holeNow(h, 110, 0, R).stage, 0, 'open at first');
    eq(holeNow(h, 130, 0, R).stage, 1, 'slumped after a day');
    eq(holeNow(h, 155, 0, R).stage, 2, 'settled after two');
    const shut = holeNow(h, 175, 0, R);
    eq(shut.stage, 3, 'closed after three'); assert(shut.dark > 0.9, 'its patch fresh');
    eq(holeNow(h, 172 + 3 * 24 + 1, 0, R).gone, true, 'faded and gone after three more days');
    eq(holeNow(h, 130, 12, R).stage, 2, 'twelve hours of rain fill it as thirty-six');
    eq(holeNow(closeHole(h, 105), 106, 0, R).stage, 3, 'a closed hole is closed');
    eq(closeHole(closeHole(h, 105), 120).closedHour, 105, 'closing twice keeps the first hour');
    eq(rainHoursIn({ day: 4, rainStartH: 10, rainHours: 4 }, 4 * 24 + 12, 200), 2, 'rain hours inside a span');
    eq(wetSince(hole({ wetH: 5 }), 200, []), 5, 'never less than what it banked');
  });

  test(G, 'the cap settles the oldest open hole; the list keeps its cap; a press near a hole goes into it', async () => {
    const R = await RP;
    const list = [...Array(14).keys()].map((i) => hole({ id: `p${i}`, x: i, dugHour: 100 + i }));
    const r = capHoles(list, (h) => h.closedHour < 0, 120, R);
    eq(r.capped.join(), 'p0,p1', 'the two oldest of fourteen');
    eq(r.holes.filter((h) => h.closedHour < 0).length, R.fill.openCap, 'twelve stay open');
    const many = [...Array(30).keys()].map((i) => hole({ id: `q${i}`, x: i, closedHour: i < 20 ? 110 : -1 }));
    eq(capHoles(many, (h) => h.closedHour < 0, 120, R).holes.length, R.fill.listCap, 'the list keeps its cap');
    eq(holeAt([hole({ x: 1 })], 1.3, 0, (h) => h.closedHour < 0, R)?.id, 'p1', 'within spacing');
    eq(holeAt([hole({ x: 1 })], 1.8, 0, (h) => h.closedHour < 0, R), null, 'past spacing');
  });

  test(G, 'a hole record saves and comes back in the pieces section; a bad one is left out', async () => {
    const s = cleanPieces({ version: 1, nextId: 3, list: [hole(), { ...hole({ id: 'p2' }), depth: 0 }] });
    eq(s.list.length, 1, 'one hole kept');
    eq(JSON.stringify(s.list[0]), JSON.stringify(hole()), 'exactly as saved');
    eq(cleanHoleFields({ ...hole(), closedHour: 'x' })?.closedHour, -1, 'an unreadable closing hour is open');
  });

  test(G, 'the dig motion: about 1.2 seconds (two until October 26, 2026), hands on the shovel throughout, bent over and a twist, back at rest', async () => {
    const PO = (await FP).poses;
    const len = actLength(PO, 'dig');
    assert(len >= 1 && len <= 1.5, `length ${len}`);
    let maxLean = 0, maxTwist = 0;
    for (let u = 0; u <= len; u += 0.05) {
      const p = actPose(PO, 'dig', u);
      assert(p.arms > 0.99, 'both hands on the handle');
      assert(p.kneel === 0 && p.crawl === 0, 'standing');
      assert(p.lean >= 0 && p.lean <= 70 && p.drop <= 0.2, `within limits at ${u.toFixed(2)}`);
      maxLean = Math.max(maxLean, p.lean); maxTwist = Math.max(maxTwist, p.twist);
    }
    assert(maxLean >= 55, `bent over (${maxLean})`); assert(maxTwist >= 20 && maxTwist <= 30, `the twist ${maxTwist}`);
    const end = actPose(PO, 'dig', len);
    eq(end.twist + end.lean + end.drop, 0, 'back at rest');
  });

  test(G, 'rush cord at the workbench: a handful of rushes or marram makes a handful of cord; the shovel takes a stick, a flat stone and cord', async () => {
    const C = await json('world/cook');
    const st = cleanCook(null);
    const cord = C.makes['rush-cord'];
    eq(cord.at, 'workbench'); eq(cord.out, 'pouch'); eq(cord.gives, 'rush-cord'); eq(cord.count, 1);
    eq(layout(C, 'workbench', ['rushes.stems'], st).make, 'rush-cord', 'rushes make cord');
    assert(layout(C, 'workbench', ['rushes.stems'], st).complete, 'one handful is all it takes');
    eq(layout(C, 'workbench', ['marram.leaves'], st).make, 'rush-cord', 'marram leaves serve too');
    const sh = layout(C, 'workbench', ['sticks', 'flat-stones', 'rush-cord'], st);
    eq(sh.make, 'shovel', 'the shovel'); assert(sh.complete, 'complete with three parts');
    const made = recordMade(st, 'shovel', 40, C.makes.shovel.out === 'tool');
    assert(made.tools.includes('shovel'), 'the shovel is kept as a tool: Dig is offered from then on');
    eq(layout(C, 'workbench', ['sticks', 'flat-stones', 'rush-cord'], recordMade(made, 'shovel', 41)).make === 'shovel', false, 'only one shovel is ever made');
  });

  test(G, 'rushes: a pick lowers the cell by a quarter and waits until it grows back; out of season, none', async () => {
    const R = await GP;
    eq(coverPick(240, R), 176, 'a quarter of full');
    assert(coverPickable(240, 250, 'rushes', 1.5, R).ok, 'a full stand in summer');
    eq(coverPickable(176, 250, 'rushes', 1.5, R).why, 'rest', 'picked: let it rest');
    eq(coverPickable(240, 250, 'rushes', 0.5, R).why, 'season', 'too soft in spring');
    eq(coverPickable(240, 250, 'rushes', 1.5, R).part, 'stems', 'its part');
    eq(coverPickable(240, 250, 'grass', 1.5, R).ok, false, 'grass is never picked');
  });
}

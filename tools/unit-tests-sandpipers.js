// @ts-check
// Purple sandpipers tests for tools/unit-tests.html (B3 wave 3; recipes/species/purple-sandpiper.json,
// src/app/sandpipers.js, src/world/sandpipers/wall.js, and the turnstones' shared flock life): the
// bird is the turnstone's body with a longer, drooping bill, shorter legs and its own colours, and
// it bakes within the turnstone's budget; their home is the longest wall that meets the need, and
// their spots are the wall's rock out of the water (the top only at high tide); a wall home recorded
// in late autumn brings a flock sized to the wall, the same every run, and none in summer; the live
// flock creeps when close, bobs, roosts tucked and flushes low and tight at Wary; and every card of
// theirs has a home (the journal page saying they bring no gift, the list, the web, the sketchbook,
// the icon, the morning hint).

import { recordHome, coarseStep } from '../src/world/creatures/flock.js';
import { createFlockLife } from '../src/world/turnstones/live.js';
import { wallOf, wallSpots } from '../src/world/sandpipers/wall.js';
import { bakeBird, bodyPrims } from '../src/world/creatures/bird-model.js';
import { gaitPose, bobPose, roostPose, idlePose } from '../src/world/creatures/bird-motion.js';
import { HABITAT_ORIGIN } from '../src/world/growth/habitat.js';
import { ICON_NAMES } from '../src/ui/icons/icons.js';
import { HOURS_PER_DAY } from '../src/core/clock.js';

const G = 'sandpipers';
/** @param {string} p */
const json = (p) => fetch(new URL(`../recipes/${p}.json`, import.meta.url)).then((r) => r.json());
/** @type {Promise<any> | null} */ let loaded = null;
const load = () => loaded ?? (loaded = Promise.all(['species/purple-sandpiper', 'birds/purple-sandpiper', 'birds/turnstone', 'species/turnstone', 'world/journal', 'world/journal-list',
  'world/journal-web', 'world/sketchbook', 'world/morning-hints', 'world/seasons', 'index'].map(json))
  .then(([R, B, BT, RT, J, JL, JW, SB, MH, SE, IX]) => ({ R, B, BT, RT, J, JL, JW, SB, MH, SE, IX })));

/** A world in a season, with or without their winter window. @param {number} season @param {boolean} [away] */
const world = (season, away = false) => ({ seasons: { index: season, phase: 0.6, dormant: { sandpipers: away } } });
/** The env the tick passes (both flocks, so the turnstones are seen to stay out of it). @param {any} R @param {any} RT */
const envOf = (R, RT) => ({ seed: 12345, recipes: { species: { turnstone: RT, 'purple-sandpiper': R } }, testTrust: 0 });

/** Run hours of the tick from h0, gathering events. @param {any} state @param {number} h0 @param {number} hours @param {any} env */
function runHours(state, h0, hours, env) {
  /** @type {any[]} */ const events = [];
  for (let h = h0; h < h0 + hours; h++) { const r = coarseStep(state, h, env); state = r.state; events.push(...r.events.map((e) => ({ ...e, hour: h }))); }
  return { state, events };
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addSandpipersTests(test, assert, eq) {
  test(G, 'the bird is the turnstone changed: a longer drooping bill, shorter legs, slate above, yellow-orange legs', async () => {
    const { B, BT, IX } = await load();
    const S = B.shape, T = BT.shape;
    const billLen = (/** @type {any} */ b) => Math.hypot(b.tip[1] - b.base[1], b.tip[2] - b.base[2]);
    assert(billLen(S.bill) > billLen(T.bill) * 1.3, 'a longer bill');
    assert(S.bill.mid && S.bill.tip[1] < S.bill.mid[1] - 0.002, 'drooping toward the tip');
    eq(bodyPrims(S).filter((p) => p.part === 'bill').length, 2, 'the bill bends at mid: two pieces');
    assert(S.leg.hip[1] - S.leg.foot[1] < T.leg.hip[1] - T.leg.foot[1], 'shorter legs');
    const W = B.plumage.winter.parts;
    assert(W.upper[2] > W.upper[0] && W.upper[0] < 0.12, 'slate with a purple cast above');
    assert(W.under[0] > 0.5, 'a pale belly');
    assert(W.leg[0] > W.leg[1] && W.leg[1] > W.leg[2] * 3, 'yellow-orange legs');
    eq(Object.keys(B.plumage).join(), 'winter', 'winter plumage only');
    assert(IX.recipes['birds/purple-sandpiper'] && IX.recipes['species/purple-sandpiper'] && IX.recipes['audio/purple-sandpiper'], 'registered');
  });

  test(G, 'it bakes within the turnstone budget, single and flock, with a yellow bill base', async () => {
    const { B } = await load();
    const K = B.bake;
    eq(K.maxTris, 3000); eq(K.flockTris, 1196);
    for (const max of [K.maxTris, K.flockTris]) {
      const b = bakeBird({ shape: B.shape, plumage: B.plumage.winter, wingPattern: B.wingPattern, cellM: K.cellM, wingCellM: K.wingCellM,
        blendM: K.blendM, maxTris: max, wingShare: K.wingShare, attrWeight: K.attrWeight });
      const tris = b.indices.length / 3;
      assert(tris <= max, `${tris} triangles within ${max}`);
      assert(tris > max * 0.7, `${tris} triangles uses the budget`);
    }
  });

  test(G, 'the sandpiper clips: creep low and leaning, bob dips the body, roost tucks the head back and sinks', async () => {
    const { B } = await load();
    const M = B.motion;
    const walk = gaitPose(1, 0.3, M, 'walk'), creep = gaitPose(1, 0.3, M, 'creep');
    assert(creep.bodyLift < walk.bodyLift && creep.bodyPitch > walk.bodyPitch, 'creep is lower and leans in');
    eq(creep.gait.strideM, M.creep.strideM);
    const bob = bobPose(1, 0.25, M);
    assert(bob.bodyLift < -0.003 && bob.tailUp > 0, 'a dip with a tail flick');
    const r0 = roostPose(1, 0, M), r1 = roostPose(1, 10, M);
    assert(Math.abs(r0.bodyLift) < 1e-6 && r1.bodyLift <= -M.roost.dropM + 1e-6, 'eases down onto its legs');
    assert(Math.abs(r1.neckYaw) + Math.abs(r1.headYaw) > 2, 'the head turned back over the shoulder');
    assert(Number.isFinite(idlePose(1, M).headYaw), 'idle still works');
  });

  test(G, 'their home is the longest wall that meets the need; the rocky point never counts', async () => {
    const { R } = await load();
    const H = R.ecology.visit.home;
    eq(H.check, 'wall'); eq(H.need.lengthM, 8);
    eq(wallOf({ walls: [], _cells: { walls: [] } }, H), null);
    const rep = { walls: [{ lengthM: 12, x: 1, z: 2 }, { lengthM: 5, x: 9, z: 9 }], _cells: { walls: [[10, 11], [40]] } };
    const w = wallOf(rep, H);
    assert(w && w.wall.lengthM === 12 && w.cells.join() === '10,11', 'the long wall');
    // Only a short one: it is still their place to show the visit, but not a home met.
    const short = wallOf({ walls: [{ lengthM: 5, x: 0, z: 0 }], _cells: { walls: [[3]] } }, H);
    assert(short && short.wall.lengthM === 5, 'the short one');
  });

  test(G, 'the wall spots: rock out of the water and not too steep, the top alone at high tide, the same each time', async () => {
    const { R } = await load();
    const W = R.life.wall, n = 192;
    // A terraced wall along x: a tread at 0.3 m by the sea (j = 100), a tread at 1.4 m behind it (j = 101), sea beyond (j = 99).
    const zOf = (/** @type {number} */ j) => HABITAT_ORIGIN + j;
    const ground = (/** @type {number} */ x, /** @type {number} */ z) => (z < zOf(100) ? -1 : z < zOf(101) ? 0.3 : 1.4);
    const cells = [100 * n + 50, 100 * n + 51, 100 * n + 52];
    const low = wallSpots(cells, n, ground, 0, W);
    assert(low.some((s) => s.y === 0.3) && low.some((s) => s.y === 1.4), 'the wet foot and the top at low water');
    assert(low.every((s) => s.y - 0 >= W.aboveM[0]), 'nothing under the water');
    const high = wallSpots(cells, n, ground, 0.5, W);
    assert(high.length > 0 && high.every((s) => s.y === 1.4), 'only the top at high tide');
    eq(JSON.stringify(wallSpots(cells, n, ground, 0, W)), JSON.stringify(low), 'the same spots');
  });

  test(G, 'a wall in late autumn: a flock settles sized to the wall, the same every run; none in summer; the turnstones stay out of it', async () => {
    const { R, RT, SE } = await load();
    const env = envOf(R, RT), A = R.ecology.arrival;
    const start = recordHome(world(2), 'sandpipers', { met: true, m: 12, x: 5, z: -3 });
    const a = runHours(start, 30 * HOURS_PER_DAY, 6 * HOURS_PER_DAY, env);
    const b = runHours(start, 30 * HOURS_PER_DAY, 6 * HOURS_PER_DAY, env);
    eq(JSON.stringify(a.events), JSON.stringify(b.events), 'the same events');
    const names = a.events.map((e) => e.name);
    assert(names.includes('creature:arrived') && names.includes('creature:settled'), names.join(', '));
    const S = a.state.creatures.sandpipers;
    const count = S.groups.reduce((/** @type {number} */ s, /** @type {any} */ g) => s + g.count, 0);
    eq(count, Math.floor(12 / A.m2PerOne), 'one bird a share of the wall');
    assert(!a.state.creatures.turnstones, 'no turnstones from a wall');
    assert(a.events.every((e) => e.payload?.species === 'sandpipers'), 'every event is theirs');
    const w = SE.dormancy.sandpipers;
    assert(w[0] < 1 && w[1] > 2 && w[1] < 3, 'away from spring until mid-autumn');
    const r = runHours(recordHome(world(1, true), 'sandpipers', { met: true, m: 12, x: 0, z: 0 }), 20 * 24, 4 * 24, env);
    assert(!r.events.some((e) => e.name === 'creature:arrived'), 'none comes in summer');
  });

  test(G, 'the live flock creeps close by, bobs, roosts tucked on the top, and flushes low and tight at Wary', async () => {
    const { R, B } = await load();
    const M = B.motion;
    // The wall: wet rock at 0.3 m along x, its top at 1.4 m just behind.
    const spots = [...Array.from({ length: 20 }, (_, i) => ({ x: i * 0.6, z: 0, y: 0.3 })), ...Array.from({ length: 20 }, (_, i) => ({ x: i * 0.6, z: 1.2, y: 1.4 }))];
    const ground = (/** @type {number} */ x, /** @type {number} */ z) => (z > 0.9 ? 1.4 : 0.3);
    const life = createFlockLife({ L: R.life, P: R.presence, M, k: R.body.displayScale, seed: 11, ground, tide: () => 0 });
    const base = { count: 6, home: { x: 5, z: 0 }, spots, roost: false, walker: null, trust: 0, band: 0, known: false };
    let creeps = 0, bobs = 0, flips = 0;
    for (let i = 0; i < 30 * 60; i++) {
      life.step(1 / 30, base);
      for (const b of life.birds()) {
        const P = /** @type {any} */ (b).pose;
        if (b.mode === 'run' && P?.gait?.strideM === M.creep.strideM) creeps++;
        if (b.mode === 'bob') bobs++;
        if (b.mode === 'flip') flips++;
      }
    }
    assert(creeps > 0, 'they creep'); assert(bobs > 0, 'they bob'); eq(flips, 0, 'they turn nothing over');
    // High tide: they gather on the top and tuck down.
    for (let i = 0; i < 30 * 40; i++) life.step(1 / 30, { ...base, roost: true });
    const tucked = life.birds().filter((b) => /** @type {any} */ (b).pose?.bodyLift < -M.roost.dropM * 0.5);
    assert(life.birds().every((b) => b.z > 0.6), 'all up on the top');
    assert(tucked.length >= 4, `tucked down (${tucked.length} of 6)`);
    // The walker at Wary: off low and tight, landing along the wall.
    const c = life.middle();
    /** @type {any} */ const walker = { kind: 'walker', body: true, pos: [c.x + 1.5, 1.4, c.z], speed: 1, posture: 'stand', gaze: null, stillS: 0, editing: false, edits: [] };
    const said = life.step(1 / 30, { ...base, walker });
    assert(said.includes('flushed'), 'flushed');
    let top = 0;
    for (let i = 0; i < 30 * 15; i++) { life.step(1 / 30, { ...base, walker }); for (const b of life.birds()) top = Math.max(top, b.y); }
    assert(top < (0.25 + R.life.flyUpM[1]) * R.body.displayScale, `low over the water (${top.toFixed(2)} m)`);
    assert(life.birds().every((b) => b.y === 0 && b.mode !== 'fly'), 'all down again');
  });

  test(G, 'every card has a home: page (no gift, said so), list, web, sketchbook, icon, morning hint', async () => {
    const { R, J, JL, JW, SB, MH } = await load();
    const P = J.species.sandpipers;
    assert(P && P.kind === 'school' && J.order.includes('sandpipers'), 'a journal page in order');
    for (const k of ['right', 'sign', 'signAgain', 'found', 'settled', 'settledUnseen', 'back', 'joined', 'joinedUnseen', 'left', 'gone', 'scoutLeftUnseen', 'thinned', 'eased', 'dormant', 'woke', 'happy', 'known']) assert(P.notes[k], `note ${k}`);
    assert(P.uneasy.wrack, 'uneasy about the wall (the flock reason)');
    assert(P.hints.some((/** @type {any} */ h) => h.when === 'sandpipers:visited'), 'the visit pencil hint');
    assert(P.gives.some((/** @type {any} */ g) => /no gift/.test(g.pencil) && /no gift/.test(g.ink)), 'says they bring no gift');
    assert(!R.ecology.gift, 'no gift in the recipe');
    eq(R.presence.feedTrust, 0, 'watching only');
    eq(JL.placeOf.sandpipers, 'shore');
    assert(JW.nodes.sandpipers && JW.links.some((/** @type {any} */ l) => l.a === 'rock' && l.b === 'sandpipers'), 'on the web, feeding on rock');
    assert(SB.subjects.includes('sandpipers') && SB.art.sandpipers === 'sandpiper', 'a sketchbook page');
    assert(ICON_NAMES.includes('sandpiper'), 'a drawn icon');
    assert(MH.hints.some((/** @type {any} */ h) => h.visit === 'sandpipers'), 'a visit hint');
    assert(MH.tests.animalCame.some((/** @type {any} */ w) => w.visited?.includes('sandpipers')), 'animalCame');
    assert(MH.hints.find((/** @type {any} */ h) => h.id === 'animals').showMe.includes('sandpipers'), 'Show me rings them');
  });
}

// @ts-check
// European eel tests for tools/unit-tests.html (B3 wave 2; recipes/species/eel.json): their home is
// a pond you dug long ago near the sea (S0's check), they come only on rainy autumn nights once it
// is made and only into that pond, they sleep in the mud through the winter, the same seed gives the
// same eels, the body is a chain of bones that swims, rests and crosses grass as a wave and never
// slides, and the page, web, hints and test link are in place.

import { runHour, hashWorldState } from '../src/sim/tick.js';
import { gateOpen, atHome } from '../src/world/creatures/swarms.js';
import { eelBody, poseEel } from '../src/world/creatures/eel.js';
import { createEelSwim, shoreNear } from '../src/world/creatures/eel-swim.js';
import { axisAngle } from '../src/world/creatures/pose.js';
import { MAX_BONES } from '../src/world/creatures/bodies.js';
import { homeOf } from '../src/world/ecology/shaped.js';
import { seasonsAt } from '../src/world/seasons.js';
import { SECONDS_PER_HOUR, HOURS_PER_DAY } from '../src/core/clock.js';
import { ICON_NAMES } from '../src/ui/icons/icons.js';
import { TEST_PARAMS } from '../src/save/autosave.js';
import { HABITAT_ORIGIN } from '../src/world/growth/habitat.js';
import { loadEcologyRecipes, islandWorld, digPond } from './ecology-world.js';

const G = 'eels';
const KEY = 'eels';
const json = (/** @type {string} */ p) => fetch(new URL(`../recipes/${p}.json`, import.meta.url)).then((r) => r.json());

/**
 * Run a world for some hours, keeping the eels' events.
 * @param {any} state @param {any} env @param {number} from @param {number} hours
 */
function run(state, env, from, hours) {
  /** @type {{ hour: number, name: string, payload: any }[]} */ const events = [];
  /** @type {number[]} */ const rainy = [];
  for (let h = from; h < from + hours; h++) {
    const r = runHour(state, h, env);
    state = r.state;
    if (h % 24 === 22 && (state.weather?.today?.rainHours ?? 0) > 0) rainy.push(h);
    for (const e of r.events) if (e.payload?.species === KEY) events.push({ hour: h, name: e.name, payload: e.payload });
  }
  return { state, events, rainy };
}

/** An autumn world with a dug pond (its home, if `home`), from day 28. @param {any} R @param {number} seed @param {boolean} home */
function autumnPond(R, seed, home) {
  const w = islandWorld(R, 'starter-island', seed, 28);
  const p = digPond(w, { w: 6, h: 6 });
  if (!p) throw new Error('no room for a pond');
  if (home) w.state = { ...w.state, homes: { [KEY]: { met: true, x: p.x, z: p.z } } };
  return { w, p };
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addEelTests(test, assert, eq) {
  test(G, 'the gate: autumn, a day with rain and the home made; the home pool only', () => {
    const A = { gate: { seasons: [2], rain: true, home: true, homeM: 12 } };
    const s = (/** @type {number} */ season, /** @type {number} */ rain, /** @type {any} */ homes) => ({ seasons: { index: season }, weather: { today: { rainHours: rain } }, homes });
    const home = { [KEY]: { met: true, x: 0, z: 0 } };
    eq(gateOpen(s(2, 3, home), A, KEY), true, 'a rainy autumn day with the home');
    eq(gateOpen(s(2, 0, home), A, KEY), false, 'a dry day');
    eq(gateOpen(s(1, 3, home), A, KEY), false, 'summer');
    eq(gateOpen(s(2, 3, undefined), A, KEY), false, 'no home');
    eq(gateOpen(s(0, 0, undefined), {}, KEY), true, 'no gate: always open');
    // Pools on a 4 x 4 grid: one at the home, one far off.
    const n = 160, at = (/** @type {number} */ x, /** @type {number} */ z) => (z - HABITAT_ORIGIN) * n + (x - HABITAT_ORIGIN);
    const pools = [{ id: 1, deepK: at(2, 1) }, { id: 2, deepK: at(40, 40) }];
    eq(atHome(pools, s(2, 3, home), A, KEY, n).map((p) => p.id).join(), '1', 'only the pool at the home');
    eq(atHome(pools, s(2, 3, undefined), A, KEY, n).length, 0, 'none without a home');
    eq(atHome(pools, s(2, 3, undefined), {}, KEY, n).length, 2, 'every pool without a gate');
  });

  test(G, 'their home is the S0 pond check: dug, a year old, near the sea, wet grass between', async () => {
    const rec = await json('species/eel');
    const H = rec.ecology.visit.home;
    eq(H.check, 'pond');
    eq(H.need.ageDays, 56, 'a year old');
    eq(H.need.wetGrass, true, 'wet grass between');
    eq(H.max.seaM, 30, 'within 30 m of the sea');
    const pond = (/** @type {any} */ o) => ({ ponds: [{ dug: true, ageDays: 60, wetGrass: true, seaM: 12, x: 1, z: 2, ...o }] });
    eq(homeOf(pond({}), H).met, true, 'a year-old dug pond 12 m from the sea');
    eq(homeOf(pond({ ageDays: 30 }), H).met, false, 'too young');
    eq(homeOf(pond({ wetGrass: false }), H).met, false, 'no wet grass');
    eq(homeOf(pond({ seaM: 40 }), H).met, false, 'too far from the sea');
    eq(homeOf(pond({ dug: false }), H).met, false, 'the starter pond never counts');
    eq(rec.ecology.gift, undefined, 'no gift (only the teal give one)');
    eq(rec.presence.ceiling, 'tolerant', 'watching only');
    eq(rec.presence.feedTrust, 0, 'no feeding');
    eq(rec.treat, undefined, 'no treats');
    const land = await json('land/meadow-islet');
    assert(!land.milestone.flags.includes('eels:happy'), 'they never count toward a tier milestone');
  });

  test(G, 'with their home made they come on a rainy autumn night at 22:00, into that pond; without it, never', async () => {
    const R = await loadEcologyRecipes();
    const lines = [];
    for (const seed of [1, 2]) {
      const { w, p } = autumnPond(R, seed, true);
      const r = run(w.state, w.env, w.h0 + 1, 24 * 13);
      const came = r.events.find((e) => e.name === 'creature:arrived');
      if (!r.rainy.length) { eq(came, undefined, `seed ${seed}: no rainy night, none came`); lines.push(`seed ${seed}: no rainy autumn night`); continue; }
      assert(came, `seed ${seed}: they came (rainy nights at ${r.rainy.map((h) => (h / 24).toFixed(1)).join(', ')})`);
      eq(came.hour % 24, 22, `seed ${seed}: at 22:00`);
      assert(r.rainy.includes(came.hour), `seed ${seed}: on a rainy night`);
      assert(Math.hypot(came.payload.x - p.x, came.payload.z - p.z) < 12, `seed ${seed}: into the dug pond (${came.payload.x.toFixed(1)}, ${came.payload.z.toFixed(1)}) by (${p.x}, ${p.z})`);
      const none = run(autumnPond(R, seed, false).w.state, w.env, w.h0 + 1, 24 * 13);
      eq(none.events.filter((e) => e.name === 'creature:arrived').length, 0, `seed ${seed}: none without the home`);
      lines.push(`seed ${seed}: came day ${(came.hour / 24).toFixed(2)}, ${came.payload.count} eels`);
    }
    return lines.join('; ');
  });

  test(G, 'they sleep in the pond mud through the winter, and the same seed gives the same eels twice', async () => {
    const R = await loadEcologyRecipes();
    const at = (/** @type {number} */ season, /** @type {number} */ day) => seasonsAt(((season * 14 + day) * HOURS_PER_DAY + 12) * SECONDS_PER_HOUR, R.seasons).dormant.eels;
    eq(at(2, 6), false, 'autumn');
    eq(at(3, 3), true, 'winter');
    eq(at(0, 6), false, 'spring');
    const once = () => { const { w } = autumnPond(R, 3, true); return run(w.state, w.env, w.h0 + 1, 24 * 12).state; };
    const a = once(), b = once();
    eq(JSON.stringify(a.creatures?.[KEY] ?? null), JSON.stringify(b.creatures?.[KEY] ?? null), 'the eels');
    eq(hashWorldState(a), hashWorldState(b), 'the world');
  });

  test(G, 'the body: a chain of bones from snout to tail, posed as one wave that never breaks', async () => {
    const rec = await json('species/eel');
    const body = eelBody(rec.body);
    const segs = body.bones.filter((/** @type {any} */ b) => b.name.startsWith('seg.'));
    eq(segs.length, rec.body.segments, 'a bone a segment');
    assert(body.bones.length <= MAX_BONES, `${body.bones.length} bones fit the pass's ${MAX_BONES}`);
    body.bones.forEach((/** @type {any} */ b, /** @type {number} */ i) => eq(b.parent, i - 1, `${b.name} hangs from the one before`));
    assert(body.prims.every((/** @type {any} */ p) => body.bones.some((/** @type {any} */ b) => b.name === p.bone)), 'every piece on a bone');
    const M = rec.motion;
    // Swimming: the joints' turns add up to the curve, and grow toward the tail.
    for (const f of [{ wave: 0.3, amp: M.swimAmpM, even: 0 }, { wave: 2.1, amp: M.crossAmpM, even: 1 }, { wave: 5, amp: M.restAmpM, even: 0 }]) {
      const moves = poseEel(body.bones, f, M, [0, 0, 0, 1], axisAngle);
      const yaw = moves.map((m) => (m ? 2 * Math.atan2(m.q[1], m.q[3]) : 0));
      assert(yaw.every((v) => Number.isFinite(v) && Math.abs(v) < 0.9), `turns stay gentle: ${yaw.map((v) => v.toFixed(2)).join(' ')}`);
      const head = Math.abs(yaw[0]) + Math.abs(yaw[1]), tail = Math.abs(yaw[segs.length - 1]) + Math.abs(yaw[segs.length - 2]);
      if (!f.even) assert(tail >= head * 0.5, `the wave is no smaller at the tail (${tail.toFixed(3)} vs ${head.toFixed(3)})`);
    }
    const a = poseEel(body.bones, { wave: 0, amp: M.swimAmpM, even: 0 }, M, [0, 0, 0, 1], axisAngle);
    const b = poseEel(body.bones, { wave: 1.5, amp: M.swimAmpM, even: 0 }, M, [0, 0, 0, 1], axisAngle);
    assert(a.some((m, i) => Math.abs(/** @type {any} */ (m).q[1] - /** @type {any} */ (b[i]).q[1]) > 0.01), 'the pose moves with the wave');
  });

  test(G, 'alive: hunting by night, resting by day, never on dry ground, crossing the grass to the pond, the visitor gone again', async () => {
    const rec = await json('species/eel');
    const M = { ...rec.motion, lengthM: rec.body.lengthM, radiusM: rec.body.radiusM };
    // A round pond 3 m across at the origin; the sea beyond x > 9.
    const water = (/** @type {number} */ x, /** @type {number} */ z) => {
      if (x > 9) return { surface: 0, depth: 1 };
      const r2 = (x * x + z * z) / 9;
      return { surface: 0, depth: Math.max(0, 0.7 * (1 - r2)) };
    };
    const ground = (/** @type {number} */ x, /** @type {number} */ z) => (water(x, z).depth > 0 ? -water(x, z).depth : 0.05);
    const make = () => createEelSwim({ id: 1, seed: 7, count: 3, home: { x: 0, z: 0 }, deep: { x: 0, z: 0 }, size: rec.body.displayScale, M, env: { water, ground } });
    const a = make(), b = make();
    a.setMood('night'); b.setMood('night');
    let dry = 0, moved = 0;
    for (let i = 0; i < 30 * 120; i++) {
      const before = a.fish.map((f) => [f.x, f.z]);
      a.step(1 / 30); b.step(1 / 30);
      a.fish.forEach((f, k) => { if (water(f.x, f.z).depth < M.minDepthM * 0.5) dry++; moved += Math.hypot(f.x - before[k][0], f.z - before[k][1]); });
    }
    eq(dry, 0, 'steps on dry ground while living in the pond');
    assert(moved > 3, `they hunted about at night (${moved.toFixed(1)} m between them)`);
    eq(a.fish.map((f) => f.x.toFixed(5)).join(), b.fish.map((f) => f.x.toFixed(5)).join(), 'the same seed, the same eels');
    // By day they settle and lie still but for the ripple: the wave still moves, the body barely.
    a.setMood('day');
    for (let i = 0; i < 30 * 200; i++) a.step(1 / 30);
    const w0 = a.fish.map((f) => f.wave), p0 = a.fish.map((f) => [f.x, f.z]);
    for (let i = 0; i < 30 * 2; i++) a.step(1 / 30);
    assert(a.fish.every((f, k) => f.wave !== w0[k]), 'a slow ripple runs down each resting eel');
    const drift = a.fish.reduce((s, f, k) => s + Math.hypot(f.x - p0[k][0], f.z - p0[k][1]), 0);
    assert(drift < 0.5, `resting, they barely move (${drift.toFixed(2)} m in two seconds)`);
    // Crossing: two come up at the shore (8.5, 0) and cross to the pond; while on the grass their
    // wave advances as far as they go (the body follows the head's track).
    a.resize(5);
    a.cross(2, { x: 8.5, z: 0 });
    let crossed = -1, onGrass = 0, slide = 0;
    for (let i = 0; i < 30 * 200 && crossed < 0; i++) {
      const w = a.fish.slice(3).map((f) => f.wave), at0 = a.fish.slice(3).map((f) => [f.x, f.z]);
      a.step(1 / 30);
      a.fish.slice(3).forEach((f, k) => {
        if (f.mode !== 'cross') return;
        onGrass++;
        const d = Math.hypot(f.x - at0[k][0], f.z - at0[k][1]);
        if (d > 1e-4 && f.wave - w[k] < 1e-6) slide++;
      });
      if (a.fish.slice(3).every((f) => f.mode === 'swim' || f.mode === 'rest')) crossed = i / 30;
    }
    assert(crossed > 0, `both crossed to the pond (in ${crossed.toFixed(0)} s)`);
    assert(onGrass > 30, `they were seen on the grass (${onGrass} eel-steps)`);
    eq(slide, 0, 'eel-steps sliding over the grass without the wave moving');
    // The visitor: in from the sea, up the shore and back out, then gone.
    const v = createEelSwim({ id: -1, seed: 9, count: 1, home: { x: 11, z: 0 }, deep: { x: 11, z: 0 }, size: rec.body.displayScale, M, env: { water, ground } });
    v.visit({ x: 8.5, z: 0 }, { x: 10.5, z: 0 });
    let up = -Infinity;
    for (let i = 0; i < 30 * 120 && !v.gone; i++) { v.step(1 / 30); up = Math.max(up, -v.fish[0].x); }
    assert(v.gone, 'the visitor went back to the sea');
    assert(up > -8.4, `it nosed up past the shore square (to x ${(-up).toFixed(2)})`);
    return `crossed in ${crossed.toFixed(0)} s`;
  });

  test(G, 'shoreNear: the land square on the waterline nearest the pond', () => {
    const n = 8, open = new Uint8Array(n * n).fill(1), sea = new Uint8Array(n * n), depthCm = new Uint8Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 6; i < n; i++) sea[j * n + i] = 1;
    const p = shoreNear({ n, open, sea, depthCm }, HABITAT_ORIGIN + 1.5, HABITAT_ORIGIN + 3.5);
    eq(p && p.x, HABITAT_ORIGIN + 5.5, 'the column beside the sea');
    eq(p && p.z, HABITAT_ORIGIN + 3.5, 'level with the pond');
    eq(shoreNear(null, 0, 0), null, 'no habitat');
  });

  test(G, 'the journal page, web, hints, sketchbook and test link', async () => {
    const [words, web, list, hints, book, index] = await Promise.all([json('world/journal'), json('world/journal-web'), json('world/journal-list'),
      json('world/morning-hints'), json('world/sketchbook'), json('index')]);
    const P = words.species[KEY];
    assert(P && P.kind === 'school' && words.order.includes(KEY), 'a page in the animals');
    assert(ICON_NAMES.includes(P.icon), `its icon ${P.icon} is drawn`);
    eq(list.placeOf[KEY], 'pond', 'listed at the pond');
    assert(!/genuine/i.test(JSON.stringify(P)), 'plain words');
    for (const k of ['sign', 'signAgain', 'settledUnseen', 'joinedUnseen', 'scoutLeftUnseen', 'right']) assert(!/\beels?\b/i.test(P.notes[k]), `the ${k} note never names them`);
    assert(P.hints.some((/** @type {any} */ h) => h.when === 'eels:visited'), 'the visit pencils a hint');
    const node = web.nodes[KEY];
    assert(node && node.page === KEY && node.flag === `${KEY}:seen`, 'a web node known once found');
    const ties = web.links.filter((/** @type {any} */ l) => l.b === KEY).map((/** @type {any} */ l) => l.a);
    for (const t of ['shore', 'fresh', 'grass', 'pondweed', 'frogspawn']) assert(ties.includes(t), `the web ties ${t} to them`);
    for (const l of web.links.filter((/** @type {any} */ x) => x.b === KEY)) assert(web.nodes[l.a], `${l.a} is a node`);
    assert(hints.hints.some((/** @type {any} */ h) => h.visit === KEY), 'a morning hint after a visit');
    assert(hints.tests.animalCame.some((/** @type {any} */ t) => t.flag === 'eels:sign'), 'their coming counts as an animal come');
    assert(hints.hints.find((/** @type {any} */ h) => h.id === 'animals').showMe.includes(KEY), 'Show me can ring them');
    assert(book.subjects.includes(KEY), 'a sketchbook subject');
    eq(index.recipes?.['species/eel'] ?? index['species/eel'] ?? Object.values(index).find((v) => typeof v === 'object' && v['species/eel'])?.['species/eel'], 'species/eel.json', 'registered');
    assert(TEST_PARAMS.includes(KEY), '?eels is a throwaway island');
  });
}

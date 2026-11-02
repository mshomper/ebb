// @ts-check
// Grey seal tests for tools/unit-tests.html (B3 wave 3; src/world/seals, src/world/creatures/flock.js):
// the game copy of Matt's model builds into a rig of eleven bones, parents first, every vertex's
// weights whole, about 2 m long, the flippers and head weighted to their own bones; nothing happens
// until a bar home is recorded; a quiet bar in autumn brings them, the same every run, and away at
// sea in spring and summer none come; a bar the walker crossed makes them uneasy and they go; the
// pup comes once a year on a seeded day of 29 to 35 with the home met, stays 21 days, white for 14
// then greying, and goes, the same on every run and never without a home; the live seals lie on dry
// ground apart, bottle in the water when the tide covers their spots, flush into the sea from the
// walker at Wary (a mother stays by her pup) and only lift their heads past Wary; a moving seal is
// posed every frame (never a still model sliding); and every card has a home (the journal page and
// its notes, the list, the web, the sketchbook, the icon, the morning hints, the seasons).

import { flockStep, recordHome, coarseStep } from '../src/world/creatures/flock.js';
import { buildSeal, SEAL_BONES, B } from '../src/world/seals/model.js';
import { createSealLife } from '../src/world/seals/live.js';
import { pupDay, pupWhite, pupStep } from '../src/world/seals/pup.js';
import { lieMoves, humpMoves, swimMoves, bottleMoves } from '../src/world/seals/motion.js';
import { coatOf } from '../src/world/seals/index.js';
import { ICON_NAMES } from '../src/ui/icons/icons.js';
import { HOURS_PER_DAY } from '../src/core/clock.js';
import { subSeed } from '../src/core/rng.js';

const G = 'seals';
/** @param {string} p */
const json = (p) => fetch(new URL(`../recipes/${p}.json`, import.meta.url)).then((r) => r.json());
/** @param {string} p */
const text = (p) => fetch(new URL(`../${p}`, import.meta.url)).then((r) => r.text());
/** @type {Promise<any> | null} */ let loaded = null;
const load = () => loaded ?? (loaded = Promise.all(['species/seal', 'world/journal', 'world/journal-list', 'world/journal-web',
  'world/sketchbook', 'world/morning-hints', 'world/seasons', 'audio/seal'].map(json)).then(([R, J, JL, JW, SB, MH, SE, AU]) => ({ R, J, JL, JW, SB, MH, SE, AU })));
/** @type {Promise<any> | null} */ let built = null;
const model = async () => {
  const { R } = await load();
  return built ?? (built = Promise.all([text(R.body.model.body), text(R.body.model.eyes), text(R.body.model.jaw)]).then(([body, eyes, jaw]) => buildSeal({ body, eyes, jaw }, R)));
};

/** A world in a season, with or without the seals away at sea. @param {number} season @param {boolean} [away] */
const world = (season, away = false) => ({ seasons: { index: season, phase: 0.2, dormant: { seals: away } } });
/** The env the tick passes. @param {any} R */
const envOf = (R) => ({ seed: 12345, recipes: { species: { seal: R } }, testTrust: 0 });
/** Run hours of the tick from h0, gathering events. @param {any} state @param {number} h0 @param {number} hours @param {any} env */
function runHours(state, h0, hours, env) {
  /** @type {any[]} */ const events = [];
  for (let h = h0; h < h0 + hours; h++) { const r = coarseStep(state, h, env); state = r.state; events.push(...r.events.map((e) => ({ ...e, hour: h }))); }
  return { state, events };
}
/** A settled group of n at (0, 0), its home met. @param {number} n */
const settled = (n) => ({ ...world(2), creatures: { seals: { phase: 'settled', rightFor: 10, right: true, waited: 0, cooldownUntil: -1, lastLeft: -1, happyFor: 0, happy: false, dormant: false,
  groups: [{ id: 1, k: 0, x: 0, z: 0, count: n, mood: 1, low: 0, since: 0 }], nextId: 2, arrivals: 1, trust: 0, home: { met: true, m: 30, x: 0, z: 0 } } } });

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addSealsTests(test, assert, eq) {
  test(G, "the game copy builds: eleven bones parents first, whole weights, about 2 m, flippers and head on their own bones", async () => {
    const { R } = await load();
    const m = await model();
    assert(m.tris > 5000 && m.tris < 9000, `about 6,000 body triangles plus eyes and jaw (${m.tris})`);
    eq(m.skeleton.length, SEAL_BONES.length, 'eleven bones');
    m.skeleton.forEach((b, i) => assert(b.parent < i, `${b.name} after its parent`));
    const f = new Float32Array(m.data), u = new Uint8Array(m.data);
    let zMin = Infinity, zMax = -Infinity;
    /** @type {number[]} */ const used = new Array(SEAL_BONES.length).fill(0);
    for (let v = 0; v < m.count; v++) {
      zMin = Math.min(zMin, f[v * 11 + 2]); zMax = Math.max(zMax, f[v * 11 + 2]);
      let s = 0;
      for (let k = 0; k < 4; k++) { s += u[v * 44 + 40 + k]; if (u[v * 44 + 40 + k] > 128) used[u[v * 44 + 36 + k]]++; }
      if (s !== 255) throw new Error(`vertex ${v}: weights sum to ${s}`);
    }
    assert(Math.abs(zMax - zMin - R.body.lengthM) < 0.05, `nose to tail ${(zMax - zMin).toFixed(2)} m`);
    for (const name of ['root', 'chest', 'neck', 'head', 'jaw', 'foreL', 'foreR', 'hindL', 'hindR', 'tail', 'lumbar']) assert(used[B[name]] > 0, `${name} holds skin`);
    const P = (/** @type {string} */ n) => m.skeleton[B[n]].pivot;
    assert(P('head')[2] > P('chest')[2] && P('head')[1] > P('chest')[1], 'the head ahead of and above the chest');
    // The game copy, as the recipe names it (assets/models/seal/seal-body.obj, seal-eyes.obj, seal-jaw.obj).
    eq([R.body.model.body, R.body.model.eyes, R.body.model.jaw].join(), ['assets/models/seal/seal-body.obj', 'assets/models/seal/seal-eyes.obj', 'assets/models/seal/seal-jaw.obj'].join(), 'the game copy');
    assert(P('foreL')[0] > 0 && P('foreR')[0] < 0 && P('hindL')[0] > P('hindR')[0], 'left on +x, right on -x');
  });

  test(G, 'every clip moves the rig: lying breathes, humping arches, swimming sweeps, bottling stands up', async () => {
    const { R } = await load();
    const M = R.motion;
    const lie = (/** @type {number} */ t) => lieMoves(M, t, { banana: 0.8, side: 1, look: { yaw: 0, lift: 0 }, scratch: -1, yawn: 0, pup: false });
    eq(lie(0).length, SEAL_BONES.length);
    assert(JSON.stringify(lie(0)[B.chest]) !== JSON.stringify(lie(1.5)[B.chest]), 'the chest breathes');
    assert(JSON.stringify(humpMoves(M, 0.25, 0)[B.lumbar]) !== JSON.stringify(humpMoves(M, 0.75, 0)[B.lumbar]), 'the back arches and falls');
    assert(JSON.stringify(swimMoves(M, 0.25)[B.tail]) !== JSON.stringify(swimMoves(M, 0.75)[B.tail]), 'the tail sweeps');
    assert(Math.abs(/** @type {any} */ (bottleMoves(M, 0, 0)[B.root]).q[0]) > 0.4, 'bottling stands the body up');
    // The coat packs as seal-draw.wgsl reads it: number * 1000 + white hundredths * 2 + dry.
    const c = coatOf(5, 0.5, 0.25), num = Math.floor(c / 1000), rem = c - num * 1000;
    assert(num >= 0 && num < 16 && Math.floor(rem / 2) === 50 && Math.abs(rem - 100 - 0.25) < 1e-3, `the coat packs (${c})`);
  });

  test(G, 'nothing without a recorded home; a quiet bar in autumn brings them, the same every run', async () => {
    const { R } = await load();
    const s0 = world(2);
    eq(flockStep(s0, 100, envOf(R), R).state, s0, 'the same state');
    const start = recordHome(s0, 'seals', { met: true, m: 24, x: 30, z: -10 });
    const a = runHours(start, 28 * HOURS_PER_DAY, 6 * HOURS_PER_DAY, envOf(R));
    const b = runHours(start, 28 * HOURS_PER_DAY, 6 * HOURS_PER_DAY, envOf(R));
    eq(JSON.stringify(a.events), JSON.stringify(b.events), 'the same events');
    assert(a.events.some((e) => e.name === 'creature:arrived'), 'they came');
    assert(a.events.some((e) => e.name === 'creature:settled'), 'they settled');
    const n = a.state.creatures.seals.groups.reduce((/** @type {number} */ s, /** @type {any} */ g) => s + g.count, 0);
    assert(n >= 1 && n <= Math.floor(24 / R.ecology.arrival.m2PerOne), `as many as the bar holds (${n})`);
    const away = runHours(recordHome(world(1, true), 'seals', { met: true, m: 24, x: 30, z: -10 }), 14 * HOURS_PER_DAY, 6 * HOURS_PER_DAY, envOf(R));
    assert(!away.events.some((e) => e.name === 'creature:arrived'), 'none come while they are away at sea');
  });

  test(G, 'a bar the walker crossed: they grow uneasy and go after their grace', async () => {
    const { R } = await load();
    const s = recordHome(settled(3), 'seals', { met: false, m: 30, x: 0, z: 0 });
    const r = runHours(s, 30 * HOURS_PER_DAY, (R.ecology.arrival.leaveGraceDays + 3) * HOURS_PER_DAY, envOf(R));
    assert(r.events.some((e) => e.name === 'creature:uneasy'), 'uneasy');
    assert(r.events.some((e) => e.name === 'creature:left'), 'they left');
  });

  test(G, 'the pup: once a year on a seeded day of 29 to 35, 21 days, white then moulting, the same every run', async () => {
    const { R } = await load();
    const P = R.ecology.pup, env = envOf(R);
    const day = pupDay(subSeed(env.seed, 'seals'), 0, P.days);
    assert(day >= 29 && day <= 35, `its day (${day})`);
    const a = runHours(settled(3), 27 * HOURS_PER_DAY, 30 * HOURS_PER_DAY, env);
    const b = runHours(settled(3), 27 * HOURS_PER_DAY, 30 * HOURS_PER_DAY, env);
    eq(JSON.stringify(a.events), JSON.stringify(b.events), 'the same events');
    const born = a.events.find((e) => e.name === 'creature:pup'), left = a.events.find((e) => e.name === 'creature:pup-left');
    assert(born && Math.floor(born.hour / HOURS_PER_DAY) === day, 'born on its day');
    assert(left && left.hour - born.hour === P.stayDays * HOURS_PER_DAY, 'gone after 21 days');
    eq(a.events.filter((e) => e.name === 'creature:pup').length, 1, 'once');
    eq(pupWhite(10 * HOURS_PER_DAY, P), 1, 'white at ten days');
    assert(pupWhite(17.5 * HOURS_PER_DAY, P) > 0.3 && pupWhite(17.5 * HOURS_PER_DAY, P) < 0.7, 'greying at seventeen');
    const none = pupStep(world(2), 31 * HOURS_PER_DAY, env, R, 'seals');
    eq(none.events.length, 0, 'no pup without a home');
    const late = runHours(settled(3), 36 * HOURS_PER_DAY, 4 * HOURS_PER_DAY, env);
    assert(!late.events.some((e) => e.name === 'creature:pup'), 'none after the window');
  });

  test(G, 'alive: apart on dry ground, bottling when the tide covers them, a flush at Wary (the mother stays), heads up past it', async () => {
    const { R } = await load();
    let tide = 0;
    // A bar rising to 0.6 m at its middle, sea beyond 6 m out.
    const ground = (/** @type {number} */ x, /** @type {number} */ z) => 0.6 - Math.hypot(x, z) * 0.12;
    const mk = () => createSealLife({ L: R.life, P: R.presence, M: R.motion, seed: 9, pupK: 0.5, ground, tide: () => tide });
    const life = mk();
    const base = { count: 3, pup: null, home: { x: 0, z: 0 }, walker: null, band: 0, trust: 0, visit: null, around: null };
    for (let i = 0; i < 30 * 10; i++) life.step(1 / 30, base);
    const S = life.seals();
    eq(S.length, 3, 'three seals');
    for (const s of S) assert(ground(s.x, s.z) - tide > R.life.dryAboveM, 'each on dry ground');
    for (const s of S) assert(ground(s.x, s.z) - tide <= R.life.lieAboveM + 0.05, 'each on the beach by the water, never up the bank');
    for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) assert(Math.hypot(S[i].x - S[j].x, S[i].z - S[j].z) > 0.5, 'apart');
    assert(S.every((s) => s.mode === 'lie' && s.pose), 'lying, posed');
    // The tide covers the bar: into the water to bottle.
    tide = 0.8;
    for (let i = 0; i < 30 * 40; i++) life.step(1 / 30, base);
    assert(life.seals().some((s) => s.mode === 'bottle' || s.mode === 'move'), 'off the covered bar');
    // A moving seal is posed every frame.
    const mover = life.seals().find((s) => s.mode === 'move');
    if (mover) assert(mover.pose, 'posed while it moves');
    // A flush at Wary, the mother staying by her pup.
    tide = 0;
    const life2 = mk();
    const withPup = { ...base, pup: { white: 1 } };
    for (let i = 0; i < 30 * 10; i++) life2.step(1 / 30, withPup);
    const mother = life2.seals().find((s) => !s.pup);
    assert(life2.seals().some((s) => s.pup), 'the pup is there');
    /** @type {any} */ const walker = { kind: 'walker', body: true, pos: [2, 1, 0], speed: 1, posture: 'stand', gaze: null, stillS: 0, editing: false, edits: [] };
    const said = life2.step(1 / 30, { ...withPup, walker });
    assert(said.includes('flushed'), 'they flushed');
    for (let i = 0; i < 30 * 20; i++) life2.step(1 / 30, { ...withPup, walker });
    assert(life2.seals().filter((s) => !s.pup && s !== mother).every((s) => Math.hypot(s.x, s.z) > 4), 'into the sea');
    assert(mother && Math.hypot(mother.x, mother.z) < 4, 'the mother stayed by her pup');
    // Past Wary: no flush.
    const life3 = mk();
    for (let i = 0; i < 30 * 10; i++) life3.step(1 / 30, base);
    const s3 = life3.step(1 / 30, { ...base, walker, band: 2, trust: 0.5 });
    assert(!s3.includes('flushed'), 'only heads up past Wary');
  });

  test(G, 'in the sea they swim about and only bottle a while, never in step, and never off into a pond (Matt, November 2, 2026)', async () => {
    const { R } = await load();
    // A bar rising to 0.6 m at its middle, sea beyond 6 m out; a pond dug below sea level at x 12..18 on land past a ridge.
    const ground = (/** @type {number} */ x, /** @type {number} */ z) => (x > 10 && x < 20 && Math.abs(z) < 4 ? -1 : 0.6 - Math.hypot(x, z) * 0.12);
    const sea = (/** @type {number} */ x, /** @type {number} */ z) => !(x > 10 && x < 20 && Math.abs(z) < 4);
    let tide = 0.8;
    const life = createSealLife({ L: R.life, P: R.presence, M: R.motion, seed: 9, pupK: 0.5, ground, tide: () => tide, sea });
    const base = { count: 4, pup: null, home: { x: 0, z: 0 }, walker: null, band: 0, trust: 0, visit: null, around: null };
    // The tide covers the bar: in the water for a minute. Count how they spend it.
    let moving = 0, up = 0, inPond = 0;
    /** @type {Map<number, Set<number>>} */ const spotsOf = new Map();
    for (let i = 0; i < 30 * 60; i++) {
      life.step(1 / 30, base);
      for (const s of life.seals()) {
        if (s.mode === 'move') moving++; else if (s.mode === 'bottle') up++;
        if (!sea(s.x, s.z)) inPond++;
        const set = spotsOf.get(s.id) ?? new Set(); set.add(Math.round(s.x) * 1000 + Math.round(s.z)); spotsOf.set(s.id, set);
      }
    }
    assert(moving > up, `mostly swimming (${moving} moving to ${up} bottling)`);
    assert(up > 0, 'but they do come up to bottle');
    assert([...spotsOf.values()].every((v) => v.size > 6), 'each swims about, never parked in one place');
    eq(inPond, 0, 'never in the pond dug below sea level');
    // Never in step: their clocks, paces and set-off moments are their own.
    const S = life.seals();
    const clocks = new Set(S.map((s) => Math.round(s.tOff * 10))), paces = new Set(S.map((s) => Math.round(s.pace * 100)));
    eq(clocks.size, S.length, 'each its own clock');
    eq(paces.size, S.length, 'each its own pace');
    // A flush on dry ground: they set off at different moments and different points in the hump.
    tide = 0;
    const life2 = createSealLife({ L: R.life, P: R.presence, M: R.motion, seed: 9, pupK: 0.5, ground, tide: () => tide, sea });
    for (let i = 0; i < 30 * 10; i++) life2.step(1 / 30, { ...base, count: 3 });
    /** @type {any} */ const walker = { kind: 'walker', body: true, pos: [2, 1, 0], speed: 1, posture: 'stand', gaze: null, stillS: 0, editing: false, edits: [] };
    life2.step(1 / 30, { ...base, count: 3, walker });
    const phases = life2.seals().map((s) => s.phase), holds = life2.seals().map((s) => s.hold);
    assert(new Set(phases.map((v) => Math.round(v * 100))).size === phases.length, 'each at its own point in the hump');
    assert(new Set(holds.map((v) => Math.round(v * 100))).size === holds.length, 'each sets off at its own moment');
    // A beach rising up a bank inland (the water's edge at x 10): they lie by the water, never up the bank.
    const bank = (/** @type {number} */ x) => 1.5 - x * 0.15;
    const life3 = createSealLife({ L: R.life, P: R.presence, M: R.motion, seed: 9, pupK: 0.5, ground: (x) => bank(x), tide: () => 0, sea });
    for (let i = 0; i < 30 * 10; i++) life3.step(1 / 30, { ...base, count: 4, home: { x: 6, z: 0 } });
    assert(life3.seals().length === 4 && life3.seals().every((q) => bank(q.x) <= R.life.lieAboveM + 0.05), 'lying by the water, not up the bank');
  });

  test(G, 'every card of theirs has a home: page, notes, list, web, sketchbook, icon, hints, seasons, voice', async () => {
    const { R, J, JL, JW, SB, MH, SE, AU } = await load();
    const p = J.species.seals;
    assert(p && J.order.includes('seals') && p.icon === 'seal', 'a journal page');
    for (const k of ['sign', 'settled', 'pup', 'pupUnseen', 'pupLeft', 'pupLeftUnseen', 'known', 'dormant', 'woke']) assert(p.notes[k], `the ${k} note`);
    assert(p.hints.some((/** @type {any} */ h) => h.when === 'seals:visited') && p.hints.some((/** @type {any} */ h) => h.when === 'setpiece:islet:rose'), 'the visit and islet bar hints');
    for (const t of ['banana', 'bottle', 'flush', 'pup', 'came']) assert(p.field.some((/** @type {any} */ f) => f.learn.includes(t)), `a field note on ${t}`);
    eq(JL.placeOf.seals, 'shore', 'its place in the list');
    assert(JW.nodes.seals && JW.links.some((/** @type {any} */ l) => l.b === 'seals' && l.a === 'you'), 'web node and links');
    assert(SB.subjects.includes('seals') && SB.art.seals === 'seal', 'a sketchbook page');
    assert(ICON_NAMES.includes('seal'), 'a drawn icon');
    assert(MH.hints.some((/** @type {any} */ h) => h.visit === 'seals') && MH.hints.some((/** @type {any} */ h) => h.id === 'seal-pup'), 'the morning hints');
    assert(MH.tests.animalCame.some((/** @type {any} */ t) => t.flag === 'seals:sign'), 'animalCame');
    eq(SE.dormancy.seals.join(), '0.6,2', 'away at sea in spring and summer');
    assert(AU.moan && AU.snort && AU.pup, 'their soft voice');
    eq(R.presence.feedTrust, 0, 'watching only');
    eq(R.ecology.gift, undefined, 'no gift');
  });
}

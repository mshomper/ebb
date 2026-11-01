// @ts-check
// Turnstones tests for tools/unit-tests.html (B3 wave 2; src/world/creatures/flock.js,
// src/world/turnstones): nothing happens until a wrack home is recorded, so an island without one
// keeps its hash; once wrack has lain, a flock comes in autumn, settles and grows to what the wrack
// holds, the same on every run; gathered wrack makes them uneasy and, after their grace, they go;
// they are away north in spring and summer; a recorded home that has not changed leaves the state
// as it was; the live flock forages near its home, flushes from the walker at Wary and flies out to
// land along the strand, but past Wary runs aside instead; no two birds' bodies ever overlap, feeding,
// roosting tight or landing together (the interference check); and every card of theirs has a home (the
// journal page and its notes, the list, the web, the sketchbook, the icon, the morning hint).

import { flockStep, recordHome, homePool, bringFlock, coarseStep } from '../src/world/creatures/flock.js';
import { createFlockLife, separate, reachOf } from '../src/world/turnstones/live.js';
import { wrackMiddle, plumageOf } from '../src/world/turnstones/home.js';
import { ICON_NAMES } from '../src/ui/icons/icons.js';
import { HOURS_PER_DAY } from '../src/core/clock.js';

const G = 'turnstones';
/** @param {string} p */
const json = (p) => fetch(new URL(`../recipes/${p}.json`, import.meta.url)).then((r) => r.json());
/** @type {Promise<any> | null} */ let loaded = null;
const load = () => loaded ?? (loaded = Promise.all(['species/turnstone', 'birds/turnstone', 'world/journal', 'world/journal-list', 'world/journal-web',
  'world/sketchbook', 'world/morning-hints', 'world/seasons'].map(json)).then(([R, B, J, JL, JW, SB, MH, SE]) => ({ R, B, J, JL, JW, SB, MH, SE })));

/** A world in autumn (or another season), with or without the flock's winter window. @param {number} season @param {boolean} [away] */
const world = (season, away = false) => ({ seasons: { index: season, phase: 0.2, dormant: { turnstones: away } } });
/** The env the tick passes. @param {any} R */
const envOf = (R) => ({ seed: 12345, recipes: { species: { turnstone: R } }, testTrust: 0 });

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
export function addTurnstonesTests(test, assert, eq) {
  test(G, 'nothing happens without a recorded home; a home not met is not recorded on a new island', async () => {
    const { R } = await load();
    const s0 = world(2);
    eq(flockStep(s0, 100, envOf(R), R).state, s0, 'the same state');
    eq(recordHome(s0, 'turnstones', { met: false, m: 4, x: 1, z: 2 }), s0, 'no flock state for a home not met');
    const s1 = recordHome(s0, 'turnstones', { met: true, m: 20.4, x: 1.04, z: 2 });
    eq(s1.creatures.turnstones.home.m, 20);
    eq(recordHome(s1, 'turnstones', { met: true, m: 20.2, x: 1.3, z: 2.2 }), s1, 'a home that has not changed keeps the state');
    const pool = homePool({ met: true, m: 20, x: 1, z: 2 }, [3]);
    assert(pool.bestScore === 1 && pool.room === 20 && pool.groups[0] === 3 && pool.low === 'wrack', 'the home as a pool');
  });

  test(G, 'wrack lying in autumn: a flock comes, settles and grows to what the wrack holds, the same every run', async () => {
    const { R } = await load();
    const env = envOf(R), A = R.ecology.arrival;
    const start = recordHome(world(2), 'turnstones', { met: true, m: 20, x: 5, z: -3 });
    const a = runHours(start, 28 * HOURS_PER_DAY, 6 * HOURS_PER_DAY, env);
    const b = runHours(start, 28 * HOURS_PER_DAY, 6 * HOURS_PER_DAY, env);
    eq(JSON.stringify(a.events), JSON.stringify(b.events), 'the same events');
    const names = a.events.map((e) => e.name);
    assert(names.includes('creature:habitat-right') && names.includes('creature:arrived') && names.includes('creature:settled'), names.join(', '));
    const S = a.state.creatures.turnstones;
    const n = S.groups.reduce((/** @type {number} */ s, /** @type {any} */ g) => s + g.count, 0);
    eq(n, Math.floor(20 / A.m2PerOne), 'one bird a share of the wrack');
    assert(S.groups[0].x === 5.5 && S.groups[0].z === -2.5, 'they live at the home');
    assert(a.state.ecology === undefined, 'the stand-in pool is not kept');
  });

  test(G, 'gathered wrack makes them uneasy, and after their grace they go', async () => {
    const { R } = await load();
    const env = envOf(R);
    let s = runHours(recordHome(world(3), 'turnstones', { met: true, m: 20, x: 0, z: 0 }), 50 * 24, 4 * 24, env).state;
    assert(s.creatures.turnstones.phase === 'settled', 'settled first');
    s = recordHome(s, 'turnstones', { met: false, m: 2, x: 0, z: 0 });
    const r = runHours(s, 54 * 24, (R.ecology.arrival.leaveGraceDays + 2) * 24, env);
    const uneasy = r.events.find((e) => e.name === 'creature:uneasy');
    assert(uneasy && uneasy.payload.why === 'wrack', 'uneasy for the wrack');
    const left = r.events.find((e) => e.name === 'creature:left');
    assert(left && left.hour - uneasy.hour >= R.ecology.arrival.leaveGraceDays * 24, 'left after the grace');
    eq(r.state.creatures.turnstones.groups.length, 0);
  });

  test(G, 'away north in spring and summer: nothing comes, and a settled flock goes dormant', async () => {
    const { R, SE } = await load();
    const env = envOf(R);
    const w = SE.dormancy.turnstones;
    assert(w[0] < 1 && w[1] === 2, 'away from spring until autumn');
    const r = runHours(recordHome(world(1, true), 'turnstones', { met: true, m: 20, x: 0, z: 0 }), 20 * 24, 4 * 24, env);
    assert(!r.events.some((e) => e.name === 'creature:arrived'), 'none comes');
    const f = bringFlock(world(3), 50 * 24, env, R, 6, 0, 0);
    const d = runHours({ ...f.state, seasons: { index: 0, phase: 0.5, dormant: { turnstones: true } } }, 60 * 24, 2, env);
    assert(d.events.some((e) => e.name === 'creature:dormant'), 'dormant');
  });

  test(G, 'the thickest run of wrack is home, the same for the same strand', () => {
    eq(wrackMiddle([], 6), null);
    const spots = [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 4, z: 0 }, { x: 30, z: 0 }];
    const m = wrackMiddle(spots, 6);
    assert(m && m.n === 3 && m.x === 2 && m.z === 0, JSON.stringify(m));
  });

  test(G, 'the live flock forages near home, flushes at Wary to land along the strand, runs aside past it', async () => {
    const { R, B } = await load();
    const flat = { ground: () => 0.5, tide: () => 0 };
    const spots = Array.from({ length: 30 }, (_, i) => ({ x: i * 1.5, z: 0 }));
    const life = createFlockLife({ L: R.life, P: R.presence, M: B.motion, k: R.body.displayScale, seed: 7, ...flat });
    const base = { count: 6, home: { x: 0, z: 0 }, spots, roost: false, walker: null, trust: 0, band: 0, known: false };
    for (let i = 0; i < 300; i++) life.step(1 / 30, base);
    eq(life.birds().length, 6);
    assert(life.birds().every((b) => Math.hypot(b.x, b.z) < 12 && Number.isFinite(b.yaw)), 'near home');
    const c = life.middle();
    /** @type {any} */ const walker = { kind: 'walker', body: true, pos: [c.x + 2, 1, c.z], speed: 1, posture: 'stand', gaze: null, stillS: 0, editing: false, edits: [] };
    const said = life.step(1 / 30, { ...base, walker });
    assert(said.includes('flushed'), 'flushed');
    for (let i = 0; i < 30 * 15; i++) life.step(1 / 30, { ...base, walker });
    const d = life.birds().map((b) => Math.hypot(b.x - walker.pos[0], b.z - walker.pos[2]));
    assert(Math.min(...d) > R.presence.ringM, `landed away from you (${Math.min(...d).toFixed(1)} m)`);
    assert(life.birds().every((b) => b.y === 0 && b.mode !== 'fly'), 'all down again');
    // Curious: a walker at the ring's edge sends them running, not flying.
    const life2 = createFlockLife({ L: R.life, P: R.presence, M: B.motion, k: R.body.displayScale, seed: 7, ...flat });
    for (let i = 0; i < 300; i++) life2.step(1 / 30, base);
    const c2 = life2.middle(), ring = Math.max(R.presence.ringMinM, R.presence.ringM * (1 - R.presence.ringTrustShrink * 0.5));
    const b0 = life2.birds()[0];
    const w2 = { ...walker, pos: [b0.x + ring * 0.85, 1, b0.z] };
    const s2 = life2.step(1 / 30, { ...base, walker: w2, trust: 0.5, band: 2 });
    assert(!s2.includes('flushed') && life2.birds().some((b) => b.mode === 'run'), 'ran aside');
    void c2;
  });

  test(G, 'the interference check: no two bodies overlap, feeding, roosting or landing in a crowd', async () => {
    const { R, B } = await load();
    const half = R.life.bodyHalfM;
    // Twelve stacked on one spot, every way round: one check parts them all.
    const pile = Array.from({ length: 12 }, (_, i) => ({ x: 0, z: 0, y: 0, yaw: i * 0.7 }));
    separate(pile, half, 40);
    /** The worst overlap among grounded birds (m; 0 when none). @param {any[]} list */
    const worst = (list) => {
      let w = 0;
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (Math.abs(a.y - b.y) > half[1]) continue;
        const dir = Math.atan2(b.x - a.x, b.z - a.z), need = reachOf(a.yaw, dir, half) + reachOf(b.yaw, dir + Math.PI, half);
        w = Math.max(w, need - Math.hypot(b.x - a.x, b.z - a.z));
      }
      return w;
    };
    assert(worst(pile) < 0.01, `a pile parted (${worst(pile).toFixed(3)} m)`);
    // A full flock in the life: feeding a while, then roosting tight, then flushed to land together.
    const spots = [{ x: 0, z: 0 }, { x: 1, z: 0 }];
    const life = createFlockLife({ L: R.life, P: R.presence, M: B.motion, k: R.body.displayScale, seed: 3, ground: () => 0.5, tide: () => 0 });
    const base = { count: 12, home: { x: 0, z: 0 }, spots, roost: false, walker: null, trust: 0, band: 0, known: false };
    let most = 0;
    for (let i = 0; i < 30 * 40; i++) { life.step(1 / 30, base); if (i > 30) most = Math.max(most, worst(life.birds())); }
    for (let i = 0; i < 30 * 40; i++) { life.step(1 / 30, { ...base, roost: true }); most = Math.max(most, worst(life.birds())); }
    const c = life.middle();
    /** @type {any} */ const walker = { kind: 'walker', body: true, pos: [c.x + 1.5, 1, c.z], speed: 1, posture: 'stand', gaze: null, stillS: 0, editing: false, edits: [] };
    for (let i = 0; i < 30 * 20; i++) { life.step(1 / 30, { ...base, walker }); most = Math.max(most, worst(life.birds())); }
    assert(most < 0.02, `never overlapping by more than 2 cm (worst ${most.toFixed(3)} m)`);
  });

  test(G, 'their plumage turns with the year, each bird at its own moment', async () => {
    const { R } = await load();
    const T = R.body.plumageTurn;
    const flock = Array.from({ length: 10 }, (_, i) => (i + 0.5) / 10);
    const share = (/** @type {number} */ pos) => flock.filter((u) => plumageOf(pos, u, T) === 'breeding').length;
    eq(share(T.toWinter[0]), 10, 'all chestnut as they come back');
    assert(share((T.toWinter[0] + T.toWinter[1]) / 2) === 5, 'half turned halfway through the autumn moult');
    eq(share(3), 0, 'all winter brown in midwinter');
    assert(share(0.1) > 0 && share(0.1) < 10, 'some turning in early spring');
    eq(share(0.35), 10, 'all chestnut before they leave');
  });

  test(G, 'every card has a home: page and notes, list, web, sketchbook, icon, morning hint', async () => {
    const { J, JL, JW, SB, MH } = await load();
    const P = J.species.turnstones;
    assert(P && P.kind === 'school' && J.order.includes('turnstones'), 'a journal page in order');
    for (const k of ['right', 'sign', 'signAgain', 'found', 'settled', 'settledUnseen', 'back', 'joined', 'joinedUnseen', 'left', 'gone', 'scoutLeftUnseen', 'thinned', 'eased', 'dormant', 'woke', 'happy', 'known']) assert(P.notes[k], `note ${k}`);
    assert(P.uneasy.wrack, 'uneasy about the wrack');
    assert(P.hints.some((/** @type {any} */ h) => h.when === 'turnstones:visited'), 'the visit pencil hint');
    eq(JL.placeOf.turnstones, 'shore');
    assert(JW.nodes.turnstones && JW.links.some((/** @type {any} */ l) => l.a === 'wrack' && l.b === 'turnstones'), 'on the web, eating under the wrack');
    assert(SB.subjects.includes('turnstones') && SB.art.turnstones === 'turnstone', 'a sketchbook page');
    assert(ICON_NAMES.includes('turnstone'), 'a drawn icon');
    assert(MH.hints.some((/** @type {any} */ h) => h.visit === 'turnstones'), 'a visit hint');
    assert(MH.tests.animalCame.some((/** @type {any} */ w) => w.visited?.includes('turnstones')), 'animalCame');
  });
}

// @ts-check
// Teal tests for tools/unit-tests.html (B3 wave 3; src/world/teal, src/app/teal.js): Matt's model
// skins to the small-bird rig (every vertex on real bones, weights summing to one, the legs on
// their own side, the wing copies whole on the arm and hand); a reedy dug pond in winter brings a
// flock that grows to what the pond holds, the same every run, and nothing comes while they are
// away; the live flock stays on the water, flushes from the walker at Wary (rising forward away
// from you), circles leaning into the turn, flies stretched out flat, and lands on the far side, but past Wary swims off instead, and no two on the water come too close; their
// gift is the feather and the teal hat is a unique make that the kit can own and wear, with its
// wading boon; and every card of theirs has a home.

import { recordHome, coarseStep, bringFlock } from '../src/world/creatures/flock.js';
import { skinOf, nearOnSegment } from '../src/world/teal/model.js';
import { createTealLife } from '../src/world/teal/live.js';
import { birdRig } from '../src/world/creatures/bird-rig.js';
import { poseBird } from '../src/world/creatures/bird-motion.js';
import { poseSkeleton } from '../src/world/creatures/pose.js';
import { tealFlyPose } from '../src/world/teal/motion.js';
import { wadeRingK } from '../src/app/teal.js';
import { cleanKit, own, wearKit } from '../src/world/kit/model.js';
import { ICON_NAMES } from '../src/ui/icons/icons.js';
import { HOURS_PER_DAY } from '../src/core/clock.js';

const G = 'teal';
/** @param {string} p */
const json = (p) => fetch(new URL(`../recipes/${p}.json`, import.meta.url)).then((r) => r.json());
/** @type {Promise<any> | null} */ let loaded = null;
const load = () => loaded ?? (loaded = Promise.all(['species/teal', 'birds/teal', 'world/journal', 'world/journal-list', 'world/journal-web',
  'world/sketchbook', 'world/morning-hints', 'world/seasons', 'world/cook', 'world/kit', 'world/naturalist', 'world/pack'].map(json))
  .then(([R, B, J, JL, JW, SB, MH, SE, C, K, N, PK]) => ({ R, B, J, JL, JW, SB, MH, SE, C, K, N, PK })));

/** A world in winter (or another season), with or without their time away. @param {number} season @param {boolean} [away] */
const world = (season, away = false) => ({ seasons: { index: season, phase: 0.2, dormant: { teals: away } } });
/** @param {any} R */
const envOf = (R) => ({ seed: 4242, recipes: { species: { teal: R } }, testTrust: 0 });
/** @param {any} state @param {number} h0 @param {number} hours @param {any} env */
function runHours(state, h0, hours, env) {
  /** @type {any[]} */ const events = [];
  for (let h = h0; h < h0 + hours; h++) { const r = coarseStep(state, h, env); state = r.state; events.push(...r.events.map((e) => ({ ...e, hour: h }))); }
  return { state, events };
}

/** A round pond 6 m across the middle, 0.4 m deep. @param {number} x @param {number} z */
const pondWater = (x, z) => ({ surface: 0.2, depth: Math.hypot(x, z) < 6 ? 0.4 : 0 });

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addTealTests(test, assert, eq) {
  test(G, 'the model skins to the small-bird rig: legs on their side, the spine blended, weights whole', async () => {
    const { B } = await load();
    const rig = birdRig(B.shape), at = rig.at, K = B.skin;
    eq(nearOnSegment([0, 1, 0], [0, 0, 0], [0, 2, 0]).t, 0.5);
    eq(skinOf([0.025, 0.004, 0.03], K, at)[0][0], at['foot.l'], 'a left toe on the left foot');
    eq(skinOf([-0.025, 0.015, 0.02], K, at)[0][0], at['shank.r'], 'a right shin on the right shank');
    eq(skinOf([0, 0.27, 0.1], K, at)[0][0], at.head, 'the crown on the head');
    eq(skinOf([0, 0.026, -0.17], K, at)[0][0], at.tail, 'the tail on the tail');
    for (const p of [[0.03, 0.12, 0], [0, 0.2, 0.05], [0, 0.04, -0.12]]) {
      const s = skinOf(p, K, at);
      assert(Math.abs(s.reduce((t, [, w]) => t + w, 0) - 1) < 1e-9 && s.every(([b]) => b >= 0 && b < 15), JSON.stringify(s));
    }
  });

  test(G, 'a reedy pond in winter: a flock comes and grows to what the pond holds, the same every run', async () => {
    const { R } = await load();
    const env = envOf(R), A = R.ecology.arrival;
    eq(coarseStep(world(3), 100, env).state.creatures, undefined, 'nothing without a recorded home');
    const start = recordHome(world(3), 'teals', { met: true, m: 30, x: 2, z: -4 });
    const a = runHours(start, 70 * HOURS_PER_DAY, 6 * HOURS_PER_DAY, env);
    const b = runHours(start, 70 * HOURS_PER_DAY, 6 * HOURS_PER_DAY, env);
    eq(JSON.stringify(a.events), JSON.stringify(b.events), 'the same events');
    const names = a.events.map((e) => e.name);
    assert(names.includes('creature:arrived') && names.includes('creature:settled'), names.join(', '));
    const n = a.state.creatures.teals.groups.reduce((/** @type {number} */ s, /** @type {any} */ g) => s + g.count, 0);
    eq(n, Math.min(R.ecology.needs.company.n[2], Math.floor(30 / A.m2PerOne)), 'one bird a share of the pond');
    const away = runHours(recordHome(world(1, true), 'teals', { met: true, m: 30, x: 2, z: -4 }), 30 * HOURS_PER_DAY, 4 * HOURS_PER_DAY, env);
    assert(!away.events.some((e) => e.name === 'creature:arrived'), 'nothing comes while they are away');
  });

  test(G, 'they are away from early spring to the start of winter, after the frogs sleep', async () => {
    const { R, SE } = await load();
    const w = SE.dormancy[R.ecology.dormancy];
    assert(w && w[1] === 3 && w[0] < 0.5, JSON.stringify(w));
    assert(SE.dormancy.frogs[0] < w[1], 'the frogs are asleep first');
    eq(R.ecology.visit.home.check, 'pond');
    eq(R.ecology.visit.seasons.join(), '3', 'they visit in winter');
  });

  test(G, 'the live flock stays on the water, flushes at Wary to the far side, swims off past it', async () => {
    const { R, B } = await load();
    const mk = () => createTealLife({ L: R.life, P: R.presence, M: B.motion, k: R.body.displayScale, seed: 9, water: pondWater });
    const life = mk();
    const base = { count: 5, pond: { x: 0, z: 0, r: 5.5 }, night: false, walker: null, trust: 0, band: 0, placeNow: true };
    life.step(1 / 30, base);
    for (let i = 0; i < 30 * 20; i++) life.step(1 / 30, { ...base, placeNow: false });
    eq(life.birds().length, 5);
    assert(life.birds().every((b) => Math.hypot(b.x, b.z) < 6 && b.y === 0), 'all on the water');
    const on = life.birds();
    for (let i = 0; i < on.length; i++) for (let j = i + 1; j < on.length; j++) {
      assert(Math.hypot(on[i].x - on[j].x, on[i].z - on[j].z) >= R.life.spacingM - 0.05, 'no two too close');
    }
    const b0 = life.birds()[0];
    /** @type {any} */ const walker = { kind: 'walker', body: true, pos: [b0.x + 1.5, 1, b0.z], speed: 1, posture: 'stand', gaze: null, stillS: 0, editing: false, edits: [] };
    const said = life.step(1 / 30, { ...base, placeNow: false, walker });
    assert(said.includes('flushed'), 'flushed');
    let flew = false;
    // You stand still on the bank where they rose (they settle again past the ring, at the far side).
    for (let i = 0; i < 30 * 14; i++) { life.step(1 / 30, { ...base, placeNow: false, walker: i < 30 * 3 ? walker : null }); if (life.birds().some((b) => b.y > 2)) flew = true; }
    assert(flew, 'they rose into the air');
    assert(life.birds().every((b) => b.y === 0 && Math.hypot(b.x, b.z) < 6.5), 'all back on the water');
    const near = Math.min(...life.birds().map((b) => Math.hypot(b.x - walker.pos[0], b.z - walker.pos[2])));
    assert(near > 4, `landed on the far side (${near.toFixed(1)} m)`);
    // Curious: at the ring's edge they swim away rather than fly.
    const life2 = mk();
    life2.step(1 / 30, base);
    for (let i = 0; i < 60; i++) life2.step(1 / 30, { ...base, placeNow: false });
    const ring = Math.max(R.presence.ringMinM, R.presence.ringM * (1 - R.presence.ringTrustShrink * 0.5));
    const c = life2.birds()[0];
    const s2 = life2.step(1 / 30, { ...base, placeNow: false, walker: { ...walker, pos: [c.x + ring * 0.85, 1, c.z] }, trust: 0.5, band: 2 });
    assert(!s2.includes('flushed') && life2.birds().some((b) => b.mode === 'swim'), 'swam off');
    // A visit's birds fly in from far off, and leave again.
    const life3 = mk();
    life3.step(1 / 30, { ...base, count: 3, placeNow: false });
    assert(life3.birds().every((b) => b.mode === 'land' && b.y > 0), 'flying in');
    // From inFromM off they glide in no faster than they fly (about 10 s from 30 m).
    for (let i = 0; i < 30 * 12; i++) life3.step(1 / 30, { ...base, count: 3, placeNow: false });
    assert(life3.birds().every((b) => b.y === 0), 'landed on the water');
    for (let i = 0; i < 30 * 15; i++) life3.step(1 / 30, { ...base, count: 3, placeNow: false, leave: true });
    eq(life3.birds().length, 0, 'gone');
  });

  test(G, 'they fly stretched out flat, rise forward away from you and lean into the lap (Matt, November 2, 2026)', async () => {
    const { R, B } = await load();
    const M = B.motion, rig = birdRig(B.shape);
    // The flying shape: the bill no more than 20 degrees above the tail (it was 35, sitting upright).
    const P = tealFlyPose(0, 0.3, M), out = new Float32Array(rig.skeleton.length * 16);
    poseSkeleton(rig.skeleton, poseBird(rig, P, M), out, 0);
    /** @param {number[]} p @param {string} bone */
    const at = (p, bone) => { const o = rig.at[bone] * 16; return [out[o + 1] * p[0] + out[o + 5] * p[1] + out[o + 9] * p[2] + out[o + 13], out[o + 2] * p[0] + out[o + 6] * p[1] + out[o + 10] * p[2] + out[o + 14]]; };
    const bill = at([0, 0.254, 0.18], 'head'), tail = at([0, 0.025, -0.18], 'tail');
    const slope = Math.atan2(bill[0] - tail[0], bill[1] - tail[1]) * 180 / Math.PI;
    assert(slope < 20, `flat in flight (${slope.toFixed(0)} degrees bill above tail)`);
    // The flush: one bird rises forward at about climbDeg, away from the walker, then leans into the lap.
    const life = createTealLife({ L: R.life, P: R.presence, M, k: R.body.displayScale, seed: 9, water: pondWater });
    const base = { count: 1, pond: { x: 0, z: 0, r: 5.5 }, night: false, walker: null, trust: 0, band: 0, placeNow: true };
    life.step(1 / 30, base);
    const b = life.birds()[0], x0 = b.x, z0 = b.z;
    /** @type {any} */ const walker = { kind: 'walker', body: true, pos: [b.x + 1.5, 1, b.z], speed: 1, posture: 'stand', gaze: null, stillS: 0, editing: false, edits: [] };
    assert(life.step(1 / 30, { ...base, placeNow: false, walker }).includes('flushed'), 'flushed');
    let rose = null, lean = 0;
    for (let i = 0; i < 30 * 8; i++) {
      life.step(1 / 30, { ...base, placeNow: false });
      const c = life.birds()[0];
      if (!rose && c.mode === 'fly') rose = { up: c.y, along: Math.hypot(c.x - x0, c.z - z0), away: Math.hypot(c.x - walker.pos[0], c.z - walker.pos[2]) };
      if (c.mode === 'fly') lean = Math.max(lean, Math.abs(c.pose.bodyRoll));
    }
    assert(rose, 'it rose');
    const climb = Math.atan2(rose.up, rose.along) * 180 / Math.PI;
    assert(Math.abs(climb - M.rise.climbDeg) < 8, `rose forward at about ${M.rise.climbDeg} degrees (${climb.toFixed(0)})`);
    assert(rose.away > 1.5 + rose.along * 0.5, 'away from the walker');
    assert(Math.abs(lean * 180 / Math.PI - M.fly.bankDeg) < 2, `leaned into the lap (${(lean * 180 / Math.PI).toFixed(0)} degrees)`);
  });

  test(G, 'their gift is the feather; the teal hat is a unique make the kit owns and wears; wading in it calms', async () => {
    const { R, C, K, N, PK } = await load();
    eq(R.ecology.gift.id, 'tealFeather');
    const W = N.gifts.tool.tealFeather;
    assert(W && W.line && W.stoneLine && ICON_NAMES.includes(W.icon), 'its gift words and icon');
    assert(PK.kinds.some((/** @type {any} */ k) => k.id === 'teal-feather'), 'the feather is a pack kind');
    const m = C.makes['teal-hat'];
    eq(m.parts.join(), 'teal-feather,cloth,rush-cord');
    eq(m.out, 'hat');
    const key = (/** @type {any[]} */ parts) => parts.map((p) => (Array.isArray(p) ? p.slice().sort().join('|') : typeof p === 'string' ? p : JSON.stringify(p))).sort().join('+');
    const same = Object.entries(C.makes).filter(([id, q]) => id !== 'teal-hat' && key(/** @type {any} */ (q).parts) === key(m.parts));
    eq(same.length, 0, 'no other make takes the same parts');
    assert(!Object.entries(C.makes).some(([id, q]) => id !== 'teal-hat' && JSON.stringify(/** @type {any} */ (q).parts).includes('teal-feather')), 'nothing else takes the feather');
    assert(C.words.made['teal-hat'] && C.words.pageNames['teal-hat'] && C.words.pageParts['teal-hat'], 'its camp words');
    let kit = cleanKit(null);
    eq(wearKit(kit, 'hat', 'teal').ok, false, 'not worn before it is owned');
    kit = own(kit, 'hat', 'teal');
    const worn = wearKit(kit, 'hat', 'teal');
    assert(worn.ok && worn.kit.hat === 'teal', 'worn');
    eq(cleanKit(JSON.parse(JSON.stringify(worn.kit))).hat, 'teal', 'the save keeps it');
    const boon = K.items.hat.teal.boon;
    eq(wadeRingK(boon, 0.3), boon.wadeRingK, 'wading, the rings shrink');
    eq(wadeRingK(boon, 0), 1, 'on dry ground, no change');
    eq(wadeRingK(null, 0.3), 1, 'another hat, no change');
  });

  test(G, 'every card has a home: page and notes, list, web, sketchbook, icons, morning hint', async () => {
    const { J, JL, JW, SB, MH, K } = await load();
    const P = J.species.teals;
    assert(P && P.kind === 'school' && J.order.includes('teals'), 'a journal page in order');
    for (const k of ['right', 'sign', 'signAgain', 'found', 'settled', 'settledUnseen', 'back', 'joined', 'joinedUnseen', 'left', 'gone', 'scoutLeftUnseen', 'thinned', 'eased', 'dormant', 'woke', 'happy', 'known']) assert(P.notes[k], `note ${k}`);
    assert(P.hints.some((/** @type {any} */ h) => h.when === 'teals:visited'), 'the visit pencil hint');
    eq(JL.placeOf.teals, 'pond');
    assert(JW.nodes.teals && JW.links.some((/** @type {any} */ l) => l.a === 'reeds' && l.b === 'teals'), 'on the web, by the reeds');
    assert(SB.subjects.includes('teals') && SB.art.teals === 'teal', 'a sketchbook page');
    for (const i of ['teal', 'teal-feather']) assert(ICON_NAMES.includes(i), `icon ${i}`);
    eq(K.items.hat.teal.icon, 'teal-hat');
    assert(MH.hints.some((/** @type {any} */ h) => h.visit === 'teals'), 'a visit hint');
    assert(MH.tests.animalCame.some((/** @type {any} */ w) => w.visited?.includes('teals')), 'animalCame');
    void bringFlock;
  });
}

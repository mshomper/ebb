// @ts-check
// Set-piece tests for tools/unit-tests.html (docs/future/14): the runner arms a set piece only when
// its trigger holds (the cairns in the second spring, the boat once the camp has stores, back every
// few days); beats fall in order at their hour of day, a beat that needs you waits through
// hours away and falls at the next fitting hour you are there; beats due while away fall in order in
// catch-up; a save and read back mid-piece changes nothing; the same seed and choices give the same
// beats; an older save with no set pieces reads; the cairns' choice (a stone added is answered by the
// next cairn, the letter only once the last stands) and the boat's (a parcel left any time waits for
// its next dawn, a gift and the next letter, an untaken gift kept for the next run); the trail is
// the same every time and on dry land; the test link's startAt stands on the step asked; and a
// keeper page's lines follow its flags.

import { coarseStep, addNote, startAt, stepsOf, dawnDusk, setpiecesOf, emptySetpieces } from '../src/world/setpieces/runner.js';
import { setpieceRun } from '../src/world/setpieces/check.js';
import { planTrail, cairnMesh, leanYaw } from '../src/world/setpieces/cairn-rules.js';
import { catchUpJob } from '../src/sim/catchup.js';
import { packValue, unpackValue } from '../src/save/world-file.js';
import { pageBody } from '../src/ui/journal-keeper.js';
import { HOURS_PER_DAY } from '../src/core/clock.js';

const G = 'setpieces';
/** @param {string} path */
const json = (path) => fetch(new URL(`../recipes/${path}.json`, import.meta.url)).then((r) => r.json());

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addSetpiecesTests(test, assert, eq) {
  const recP = Promise.all([json('setpieces/cairns'), json('setpieces/boat'), json('world/setpieces'), json('world/seasons'), json('world/sky'), json('world/keeper-pages')])
    .then(([cairns, boat, world, seasons, sky, keeper]) => ({ list: { cairns, boat }, world, seasons, sky, keeper }));
  /** The tick env for the set pieces alone. @param {any} R @param {number} [seed] */
  const envOf = (R, seed = 77) => ({ seed, recipes: { setpieces: { list: R.list, order: R.world.order, world: R.world } } });
  /** A world state in a season. @param {number} index @param {number} year @param {number} [day] */
  const at = (index, year, day = 0) => ({ seasons: { index, year, day, dayLengthH: 12, phase: 0 } });
  /** Run hours, collecting events. @param {any} state @param {number} from @param {number} n @param {any} env @param {(s: any, h: number) => any} [each] */
  function run(state, from, n, env, each) {
    /** @type {any[]} */ const ev = [];
    for (let h = from; h < from + n; h++) {
      if (each) state = each(state, h);
      const r = coarseStep(state, h, env);
      state = r.state;
      for (const e of r.events) ev.push({ ...e, hour: h });
    }
    return { state, ev };
  }
  const beatsOf = (/** @type {any[]} */ ev) => ev.filter((e) => e.name === 'setpiece:beat').map((e) => `${e.payload.id}:${e.payload.beat}:${e.payload.rep}`);
  const trailNote = (/** @type {number} */ hour) => ({ id: 'cairns', kind: 'trail', points: [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6]], hour });
  /** As the live game does: the trail planned once the cairns have armed. @param {any} s @param {number} h */
  const planWhenArmed = (s, h) => { const c = s.setpieces?.runs?.cairns; return c && !c.data.trail && !(s.setpieces.pending ?? []).length ? addNote(s, trailNote(h)) : s; };

  test(G, 'triggers: the cairns arm in the second spring, not the first', async () => {
    const R = await recP, env = envOf(R);
    eq(run(at(0, 0), 0, 48, env).state.setpieces?.runs?.cairns, undefined, 'first spring: nothing');
    const s = run(at(0, 1), 56 * 24, 2, env).state;
    assert(s.setpieces.runs.cairns && s.setpieces.runs.cairns.armed === 56 * 24, 'armed at the first hour of the second spring');
  });

  test(G, 'triggers: the boat waits for stores, then comes back every few days', async () => {
    const R = await recP, env = envOf(R), A = R.list.boat.again;
    const s0 = at(1, 0, 3);
    eq(run(s0, 500, 24, env).state.setpieces?.runs?.boat, undefined, 'no stores: no boat');
    const s = addNote(s0, { id: '', kind: 'cond', name: 'stores', value: true, hour: 500 });
    const r = run(s, 500, 48, env);
    assert(r.state.setpieces.runs.boat, 'stores: it arms');
    eq(beatsOf(r.ev).join(), 'boat:dusk:0,boat:dawn:0', 'dusk then dawn');
    const left = r.state.setpieces.runs.boat.done;
    const soon = run(r.state, 548, (A[0] - 1) * 24, env);
    eq(beatsOf(soon.ev).length, 0, `not again within ${A[0]} days`);
    const later = run(soon.state, 548 + (A[0] - 1) * 24, (A[1] + 2) * 24, env);
    const dusk = later.ev.find((e) => e.name === 'setpiece:beat' && e.payload.beat === 'dusk');
    assert(dusk, 'it comes back');
    const days = (dusk.hour - left) / 24;
    assert(days >= A[0] - 1 && days <= A[1] + 1, `about ${A[0]} to ${A[1]} days after it left (${days.toFixed(1)})`);
  });

  test(G, 'beats fall at their hour of day, in order', async () => {
    const R = await recP, env = envOf(R);
    const dd = dawnDusk(at(0, 1));
    const r = run(at(0, 1), 56 * 24, 30 * 24, env, planWhenArmed);
    const cairns = r.ev.filter((e) => e.name === 'setpiece:beat' && e.payload.beat === 'cairn');
    eq(cairns.length, 7, 'seven cairns');
    assert(cairns.every((e) => e.hour % HOURS_PER_DAY === dd.dawn), 'each at dawn');
    assert(cairns.every((e, i) => i === 0 || e.hour - cairns[i - 1].hour >= 24), 'a day or more apart');
    eq(cairns.map((e) => e.payload.rep).join(), '0,1,2,3,4,5,6', 'in order');
    eq(r.state.setpieces.runs.cairns.done, undefined, 'it waits for the letter to be read');
  });

  test(G, 'presence: the boat\'s dusk waits through hours away for a dusk you are there', async () => {
    const R = await recP;
    const env = /** @type {any} */ ({ ...envOf(R), away: true });
    const s0 = addNote(at(1, 0, 13), { id: '', kind: 'cond', name: 'stores', value: true, hour: 500 });
    const away = run(s0, 500, 72, env);
    assert(away.state.setpieces.runs.boat, 'armed while away');
    eq(beatsOf(away.ev).length, 0, 'but nothing falls while away');
    const back = run(away.state, 572, 48, { ...env, away: false });
    eq(beatsOf(back.ev)[0], 'boat:dusk:0', 'the first dusk you are there');
    const dusk = back.ev.find((e) => e.name === 'setpiece:beat');
    eq(dusk.hour % 24, dawnDusk(away.state).dusk, 'at dusk');
  });

  test(G, 'catch-up: cairns due while away fall in order, as watched hours would', async () => {
    const R = await recP;
    const recipes = { ...envOf(R).recipes, seasons: R.seasons, sky: R.sky };
    const s0 = run(at(0, 1), 56 * 24, 2, envOf(R), planWhenArmed).state;
    // Watched: the same hours through the tick, live.
    const live = catchUpJob({ seed: 77, recipes, habitat: null, material: null, state: s0, journal: null, jr: null, fromHour: 56 * 24 + 2, hours: 24 * 20 });
    // Away in pieces of a few days, as returns would bring them.
    let st = s0;
    for (let d = 0; d < 20; d += 4) st = catchUpJob({ seed: 77, recipes, habitat: null, material: null, state: st, journal: null, jr: null, fromHour: 56 * 24 + 2 + d * 24, hours: 96 }).state;
    eq(JSON.stringify(st.setpieces.runs.cairns.fell), JSON.stringify(live.state.setpieces.runs.cairns.fell), 'the same hours, in pieces or at once');
    eq(live.state.setpieces.runs.cairns.data.cairns.length, 7, 'all seven');
  });

  test(G, 'save and reload mid-piece, and the same seed and choices, give the same beats', async () => {
    const R = await recP;
    const recipes = { seasons: R.seasons, sky: R.sky, setpieces: envOf(R).recipes.setpieces };
    const a = setpieceRun({ worldSeed: 4242, recipes, days: 112 });
    const b = setpieceRun({ worldSeed: 4242, recipes, days: 112, save: true });
    eq(b.timeline, a.timeline, 'every event at the same hour, saved and read back daily');
    eq(b.end, a.end, 'the same set pieces at the end');
    eq(setpieceRun({ worldSeed: 4242, recipes, days: 112 }).timeline, a.timeline, 'run again: the same');
    eq(a.counts.cairns, 1, 'the cairns played out once');
    assert(a.counts.boat >= 8, `the boat came every few days (${a.counts.boat})`);
    // Mid-piece: half the cairns standing, saved, read, run on.
    const env = envOf(R);
    const half = run(at(0, 1), 56 * 24, 10 * 24, env, planWhenArmed).state;
    assert((half.setpieces.runs.cairns.data.cairns ?? []).length > 0 && half.setpieces.runs.cairns.data.cairns.length < 7, 'stopped mid-piece');
    const straight = run(half, 66 * 24, 20 * 24, env), read = run(unpackValue(packValue(half)), 66 * 24, 20 * 24, env);
    eq(JSON.stringify(beatsOf(read.ev)), JSON.stringify(beatsOf(straight.ev)), 'the rest falls the same after a save');
  });

  test(G, 'an older save with no set pieces reads, and starts empty', async () => {
    const R = await recP;
    const old = { seasons: at(1, 0).seasons, weather: {} };
    eq(JSON.stringify(setpiecesOf(old)), JSON.stringify(emptySetpieces()), 'empty');
    const r = coarseStep(old, 10, envOf(R));
    assert(r.state.weather === old.weather, 'the rest untouched');
    eq(coarseStep(old, 10, { seed: 1, recipes: {} }).state, old, 'no recipes: no change at all');
  });

  test(G, 'the cairns: a stone added is answered, and the letter waits for the last cairn', async () => {
    const R = await recP, env = envOf(R);
    let s = startAt(at(0, 1), 'cairns', 1, 2000, env, { trail: trailNote(0).points });
    const first = s.setpieces.runs.cairns.data.cairns[0];
    s = addNote(s, { id: 'cairns', kind: 'read', hour: 2000 });
    s = addNote(s, { id: 'cairns', kind: 'stone', cairn: 0, hour: 2000 });
    s = addNote(s, { id: 'cairns', kind: 'stone', cairn: 0, hour: 2000 });
    const r = run(s, 2000, 24 * 5, env);
    const list = r.state.setpieces.runs.cairns.data.cairns;
    eq(list[0].added, 2, 'two stones added');
    eq(list[1].stones, first.stones + 3, 'the next has one more than the first now holds');
    assert(list[1].answer, 'and says it answered');
    eq(r.state.setpieces.runs.cairns.data.read, undefined, 'reading before the last cairn does nothing');
    for (let i = 0; i < 9; i++) s = addNote(s, { id: 'cairns', kind: 'stone', cairn: 0, hour: 2000 });
    eq(run(s, 2000, 1, env).state.setpieces.runs.cairns.data.cairns[0].added, R.list.cairns.cairn.addMax, 'never past addMax');
    let end = startAt(at(0, 1), 'cairns', 7, 3000, env, { trail: trailNote(0).points });
    end = addNote(end, { id: 'cairns', kind: 'read', hour: 3000 });
    const done = run(end, 3000, 3, env);
    assert(done.state.setpieces.runs.cairns.done !== undefined, 'read at the last: it ends');
    assert(done.ev.some((e) => e.name === 'setpiece:end' && e.payload.id === 'cairns'), 'and says so');
  });

  test(G, 'the boat: a parcel waits for its next dawn; a gift and the next letter; an untaken gift waits', async () => {
    const R = await recP, env = envOf(R), B = R.list.boat.boat;
    const base = { ...at(1, 0, 13) };
    // Left between visits (the last one gone): it waits, and the next run takes it at its dawn.
    let w = startAt(base, 'boat', 2, 600, env);
    w = run(addNote(w, { id: 'boat', kind: 'parcel', what: 'chamomile.flowers', hour: 600 }), 600, 1, env).state;
    eq(w.setpieces.runs.boat.data.parcel?.what, 'chamomile.flowers', 'left between visits, it waits');
    const nextRun = startAt({ ...w, seasons: { ...w.seasons, index: 2 } }, 'boat', 1, 900, env);
    eq(nextRun.setpieces.runs.boat.data.parcel?.what, 'chamomile.flowers', 'carried to the next visit');
    const taken = run(nextRun, 900, 24, env).state.setpieces.runs.boat.data;
    eq(taken.gift?.letter, B.letters[0], 'and answered at its dawn');
    eq(taken.parcel, undefined, 'the stone free again');
    // At anchor: it is left; at dawn a return and the first letter.
    let s = startAt(base, 'boat', 1, 600, env);
    s = addNote(s, { id: 'boat', kind: 'parcel', what: 'chamomile.flowers', hour: 600 });
    const r = run(s, 600, 24, env);
    const g = r.state.setpieces.runs.boat.data.gift;
    eq(g.kind, B.returns[0].kind, 'the first return');
    eq(g.letter, B.letters[0], 'the first letter');
    eq(r.state.setpieces.runs.boat.done !== undefined, true, 'gone by dawn');
    // Sending what would come back brings the next return instead.
    let c = startAt(base, 'boat', 1, 600, env);
    c = addNote(c, { id: 'boat', kind: 'parcel', what: B.returns[0].kind, hour: 600 });
    eq(run(c, 600, 24, env).state.setpieces.runs.boat.data.gift.kind, B.returns[1].kind, 'never what was sent');
    // No parcel: nothing comes back.
    eq(run(startAt(base, 'boat', 1, 600, env), 600, 24, env).state.setpieces.runs.boat.data.gift, undefined, 'no parcel, no gift');
    // Untaken, it carries into the next run; taken, it does not.
    const nextSeason = (/** @type {any} */ st) => ({ ...st, seasons: { ...st.seasons, index: 2, day: 13 } });
    const kept = startAt(nextSeason(r.state), 'boat', 0, 900, env).setpieces.runs.boat.data;
    eq(kept.gift?.letter, B.letters[0], 'an untaken gift waits on the stone');
    eq(kept.sent, 1, 'and the parcels sent are remembered');
    const took = run(addNote(r.state, { id: 'boat', kind: 'taken', hour: 700 }), 700, 1, env).state;
    eq(startAt(nextSeason(took), 'boat', 0, 900, env).setpieces.runs.boat.data.gift, undefined, 'a taken one is gone');
  });

  test(G, 'the trail: the same every time, evenly along dry land, leaning on', async () => {
    const R = await recP, T = R.list.cairns.trail;
    // An island: a disc of land 64 m across, with a pond in the way to the east.
    const ground = (/** @type {number} */ x, /** @type {number} */ z) => (Math.hypot(x - 8, z) < 3 ? -0.2 : 4 - Math.hypot(x, z) * 0.1);
    const a = planTrail({ x: 0, z: 0 }, ground, T, 99), b = planTrail({ x: 0, z: 0 }, ground, T, 99);
    assert(a, 'a trail'); eq(JSON.stringify(a), JSON.stringify(b), 'the same twice');
    eq(a?.length, T.count, 'count cairns');
    assert(a?.every(([x, z]) => ground(x, z) >= T.landM), 'all on dry land');
    eq(planTrail({ x: 0, z: 0 }, () => -1, T, 99), null, 'no land: no trail');
    const to = planTrail({ x: 0, z: 0 }, ground, T, 99, { x: 0, z: -15 });
    assert(to && to[to.length - 1][1] < to[0][1], 'toward a given end');
    const y = leanYaw(/** @type {any} */ (a), 0), n = /** @type {any} */ (a)[1], f = /** @type {any} */ (a)[0];
    assert(Math.abs(y - Math.atan2(n[0] - f[0], n[1] - f[1])) < 1e-9, 'each leans toward the next');
    const m = cairnMesh(6, 5, R.list.cairns.look, 4, 0, true);
    assert(m.count > 0 && m.indices.length % 3 === 0, 'a cairn mesh');
  });

  test(G, 'the test link: startAt stands on the step asked', async () => {
    const R = await recP, env = envOf(R);
    const steps = stepsOf(R.list.cairns);
    eq(steps.length, 8, 'seven cairns and the letter');
    const s = startAt(at(0, 1), 'cairns', 3, 1000, env, { trail: trailNote(0).points }).setpieces.runs.cairns;
    eq(s.step, 3, 'on step 3'); eq(s.data.cairns.length, 3, 'three cairns stand');
    assert(s.fell.every((h, i) => i === 0 || h > s.fell[i - 1]), 'in order');
  });

  test(G, 'keeper pages: a set piece\'s lines follow its flags', async () => {
    const R = await recP;
    const page = R.keeper.pages.find((/** @type {any} */ p) => p.id === 'cairns');
    const without = pageBody(page, []).join(' '), withStone = pageBody(page, ['setpiece:cairns:added']).join(' ');
    assert(without.includes('as I found them') && !without.includes('answering'), 'no stone added');
    assert(withStone.includes('answering') && !withStone.includes('as I found them'), 'a stone added');
    for (const id of [...R.list.boat.boat.letters, ...R.list.boat.boat.quiet, 'boat', 'cairns-letter']) {
      const p = R.keeper.pages.find((/** @type {any} */ q) => q.id === id);
      assert(p, `page ${id}`);
      const words = pageBody(p, []).join(' ').split(/\s+/).filter(Boolean).length;
      assert(words <= 60, `${id} under 60 words (${words})`);
      assert(!/genuine/i.test(pageBody(p, []).join(' ')), `${id} never says genuine`);
    }
  });
}

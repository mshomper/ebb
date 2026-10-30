// @ts-check
// Hen trust tests for tools/unit-tests.html (docs/future/15, slice 2): her words from her trust and
// Fond; watching and one treat a game day earn it, never past Familiar; Fond comes only from days at
// Familiar with days together (never from treats), and her feather the morning after; nothing
// counts as together while you are away; the hourly tick applies it the same way in any order of
// hours; the test links reach each band; naming waits for namingTrust; and each band behaves as its
// word says (bands.js and life.js): Wary runs, Tolerant keeps about 3 m, Curious comes to see and
// waits by a hole, Familiar follows and goes to the fire at dusk, Fond greets at dawn and settles
// beside a walker sitting by the fire; a treat brings her to peck it up; the hat band is kept by the kit.

import { HOURS_PER_DAY } from '../src/core/clock.js';
import { henWord, henBand, applyHen, coarseStep, addHenEvent, newHen, nameHen, takeFeather, featherLying, dayOf } from '../src/world/hen/trust.js';
import { choosePlan, ringSpot, besideSpot, asideSpot } from '../src/world/hen/bands.js';
import { createHenLife } from '../src/world/hen/life.js';
import { featherSpot, featherMesh } from '../src/world/hen/feather.js';
import { cleanKit, emptyKit, addBand, wearsBand } from '../src/world/kit/model.js';

const G = 'hen-trust';

let made = /** @type {Promise<any> | null} */ (null);
const load = () => made ?? (made = fetch('../recipes/species/hen.json').then((r) => r.json()));

/** A walker as presence hands it to her. @param {number} x @param {number} z @param {{ speed?: number, sit?: boolean }} [o] */
const walker = (x, z, o = {}) => ({ id: 'walker', kind: 'walker', pos: [x, 0.9, z], speed: o.speed ?? 0, editing: false, edits: [], stillS: 1,
  body: true, posture: o.sit ? 'sit' : 'stand', gaze: null, ringK: 1 });

/** A hen at home at the origin on dry flat ground. @param {any} R @param {number} [seed] */
function henAt(R, seed = 9) {
  const life = createHenLife({ R, seed, ground: () => 0, wet: () => false });
  life.setHome({ x: 0, z: 0 }, R.home.rangeM, true);
  return life;
}

/**
 * Run her life a while; the walker given as a function of time. Returns distances to the walker
 * (after `skipS`) and the modes she was in. @param {any} life @param {number} band @param {number} s
 * @param {(t: number) => any[]} who @param {{ ring?: any, hour?: number, day?: number, skipS?: number }} [o]
 */
function live(life, band, s, who, o = {}) {
  const d = [], modes = new Set();
  for (let i = 0; i < s * 30; i++) {
    const t = i / 30, src = who(t);
    life.step(1 / 30, { night: false, sources: src, band, ring: o.ring ?? null, hourOfDay: o.hour ?? 12, day: o.day ?? 0 });
    const h = life.hen;
    modes.add(h.mode + (h.plan ? `:${h.plan.purpose}` : ''));
    if (src[0] && t >= (o.skipS ?? 0)) d.push(Math.hypot(h.x - src[0].pos[0], h.z - src[0].pos[2]));
  }
  return { d, modes, mean: d.reduce((a, b) => a + b, 0) / Math.max(1, d.length), min: Math.min(...d) };
}

/** Days pass: an hourly tick at each hour, with near hours each day as given. @param {any} H @param {any} R @param {number} from @param {number} days @param {(day: number) => number} nearOf */
function passDays(H, R, from, days, nearOf) {
  const events = [];
  for (let h = from; h < from + days * HOURS_PER_DAY; h++) {
    if (h % HOURS_PER_DAY === 12) { const n = nearOf(dayOf(h)); if (n > 0) H.pending = [...(H.pending ?? []), { kind: 'near', h: n, hour: h }]; }
    events.push(...applyHen(H, R, h));
  }
  return events;
}

/** @param {(group: string, name: string, fn: () => any) => void} test @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq */
export function addHenTrustTests(test, assert, eq) {
  test(G, 'her words follow her trust, Familiar is her ceiling, and Fond is hers alone', async () => {
    const R = await load(), P = R.presence;
    eq(henWord(null, P), 'wary', 'no hen yet: Wary');
    eq(henWord({ ...newHen(0), trust: P.bands[0] }, P), 'tolerant', 'Tolerant at its band');
    eq(henWord({ ...newHen(0), trust: P.bands[1] }, P), 'curious', 'Curious');
    eq(henWord({ ...newHen(0), trust: P.bands[2] }, P), 'familiar', 'Familiar');
    eq(henWord({ ...newHen(0), trust: 1 }, P), 'familiar', 'trust alone never makes her Fond');
    eq(henWord({ ...newHen(0), trust: 0.7, fond: 50 }, P), 'fond', 'Fond once she is');
    eq(henBand({ ...newHen(0), trust: 0.7, fond: 50 }, P), 4, 'Fond is band 4');
  });

  test(G, 'watching and one treat a game day earn trust, never past Familiar; a second treat that day earns nothing', async () => {
    const R = await load(), P = R.presence;
    const H = newHen(0);
    H.pending = [{ kind: 'watched', minutes: 10, hour: 1 }];
    applyHen(H, R, 1);
    const w = Math.min(10, P.watch.capS / 60) * P.watch.trustPerMin;
    assert(Math.abs(H.trust - w) < 1e-4, `ten minutes watched earn ${w} (${H.trust})`);
    const before = H.trust;
    H.pending = [{ kind: 'treat', hour: 2, treat: 'worms' }, { kind: 'treat', hour: 3, treat: 'seedheads' }];
    const ev = applyHen(H, R, 3);
    assert(Math.abs(H.trust - before - P.feedTrust * P.treatFeeds) < 1e-4, `one treat's worth, once that day (${H.trust - before})`);
    eq(ev.filter((e) => e.name === 'creature:ate').length, 2, 'both treats were eaten');
    H.pending = Array.from({ length: 400 }, (_, i) => ({ kind: 'watched', minutes: 10, hour: 4 + i }));
    applyHen(H, R, 404);
    assert(H.trust <= 1 && henWord(H, P) === 'familiar', `never past Familiar (${H.trust})`);
  });

  test(G, 'Fond comes after the days at Familiar with days together, never from treats, then the feather at dawn', async () => {
    const R = await load(), P = R.presence, F = R.fond;
    // Familiar, with a treat every day and nobody near: not Fond however long.
    let H = { ...newHen(0), trust: P.bands[2] };
    for (let d = 0; d < F.days * 3; d++) H.pending = [...(H.pending ?? []), { kind: 'treat', hour: d * 24 + 9, treat: 'worms' }];
    passDays(H, R, 0, F.days * 3, () => 0);
    eq(H.fond, undefined, 'treats every day without time together: not Fond');
    // Together on togetherDays of the days: Fond after `days` whole days.
    H = { ...newHen(0), trust: P.bands[2] };
    const ev = passDays(H, R, 0, F.days + 2, (d) => (d < F.togetherDays ? F.nearHours + 0.5 : 0));
    const fondAt = ev.findIndex((e) => e.name === 'creature:fond');
    assert(fondAt >= 0, `Fond came (famDays ${H.famDays}, together ${H.together})`);
    eq(dayOf(/** @type {number} */ (H.fond)), F.days, `on the morning after the ${F.days}th whole day`);
    assert(ev.some((e) => e.name === 'creature:trusted' && e.payload.word === 'fond'), 'her word moved to Fond');
    assert(H.feather && dayOf(H.feather.at) === F.days + F.featherAfterDays && H.feather.at % 24 >= F.featherH, `the feather, at dawn ${F.featherAfterDays} morning(s) later (${H.feather?.at})`);
    // Too few days together: not yet.
    const few = { ...newHen(0), trust: P.bands[2] };
    passDays(few, R, 0, F.days + 3, (d) => (d < F.togetherDays - 1 ? F.nearHours + 0.5 : 0));
    eq(few.fond, undefined, 'one day together short: not Fond');
    // Days before Familiar do not count.
    const early = { ...newHen(0), trust: P.bands[1] };
    passDays(early, R, 0, F.days + 3, () => F.nearHours + 1);
    eq(early.famDays, 0, 'days at Curious are not days at Familiar');
  });

  test(G, 'away, the days pass but none is together; the hourly tick skips until she is out, and gives the same in one go', async () => {
    const R = await load(), P = R.presence, F = R.fond;
    const H = { ...newHen(0), trust: P.bands[2] };
    passDays(H, R, 0, 20, () => 0);
    eq(H.famDays, 19, 'twenty days at Familiar pass while away (the last not yet over)');
    eq(H.together, 0, 'none of them together');
    eq(H.fond, undefined, 'and she is not Fond from being left');
    const env = { recipes: { species: { hen: R } } };
    const none = coarseStep({ creatures: {} }, 5, env);
    eq(none.events.length, 0, 'no hen, nothing');
    // Every hour ticked, or one tick at the end: the same state.
    let a = addHenEvent({}, { kind: 'watched', minutes: 5, hour: 1 });
    a = addHenEvent(a, { kind: 'near', h: F.nearHours + 1, hour: 30 });
    let stepped = a;
    for (let h = 1; h <= 100; h++) stepped = coarseStep(stepped, h, env).state;
    const once = coarseStep(a, 100, env).state;
    // Her eggs (slice 4) are laid at their hour, so only the hour-by-hour run has them; compared without.
    eq(JSON.stringify({ ...stepped.creatures.hens, pending: [], nest: undefined }), JSON.stringify({ ...once.creatures.hens, pending: [], nest: undefined }), 'hour by hour or at once, the same');
    void P;
  });

  test(G, 'test links: &trust= reaches each band at once, &fond makes her Fond with her feather laid', async () => {
    const R = await load(), P = R.presence;
    for (const [t, w] of [[0.2, 'tolerant'], [0.45, 'curious'], [0.65, 'familiar']]) {
      const H = newHen(0);
      applyHen(H, R, 1, { testTrust: /** @type {number} */ (t) });
      eq(henWord(H, P), w, `&trust=${t}`);
    }
    const F = newHen(0);
    const ev = applyHen(F, R, 1, { testFond: true });
    eq(henWord(F, P), 'fond', '&fond: Fond');
    assert(featherLying(F), 'and her feather lies by the fire');
    assert(ev.some((e) => e.name === 'hen:feather'), 'hen:feather, for the gift stone and the journal');
    const s = takeFeather({ creatures: { hens: F } }, 3);
    assert(!featherLying(s.creatures.hens), 'taken up, it lies there no more');
    eq(takeFeather(s, 4), s, 'and cannot be taken twice');
  });

  test(G, 'she can be named once she knows you to namingTrust, and only once', async () => {
    const R = await load(), P = R.presence;
    const low = { creatures: { hens: { ...newHen(0), trust: P.namingTrust - 0.01 } } };
    eq(nameHen(low, 'Maud', 5, P), low, 'not yet');
    const ok = { creatures: { hens: { ...newHen(0), trust: P.namingTrust } } };
    const named = nameHen(ok, 'Maud', 5, P);
    eq(named.creatures.hens.name, 'Maud', 'named');
    eq(nameHen(named, 'Dot', 6, P), named, 'a second name is refused');
  });

  test(G, 'the bands behave as their words: Wary runs, Tolerant keeps about 3 m, Curious comes closer', async () => {
    const R = await load();
    const stand = (/** @type {number} */ x) => () => [walker(x, 0)];
    const wary = live(henAt(R), 0, 40, stand(4), { skipS: 10 });
    assert(wary.modes.has('flee'), 'Wary: she runs from you');
    assert(wary.min > R.bands.tolerant.keepM, `Wary: never near (${wary.min.toFixed(2)} m)`);
    const tol = live(henAt(R), 1, 60, stand(4), { skipS: 10 });
    assert(!tol.modes.has('flee'), 'Tolerant: she never runs');
    assert(tol.mean > R.bands.tolerant.ringM && tol.mean < R.bands.tolerant.keepM + 2.5, `Tolerant: about ${R.bands.tolerant.keepM} m (mean ${tol.mean.toFixed(2)})`);
    const cur = live(henAt(R), 2, 120, stand(4), { skipS: 10 });
    assert(cur.modes.has('act:visit') || cur.modes.has('go:visit'), 'Curious: she comes to see you');
    assert(cur.min < tol.min, `Curious comes closer than Tolerant (${cur.min.toFixed(2)} vs ${tol.min.toFixed(2)})`);
  });

  test(G, 'Curious waits by a hole you dig; a treat brings her to peck it up (at Wary only once you step back)', async () => {
    const R = await load();
    const life = henAt(R);
    live(life, 2, 5, () => [walker(3, 0)]);
    life.dugAt(2.4, 0.5);
    const r = live(life, 2, 12, () => [walker(3, 0)]);
    assert(r.modes.has('act:dig'), `she came to wait by the hole (${[...r.modes].join(', ')})`);
    // A treat at Wary: she waits while you stand by it, then comes when you have stepped back.
    const w = henAt(R);
    live(w, 0, 0.2, () => [walker(2.3, 0)]);
    let eaten = 0;
    eq(w.treatAt(2, 0, { tid: 1, treat: 'worms' }, () => { eaten++; }), 'waiting', 'at Wary, with you beside it, she waits');
    live(w, 0, 10, () => [walker(2.3, 0)]);
    eq(eaten, 0, 'not while you stand there');
    live(w, 0, 40, () => [walker(12, 0)]);
    eq(eaten, 1, 'once you step back she comes and pecks it up');
  });

  test(G, 'Familiar follows you on a walk at a loose few metres, and settles by the fire ring at dusk', async () => {
    const R = await load(), B = R.bands;
    const life = henAt(R);
    live(life, 3, 10, () => [walker(3, 0)]);
    // You walk off 6 m and stand: she comes after you and ends a loose few metres away.
    const r = live(life, 3, 40, (t) => [walker(3 + Math.min(6, t * 1.2), 0, { speed: t < 5 ? 1.2 : 0 })]);
    assert(r.modes.has('go:follow'), 'she followed');
    const end = r.d[r.d.length - 1];
    assert(end <= B.follow.farM + 1, `she ended near you (${end.toFixed(2)} m)`);
    const ring = { x: 8, z: 2 };
    const dusk = live(life, 3, 60, () => [walker(12, 6)], { ring, hour: B.dusk.fromH + 0.5 });
    assert(dusk.modes.has('settle:ring'), `at dusk she settled by the ring (${[...dusk.modes].join(', ')})`);
    const spot = ringSpot(B, ring, { x: 0, z: 0 });
    assert(Math.hypot(life.hen.x - spot.x, life.hen.z - spot.z) < 0.3, 'at her place by the ring');
    assert(life.hen.settle > 0.99, 'settled down (legs folded)');
  });

  test(G, 'Fond greets you at dawn once a day, and settles beside you when you sit by the fire', async () => {
    const R = await load(), B = R.bands, F = B.fondDo;
    const ring = { x: 6, z: 0 };
    const life = henAt(R);
    const dawn = live(life, 4, 20, () => [walker(5, 3)], { ring, hour: F.greetH[0] + 0.5, day: 3 });
    assert(dawn.modes.has('act:greet') || dawn.modes.has('go:greet'), 'she came to greet you');
    eq(life.hen.greetedDay, 3, 'once, that day');
    const plan = choosePlan(R, { band: 4, hen: life.hen, home: { x: 0, z: 0 }, walker: { x: 5, z: 3, speed: 0, sit: false }, ring, hourOfDay: F.greetH[0] + 0.5,
      day: 3, greetedDay: 3, treat: null, dig: null, visitDue: false, following: false });
    assert(plan?.purpose !== 'greet', 'not twice the same morning');
    const you = { x: ring.x - 1.2, z: ring.z };
    const sit = live(life, 4, 40, () => [walker(you.x, you.z, { sit: true })], { ring, hour: 14 });
    assert(sit.modes.has('settle:beside'), `she settled beside you (${[...sit.modes].join(', ')})`);
    const b = besideSpot(B, you, ring);
    assert(Math.hypot(life.hen.x - b.x, life.hen.z - b.z) < 0.3, 'at your side');
    // You stand up: she gets up too.
    live(life, 4, 5, () => [walker(you.x, you.z)], { ring, hour: 14 });
    assert(life.hen.mode !== 'settle', 'she gets up when you do');
  });

  test(G, 'stepping aside goes out to her keeping distance; the feather lies by the ring, and the gift stone can take it', async () => {
    const R = await load(), F = R.fond.feather;
    const a = asideSpot(R, 1, { x: 1, z: 0 }, { x: 0, z: 0 });
    assert(Math.abs(Math.hypot(a.x, a.z) - Math.max(R.bands.tolerant.keepM, R.bands.tolerant.ringM * 1.3)) < 1e-9, 'out to keepM');
    const s = featherSpot(F, { x: 10, z: 10 }, { x: 0, z: 0 });
    assert(Math.abs(Math.hypot(s.x - 10, s.z - 10) - F.ringM) < 1e-9, 'ringM from the ring');
    const g = featherSpot(F, { x: 10, z: 10 }, { x: 0, z: 0 }, { x: 3, z: 4 });
    assert(g.x === 3 && g.z === 4, 'on the gift stone once there is one');
    const m = featherMesh(F);
    assert(m.data.every(Number.isFinite) && m.indices.length % 3 === 0 && Math.max(...m.indices) < m.data.length / 8, 'a well-formed feather mesh');
  });

  test(G, 'the hat band is kept by the kit, saved, and an older kit reads as none', async () => {
    assert(!wearsBand(cleanKit({ hat: 'own' }), 'hen-feather') && !('bands' in cleanKit({ hat: 'own' })), 'a kit saved before bands: none, and saved as before');
    const k = addBand(emptyKit(), 'hen-feather');
    assert(wearsBand(k, 'hen-feather'), 'given, worn');
    eq(addBand(k, 'hen-feather'), k, 'given once');
    assert(wearsBand(cleanKit(JSON.parse(JSON.stringify(k))), 'hen-feather'), 'kept through a save');
  });
}

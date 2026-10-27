// @ts-check
// The Hollow's crowd (H2, src/world/hollow/crowd.js) for tools/unit-tests.html: things started on top
// of each other spread out; while five come for a walker, no more than the attack slots wind up at once
// (one in the gentler Hollow), every one gets a turn, and the rest wait on the ring; a thing holding its
// ground is not pushed; nothing is pushed into rock; a floating watcher is not pushed by crawlers; and
// the same seed gives the same crowd.

import { createFoe } from '../src/world/hollow/foes.js';
import { createCrowd } from '../src/world/hollow/crowd.js';

const G = 'crowd';
const DT = 1 / 60;
const recipe = async () => (await fetch('../recipes/world/hollow.json')).json();
/** Open ground: everything but a wall of rock at x > 4. */
const open = (/** @type {number} */ x, /** @type {number} */ _z) => x < 4;

/**
 * Run things with the crowd for some seconds; calls look(t) after each frame.
 * @param {any[]} foes @param {any} crowd @param {any} w @param {number} s @param {(t: number) => void} [look] @param {boolean} [gentle]
 */
function run(foes, crowd, w, s, look, gentle = false) {
  for (let i = 0; i < Math.round(s / DT); i++) {
    crowd.assign(foes, w.you, gentle);
    for (const f of foes) f.update(DT, { ...w, crowd });
    crowd.spread(foes, w, DT);
    look?.(i * DT);
  }
}
/** The nearest two bodies come to their sizes (m, negative: overlapping). @param {any[]} foes */
const gap = (foes) => {
  let g = Infinity;
  for (let i = 0; i < foes.length; i++) for (let j = i + 1; j < foes.length; j++) {
    if (!!foes[i].K.floats !== !!foes[j].K.floats) continue;
    g = Math.min(g, Math.hypot(foes[i].x - foes[j].x, foes[i].z - foes[j].z) - foes[i].K.bodyM - foes[j].K.bodyM);
  }
  return g;
};

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addCrowdTests(test, assert, eq) {
  /** Five crawlers round a still walker, alerted. @param {any} H @param {number} seed */
  const five = (H, seed) => {
    const foes = [[0, -5], [3, -4], [-3, -4], [3.5, 2], [-4, 1]].map(([x, z], i) => createFoe('lunger', i + 1, { x, z }, H.foes.lunger, seed, H.swing));
    for (const f of foes) f.take({ kind: 'alert', forS: 60 });
    return foes;
  };
  const world = () => ({ you: { x: 0, z: 0, speed: 0 }, lamp: { x: 0, z: 0, reachM: 6, raised: false, snuffed: false }, open });

  test(G, 'things started on top of each other spread out until no bodies overlap', async () => {
    const H = await recipe(), crowd = createCrowd(H.crowd, 1);
    const foes = [1, 2, 3, 4, 5, 6].map((id) => createFoe('lunger', id, { x: 0, z: 6, yaw: 0 }, H.foes.lunger, 3, H.swing));
    const w = { ...world(), you: { x: 0, z: -20, speed: 0 } };
    assert(gap(foes) < -0.5, 'stacked to start');
    run(foes, crowd, w, 3);
    assert(gap(foes) > -0.01, `apart after settling (nearest ${gap(foes).toFixed(3)} m)`);
  });

  test(G, 'five come for a walker: never more than the slots wind up at once, each gets a turn, the rest wait on the ring', async () => {
    const H = await recipe();
    for (const gentle of [false, true]) {
      const crowd = createCrowd(H.crowd, 1), foes = five(H, 7), w = world(), n = gentle ? H.crowd.gentleSlots : H.crowd.attackSlots;
      let most = 0, settledGap = Infinity, ringOk = 0, ringAll = 0, lastLunge = -9;
      /** Each waiting one's distance to its place last frame. @type {Map<number, number>} */ const toPlace = new Map();
      const turns = new Set();
      // One slot takes longer to go round all five.
      run(foes, crowd, w, gentle ? 24 : 14, (t) => {
        const going = foes.filter((f) => f.step === 'wind' || f.step === 'strike');
        most = Math.max(most, going.length);
        going.forEach((f) => turns.add(f.id));
        if (t < 3) return;
        // Waiting ones (closing in without a slot) stand at their place on the ring, or are on their way there.
        for (const f of foes) {
          const at = crowd.waitAt(f.id);
          if (f.step !== 'close' || crowd.may(f.id) || !at) { toPlace.delete(f.id); continue; }
          const d = Math.hypot(f.x - at[0], f.z - at[1]), was = toPlace.get(f.id);
          ringAll++;
          if (d < 0.6 || (was !== undefined && d < was + 1e-3)) ringOk++;
          toPlace.set(f.id, d);
        }
        // Settled: 0.4 s after any lunge (a lunge drives through; the push sorts it out in a few frames).
        if (foes.some((f) => f.step === 'strike')) lastLunge = t;
        else if (t - lastLunge > 0.4) settledGap = Math.min(settledGap, gap(foes));
      }, gentle);
      assert(most <= n, `${gentle ? 'gentler' : 'normal'}: at most ${n} winding up at once (saw ${most})`);
      assert(most === n, `${gentle ? 'gentler' : 'normal'}: the slots are used`);
      eq(turns.size, 5, `${gentle ? 'gentler' : 'normal'}: every one gets a turn`);
      assert(ringAll > 100 && ringOk / ringAll > 0.9, `${gentle ? 'gentler' : 'normal'}: the waiting ones keep to the ring, or head there (${ringOk} of ${ringAll} frames)`);
      assert(settledGap > -0.02, `${gentle ? 'gentler' : 'normal'}: bodies apart once settled after a lunge (nearest ${settledGap.toFixed(2)} m)`);
    }
  });

  test(G, 'one winding up holds its ground; the other takes the whole push; nothing goes into rock', async () => {
    const H = await recipe(), crowd = createCrowd(H.crowd, 1);
    const a = createFoe('lunger', 1, { x: 0, z: 1.5, yaw: Math.PI }, H.foes.lunger, 3, H.swing);
    const b = createFoe('lunger', 2, { x: 0.2, z: 1.5, yaw: Math.PI }, H.foes.lunger, 3, H.swing);
    const w = { ...world(), you: { x: 0, z: 0, speed: 1 } };
    // Let a take its slot and rear up.
    for (let i = 0; i < 30 && a.step !== 'wind'; i++) { crowd.assign([a, b], w.you); a.update(DT, { ...w, crowd }); }
    eq(a.step, 'wind', 'a winds up');
    const ax = a.x, az = a.z, bx = b.x;
    crowd.spread([a, b], w, DT * 10);
    assert(a.x === ax && a.z === az, 'the one winding up did not move');
    assert(b.x > bx, 'the other was pushed away');
    // Against the wall: pushed along it, never into it.
    const c = createFoe('lunger', 3, { x: 3.8, z: 5, yaw: 0 }, H.foes.lunger, 3, H.swing), d = createFoe('lunger', 4, { x: 3.7, z: 5, yaw: 0 }, H.foes.lunger, 3, H.swing);
    run([c, d], createCrowd(H.crowd, 1), { ...w, you: { x: 0, z: -30, speed: 0 } }, 2);
    assert(c.x < 4 && d.x < 4, 'nothing pushed into rock');
  });

  test(G, 'a floating watcher is not pushed by crawlers, only by another watcher', async () => {
    const H = await recipe(), crowd = createCrowd(H.crowd, 1);
    const wa = createFoe('watcher', 1, { x: 0, z: 5, yaw: 0 }, H.foes.watcher, 3, H.swing), cr = createFoe('lunger', 2, { x: 0.1, z: 5, yaw: 0 }, H.foes.lunger, 3, H.swing);
    const w = { ...world(), you: { x: 0, z: -30, speed: 0 } };
    crowd.spread([wa, cr], w, DT * 10);
    eq(`${wa.x},${wa.z},${cr.x},${cr.z}`, '0,5,0.1,5', 'over a crawler: no push');
    const wb = createFoe('watcher', 3, { x: 0.1, z: 5, yaw: 0 }, H.foes.watcher, 3, H.swing);
    crowd.spread([wa, wb], w, DT * 10);
    assert(Math.hypot(wa.x - wb.x, wa.z - wb.z) > 0.1, 'two watchers space apart');
  });

  test(G, 'a lunge into a standing walker ends at contact, never past it, and bounces off; rolling clear dodges it', async () => {
    const H = await recipe(), K = H.foes.lunger, R = K.bodyM + H.crowd.walkerBodyM;
    /** One lunge at a walker at the middle, from 2.5 m off: the nearest it came, its events, whether it crossed. @param {boolean} rolling */
    const lunge = (rolling) => {
      const f = createFoe('lunger', 1, { x: 0, z: 2.5, yaw: Math.PI }, K, 3, H.swing);
      const you = { x: 0, z: 0, speed: 1, bodyM: H.crowd.walkerBodyM, rolling: false };
      const w = { you, lamp: { x: 0, z: 0, reachM: 6, raised: false, snuffed: false }, open: () => true };
      let near = Infinity, crossed = false, hitAt = -1, after = 0;
      /** @type {any[]} */ const ev = [];
      for (let i = 0; i < 3 / DT; i++) {
        you.rolling = rolling && f.step === 'strike';
        const e = f.update(DT, w);
        ev.push(...e);
        if (e.some((x) => x.type === 'strike' && x.hit)) hitAt = Math.hypot(f.x, f.z);
        near = Math.min(near, Math.hypot(f.x, f.z));
        if (f.z < 0) crossed = true;
        if (f.step === 'recover' && f.t > 0.5) { after = Math.hypot(f.x, f.z); break; }
      }
      return { near, crossed, ev, hitAt, after, f };
    };
    const hit = lunge(false);
    const e = hit.ev.find((x) => x.type === 'strike');
    assert(e?.hit && e.dirZ < -0.9, 'it hit you, and the blow points along the lunge');
    assert(Math.abs(hit.hitAt - R) < 1e-6, `it stopped at contact (${hit.hitAt.toFixed(3)} m, bodies ${R} m)`);
    assert(hit.near >= R - 1e-6 && !hit.crossed, `never past your body (nearest ${hit.near.toFixed(3)} m)`);
    assert(hit.after > R + K.bounceM * 0.8, `bounced back (${hit.after.toFixed(2)} m)`);
    eq(hit.f.step, 'recover', 'then stuck, as after any lunge');
    const dodge = lunge(true);
    assert(!dodge.ev.some((x) => x.type === 'strike' && x.hit), 'rolled clear: no hit');
    assert(dodge.near < R - 0.1, `the lunge carried on to its goal, through where you were (${dodge.near.toFixed(2)} m)`);
  });

  test(G, 'the walker is solid to the push: a free thing is pushed out of its body, one holding its ground stays', async () => {
    const H = await recipe(), crowd = createCrowd(H.crowd, 1), K = H.foes.lunger;
    const you = { x: 0, z: 0 }, w = { open };
    const free = createFoe('lunger', 1, { x: 0.1, z: 0.2, yaw: 0 }, K, 3, H.swing);
    for (let i = 0; i < 60; i++) crowd.spread([free], w, DT, you);
    assert(Math.hypot(free.x, free.z) > K.bodyM + H.crowd.walkerBodyM - 0.01, `pushed out (${Math.hypot(free.x, free.z).toFixed(2)} m)`);
    const held = createFoe('lunger', 2, { x: 0.1, z: 0.2, yaw: 0 }, K, 3, H.swing);
    held.take({ kind: 'bind', forS: 3 });
    crowd.spread([held], w, DT * 10, you);
    eq(`${held.x},${held.z}`, '0.1,0.2', 'stunned, it holds its ground');
  });

  test(G, 'the same seed and the same moves give the same crowd', async () => {
    const H = await recipe();
    const go = () => { const foes = five(H, 5), crowd = createCrowd(H.crowd, 9); run(foes, crowd, world(), 8); return foes.map((f) => `${f.x.toFixed(6)},${f.z.toFixed(6)},${f.step}`).join(' '); };
    eq(go(), go(), 'the same crowd');
  });
}

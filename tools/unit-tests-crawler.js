// @ts-check
// The silt crawler (H2, doc 16; Matt's model, October 27, 2026) for tools/unit-tests.html: the model
// at the enemies' one scale (the mote's), its 16-bone rig and skin weights, its legs' IK, feet that
// stay planted and never slide while it shuffles and turns, stepping in diagonal pairs; the rear-up
// tell, the lunge and being stuck after; a front hit glancing in sparks, a back hit's flinch, and
// breaking into sand and motes of light; and the same seed giving the same crawler.

import { loadCrawlerModel } from '../src/world/hollow/crawler-model.js';
import { poseCrawler, restPose, LEGS } from '../src/world/hollow/crawler-rig.js';
import { createCrawlerMotion, CRAWLER_BONES } from '../src/world/hollow/crawler-motion.js';
import { createFoe } from '../src/world/hollow/foes.js';

const G = 'crawler';
const DT = 1 / 60;
const DEG = Math.PI / 180;
const recipe = async () => (await fetch('../recipes/world/hollow.json')).json();
const model = () => loadCrawlerModel('../assets/models/hollow/crawler.glb');
/** The mote's longest side in Matt's nTop units (mote_body.obj), which made it 20 cm across. */
const MOTE_UNITS = 49.17448;

/** A rest point carried by one bone's matrix. @param {Float32Array} B @param {number} bone @param {number[]} p */
const carry = (B, bone, p) => [0, 1, 2].map((r) => B[bone * 16 + r] * p[0] + B[bone * 16 + 4 + r] * p[1] + B[bone * 16 + 8 + r] * p[2] + B[bone * 16 + 12 + r]);
/** A foot's middle as the bones put it (model space). @param {any} m @param {Float32Array} B @param {string} leg */
const footAt = (m, B, leg) => carry(B, m.skeleton.findIndex((/** @type {any} */ b) => b.name === `knee.${leg}`), m.legs[leg].foot);

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addCrawlerTests(test, assert, eq) {
  test(G, "Matt's crawler loads as it is, at the mote's scale: about 55 cm wide and 70 cm long", async () => {
    const H = await recipe(), m = await model();
    eq(m.triangles, 14078, 'no further cut (12,416 + 636 + 636 + 390)');
    assert(Math.abs(H.enemySpace.mPerUnit * MOTE_UNITS - H.foes.motes.mote.sizeM) < 1e-4, 'one enemy-space scale: the one that makes the mote 20 cm');
    eq(m.mPerUnit, H.enemySpace.mPerUnit, 'made at that scale');
    let lo = Infinity, hi = -Infinity, low = Infinity;
    for (let i = 0; i < m.count; i++) low = Math.min(low, m.positions[i * 3 + 1]);
    // The body alone (the vertices on the body bone): its width across.
    for (let i = 0; i < m.count; i++) if (m.weights[i * 4] > 0 && m.joints[i * 4] === 1) { lo = Math.min(lo, m.positions[i * 3]); hi = Math.max(hi, m.positions[i * 3]); }
    assert(Math.abs(hi - lo - 0.55) < 0.02, `the body ${((hi - lo) * 100).toFixed(1)} cm wide`);
    assert(Math.abs(m.lengthM - 0.7) < 0.02, `${(m.lengthM * 100).toFixed(1)} cm long with its tail`);
    assert(Math.abs(low) < 1e-4, 'standing on the ground (y 0)');
  });

  test(G, 'the rig: 16 bones, parents first, weights whole, each leg bending across its middle', async () => {
    const m = await model();
    eq(m.skeleton.length, CRAWLER_BONES, '16 bones');
    m.skeleton.forEach((b, i) => assert(b.parent < i, `${b.name} after its parent`));
    for (const n of ['root', 'body', 'stalk.l', 'stalk.r', 'tail.0', 'tail.3', ...LEGS.flatMap((l) => [`hip.${l}`, `knee.${l}`])]) assert(m.skeleton.some((b) => b.name === n), n);
    let bad = 0;
    /** @type {Record<number, number>} */ const blended = {};
    const knees = new Set(LEGS.map((l) => m.skeleton.findIndex((b) => b.name === `knee.${l}`)));
    for (let i = 0; i < m.count; i++) {
      const w = m.weights.subarray(i * 4, i * 4 + 4);
      if (w[0] + w[1] + w[2] + w[3] !== 255) bad++;
      if (knees.has(m.joints[i * 4 + 1]) && w[0] > 60 && w[1] > 60) blended[m.joints[i * 4 + 1]] = (blended[m.joints[i * 4 + 1]] ?? 0) + 1;
    }
    eq(bad, 0, 'every vertex\'s weights sum to one');
    // Matt's tubes are sparse along their middles, so a few rings carry the bend.
    for (const k of knees) assert((blended[k] ?? 0) >= 5, `leg ${m.skeleton[k].name}: vertices blend hip to knee across the bend (${blended[k] ?? 0})`);
  });

  test(G, 'the rest pose draws the model as made, and the legs reach their feet by IK, knees up', async () => {
    const m = await model(), B = new Float32Array(CRAWLER_BONES * 16), p = restPose(m);
    poseCrawler(m, p, B);
    // Every bone still but the legs (a straight leg is the IK's edge: it keeps a hair of bend), whose feet land where they were.
    let off = 0;
    m.skeleton.forEach((b, i) => { if (!/^(hip|knee)/.test(b.name)) for (let k = 0; k < 16; k++) off = Math.max(off, Math.abs(B[i * 16 + k] - (k % 5 === 0 ? 1 : 0))); });
    assert(off < 1e-4, `still bones (${off})`);
    for (const l of LEGS) assert(Math.hypot(...footAt(m, B, l).map((v, k) => v - m.legs[l].foot[k])) < 1e-3, `${l}'s foot where it was`);
    // Sit 3 cm down and move each foot: they still reach, and every knee rises above the straight line.
    p.root.lift = -0.03;
    for (const l of LEGS) p.feet[l] = [m.legs[l].foot[0] * 0.92, m.legs[l].foot[1], m.legs[l].foot[2] + 0.02];
    const reached = poseCrawler(m, p, B);
    for (const l of LEGS) {
      const e = Math.hypot(...reached[l].map((v, k) => v - p.feet[l][k])), f = footAt(m, B, l);
      assert(e < 1e-3 && Math.hypot(...f.map((v, k) => v - p.feet[l][k])) < 1e-3, `${l} reached (${(e * 1000).toFixed(2)} mm)`);
      const knee = carry(B, m.skeleton.findIndex((b) => b.name === `hip.${l}`), m.legs[l].knee);
      const hip = [m.legs[l].hip[0], m.legs[l].hip[1] - 0.03, m.legs[l].hip[2]];
      assert(knee[1] > (hip[1] + f[1]) / 2 + 0.005, `${l} knee bends up`);
    }
  });

  test(G, 'shuffling, chasing and turning, a planted foot never slides; shuffling, feet step in diagonal pairs', async () => {
    const H = await recipe(), m = await model(), K = H.foes.lunger;
    const w = { ground: (/** @type {number} */ x, /** @type {number} */ z) => 0.3 + 0.05 * Math.sin(x * 2) * Math.cos(z), you: { x: 0, z: 5 } };
    /** Along a curve at mps for 4 s, then turning on the spot. @param {number} mps */
    const run = (mps) => {
      const foe = { x: 0, z: 0, yaw: 0, step: 'close', t: 0, stunS: 0, broken: false, hits: { front: 0, side: 0, back: 0 } };
      const mo = createCrawlerMotion(foe, m, K, 3);
      /** @type {Record<string, number[] | null>} */ const was = { fl: null, fr: null, hl: null, hr: null };
      let slide = 0, steps = 0, offPair = 0, clock = 0;
      for (let i = 0; i < 6 / DT; i++) {
        if (i * DT < 4) { foe.yaw += 0.6 * DT; foe.x += Math.sin(foe.yaw) * mps * DT; foe.z += Math.cos(foe.yaw) * mps * DT; } else foe.yaw += 1.5 * DT;
        foe.t += DT;
        mo.update(DT, clock += DT, w);
        const up = LEGS.filter((l) => mo.feet[l].from);
        if (up.length > 2 || (up.length === 2 && !((up.includes('fl') && up.includes('hr')) || (up.includes('fr') && up.includes('hl'))))) offPair++;
        for (const l of LEGS) {
          if (mo.feet[l].from) { if (was[l]) steps++; was[l] = null; continue; }
          const at = mo.toWorld(footAt(m, mo.bones, l));
          if (was[l]) slide = Math.max(slide, Math.hypot(at[0] - was[l][0], at[1] - was[l][1], at[2] - was[l][2]));
          was[l] = at;
        }
      }
      return { slide, steps, offPair };
    };
    const shuffle = run(K.moveMps * 2), chase = run(K.closeMps);
    for (const [name, r] of /** @type {[string, ReturnType<typeof run>][]} */ ([['shuffling', shuffle], ['chasing', chase]])) {
      assert(r.slide < 0.002, `${name}: planted feet held (${(r.slide * 1000).toFixed(2)} mm at most a frame)`);
      assert(r.steps > 20, `${name}: it stepped (${r.steps} steps)`);
    }
    eq(shuffle.offPair, 0, 'shuffling, never more than a diagonal pair off the ground');
  });
  test(G, 'the tell rears up and lifts the forelegs; the lunge dives plate first; stuck, the plate digs in', async () => {
    const H = await recipe(), m = await model(), K = H.foes.lunger, T = K.crawler.motion;
    const f = createFoe('lunger', 1, { x: 0, z: 0, yaw: 0 }, K, 7, H.swing);
    const mo = createCrawlerMotion(f, m, K, 1);
    const w = { you: { x: 0, z: 1.6, speed: 2 }, lamp: { x: 0, z: 1.6, reachM: 6, raised: false, snuffed: false }, open: () => true };
    let clock = 0, rear = 0, foreUp = 0, hindOff = 0, dive = 0, dig = 0, sawStuck = false;
    for (let i = 0; i < 3 / DT; i++) {
      f.update(DT, w);
      mo.update(DT, clock += DT, { ground: () => 0, you: w.you });
      const up = mo.pose.root.up;
      if (f.step === 'wind' && f.t > K.windS * 0.8) {
        rear = Math.max(rear, up);
        foreUp = Math.max(foreUp, Math.min(footAt(m, mo.bones, 'fl')[1], footAt(m, mo.bones, 'fr')[1]));
        hindOff = Math.max(hindOff, Math.abs(footAt(m, mo.bones, 'hl')[1] - m.legs.hl.footLiftM));
      }
      if (f.step === 'strike' && f.t > 0.12) dive = Math.min(dive, up);
      if (f.step === 'recover' && f.t > 0.2 && f.t < 0.7) { dig = Math.min(dig, up); sawStuck = true; }
    }
    assert(Math.abs(rear - T.tell.rearDeg * DEG) < 6 * DEG, `reared ${(rear / DEG).toFixed(0)} deg`);
    assert(foreUp > 0.15, `forelegs lifted (${(foreUp * 100).toFixed(0)} cm up)`);
    assert(hindOff < 0.002, 'hind feet stay planted while it rears');
    assert(dive < -T.lunge.diveDeg * DEG * 0.7, `dived plate first (${(dive / DEG).toFixed(0)} deg)`);
    assert(sawStuck && dig < -T.stuck.digDeg * DEG * 0.7, `stuck, plate dug in (${(dig / DEG).toFixed(0)} deg)`);
  });

  test(G, 'a front hit glances in sparks, a back hit flinches it, and it breaks into sand and motes of light', async () => {
    const H = await recipe(), m = await model(), K = H.foes.lunger, C = K.crawler;
    const f = createFoe('lunger', 1, { x: 0, z: 0, yaw: 0 }, K, 7, H.swing);
    const mo = createCrawlerMotion(f, m, K, 1);
    const world = { you: { x: 0, z: 1.2, speed: 0 }, lamp: { x: 0, z: 1.2, reachM: 6, raised: false, snuffed: false }, open: () => true };
    let clock = 0;
    const go = (/** @type {number} */ s) => { for (let i = 0; i < Math.round(s / DT); i++) { f.update(DT, world); mo.update(DT, clock += DT, { ground: () => 0, you: world.you }); } };
    go(0.5);
    const r = f.take({ kind: 'hit', fromX: 0, fromZ: 1.2 });
    assert(r.glanced, 'the front glances');
    go(C.motion.glance.s * 0.4);
    assert(mo.glancing && mo.dust.bits.some((b) => b.kind === 'spark'), 'sparks off the plate');
    assert(mo.pose.root.up > C.motion.glance.recoilDeg * DEG * 0.5, 'rocked back');
    go(1);
    f.take({ kind: 'hit', fromX: 0, fromZ: -1.2 });
    go(0.05);
    assert(mo.flinching && mo.pose.body.squash > 0, 'a back hit makes it flinch');
    f.take({ kind: 'hit', fromX: 0, fromZ: -1.2 }); f.take({ kind: 'hit', fromX: 0, fromZ: -1.2 });
    assert(f.broken, 'broken');
    go(0.1);
    const sand = mo.dust.bits.filter((b) => b.kind === 'sand').length, motes = mo.dust.bits.filter((b) => b.kind === 'mote').length;
    eq(sand, C.motion.breakup.sand.count, 'grey sand');
    eq(motes, C.motion.breakup.motes.count, 'motes of light');
    go(C.motion.breakup.slumpS);
    assert(mo.gone, 'no body left');
    go(3);
    eq(mo.dust.count, 0, 'the sand and motes fade');
  });

  test(G, 'the same seed makes the same crawler; two crawlers twitch and curl on their own', async () => {
    const H = await recipe(), m = await model(), K = H.foes.lunger;
    const run = (/** @type {number} */ seed) => {
      const foe = { x: 0, z: 0, yaw: 0, step: 'rest', t: 0, stunS: 0, broken: false, hits: { front: 0, side: 0, back: 0 } };
      const mo = createCrawlerMotion(foe, m, K, seed);
      let clock = 0;
      const stalk = [];
      for (let i = 0; i < 8 / DT; i++) { foe.t += DT; mo.update(DT, clock += DT, { ground: () => 0, you: { x: 1, z: 2 } }); stalk.push(mo.pose.stalks.l[0] + mo.pose.stalks.r[0]); }
      return { bones: Array.from(mo.bones).map((v) => v.toFixed(5)).join(), stalk };
    };
    const a = run(4), b = run(4), c = run(5);
    eq(a.bones, b.bones, 'the same seed, the same bones');
    assert(a.bones !== c.bones, 'another seed, its own moment');
  });
}

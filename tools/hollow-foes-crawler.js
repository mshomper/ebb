// @ts-check
// Hollow foes, the silt crawler (H2): Matt's crawler close up at its size in the game, rigged and
// moving by the same code as the arena (src/world/hollow/crawler-motion.js), on a stand-in foe that
// loops through what it does: resting, shuffling round, the rear-up tell, the lunge and being stuck
// after it, a front hit glancing off its plate, a hit on its back, and breaking into sand and motes of
// light. The page clock drives the loop; nothing here is seeded game state.

import { loadCrawlerModel } from '../src/world/hollow/crawler-model.js';
import { createCrawlerMotion } from '../src/world/hollow/crawler-motion.js';
import { createCrawlerPass } from './arena/crawler-pass.js';

/**
 * @param {{ device: GPUDevice, format: GPUTextureFormat }} gpu @param {any} K recipes/world/hollow.json foes.lunger
 */
export async function createCrawlerStand(gpu, K) {
  const model = await loadCrawlerModel(new URL('../assets/models/hollow/crawler.glb', import.meta.url));
  const pass = await createCrawlerPass(gpu, model, K.crawler);
  const foe = { x: 0, z: 0, yaw: 0, step: 'rest', t: 0, stunS: 0, broken: false, hits: { front: 0, side: 0, back: 0 } };
  let motion = createCrawlerMotion(foe, model, K, 1);
  /** Each act: a loop of [step, seconds, what happens as it starts]. */
  const ACTS = /** @type {Record<string, [string, number, string?][]>} */ ({
    rest: [['rest', 6]],
    shuffle: [['close', 9, 'circle']],
    rear: [['rest', 1.4], ['wind', K.windS], ['rest', 1.4]],
    lunge: [['rest', 1.2], ['wind', K.windS], ['strike', K.strikeS, 'dash'], ['recover', K.recoverS], ['close', 3, 'back']],
    stuck: [['rest', 0.8], ['wind', K.windS], ['strike', K.strikeS, 'dash'], ['recover', K.recoverS], ['rest', 0.6], ['close', 3, 'back']],
    glance: [['rest', 0.9, 'front'], ['rest', 1.3]],
    back: [['rest', 0.9, 'back-hit'], ['rest', 1.3]],
    break: [['rest', 1, 'mend'], ['broken', 3.5, 'break']],
  });
  let act = 'rest', actT = 0, part = -1, circleA = 0, youX = 0, youZ = 2;

  /** Start an act's part: its step, and what happens. @param {[string, number, string?]} p */
  function start(p) {
    foe.step = p[0]; foe.t = 0;
    const what = p[2];
    if (what === 'front') { foe.hits.front++; foe.x -= Math.sin(foe.yaw) * K.knockM * 0.35; foe.z -= Math.cos(foe.yaw) * K.knockM * 0.35; }
    if (what === 'back-hit') { foe.hits.back++; foe.x += Math.sin(foe.yaw) * K.knockM * 0.5; foe.z += Math.cos(foe.yaw) * K.knockM * 0.5; }
    if (what === 'mend' && foe.broken) { foe.broken = false; Object.assign(foe, { x: 0, z: 0 }); motion = createCrawlerMotion(foe, model, K, 1); }
    if (what === 'break') foe.broken = true;
  }

  return {
    model, pass, foe, get motion() { return motion; },
    /** @param {string} a */
    set(a) { act = a; actT = 0; part = -1; if (foe.broken) { foe.broken = false; motion = createCrawlerMotion(foe, model, K, 1); } Object.assign(foe, { x: 0, z: 0, step: 'rest', t: 0 }); foe.yaw = act === 'glance' || act === 'back' ? Math.atan2(youX, youZ) : 0; },
    get act() { return act; },
    /**
     * One step: the loop, then the motion. @param {number} dt @param {number} clock @param {number[]} eye where the view is (you)
     */
    tick(dt, clock, eye) {
      youX = eye[0]; youZ = eye[2];
      const loop = ACTS[act], total = loop.reduce((n, s) => n + s[1], 0);
      actT += dt;
      if (actT >= total) { actT -= total; part = -1; if (act !== 'break') Object.assign(foe, { x: 0, z: 0 }); }
      let at = actT, i = 0;
      while (i < loop.length - 1 && at >= loop[i][1]) { at -= loop[i][1]; i++; }
      if (i !== part) { part = i; start(loop[i]); }
      foe.t = at;
      const what = loop[i][2];
      if (what === 'circle') {
        // Shuffling round a small ring, facing its way.
        circleA += dt * K.moveMps * 1.2 / 0.5;
        foe.x = Math.sin(circleA) * 0.5; foe.z = Math.cos(circleA) * 0.5 - 0.5; foe.yaw = circleA + Math.PI / 2;
      } else if (what === 'dash') {
        const v = K.dashM / K.strikeS * 0.5;
        foe.x += Math.sin(foe.yaw) * v * dt; foe.z += Math.cos(foe.yaw) * v * dt;
      } else if (what === 'back') {
        // Back to the middle, backing away (it keeps facing you).
        const l = Math.hypot(foe.x, foe.z);
        if (l > 0.01) { const s = Math.min(l, 0.4 * dt); foe.x -= foe.x / l * s; foe.z -= foe.z / l * s; }
      } else if (foe.step === 'rest' && act !== 'rest' && act !== 'break') {
        // Facing you, turning on its feet.
        const want = Math.atan2(youX - foe.x, youZ - foe.z), d = Math.atan2(Math.sin(want - foe.yaw), Math.cos(want - foe.yaw));
        foe.yaw += Math.max(-dt * 2, Math.min(dt * 2, d));
      }
      motion.update(dt, clock, { ground: () => 0, you: { x: youX, z: youZ } });
      pass.set([motion]);
    },
    /** Where the view aims: the middle of the body, eased by the page. */
    aim() { return [foe.x, model.heightM * 0.45, foe.z]; },
  };
}

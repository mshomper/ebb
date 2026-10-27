// @ts-check
// Hollow foes, the hagstone watcher (H2): the stone from the orchestrator's generator close up at its
// size in the game, rigged and moving by the same code as the arena (src/world/hollow/watcher-motion.js),
// on a stand-in foe that loops through what it does: resting and breathing, turning to the lantern, the
// tell building, the call, dimmed by Snuff or Unmade, following moths, drifting (the weed streaming),
// a hit, and breaking. You hold the lantern where the view is. The page clock drives the loop; nothing
// here is seeded game state.

import { loadWatcherModel } from '../src/world/hollow/watcher-model.js';
import { createWatcherMotion } from '../src/world/hollow/watcher-motion.js';
import { createWatcherPass } from './arena/watcher-pass.js';

const DEG = Math.PI / 180;

/**
 * @param {{ device: GPUDevice, format: GPUTextureFormat }} gpu @param {any} K recipes/world/hollow.json foes.watcher
 */
export async function createWatcherStand(gpu, K) {
  const model = await loadWatcherModel(new URL('../assets/models/hollow/watcher.glb', import.meta.url));
  const pass = await createWatcherPass(gpu, model, K.stone);
  const foe = { x: 0, z: 0, yaw: 0, step: 'rest', t: 0, stunS: 0, broken: false, hits: { front: 0, side: 0, back: 0 }, lureS: 0, unmade: false };
  let cues = 0;
  const make = () => createWatcherMotion(foe, model, K, 1, (c) => { if (c === 'call') cues++; });
  let motion = make();
  /** Each act: a loop of [step, seconds, what happens through it]. */
  const ACTS = /** @type {Record<string, [string, number, string?][]>} */ ({
    rest: [['rest', 8]],
    notice: [['rest', 2, 'away'], ['notice', 0.3], ['close', 4.5]],
    tell: [['close', 1.2], ['wind', K.windS], ['recover', 1.6, 'quiet']],
    call: [['close', 1.2], ['wind', K.windS], ['strike', K.strikeS], ['recover', K.recoverS]],
    snuff: [['close', 1.2], ['wind', 0.8], ['rest', 3.5, 'snuff']],
    unmade: [['close', 5, 'unmade']],
    lure: [['rest', 7, 'moths']],
    drift: [['close', 8, 'drift']],
    hit: [['rest', 1, 'hit'], ['rest', 1.4]],
    break: [['rest', 1, 'mend'], ['broken', 4, 'break']],
  });
  let act = 'rest', actT = 0, part = -1, circleA = 0, eye = [0, 1.6, 2.4], snuffed = false, mothA = 0;

  /** Start an act's part: its step, and what happens. @param {[string, number, string?]} p */
  function start(p) {
    foe.step = p[0]; foe.t = 0;
    const what = p[2];
    snuffed = what === 'snuff';
    foe.unmade = what === 'unmade';
    if (what === 'away') foe.yaw = Math.atan2(eye[0], eye[2]) + Math.PI * 0.75;
    if (what === 'hit') foe.hits.front++;
    if (what === 'mend' && foe.broken) { foe.broken = false; Object.assign(foe, { x: 0, z: 0 }); motion = make(); }
    if (what === 'break') foe.broken = true;
  }

  return {
    model, pass, foe, get motion() { return motion; }, get cues() { return cues; },
    /** @param {string} a */
    set(a) {
      act = a; actT = 0; part = -1;
      if (foe.broken) { foe.broken = false; motion = make(); }
      Object.assign(foe, { x: 0, z: 0, step: 'rest', t: 0, lureS: 0, unmade: false });
      snuffed = false;
    },
    get act() { return act; },
    /** The lantern is snuffed in this part of the loop. */
    get snuffed() { return snuffed; },
    /**
     * One step: the loop, then the motion. @param {number} dt @param {number} clock @param {number[]} at where the view is (you, holding the lantern)
     */
    tick(dt, clock, at) {
      eye = at;
      const loop = ACTS[act], total = loop.reduce((n, s) => n + s[1], 0);
      actT += dt;
      if (actT >= total) { actT -= total; part = -1; if (act !== 'break') Object.assign(foe, { x: 0, z: 0 }); }
      let rest = actT, i = 0;
      while (i < loop.length - 1 && rest >= loop[i][1]) { rest -= loop[i][1]; i++; }
      if (i !== part) { part = i; start(loop[i]); }
      foe.t = rest;
      const what = loop[i][2];
      /** Turn toward a heading at most degPerS. @param {number} want @param {number} degPerS */
      const turn = (want, degPerS) => { const d = Math.atan2(Math.sin(want - foe.yaw), Math.cos(want - foe.yaw)); foe.yaw += Math.max(-degPerS * DEG * dt, Math.min(degPerS * DEG * dt, d)); };
      const toLamp = Math.atan2(eye[0] - foe.x, eye[2] - foe.z);
      let lamp = { x: eye[0], z: eye[2], y: eye[1], snuffed };
      foe.lureS = 0;
      if (what === 'drift') {
        // Drifting round a small ring, facing its way, so the weed streams back.
        circleA += dt * K.closeMps * 1.4 / 0.6;
        foe.x = Math.sin(circleA) * 0.6; foe.z = Math.cos(circleA) * 0.6 - 0.6; turn(circleA + Math.PI / 2, K.turnDegPerS * 2);
      } else if (what === 'moths') {
        // Moths drifting round to its side: it turns to follow them.
        mothA += dt * 0.5;
        const mx = Math.sin(mothA) * 1.6, mz = Math.cos(mothA) * 0.8 - 0.4;
        foe.lureS = 1;
        turn(Math.atan2(mx - foe.x, mz - foe.z), K.turnDegPerS * 1.5);
        lamp = { x: mx, z: mz, y: K.stone.motion.hoverM, snuffed: false };
        const b = motion.dust.bits;
        for (let k = 0; k < 2; k++) {
          const a = clock * 3 + k * 3.1;
          b.push({ x: mx + Math.sin(a) * 0.12, y: K.stone.motion.hoverM + Math.sin(a * 1.7) * 0.08, z: mz + Math.cos(a) * 0.12, vx: 0, vy: 0.05, vz: 0, age: 0, life: 0.5, size: 0.07, kind: 'mote', wob: k });
        }
      } else if (foe.step === 'close' || foe.step === 'notice' || foe.step === 'wind') turn(toLamp, K.turnDegPerS);
      else if (foe.step === 'rest' || foe.step === 'recover') turn(foe.yaw + 1, K.turnDegPerS * (foe.step === 'rest' ? 0.25 : 0.5));
      motion.update(dt, clock, { ground: () => 0, you: { x: eye[0], z: eye[2] }, lamp });
      pass.set([motion]);
    },
    /** Where the view aims: the stone's middle, eased by the page. */
    aim() { return [foe.x, K.stone.motion.hoverM - 0.12, foe.z]; },
  };
}

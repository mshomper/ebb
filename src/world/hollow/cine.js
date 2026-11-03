// @ts-check
// The beats of the Hollow's moves (the moves' cinematic pass, November 3, 2026; doc 16, How the moves
// look): each move's wind-up, release, impact and end, and its own moments (Anchor's catch, a thing
// tripping on Groundline, a root bursting), each played through the camera (cine-camera.js), the
// fight's clock (cine-time.js) and the lantern (cine-light.js) from its block in
// recipes/world/hollow-cine.json, and each sent as a sound cue (hollow:beat, no audio yet). It also
// retimes a move's clip (knots for clips.js) so the hand lets go, or the staff lands, exactly as the
// wind-up ends: the effect never leaves ahead of the body. The swing's contact has its own blocks by
// size. What a move does is moves.js; what it looks like is move-fx.js. Pure.

import { createCineCamera } from './cine-camera.js';
import { createCineTime } from './cine-time.js';
import { createCineLight } from './cine-light.js';

/**
 * A move's clip timing: a slow rise to the top of the wind-up, a near-hold, the release exactly at
 * the wind-up's end, a fast release and a follow-through to the end. Shares of the move's time
 * against shares of its clip span (clips.js knotShare). null plays evenly.
 * @param {{ windS: number, activeS: number, recoverS: number }} m the move (hollow-moves.json)
 * @param {{ release: number, hold: number, top: number, snapU: number, snapS: number } | undefined} B its body block
 * @returns {number[][] | null}
 */
export function moveKnots(m, B) {
  const total = m.windS + m.activeS + m.recoverS;
  if (!B || !(m.windS > 0) || !(total > 0)) return null;
  const uw = m.windS / total, r = B.release;
  const k = [[0, 0], [uw * (1 - B.hold), r * B.top], [uw, r]];
  if (B.snapU > 0) k.push([uw + (1 - uw) * B.snapU, r + (1 - r) * B.snapS]);
  k.push([1, 1]);
  return k;
}

/**
 * @param {any} CR recipes/world/hollow-cine.json
 * @param {any} MR recipes/world/hollow-moves.json
 * @param {{ seed?: number, emit?: (name: string, payload: any) => void }} [o]
 */
export function createCine(CR, MR, o = {}) {
  const camera = createCineCamera(CR.camera, { seed: o.seed });
  const time = createCineTime(CR.time);
  const light = createCineLight(CR.light);
  /** Sound cues sent, by move and beat (the arena's count). @type {Record<string, number>} */
  const cues = {};
  /** Moves whose holds (a held push, a held light) are up. @type {Set<string>} */
  const holding = new Set();
  const send = (/** @type {string} */ move, /** @type {string} */ beat, /** @type {any} */ p) => {
    const k = `${move}.${beat}`;
    cues[k] = (cues[k] ?? 0) + 1;
    o.emit?.('hollow:beat', { move, beat, x: p?.x, y: p?.y, z: p?.z });
  };

  /** Play one block. @param {string} key the move (for holds) @param {any} b @param {any} p { x, y, z, windS } */
  function play(key, b, p) {
    if (!b) return;
    if (b.push) camera.push(b.push);
    if (b.hold) { camera.hold(key, b.hold); holding.add(key); }
    if (b.kick) camera.kick(b.kick);
    if (b.shake) camera.shake(b.shake);
    if (b.reframe && p && Number.isFinite(p.x)) camera.reframe({ ...b.reframe, x: p.x, y: p.y ?? 0, z: p.z });
    if (b.stopS) time.hitStop(b.stopS);
    if (b.slowS) time.slow(b.slowS, b.slowRate ?? 0.5);
    if (b.gather) light.gather(b.gather.gain, b.gather.reach, b.gather.inS ?? p?.windS ?? 0.3);
    if (b.release) light.release(b.release.swell, b.release.backS, b.release.sputter);
    if (b.lightHold) { light.hold(key, b.lightHold.gain, b.lightHold.reach); holding.add(key); }
  }

  return {
    camera, time, light, cues,
    /** The clip timing for a move. @param {string} id */
    knots: (/** @type {string} */ id) => moveKnots(MR.moves[id], CR.moves[id]?.body),
    /**
     * A move's beat: wind, release, impact, end, or its own (catch, trip, spring, burst, break,
     * unsnuff, out). Returns the block (its fx, if any, is the caller's to cue), or null.
     * @param {string} id @param {string} beat @param {{ x?: number, y?: number, z?: number, windS?: number }} [p]
     */
    beat(id, beat, p) {
      const b = CR.moves[id]?.[beat] ?? null;
      play(id, b, { windS: MR.moves[id]?.windS, ...p });
      send(id, beat, p);
      return b;
    },
    /** The swing landing: glance, land or break. @param {'glance' | 'land' | 'break'} size @param {{ x: number, y: number, z: number }} p */
    contact(size, p) {
      const b = CR.contact[size];
      play('swing', b, p);
      send('swing', size, p);
      return b;
    },
    /** A move's holds let go (it ended). @param {string} id */
    end(id) { if (holding.delete(id)) { camera.letGo(id); light.letGo(id); } },
    /** Rolled out of the wind-up: the lantern comes back at once and its holds let go. @param {string} id */
    cancel(id) { light.cancel(); this.end(id); send(id, 'cancel', null); },
    /** The fight's step this frame (the hit-stop and slow-down; see cine-time.js). @param {number} realDt */
    step: (/** @type {number} */ realDt) => time.step(realDt),
    /**
     * The camera's offset and the lantern's shares this frame, in real time.
     * @param {number} realDt @param {ArrayLike<number>} target the camera's own aim point
     */
    update(realDt, target) { return { offset: camera.update(realDt, target), light: light.update(realDt) }; },
    clear() { camera.clear(); time.clear(); light.clear(); holding.clear(); },
  };
}

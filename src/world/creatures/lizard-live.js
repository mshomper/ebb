// @ts-check
// Common lizards, live (M2 turtle life, LZ; doc 13; doc 23 presence): each lizard sun-finds.js
// puts on a stone lies there in its sprawl, head lifting and turning in quick small jerks, flanks
// breathing, and now and then bobs through a push-up display. When you come close (a source with a
// body inside its ring, smaller if you come slowly; or an edit beside it) it darts off the stone,
// away from you, waits low a while, then comes back in short bursts and climbs up again. Its pose
// is rigs/lizard.js.
//
// Live animation only (never saved): its own seeded stream per stone, so it does the same on every
// device for the same moves. Plain Math is fine here. Numbers from lizard.json's motion and presence.

import { stream } from '../../core/rng.js';
import { ringScale } from './presence.js';

/**
 * @typedef {{ key: string, id: number, x: number, y: number, z: number, yaw: number, home: { x: number, y: number, z: number, yaw: number, r: number },
 *   mode: 'bask'|'dart'|'hide'|'back', until: number, from: { x: number, z: number }, to: { x: number, z: number },
 *   lookTo: number, lookUpTo: number, nextJerk: number, nextPush: number, pushLeft: number, pushT: number, moving: boolean, burst: number,
 *   t: number, look: number, lookUp: number, push: number, run: number, ph: number, curl: number, rng: { next: () => number } }} Lizard
 */

/**
 * @param {{ R: any, ground: (x: number, z: number) => number }} o R: lizard.json
 */
export function createLizards(o) {
  const M = o.R.motion, PR = o.R.presence;
  /** @type {Map<string, Lizard>} */ const live = new Map();
  let t = 0;
  const range = (/** @type {{ next: () => number }} */ rng, /** @type {number[]} */ r) => r[0] + (r[1] - r[0]) * rng.next();

  /**
   * A lizard on a stone, made the first time it is seen.
   * @param {string} key @param {number} seed @param {{ x: number, y: number, z: number, yaw: number, r: number }} home
   */
  function get(key, seed, home) {
    let L = live.get(key);
    if (L) return L;
    const rng = stream(seed >>> 0, 0x112a);
    L = { key, id: seed >>> 0, x: home.x, y: home.y, z: home.z, yaw: home.yaw, home, mode: 'bask', until: 0, from: { x: 0, z: 0 }, to: { x: 0, z: 0 },
      lookTo: 0, lookUpTo: 0, nextJerk: t + range(rng, M.jerkEveryS), nextPush: t + range(rng, M.pushEveryS), pushLeft: 0, pushT: 0, moving: false, burst: 0,
      t: 0, look: 0, lookUp: 0, push: 0, run: 0, ph: 0, curl: rng.next() < 0.5 ? -1 : 1, rng };
    live.set(key, L);
    return L;
  }

  /** Has something come too close? @param {Lizard} L @param {import('./presence.js').PresenceSource[]} sources */
  function threat(L, sources) {
    for (const s of sources) {
      if (s.edits.some((e) => Math.hypot(e.x - L.x, e.z - L.z) <= PR.editReachM)) return s;
      if (!s.body) continue;
      const ring = PR.ringM * (s.ringK ?? 1) * (s.speed < PR.calmSpeed ? PR.calmShare : 1) * (PR.multipliers ? ringScale(s, L.x, L.z, PR.multipliers) : 1);
      if (Math.hypot(s.pos[0] - L.x, s.pos[1] - L.y, s.pos[2] - L.z) <= ring) return s;
    }
    return null;
  }

  /** Turn toward a heading by at most rate*dt. @param {Lizard} L @param {number} to @param {number} rate @param {number} dt */
  function turn(L, to, rate, dt) {
    let d = to - L.yaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    L.yaw += Math.max(-rate * dt, Math.min(rate * dt, d));
    return Math.abs(d);
  }

  /** The height under it: the stone's top over the stone, else the ground. @param {Lizard} L @param {number} x @param {number} z */
  const heightAt = (L, x, z) => (Math.hypot(x - L.home.x, z - L.home.z) <= L.home.r ? L.home.y : o.ground(x, z));

  /** @param {Lizard} L @param {number} dt @param {import('./presence.js').PresenceSource[]} sources */
  function step(L, dt, sources) {
    L.t += dt;
    const rng = L.rng;
    // The head: a new small turn or lift every so often, reached in a snap and held.
    if (t >= L.nextJerk) {
      L.lookTo = (rng.next() * 2 - 1) * M.lookRad;
      L.lookUpTo = range(rng, M.lookUpRad);
      L.nextJerk = t + range(rng, M.jerkEveryS);
    }
    const snap = Math.min(1, dt * M.jerkHz);
    L.look += (L.lookTo - L.look) * snap;
    L.lookUp += (L.lookUpTo - L.lookUp) * snap;
    const near = L.mode !== 'dart' ? threat(L, sources) : null;
    if (near && L.mode !== 'hide') {
      // Off the stone, away from it, quick.
      const a = Math.atan2(L.x - near.pos[0], L.z - near.pos[2]) + (rng.next() - 0.5) * 0.8;
      const d = L.home.r + range(rng, M.dartM);
      L.mode = 'dart'; L.from = { x: L.x, z: L.z }; L.to = { x: L.home.x + Math.sin(a) * d, z: L.home.z + Math.cos(a) * d };
      L.push = 0; L.pushLeft = 0;
    } else if (near && L.mode === 'hide') L.until = Math.max(L.until, t + 2);
    if (L.mode === 'bask') {
      L.run += (0 - L.run) * Math.min(1, dt * 8);
      // A push-up display now and then: a few quick bobs.
      if (L.pushLeft <= 0 && t >= L.nextPush) { L.pushLeft = Math.round(range(rng, M.pushes)); L.pushT = 0; L.nextPush = t + range(rng, M.pushEveryS); }
      if (L.pushLeft > 0) {
        L.pushT += dt;
        L.push = Math.sin(Math.min(1, L.pushT / M.pushS) * Math.PI);
        if (L.pushT >= M.pushS) { L.pushLeft--; L.pushT = 0; }
      } else L.push = 0;
      L.x = L.home.x; L.y = L.home.y; L.z = L.home.z;
      turn(L, L.home.yaw, 3, dt);
      return;
    }
    if (L.mode === 'dart') {
      L.run = 1;
      L.ph += dt / M.gait.runStrideS;
      const dx = L.to.x - L.x, dz = L.to.z - L.z, d = Math.hypot(dx, dz), go = M.dartMps * dt;
      turn(L, Math.atan2(dx, dz), 20, dt);
      if (d <= go) { L.x = L.to.x; L.z = L.to.z; L.mode = 'hide'; L.until = t + range(rng, M.hideS); }
      else { L.x += (dx / d) * go; L.z += (dz / d) * go; }
      L.y = heightAt(L, L.x, L.z);
      return;
    }
    if (L.mode === 'hide') {
      L.run += (0 - L.run) * Math.min(1, dt * 10);
      L.y = heightAt(L, L.x, L.z);
      if (t >= L.until) { L.mode = 'back'; L.moving = false; L.burst = t; }
      return;
    }
    // Back to its stone in short bursts, a pause between, then up onto it.
    const dx = L.home.x - L.x, dz = L.home.z - L.z, d = Math.hypot(dx, dz);
    if (t >= L.burst) { L.moving = !L.moving; L.burst = t + range(rng, L.moving ? M.burstS : M.pauseS); }
    if (L.moving) {
      L.run += (1 - L.run) * Math.min(1, dt * 10);
      L.ph += dt / M.gait.walkStrideS;
      turn(L, Math.atan2(dx, dz), 8, dt);
      const go = Math.min(d, M.walkMps * dt);
      L.x += Math.sin(L.yaw) * go; L.z += Math.cos(L.yaw) * go;
    } else L.run += (0 - L.run) * Math.min(1, dt * 12);
    L.y += (heightAt(L, L.x, L.z) - L.y) * Math.min(1, dt * 10);
    if (d < 0.02) { L.mode = 'bask'; L.run = 0; }
  }

  return {
    get,
    /**
     * Step the lizards on these stones; any not among them are gone (in for the day).
     * @param {number} dt @param {Set<string>} keep @param {import('./presence.js').PresenceSource[]} sources
     */
    step(dt, keep, sources) {
      t += dt;
      for (const k of [...live.keys()]) if (!keep.has(k)) live.delete(k);
      for (const L of live.values()) step(L, dt, sources);
    },
    /** The live lizards (tools and tests). */
    all: () => [...live.values()],
  };
}

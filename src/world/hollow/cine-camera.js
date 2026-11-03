// @ts-check
// The camera takes part in the Hollow's moves (the moves' cinematic pass, November 3, 2026; doc 16,
// How the moves look). Four things, summed into one passing offset that the camera lays over its own
// view each frame (src/render/camera.js setOffset) and never keeps:
//   push:    ease in (or pull back) over a wind-up, hold, ease back; distance and tilt
//   kick:    a jolt on release or contact, a damped spring that springs back on its own
//   shake:   trauma sized to the hit, decaying; the shake is trauma squared, on smooth seeded noise,
//            so it is never a buzz and dies away quickly
//   reframe: for the big moves, the aim point slides part way toward the effect, holds, and settles
// amount (the "Camera motion" setting, 0 off to 1 full) scales all four. Real time throughout: a
// hit-stop never freezes the camera. Numbers in recipes/world/hollow-cine.json camera. Pure.

import { hash32 } from '../../core/rng.js';

const DEG = Math.PI / 180;
const smooth = (/** @type {number} */ t) => { const k = Math.min(1, Math.max(0, t)); return k * k * (3 - 2 * k); };

/** @typedef {{ distM?: number, pitchDeg?: number, inS: number, holdS: number, outS: number }} Push */
/** @typedef {{ distM?: number, pitchDeg?: number, yawDeg?: number }} Kick */
/** @typedef {{ x: number, y: number, z: number, weight: number, inS: number, holdS: number, outS: number }} Reframe */

/**
 * @param {{ amount: number, kick: { stiffness: number, damping: number }, shake: { maxPitchDeg: number, maxYawDeg: number, maxEyeM: number, hz: number, decayPerS: number } }} C
 *   recipes/world/hollow-cine.json camera
 * @param {{ seed?: number }} [o]
 */
export function createCineCamera(C, o = {}) {
  const seed = (o.seed ?? 7) >>> 0;
  let clock = 0, trauma = 0;
  /** @type {(Push & { t: number })[]} */ let pushes = [];
  /** @type {(Reframe & { t: number })[]} */ let frames = [];
  /** The kick's spring: distance (m), pitch and yaw (rad), each a value and a speed. */
  const spring = { d: 0, dv: 0, p: 0, pv: 0, y: 0, yv: 0 };
  /** Holds of a push until let go (Snuff keeps the view close while it lasts), by key. @type {Map<string, Push & { t: number, letGo: boolean }>} */
  const held = new Map();
  /** Smooth seeded noise, -1..1, on axis a at time t (s). @param {number} a @param {number} t */
  const noise = (a, t) => {
    const x = t * C.shake.hz, i = Math.floor(x), f = x - i, k = f * f * (3 - 2 * f);
    const h = (/** @type {number} */ n) => hash32(seed + a * 7919, n) / 2147483648 - 1;
    return h(i) + (h(i + 1) - h(i)) * k;
  };
  /** A push's share now: in, hold, out. @param {Push & { t: number }} p */
  const pushK = (p) => (p.t < p.inS ? smooth(p.t / Math.max(1e-3, p.inS)) : p.t < p.inS + p.holdS ? 1 : 1 - smooth((p.t - p.inS - p.holdS) / Math.max(1e-3, p.outS)));
  const out = { distM: 0, pitch: 0, yaw: 0, target: [0, 0, 0], eye: [0, 0, 0] };

  return {
    /** Ease in or pull back (distM negative is closer), hold, then ease back. @param {Push} p */
    push(p) { pushes.push({ ...p, t: 0 }); },
    /** A push that holds until let go (Snuff). @param {string} key @param {{ distM?: number, pitchDeg?: number, inS: number, outS: number }} p */
    hold(key, p) { held.set(key, { ...p, holdS: Infinity, t: 0, letGo: false }); },
    /** Let a held push ease back. @param {string} key */
    letGo(key) { const h = held.get(key); if (h && !h.letGo) { h.letGo = true; h.holdS = Math.max(0, h.t - h.inS); } },
    /** A jolt: the spring is given this much speed at once (its own sizes, per second of spring). @param {Kick} k */
    kick(k) {
      const w = Math.sqrt(C.kick.stiffness);
      spring.dv += (k.distM ?? 0) * w; spring.pv += (k.pitchDeg ?? 0) * DEG * w; spring.yv += (k.yawDeg ?? 0) * DEG * w;
    },
    /** Shake by trauma (0..1, adds up to 1). @param {number} t */
    shake(t) { trauma = Math.min(1, trauma + Math.max(0, t)); },
    /** Slide the aim toward a point and back. @param {Reframe} r */
    reframe(r) { frames.push({ ...r, t: 0 }); },
    /** How much shake is in hand now (0..1), for the panel. */
    get trauma() { return trauma; },
    /**
     * Step on in real time and hand back the offset for camera.setOffset.
     * @param {number} dt real seconds @param {ArrayLike<number>} target the camera's own aim point now
     * @returns {{ distM: number, pitch: number, yaw: number, target: number[], eye: number[] }}
     */
    update(dt, target) {
      clock += dt;
      for (const p of pushes) p.t += dt;
      pushes = pushes.filter((p) => p.t < p.inS + p.holdS + p.outS);
      for (const [k, h] of held) { h.t += dt; if (h.letGo && h.t >= h.inS + h.holdS + h.outS) held.delete(k); }
      for (const f of frames) f.t += dt;
      frames = frames.filter((f) => f.t < f.inS + f.holdS + f.outS);
      // The kick's spring, stepped in small pieces so a long frame stays steady.
      const K = C.kick, n = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / n;
      for (let i = 0; i < n; i++) {
        spring.dv += (-K.stiffness * spring.d - K.damping * spring.dv) * h; spring.d += spring.dv * h;
        spring.pv += (-K.stiffness * spring.p - K.damping * spring.pv) * h; spring.p += spring.pv * h;
        spring.yv += (-K.stiffness * spring.y - K.damping * spring.yv) * h; spring.y += spring.yv * h;
      }
      trauma = Math.max(0, trauma - C.shake.decayPerS * dt);
      const a = Math.max(0, C.amount);
      let d = spring.d, p = spring.p;
      for (const q of [...pushes, ...held.values()]) { const k = pushK(q); d += (q.distM ?? 0) * k; p += (q.pitchDeg ?? 0) * DEG * k; }
      const s = trauma * trauma, S = C.shake;
      out.distM = d * a;
      out.pitch = (p + noise(1, clock) * S.maxPitchDeg * DEG * s) * a;
      out.yaw = (spring.y + noise(2, clock) * S.maxYawDeg * DEG * s) * a;
      out.eye[0] = noise(3, clock) * S.maxEyeM * s * a; out.eye[1] = noise(4, clock) * S.maxEyeM * s * a; out.eye[2] = noise(5, clock) * S.maxEyeM * s * a;
      out.target[0] = out.target[1] = out.target[2] = 0;
      for (const f of frames) {
        const k = pushK(f) * f.weight * Math.min(1, a);
        out.target[0] += (f.x - target[0]) * k; out.target[1] += (f.y - target[1]) * k; out.target[2] += (f.z - target[2]) * k;
      }
      return out;
    },
    /** Everything still (a new floor). */
    clear() { pushes = []; frames = []; held.clear(); trauma = 0; Object.assign(spring, { d: 0, dv: 0, p: 0, pv: 0, y: 0, yv: 0 }); },
  };
}

// @ts-check
// The walker's feet (doc 23, W5): where each foot goes, never sliding. Walking, the stride is
// driven by distance (a phase that moves on by speed over stride length), so a planted foot stays
// put while the body passes over it at any speed. Standing, each foot is pinned to the ground where
// it landed and only steps (a small lifted arc, one foot at a time) when the body has turned or
// shifted too far from it: that is turning on the spot, and the closing step when you stop.
// Pure; live animation only.

import { lerp, smooth, DEG } from './kinematics.js';

/**
 * The pace now, blended from the recipe's paces by speed, then toward wading by the water's depth.
 * @param {any} G recipes/world/figure.json gait @param {number} speed m/s @param {number} wade 0..1
 */
export function paceAt(G, speed, wade) {
  const P = G.paces;
  let a = P[0], b = P[0], t = 0;
  if (speed >= P[P.length - 1].speed) { a = b = P[P.length - 1]; }
  else {
    for (let i = 1; i < P.length; i++) {
      if (speed <= P[i].speed) { a = P[i - 1]; b = P[i]; t = Math.max(0, (speed - a.speed) / (b.speed - a.speed)); break; }
    }
  }
  /** @type {Record<string, number>} */ const out = {};
  for (const k of Object.keys(a)) out[k] = lerp(a[k], b[k], t);
  const W = G.wade;
  out.stepM *= lerp(1, W.stepScale, wade);
  out.liftM = lerp(out.liftM, W.liftM, wade);
  out.elbowDeg = lerp(out.elbowDeg, W.elbowDeg, wade);
  out.leanDeg = lerp(out.leanDeg, W.leanDeg, wade);
  out.armOutDeg = W.armOutDeg * wade;
  return out;
}

/**
 * One foot in the walking cycle at local phase p (0 lands, stance until `stance`, then the swing).
 * fz: forward of its rest spot (m); lift: off the ground (m); pitch: toe up (radians); down: planted.
 * @param {number} p 0..1 @param {number} stance share of the cycle down @param {number} stepM @param {number} liftM
 */
export function footInCycle(p, stance, stepM, liftM) {
  const reach = stance * stepM;
  if (p < stance) {
    const u = p / stance;
    const pitch = u > 0.7 ? -((u - 0.7) / 0.3) * 0.45 : 0;
    return { fz: reach * (1 - 2 * u), lift: 0.12 * Math.sin(-pitch), pitch, down: true };
  }
  const v = (p - stance) / (1 - stance), e = smooth(v);
  return { fz: reach * (-1 + 2 * e), lift: liftM * Math.sin(Math.PI * v), pitch: -0.45 + 0.6 * v, down: false };
}

/**
 * Pinned feet for standing: each holds a world spot and steps to its rest spot when it drifts too far.
 * @param {any} G recipes/world/figure.json gait
 */
export function createPlantedFeet(G) {
  /** @type {{ x: number, z: number, yaw: number, from: number[] | null, to: number[] | null, yaw0: number, t: number }[]} */
  const feet = [0, 1].map(() => ({ x: 0, z: 0, yaw: 0, from: null, to: null, yaw0: 0, t: 0 }));
  const turn = (/** @type {number} */ a) => Math.atan2(Math.sin(a), Math.cos(a));
  return {
    /** Pin both feet where they are now (world x, z) and facing yaw. @param {number[][]} at @param {number} yaw */
    pin(at, yaw) {
      at.forEach((p, i) => Object.assign(feet[i], { x: p[0], z: p[1], yaw, from: null, to: null, t: 0 }));
    },
    /** Is a foot in the air? */
    get stepping() { return feet.some((f) => f.to); },
    /**
     * Step time. rest: each foot's rest spot in the world now; bodyYaw: the body's facing. Returns
     * each foot's world spot, facing and lift (m), and which just landed.
     * @param {number} dt @param {number[][]} rest @param {number} bodyYaw
     */
    update(dt, rest, bodyYaw) {
      if (!feet.some((f) => f.to)) {
        // The foot furthest from where it belongs steps first; one at a time.
        let worst = -1, most = 0;
        feet.forEach((f, i) => {
          const off = Math.hypot(f.x - rest[i][0], f.z - rest[i][1]);
          const need = Math.max(off / G.plantStepM, Math.abs(turn(bodyYaw - f.yaw)) / (G.plantStepDeg * DEG));
          if (need > 1 && need > most) { most = need; worst = i; }
        });
        if (worst >= 0) Object.assign(feet[worst], { from: [feet[worst].x, feet[worst].z], to: rest[worst].slice(), yaw0: feet[worst].yaw, t: 0 });
      }
      const landed = [false, false];
      const out = feet.map((f, i) => {
        if (!f.to || !f.from) return { x: f.x, z: f.z, yaw: f.yaw, lift: 0 };
        f.t = Math.min(1, f.t + dt / G.plantStepS);
        // The landing spot follows the body while the foot is in the air.
        f.to = rest[i].slice();
        const e = smooth(f.t);
        f.x = lerp(f.from[0], f.to[0], e);
        f.z = lerp(f.from[1], f.to[1], e);
        f.yaw = f.yaw0 + turn(bodyYaw - f.yaw0) * e;
        const lift = 0.045 * Math.sin(Math.PI * f.t);
        if (f.t >= 1) { f.from = f.to = null; landed[i] = true; }
        return { x: f.x, z: f.z, yaw: f.yaw, lift };
      });
      return { feet: out, landed };
    },
  };
}

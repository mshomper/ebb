// @ts-check
// The walker's clips (doc 23; Meshy clips, October 26, 2026): Matt's Meshy walks, runs and roll,
// retargeted onto our 20-bone rig by tools/figure-prep/clips.py (assets/figures/walker-clips.json).
// Walks and runs blend by speed, all in step: every clip is timed by its left foot's landings, so one
// stride phase drives them all, and the phase moves on by distance over each clip's own stride, so a
// planted foot stays put. The roll plays on Space in place of the code roll. motion.js lays the
// clip pose under its own layers (the feet on the real ground, the look, the springs, the postures).
// Numbers: recipes/world/figure.json clips. Pure; live animation only.

import { moveMatrix, mul } from '../creatures/pose.js';
import { smooth, lerp } from './kinematics.js';

/** @typedef {{ frames: number, dur: number, loop: boolean, speed?: number, cycleM?: number, landsL?: number[], landsR?: number[], track?: number[], data: number[] }} ClipData */
/** @typedef {{ version: number, fps: number, bones: string[], clips: Record<string, ClipData> }} ClipFile */

/** Fetch the clip file named by the recipe (a path from the repo root). @param {any} R recipes/world/figure.json */
export async function loadFigureClips(R) {
  if (!R.clips?.file) return null;
  const res = await fetch(new URL(`../../../${R.clips.file}`, import.meta.url));
  if (!res.ok) throw new Error(`figure clips ${R.clips.file}: ${res.status}`);
  return /** @type {ClipFile} */ (await res.json());
}

/**
 * One clip, ready to sample: its frames as floats (the pelvis shift, then a turn per driven bone),
 * and where its left foot lands (seconds), for the stride phase.
 * @param {ClipFile} file @param {string} name
 */
function prepare(file, name) {
  const c = file.clips[name];
  if (!c) throw new Error(`figure clips: no clip ${name}`);
  const stride = 3 + 4 * file.bones.length;
  const lands = c.landsL?.length ? c.landsL.slice().sort((a, b) => a - b) : [0];
  // The right foot lands this share of a stride after the left.
  const per = c.dur / lands.length;
  const r0 = c.landsR?.length ? c.landsR[0] : lands[0] + per / 2;
  const rShare = ((((r0 - lands[0]) % per) + per) % per) / per;
  // Without a track (the roll), the body goes evenly over the clip.
  const track = c.track ?? Array.from({ length: c.frames }, (_, i) => (i / (c.frames - 1)) * (c.cycleM ?? 1) * lands.length);
  return { name, ...c, stride, frames: new Float32Array(c.data), lands, rShare: rShare || 0.5, track };
}

/**
 * Sample a clip at time t (seconds; a loop wraps) into out (the pelvis shift, then the turns).
 * @param {ReturnType<typeof prepare>} c @param {number} t @param {Float32Array} out
 */
function sample(c, t, out) {
  const fps = (c.frames.length / c.stride - 1) / Math.max(c.dur, 1e-6);
  const n = c.frames.length / c.stride;
  let u = t * fps;
  if (c.loop) u = ((u % (n - 1)) + (n - 1)) % (n - 1);
  else u = Math.max(0, Math.min(n - 1, u));
  const i = Math.min(n - 2, Math.floor(u)), f = u - i;
  const a = i * c.stride, b = a + c.stride;
  for (let k = 0; k < 3; k++) out[k] = c.frames[a + k] * (1 - f) + c.frames[b + k] * f;
  for (let k = 3; k < c.stride; k += 4) {
    const s = c.frames[a + k] * c.frames[b + k] + c.frames[a + k + 1] * c.frames[b + k + 1] + c.frames[a + k + 2] * c.frames[b + k + 2] + c.frames[a + k + 3] * c.frames[b + k + 3] < 0 ? -1 : 1;
    let l = 0;
    for (let j = 0; j < 4; j++) { out[k + j] = c.frames[a + k + j] * (1 - f) + s * c.frames[b + k + j] * f; l += out[k + j] ** 2; }
    l = Math.sqrt(l) || 1;
    for (let j = 0; j < 4; j++) out[k + j] /= l;
  }
}

/**
 * Add w of pose p into the running sum acc (turns aligned to acc's first, so they never cancel).
 * @param {Float32Array} acc @param {Float32Array} p @param {number} w
 */
function accumulate(acc, p, w) {
  for (let k = 0; k < 3; k++) acc[k] += p[k] * w;
  for (let k = 3; k < acc.length; k += 4) {
    const d = acc[k] * p[k] + acc[k + 1] * p[k + 1] + acc[k + 2] * p[k + 2] + acc[k + 3] * p[k + 3];
    const s = d < 0 ? -w : w;
    for (let j = 0; j < 4; j++) acc[k + j] += p[k + j] * s;
  }
}

/** Divide the sum by its weight and set each turn back to unit length. @param {Float32Array} acc @param {number} w */
function settle(acc, w) {
  for (let k = 0; k < 3; k++) acc[k] /= w || 1;
  for (let k = 3; k < acc.length; k += 4) {
    const l = Math.hypot(acc[k], acc[k + 1], acc[k + 2], acc[k + 3]);
    if (l < 1e-9) { acc.set([0, 0, 0, 1], k); continue; }
    for (let j = 0; j < 4; j++) acc[k + j] /= l;
  }
}

/**
 * The clip player for the walker's rig.
 * @param {ClipFile} file @param {any} RC recipes/world/figure.json clips
 * @param {{ name: string, parent: number, pivot: number[] }[]} skeleton from rig.js
 */
export function createClipPlayer(file, RC, skeleton) {
  const I = Object.fromEntries(skeleton.map((b, i) => [b.name, i]));
  const driven = file.bones.map((n) => I[n]);
  if (driven.some((i) => i === undefined)) throw new Error('figure clips: a driven bone is not in the rig');
  /** The bone's slot in a pose (its turn's first float), by rig index. */
  const slot = new Map(driven.map((b, k) => [b, 3 + 4 * k]));
  const paces = RC.paces.map((/** @type {any} */ p) => ({ ...p, c: prepare(file, p.clip) }));
  const roll = prepare(file, RC.roll.clip);
  const size = 3 + 4 * driven.length;
  const tmp = new Float32Array(size), loco = new Float32Array(size), rollPose = new Float32Array(size);
  const pose = new Float32Array(size);
  const bones = new Float32Array(skeleton.length * 16);
  const ID = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  // Live state: the stride phase (in strides; 0 is a left foot landing), the locomotion's eased
  // weight, and the roll's tail once Space's roll is over.
  let phase = 0, walkW = 0, tailT = -1, wasRolling = false;
  /** The paces' weights by speed (piecewise between neighbours). @param {number} v body m/s */
  function weights(v) {
    const w = paces.map(() => 0);
    if (v <= paces[0].speed) w[0] = 1;
    else if (v >= paces[paces.length - 1].speed) w[paces.length - 1] = 1;
    else for (let i = 1; i < paces.length; i++) {
      if (v <= paces[i].speed) { const t = smooth((v - paces[i - 1].speed) / (paces[i].speed - paces[i - 1].speed)); w[i - 1] = 1 - t; w[i] = t; break; }
    }
    return w;
  }
  /**
   * A clip's stride at phase ph: how far its body goes (m) from one left landing to the next, and
   * where along that it is now, f of the way. @param {ReturnType<typeof prepare>} c @param {number} ph
   */
  function strideAt(c, ph) {
    const N = c.lands.length, k = ((Math.floor(ph) % N) + N) % N, f = ph - Math.floor(ph);
    const total = c.track[c.track.length - 1];
    const a = distAt(c, c.lands[k]), b = k + 1 < N ? distAt(c, c.lands[k + 1]) : distAt(c, c.lands[0]) + total;
    return { from: a, len: b - a, f, total };
  }
  /** How far the clip's body has gone at time t (its track). @param {ReturnType<typeof prepare>} c @param {number} t */
  function distAt(c, t) {
    const u = Math.max(0, Math.min(c.track.length - 1, t * (c.track.length - 1) / c.dur)), i = Math.min(c.track.length - 2, Math.floor(u));
    return c.track[i] + (c.track[i + 1] - c.track[i]) * (u - i);
  }
  /**
   * A clip's time at stride phase ph: the moment its body has gone as far as the phase says, so
   * steps of uneven length or pace keep the feet planted. @param {ReturnType<typeof prepare>} c @param {number} ph
   */
  function timeAt(c, ph) {
    const s = strideAt(c, ph), T = c.track;
    const d = (s.from + s.len * s.f) % s.total;
    let lo = 0, hi = T.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T[mid] < d) lo = mid; else hi = mid; }
    const g = T[hi] > T[lo] ? (d - T[lo]) / (T[hi] - T[lo]) : 0;
    return ((lo + g) * c.dur) / (T.length - 1);
  }

  return {
    /** The driven bones' rig indices, in pose order. */
    driven,
    /**
     * Step the clips. speed: body m/s (0 rolling); gait: 1 while the walker strides on its feet (motion.js
     * mode gait, standing), else 0; rolling: how far into a roll (0..1) or -1.
     * Returns the pose (pelvis shift, then each driven bone's turn in its parent's rest frame), its
     * weight, the stride stretch, which feet just landed, and whether the roll leads.
     * @param {number} dt @param {{ speed: number, gait: number, rolling: number }} s
     */
    update(dt, s) {
      walkW += Math.max(-dt / RC.easeS, Math.min(dt / RC.easeS, s.gait - walkW));
      const w = weights(s.speed);
      // One stride covers the blend of the paces' strides, each stretched as the recipe sets.
      let strideM = 0, stretch = 0;
      paces.forEach((p, i) => { strideM += w[i] * strideAt(p.c, phase).len * (p.stride ?? 1); stretch += w[i] * (p.stride ?? 1); });
      const before = phase;
      phase += (s.speed * dt) / Math.max(strideM, 0.05);
      const landed = [false, false];
      if (walkW > 0.5 && s.speed > 0.05) {
        const rs = paces.reduce((a, p, i) => a + w[i] * p.c.rShare, 0);
        landed[0] = Math.floor(phase) > Math.floor(before);
        landed[1] = Math.floor(phase - rs) > Math.floor(before - rs);
      }
      loco.fill(0);
      paces.forEach((p, i) => { if (w[i] > 1e-4) { sample(p.c, timeAt(p.c, phase), tmp); accumulate(loco, tmp, w[i]); } });
      settle(loco, 1);
      // The roll: blended in over the first share of Space's roll, then its getting up plays out over
      // tailS once the roll is done, blending back out.
      const RR = RC.roll;
      let rw = 0;
      if (s.rolling >= 0) {
        sample(roll, lerp(RR.span[0], RR.span[1], s.rolling), rollPose);
        rw = smooth(s.rolling / RR.inShare);
        tailT = -1;
      } else if (wasRolling || tailT >= 0) {
        tailT = wasRolling ? 0 : tailT + dt;
        const u = tailT / RR.tailS;
        if (u >= 1) tailT = -1;
        else { sample(roll, lerp(RR.span[1], roll.dur, u), rollPose); rw = 1 - smooth(u); }
      }
      wasRolling = s.rolling >= 0;
      const a = walkW * (1 - rw), total = a + rw;
      pose.fill(0);
      if (a > 0) accumulate(pose, loco, a);
      if (rw > 0) accumulate(pose, rollPose, rw);
      settle(pose, total);
      return { pose, weight: Math.min(1, total), roll: rw, stretch: lerp(1, stretch, a / (total || 1)), landed, phase };
    },
    /**
     * The clip pose's own bones (body space, 16 floats each; undriven bones follow their parents), for
     * where its feet and knees are. @param {Float32Array} p a pose from update
     */
    pose(p) {
      skeleton.forEach((b, i) => {
        const k = slot.get(i), o = i * 16;
        const mv = k === undefined ? null : { q: [p[k], p[k + 1], p[k + 2], p[k + 3]], t: b.parent < 0 ? [p[0], p[1], p[2]] : undefined };
        const local = mv ? moveMatrix(b.pivot, mv) : null;
        if (b.parent < 0) bones.set(local ?? ID, o);
        else if (local) mul(bones.subarray(b.parent * 16, b.parent * 16 + 16), local, bones, o);
        else bones.set(bones.subarray(b.parent * 16, b.parent * 16 + 16), o);
      });
      return bones;
    },
    /** A bone's turn in a pose (null for a bone the clips do not drive). @param {Float32Array} p @param {number} i rig index */
    turn(p, i) { const k = slot.get(i); return k === undefined ? null : [p[k], p[k + 1], p[k + 2], p[k + 3]]; },
    /** For tests and the tools page. */
    get phase() { return phase; },
    paces: paces.map((p) => ({ clip: p.clip, speed: p.speed, natural: p.c.speed, cycleM: p.c.cycleM })),
  };
}

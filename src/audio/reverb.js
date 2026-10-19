// @ts-check
// Procedural reverb impulses (docs 17 and 24): no files, just seeded noise shaped like a room.
// Each channel gets its own noise (decorrelated, so the tail is wide), an exponential decay, and a
// lowpass that closes over time, so highs die faster than lows the way air and soft surfaces do.
// Optional early reflections, alternating left and right, give the music room a sense of walls.
// Seeded through src/core/rng.js, never Math.random, so the room is the same on every load.

import { stream } from '../core/rng.js';

/**
 * @typedef {Object} ReverbShape
 * @property {number} decayS     seconds to fall 60 dB
 * @property {number} hfDecayS   seconds for the highs to fall 60 dB (shorter is darker)
 * @property {number} preDelayMs silence before the tail
 * @property {number} hfStartHz  lowpass cutoff at the start of the tail
 * @property {{ms: number[], gain: number[]}} [early] early reflections
 */

/**
 * Fill two Float32Arrays with a stereo impulse response.
 * @param {ReverbShape} shape
 * @param {number} sampleRate
 * @param {number} seed
 * @param {number} [lengthScale] 1 normally, 0.5 on the mobile tier
 * @returns {[Float32Array, Float32Array]}
 */
export function buildImpulse(shape, sampleRate, seed, lengthScale = 1) {
  const decayS = shape.decayS * lengthScale;
  const hfDecayS = shape.hfDecayS * lengthScale;
  const pre = Math.round((shape.preDelayMs / 1000) * sampleRate);
  const len = pre + Math.ceil(decayS * 1.1 * sampleRate);
  const out = /** @type {[Float32Array, Float32Array]} */ ([new Float32Array(len), new Float32Array(len)]);
  // -60 dB over decayS: amplitude e^(-t / tau), tau = decayS / ln(1000).
  const tau = decayS / Math.log(1000);
  const tauHf = hfDecayS / Math.log(1000);
  for (let ch = 0; ch < 2; ch++) {
    const rng = stream(seed, 7001 + ch);
    const buf = out[ch];
    let y = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sampleRate;
      // Cutoff falls from hfStartHz toward 200 Hz at the high-frequency decay rate.
      const fc = 200 + (shape.hfStartHz - 200) * Math.exp(-t / tauHf);
      const a = 1 - Math.exp((-2 * Math.PI * fc) / sampleRate);
      const x = rng.next() * 2 - 1;
      y += a * (x - y);
      // The one-pole filter loses level as it closes; scale back by sqrt of its bandwidth share
      // so the decay heard is the room's, not the filter's.
      const comp = 1 / Math.sqrt(Math.max(a / (2 - a), 1e-4));
      buf[i] = y * comp * Math.exp(-t / tau);
    }
    // A short fade-in on the tail avoids a click at its start.
    const fadeN = Math.min(len - pre, Math.round(0.004 * sampleRate));
    for (let i = 0; i < fadeN; i++) buf[pre + i] *= i / fadeN;
  }
  if (shape.early) {
    const { ms, gain } = shape.early;
    for (let k = 0; k < ms.length; k++) {
      const i = Math.round((ms[k] / 1000) * sampleRate);
      if (i >= len) continue;
      const ch = k % 2;
      out[ch][i] += gain[k] ?? 0;
      out[1 - ch][Math.min(len - 1, i + Math.round(0.0007 * sampleRate))] += (gain[k] ?? 0) * 0.5;
    }
  }
  // Normalize energy so every room sends the same loudness for the same send level.
  let e = 0;
  for (const b of out) for (let i = 0; i < b.length; i++) e += b[i] * b[i];
  const g = e > 0 ? 1 / Math.sqrt(e / 2) : 1;
  for (const b of out) for (let i = 0; i < b.length; i++) b[i] *= g * 0.5;
  return out;
}

/**
 * Make a ConvolverNode holding a procedural room.
 * @param {BaseAudioContext} ctx
 * @param {ReverbShape} shape
 * @param {number} seed
 * @param {number} [lengthScale]
 */
export function createRoom(ctx, shape, seed, lengthScale = 1) {
  const [l, r] = buildImpulse(shape, ctx.sampleRate, seed, lengthScale);
  const buf = ctx.createBuffer(2, l.length, ctx.sampleRate);
  buf.copyToChannel(l, 0);
  buf.copyToChannel(r, 1);
  const conv = ctx.createConvolver();
  conv.normalize = false;
  conv.buffer = buf;
  return conv;
}

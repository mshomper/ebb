// @ts-check
// Finishing a rendered piece for a file you can share (tools/music-render.html): trim the silence at
// both ends (keeping the room's tail after the last note, with a short fade), measure the loudness
// the way streaming services do (ITU-R BS.1770-4: K-weighting, 400 ms blocks, absolute and relative
// gates) and set it to a target with the peaks kept under a ceiling, then write a WAV file.
// Pure functions on Float32Array channels, so the Node tests (tools/run-audio-tests.mjs) can run them.

/**
 * K-weighting as two biquads (BS.1770-4: a high shelf near 1.7 kHz, then a high pass near 38 Hz),
 * designed for any sample rate the way libebur128 does; at 48 kHz these are the standard's numbers.
 * @param {number} sr sample rate
 * @returns {{b: number[], a: number[]}[]}
 */
export function kWeighting(sr) {
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan(Math.PI * f0 / sr);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = {
    b: [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0],
    a: [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0],
  };
  f0 = 38.13547087602444; Q = 0.5003270373238773;
  K = Math.tan(Math.PI * f0 / sr);
  a0 = 1 + K / Q + K * K;
  const highPass = { b: [1, -2, 1], a: [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
  return [shelf, highPass];
}

/** One channel through a chain of biquads (direct form I). @param {Float32Array} x @param {{b: number[], a: number[]}[]} chain */
function filter(x, chain) {
  let y = Float64Array.from(x);
  for (const { b, a } of chain) {
    const out = new Float64Array(y.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < y.length; i++) {
      const v = y[i];
      const o = b[0] * v + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = o; out[i] = o;
    }
    y = out;
  }
  return y;
}

/**
 * Integrated loudness in LUFS (BS.1770-4), for mono or stereo (both channels weighted 1).
 * Returns -Infinity for silence or audio shorter than one 400 ms block.
 * @param {Float32Array[]} channels @param {number} sr
 */
export function integratedLufs(channels, sr) {
  const chain = kWeighting(sr);
  const weighted = channels.map((c) => filter(c, chain));
  const block = Math.round(0.4 * sr), step = Math.round(0.1 * sr);
  const n = channels[0].length;
  if (n < block) return -Infinity;
  // Running sums of squares per channel, so each block's mean square is two lookups.
  const cums = weighted.map((w) => {
    const c = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) c[i + 1] = c[i] + w[i] * w[i];
    return c;
  });
  /** @type {number[]} */
  const z = [];
  for (let s = 0; s + block <= n; s += step) {
    let sum = 0;
    for (const c of cums) sum += (c[s + block] - c[s]) / block;
    z.push(sum);
  }
  const lufs = (/** @type {number} */ v) => -0.691 + 10 * Math.log10(v);
  const mean = (/** @type {number[]} */ a) => a.reduce((p, v) => p + v, 0) / a.length;
  const aboveAbs = z.filter((v) => lufs(v) > -70);
  if (!aboveAbs.length) return -Infinity;
  const relGate = lufs(mean(aboveAbs)) - 10;
  const gated = aboveAbs.filter((v) => lufs(v) > relGate);
  return gated.length ? lufs(mean(gated)) : -Infinity;
}

/** The highest sample, as a linear amplitude. @param {Float32Array[]} channels */
export function samplePeak(channels) {
  let p = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) { const v = Math.abs(c[i]); if (v > p) p = v; }
  return p;
}

/** Linear to dB (full scale). @param {number} v */
export const toDb = (v) => 20 * Math.log10(Math.max(v, 1e-12));

/**
 * Trim the silence at both ends. The start is where the sound first rises above `floorDb` (less a
 * few milliseconds, so no attack is cut). The end is `tailS` after the music's last sound (`lastS`,
 * from the performance: the last note or pedal release), or sooner if the room has already gone
 * quiet, with the last `fadeS` faded out.
 * @param {Float32Array[]} channels @param {number} sr
 * @param {{lastS: number, tailS?: number, fadeS?: number, floorDb?: number, leadS?: number}} o
 * @returns {{channels: Float32Array[], startS: number, endS: number}}
 */
export function trim(channels, sr, o) {
  const tailS = o.tailS ?? 2.75, fadeS = o.fadeS ?? 0.3, leadS = o.leadS ?? 0.01;
  const floor = Math.pow(10, (o.floorDb ?? -60) / 20);
  const n = channels[0].length;
  const loud = (/** @type {number} */ i) => channels.some((c) => Math.abs(c[i]) > floor);
  let first = 0;
  while (first < n && !loud(first)) first++;
  if (first >= n) return { channels: channels.map(() => new Float32Array(0)), startS: 0, endS: 0 };
  let lastLoud = n - 1;
  while (lastLoud > first && !loud(lastLoud)) lastLoud--;
  const start = Math.max(0, first - Math.round(leadS * sr));
  const end = Math.min(n, Math.round((o.lastS + tailS) * sr), lastLoud + Math.round(fadeS * sr) + 1);
  const len = Math.max(0, end - start), fade = Math.min(len, Math.round(fadeS * sr));
  const out = channels.map((c) => {
    const d = c.slice(start, end);
    // A raised-cosine fade over the last fadeS.
    for (let i = 0; i < fade; i++) d[len - fade + i] *= 0.5 + 0.5 * Math.cos(Math.PI * (i + 1) / fade);
    return d;
  });
  return { channels: out, startS: start / sr, endS: end / sr };
}

/**
 * Set the loudness to `targetLufs`, then lower it if the peak would pass `ceilingDb`.
 * @param {Float32Array[]} channels @param {number} sr
 * @param {{targetLufs?: number, ceilingDb?: number}} [o]
 * @returns {{channels: Float32Array[], before: number, after: number, peakDb: number, gainDb: number, peakLimited: boolean}}
 */
export function normalize(channels, sr, o = {}) {
  const target = o.targetLufs ?? -18, ceiling = o.ceilingDb ?? -1.5;
  const before = integratedLufs(channels, sr);
  const peak = samplePeak(channels);
  let gainDb = Number.isFinite(before) ? target - before : 0;
  const peakLimited = toDb(peak) + gainDb > ceiling;
  if (peakLimited) gainDb = ceiling - toDb(peak);
  const g = Math.pow(10, gainDb / 20);
  const out = channels.map((c) => c.map((v) => v * g));
  return { channels: out, before, after: before + gainDb, peakDb: toDb(peak) + gainDb, gainDb, peakLimited };
}

/**
 * A PCM WAV file (16 or 24 bit), channels interleaved.
 * @param {Float32Array[]} channels @param {number} sr @param {16|24} [bits]
 * @returns {ArrayBuffer}
 */
export function encodeWav(channels, sr, bits = 24) {
  const nc = channels.length, n = channels[0].length, bps = bits / 8;
  const dataBytes = n * nc * bps;
  const buf = new ArrayBuffer(44 + dataBytes), v = new DataView(buf), u8 = new Uint8Array(buf);
  const text = (/** @type {number} */ o, /** @type {string} */ s) => { for (let i = 0; i < s.length; i++) u8[o + i] = s.charCodeAt(i); };
  text(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true); text(8, 'WAVE');
  text(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nc, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * nc * bps, true); v.setUint16(32, nc * bps, true); v.setUint16(34, bits, true);
  text(36, 'data'); v.setUint32(40, dataBytes, true);
  const full = bits === 24 ? 8388607 : 32767;
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nc; c++) {
      const s = Math.round(Math.max(-1, Math.min(1, channels[c][i])) * full);
      if (bits === 24) { u8[o] = s & 0xff; u8[o + 1] = (s >> 8) & 0xff; u8[o + 2] = (s >> 16) & 0xff; o += 3; }
      else { v.setInt16(o, s, true); o += 2; }
    }
  }
  return buf;
}

/**
 * The file name: ebb-spring-nocturne-seed4-the-stone-turns.wav (weather added when not clear).
 * @param {{season: string, slot: string, seed: number, weather?: string, title: string}} o
 */
export function wavName(o) {
  const slug = o.title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const w = o.weather && o.weather !== 'clear' ? `-${o.weather}` : '';
  return `ebb-${o.season}-${o.slot}${w}-seed${o.seed}-${slug || 'piece'}.wav`;
}

// @ts-check
// Small island one-shots made in code (doc 25, "Procedural sounds"), the fallbacks and variety
// layers under the recordings. Water by bubble resonance: a damped sine at the Minnaert
// frequency of the bubble (f = 3.26 / r Hz, r in meters) with the short upward glide real drops
// have (van den Doel 2005). Knocks by modal synthesis: a few decaying resonances, struck. Ticks
// and crackles as short noise impulses shaped by a filter. Every envelope starts and ends at
// zero, so nothing clicks that should not. Numbers come from recipes/audio/procedural.json.
// Variation comes from the caller's seeded stream; the shared noise buffers from recipe.seed.

import { stream } from '../../core/rng.js';

/** @typedef {{next(): number, range(a: number, b: number): number, int(n: number): number}} Rng */

/** @param {number} db */
export const dbToGain = (db) => Math.pow(10, db / 20);
/** @param {Rng} rng @param {number[]} ab */
const pick = (rng, ab) => rng.range(ab[0], ab[1]);
/** @param {Rng} rng @param {number[]} ab integer in [a, b] */
const pickInt = (rng, ab) => ab[0] + rng.int(ab[1] - ab[0] + 1);
/** @param {Rng} rng @param {number} j multiply by e^±j */
const jit = (rng, j) => Math.exp(rng.range(-j, j));

// ---------------------------------------------------------------------------
// Generated buffers, made once per context and seed.

/** @type {WeakMap<BaseAudioContext, Map<string, AudioBuffer>>} */
const cache = new WeakMap();

/**
 * @param {BaseAudioContext} ctx @param {string} key @param {() => AudioBuffer} make
 * @returns {AudioBuffer}
 */
function cached(ctx, key, make) {
  let m = cache.get(ctx);
  if (!m) cache.set(ctx, (m = new Map()));
  let b = m.get(key);
  if (!b) m.set(key, (b = make()));
  return b;
}

/** Mono white noise for excitations; one-shots start it at a seeded offset. @param {BaseAudioContext} ctx @param {any} recipe */
export function whiteBuffer(ctx, recipe) {
  const n = recipe.noise;
  return cached(ctx, `white:${recipe.seed}`, () => {
    const len = Math.ceil(n.shotSeconds * ctx.sampleRate);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    const r = stream(recipe.seed, 11);
    for (let i = 0; i < len; i++) d[i] = r.next() * 2 - 1;
    return b;
  });
}

/**
 * Stereo pink noise for beds: decorrelated channels, a non-integer length in seconds, and an
 * equal-power crossfade of its own tail into its head so the loop seam is continuous.
 * 'full' is the full-band loop at the context rate; 'low' is a much longer loop at a low sample
 * rate for layers that live under a few kHz (wind body, lap), so its repeat is far apart.
 * @param {BaseAudioContext} ctx @param {any} recipe @param {'full'|'low'} [band]
 */
export function pinkBuffer(ctx, recipe, band = 'full') {
  const n = recipe.noise;
  return cached(ctx, `pink-${band}:${recipe.seed}`, () => {
    const sr = band === 'low' ? n.lowRate : ctx.sampleRate;
    const len = Math.round((band === 'low' ? n.lowSeconds : n.bedSeconds) * sr);
    const x = Math.round((n.seamMs / 1000) * sr);
    const b = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const r = stream(recipe.seed, (band === 'low' ? 41 : 21) + ch);
      const a = new Float32Array(len + x);
      // Paul Kellet's refined pink filter.
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, e = 0;
      for (let i = 0; i < len + x; i++) {
        const w = r.next() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        a[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
        b6 = w * 0.115926;
      }
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        if (i < x) {
          const p = (i / x) * Math.PI * 0.5;
          d[i] = a[i] * Math.sin(p) + a[len + i] * Math.cos(p);
        } else d[i] = a[i];
        e += d[i] * d[i];
      }
      const g = n.bedRms / Math.sqrt(e / len);
      for (let i = 0; i < len; i++) d[i] *= g;
    }
    return b;
  });
}

/**
 * A smooth random curve through seeded knots (periodic Catmull-Rom), as a function of x in [0, 1).
 * @param {Rng} rng @param {number} knots
 * @returns {(x: number) => number} values in about [-1, 1]
 */
export function smoothRandom(rng, knots) {
  const k = Array.from({ length: knots }, () => rng.next() * 2 - 1);
  return (x) => {
    const u = (((x % 1) + 1) % 1) * knots;
    const i = Math.floor(u), t = u - i;
    const p0 = k[(i - 1 + knots) % knots], p1 = k[i % knots], p2 = k[(i + 1) % knots], p3 = k[(i + 2) % knots];
    return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
  };
}

/** Slow seeded wander for bed modulation: a looped mono curve at a low sample rate. @param {BaseAudioContext} ctx @param {any} recipe */
export function controlBuffer(ctx, recipe) {
  const n = recipe.noise;
  return cached(ctx, `ctl:${recipe.seed}`, () => {
    const sr = 3000, len = Math.round(n.controlSeconds * sr);
    const b = ctx.createBuffer(1, len, sr);
    const d = b.getChannelData(0);
    const f = smoothRandom(stream(recipe.seed, 31), Math.round(n.controlSeconds / n.controlKnotS));
    let peak = 1e-9;
    for (let i = 0; i < len; i++) { d[i] = f(i / len); peak = Math.max(peak, Math.abs(d[i])); }
    for (let i = 0; i < len; i++) d[i] /= peak;
    return b;
  });
}

// ---------------------------------------------------------------------------
// Shot plumbing: one output gain per shot, disconnected when its last source ends.

/** @param {BaseAudioContext} ctx @param {AudioNode} dest @param {number} [when] @param {number} [gainDb] */
function shot(ctx, dest, when, gainDb = 0) {
  const out = ctx.createGain();
  out.gain.value = dbToGain(gainDb);
  out.connect(dest);
  let live = 0;
  /** @template {AudioScheduledSourceNode} T @param {T} src @returns {T} */
  const own = (src) => {
    live++;
    src.onended = () => { if (--live === 0) out.disconnect(); };
    return src;
  };
  return { out, own, t: Math.max(when ?? ctx.currentTime, ctx.currentTime) };
}

/**
 * One bubble: damped sine at the Minnaert frequency with a linear upward glide.
 * @param {BaseAudioContext} ctx @param {ReturnType<typeof shot>} s @param {number} t
 * @param {number} rMm bubble radius in mm @param {number} peak linear @param {any} p bubble params @param {Rng} rng
 */
function bubble(ctx, s, t, rMm, peak, p, rng) {
  const f0 = Math.min(3.26 / (rMm / 1000), ctx.sampleRate * 0.3);
  // Damping of a bubble (van den Doel 2005), in 1/s, scaled to taste.
  const d = (0.043 * f0 + 0.0014 * Math.pow(f0, 1.5)) * p.dampingScale * jit(rng, p.decayJitter);
  const tau = 1 / d, att = p.attackMs / 1000;
  const osc = s.own(ctx.createOscillator());
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.linearRampToValueAtTime(f0 * (1 + pick(rng, p.rise)), t + pick(rng, p.glideMs) / 1000);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + att);
  g.gain.setTargetAtTime(0, t + att, tau);
  osc.connect(g).connect(s.out);
  osc.start(t);
  osc.stop(t + att + tau * 9);
}

/**
 * A burst of white noise, enveloped before its filters so the filters round off the edges.
 * @param {BaseAudioContext} ctx @param {any} recipe @param {ReturnType<typeof shot>} s @param {Rng} rng @param {number} t
 * @param {{hz: number, q: number, lowpassHz?: number, attackMs: number, decayMs: number, peak: number}} b decayMs is the time to fall 60 dB
 */
function noiseBurst(ctx, recipe, s, rng, t, b) {
  const buf = whiteBuffer(ctx, recipe);
  const att = b.attackMs / 1000, tau = b.decayMs / 1000 / 6.9, len = att + tau * 9;
  const src = s.own(ctx.createBufferSource());
  src.buffer = buf;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(b.peak, t + att);
  env.gain.setTargetAtTime(0, t + att, tau);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = b.hz; bp.Q.value = b.q;
  /** @type {AudioNode} */
  let last = src.connect(env).connect(bp);
  if (b.lowpassHz) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = b.lowpassHz; lp.Q.value = 0.5;
    last = last.connect(lp);
  }
  last.connect(s.out);
  src.start(t, rng.range(0, Math.max(0, buf.duration - len - 0.01)));
  src.stop(t + len + 0.01);
}

// ---------------------------------------------------------------------------
// Water.

/**
 * Drop with explicit bubble params (the beds pass their own, smaller ones).
 * @param {BaseAudioContext} ctx @param {AudioNode} dest @param {any} recipe @param {any} p @param {Rng} rng
 * @param {{when?: number, sizeMm?: number, gainDb?: number}} [o]
 */
export function dropWith(ctx, dest, recipe, p, rng, o = {}) {
  const s = shot(ctx, dest, o.when, o.gainDb);
  const r = (o.sizeMm ?? p.sizeMm) * jit(rng, p.sizeJitter);
  const peak = dbToGain(p.peakDb);
  bubble(ctx, s, s.t, r, peak, p, rng);
  if (p.click) {
    const c = p.click;
    noiseBurst(ctx, recipe, s, rng, s.t, { hz: c.hz, q: c.q, attackMs: c.attackMs, decayMs: c.decayMs, peak: peak * dbToGain(c.db) });
  }
  const sec = p.second;
  if (sec && rng.next() < sec.chance) {
    bubble(ctx, s, s.t + pick(rng, sec.delayMs) / 1000, r * pick(rng, sec.size), peak * dbToGain(pick(rng, sec.db)), p, rng);
  }
}

/**
 * A water drop or small plop by bubble resonance. sizeMm is the bubble radius (1 mm is about 3.3 kHz).
 * @param {BaseAudioContext} ctx @param {AudioNode} dest @param {any} recipe @param {Rng} rng
 * @param {{when?: number, sizeMm?: number, gainDb?: number}} [o]
 */
export function drop(ctx, dest, recipe, rng, o = {}) {
  dropWith(ctx, dest, recipe, recipe.drop, rng, o);
}

/**
 * A frog-sized entry: a cluster of larger bubbles, a short filtered splash, a few falling spray drops.
 * @param {BaseAudioContext} ctx @param {AudioNode} dest @param {any} recipe @param {Rng} rng
 * @param {{when?: number, sizeCm?: number, gainDb?: number}} [o]
 */
export function plop(ctx, dest, recipe, rng, o = {}) {
  const p = recipe.plop;
  const s = shot(ctx, dest, o.when, o.gainDb);
  const cm = (o.sizeCm ?? p.sizeCm) * jit(rng, p.sizeJitter);
  const scale = cm / p.sizeCm;
  const peak = dbToGain(p.peakDb);
  const B = p.bubbles;
  const n = pickInt(rng, B.count);
  const main = cm * B.mainRadiusMmPerCm;
  bubble(ctx, s, s.t + 0.002, main, peak, B, rng);
  for (let i = 1; i < n; i++) {
    const dt = pick(rng, B.spreadMs) / 1000 * Math.sqrt(scale);
    bubble(ctx, s, s.t + 0.002 + dt, main * pick(rng, B.otherSize), peak * dbToGain(pick(rng, B.db)), B, rng);
  }
  const sp = p.splash;
  noiseBurst(ctx, recipe, s, rng, s.t, {
    hz: sp.hz / Math.sqrt(scale), q: sp.q, lowpassHz: sp.lowpassHz, attackMs: sp.attackMs,
    decayMs: pick(rng, sp.decayMs) * Math.sqrt(scale), peak: peak * dbToGain(sp.db),
  });
  const sy = p.spray;
  const k = pickInt(rng, sy.count);
  for (let i = 0; i < k; i++) {
    bubble(ctx, s, s.t + pick(rng, sy.delayMs) / 1000, pick(rng, sy.sizeMm), peak * dbToGain(pick(rng, sy.db)), recipe.drop, rng);
  }
}

// ---------------------------------------------------------------------------
// Struck things: modes rung by a train of strikes, plus a filtered contact noise per strike.

/**
 * @param {Rng} rng @param {{count: number[], spacingMs: number[], shape: string, fall?: number[]}} st
 * @param {number} t0 @returns {{t: number, amp: number}[]}
 */
function strikeTimes(rng, st, t0) {
  const n = pickInt(rng, st.count);
  /** @type {{t: number, amp: number}[]} */
  const out = [];
  let t = t0, a = 1;
  for (let i = 0; i < n; i++) {
    if (st.shape === 'swell') a = 0.35 + 0.65 * Math.sin(Math.PI * (i + 0.5) / n) * rng.range(0.7, 1);
    else if (st.shape === 'random') a = rng.range(0.25, 1);
    else if (i > 0) a *= pick(rng, st.fall ?? [0.3, 0.6]);
    out.push({ t, amp: a });
    t += pick(rng, st.spacingMs) / 1000;
  }
  return out;
}

/**
 * A struck stalk or reed by modal synthesis.
 * kind: 'reed-green' | 'stalk-dry' | 'stalk-bare' | 'seed-rattle'
 * @param {BaseAudioContext} ctx @param {AudioNode} dest @param {any} recipe @param {Rng} rng
 * @param {{when?: number, kind?: string, gainDb?: number}} [o]
 */
export function knock(ctx, dest, recipe, rng, o = {}) {
  const K = recipe.knock;
  const k = K.kinds[o.kind ?? 'stalk-dry'];
  if (!k) throw new Error(`knock: unknown kind "${o.kind}"`);
  const s = shot(ctx, dest, o.when, (o.gainDb ?? 0) + (k.db ?? 0));
  const strikes = strikeTimes(rng, k.strikes, s.t);
  const peak = dbToGain(K.peakDb), att = K.attackMs / 1000;
  const end = strikes[strikes.length - 1].t + att;
  for (const m of k.modes) {
    const osc = s.own(ctx.createOscillator());
    const g = ctx.createGain();
    const base = m.hz * jit(rng, k.freqJitter);
    const tau = (m.decayMs / 1000 / 6.9) * jit(rng, k.decayJitter);
    g.gain.setValueAtTime(0, s.t);
    for (const st of strikes) {
      osc.frequency.setValueAtTime(Math.min(base * jit(rng, k.strikeJitter), ctx.sampleRate * 0.4), st.t);
      g.gain.setTargetAtTime(peak * m.amp * st.amp * jit(rng, 0.25), st.t, att / 3);
      g.gain.setTargetAtTime(0, st.t + att, tau);
    }
    osc.connect(g).connect(s.out);
    osc.start(s.t);
    osc.stop(end + tau * 9);
  }
  const c = k.contact;
  const buf = whiteBuffer(ctx, recipe);
  const src = s.own(ctx.createBufferSource());
  src.buffer = buf;
  const env = ctx.createGain();
  const ctau = c.decayMs / 1000 / 6.9;
  env.gain.setValueAtTime(0, s.t);
  for (const st of strikes) {
    env.gain.setTargetAtTime(peak * dbToGain(c.db) * st.amp, st.t, att / 3);
    env.gain.setTargetAtTime(0, st.t + att, ctau);
  }
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = c.hz * jit(rng, k.freqJitter); bp.Q.value = c.q;
  src.connect(env).connect(bp).connect(s.out);
  const len = end - s.t + ctau * 9 + 0.01;
  src.start(s.t, rng.range(0, Math.max(0, buf.duration - len - 0.01)));
  src.stop(s.t + len);
}

/**
 * A train of tiny noise impulses through a bandpass whose center moves per tick.
 * @param {BaseAudioContext} ctx @param {any} recipe @param {ReturnType<typeof shot>} s @param {Rng} rng
 * @param {{t: number, amp: number}[]} ticks @param {any} p {hz:[a,b], q, highpassHz, widthMs:[a,b]}
 */
function tickTrain(ctx, recipe, s, rng, ticks, p) {
  if (!ticks.length) return;
  const buf = whiteBuffer(ctx, recipe);
  const src = s.own(ctx.createBufferSource());
  src.buffer = buf;
  src.loop = true;
  const env = ctx.createGain();
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.Q.value = p.q;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = p.highpassHz; hp.Q.value = 0.5;
  const t0 = ticks[0].t;
  env.gain.setValueAtTime(0, t0);
  bp.frequency.setValueAtTime(pick(rng, p.hz), t0);
  let last = t0;
  for (const k of ticks) {
    const w = pick(rng, p.widthMs) / 1000;
    bp.frequency.setValueAtTime(pick(rng, p.hz), k.t);
    env.gain.setTargetAtTime(k.amp, k.t, 0.00005);
    env.gain.setTargetAtTime(0, k.t + 0.00015, w);
    last = Math.max(last, k.t + 0.00015 + w * 9);
  }
  src.connect(env).connect(bp).connect(hp).connect(s.out);
  src.start(t0, rng.range(0, buf.duration));
  src.stop(last + 0.02);
}

/**
 * Tiny ice crackles as frost meets the sun: one tick, or sometimes a small cluster.
 * @param {BaseAudioContext} ctx @param {AudioNode} dest @param {any} recipe @param {Rng} rng
 * @param {{when?: number, gainDb?: number}} [o]
 */
export function frostTick(ctx, dest, recipe, rng, o = {}) {
  const p = recipe.frostTick;
  const s = shot(ctx, dest, o.when, o.gainDb);
  const n = rng.next() < p.clusterChance ? pickInt(rng, p.clusterCount) : 1;
  const peak = dbToGain(p.peakDb);
  /** @type {{t: number, amp: number}[]} */
  const ticks = [];
  let t = s.t;
  for (let i = 0; i < n; i++) {
    ticks.push({ t, amp: peak * (i === 0 ? 1 : rng.range(0.3, 0.9)) });
    t += pick(rng, p.spacingMs) / 1000;
  }
  tickTrain(ctx, recipe, s, rng, ticks, p);
}

/**
 * Dry grass crackle (rain on dry stalks): a sparse random train of tiny clicks through a bandpass.
 * @param {BaseAudioContext} ctx @param {AudioNode} dest @param {any} recipe @param {Rng} rng
 * @param {{when?: number, gainDb?: number, durationS?: number}} [o]
 */
export function crackle(ctx, dest, recipe, rng, o = {}) {
  const p = recipe.crackle;
  const s = shot(ctx, dest, o.when, o.gainDb);
  const dur = o.durationS ?? p.durationS;
  const peak = dbToGain(p.peakDb);
  /** @type {{t: number, amp: number}[]} */
  const ticks = [];
  let t = s.t + (-Math.log(1 - rng.next()) / p.ratePerS);
  while (t < s.t + dur) {
    const x = (t - s.t) / dur;
    const window = Math.sin(Math.PI * x); // density and level swell in and out
    if (rng.next() < 0.3 + 0.7 * window) {
      const a = p.minAmp + (1 - p.minAmp) * Math.pow(rng.next(), p.ampSkew);
      ticks.push({ t, amp: peak * a * (0.4 + 0.6 * window) });
      if (rng.next() < p.doubleChance) ticks.push({ t: t + pick(rng, p.doubleMs) / 1000, amp: peak * a * 0.5 });
    }
    t += -Math.log(1 - rng.next()) / p.ratePerS;
  }
  ticks.sort((a, b) => a.t - b.t);
  tickTrain(ctx, recipe, s, rng, ticks, p);
}

/**
 * A faint aeolian whistle through a hollow stem on a gust: band noise through a narrow resonance
 * whose pitch rises with the gust and wanders a little, with a slow swell and fade.
 * @param {BaseAudioContext} ctx @param {AudioNode} dest @param {any} recipe @param {Rng} rng
 * @param {{when?: number, durationS?: number, gainDb?: number}} [o]
 */
export function aeolian(ctx, dest, recipe, rng, o = {}) {
  const p = recipe.aeolian;
  const s = shot(ctx, dest, o.when, o.gainDb);
  const dur = Math.max(0.5, o.durationS ?? p.durationS);
  const f0 = pick(rng, p.hz);
  const a = pick(rng, p.attackFraction);
  const flutter = smoothRandom(rng, Math.max(4, Math.round(dur * p.flutterKnotsPerS)));
  const wander = smoothRandom(rng, Math.max(3, Math.round(dur * p.wanderKnotsPerS)));
  const N = Math.ceil(dur * 120) + 2;
  const gainC = new Float32Array(N), f1 = new Float32Array(N), f2 = new Float32Array(N);
  const level = dbToGain(p.peakDb + p.makeupDb);
  for (let i = 0; i < N; i++) {
    const x = i / (N - 1);
    const e = x < a ? Math.sin((Math.PI / 2) * (x / a)) ** 2 : Math.cos((Math.PI / 2) * ((x - a) / (1 - a))) ** 2;
    gainC[i] = level * e * Math.max(0, 1 + p.flutterDepth * flutter(x));
    const f = f0 * (1 + p.gustPitch * (e - 0.5)) * (1 + p.wanderDepth * wander(x));
    f1[i] = f;
    f2[i] = f * p.overtone.ratio;
  }
  const buf = pinkBuffer(ctx, recipe);
  const src = s.own(ctx.createBufferSource());
  src.buffer = buf;
  const mono = ctx.createGain();
  mono.channelCount = 1; mono.channelCountMode = 'explicit';
  const env = ctx.createGain();
  env.gain.value = 0;
  env.gain.setValueCurveAtTime(gainC, s.t, dur);
  /** @param {Float32Array} curve @param {number} q */
  const reso = (curve, q) => {
    const b1 = ctx.createBiquadFilter(), b2 = ctx.createBiquadFilter();
    for (const b of [b1, b2]) { b.type = 'bandpass'; b.Q.value = q; b.frequency.setValueCurveAtTime(curve, s.t, dur); }
    b1.connect(b2);
    return [b1, b2];
  };
  const [a1, a2] = reso(f1, p.q);
  const [o1, o2] = reso(f2, p.overtone.q);
  const og = ctx.createGain();
  og.gain.value = dbToGain(p.overtone.db);
  src.connect(mono).connect(env);
  env.connect(a1); a2.connect(s.out);
  env.connect(o1); o2.connect(og).connect(s.out);
  src.start(s.t, rng.range(0, Math.max(0, buf.duration - dur - 0.1)));
  src.stop(s.t + dur + 0.05);
}

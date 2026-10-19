// @ts-check
// The frog's call, model 'pulse-croak' (doc 17, doc 25): a band-limited pulse train at 18 to 40 Hz
// through two resonant formants near 600 Hz and 1.4 kHz, 2 to 6 pulse groups per phrase. The
// common frog purrs softly rather than booming, so the train is tilted soft and each pulse's
// level and timing wobble a little (grain and jitter), drawn from the frog's own seeded stream.
//
//   pulse train (PeriodicWave, rate rises across a group, detune = jitter curve) ─┐
//   breath noise ──────────────────────────────────────────────────────────────────┤
//        → envelope (groups × grain, one value curve) → formant 1 + formant 2 → lowpass → level → out
//
// Pure helpers (individualOf, planCall) are separate so the lab and tests can draw a call.

import { stream, hash32 } from '../../core/rng.js';

/** @typedef {{next(): number, range(a: number, b: number): number, int(n: number): number}} Rng */

/** @param {number} db */
const dbToGain = (db) => Math.pow(10, db / 20);

/** A stable integer for any creature id. @param {string|number} id */
export function idHash(id) {
  if (typeof id === 'number') return id >>> 0;
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/**
 * A frog's lasting voice: pitch and rhythm offsets from its id hashed with the seed.
 * @param {number} seed @param {string|number} creatureId @param {any} R frog voice recipe
 * @returns {{pitch: number, rhythm: number, key: number}} pitch and rhythm as factors (1 = reference)
 */
export function individualOf(seed, creatureId, R) {
  const key = hash32(seed >>> 0, idHash(creatureId), 0x46524f47);
  const r = stream(key, 1);
  return {
    pitch: 1 + r.range(-R.individual.pitch, R.individual.pitch),
    rhythm: 1 + r.range(-R.individual.rhythm, R.individual.rhythm),
    key,
  };
}

/**
 * The season's voice settings, blended by the four season weights.
 * @param {any} R @param {number[]} blend
 * @returns {{rate: number, pitch: number, phrase: number}}
 */
export function seasonVoice(R, blend) {
  const k = ['spring', 'summer', 'autumn', 'winter'];
  const out = { rate: 0, pitch: 0, phrase: 0 };
  let w = 0;
  for (let i = 0; i < 4; i++) {
    const s = R.seasons[k[i]];
    out.rate += blend[i] * s.rate; out.pitch += blend[i] * s.pitch; out.phrase += blend[i] * s.phrase;
    w += blend[i];
  }
  if (w > 0) { out.rate /= w; out.pitch /= w; out.phrase /= w; }
  return out;
}

/**
 * Plan one call: when each pulse group starts and ends, its pulse rates and level.
 * @param {any} R frog voice recipe
 * @param {{pitch: number, rhythm: number}} ind
 * @param {{pitch: number, phrase: number}} season
 * @param {Rng} rng this call's stream
 * @returns {{groups: {t0: number, t1: number, rate0: number, rate1: number, amp: number}[], durS: number, formantScale: number}}
 */
export function planCall(R, ind, season, rng) {
  const P = R.phrase;
  const want = P.groups[0] + rng.int(P.groups[1] - P.groups[0] + 1);
  const n = Math.max(1, Math.min(P.groups[1], Math.round(want * season.phrase)));
  // Rhythm: a faster frog has faster pulses and shorter groups. Pitch nudges the pulse rate a little.
  const rate = Math.min(R.rateHz[1], Math.max(R.rateHz[0], R.baseRateHz * ind.rhythm * (1 + 0.3 * (ind.pitch - 1))));
  const groups = [];
  let t = P.onsetS;
  for (let i = 0; i < n; i++) {
    const len = rng.range(P.groupS[0], P.groupS[1]) / ind.rhythm;
    const r0 = Math.min(R.rateHz[1], rate * Math.exp(rng.range(-0.04, 0.04)));
    const amp = P.groupAmp[Math.min(i, P.groupAmp.length - 1)] * (i === n - 1 && n > 2 ? 0.85 : 1) * rng.range(0.85, 1);
    groups.push({ t0: t, t1: t + len, rate0: r0, rate1: Math.min(R.rateHz[1], r0 * (1 + P.rateRise)), amp });
    t += len + rng.range(P.gapS[0], P.gapS[1]) / ind.rhythm;
  }
  const durS = groups[groups.length - 1].t1 + P.releaseS + 0.02;
  return { groups, durS, formantScale: ind.pitch * season.pitch };
}

/** Raised-cosine step from 0 to 1 over [0, 1]. @param {number} x */
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * x));

/**
 * A smooth seeded wobble in about [-1, 1], knots every 1/hz seconds (Catmull-Rom).
 * @param {Rng} rng @param {number} durS @param {number} hz
 */
function wobble(rng, durS, hz) {
  const n = Math.max(4, Math.ceil(durS * hz) + 3);
  const k = Array.from({ length: n }, () => rng.next() * 2 - 1);
  return (/** @type {number} */ t) => {
    const u = Math.min(n - 3, Math.max(0, t * hz)) + 1;
    const i = Math.floor(u), f = u - i;
    const p0 = k[i - 1], p1 = k[i], p2 = k[i + 1], p3 = k[Math.min(n - 1, i + 2)];
    return 0.5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (3 * p1 - p0 - 3 * p2 + p3) * f * f * f);
  };
}

/** @type {WeakMap<BaseAudioContext, {wave: PeriodicWave, key: string}>} */
const waves = new WeakMap();
/** @type {WeakMap<BaseAudioContext, AudioBuffer>} */
const noiseBufs = new WeakMap();

/** The soft band-limited pulse train: harmonic k at k^-tilt, cosine phase (a peaky pulse). @param {BaseAudioContext} ctx @param {any} R */
function pulseWave(ctx, R) {
  const key = `${R.partials}:${R.tilt}`;
  const c = waves.get(ctx);
  if (c && c.key === key) return c.wave;
  const real = new Float32Array(R.partials + 1), imag = new Float32Array(R.partials + 1);
  for (let k = 1; k <= R.partials; k++) real[k] = Math.pow(k, -R.tilt);
  const wave = ctx.createPeriodicWave(real, imag);
  waves.set(ctx, { wave, key });
  return wave;
}

/** Seeded white noise for the breath, made once per context. @param {BaseAudioContext} ctx */
function noiseBuffer(ctx) {
  let b = noiseBufs.get(ctx);
  if (!b) {
    const len = Math.round(ctx.sampleRate * 2.3);
    b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0), r = stream(0x6e6f6973, 1);
    for (let i = 0; i < len; i++) d[i] = r.next() * 2 - 1;
    noiseBufs.set(ctx, b);
  }
  return b;
}

/**
 * Render one call into dest at time `when`. Returns its end time and a stop() for voice stealing.
 * @param {BaseAudioContext} ctx @param {AudioNode} dest @param {any} R
 * @param {ReturnType<typeof planCall>} plan @param {number} intensity 0..1 @param {number} when
 * @param {Rng} rng this call's stream (grain and jitter)
 */
export function renderCall(ctx, dest, R, plan, intensity, when, rng) {
  const t0 = Math.max(when, ctx.currentTime);
  const dur = plan.durS;
  const level = ctx.createGain();
  level.gain.value = dbToGain(R.levelDb + R.intensityDb[0] + (R.intensityDb[1] - R.intensityDb[0]) * Math.min(1, Math.max(0, intensity)));
  level.connect(dest);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = R.lowpassHz; lp.Q.value = 0.5;
  lp.connect(level);
  const env = ctx.createGain();
  env.gain.value = 0;
  for (const f of R.formants) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = Math.min(f.hz * plan.formantScale, ctx.sampleRate * 0.45);
    bp.Q.value = f.q;
    const g = ctx.createGain();
    // A bandpass peaks at 0 dB; resonance gain keeps a sharper formant as loud as a broad one.
    g.gain.value = dbToGain(f.db) * Math.sqrt(f.q);
    env.connect(bp).connect(g).connect(lp);
  }

  const osc = ctx.createOscillator();
  osc.setPeriodicWave(pulseWave(ctx, R));
  for (const g of plan.groups) {
    osc.frequency.setValueAtTime(g.rate0, t0 + g.t0);
    osc.frequency.linearRampToValueAtTime(g.rate1, t0 + g.t1);
  }
  const breath = ctx.createBufferSource();
  breath.buffer = noiseBuffer(ctx);
  const bg = ctx.createGain();
  bg.gain.value = dbToGain(R.breathDb);
  osc.connect(env);
  breath.connect(bg).connect(env);

  // One value curve each for the envelope (groups × grain) and the timing jitter (detune).
  const RES = 600;
  const N = Math.max(2, Math.ceil(dur * RES));
  const envC = new Float32Array(N), detC = new Float32Array(N);
  const grain = wobble(rng, dur, R.grain.hz), jit = wobble(rng, dur, R.jitter.hz);
  const A = R.phrase.attackS, Rl = R.phrase.releaseS;
  for (let i = 0; i < N; i++) {
    const t = (i / (N - 1)) * dur;
    let e = 0;
    for (const g of plan.groups) {
      if (t < g.t0 || t > g.t1 + Rl) continue;
      e = Math.max(e, g.amp * smooth((t - g.t0) / A) * (1 - smooth((t - g.t1) / Rl)));
    }
    envC[i] = e * Math.max(0, 1 + R.grain.depth * grain(t));
    detC[i] = R.jitter.cents * jit(t);
  }
  envC[0] = 0; envC[N - 1] = 0;
  env.gain.setValueCurveAtTime(envC, t0, dur);
  osc.detune.setValueCurveAtTime(detC, t0, dur);
  osc.start(t0);
  breath.start(t0, rng.range(0, 1));
  const end = t0 + dur + 0.05;
  osc.stop(end); breath.stop(end);
  osc.onended = () => { try { level.disconnect(); } catch { /* already */ } };
  return {
    end,
    /** Fade out quickly (voice stealing). */
    stop() {
      const t = ctx.currentTime;
      level.gain.cancelScheduledValues(t);
      level.gain.setValueAtTime(level.gain.value, t);
      level.gain.setTargetAtTime(0, t, 0.01);
      try { osc.stop(t + 0.06); breath.stop(t + 0.06); } catch { /* already */ }
    },
  };
}

/**
 * The spring purr: distant callers as a quiet low layer under the chorus (doc 25). Two slow pulse
 * trains spread left and right, lowpassed into a soft purr. Its level follows recent calls.
 * @param {BaseAudioContext} ctx @param {AudioNode} dest @param {any} R frog voice recipe
 */
export function createPurr(ctx, dest, R) {
  const P = R.purr;
  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(dest);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = P.lowpassHz; lp.Q.value = 0.5;
  const bp = ctx.createBiquadFilter();
  bp.type = 'peaking'; bp.frequency.value = P.bandHz; bp.Q.value = P.q; bp.gain.value = 6;
  lp.connect(bp).connect(out);
  /** @type {OscillatorNode[]} */
  const oscs = [];
  for (const side of [-1, 1]) {
    const o = ctx.createOscillator();
    o.setPeriodicWave(pulseWave(ctx, R));
    o.frequency.value = P.rateHz;
    o.detune.value = (side * P.widthCents) / 2;
    // A slow wobble on each, so the two drift in and out of step like far frogs.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = side < 0 ? 0.13 : 0.21;
    const lg = ctx.createGain();
    lg.gain.value = 40;
    lfo.connect(lg).connect(o.detune);
    // Grain: a faster wobble on level.
    const am = ctx.createGain();
    am.gain.value = 1;
    const glfo = ctx.createOscillator();
    glfo.frequency.value = side < 0 ? 3.1 : 4.3;
    const gg = ctx.createGain();
    gg.gain.value = P.grainDepth * 0.5;
    glfo.connect(gg).connect(am.gain);
    const pan = ctx.createStereoPanner();
    pan.pan.value = side * 0.6;
    o.connect(am).connect(pan).connect(lp);
    o.start(); lfo.start(); glfo.start();
    oscs.push(o, lfo, glfo);
  }
  let rate = 0, lastT = ctx.currentTime;
  return {
    /** A call happened: raise the purr toward its level for this activity. @param {number} springWeight */
    onCall(springWeight) {
      const t = ctx.currentTime;
      rate = rate * Math.exp(-(t - lastT) / P.releaseS) + 1 / P.releaseS;
      lastT = t;
      const target = dbToGain(P.db) * Math.min(1.5, rate / P.activityCallsPerS) * springWeight;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(out.gain.value, t);
      out.gain.setTargetAtTime(target, t, P.attackS / 3);
      out.gain.setTargetAtTime(0, t + P.attackS, P.releaseS / 2);
    },
    /** Silence now (winter, or the season left spring). */
    hush() { const t = ctx.currentTime; out.gain.cancelScheduledValues(t); out.gain.setTargetAtTime(0, t, 1); },
    stop() { for (const o of oscs) { try { o.stop(); } catch { /* already */ } } out.disconnect(); },
  };
}

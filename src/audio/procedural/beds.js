// @ts-check
// Continuous procedural beds (doc 25): open wind, the seasonal air bed, pond lap and a spring
// trickle. Each is a long seeded stereo pink-noise loop (non-integer length, decorrelated
// channels; a 37 s low-rate loop for the low layers) through gentle filters, with slow seeded wandering from a looped control curve.
// Each returns {output, set(params, rampS), stop(fadeS)}; every change glides with
// setTargetAtTime, so nothing jumps. Event beds (lap, trickle) schedule their wavelets and
// drops a little ahead on the audio clock. Numbers come from recipes/audio/procedural.json.

import { dbToGain, pinkBuffer, controlBuffer, dropWith } from './one-shots.js';

/** @typedef {{next(): number, range(a: number, b: number): number, int(n: number): number}} Rng */
/** @typedef {{output: AudioNode, set(params: any, rampS?: number): void, stop(fadeS?: number): void}} Bed */

/** @param {number} a @param {number} b @param {number} x */
const lerp = (a, b, x) => a + (b - a) * x;
/** @param {number} x */
const clamp01 = (x) => Math.min(1, Math.max(0, x));
/** Log interpolation for frequencies. @param {number} a @param {number} b @param {number} x */
const lerpHz = (a, b, x) => a * Math.pow(b / a, x);

/**
 * Shared bed plumbing: the looped pink source at a seeded offset and rate, the bed's output
 * gain (fades in from zero), and a stop that fades out and disconnects.
 * @param {BaseAudioContext} ctx @param {AudioNode} dest @param {any} recipe @param {Rng} rng
 */
function bedBase(ctx, dest, recipe, rng) {
  const t = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, t);
  out.gain.setTargetAtTime(1, t, recipe.beds.fadeInS / 3);
  out.connect(dest);
  /** @type {AudioScheduledSourceNode[]} */
  const sources = [];
  /** A looped noise source, started now at a seeded point. @param {number} [rate] @param {'full'|'low'} [band] */
  const noise = (rate = 1, band = /** @type {'full'|'low'} */ ('full')) => {
    const buf = pinkBuffer(ctx, recipe, band);
    const s = ctx.createBufferSource();
    s.buffer = buf; s.loop = true;
    s.playbackRate.value = rate * Math.exp(rng.range(-0.04, 0.04));
    s.start(t, rng.range(0, buf.duration));
    sources.push(s);
    // A slow seeded pitch drift, so the loop never lines up with itself exactly.
    wander(recipe.beds.driftPeriodS, recipe.beds.driftCents).connect(s.detune);
    return s;
  };
  /** A slow wander signal in [-1, 1] scaled by depth, looping at a seeded rate. @param {number} periodS @param {number} depth */
  function wander(periodS, depth) {
    const buf = controlBuffer(ctx, recipe);
    const s = ctx.createBufferSource();
    s.buffer = buf; s.loop = true;
    s.playbackRate.value = buf.duration / (periodS * Math.exp(rng.range(-0.15, 0.15)));
    const g = ctx.createGain();
    g.gain.value = depth;
    s.connect(g);
    s.start(t, rng.range(0, buf.duration));
    sources.push(s);
    return g;
  }
  let stopped = false;
  /** @param {number} [fadeS] */
  const stop = (fadeS = recipe.beds.fadeOutS) => {
    if (stopped) return;
    stopped = true;
    const now = ctx.currentTime;
    out.gain.cancelScheduledValues(now);
    out.gain.setTargetAtTime(0, now, Math.max(0.01, fadeS) / 4);
    const end = now + Math.max(0.01, fadeS) * 2 + 0.05;
    for (const s of sources) { try { s.stop(end); } catch { /* already */ } }
    if (sources[0]) sources[0].onended = () => out.disconnect();
  };
  return { out, noise, wander, stop, isStopped: () => stopped };
}

/** @param {AudioParam} p @param {number} v @param {number} ctxTime @param {number} rampS */
const glide = (p, v, ctxTime, rampS) => p.setTargetAtTime(v, ctxTime, Math.max(0.005, rampS) / 3);

/** @param {BaseAudioContext} ctx @param {BiquadFilterType} type @param {number} hz @param {number} [q] @param {number} [gainDb] */
function biquad(ctx, type, hz, q = 0.707, gainDb = 0) {
  const b = ctx.createBiquadFilter();
  b.type = type; b.frequency.value = hz; b.Q.value = q; b.gain.value = gainDb;
  return b;
}

/**
 * Open wind from filtered noise. strength 0..1 sets level and brightness; gust 0..1 raises
 * both for a moment (call set({gust}) and then set({gust: 0}) as the gust passes).
 * @param {BaseAudioContext} ctx @param {AudioNode} dest @param {any} recipe @param {Rng} rng
 * @param {{strength?: number, gust?: number}} [o]
 * @returns {Bed}
 */
export function wind(ctx, dest, recipe, rng, o = {}) {
  const p = recipe.wind;
  const b = bedBase(ctx, dest, recipe, rng);
  const state = { strength: o.strength ?? 0.4, gust: o.gust ?? 0 };
  // Two layers from the same loop at different rates: a lowpassed body and a soft bandpassed air.
  const lvl = ctx.createGain();
  lvl.gain.value = 1;
  lvl.connect(b.out);
  const body = biquad(ctx, 'lowpass', 400, p.body.q);
  const body2 = biquad(ctx, 'lowpass', 400, p.body.q);
  const bodyG = ctx.createGain();
  const air = biquad(ctx, 'bandpass', 1500, p.air.q);
  const airG = ctx.createGain();
  // The body is two low loops at incommensurate rates, so together they never line up.
  const pair = ctx.createGain();
  pair.gain.value = Math.SQRT1_2;
  b.noise(1, 'low').connect(pair);
  b.noise(p.body.secondRate, 'low').connect(pair);
  pair.connect(body).connect(body2).connect(bodyG).connect(lvl);
  b.noise(p.air.rate).connect(air).connect(airG).connect(lvl);
  // Slow wander on cutoffs (in cents) and on level, from separate seeded curves.
  b.wander(p.wander.periodS, p.wander.cents).connect(body.detune);
  b.wander(p.wander.periodS, p.wander.cents).connect(body2.detune);
  b.wander(p.wander.periodS * 0.8, p.wander.cents).connect(air.detune);
  b.wander(p.wander.periodS * 1.3, p.wander.level).connect(lvl.gain);

  /** @param {number} rampS */
  const apply = (rampS) => {
    const t = ctx.currentTime;
    const x = clamp01(state.strength), g = clamp01(state.gust);
    const e = clamp01(x + p.gust.brightness * g);
    glide(body.frequency, lerpHz(p.body.hz[0], p.body.hz[1], e), t, rampS);
    glide(body2.frequency, lerpHz(p.body.hz[0], p.body.hz[1], e), t, rampS);
    glide(air.frequency, lerpHz(p.air.hz[0], p.air.hz[1], e), t, rampS);
    const db = lerp(p.levelDb[0], p.levelDb[1], x) + p.gust.db * g;
    glide(bodyG.gain, dbToGain(db + p.body.db), t, rampS);
    glide(airG.gain, dbToGain(db + p.air.db + p.air.dbPerStrength * e), t, rampS);
  };
  apply(0.01);
  return {
    output: b.out,
    set(params, rampS = p.rampS) {
      Object.assign(state, params);
      apply(params.gust !== undefined && Object.keys(params).length === 1 ? (params.gust > 0 ? p.gust.riseS : p.gust.fallS) : rampS);
    },
    stop: b.stop,
  };
}

/**
 * The seasonal air bed: an almost inaudible shaped noise floor. Each season's color is a set of
 * EQ settings (doc 25 matrix); set({season, level}) glides between them.
 * @param {BaseAudioContext} ctx @param {AudioNode} dest @param {any} recipe @param {Rng} rng
 * @param {{season?: string, level?: number}} [o]
 * @returns {Bed}
 */
export function air(ctx, dest, recipe, rng, o = {}) {
  const p = recipe.air;
  const b = bedBase(ctx, dest, recipe, rng);
  const hp = biquad(ctx, 'highpass', 60, 0.6);
  const low = biquad(ctx, 'lowshelf', 200);
  const mid = biquad(ctx, 'peaking', 1000, 1);
  const lp = biquad(ctx, 'lowpass', 8000, 0.6);
  const g = ctx.createGain();
  b.noise(p.rate).connect(hp).connect(low).connect(mid).connect(lp).connect(g).connect(b.out);
  b.wander(p.wanderPeriodS, p.wanderCents).connect(lp.detune);
  const state = { season: o.season ?? 'spring', level: o.level ?? 1 };
  /** @param {number} rampS */
  const apply = (rampS) => {
    const c = p.seasons[state.season] ?? p.seasons.spring;
    const t = ctx.currentTime;
    glide(hp.frequency, c.highpassHz, t, rampS);
    glide(low.frequency, c.lowShelf.hz, t, rampS); glide(low.gain, c.lowShelf.db, t, rampS);
    glide(mid.frequency, c.peak.hz, t, rampS); glide(mid.Q, c.peak.q, t, rampS); glide(mid.gain, c.peak.db, t, rampS);
    glide(lp.frequency, c.lowpassHz, t, rampS);
    glide(g.gain, dbToGain(p.levelDb + c.db) * clamp01(state.level), t, rampS);
  };
  apply(0.01);
  return { output: b.out, set(params, rampS = p.crossfadeS) { Object.assign(state, params); apply(rampS); }, stop: b.stop };
}

/**
 * A look-ahead scheduler for event beds: calls fire(t) for each event time, ahead of the clock.
 * In an OfflineAudioContext it schedules the whole render at once.
 * @param {BaseAudioContext} ctx @param {any} recipe @param {() => number} nextGapS @param {(t: number) => void} fire @param {() => boolean} stopped
 */
function eventLoop(ctx, recipe, nextGapS, fire, stopped) {
  const ahead = recipe.beds.lookAheadS;
  const offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
  let next = ctx.currentTime + nextGapS();
  const horizon = offline ? /** @type {OfflineAudioContext} */ (ctx).length / ctx.sampleRate : 0;
  const pump = () => {
    if (stopped()) return;
    const until = offline ? horizon : ctx.currentTime + ahead;
    while (next < until) { fire(next); next += nextGapS(); }
    if (!offline) setTimeout(pump, (ahead * 1000) / 3);
  };
  pump();
}

/**
 * Small water lapping at a pond edge: soft irregular wavelets of filtered noise over a quiet
 * wash, with an occasional drop. amount 0..1 sets level and rate; liveliness 0 (winter, glassy)
 * to 1 (spring, lively) sets wavelet rate, brightness and how often drops fall.
 * @param {BaseAudioContext} ctx @param {AudioNode} dest @param {any} recipe @param {Rng} rng
 * @param {{amount?: number, liveliness?: number}} [o]
 * @returns {Bed}
 */
export function lap(ctx, dest, recipe, rng, o = {}) {
  const p = recipe.lap;
  const b = bedBase(ctx, dest, recipe, rng);
  const state = { amount: o.amount ?? 0.6, liveliness: o.liveliness ?? 0.5 };
  const mix = ctx.createGain();
  mix.connect(b.out);
  // The wavelet voice: one noise loop through a soft low bandpass, its gain opened per wavelet.
  const bp = biquad(ctx, 'bandpass', p.wavelet.hz[0], p.wavelet.q);
  const lp = biquad(ctx, 'lowpass', p.wavelet.lowpassHz[0], 0.5);
  const env = ctx.createGain();
  env.gain.value = 0;
  b.noise(p.wavelet.rate, 'low').connect(bp).connect(lp).connect(env).connect(mix);
  const washBp = biquad(ctx, 'bandpass', p.wash.hz, p.wash.q);
  const washG = ctx.createGain();
  b.noise(p.wash.rate, 'low').connect(washBp).connect(washG).connect(mix);
  b.wander(p.wash.wanderPeriodS, p.wash.wanderLevel).connect(washG.gain);
  const drops = ctx.createGain();
  drops.connect(mix);

  /** @param {number} rampS */
  const apply = (rampS) => {
    const t = ctx.currentTime, a = clamp01(state.amount), l = clamp01(state.liveliness);
    glide(mix.gain, dbToGain(p.levelDb) * a, t, rampS);
    glide(washG.gain, dbToGain(lerp(p.wash.db[0], p.wash.db[1], l)), t, rampS);
    glide(lp.frequency, lerpHz(p.wavelet.lowpassHz[0], p.wavelet.lowpassHz[1], l), t, rampS);
  };
  apply(0.01);
  // A wavelet every 1/rate seconds, rate 0.3 to 1.5 per second; envelope slow rise, slower fall.
  eventLoop(ctx, recipe, () => {
    const r = lerp(p.wavelet.ratePerS[0], p.wavelet.ratePerS[1], clamp01(state.liveliness)) * (0.5 + clamp01(state.amount));
    return (1 / r) * Math.exp(rng.range(-p.wavelet.irregularity, p.wavelet.irregularity));
  }, (t) => {
    const l = clamp01(state.liveliness), w = p.wavelet;
    const att = rng.range(w.attackS[0], w.attackS[1]), dec = rng.range(w.decayS[0], w.decayS[1]);
    const amp = dbToGain(rng.range(w.db[0], w.db[1]));
    env.gain.setTargetAtTime(amp, t, att / 2.5);
    env.gain.setTargetAtTime(0, t + att, dec / 3);
    bp.frequency.setTargetAtTime(lerpHz(w.hz[0], w.hz[1], l) * Math.exp(rng.range(-0.25, 0.25)), t, att / 2);
    if (rng.next() < lerp(p.drops.chance[0], p.drops.chance[1], l)) {
      dropWith(ctx, drops, recipe, recipe.drop, rng, {
        when: t + att * rng.range(0.6, 1.4), sizeMm: rng.range(p.drops.sizeMm[0], p.drops.sizeMm[1]), gainDb: rng.range(p.drops.db[0], p.drops.db[1]),
      });
    }
  }, b.isStopped);
  return { output: b.out, set(params, rampS = p.rampS) { Object.assign(state, params); apply(rampS); }, stop: b.stop };
}

/**
 * A small spring trickle: a dense stream of tiny bubbles at random over a soft bandpassed noise.
 * @param {BaseAudioContext} ctx @param {AudioNode} dest @param {any} recipe @param {Rng} rng
 * @param {{amount?: number}} [o]
 * @returns {Bed}
 */
export function trickle(ctx, dest, recipe, rng, o = {}) {
  const p = recipe.trickle;
  const b = bedBase(ctx, dest, recipe, rng);
  const state = { amount: o.amount ?? 0.6 };
  const mix = ctx.createGain();
  mix.connect(b.out);
  const bp = biquad(ctx, 'bandpass', p.noise.hz, p.noise.q);
  const ng = ctx.createGain();
  b.noise(p.noise.rate).connect(bp).connect(ng).connect(mix);
  b.wander(p.noise.wanderPeriodS, p.noise.wanderCents).connect(bp.detune);
  // Two bubble streams, one per side, so the trickle has width without a panner.
  const merger = ctx.createChannelMerger(2);
  const sides = [ctx.createGain(), ctx.createGain()];
  sides[0].connect(merger, 0, 0); sides[1].connect(merger, 0, 1);
  const bubG = ctx.createGain();
  merger.connect(bubG).connect(mix);
  /** @param {number} rampS */
  const apply = (rampS) => {
    const t = ctx.currentTime, a = clamp01(state.amount);
    glide(mix.gain, dbToGain(p.levelDb) * Math.sqrt(a), t, rampS);
    glide(ng.gain, dbToGain(p.noise.db), t, rampS);
    glide(bubG.gain, dbToGain(p.bubbles.db), t, rampS);
  };
  apply(0.01);
  const B = { ...recipe.drop, ...p.bubbles.shape };
  eventLoop(ctx, recipe, () => {
    const r = lerp(p.bubbles.ratePerS[0], p.bubbles.ratePerS[1], clamp01(state.amount));
    return -Math.log(1 - rng.next()) / r;
  }, (t) => {
    // Many small bubbles, the odd larger one: radius skewed toward the small end.
    const s = p.bubbles.sizeMm;
    const r = s[0] * Math.pow(s[1] / s[0], Math.pow(rng.next(), p.bubbles.sizeSkew));
    dropWith(ctx, sides[rng.int(2)], recipe, B, rng, { when: t, sizeMm: r, gainDb: rng.range(p.bubbles.jitterDb[0], p.bubbles.jitterDb[1]) });
  }, b.isStopped);
  return { output: b.out, set(params, rampS = p.rampS) { Object.assign(state, params); apply(rampS); }, stop: b.stop };
}

// @ts-check
// Procedural stand-ins for the recorded beds that src/audio/procedural.js does not make itself
// (doc 25: no recordings exist yet). Each has the same shape as a procedural bed:
// {output, set(params, rampS), stop(fadeS)}. Numbers come from recipes/audio/ambience.json
// ("fallbacks"); variation from the caller's seeded stream, never Math.random.
//
//   surf     the sea: slow, deep, wide pink noise with seeded waves that swell and fall
//   windEq   the procedural wind through a per-season EQ (reeds and grass in each season)
//   rainOn   rain on one surface: a shaped noise texture plus seeded drops (also the drizzle)
//   run      a stream run: the procedural trickle over a fuller band of moving water

import { wind, trickle, drop } from '../procedural.js';
import { pinkBuffer, controlBuffer } from '../procedural/one-shots.js';
import { dbToGain, clamp01, lerp } from './curves.js';

/** @typedef {{next(): number, range(a: number, b: number): number, int(n: number): number}} Rng */
/** @typedef {{output: AudioNode, set(params: any, rampS?: number): void, stop(fadeS?: number): void}} Bed */

/** @param {AudioParam} p @param {number} v @param {BaseAudioContext} ctx @param {number} rampS */
const glide = (p, v, ctx, rampS) => p.setTargetAtTime(v, ctx.currentTime, Math.max(0.005, rampS) / 3);
/** @param {Rng} r @param {number[]} ab */
const pick = (r, ab) => r.range(ab[0], ab[1]);
/** Log interpolation for frequencies. @param {number} a @param {number} b @param {number} x */
const lerpHz = (a, b, x) => a * Math.pow(b / a, clamp01(x));

/** @param {BaseAudioContext} ctx @param {BiquadFilterType} type @param {number} hz @param {number} [q] @param {number} [db] */
function biquad(ctx, type, hz, q = 0.707, db = 0) {
  const b = ctx.createBiquadFilter();
  b.type = type; b.frequency.value = hz; b.Q.value = q; b.gain.value = db;
  return b;
}

/**
 * Shared plumbing: an output that fades in, owned sources, and a stop that fades and cleans up.
 * @param {BaseAudioContext} ctx @param {AudioNode} dest @param {number} fadeInS
 */
function base(ctx, dest, fadeInS) {
  const out = ctx.createGain();
  const t = ctx.currentTime;
  out.gain.setValueAtTime(0, t);
  out.gain.setTargetAtTime(1, t, Math.max(0.01, fadeInS) / 3);
  out.connect(dest);
  /** @type {AudioScheduledSourceNode[]} */
  const sources = [];
  /** @type {{stop(f?: number): void}[]} */
  const children = [];
  /** @type {ReturnType<typeof setTimeout>[]} */
  const timers = [];
  let stopped = false;
  return {
    out, sources, children, timers,
    isStopped: () => stopped,
    /** @param {number} fadeS */
    stop(fadeS) {
      if (stopped) return;
      stopped = true;
      const now = ctx.currentTime, f = Math.max(0.02, fadeS);
      out.gain.cancelScheduledValues(now);
      out.gain.setValueAtTime(out.gain.value, now);
      out.gain.setTargetAtTime(0, now, f / 4);
      for (const s of sources) { try { s.stop(now + f * 2 + 0.05); } catch { /* already stopped */ } }
      for (const c of children) c.stop(f);
      for (const id of timers) clearTimeout(id);
      setTimeout(() => out.disconnect(), (f * 2 + 0.2) * 1000);
    },
  };
}

/**
 * A looped pink-noise source at a seeded offset and rate.
 * @param {BaseAudioContext} ctx @param {any} proc @param {Rng} rng @param {number} rate @param {AudioScheduledSourceNode[]} owned
 */
function noise(ctx, proc, rng, rate, owned) {
  const buf = pinkBuffer(ctx, proc);
  const s = ctx.createBufferSource();
  s.buffer = buf; s.loop = true;
  s.playbackRate.value = rate * Math.exp(rng.range(-0.03, 0.03));
  s.start(ctx.currentTime, rng.range(0, buf.duration));
  owned.push(s);
  return s;
}

/**
 * A slow seeded wander in [-depth, depth], from the procedural control curve.
 * @param {BaseAudioContext} ctx @param {any} proc @param {Rng} rng @param {number} periodS @param {number} depth @param {AudioScheduledSourceNode[]} owned
 */
function wander(ctx, proc, rng, periodS, depth, owned) {
  const buf = controlBuffer(ctx, proc);
  const s = ctx.createBufferSource();
  s.buffer = buf; s.loop = true;
  s.playbackRate.value = buf.duration / (periodS * Math.exp(rng.range(-0.15, 0.15)));
  const g = ctx.createGain();
  g.gain.value = depth;
  s.connect(g);
  s.start(ctx.currentTime, rng.range(0, buf.duration));
  owned.push(s);
  return g;
}

/**
 * A look-ahead event pump on the audio clock: fire(t) for each event, gaps from nextGapS().
 * @param {BaseAudioContext} ctx @param {number} aheadS @param {() => number} nextGapS @param {(t: number) => void} fire
 * @param {() => boolean} stopped @param {ReturnType<typeof setTimeout>[]} timers
 */
function pump(ctx, aheadS, nextGapS, fire, stopped, timers) {
  let next = ctx.currentTime + nextGapS();
  const run = () => {
    if (stopped()) return;
    const until = ctx.currentTime + aheadS;
    // After a hidden tab or a long pause, skip what was missed rather than firing it all at once.
    if (next < ctx.currentTime - 0.5) next = ctx.currentTime + nextGapS();
    let guard = 0;
    while (next < until && guard++ < 400) { fire(next); next += nextGapS(); }
    const id = setTimeout(run, (aheadS * 1000) / 3);
    timers.length = 0;
    timers.push(id);
  };
  run();
}

/**
 * The distant sea around the island: deep, slow, wide pink noise under seeded waves.
 * set({level 0..1, swell 0..1, brightness 0..1}): swell (tide, wind) makes waves bigger and
 * closer together; brightness (wind) opens the wash band.
 * @param {BaseAudioContext} ctx @param {AudioNode} dest @param {any} P recipe fallbacks.surf
 * @param {any} proc recipes/audio/procedural.json @param {Rng} rng
 * @returns {Bed}
 */
export function surf(ctx, dest, P, proc, rng) {
  const b = base(ctx, dest, P.fadeInS);
  const state = { level: 0.6, swell: 0.5, brightness: 0.4 };
  const lvl = ctx.createGain();
  lvl.connect(b.out);
  // The body: two rates of the same loop, lowpassed twice, for a deep roar with no seam.
  const body1 = biquad(ctx, 'lowpass', P.body.hz[0], P.body.q);
  const body2 = biquad(ctx, 'lowpass', P.body.hz[0], P.body.q);
  const bodyG = ctx.createGain();
  noise(ctx, proc, rng, P.body.rate, b.sources).connect(body1).connect(body2).connect(bodyG);
  // The wash: the higher hiss of water breaking on far sand, swelling more with each wave.
  const washBp = biquad(ctx, 'bandpass', P.wash.hz[0], P.wash.q);
  const washG = ctx.createGain();
  noise(ctx, proc, rng, P.wash.rate, b.sources).connect(washBp).connect(washG);
  // Each wave raises both layers through its own gain, from a floor up toward 1.
  const swellBody = ctx.createGain();
  const swellWash = ctx.createGain();
  swellBody.gain.value = P.waves.floor;
  swellWash.gain.value = P.waves.washFloor;
  bodyG.connect(swellBody).connect(lvl);
  washG.connect(swellWash).connect(lvl);
  wander(ctx, proc, rng, P.wanderPeriodS, P.wanderCents, b.sources).connect(body1.detune);
  wander(ctx, proc, rng, P.wanderPeriodS * 0.77, P.wanderCents, b.sources).connect(washBp.detune);

  const apply = (/** @type {number} */ rampS) => {
    const x = clamp01(state.brightness);
    glide(body1.frequency, lerpHz(P.body.hz[0], P.body.hz[1], x), ctx, rampS);
    glide(body2.frequency, lerpHz(P.body.hz[0], P.body.hz[1], x), ctx, rampS);
    glide(washBp.frequency, lerpHz(P.wash.hz[0], P.wash.hz[1], x), ctx, rampS);
    glide(bodyG.gain, dbToGain(P.body.db), ctx, rampS);
    glide(washG.gain, dbToGain(P.wash.db + P.wash.dbPerBrightness * x), ctx, rampS);
    glide(lvl.gain, dbToGain(P.levelDb) * clamp01(state.level), ctx, rampS);
  };
  apply(0.01);

  pump(ctx, P.lookAheadS, () => {
    const s = clamp01(state.swell);
    return pick(rng, P.waves.everyS) / lerp(P.waves.rateAtSwell[0], P.waves.rateAtSwell[1], s);
  }, (t) => {
    const s = clamp01(state.swell);
    const peak = lerp(P.waves.peak[0], P.waves.peak[1], s) * rng.range(0.7, 1);
    const rise = pick(rng, P.waves.riseS), fall = pick(rng, P.waves.fallS);
    for (const [g, floor, extra] of /** @type {const} */ ([[swellBody, P.waves.floor, 1], [swellWash, P.waves.washFloor, P.waves.washExtra]])) {
      const top = floor + (Math.min(1.6, peak * extra) - floor) * rng.range(0.85, 1);
      g.gain.setTargetAtTime(top, t, rise / 3);
      g.gain.setTargetAtTime(floor, t + rise, fall / 3);
    }
  }, b.isStopped, b.timers);

  return {
    output: b.out,
    set(params, rampS = P.rampS) { Object.assign(state, params); apply(rampS); },
    stop: (f = P.fadeOutS) => b.stop(f),
  };
}

/**
 * Wind through something: the procedural wind bed shaped by one season's EQ, plus a rustle layer
 * (bandpassed noise that flutters and swells with strength and gusts) that gives reeds and grass
 * their texture: soft and low when green, a long swish when tall, crisp and high when dry.
 * set({strength, gust}) as the procedural wind.
 * @param {BaseAudioContext} ctx @param {AudioNode} dest
 * @param {any} eq {highpassHz, peak:{hz,q,db}, lowpassHz, db, rustle:{hz,q,db,flutterS,flutter,rate}}
 * @param {any} proc @param {Rng} rng @param {{strength?: number}} [o]
 * @returns {Bed}
 */
export function windEq(ctx, dest, eq, proc, rng, o = {}) {
  const b = base(ctx, dest, 0.01);
  const hp = biquad(ctx, 'highpass', eq.highpassHz, 0.6);
  const pk = biquad(ctx, 'peaking', eq.peak.hz, eq.peak.q, eq.peak.db);
  const lp = biquad(ctx, 'lowpass', eq.lowpassHz, 0.6);
  const g = ctx.createGain();
  g.gain.value = dbToGain(eq.db ?? 0);
  hp.connect(pk).connect(lp).connect(g).connect(b.out);
  const w = wind(ctx, hp, proc, rng, { strength: o.strength ?? 0.4 });
  b.children.push(w);
  // The rustle: its own noise, a bandpass, a flutter (fast wander on level) and a level that
  // follows strength and gusts.
  const R = eq.rustle;
  const rbp = biquad(ctx, 'bandpass', R.hz, R.q);
  const rg = ctx.createGain();
  rg.gain.value = 0;
  const fl = ctx.createGain();
  fl.gain.value = 1;
  noise(ctx, proc, rng, R.rate ?? 1.21, b.sources).connect(rbp).connect(fl).connect(rg).connect(b.out);
  wander(ctx, proc, rng, R.flutterS, R.flutter, b.sources).connect(fl.gain);
  wander(ctx, proc, rng, R.flutterS * 9, 180, b.sources).connect(rbp.detune);
  const state = { strength: o.strength ?? 0.4, gust: 0 };
  let lastGust = -1;
  const apply = (/** @type {number} */ rampS) => {
    const e = clamp01(state.strength + 0.6 * state.gust);
    glide(rg.gain, dbToGain(R.db) * Math.pow(e, 1.5), ctx, rampS);
  };
  apply(0.01);
  return {
    output: b.out,
    set(params, rampS = 2) {
      if (params.strength !== undefined) { state.strength = params.strength; w.set({ strength: params.strength }, rampS); }
      if (params.gust !== undefined && Math.abs(params.gust - lastGust) > 0.02) {
        const up = params.gust > lastGust;
        lastGust = params.gust; state.gust = params.gust;
        w.set({ gust: params.gust });
        apply(up ? proc.wind.gust.riseS : proc.wind.gust.fallS);
        return;
      }
      apply(rampS);
    },
    stop: (f = 2) => b.stop(f),
  };
}

/**
 * Rain on one surface (or the winter drizzle): a noise texture shaped for the surface, plus
 * seeded drops left and right. set({amount 0..1}).
 * @param {BaseAudioContext} ctx @param {AudioNode} dest @param {any} P one surface from fallbacks.rain
 * @param {any} proc @param {Rng} rng
 * @returns {Bed}
 */
export function rainOn(ctx, dest, P, proc, rng) {
  const b = base(ctx, dest, P.fadeInS ?? 2);
  const state = { amount: 0 };
  const hp = biquad(ctx, 'highpass', P.noise.highpassHz, 0.6);
  const pk = biquad(ctx, 'peaking', P.noise.peak.hz, P.noise.peak.q, P.noise.peak.db);
  const lp = biquad(ctx, 'lowpass', P.noise.lowpassHz, 0.6);
  const ng = ctx.createGain();
  ng.gain.value = 0;
  noise(ctx, proc, rng, P.noise.rate, b.sources).connect(hp).connect(pk).connect(lp).connect(ng).connect(b.out);
  const am = ctx.createGain();
  am.gain.value = 1;
  wander(ctx, proc, rng, P.noise.wanderPeriodS, P.noise.wanderLevel, b.sources).connect(am.gain);
  ng.disconnect(); ng.connect(am).connect(b.out);
  // Drops: two sides through a merger, so the rain has width without a panner per drop.
  const merger = ctx.createChannelMerger(2);
  const sides = [ctx.createGain(), ctx.createGain()];
  sides[0].connect(merger, 0, 0); sides[1].connect(merger, 0, 1);
  const dropLp = biquad(ctx, 'lowpass', P.drops.lowpassHz, 0.6);
  const dropG = ctx.createGain();
  dropG.gain.value = dbToGain(P.drops.db);
  merger.connect(dropLp).connect(dropG).connect(b.out);

  const apply = (/** @type {number} */ rampS) => {
    const a = clamp01(state.amount);
    glide(ng.gain, dbToGain(P.noise.db) * Math.sqrt(a), ctx, rampS);
  };
  apply(0.01);
  if (P.drops.ratePerS[1] > 0) {
    pump(ctx, 0.6, () => {
      const r = Math.max(0.05, lerp(P.drops.ratePerS[0], P.drops.ratePerS[1], clamp01(state.amount)));
      return -Math.log(1 - rng.next()) / r;
    }, (t) => {
      if (state.amount < 0.01) return;
      drop(ctx, sides[rng.int(2)], proc, rng, { when: t, sizeMm: pick(rng, P.drops.sizeMm), gainDb: pick(rng, P.drops.jitterDb) });
    }, b.isStopped, b.timers);
  }
  return {
    output: b.out,
    set(params, rampS = P.rampS ?? 2) { Object.assign(state, params); apply(rampS); },
    stop: (f = 3) => b.stop(f),
  };
}

/**
 * A stream run: the procedural trickle's bubbles over a fuller moving-water band.
 * set({amount 0..1}).
 * @param {BaseAudioContext} ctx @param {AudioNode} dest @param {any} P fallbacks.run @param {any} proc @param {Rng} rng
 * @returns {Bed}
 */
export function run(ctx, dest, P, proc, rng) {
  const b = base(ctx, dest, 2);
  const state = { amount: 0.6 };
  const bp = biquad(ctx, 'bandpass', P.band.hz, P.band.q);
  const lp = biquad(ctx, 'lowpass', P.band.lowpassHz, 0.6);
  const g = ctx.createGain();
  noise(ctx, proc, rng, P.band.rate, b.sources).connect(bp).connect(lp).connect(g).connect(b.out);
  wander(ctx, proc, rng, P.band.wanderPeriodS, P.band.wanderCents, b.sources).connect(bp.detune);
  const tr = trickle(ctx, b.out, proc, rng, { amount: 0.8 });
  b.children.push(tr);
  const apply = (/** @type {number} */ rampS) => {
    const a = clamp01(state.amount);
    glide(g.gain, dbToGain(P.band.db) * a, ctx, rampS);
    tr.set({ amount: lerp(P.bubbles[0], P.bubbles[1], a) }, rampS);
  };
  apply(0.01);
  return {
    output: b.out,
    set(params, rampS = 3) { Object.assign(state, params); apply(rampS); },
    stop: (f = 2) => b.stop(f),
  };
}

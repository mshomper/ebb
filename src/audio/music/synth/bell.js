// @ts-check
// The soft sine bell (doc 24, "Instruments"): a warm, rounded mallet bell for winter shimmer and
// night accents. A sine fundamental plus a few inharmonic partials placed like a struck bar
// (near 2.76, 5.4 and 8.9 times the pitch), each quieter and dying faster than the one below,
// and a quiet hum an octave down that rings longest, for fullness. The fundamental is a slowly
// beating pair (a second sine a fraction of a hertz above), so it shimmers like a cast bell.
// The attack is a short raised-sine swell (no click), velocity mostly opens the upper partials,
// and high notes ring shorter than low ones. Bells are not damped: letting go of the key lets it
// ring unless the recipe or opts.damped says otherwise. Partials that would pass the top of the
// audible band are simply left out. Answers the same calls as createFmPiano. Numbers come from
// recipes/music/synth.json `bell`.

import { velocityDb, midiToHz, dbToGain, pickVictim } from '../sampler-math.js';
import { stream } from '../../../core/rng.js';
import { clamp, createBus, createPedal, swellCurve, tauFor, phasedSine } from './common.js';

/**
 * @typedef {Object} BellVoice
 * @property {number} midi
 * @property {number} startT
 * @property {number} peakDb
 * @property {number} decayS   60 dB time of the fundamental at this note
 * @property {number|null} keyUpT
 * @property {number|null} relT
 * @property {number|null} endT
 * @property {GainNode} rel
 * @property {GainNode} kill
 * @property {OscillatorNode[]} oscs
 */

/**
 * @param {BaseAudioContext} ctx @param {AudioNode} output @param {any} recipe recipes/music/synth.json
 * @param {{tier?: 'desktop'|'mobile', seed?: number, damped?: boolean}} [opts]
 */
export function createBell(ctx, output, recipe, opts = {}) {
  let p = structuredClone(recipe.bell);
  const tier = opts.tier ?? 'desktop';
  const seed = (opts.seed ?? p.seed ?? 1) >>> 0;
  const bus = createBus(ctx, output, p.highpass);
  const pedal = createPedal();
  /** @type {BellVoice[]} */
  let voices = [];
  const damped = () => opts.damped ?? p.damped;

  /** Fundamental 60 dB decay time, log-interpolated between the recipe's low and high notes. @param {number} midi */
  function decayFor(midi) {
    const d = p.decay;
    const x = clamp((midi - d.lowMidi) / Math.max(1, d.highMidi - d.lowMidi), 0, 1);
    return d.lowS * Math.pow(d.highS / d.lowS, x);
  }

  /** @param {BellVoice} v @param {number} t */
  function levelDb(v, t) {
    const held = v.peakDb - (60 * (t - v.startT)) / v.decayS;
    return v.relT !== null && v.relT <= t ? held - (40 * (t - v.relT)) / p.dampS : held;
  }

  /** @param {BellVoice} v @param {number} at */
  function stopAt(v, at) { for (const o of v.oscs) { try { o.stop(at); } catch { /* already */ } } }

  /** A damped release (only when the bell is set to be damped). @param {BellVoice} v @param {number} t */
  function release(v, t) {
    if (v.relT !== null || (v.endT !== null && v.endT <= t)) return;
    v.relT = t;
    v.rel.gain.setValueAtTime(1, t);
    v.rel.gain.setTargetAtTime(0, t, tauFor(p.dampS, 40));
    if (v.endT === null) stopAt(v, t + p.dampS * 2 + 0.05);
  }

  /** @param {BellVoice} v @param {number} t @param {number} s */
  function kill(v, t, s) {
    if (v.endT !== null) {
      if (v.endT <= t) return;
      v.kill.gain.cancelScheduledValues(t);
    }
    v.endT = t;
    v.kill.gain.setValueAtTime(1, t);
    v.kill.gain.linearRampToValueAtTime(0, t + Math.max(0.005, s));
    stopAt(v, t + s + 0.02);
  }

  return {
    /** @param {number} midi @param {number} velocity @param {number} [when] */
    noteOn(midi, velocity, when = ctx.currentTime) {
      const t = Math.max(when, ctx.currentTime);
      // A bar struck again: the old ring fades out under the new stroke over retriggerS.
      for (const v of voices) if (v.midi === midi && (v.endT === null || v.endT > t)) kill(v, t, p.retriggerS);
      const live = voices.filter((v) => v.endT === null || v.endT > t);
      const max = p.maxVoices[tier] ?? 12;
      while (live.length >= max) {
        const i = pickVictim(live.map((v) => ({ released: v.keyUpT !== null, levelDb: levelDb(v, t) })));
        kill(live[i], t, p.stealS);
        live.splice(i, 1);
      }

      // Each bar is tuned once: its partials sit a few cents off ideal, the same every strike.
      const r = stream(seed, midi);
      const f = midiToHz(midi);
      const x = clamp((velocity - 1) / 126, 0, 1);
      const above = Math.max(0, (midi - p.decay.lowMidi) / 12);
      const peakDb = velocityDb(velocity, p.velocity) - p.trebleDbPerOctave * above;
      const decayS = decayFor(midi);
      const attackS = p.attackSoftS + (p.attackLoudS - p.attackSoftS) * x;
      const nyq = Math.min(p.maxPartialHz, ctx.sampleRate * 0.45);

      const rel = ctx.createGain();
      const killG = ctx.createGain();
      rel.connect(killG).connect(bus.input);
      /** @type {OscillatorNode[]} */
      const oscs = [];
      let longest = 0;
      let longestOsc = 0;
      const lowest = midiToHz(p.minPartialMidi);
      const parts = /** @type {{ratio: number, db: number, decayRatio: number, velocityDb: number, pan: number, pair?: {hz: number[], db: number}}[]} */ (p.partials);
      for (const pt of parts) {
        const pf = f * pt.ratio * Math.pow(2, (r.range(-1, 1) * p.partialJitterCents) / 1200);
        // Draws above happen for every partial, so each partial's tuning stays fixed per note.
        const beatHz = pt.pair ? r.range(pt.pair.hz[0], pt.pair.hz[1]) : 0;
        // The pair starts phaseTurns of a cycle ahead or behind (side from the seed): at a quarter
        // turn every strike starts at the same level, whichever way the beat then moves.
        const beatPhase = (r.next() < 0.5 ? 1 : -1) * Math.round((pt.pair?.phaseTurns ?? 0.25) * 8);
        if ((pf > nyq || pf < lowest) && pt.ratio !== 1) continue;
        // Upper partials: lower at soft velocity (velocityDb is how much they lose at velocity 1).
        const db = pt.db - pt.velocityDb * Math.pow(1 - x, p.velocityGamma);
        const life = decayS * pt.decayRatio;
        if (life > longest) { longest = life; longestOsc = oscs.length; }
        const osc = ctx.createOscillator();
        osc.frequency.value = pf;
        const env = ctx.createGain();
        // The beating pair: a second sine beatHz above, sharing this partial's envelope.
        /** @type {OscillatorNode|null} */
        let twin = null;
        if (pt.pair) {
          twin = ctx.createOscillator();
          twin.setPeriodicWave(phasedSine(ctx, beatPhase));
          twin.frequency.value = pf + beatHz;
          const tg = ctx.createGain();
          tg.gain.value = dbToGain(pt.pair.db);
          twin.connect(tg).connect(env);
        }
        const top = dbToGain(peakDb + db);
        env.gain.value = 0;
        // Partials swell over the shared attack, then fall `life` seconds to 60 dB down.
        env.gain.setValueCurveAtTime(swellCurve(32, 1).map((c) => c * top), t, attackS);
        env.gain.setTargetAtTime(0, t + attackS + 1e-4, tauFor(life, 60));
        const pan = ctx.createStereoPanner();
        pan.pan.value = clamp(pt.pan * p.stereoWidth, -1, 1);
        osc.connect(env).connect(pan).connect(rel);
        osc.start(t);
        osc.stop(t + attackS + life * 1.4 + 0.05); // 84 dB down
        oscs.push(osc);
        if (twin) {
          twin.start(t);
          twin.stop(t + attackS + life * 1.4 + 0.05);
          oscs.push(twin);
        }
      }
      /** @type {BellVoice} */
      const v = { midi, startT: t, peakDb, decayS, keyUpT: null, relT: null, endT: null, rel, kill: killG, oscs };
      voices.push(v);
      // Free the voice when its longest-ringing partial ends.
      oscs[longestOsc].onended = () => { killG.disconnect(); voices = voices.filter((u) => u !== v); };
      return 1;
    },
    /** @param {number} midi @param {number} [when] */
    noteOff(midi, when = ctx.currentTime) {
      const t = Math.max(when, ctx.currentTime);
      for (const v of voices) {
        if (v.midi !== midi || v.keyUpT !== null) continue;
        v.keyUpT = t;
        if (!damped()) continue;
        const at = pedal.downAt(t) ? pedal.nextUpAfter(t) : t;
        if (at !== null) release(v, at);
      }
    },
    /** @param {boolean} down @param {number} [when] */
    pedal(down, when = ctx.currentTime) {
      const t = Math.max(when, ctx.currentTime);
      pedal.push(t, down);
      if (!down && damped()) for (const v of voices) if (v.keyUpT !== null && v.keyUpT <= t) release(v, t);
    },
    /** @param {number} [fadeS] */
    stopAll(fadeS = 0.3) { const t = ctx.currentTime; for (const v of voices) kill(v, t, fadeS); pedal.clear(); },
    /** @param {any} next */
    setSettings(next) { p = { ...p, ...structuredClone(next) }; bus.set(p.highpass); },
    get settings() { return p; },
    async load() {},
    stats() { return { voices: voices.filter((v) => v.endT === null).length, files: 0, decodedMB: 0, downloadedMB: 0, format: 'built in code' }; },
    zones() { return []; },
    ready() { return true; },
    onPedal() {},
    instrument: { id: 'bell', name: 'Soft bell (built in code)' },
  };
}

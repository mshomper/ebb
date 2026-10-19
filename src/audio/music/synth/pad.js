// @ts-check
// The warm pad (doc 24, "Instruments"): the bed under the piano. Each note is two or three softly
// detuned oscillators (a band-limited saw with its upper harmonics already rolled off, and a
// triangle), each drifting a cent or two on its own very slow cycle so the chord breathes instead
// of wobbling. The detune is capped by a beat rate, so high notes never shimmer like a chorus.
// They pass through a smooth lowpass whose cutoff rises with velocity and register, opens a little
// over the slow attack and then settles (the bloom), and closes a touch as the note fades.
// Answers the same calls as createFmPiano. Numbers come from recipes/music/synth.json `pad`.

import { velocityDb, midiToHz, dbToGain, pickVictim } from '../sampler-math.js';
import { stream } from '../../../core/rng.js';
import { butterQs, qDb, clamp, createBus, createPedal, swellCurve, tauFor } from './common.js';

/**
 * @typedef {Object} PadVoice
 * @property {number} midi
 * @property {number} startT
 * @property {number} peakDb
 * @property {number} cutoff   settled lowpass cutoff in Hz
 * @property {number|null} keyUpT
 * @property {number|null} relT  when the release began (key up with no pedal, or pedal up)
 * @property {number|null} endT  when a quick fade (steal, retrigger, stopAll) began
 * @property {BiquadFilterNode[]} filters
 * @property {GainNode} amp
 * @property {GainNode} rel
 * @property {GainNode} kill
 * @property {AudioScheduledSourceNode[]} srcs
 */

/**
 * @param {BaseAudioContext} ctx @param {AudioNode} output @param {any} recipe recipes/music/synth.json
 * @param {{tier?: 'desktop'|'mobile', seed?: number}} [opts]
 */
export function createPad(ctx, output, recipe, opts = {}) {
  let p = structuredClone(recipe.pad);
  const tier = opts.tier ?? 'desktop';
  const seed = (opts.seed ?? p.seed ?? 1) >>> 0;
  const bus = createBus(ctx, output, p.highpass);
  const pedal = createPedal();
  /** @type {PadVoice[]} */
  let voices = [];
  let count = 0;
  /** @type {Map<string, PeriodicWave>} */
  const waves = new Map();

  /**
   * Band-limited soft saw: harmonic n at 1/n^tilt, from `fromHarmonic` up to `harmonics`. Leaving
   * out the fundamental lets the centred copy own it, so detuned copies never make the level pump.
   */
  function softSaw() {
    const { harmonics, tilt, fromHarmonic = 1 } = p.softSaw;
    const key = `saw:${harmonics}:${tilt}:${fromHarmonic}`;
    let w = waves.get(key);
    if (!w) {
      const n = Math.max(2, Math.round(harmonics)) + 1;
      const re = new Float32Array(n), im = new Float32Array(n);
      for (let k = Math.max(1, fromHarmonic); k < n; k++) im[k] = (k % 2 ? 1 : -1) / Math.pow(k, tilt);
      // Unnormalized, so a copy's level means the same with or without its fundamental.
      w = ctx.createPeriodicWave(re, im, { disableNormalization: true });
      waves.set(key, w);
    }
    return w;
  }

  /** A unit sine for the drift, starting at one of eight phases. @param {number} k */
  function lfoWave(k) {
    const key = `lfo:${k}`;
    let w = waves.get(key);
    if (!w) {
      const ph = (2 * Math.PI * k) / 8;
      w = ctx.createPeriodicWave(new Float32Array([0, Math.sin(ph)]), new Float32Array([0, Math.cos(ph)]), { disableNormalization: true });
      waves.set(key, w);
    }
    return w;
  }

  /** Settled cutoff for a note: velocity opens it, register raises it by less than the pitch rises. @param {number} midi @param {number} x */
  function cutoffHz(midi, x) {
    const f = p.filter;
    const base = f.softHz * Math.pow(f.loudHz / f.softHz, Math.pow(x, f.gamma));
    const c = base * Math.pow(2, ((midi - f.refMidi) / 12) * f.keyTrack);
    return clamp(c, midiToHz(midi) * f.minHarmonic, Math.min(f.maxHz, ctx.sampleRate * 0.45));
  }

  /** @param {PadVoice} v @param {number} t */
  const levelDb = (v, t) => (v.relT !== null && v.relT <= t ? v.peakDb - (40 * (t - v.relT)) / p.amp.releaseS : v.peakDb);

  /** @param {PadVoice} v @param {number} t @param {number} stopAt */
  function stopSources(v, t, stopAt) { for (const s of v.srcs) { try { s.stop(Math.max(t, stopAt)); } catch { /* already */ } } }

  /** The long release: falls 40 dB over releaseS while the lowpass closes a little. @param {PadVoice} v @param {number} t */
  function release(v, t) {
    if (v.relT !== null || (v.endT !== null && v.endT <= t)) return;
    v.relT = t;
    v.rel.gain.setValueAtTime(1, t);
    v.rel.gain.setTargetAtTime(0, t, tauFor(p.amp.releaseS, 40));
    for (const fl of v.filters) {
      fl.frequency.cancelScheduledValues(t);
      fl.frequency.setTargetAtTime(v.cutoff * p.filter.releaseRatio, t, p.amp.releaseS / 3);
    }
    if (v.endT === null) stopSources(v, t, t + p.amp.releaseS * 2 + 0.05); // 80 dB down
  }

  /** A quick linear fade for stealing, retriggering and stopAll: never a click. @param {PadVoice} v @param {number} t @param {number} s */
  function kill(v, t, s) {
    if (v.endT !== null) {
      if (v.endT <= t) return;
      v.kill.gain.cancelScheduledValues(t);
    }
    v.endT = t;
    v.kill.gain.setValueAtTime(1, t);
    v.kill.gain.linearRampToValueAtTime(0, t + Math.max(0.005, s));
    stopSources(v, t, t + s + 0.02);
  }

  return {
    /** @param {number} midi @param {number} velocity @param {number} [when] */
    noteOn(midi, velocity, when = ctx.currentTime) {
      const t = Math.max(when, ctx.currentTime);
      for (const v of voices) if (v.midi === midi && (v.endT === null || v.endT > t)) kill(v, t, p.retriggerS);
      const live = voices.filter((v) => v.endT === null || v.endT > t);
      const max = p.maxVoices[tier] ?? 12;
      while (live.length >= max) {
        const i = pickVictim(live.map((v) => ({ released: v.keyUpT !== null, levelDb: levelDb(v, t) })));
        kill(live[i], t, p.stealS);
        live.splice(i, 1);
      }

      const r = stream(seed, midi, count++);
      const f = midiToHz(midi);
      const x = clamp((velocity - 1) / 126, 0, 1);
      const below = Math.max(0, (p.filter.refMidi - midi) / 12);
      const peakDb = velocityDb(velocity, p.velocity) - p.bassDbPerOctave * below;
      const attackS = p.amp.attackSoftS + (p.amp.attackLoudS - p.amp.attackSoftS) * x;

      // Detune, capped so the outer pair never beats faster than maxBeatHz at the fundamental.
      const oscs = /** @type {{wave: string, cents: number, db: number, pan: number, octave?: number}[]} */ (p.oscillators);
      const cents = oscs.map((o) => o.cents);
      const spread = Math.max(...cents) - Math.min(...cents);
      const capCents = 1200 * Math.log2(1 + p.detune.maxBeatHz / f);
      const scale = (spread > capCents ? capCents / spread : 1) * p.detune.amount;
      const power = oscs.reduce((a, o) => a + dbToGain(2 * o.db), 0);
      const norm = dbToGain(peakDb) / Math.sqrt(Math.max(1e-6, power));

      // Lowpass with the bloom: start closed, open past the settled cutoff over the attack, settle.
      const cutoff = cutoffHz(midi, x);
      const b = p.filter.bloom;
      const filters = butterQs(p.filter.poles).map((q) => {
        const fl = ctx.createBiquadFilter();
        fl.type = 'lowpass';
        fl.Q.value = qDb(q);
        fl.frequency.setValueAtTime(cutoff * b.startRatio, t);
        fl.frequency.setTargetAtTime(cutoff * b.peakRatio, t, attackS / 2.5);
        fl.frequency.setTargetAtTime(cutoff, t + attackS, b.settleS / 3);
        return fl;
      });
      for (let i = 1; i < filters.length; i++) filters[i - 1].connect(filters[i]);

      const amp = ctx.createGain();
      amp.gain.value = 0;
      amp.gain.setValueCurveAtTime(swellCurve(64, p.amp.attackCurve), t, attackS);
      amp.gain.setTargetAtTime(dbToGain(p.amp.sustainDb), t + attackS + 1e-4, p.amp.settleS / 3);
      const rel = ctx.createGain();
      const killG = ctx.createGain();
      filters[filters.length - 1].connect(amp).connect(rel).connect(killG).connect(bus.input);

      /** @type {AudioScheduledSourceNode[]} */
      const srcs = [];
      for (const o of oscs) {
        const osc = ctx.createOscillator();
        if (o.wave === 'softSaw') osc.setPeriodicWave(softSaw());
        else osc.type = /** @type {OscillatorType} */ (o.wave);
        osc.frequency.value = f * Math.pow(2, o.octave ?? 0);
        osc.detune.value = o.cents * scale;
        // Drift: its own slow sine, own rate and phase, a cent or two deep.
        const lfo = ctx.createOscillator();
        lfo.setPeriodicWave(lfoWave(r.int(8)));
        lfo.frequency.value = r.range(p.drift.rateHz[0], p.drift.rateHz[1]);
        const depth = ctx.createGain();
        depth.gain.value = p.drift.cents * Math.min(1, scale / Math.max(1e-6, p.detune.amount));
        lfo.connect(depth).connect(osc.detune);
        const g = ctx.createGain();
        g.gain.value = dbToGain(o.db) * norm;
        const pan = ctx.createStereoPanner();
        pan.pan.value = clamp(o.pan * p.stereoWidth, -1, 1);
        osc.connect(g).connect(pan).connect(filters[0]);
        // A random start within one cycle, so the detuned copies never begin phase-locked.
        osc.start(t + r.next() / osc.frequency.value);
        lfo.start(t);
        srcs.push(osc, lfo);
      }

      /** @type {PadVoice} */
      const v = { midi, startT: t, peakDb, cutoff, keyUpT: null, relT: null, endT: null, filters, amp, rel, kill: killG, srcs };
      voices.push(v);
      srcs[0].onended = () => { killG.disconnect(); voices = voices.filter((u) => u !== v); };
      return 1;
    },
    /** @param {number} midi @param {number} [when] */
    noteOff(midi, when = ctx.currentTime) {
      const t = Math.max(when, ctx.currentTime);
      for (const v of voices) {
        if (v.midi !== midi || v.keyUpT !== null) continue;
        v.keyUpT = t;
        // Pedal held: release when it lifts, even if that lift was scheduled before this note.
        const at = pedal.downAt(t) ? pedal.nextUpAfter(t) : t;
        if (at !== null) release(v, at);
      }
    },
    /** @param {boolean} down @param {number} [when] */
    pedal(down, when = ctx.currentTime) {
      const t = Math.max(when, ctx.currentTime);
      pedal.push(t, down);
      if (!down) for (const v of voices) if (v.keyUpT !== null && v.keyUpT <= t) release(v, t);
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
    instrument: { id: 'pad', name: 'Warm pad (built in code)' },
  };
}

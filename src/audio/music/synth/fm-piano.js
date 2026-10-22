// @ts-check
// The two-operator FM electric piano (doc 24), compared on the instrument bench against the
// sampled Yamaha TX81Z. It answers the same calls as the sampler (noteOn, noteOff, pedal,
// stopAll), so the realizer can treat either one as an instrument. Numbers come from
// recipes/music/synth.json `fmPiano`. Re-exported by ../synth.js.

import { velocityDb, midiToHz, dbToGain, pickVictim } from '../sampler-math.js';

/**
 * @param {BaseAudioContext} ctx @param {AudioNode} output @param {any} recipe recipes/music/synth.json
 * @param {{}} [opts]
 */
export function createFmPiano(ctx, output, recipe, opts = {}) {
  let p = structuredClone(recipe.fmPiano);
  /** @typedef {{midi: number, startT: number, peakDb: number, keyUpT: number|null, endT: number|null, env: GainNode, oscs: OscillatorNode[]}} FmVoice */
  /** @type {FmVoice[]} */
  let voices = [];
  /** @type {{t: number, down: boolean}[]} */
  let pedalEvents = [];

  /** @param {number} t */
  const pedalDownAt = (t) => { let d = false; for (const e of pedalEvents) { if (e.t <= t) d = e.down; else break; } return d; };

  /** @param {FmVoice} v @param {number} t @param {number} s */
  function end(v, t, s) {
    if (v.endT !== null && v.endT <= t) return;
    v.endT = t;
    v.env.gain.cancelScheduledValues(t);
    v.env.gain.setTargetAtTime(0, t, s / 4);
    for (const o of v.oscs) { try { o.stop(t + s * 2 + 0.05); } catch { /* already */ } }
  }

  /**
   * One FM stack: carrier at f·cr, modulator at f·mr with index falling from i0 to i1.
   * @param {number} f @param {number} cr @param {number} mr @param {number} i0 @param {number} i1 @param {number} decayS @param {number} t @param {AudioNode} dest @param {number} gain @param {number} cents
   */
  function stack(f, cr, mr, i0, i1, decayS, t, dest, gain, cents) {
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    car.frequency.value = f * cr;
    car.detune.value = cents;
    mod.frequency.value = f * mr;
    mod.detune.value = cents;
    const depth = ctx.createGain();
    const fm = f * mr;
    depth.gain.setValueAtTime(i0 * fm, t);
    depth.gain.setTargetAtTime(i1 * fm, t, decayS / 3);
    const g = ctx.createGain();
    g.gain.value = gain;
    mod.connect(depth).connect(car.frequency);
    car.connect(g).connect(dest);
    car.start(t);
    mod.start(t);
    return [car, mod];
  }

  return {
    /** @param {number} midi @param {number} velocity @param {number} [when] */
    noteOn(midi, velocity, when = ctx.currentTime) {
      const t = Math.max(when, ctx.currentTime);
      for (const v of voices) if (v.midi === midi && v.endT === null) end(v, t, 0.03);
      const live = voices.filter((v) => v.endT === null || v.endT > t);
      const max = (typeof p.maxVoices === 'number' ? p.maxVoices : p.maxVoices?.desktop) ?? 16;
      while (live.length >= max) {
        const i = pickVictim(live.map((v) => ({ released: v.keyUpT !== null, levelDb: v.peakDb - p.amp.decayDbPerS * (t - v.startT) })));
        end(live[i], t, 0.03);
        live.splice(i, 1);
      }
      const f = midiToHz(midi);
      const vx = Math.max(0, Math.min(1, (velocity - 1) / 126));
      const peakDb = velocityDb(velocity, p.velocity);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(dbToGain(peakDb), t + p.amp.attackS);
      const octaves = Math.max(0, (midi - 60) / 12);
      const decay = p.amp.decayDbPerS + p.amp.trebleDecayExtra * octaves;
      // Exponential fall of `decay` dB per second while held.
      env.gain.setTargetAtTime(0, t + p.amp.attackS, 8.686 / Math.max(0.1, decay));
      env.connect(output);
      const bi = 1 - p.body.velocityIndex * (1 - vx);
      const ti = 1 - p.tine.velocityIndex * (1 - vx);
      const oscs = [
        ...stack(f, 1, p.body.ratio, p.body.index0 * bi, p.body.index1 * bi, p.body.indexDecayS, t, env, dbToGain(p.body.db) * (p.detuneCents ? 0.5 : 1), p.detuneCents / 2),
        ...(p.detuneCents ? stack(f, 1, p.body.ratio, p.body.index0 * bi, p.body.index1 * bi, p.body.indexDecayS, t, env, dbToGain(p.body.db) * 0.5, -p.detuneCents / 2) : []),
      ];
      // The tine: its own short envelope.
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(dbToGain(p.tine.db) * ti, t);
      tg.gain.setTargetAtTime(0, t, p.tine.decayS / 3);
      tg.connect(env);
      oscs.push(...stack(f, p.tine.carrierRatio, p.tine.ratio, p.tine.index0 * ti, 0, p.tine.decayS, t, tg, 1, 0));
      voices.push({ midi, startT: t, peakDb, keyUpT: null, endT: null, env, oscs });
      // Free voices that have died away (60 dB down).
      const life = 60 / Math.max(0.1, decay) + 0.5;
      for (const o of oscs) o.stop(t + life);
      oscs[0].onended = () => { env.disconnect(); voices = voices.filter((v) => v.env !== env); };
      return 1;
    },
    /** @param {number} midi @param {number} [when] */
    noteOff(midi, when = ctx.currentTime) {
      const t = Math.max(when, ctx.currentTime);
      for (const v of voices) {
        if (v.midi !== midi || v.keyUpT !== null) continue;
        v.keyUpT = t;
        if (!pedalDownAt(t)) end(v, t, p.amp.releaseS);
      }
    },
    /** @param {boolean} down @param {number} [when] */
    pedal(down, when = ctx.currentTime) {
      const t = Math.max(when, ctx.currentTime);
      pedalEvents.push({ t, down });
      pedalEvents.sort((a, b) => a.t - b.t);
      if (!down) for (const v of voices) if (v.keyUpT !== null && v.keyUpT <= t) end(v, t, p.amp.releaseS);
    },
    /** @param {number} [fadeS] */
    stopAll(fadeS = 0.3) { for (const v of voices) end(v, ctx.currentTime, fadeS); pedalEvents = []; },
    /** @param {any} next */
    setSettings(next) { p = { ...p, ...structuredClone(next) }; },
    get settings() { return p; },
    async load() {},
    stats() { return { voices: voices.filter((v) => v.endT === null).length, files: 0, decodedMB: 0, downloadedMB: 0, format: 'built in code' }; },
    zones() { return []; },
    ready() { return true; },
    onPedal() {},
    instrument: { id: 'fm-piano-code', name: 'FM piano (built in code)' },
  };
}

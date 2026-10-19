// @ts-check
// Plays a recorded instrument (doc 24, "Sampler rules"). Each note picks the nearest recorded zone
// (at most a semitone away), sounds one or two velocity layers with an equal-power crossfade so a
// slow crescendo never steps, levels every recording by its measured attack and rebuilds the
// dynamic range from velocity, opens a lowpass with velocity as a hammer does, and corrects pitch
// by the chosen tuning policy. Keys release through dampers (slow in the bass, none at the very
// top, as on a grand) with the recorded key-off sound; the sustain pedal holds released keys until
// it lifts; a repeated key damps its old string; when too many voices sound, the quietest released
// one is faded out over 30 ms, never cut.
//
// All behaviour comes from recipes/music/sampler.json (see samplerSettingsFor in ../recipes.js) and
// the instrument recipe (recipes/music/instruments/<id>.json). Everything is scheduled on the
// audio clock, so callers pass the time each event should happen.

import {
  layerWeights, evenBounds, velocityDb, fileGainDb, registerTiltDb, velocityCutoffHz, nearestZone,
  correctionCents, playbackRate, damperTau, decayDbPerS, pickVictim, dbToGain,
} from './sampler-math.js';
import { REPO_ROOT } from '../recipes.js';

/**
 * @typedef {Object} Voice
 * @property {number} id
 * @property {number} midi
 * @property {number} velocity
 * @property {number} startT       audio time it began
 * @property {number} peakDb       attack level it was aimed at
 * @property {number|null} keyUpT  when its key was released, null while held
 * @property {number|null} dampT   when its dampers fell (or it was stolen), null if still ringing
 * @property {GainNode} env
 * @property {AudioBufferSourceNode[]} srcs
 * @property {number} zoneIndex
 * @property {string} set
 * @property {number} layer        the main layer sounded (for the release sound)
 * @property {boolean} ended
 */

/** Pick the file format this browser can decode. */
export function pickFormat() {
  const a = typeof Audio !== 'undefined' ? new Audio() : null;
  return a && a.canPlayType('audio/ogg; codecs="opus"') ? 'ogg' : 'm4a';
}

/**
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} output  where voices connect (the music bus input, or a bench gain)
 * @param {any} instrument    recipes/music/instruments/<id>.json
 * @param {any} settings      samplerSettingsFor(recipes/music/sampler.json, id)
 * @param {{tier?: 'desktop'|'mobile', format?: 'ogg'|'m4a'}} [opts]
 */
export function createSampler(ctx, output, instrument, settings, opts = {}) {
  const tier = opts.tier ?? 'desktop';
  const format = opts.format ?? pickFormat();
  let cfg = structuredClone(settings);
  /** @type {Map<string, AudioBuffer>} */
  const buffers = new Map();
  /** @type {Map<string, Promise<AudioBuffer|null>>} */
  const pending = new Map();
  /** @type {Voice[]} */
  let voices = [];
  /** @type {{t: number, down: boolean}[]} */
  let pedalEvents = [];
  let nextId = 1;
  let decodedBytes = 0;
  let downloadedBytes = 0;
  /** @type {((name: string) => void) | null} */
  let onPedalNoise = null;

  const sets = instrument.sets ?? {};
  /** @param {string} name */
  const zonesOf = (name) => /** @type {any[]} */ (sets[name]?.zones ?? []);
  /** @param {string} name */
  const zoneMidis = (name) => zonesOf(name).map((z) => z.midi);

  /** @param {string} file */
  function urlOf(file) {
    return new URL(`${instrument.root}${file}.${format}`, REPO_ROOT).href;
  }

  /**
   * Decode one file once, applying the load options (tail trim, mono below a key).
   * @param {string} file @param {number} midi
   */
  function loadFile(file, midi) {
    const key = file;
    const have = buffers.get(key);
    if (have) return Promise.resolve(have);
    let p = pending.get(key);
    if (!p) {
      p = (async () => {
        try {
          const r = await fetch(urlOf(file));
          if (!r.ok) throw new Error(`${r.status}`);
          const bytes = await r.arrayBuffer();
          downloadedBytes += bytes.byteLength;
          let buf = await ctx.decodeAudioData(bytes);
          buf = shape(buf, midi);
          buffers.set(key, buf);
          decodedBytes += buf.length * buf.numberOfChannels * 4;
          return buf;
        } catch (e) {
          console.warn(`[sampler] could not load ${file}`, e);
          return null;
        } finally {
          pending.delete(key);
        }
      })();
      pending.set(key, p);
    }
    return p;
  }

  /**
   * Trim a long tail with a gentle fade, and fold to mono below a key, if the settings ask.
   * @param {AudioBuffer} buf @param {number} midi
   */
  function shape(buf, midi) {
    const maxS = cfg.load.maxTailS;
    const mono = cfg.load.monoBelowMidi > 0 && midi < cfg.load.monoBelowMidi && buf.numberOfChannels > 1;
    const len = maxS > 0 ? Math.min(buf.length, Math.round(maxS * buf.sampleRate)) : buf.length;
    if (!mono && len === buf.length) return buf;
    const chans = mono ? 1 : buf.numberOfChannels;
    const out = ctx.createBuffer(chans, len, buf.sampleRate);
    const fadeN = len < buf.length ? Math.min(len, Math.round(0.25 * buf.sampleRate)) : 0;
    for (let c = 0; c < chans; c++) {
      const dst = out.getChannelData(c);
      if (mono) {
        const n = buf.numberOfChannels;
        for (let k = 0; k < n; k++) {
          const src = buf.getChannelData(k);
          for (let i = 0; i < len; i++) dst[i] += src[i] / n;
        }
      } else {
        dst.set(buf.getChannelData(c).subarray(0, len));
      }
      for (let i = 0; i < fadeN; i++) dst[len - fadeN + i] *= Math.cos((i / fadeN) * Math.PI / 2);
    }
    return out;
  }

  /**
   * Load every file needed to play notes from low to high (MIDI), in the configured sets.
   * @param {{low?: number, high?: number, sets?: string[], onProgress?: (done: number, total: number) => void}} [o]
   */
  async function load(o = {}) {
    const low = o.low ?? 0, high = o.high ?? 127;
    const want = /** @type {string[]} */ (o.sets ?? cfg.load.sets).filter((s) => sets[s]);
    /** @type {[string, number][]} */
    const jobs = [];
    for (const s of want) {
      const zones = zonesOf(s);
      const mids = zones.map((z) => z.midi);
      const needed = new Set();
      for (let m = low; m <= high; m++) { const i = nearestZone(m, mids); if (i >= 0) needed.add(i); }
      for (const i of needed) for (const L of zones[i].layers ?? [zones[i]]) if (L.file) jobs.push([L.file, zones[i].midi]);
    }
    if (sets.pedal?.files) for (const f of sets.pedal.files) jobs.push([f.file, 60]);
    let done = 0;
    const limit = 8;
    let k = 0;
    async function worker() {
      while (k < jobs.length) {
        const [f, m] = jobs[k++];
        await loadFile(f, m);
        o.onProgress?.(++done, jobs.length);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  }

  /** @param {number} t */
  function pedalDownAt(t) {
    let down = false;
    for (const e of pedalEvents) { if (e.t <= t) down = e.down; else break; }
    return down;
  }
  /** First pedal lift strictly after t, or null. @param {number} t */
  function nextLiftAfter(t) {
    for (const e of pedalEvents) if (e.t > t && !e.down) return e.t;
    return null;
  }

  /** The set to sound: the pedal-down recordings while the pedal is down, if this piano has them. @param {boolean} pedal */
  function setFor(pedal) {
    const order = pedal ? ['sus', 'nosus'] : ['nosus', 'sus'];
    for (const s of order) if (zonesOf(s).length) return s;
    return Object.keys(sets).find((s) => zonesOf(s).length) ?? 'sus';
  }

  /** Estimated level of a voice now, in dB, for voice stealing. @param {Voice} v @param {number} t */
  function levelNow(v, t) {
    if (v.dampT !== null && t > v.dampT) return -120;
    return v.peakDb - decayDbPerS(v.midi, cfg.stealing.decay) * Math.max(0, t - v.startT);
  }

  /** @param {Voice} v @param {number} t @param {number} tau */
  function damp(v, t, tau) {
    if (v.dampT !== null && v.dampT <= t) return;
    v.dampT = t;
    const g = v.env.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(0, t, tau);
    for (const s of v.srcs) { try { s.stop(t + tau * 8 + 0.05); } catch { /* already stopped */ } }
  }

  /**
   * Stop a string through its damper at time t, with the key-off sound.
   * @param {Voice} v @param {number} t @param {number} [extraDb]
   */
  function release(v, t, extraDb = 0) {
    const tau = damperTau(v.midi, cfg.dampers);
    if (!Number.isFinite(tau)) return; // undamped top strings ring on
    damp(v, t, tau);
    playReleaseSound(v, t, extraDb);
  }

  /** @param {Voice} v @param {number} t @param {number} extraDb */
  function playReleaseSound(v, t, extraDb) {
    const zones = zonesOf('rel');
    if (!zones.length) return;
    const zi = nearestZone(v.midi, zones.map((z) => z.midi));
    const z = zones[zi];
    const layers = z.layers ?? [z];
    const L = layers[Math.min(v.layer, layers.length - 1)];
    const buf = L && buffers.get(L.file);
    if (!buf) return;
    const held = (v.keyUpT ?? t) - v.startT;
    const boost = held < cfg.release.shortNoteS ? cfg.release.shortNoteBoostDb : 0;
    const db = fileGainDb(v.peakDb + cfg.release.db + boost + extraDb, L.attackRmsDb ?? -20);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = playbackRate(v.midi, z.midi, 0);
    const g = ctx.createGain();
    g.gain.value = dbToGain(db);
    src.connect(g).connect(output);
    src.start(t);
  }

  /**
   * Strike a key.
   * @param {number} midi @param {number} velocity 1..127 @param {number} [when] audio time, default now
   * @returns {number} voice id, or 0 if nothing could sound (files not loaded)
   */
  function noteOn(midi, velocity, when = ctx.currentTime) {
    const t = Math.max(when, ctx.currentTime);
    const pedal = pedalDownAt(t);
    const set = setFor(pedal);
    const zones = zonesOf(set);
    const zi = nearestZone(midi, zones.map((z) => z.midi));
    if (zi < 0) return 0;
    const zone = zones[zi];
    const layers = zone.layers ?? [zone];
    const bounds = cfg.layers.bounds?.length === layers.length - 1 ? cfg.layers.bounds : evenBounds(layers.length);
    const weights = layerWeights(velocity, bounds, cfg.layers.fadeWidth, cfg.layers.law ?? 1);

    // A repeated key: the hammer stops the old vibration.
    for (const v of voices) if (v.midi === midi && !v.ended && (v.dampT === null || v.dampT > t)) damp(v, t, cfg.retrigger.dampS / 3);

    // Too many voices: fade the quietest, released ones first.
    const max = cfg.stealing.maxVoices[tier] ?? 24;
    let live = voices.filter((v) => !v.ended && (v.dampT === null || v.dampT > t));
    while (live.length >= max) {
      const i = pickVictim(live.map((v) => ({ released: v.keyUpT !== null, levelDb: levelNow(v, t) })));
      damp(live[i], t, cfg.stealing.fadeS / 3);
      live.splice(i, 1);
    }

    const targetDb = velocityDb(velocity, cfg.velocity);
    const tiltDb = registerTiltDb(midi, cfg.register);
    const corr = correctionCents(cfg.tuning.policy, zone.midi, zone.measuredCents, zone.tuneConfidence, cfg.tuning);
    const rate = playbackRate(midi, zone.midi, corr);

    const env = ctx.createGain();
    env.gain.value = 1;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = velocityCutoffHz(velocity, midi, cfg.brightness);
    lp.Q.value = cfg.brightness.q ?? 0.5;
    lp.connect(env).connect(output);

    /** @type {AudioBufferSourceNode[]} */
    const srcs = [];
    let mainLayer = weights[0].layer;
    let mainW = 0;
    for (const w of weights) {
      const L = layers[w.layer];
      const buf = L && buffers.get(L.file);
      if (!buf || w.weight <= 0) continue;
      if (w.weight > mainW) { mainW = w.weight; mainLayer = w.layer; }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.value = w.weight * dbToGain(fileGainDb(targetDb, L.attackRmsDb ?? -20, tiltDb));
      src.connect(g).connect(lp);
      src.start(t);
      srcs.push(src);
    }
    if (!srcs.length) { lp.disconnect(); env.disconnect(); return 0; }

    /** @type {Voice} */
    const v = { id: nextId++, midi, velocity, startT: t, peakDb: targetDb + tiltDb, keyUpT: null, dampT: null, env, srcs, zoneIndex: zi, set, layer: mainLayer, ended: false };
    let left = srcs.length;
    for (const s of srcs) s.onended = () => { if (--left === 0) { v.ended = true; env.disconnect(); voices = voices.filter((x) => x !== v); } };
    voices.push(v);
    return v.id;
  }

  /**
   * Release a key. Under the pedal the string keeps ringing until the pedal lifts.
   * @param {number} midi @param {number} [when]
   */
  function noteOff(midi, when = ctx.currentTime) {
    const t = Math.max(when, ctx.currentTime);
    for (const v of voices) {
      if (v.midi !== midi || v.keyUpT !== null || v.ended) continue;
      v.keyUpT = t;
      if (pedalDownAt(t)) {
        const lift = nextLiftAfter(t);
        if (lift !== null) release(v, lift, -6);
      } else {
        release(v, t);
      }
    }
  }

  /**
   * Press or lift the sustain pedal. Lifting stops every released key at once, each with a
   * quieter key-off sound (dampers falling together), at most six of them.
   * @param {boolean} down @param {number} [when]
   */
  function pedal(down, when = ctx.currentTime) {
    const t = Math.max(when, ctx.currentTime);
    pedalEvents.push({ t, down });
    pedalEvents.sort((a, b) => a.t - b.t);
    // Forget pedal history older than a few seconds.
    const keepFrom = ctx.currentTime - 5;
    while (pedalEvents.length > 2 && pedalEvents[1].t < keepFrom) pedalEvents.shift();
    if (!down) {
      let sounded = 0;
      for (const v of voices) {
        if (v.keyUpT !== null && v.keyUpT <= t && v.dampT === null && !v.ended) {
          const tau = damperTau(v.midi, cfg.dampers);
          if (!Number.isFinite(tau)) continue;
          damp(v, t, tau);
          if (sounded++ < 6) playReleaseSound(v, t, -6);
        }
      }
    }
    onPedalNoise?.(down ? 'down' : 'up');
  }

  /** Fade everything out (mute, tab hidden, piece stopped). @param {number} [fadeS] */
  function stopAll(fadeS = 0.3) {
    const t = ctx.currentTime;
    for (const v of voices) damp(v, t, fadeS / 3);
    pedalEvents = [];
  }

  return {
    load,
    noteOn,
    noteOff,
    pedal,
    stopAll,
    /** Change settings live (the bench's sliders). New notes use them. @param {any} next */
    setSettings(next) { cfg = { ...cfg, ...structuredClone(next) }; },
    get settings() { return cfg; },
    /** Called on each pedal press and lift, so a pedal-noise player can follow. @param {(name: string) => void} fn */
    onPedal(fn) { onPedalNoise = fn; },
    /** Live numbers for the bench. */
    stats() {
      return { voices: voices.filter((v) => !v.ended).length, files: buffers.size, decodedMB: decodedBytes / 1048576, downloadedMB: downloadedBytes / 1048576, format };
    },
    /** The recorded zones of a set, for the tuning check. @param {string} set */
    zones(set) { return zonesOf(set); },
    /** Whether the files for a note are ready. @param {number} midi */
    ready(midi) {
      const z = zonesOf(setFor(false));
      const i = nearestZone(midi, z.map((x) => x.midi));
      return i >= 0 && (z[i].layers ?? [z[i]]).every((/** @type {any} */ L) => buffers.has(L.file));
    },
    instrument,
  };
}

/** @typedef {ReturnType<typeof createSampler>} Sampler */

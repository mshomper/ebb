// @ts-check
// One ambience bed (doc 25 "Data and interfaces"): a slot that plays recorded takes when they
// exist and a procedural stand-in until then.
//
//   recorded   assets/audio/beds/<layer>/<season>-a.ogg and -b.ogg (season omitted for all-season
//              beds: a.ogg, b.ogg). Two takes of different lengths, both looping, crossfading
//              slowly between each other so their combination rarely repeats. Streamed through
//              media elements, so a minute of stereo does not sit decoded in memory. Only takes
//              listed in assets/audio/beds/takes.json are requested; a listed take that fails to
//              load keeps the fallback and leaves one quiet note in the console. A take written
//              "@<layer>/<name>" is that file, so several seasons can share one recording.
//   fallback   made by the caller's factory for one season (or once, for all-season beds).
//
// Seasonal beds keep one instance per season that has weight in seasonBlend (at most two near an
// edge), crossfaded equal-power. An instance with no weight for idleStopS stops and frees itself.
//
//   instances ─┬─ season gains ─→ level ─→ tone (lowpass) ─→ user (solo, mute) ─→ out ─┬─→ dest
//              └─ ...                                                  └─→ meter (analyser)

import { SEASONS, clamp01 } from './curves.js';

/** @typedef {{output: AudioNode, set(params: any, rampS?: number): void, stop(fadeS?: number): void}} Bed */

/** @type {Promise<any> | null} */
let takesManifest = null;
const ASSET_ROOT = new URL('../../../assets/audio/beds/', import.meta.url);

/** The takes that exist, from assets/audio/beds/takes.json (empty until recordings land). */
function loadTakes() {
  takesManifest ??= fetch(new URL('takes.json', ASSET_ROOT), { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : { takes: {} }))
    .catch(() => ({ takes: {} }));
  return takesManifest;
}

/** Ogg Opus where the browser plays it, AAC (.m4a) otherwise (older Safari, doc 17). */
function fileExt() {
  try {
    const a = document.createElement('audio');
    return a.canPlayType('audio/ogg; codecs=opus') ? 'ogg' : 'm4a';
  } catch { return 'ogg'; }
}

/**
 * @typedef {Object} SlotOpts
 * @property {string} layer        folder name under assets/audio/beds/
 * @property {boolean} seasonal    one variant per season
 * @property {(season: string) => Bed} makeFallback
 * @property {number} recordedDb   level of the recordings relative to the fallback
 * @property {number} idleStopS
 * @property {number} crossfadeS   fallback to recording, and season to season
 * @property {{everyS: number[], fadeS: number, floor: number}} takeSwap  between take a and b
 * @property {{next(): number, range(a: number, b: number): number}} rng
 * @property {boolean} [allowRecorded]  false skips the recordings (the lab's A/B)
 */

/**
 * @param {BaseAudioContext} ctx @param {AudioNode} dest @param {SlotOpts} o
 */
export function createSlot(ctx, dest, o) {
  const level = ctx.createGain();
  level.gain.value = 0;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass'; tone.Q.value = 0.5; tone.frequency.value = Math.min(20000, ctx.sampleRate * 0.45);
  const user = ctx.createGain();
  const out = ctx.createGain();
  level.connect(tone).connect(user).connect(out).connect(dest);
  const meter = ctx.createAnalyser();
  meter.fftSize = 1024;
  meter.smoothingTimeConstant = 0;
  out.connect(meter);
  const meterBuf = new Float32Array(meter.fftSize);
  const keys = o.seasonal ? SEASONS : /** @type {readonly string[]} */ (['all']);

  /**
   * @typedef {Object} Instance
   * @property {GainNode} gain           the season weight
   * @property {Bed | null} fallback
   * @property {GainNode} fbGain
   * @property {{stop(): void} | null} recorded
   * @property {number} idleSince        audio time its weight went to zero, or -1
   * @property {boolean} recordedTried
   */
  /** @type {Map<string, Instance>} */
  const inst = new Map();
  /** @type {any} */
  let lastParams = {};
  let active = false;
  let usingRecorded = 0;

  /** @param {string} key */
  function makeInstance(key) {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(level);
    const fbGain = ctx.createGain();
    fbGain.connect(gain);
    const fallback = o.makeFallback(key === 'all' ? 'spring' : key);
    fallback.output.disconnect();
    fallback.output.connect(fbGain);
    fallback.set(lastParams, 0.05);
    /** @type {Instance} */
    const it = { gain, fallback, fbGain, recorded: null, idleSince: -1, recordedTried: false };
    inst.set(key, it);
    if (o.allowRecorded !== false) tryRecorded(key, it);
    return it;
  }

  /** Swap in the recordings for one season when they are listed and load. @param {string} key @param {Instance} it */
  async function tryRecorded(key, it) {
    if (it.recordedTried) return;
    it.recordedTried = true;
    const m = await loadTakes();
    const list = m?.takes?.[o.layer]?.[key];
    if (!Array.isArray(list) || !list.length || !inst.has(key)) return;
    const ext = fileExt();
    const name = key === 'all' ? '' : `${key}-`;
    // A take starting with @ is a path from the beds folder, so seasons can share one file
    // ("@reeds/green-a" is reeds/green-a.ogg); a plain take is <layer>/<season>-<take>.
    const urls = list.map((/** @type {string} */ take) => new URL(take.startsWith('@')
      ? `${take.slice(1)}.${ext}` : `${o.layer}/${name}${take}.${ext}`, ASSET_ROOT).href);
    try {
      const rec = await playTakes(ctx, it.gain, urls, o);
      if (!inst.has(key) || inst.get(key) !== it) { rec.stop(); return; }
      it.recorded = rec;
      usingRecorded++;
      // Crossfade from the stand-in to the recording, then let the stand-in go.
      const t = ctx.currentTime;
      it.fbGain.gain.setTargetAtTime(0, t, o.crossfadeS / 3);
      const fb = it.fallback;
      it.fallback = null;
      setTimeout(() => fb?.stop(0.2), o.crossfadeS * 1500);
    } catch (e) {
      console.info(`ebb audio: the ${o.layer} ${key} recording did not load, so the made-in-code bed keeps playing (${/** @type {Error} */ (e).message}).`);
    }
  }

  return {
    layer: o.layer,
    output: out,
    /**
     * @param {number} gainLin overall level of this bed now
     * @param {any} params passed to the fallback beds
     * @param {number[]} blend four season weights
     * @param {number} rampS
     * @param {number} [lowpassHz] the bed's tone now (opens as the camera comes close)
     */
    update(gainLin, params, blend, rampS, lowpassHz) {
      const t = ctx.currentTime;
      lastParams = params;
      if (lowpassHz) tone.frequency.setTargetAtTime(Math.min(lowpassHz, ctx.sampleRate * 0.45), t, Math.max(0.01, rampS) / 3);
      const on = gainLin > 3e-4;
      level.gain.setTargetAtTime(on ? gainLin : 0, t, Math.max(0.01, rampS) / 3);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const w = o.seasonal ? blend[i] : 1;
        let it = inst.get(key);
        if (on && w > 1e-3 && !it) it = makeInstance(key);
        if (!it) continue;
        // Equal-power across the season edge.
        it.gain.gain.setTargetAtTime(Math.sqrt(clamp01(w)), t, o.crossfadeS / 3);
        if (it.fallback) it.fallback.set(params, rampS);
        const idle = !on || w <= 1e-3;
        if (!idle) it.idleSince = -1;
        else if (it.idleSince < 0) it.idleSince = t;
        else if (t - it.idleSince > o.idleStopS) {
          it.fallback?.stop(0.3);
          it.recorded?.stop();
          if (it.recorded) usingRecorded--;
          setTimeout(() => it?.gain.disconnect(), 1500);
          inst.delete(key);
        }
      }
      active = inst.size > 0;
    },
    /** @param {number} g 0 muted, 1 normal */
    setUser(g) { user.gain.setTargetAtTime(g, ctx.currentTime, 0.05); },
    /** RMS of this bed's output now, in dBFS. */
    levelDb() {
      if (!active) return -120;
      meter.getFloatTimeDomainData(meterBuf);
      let s = 0;
      for (let i = 0; i < meterBuf.length; i++) s += meterBuf[i] * meterBuf[i];
      const rms = Math.sqrt(s / meterBuf.length);
      return rms > 1e-7 ? 20 * Math.log10(rms) : -120;
    },
    /** 'recorded' once any season of this bed plays a recording, else 'made in code'. */
    source: () => (usingRecorded > 0 ? 'recorded' : 'made in code'),
    /** Season keys with a live instance. */
    live: () => [...inst.keys()],
    stop() {
      for (const it of inst.values()) { it.fallback?.stop(0.5); it.recorded?.stop(); }
      inst.clear();
      setTimeout(() => out.disconnect(), 1500);
    },
  };
}

/**
 * Two (or one) looping takes through media elements, swapping emphasis now and then.
 * Resolves when the first take can play; rejects if none can.
 * @param {BaseAudioContext} ctx @param {AudioNode} dest @param {string[]} urls @param {SlotOpts} o
 * @returns {Promise<{stop(): void}>}
 */
function playTakes(ctx, dest, urls, o) {
  if (!(ctx instanceof AudioContext)) return Promise.reject(new Error('recordings need a live context'));
  const g = ctx.createGain();
  g.gain.value = Math.pow(10, o.recordedDb / 20);
  g.connect(dest);
  /** @type {{el: HTMLAudioElement, gain: GainNode}[]} */
  const takes = [];
  let stopped = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  const ready = urls.map((url) => new Promise((resolve, reject) => {
    const el = new Audio();
    el.loop = true;
    el.preload = 'auto';
    el.src = url;
    el.addEventListener('canplay', () => resolve(el), { once: true });
    el.addEventListener('error', () => reject(new Error(`${url.split('/').slice(-2).join('/')} missing`)), { once: true });
  }));
  return Promise.allSettled(ready).then((res) => {
    const els = /** @type {HTMLAudioElement[]} */ (res.filter((r) => r.status === 'fulfilled').map((r) => /** @type {any} */ (r).value));
    if (!els.length) {
      g.disconnect();
      const why = res.find((r) => r.status === 'rejected');
      throw new Error(why ? /** @type {any} */ (why).reason.message : 'no takes');
    }
    for (const el of els) {
      const src = ctx.createMediaElementSource(el);
      const tg = ctx.createGain();
      tg.gain.value = 1 / Math.sqrt(els.length);
      src.connect(tg).connect(g);
      if (isFinite(el.duration) && el.duration > 1) el.currentTime = o.rng.range(0, el.duration);
      el.play().catch(() => { /* resumes on the next gesture */ });
      takes.push({ el, gain: tg });
    }
    // Every so often, lean one take forward and the other back (never below floor).
    if (takes.length > 1) {
      let lead = 0;
      const swap = () => {
        if (stopped) return;
        lead = 1 - lead;
        const t = ctx.currentTime;
        takes[lead].gain.gain.setTargetAtTime(Math.SQRT1_2 * 1.2, t, o.takeSwap.fadeS / 3);
        takes[1 - lead].gain.gain.setTargetAtTime(Math.SQRT1_2 * o.takeSwap.floor, t, o.takeSwap.fadeS / 3);
        timer = setTimeout(swap, o.rng.range(o.takeSwap.everyS[0], o.takeSwap.everyS[1]) * 1000);
      };
      timer = setTimeout(swap, o.rng.range(o.takeSwap.everyS[0], o.takeSwap.everyS[1]) * 1000);
    }
    return {
      stop() {
        stopped = true;
        if (timer) clearTimeout(timer);
        const t = ctx.currentTime;
        g.gain.setTargetAtTime(0, t, 0.3);
        setTimeout(() => { for (const k of takes) { k.el.pause(); k.el.removeAttribute('src'); k.el.load(); } g.disconnect(); }, 1500);
      },
    };
  });
}

// @ts-check
// The sound of the waterfalls (M2 Cliff tool; docs/07 "Waterfalls", doc 17, doc 25). The game
// passes the few falls nearest the camera target (src/world/falls-near.js); each gets a voice
// placed where it falls, made in code from three layers:
//
//   curtain hiss   pink noise through a band that rises with the height of the drop
//   plunge roar    slow, low pink noise that only big falls (flow x height) reach
//   splash         the procedural trickle's bubbles, strongest for small falls
//
// Loudness follows the fall's power (flow x height, in dB about a reference), its distance from
// the camera target (fading to silence at reachM) and the camera's height, like the beds. The
// panner only places it (no rolloff of its own); its air filter dulls it with the eye's distance.
// Voices keep to the fall they had while it stays near, and stop after idleStopS unused.
// Numbers: recipes/audio/ambience.json `falls`. Variation from the caller's seeded stream.

import { trickle } from '../procedural.js';
import { pinkBuffer, controlBuffer } from '../procedural/one-shots.js';
import { placedChain } from '../spatial.js';
import { dbToGain, clamp01, value } from './curves.js';

/** @typedef {import('../../world/falls-near.js').FallNear} FallNear */
/** @typedef {{next(): number, range(a: number, b: number): number, int(n: number): number}} Rng */

/** @param {number} a @param {number} b @param {number} x */
const smooth = (a, b, x) => { const k = clamp01((x - a) / (b - a)); return k * k * (3 - 2 * k); };

/**
 * How loud one fall is at the camera target, 0..1 and above (1 = dbAtRef at the fall), before
 * the camera height; and how much of it is the low roar. Pure.
 * @param {FallNear} f @param {any} F ambience.json `falls`
 */
export function fallLevel(f, F) {
  const power = Math.max(1e-9, f.flowM3s * f.heightM);
  const db = Math.min(F.dbRange[1], Math.max(F.dbRange[0], F.dbAtRef + 10 * Math.log10(power / F.refPowerM4s)));
  const D = F.distance;
  const near = D.refM / Math.max(D.refM, f.distM);
  const fade = 1 - smooth(D.fadeFromM, D.reachM, f.distM);
  return {
    gain: dbToGain(db) * near * fade,
    roar: smooth(F.roar.fromPowerM4s[0], F.roar.fromPowerM4s[1], power),
  };
}

/**
 * The loudest fall's level at the camera target (0 with none), for dipping the stream beds.
 * @param {FallNear[]} falls @param {any} F
 */
export function fallsLoudness(falls, F) {
  let m = 0;
  for (const f of falls) m = Math.max(m, fallLevel(f, F).gain);
  return m;
}

/**
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} dest
 * @param {any} F ambience.json `falls`
 * @param {any} proc procedural.json
 * @param {(i: number) => Rng} rngFor a fresh seeded stream per voice instance
 * @param {'desktop'|'mobile'} tier
 */
export function createFallVoices(ctx, dest, F, proc, rngFor, tier) {
  const spatialOpts = { tier, refDistance: F.distance.refM, rolloff: 0, air: F.air };
  /**
   * @typedef {Object} Voice
   * @property {number[] | null} pos  the fall it follows (null: free)
   * @property {number} idleSince
   * @property {any} chain
   * @property {GainNode} level
   * @property {GainNode} hissG @property {BiquadFilterNode} hissBp
   * @property {GainNode} roarG
   * @property {import('../ambience/slot.js').Bed} splash
   * @property {AudioScheduledSourceNode[]} sources
   */
  /** @type {(Voice | null)[]} */
  const voices = Array.from({ length: F.voices }, () => null);
  let made = 0;

  /** @param {Rng} r @param {number} rate */
  const loop = (r, rate, /** @type {AudioBuffer} */ buf) => {
    const s = ctx.createBufferSource();
    s.buffer = buf; s.loop = true;
    s.playbackRate.value = rate * Math.exp(r.range(-0.04, 0.04));
    s.start(ctx.currentTime, r.range(0, buf.duration));
    return s;
  };

  /** Build one voice's nodes. @returns {Voice} */
  function build() {
    const r = rngFor(made++);
    const chain = placedChain(ctx, dest, spatialOpts);
    const level = ctx.createGain();
    level.gain.value = 0;
    // body: the layers' sum, swelling about 1 with the surge below, into the fall's level.
    const body = ctx.createGain();
    body.gain.value = 1;
    body.connect(level).connect(chain.input);
    const pink = pinkBuffer(ctx, proc);
    // Curtain hiss.
    const hiss = loop(r, F.hiss.rate, pink);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = F.hiss.highpassHz; hp.Q.value = 0.5;
    const hissBp = ctx.createBiquadFilter();
    hissBp.type = 'bandpass'; hissBp.frequency.value = F.hiss.hz[0]; hissBp.Q.value = F.hiss.q;
    const hissG = ctx.createGain();
    hissG.gain.value = dbToGain(F.hiss.db);
    hiss.connect(hp).connect(hissBp).connect(hissG).connect(body);
    // Plunge roar, its tone wandering slowly.
    const roar = loop(r, F.roar.rate, pink);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = F.roar.lowpassHz; lp.Q.value = 0.6;
    const lp2 = ctx.createBiquadFilter();
    lp2.type = 'lowpass'; lp2.frequency.value = F.roar.lowpassHz * 1.6; lp2.Q.value = 0.5;
    const roarG = ctx.createGain();
    roarG.gain.value = 0;
    roar.connect(lp).connect(lp2).connect(roarG).connect(body);
    const ctl = controlBuffer(ctx, proc);
    const wand = loop(r, ctl.duration / F.roar.wanderPeriodS, ctl);
    const wandG = ctx.createGain();
    wandG.gain.value = F.roar.wanderCents;
    wand.connect(wandG).connect(lp.detune);
    // A slow surge in the whole fall.
    const surge = loop(r, ctl.duration / F.surge.periodS, ctl);
    const surgeG = ctx.createGain();
    surgeG.gain.value = F.surge.depth;
    surge.connect(surgeG).connect(body.gain);
    // Splash: the trickle's bubbles.
    const splash = trickle(ctx, body, proc, r, { amount: 0.5 });
    return { pos: null, idleSince: ctx.currentTime, chain, level, hissG, hissBp, roarG, splash, sources: [hiss, roar, wand, surge] };
  }

  /** @param {Voice} v */
  function free(v) {
    const t = ctx.currentTime;
    for (const s of v.sources) { try { s.stop(t + 0.1); } catch { /* already */ } }
    v.splash.stop(0.05);
    setTimeout(() => { try { v.level.disconnect(); } catch { /* already */ } v.chain.dispose(); }, 400);
  }

  let loud = 0;

  return {
    /**
     * @param {FallNear[]} falls nearest first
     * @param {{eye: number[], forward: number[]}} ear
     * @param {number} camHeight meters above the camera target
     */
    update(falls, ear, camHeight) {
      const t = ctx.currentTime, k = F.rampS / 3;
      const heightGain = dbToGain(value(F.heightDb, { height: camHeight }, [1, 0, 0, 0]));
      /** @type {(Voice | null)[]} */
      const claimed = voices.map(() => null);
      /** @type {(number)[]} */
      const slotOf = falls.map(() => -1);
      // Each fall keeps the voice that followed it (nearest within matchM), else takes a free one.
      falls.forEach((f, i) => {
        let best = -1, bd = F.matchM;
        voices.forEach((v, j) => {
          if (!v?.pos || claimed[j]) return;
          const d = Math.hypot(v.pos[0] - f.pos[0], v.pos[1] - f.pos[1], v.pos[2] - f.pos[2]);
          if (d < bd) { bd = d; best = j; }
        });
        if (best >= 0) { slotOf[i] = best; claimed[best] = voices[best]; }
      });
      falls.forEach((f, i) => {
        if (slotOf[i] >= 0) return;
        let j = voices.findIndex((v, jj) => !claimed[jj] && (!v || !v.pos));
        if (j < 0) j = voices.findIndex((_, jj) => !claimed[jj]);
        if (j < 0) return;
        slotOf[i] = j;
        voices[j] ??= build();
        claimed[j] = voices[j];
      });
      loud = 0;
      falls.forEach((f, i) => {
        const v = voices[slotOf[i]];
        if (!v) return;
        const moved = !v.pos;
        v.pos = f.pos.slice();
        v.idleSince = t;
        const lv = fallLevel(f, F);
        loud = Math.max(loud, lv.gain);
        v.chain.place(f.pos, ear, t, moved ? 0 : F.rampS);
        v.level.gain.setTargetAtTime(lv.gain * heightGain, t, k);
        v.roarG.gain.setTargetAtTime(dbToGain(F.roar.db) * lv.roar, t, k);
        const hz = F.hiss.hz[0] * Math.pow(F.hiss.hz[1] / F.hiss.hz[0], smooth(F.hiss.heightM[0], F.hiss.heightM[1], f.heightM));
        v.hissBp.frequency.setTargetAtTime(hz, t, k);
        v.splash.set({ amount: F.splash.amount[0] + (F.splash.amount[1] - F.splash.amount[0]) * lv.roar }, F.rampS);
      });
      // Voices with no fall fade out; after idleStopS they are freed.
      voices.forEach((v, j) => {
        if (!v || claimed[j]) return;
        v.level.gain.setTargetAtTime(0, t, k);
        v.pos = null;
        if (t - v.idleSince > F.idleStopS) { free(v); voices[j] = null; }
      });
    },
    /** The loudest fall's level at the target, as last updated. */
    loudness: () => loud,
    /** How many voices are built. */
    live: () => voices.filter(Boolean).length,
    dispose() { for (const v of voices) if (v) free(v); voices.fill(null); },
  };
}

// @ts-check
// A southern hawker's wings, model 'wing-rattle' (doc 25 "Creature voices"): a soft, dry, papery
// buzz. Each wingbeat is two short grains of noise, the fore pair and then the hind pair a little
// behind (the hindLag of the pose), each grain a different strength, with now and then a tiny
// crinkle between, so the beat rattles rather than hums. The beats sit in a seeded loop played
// faster while darting (wingHz from the species motion), through a highpass and a lowpass that
// opens with speed, and a low band for the body of the beat. Louder darting than hovering, silent
// on a perch. Heard only within about 2 m: inverse distance from refDistance with a steep rolloff,
// then a hard fade to silence by reachM.
//
//   rattle loop (rate ← wing speed) ─┬→ highpass → lowpass (opens with speed) ─┬→ level → reach → panner → out
//                                    └→ body bandpass ──────────────────────────┘

import { stream } from '../../core/rng.js';

/** @param {number} db */
const dbToGain = (db) => Math.pow(10, db / 20);
/** @param {number} x */
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * The wing voice's recipe: the species' voice block with its motion's wingbeat rates and dart
 * speed joined in, so the wings sound at the rate they are drawn beating. @param {any} species
 */
export function wingRecipe(species) {
  return { ...species.voice, wingHz: species.motion.wingHz, dartMps: species.motion.dartMps };
}

/**
 * The rattle loop: `beats` wingbeats at baseHz, exactly periodic so the loop has no seam.
 * @param {BaseAudioContext} ctx @param {any} R wing-rattle recipe @param {{next(): number, range(a: number, b: number): number}} r
 */
export function rattleBuffer(ctx, R, r) {
  const sr = ctx.sampleRate;
  const len = Math.round((R.beats / R.baseHz) * sr);
  const b = ctx.createBuffer(1, len, sr);
  const d = b.getChannelData(0);
  const beat = len / R.beats;
  const tau = (R.grainMs / 1000) * sr / 6.9;   // grainMs is the time to fall 60 dB
  const glen = Math.ceil(tau * 9);
  /** One grain of noise at sample s (wrapping round the loop). @param {number} s @param {number} amp */
  const grain = (s, amp) => {
    const att = Math.max(1, Math.round(sr * 0.0004));
    for (let i = 0; i < glen; i++) {
      const env = i < att ? i / att : Math.exp(-(i - att) / tau);
      d[(Math.round(s) + i) % len] += amp * env * (r.next() * 2 - 1);
    }
  };
  const lag = (R.hindLag / (2 * Math.PI)) * beat;
  for (let k = 0; k < R.beats; k++) {
    const s = k * beat + r.range(-R.jitter, R.jitter) * beat;
    grain(s, r.range(1 - R.unevenness, 1));
    grain(s + lag, R.hindShare * r.range(1 - R.unevenness, 1));
    if (r.next() < R.crinkle) grain(s + r.range(0.3, 0.8) * beat, r.range(0.2, 0.5));
  }
  let peak = 1e-9;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (let i = 0; i < len; i++) d[i] /= peak;
  return b;
}

/**
 * One dragonfly's wings.
 * @param {BaseAudioContext} ctx @param {AudioNode} dest
 * @param {any} R dragonfly voice recipe, with the motion's wingHz and dartMps joined in
 * @param {number} key seed for this one @param {'desktop'|'mobile'} tier
 */
export function createWingVoice(ctx, dest, R, key, tier) {
  const r = stream(key, 3);
  const src = ctx.createBufferSource();
  src.buffer = rattleBuffer(ctx, R, r);
  src.loop = true;
  const own = Math.exp(r.range(-R.rateJitter, R.rateJitter));
  const rateAt = (/** @type {number} */ k) => ((R.wingHz[0] + (R.wingHz[1] - R.wingHz[0]) * k) / R.baseHz) * own;
  src.playbackRate.value = rateAt(0);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = R.highpassHz; hp.Q.value = 0.5;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = R.lowpassHz[0]; lp.Q.value = 0.6;
  const body = ctx.createBiquadFilter();
  body.type = 'bandpass'; body.frequency.value = R.body.hz; body.Q.value = R.body.q;
  const bodyGain = ctx.createGain();
  bodyGain.gain.value = dbToGain(R.body.db);
  const level = ctx.createGain();
  level.gain.value = 0;
  const reach = ctx.createGain();
  reach.gain.value = 0;
  const panner = ctx.createPanner();
  panner.panningModel = tier === 'mobile' ? 'equalpower' : 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = R.refDistance;
  panner.rolloffFactor = R.rolloff;
  src.connect(hp).connect(lp).connect(level);
  src.connect(body).connect(bodyGain).connect(level);
  level.connect(reach).connect(panner).connect(dest);
  src.start(ctx.currentTime, r.range(0, src.buffer.duration));

  return {
    /**
     * @param {number[]} pos where it is @param {number[]} eye camera eye
     * @param {number} speed m/s @param {boolean} flying false on a perch
     * @returns {number} distance from the eye
     */
    set(pos, eye, speed, flying) {
      const t = ctx.currentTime;
      if (panner.positionX) {
        panner.positionX.setTargetAtTime(pos[0], t, 0.03);
        panner.positionY.setTargetAtTime(pos[1], t, 0.03);
        panner.positionZ.setTargetAtTime(pos[2], t, 0.03);
      } else panner.setPosition(pos[0], pos[1], pos[2]);
      const d = Math.hypot(pos[0] - eye[0], pos[1] - eye[1], pos[2] - eye[2]);
      const fade = d <= R.fadeFromM ? 1 : d >= R.reachM ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * (d - R.fadeFromM) / (R.reachM - R.fadeFromM));
      reach.gain.setTargetAtTime(fade, t, 0.05);
      const k = Math.sqrt(clamp01(speed / R.dartMps));
      level.gain.setTargetAtTime(flying ? dbToGain(R.hoverDb + (R.dartDb - R.hoverDb) * k) : 0, t, flying ? R.rampS : R.perchRampS);
      lp.frequency.setTargetAtTime(R.lowpassHz[0] + (R.lowpassHz[1] - R.lowpassHz[0]) * k, t, R.rampS);
      src.playbackRate.setTargetAtTime(rateAt(k), t, R.rampS);
      return d;
    },
    stop() {
      const t = ctx.currentTime;
      level.gain.setTargetAtTime(0, t, 0.05);
      try { src.stop(t + 0.4); } catch { /* already */ }
      setTimeout(() => { try { panner.disconnect(); } catch { /* already */ } }, 700);
    },
  };
}

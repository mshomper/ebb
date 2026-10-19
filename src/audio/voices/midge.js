// @ts-check
// The midge swarm's hum, model 'midge-swarm' (doc 25): 6 to 10 slightly detuned, slowly wandering
// sine and triangle partials around 400 to 700 Hz, with a faint wing shimmer, its level following
// the swarm's live density. Heard only within about 3 m: inverse distance from 0.5 m with a steep
// rolloff, then a hard fade to silence by reachM.
//
//   partials (each: osc ← detune wander) ─→ sum → lowpass → shimmer → density → reach → panner → out

import { stream } from '../../core/rng.js';

/** @param {number} db */
const dbToGain = (db) => Math.pow(10, db / 20);

/**
 * One swarm's voice.
 * @param {BaseAudioContext} ctx @param {AudioNode} dest @param {any} R midge voice recipe
 * @param {number} key seed for this swarm @param {'desktop'|'mobile'} tier
 */
export function createSwarmVoice(ctx, dest, R, key, tier) {
  const r = stream(key, 2);
  let n = R.partials[0] + r.int(R.partials[1] - R.partials[0] + 1);
  if (tier === 'mobile') n = Math.min(n, R.mobileMax);
  const sum = ctx.createGain();
  sum.gain.value = 1 / Math.sqrt(n);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = R.lowpassHz; lp.Q.value = 0.5;
  const shimmer = ctx.createGain();
  shimmer.gain.value = 1;
  const density = ctx.createGain();
  density.gain.value = 0;
  const reach = ctx.createGain();
  reach.gain.value = 0;
  const panner = ctx.createPanner();
  panner.panningModel = tier === 'mobile' ? 'equalpower' : 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = R.refDistance;
  panner.rolloffFactor = R.rolloff;
  sum.connect(lp).connect(shimmer).connect(density).connect(reach).connect(panner).connect(dest);

  /** @type {AudioScheduledSourceNode[]} */
  const srcs = [];
  for (let i = 0; i < n; i++) {
    // Spread across the band, then detune each a little.
    const x = (i + r.range(0.1, 0.9)) / n;
    const hz = R.hz[0] * Math.pow(R.hz[1] / R.hz[0], x);
    const o = ctx.createOscillator();
    o.type = r.next() < R.triangleShare ? 'triangle' : 'sine';
    o.frequency.value = hz;
    o.detune.value = r.range(-R.detuneCents, R.detuneCents);
    // Slow wander: two slow sines at unrelated rates on detune.
    for (let k = 0; k < 2; k++) {
      const l = ctx.createOscillator();
      l.frequency.value = 1 / r.range(R.wander.periodS[0], R.wander.periodS[1]);
      const lg = ctx.createGain();
      lg.gain.value = (R.wander.cents / 2) * r.range(0.6, 1);
      l.connect(lg).connect(o.detune);
      l.start(ctx.currentTime + r.range(0, 0.5));
      srcs.push(l);
    }
    const g = ctx.createGain();
    g.gain.value = r.range(0.6, 1) * (o.type === 'triangle' ? 0.8 : 1);
    o.connect(g).connect(sum);
    o.start();
    srcs.push(o);
  }
  // Wing shimmer: a light tremolo.
  const trem = ctx.createOscillator();
  trem.frequency.value = r.range(R.tremolo.hz[0], R.tremolo.hz[1]);
  const tg = ctx.createGain();
  tg.gain.value = R.tremolo.depth;
  trem.connect(tg).connect(shimmer.gain);
  trem.start();
  srcs.push(trem);

  return {
    /**
     * @param {number[]} pos swarm centre @param {number[]} eye camera eye
     * @param {number} dens 0..1 live density
     */
    set(pos, eye, dens) {
      const t = ctx.currentTime;
      if (panner.positionX) {
        panner.positionX.setTargetAtTime(pos[0], t, 0.05);
        panner.positionY.setTargetAtTime(pos[1], t, 0.05);
        panner.positionZ.setTargetAtTime(pos[2], t, 0.05);
      } else panner.setPosition(pos[0], pos[1], pos[2]);
      const d = Math.hypot(pos[0] - eye[0], pos[1] - eye[1], pos[2] - eye[2]);
      const fade = d <= R.fadeFromM ? 1 : d >= R.reachM ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * (d - R.fadeFromM) / (R.reachM - R.fadeFromM));
      reach.gain.setTargetAtTime(fade, t, 0.1);
      density.gain.setTargetAtTime(dbToGain(R.levelDb) * Math.min(1, Math.max(0, dens)), t, R.rampS / 3);
      return d;
    },
    stop() {
      const t = ctx.currentTime;
      density.gain.setTargetAtTime(0, t, 0.2);
      for (const s of srcs) { try { s.stop(t + 1); } catch { /* already */ } }
      setTimeout(() => { try { panner.disconnect(); } catch { /* already */ } }, 1500);
    },
  };
}

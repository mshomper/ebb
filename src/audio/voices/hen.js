// @ts-check
// The hen's voice (docs/future/15 slice 3; doc 17 "Procedural creature voices"): her contented
// murmur, her alarm, and the distant crow from the far side, made in code as the frogs' calls are.
// A voiced note is a sawtooth through a formant bandpass with a short swell and fall; each sound is
// a few of those, timed and pitched from recipes/audio/hen.json with a seeded stream, so the same
// call sounds the same each time it is replayed. The caller places it (voices.js hen()).

/**
 * One voiced note: a sawtooth at f0 gliding to f1 over dur, through a formant bandpass, swelling
 * in and falling off. @param {BaseAudioContext} ctx @param {AudioNode} dest @param {number} t start (audio time)
 * @param {number} dur @param {number} f0 @param {number} f1 @param {number} gain linear peak
 * @param {number} formantHz @param {number} q
 * @returns {number} its end (audio time)
 */
function note(ctx, dest, t, dur, f0, f1, gain, formantHz, q) {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.linearRampToValueAtTime(f1, t + dur);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = formantHz; bp.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + Math.min(0.015, dur * 0.25));
  g.gain.setTargetAtTime(0, t + dur * 0.6, dur * 0.18);
  osc.connect(bp).connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.15);
  osc.onended = () => { osc.disconnect(); bp.disconnect(); g.disconnect(); };
  return t + dur + 0.15;
}

const db = (/** @type {number} */ d) => Math.pow(10, d / 20);

/**
 * Play one of her sounds into dest from `when`. @param {BaseAudioContext} ctx @param {AudioNode} dest
 * @param {'murmur'|'alarm'|'crow'} kind @param {any} R recipes/audio/hen.json
 * @param {{ next: () => number, range: (a: number, b: number) => number }} rng @param {number} when audio time
 * @returns {number} when it ends (audio time)
 */
export function henCall(ctx, dest, kind, R, rng, when) {
  let t = when, end = when;
  if (kind === 'murmur') {
    const M = R.murmur, n = Math.round(rng.range(M.pulses[0], M.pulses[1]));
    const f = rng.range(M.f0Hz[0], M.f0Hz[1]), g = db(M.gainDb);
    for (let i = 0; i < n; i++) {
      // Each 'buk' a touch lower and softer than the one before.
      const fi = f * (1 - 0.04 * i);
      end = note(ctx, dest, t, M.pulseS, fi, fi * (1 - M.glide), g * (1 - 0.12 * i), M.formantHz, M.formantQ);
      t += M.pulseS + rng.range(M.gapS[0], M.gapS[1]);
    }
  } else if (kind === 'alarm') {
    const A = R.alarm, n = Math.round(rng.range(A.clucks[0], A.clucks[1])), g = db(A.gainDb);
    for (let i = 0; i < n; i++) {
      end = note(ctx, dest, t, A.cluckS, A.f0Hz, A.f0Hz * 0.85, g * 0.7, A.formantHz, A.formantQ);
      t += A.cluckS + A.gapS;
    }
    end = note(ctx, dest, t, A.squawkS, A.squawkHz[0], A.squawkHz[1], g, A.formantHz, A.formantQ);
  } else {
    // The crow: far off, softened by the air between.
    const C = R.crow, g = db(C.gainDb);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = C.lowpassHz;
    lp.connect(dest);
    C.syllableHz.forEach((/** @type {number} */ f, /** @type {number} */ i) => {
      const dur = C.syllableS[i], last = i === C.syllableHz.length - 1;
      end = note(ctx, lp, t, dur, f, last ? f * 0.8 : f * 1.04, g, C.formantHz, C.formantQ);
      t += dur + C.gapS;
    });
    setTimeout(() => lp.disconnect(), (end - ctx.currentTime + 0.5) * 1000);
  }
  return end;
}

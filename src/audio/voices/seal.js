// @ts-check
// The grey seals' voice (B3 wave 3; doc 17 "Procedural creature voices"; Matt, November 1, 2026:
// soft sounds): the low hooting moan that carries from a haul-out, a short snort as one slips into
// the sea, and the pup's thin lamb-like call, made in code as the turnstones' are (voices/turnstone.js).
// The moan is a soft triangle tone through a lowpass, rising and falling slowly with a little
// vibrato; the snort a breath of filtered noise; the pup's call a wavering sawtooth through a
// formant. Timing and pitch come from recipes/audio/seal.json with a seeded stream, so a replayed
// call sounds the same. The caller places it (voices.js seal()).

const db = (/** @type {number} */ d) => Math.pow(10, d / 20);

/**
 * A tone that rises and falls: its pitch from f0 up by rise and back, its loudness swelling in and
 * fading out. @param {BaseAudioContext} ctx @param {AudioNode} dest @param {number} t @param {number} dur
 * @param {number} f0 @param {number} rise share @param {number} gain linear peak @param {OscillatorType} type
 * @param {{ type: BiquadFilterType, hz: number, q: number }} filter @param {number} vibHz @param {number} vibShare
 * @returns {number} its end
 */
function tone(ctx, dest, t, dur, f0, rise, gain, type, filter, vibHz, vibShare) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.linearRampToValueAtTime(f0 * (1 + rise), t + dur * 0.45);
  osc.frequency.linearRampToValueAtTime(f0 * (1 - rise * 0.4), t + dur);
  const vib = ctx.createOscillator(), vg = ctx.createGain();
  vib.frequency.value = vibHz; vg.gain.value = f0 * vibShare;
  vib.connect(vg).connect(osc.frequency);
  const f = ctx.createBiquadFilter();
  f.type = filter.type; f.frequency.value = filter.hz; f.Q.value = filter.q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + dur * 0.3);
  g.gain.setTargetAtTime(0, t + dur * 0.6, dur * 0.15);
  osc.connect(f).connect(g).connect(dest);
  osc.start(t); vib.start(t);
  const end = t + dur + 0.3;
  osc.stop(end); vib.stop(end);
  osc.onended = () => { osc.disconnect(); vib.disconnect(); vg.disconnect(); f.disconnect(); g.disconnect(); };
  return end;
}

/**
 * A breath of noise through a bandpass. @param {BaseAudioContext} ctx @param {AudioNode} dest @param {number} t
 * @param {any} N the snort block @param {{ range: (a: number, b: number) => number }} rng @returns {number} its end
 */
function snort(ctx, dest, t, N, rng) {
  const dur = rng.range(N.s[0], N.s[1]), len = Math.ceil((dur + 0.05) * ctx.sampleRate);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = rng.range(-1, 1);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = rng.range(N.hz[0], N.hz[1]); f.Q.value = N.q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(db(N.gainDb), t + 0.02);
  g.gain.setTargetAtTime(0, t + dur * 0.3, dur * 0.25);
  src.connect(f).connect(g).connect(dest);
  src.start(t);
  src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect(); };
  return t + dur + 0.1;
}

/**
 * Play one of their sounds into dest from `when`. @param {BaseAudioContext} ctx @param {AudioNode} dest
 * @param {'moan'|'snort'|'pup'} kind @param {any} R recipes/audio/seal.json
 * @param {{ next: () => number, range: (a: number, b: number) => number }} rng @param {number} when audio time
 * @returns {number} when it ends (audio time)
 */
export function sealCall(ctx, dest, kind, R, rng, when) {
  if (kind === 'snort') return snort(ctx, dest, when, R.snort, rng);
  if (kind === 'pup') {
    const P = R.pup;
    return tone(ctx, dest, when, rng.range(P.s[0], P.s[1]), rng.range(P.f0Hz[0], P.f0Hz[1]), P.rise, db(P.gainDb), 'sawtooth',
      { type: 'bandpass', hz: P.formantHz, q: P.formantQ }, P.vibHz, P.vib);
  }
  // A moan, sometimes two, the second a little lower.
  const M = R.moan, n = rng.next() < M.twiceShare ? 2 : 1;
  let t = when, end = when;
  for (let i = 0; i < n; i++) {
    const dur = rng.range(M.s[0], M.s[1]);
    end = tone(ctx, dest, t, dur, rng.range(M.f0Hz[0], M.f0Hz[1]) * (i ? 0.88 : 1), M.rise, db(M.gainDb), 'triangle',
      { type: 'lowpass', hz: M.lowpassHz, q: 0.7 }, M.vibHz, M.vib);
    t += dur * 0.9;
  }
  return end;
}

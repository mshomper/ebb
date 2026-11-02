// @ts-check
// The teal's voice (B3, the winter duck flock; doc 17 "Procedural creature voices"): the drake's
// clear ringing double whistle 'krrik' while they swim, the duck's few soft nasal quacks at rest, and
// the whirr of the flock flushing, made in code as the turnstones' sounds are (voices/turnstone.js).
// Timing and pitch come from recipes/audio/teal.json with a seeded stream, so a replayed call sounds
// the same. The caller places it (voices.js teal()).

const db = (/** @type {number} */ d) => Math.pow(10, d / 20);

/**
 * One bell-like chirp of the krik: a sine with a little second harmonic, rising then falling, its
 * opening share rolled by a trill. @param {BaseAudioContext} ctx @param {AudioNode} dest @param {number} t
 * @param {any} K recipes/audio/teal.json `krik` @param {number} f0 @param {number} gain linear peak @returns {number} its end
 */
function chirp(ctx, dest, t, K, f0, gain) {
  const dur = K.chirpS, peak = t + dur * 0.35, trillEnd = t + dur * K.trillShare;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + Math.min(0.005, dur * 0.15));
  g.gain.setTargetAtTime(0, t + dur * 0.55, dur * 0.18);
  // The trill: a gain beating at trillHz over the opening share, then steady at full.
  const roll = ctx.createGain();
  roll.gain.setValueAtTime(1 - K.trillDepth / 2, t);
  roll.gain.setValueAtTime(1 - K.trillDepth / 2, trillEnd);
  roll.gain.linearRampToValueAtTime(1, trillEnd + 0.008);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = K.trillHz;
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(K.trillDepth / 2, t);
  depth.gain.setValueAtTime(K.trillDepth / 2, trillEnd);
  depth.gain.linearRampToValueAtTime(0, trillEnd + 0.008);
  lfo.connect(depth).connect(roll.gain);
  const oscs = [1, 2].map((h) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0 * h, t);
    o.frequency.linearRampToValueAtTime(f0 * h * (1 + K.rise), peak);
    o.frequency.exponentialRampToValueAtTime(f0 * h * (1 + K.rise) * (1 - K.droop), t + dur);
    const hg = ctx.createGain();
    hg.gain.value = h === 1 ? 1 : K.harmonic;
    o.connect(hg).connect(roll);
    return { o, hg };
  });
  roll.connect(g).connect(dest);
  const stop = t + dur + 0.1;
  lfo.start(t); lfo.stop(stop);
  for (const { o } of oscs) { o.start(t); o.stop(stop); }
  oscs[0].o.onended = () => {
    for (const { o, hg } of oscs) { o.disconnect(); hg.disconnect(); }
    lfo.disconnect(); depth.disconnect(); roll.disconnect(); g.disconnect();
  };
  return stop;
}

/**
 * One drake's krik. @param {BaseAudioContext} ctx @param {AudioNode} dest @param {any} K the `krik` block
 * @param {{ range: (a: number, b: number) => number }} rng @param {number} t @returns {number} its end
 */
function krik(ctx, dest, K, rng, t) {
  const n = Math.round(rng.range(K.chirps[0], K.chirps[1])), f = rng.range(K.f0Hz[0], K.f0Hz[1]), g = db(K.gainDb);
  let end = t;
  for (let i = 0; i < n; i++) {
    // The second chirp a touch lower and softer, as the call rings down.
    end = chirp(ctx, dest, t, K, f * (i ? 0.96 : 1) * rng.range(0.99, 1.01), g * (i ? 0.85 : 1));
    t += K.chirpS + rng.range(K.gapS[0], K.gapS[1]);
  }
  return end;
}

/**
 * The duck's few soft nasal quacks. @param {BaseAudioContext} ctx @param {AudioNode} dest @param {any} M the `murmur` block
 * @param {{ range: (a: number, b: number) => number }} rng @param {number} t @returns {number} its end
 */
function murmur(ctx, dest, M, rng, t) {
  const n = Math.round(rng.range(M.notes[0], M.notes[1])), f = rng.range(M.f0Hz[0], M.f0Hz[1]), gain = db(M.gainDb);
  let end = t;
  for (let i = 0; i < n; i++) {
    const dur = M.noteS * rng.range(0.85, 1.15), f0 = f * rng.range(0.96, 1.04);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * (1 - M.droop), t + dur);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = M.formantHz; bp.Q.value = M.formantQ;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + Math.min(0.012, dur * 0.2));
    g.gain.setTargetAtTime(0, t + dur * 0.5, dur * 0.2);
    osc.connect(bp).connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.1);
    osc.onended = () => { osc.disconnect(); bp.disconnect(); g.disconnect(); };
    end = t + dur + 0.1;
    t += dur + rng.range(M.gapS[0], M.gapS[1]);
  }
  return end;
}

/**
 * The flock flushing: noise beating at wingbeat rate, fading as they go, and a krik or two over it.
 * @param {BaseAudioContext} ctx @param {AudioNode} dest @param {any} R recipes/audio/teal.json
 * @param {{ next: () => number, range: (a: number, b: number) => number }} rng @param {number} t @returns {number} its end
 */
function whirr(ctx, dest, R, rng, t) {
  const W = R.whirr, dur = rng.range(W.durS[0], W.durS[1]), gain = db(W.gainDb);
  const len = Math.max(1, Math.ceil(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate), data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = rng.next() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = W.noiseHz; bp.Q.value = W.noiseQ;
  // The wingbeats: a gain swinging between silence and full at wingHz.
  const beat = ctx.createGain();
  beat.gain.value = 0.5;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = rng.range(W.wingHz[0], W.wingHz[1]);
  const depth = ctx.createGain();
  depth.gain.value = 0.5;
  lfo.connect(depth).connect(beat.gain);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + W.attackS);
  g.gain.setTargetAtTime(0, t + W.attackS, Math.max(0.05, (dur - W.attackS) / 3));
  src.connect(bp).connect(beat).connect(g).connect(dest);
  src.start(t); src.stop(t + dur);
  lfo.start(t); lfo.stop(t + dur);
  src.onended = () => { src.disconnect(); bp.disconnect(); beat.disconnect(); lfo.disconnect(); depth.disconnect(); g.disconnect(); };
  let end = t + dur;
  const calls = Math.round(rng.range(W.krikCalls[0], W.krikCalls[1]));
  for (let i = 0; i < calls; i++) end = Math.max(end, krik(ctx, dest, R.krik, rng, t + rng.range(0.05, W.krikSpreadS)));
  return end;
}

/**
 * Play one of their sounds into dest from `when`. @param {BaseAudioContext} ctx @param {AudioNode} dest
 * @param {'krik'|'murmur'|'whirr'} kind @param {any} R recipes/audio/teal.json
 * @param {{ next: () => number, range: (a: number, b: number) => number }} rng @param {number} when audio time
 * @returns {number} when it ends (audio time)
 */
export function tealCall(ctx, dest, kind, R, rng, when) {
  if (kind === 'whirr') return whirr(ctx, dest, R, rng, when);
  if (kind === 'murmur') return murmur(ctx, dest, R.murmur, rng, when);
  return krik(ctx, dest, R.krik, rng, when);
}

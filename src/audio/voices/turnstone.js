// @ts-check
// The turnstones' voice (B3 wave 2; doc 17 "Procedural creature voices"): the flock's rapid
// staccato chatter as it flushes and flies, a feeding bird's soft 'tuk', and a few twitters at the
// roost, made in code as the hen's sounds are (voices/hen.js): each note a sawtooth through a bright
// formant bandpass, short, falling a little in pitch. Timing and pitch come from
// recipes/audio/turnstone.json with a seeded stream, so a replayed call sounds the same. The caller
// places it (voices.js turnstone()).

const db = (/** @type {number} */ d) => Math.pow(10, d / 20);

/**
 * One short voiced note. @param {BaseAudioContext} ctx @param {AudioNode} dest @param {number} t start (audio time)
 * @param {number} dur @param {number} f0 @param {number} droop share the pitch falls by over the note
 * @param {number} gain linear peak @param {number} formantHz @param {number} q @returns {number} its end
 */
function note(ctx, dest, t, dur, f0, droop, gain, formantHz, q) {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(f0 * (1 - droop), t + dur);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = formantHz; bp.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + Math.min(0.006, dur * 0.2));
  g.gain.setTargetAtTime(0, t + dur * 0.5, dur * 0.2);
  osc.connect(bp).connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.08);
  osc.onended = () => { osc.disconnect(); bp.disconnect(); g.disconnect(); };
  return t + dur + 0.08;
}

/**
 * A run of notes from one bird. @param {BaseAudioContext} ctx @param {AudioNode} dest @param {any} N the kind's block
 * @param {{ range: (a: number, b: number) => number }} rng @param {number} t @param {number} [tail] how many end notes slow
 * @returns {number} its end
 */
function runOf(ctx, dest, N, rng, t, tail = 0) {
  const n = Math.round(rng.range(N.notes[0], N.notes[1])), f = rng.range(N.f0Hz[0], N.f0Hz[1]), g = db(N.gainDb);
  let end = t;
  for (let i = 0; i < n; i++) {
    const last = i >= n - tail, slow = last ? N.tailSlow ?? 1 : 1;
    end = note(ctx, dest, t, N.noteS, f * (last ? 0.94 : 1) * rng.range(0.98, 1.02), N.droop, g * (last ? 0.75 : 1), N.formantHz, N.formantQ);
    t += (N.noteS + rng.range(N.gapS[0], N.gapS[1])) * slow;
  }
  return end;
}

/**
 * Play one of their sounds into dest from `when`. @param {BaseAudioContext} ctx @param {AudioNode} dest
 * @param {'chatter'|'tuk'|'murmur'} kind @param {any} R recipes/audio/turnstone.json
 * @param {{ next: () => number, range: (a: number, b: number) => number }} rng @param {number} when audio time
 * @returns {number} when it ends (audio time)
 */
export function turnstoneCall(ctx, dest, kind, R, rng, when) {
  if (kind === 'chatter') {
    // Several birds at once, each a moment after the first, each on its own pitch.
    const C = R.chatter, v = Math.round(rng.range(C.voices[0], C.voices[1]));
    let end = when;
    for (let i = 0; i < v; i++) end = Math.max(end, runOf(ctx, dest, C, rng, when + (i ? rng.range(0.05, C.spreadS) : 0), C.tailNotes));
    return end;
  }
  return runOf(ctx, dest, kind === 'tuk' ? R.tuk : R.murmur, rng, when);
}

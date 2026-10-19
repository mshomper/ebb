// @ts-check
// Pure math behind the sampler (doc 24, "Sampler rules"), kept apart from Web Audio so it can be
// tested and tuned: which zone and layers a note uses, how loud and how bright it is, how the
// pitch is corrected, and how fast a voice dies away. Every number arrives from
// recipes/music/sampler.json; nothing here is a hidden constant.

/**
 * @typedef {Object} LayerWeight
 * @property {number} layer  0-based layer index, 0 = softest recording
 * @property {number} weight linear gain share (see layerWeights for how a blend adds up)
 */

/**
 * Which recorded layers to sound for a velocity, crossfading over `fadeWidth` velocity steps
 * centred on each boundary (doc 24: 12 steps), so a slow crescendo on one key never steps from one
 * recording to the next.
 *
 * The blend curve matters because two recordings of the same key are partly in phase: an
 * equal-power blend (law 1) keeps the level of unrelated sounds but bumps related ones up by as
 * much as 3 dB in the middle; a straight-line blend (law 0) keeps the level of identical sounds
 * but dips unrelated ones by 3 dB. Real piano layers sit between, so the law is a recipe setting,
 * judged by ear on the bench's close-up test.
 * @param {number} velocity 1..127
 * @param {number[]} bounds ascending velocity boundaries between layers (length = layers - 1)
 * @param {number} fadeWidth velocity steps over which two layers overlap
 * @param {number} [law] 0 straight-line, 1 equal-power, between blends the two (default 1)
 * @returns {LayerWeight[]}
 */
export function layerWeights(velocity, bounds, fadeWidth, law = 1) {
  const half = Math.max(0, fadeWidth) / 2;
  for (let i = 0; i < bounds.length; i++) {
    const b = bounds[i];
    if (half > 0 && velocity > b - half && velocity < b + half) {
      const x = (velocity - (b - half)) / (2 * half); // 0..1 across the fade
      const k = clamp(law, 0, 1);
      const a = (1 - k) * (1 - x) + k * Math.cos(x * Math.PI / 2);
      const c = (1 - k) * x + k * Math.sin(x * Math.PI / 2);
      return [{ layer: i, weight: a }, { layer: i + 1, weight: c }];
    }
    if (velocity <= b) return [{ layer: i, weight: 1 }];
  }
  return [{ layer: bounds.length, weight: 1 }];
}

/**
 * Evenly spaced layer boundaries for n layers over 1..127.
 * @param {number} n @returns {number[]}
 */
export function evenBounds(n) {
  return Array.from({ length: Math.max(0, n - 1) }, (_, i) => Math.round(1 + (126 * (i + 1)) / n));
}

/**
 * The loudness a note should reach at its attack, in dB relative to full scale, for a velocity.
 * The library's files are normalized one by one, so the dynamic range is rebuilt here (doc 24):
 * a power curve from `floorDb` at velocity 1 to `topDb` at 127.
 * @param {number} velocity 1..127
 * @param {{floorDb: number, topDb: number, gamma: number}} curve
 */
export function velocityDb(velocity, curve) {
  const x = clamp((velocity - 1) / 126, 0, 1);
  return curve.floorDb + (curve.topDb - curve.floorDb) * Math.pow(x, curve.gamma);
}

/**
 * Gain in dB to apply to one recording so it lands at the target attack loudness. Measuring the
 * attack of every file and aiming them all at one target is what keeps layers and neighbouring
 * zones level with each other while their color changes.
 * @param {number} targetDb from velocityDb
 * @param {number} fileAttackRmsDb measured RMS of the file's first 300 ms after onset
 * @param {number} registerDb register balance for this note (see registerTiltDb)
 */
export function fileGainDb(targetDb, fileAttackRmsDb, registerDb = 0) {
  return targetDb - fileAttackRmsDb + registerDb;
}

/**
 * Register balance: normalized files make every note equally loud, which a piano is not. A gentle
 * tilt in dB, `bassDb` at MIDI 21 and `trebleDb` at MIDI 108, 0 at `pivotMidi`, linear between.
 * @param {number} midi @param {{bassDb: number, trebleDb: number, pivotMidi: number}} tilt
 */
export function registerTiltDb(midi, tilt) {
  if (midi <= tilt.pivotMidi) return tilt.bassDb * (tilt.pivotMidi - midi) / Math.max(1, tilt.pivotMidi - 21);
  return tilt.trebleDb * (midi - tilt.pivotMidi) / Math.max(1, 108 - tilt.pivotMidi);
}

/**
 * Lowpass cutoff in Hz for a velocity, opening with force like a real hammer (doc 24: about
 * 1.8 kHz at pp to 12 kHz at f), log-interpolated, but never below `minHarmonic` times the note's
 * fundamental so high notes keep their own pitch.
 * @param {number} velocity @param {number} midi
 * @param {{lowHz: number, highHz: number, minHarmonic: number, gamma: number}} f
 */
export function velocityCutoffHz(velocity, midi, f) {
  const x = Math.pow(clamp((velocity - 1) / 126, 0, 1), f.gamma);
  const hz = f.lowHz * Math.pow(f.highHz / f.lowHz, x);
  return Math.max(hz, f.minHarmonic * midiToHz(midi));
}

/**
 * The nearest recorded zone for a note. Zones a whole tone apart mean a shift of at most one
 * semitone (doc 24). On a tie the zone below wins (the note is pitched up, which keeps its color
 * brighter rather than duller).
 * @param {number} midi @param {number[]} zoneMidis ascending
 * @returns {number} index into zoneMidis, or -1 if there are no zones
 */
export function nearestZone(midi, zoneMidis) {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < zoneMidis.length; i++) {
    const d = Math.abs(zoneMidis[i] - midi);
    if (d < bestD) { best = i; bestD = d; }
  }
  return best;
}

/**
 * A gentle stretch-tuning target in cents for a note: flat in the bass, sharp in the treble,
 * near zero through the middle, as pianos are tuned so their inharmonic octaves sound pure.
 * A smooth curve through (21, bassCents), (pivotMidi, 0), (108, trebleCents), cubic toward the
 * ends so the middle three octaves stay almost exactly equal-tempered.
 * @param {number} midi @param {{bassCents: number, trebleCents: number, pivotMidi: number}} s
 */
export function stretchCents(midi, s) {
  if (midi <= s.pivotMidi) {
    const x = (s.pivotMidi - midi) / Math.max(1, s.pivotMidi - 21);
    return s.bassCents * x * x * x;
  }
  const x = (midi - s.pivotMidi) / Math.max(1, 108 - s.pivotMidi);
  return s.trebleCents * x * x * x;
}

/**
 * The pitch correction in cents for a zone under a tuning policy:
 * - 'recorded': play the piano exactly as it was tuned when recorded (its own stretch included);
 * - 'equal': pull every zone to equal temperament at A4 = 440 Hz (doc 24's rule);
 * - 'stretch': pull every zone onto the gentle stretch curve above.
 * Zones whose measurement is less confident than `minConfidence` are left as recorded.
 * @param {'recorded'|'equal'|'stretch'} policy
 * @param {number} zoneMidi @param {number} measuredCents @param {number} confidence
 * @param {{minConfidence: number, stretch: {bassCents: number, trebleCents: number, pivotMidi: number}}} t
 */
export function correctionCents(policy, zoneMidi, measuredCents, confidence, t) {
  if (policy === 'recorded' || !(confidence >= t.minConfidence) || !Number.isFinite(measuredCents)) return 0;
  const target = policy === 'stretch' ? stretchCents(zoneMidi, t.stretch) : 0;
  return target - measuredCents;
}

/**
 * Playback rate for a note played from a zone, with a correction in cents.
 * @param {number} midi @param {number} zoneMidi @param {number} correction
 */
export function playbackRate(midi, zoneMidi, correction) {
  return Math.pow(2, (midi - zoneMidi) / 12 + correction / 1200);
}

/**
 * How long dampers take to stop a string, in seconds, by register: slow in the bass where the
 * strings are heavy, quick in the treble (time constant for setTargetAtTime). Notes at or above
 * `undampedFromMidi` have no damper, as on a real grand: they ring on after the key is released.
 * @param {number} midi
 * @param {{bassS: number, trebleS: number, undampedFromMidi: number}} d
 * @returns {number} seconds, or Infinity when the string is undamped
 */
export function damperTau(midi, d) {
  if (midi >= d.undampedFromMidi) return Infinity;
  const x = clamp((midi - 21) / (d.undampedFromMidi - 21), 0, 1);
  return d.bassS * Math.pow(d.trebleS / d.bassS, x);
}

/**
 * A rough natural decay rate of a held note in dB per second, by register, used only to judge
 * which voice is quietest when one has to be stolen.
 * @param {number} midi @param {{bassDbPerS: number, trebleDbPerS: number}} r
 */
export function decayDbPerS(midi, r) {
  const x = clamp((midi - 21) / 87, 0, 1);
  return r.bassDbPerS + (r.trebleDbPerS - r.bassDbPerS) * x;
}

/**
 * Pick the voice to steal (doc 24): released voices before held ones, and among them the one
 * that is quietest now.
 * @param {{released: boolean, levelDb: number}[]} voices
 * @returns {number} index, or -1 for an empty list
 */
export function pickVictim(voices) {
  let best = -1, bestKey = Infinity;
  for (let i = 0; i < voices.length; i++) {
    const v = voices[i];
    const key = (v.released ? 0 : 1000) + v.levelDb;
    if (key < bestKey) { best = i; bestKey = key; }
  }
  return best;
}

/** @param {number} midi */
export function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** @param {number} db */
export function dbToGain(db) {
  return Math.pow(10, db / 20);
}

/** @param {number} x @param {number} a @param {number} b */
function clamp(x, a, b) {
  return x < a ? a : x > b ? b : x;
}

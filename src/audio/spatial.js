// @ts-check
// Placing a sound in the island (doc 17 "Spatialization", "Finding creatures by ear"). One chain
// per sound: an air-absorption lowpass that closes with distance (18 kHz at 2 m to 3 kHz at 60 m),
// then an HRTF PannerNode (inverse distance). Used by ambient one-shots and by
// creature voices. The AudioListener itself is set by the mixer (mixer.setListener).

/**
 * @typedef {Object} Ear  where the listener is, for the filters (the panner reads ctx.listener)
 * @property {number[]} eye      [x, y, z] meters
 * @property {number[]} forward  unit vector of the view
 */

/**
 * @typedef {Object} SpatialOpts
 * @property {number} refDistance
 * @property {number} rolloff
 * @property {number} [maxDistance]
 * @property {'inverse'|'linear'|'exponential'} [model]
 * @property {{nearM: number, nearHz: number, farM: number, farHz: number}} air  absorption
 */

/**
 * Air absorption cutoff for a distance: log-log from nearHz at nearM to farHz at farM.
 * @param {number} d meters
 * @param {SpatialOpts['air']} a
 */
export function airCutoffHz(d, a) {
  if (d <= a.nearM) return a.nearHz;
  if (d >= a.farM) return a.farHz;
  const x = Math.log(d / a.nearM) / Math.log(a.farM / a.nearM);
  return a.nearHz * Math.pow(a.farHz / a.nearHz, x);
}

/**
 * Build one placed chain into dest. Connect the sound to `input`.
 * @param {BaseAudioContext} ctx @param {AudioNode} dest @param {SpatialOpts} o
 */
export function placedChain(ctx, dest, o) {
  const air = ctx.createBiquadFilter();
  air.type = 'lowpass'; air.Q.value = 0.5; air.frequency.value = o.air.nearHz;
  const panner = ctx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = o.model ?? 'inverse';
  panner.refDistance = o.refDistance;
  panner.rolloffFactor = o.rolloff;
  panner.maxDistance = o.maxDistance ?? 10000;
  air.connect(panner).connect(dest);

  /**
   * Move the sound (at `when`, or glide over rampS when given).
   * @param {number[]} pos @param {Ear} ear @param {number} [when] @param {number} [rampS]
   */
  function place(pos, ear, when, rampS = 0) {
    const t = Math.max(when ?? ctx.currentTime, ctx.currentTime);
    const d = Math.hypot(pos[0] - ear.eye[0], pos[1] - ear.eye[1], pos[2] - ear.eye[2]);
    const hz = Math.min(airCutoffHz(d, o.air), ctx.sampleRate * 0.45);
    /** @type {[AudioParam, number][]} */
    const sets = [[air.frequency, hz]];
    if (panner.positionX) sets.push([panner.positionX, pos[0]], [panner.positionY, pos[1]], [panner.positionZ, pos[2]]);
    else panner.setPosition(pos[0], pos[1], pos[2]);
    for (const [p, v] of sets) {
      if (rampS > 0) p.setTargetAtTime(v, t, rampS / 3);
      else p.setValueAtTime(v, t);
    }
    return d;
  }

  return {
    input: /** @type {AudioNode} */ (air),
    panner,
    place,
    dispose() { try { air.disconnect(); panner.disconnect(); } catch { /* already */ } },
  };
}

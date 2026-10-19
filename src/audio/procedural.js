// @ts-check
// Small island sounds made in code (doc 25, "Procedural sounds"): water drops and plops by bubble
// resonance, stalk knocks by modal synthesis, frost ticks, dry crackles and an aeolian whistle,
// plus the continuous wind, air, lap and trickle beds. They are fallbacks and variety layers
// under the recordings, so they sit quietly (one-shot peaks near -18 dBFS at gainDb 0).
// Numbers come from recipes/audio/procedural.json; variation from the caller's seeded stream
// (src/core/rng.js `stream(seed, ...keys)`), never Math.random.
//
// One-shots: fn(ctx, dest, recipe, rng, {when, ...}) and clean themselves up.
// Beds: fn(ctx, dest, recipe, rng, {...}) -> {output, set(params, rampS), stop(fadeS)}.

export { drop, plop, knock, frostTick, crackle, aeolian } from './procedural/one-shots.js';
export { wind, air, lap, trickle } from './procedural/beds.js';

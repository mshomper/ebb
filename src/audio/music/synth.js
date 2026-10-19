// @ts-check
// Voices built in code (doc 24): the two-operator FM electric piano, the warm pad and the soft
// sine bell. Each answers the same calls as the sampler (noteOn, noteOff, pedal, stopAll), so the
// realizer can treat any of them as an instrument. They live in ./synth/; this file keeps the
// import path. Numbers come from recipes/music/synth.json.

export { createFmPiano } from './synth/fm-piano.js';
export { createPad } from './synth/pad.js';
export { createBell } from './synth/bell.js';

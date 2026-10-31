// @ts-check
// The quadric edge collapse now lives in the game (src/world/mesh/decimate.js), where the small birds
// use it too; tools/hollow-prep/watcher.mjs keeps importing it from here.
export { decimate } from '../../src/world/mesh/decimate.js';

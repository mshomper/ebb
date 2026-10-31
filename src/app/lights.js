// @ts-check
// The small lights that join the camp's own each frame (src/app/camp.js; the shaders take the eight
// most important to the view, src/render/lighting.js). One line per system that lights something,
// read each time the camp sets its lights, so a system made after the camp still joins them.

/** @type {((ctx: import('./context.js').AppContext) => any[])[]} */
export const LIGHTS = [
  // The passing boat's lantern at anchor (docs/future/14; src/app/setpieces.js).
  (ctx) => ctx.passingBoat?.lights() ?? [],
  // The placed lanterns (B2 L1; src/app/fixtures.js).
  (ctx) => ctx.lanterns?.lights() ?? [],
  // The clay furnace's glow while a load burns (the spring-ore plan; src/app/fixtures.js).
  (ctx) => ctx.furnaceLights?.() ?? [],
];

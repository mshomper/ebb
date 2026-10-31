// @ts-check
// The start-up context: one object that src/app.js hands to every system's start-up file in turn
// (src/app/systems.js). Each file reads what the systems before it made and adds what it makes, by
// name (`ctx.walk`, `ctx.camp`). A system made later is read when a callback runs, never when an
// earlier file starts (`() => ctx.sowing.putAway()`), so start-up order stays the one list.
//
// A few names change after start-up and are always read from ctx, never kept in a local:
//   tier, tierSettings, probe, unProbe   a tier switch (src/app/quality.js)
//   size                                 the canvas's CSS and device size (quality.js)
//   input                                the pointer, a stroke, a held pour, undo waiting (pointer.js)
//   zoneGround, zoneCardOnArrival        down in a zone (src/app/zones.js, the frame)
//   floraFrame                           the plants' time and wind this frame (the frame)
//   cards                                the journal's cardAt, once main.js hands it in (setCards)
//   ringPlace, nestBoxAt, keeps          set once the camp is made (camp.js, hen.js)
//   walk, dig, lanterns, passingBoat,    systems read through ctx by ones made earlier
//   furnaceLights, sowing, noteKept, ...

/**
 * Everything made so far at start-up, by name. The shells (canvas, hooks, gpu) come from
 * src/app.js; params and the rest from the systems in order.
 * @typedef {{ [name: string]: any, canvas: HTMLCanvasElement, hooks: import('../app.js').StartHooks, gpu: any }} AppContext
 */

/**
 * One system's start-up step: reads and adds to the context; may return a result that ends start-up
 * early (the save is open elsewhere, or damaged).
 * @typedef {(ctx: AppContext) => (void | object | Promise<void | object>)} StartStep
 */

export {};

// @ts-check
// The frame graph's passes in draw order (src/app/graph.js). A system that draws adds its pass here,
// one line in its place in the order, and, if it draws down in a zone too, to ZONE_PASSES.

import { createSkyPass } from '../render/passes/sky.js';

/** @typedef {import('../render/frame-graph.js').Pass} Pass */

/**
 * Every pass, in draw order. @param {import('./context.js').AppContext} c @returns {Pass[]}
 */
export const passes = (c) => [
  // The spring's cave (drawn only while you are down in it; it clears the frame).
  c.cavePass,
  c.shadowPass,
  c.terrainPass,
  c.grassPass,
  c.rushPass,
  c.matsPass,
  c.floraPass,
  c.walk.printsPass,
  c.creatures.pass,
  c.walk.pass,
  // The beam of light down the cave's shaft, over the walker.
  c.caveBeam,
  c.hen.pass,
  // The gathering knife on the walker's belt (the forager's trail).
  c.belt.pass,
  ...c.schools.map((s) => s.pass),
  c.finds.pass,
  c.keepsakes.pass,
  c.nets.pass,
  ...c.packDraw.passes,
  // The gift stone, what lies on it and the herb bed's edging pebbles (B1 C1).
  c.camp.gifts.pass,
  // The keepsakes standing on the keepsake shelf at camp (B2).
  c.camp.shelf.pass,
  c.pieces.pass,
  // The camp's tent, fire ring and lantern, drawn with their own paint maps.
  c.camp.props,
  // The shovel in the walker's hands while it digs (src/world/dig).
  c.dig.props,
  // The fishing rod in hand and the float on the water, and the fish on the line (src/world/fishing).
  c.fishing.props,
  c.fishing.pass,
  c.boat.pass,
  // The passing boat at anchor offshore (docs/future/14).
  c.passingBoat.pass,
  // What lives under a log, while it is lifted (L3a).
  c.underLog.pass,
  // Autumn's fungi (a creature pass) and dewy webs, after the logs and the grass they are on.
  ...c.autumn.passes,
  ...c.spring.passes,
  // Moon jellyfish on the summer strandline: clear, so drawn over the opaque things behind them.
  ...(c.finds.jellyPass ? [c.finds.jellyPass] : []),
  ...(c.frogScale ? [c.frogScale.pass] : []),
  c.waterPass,
  c.midges.pass,
  createSkyPass(c.atmosphere, c.skyRecipe),
  // Waterfalls after the sky, so a curtain seen against the sky is not drawn over (src/render/passes/falls.js).
  c.fallsPass,
  // The camp's fire sim (its flame's heat for the tonemap, its smoke into the HDR), then the embers'
  // smoke, sparks and moths: after the sky too, so smoke against it shows.
  c.camp.firePass,
  c.camp.fx,
  // Beach glints: added light on the keepsakes and finds, after everything that could hide them.
  c.glints,
  // Photo mode's lens, on the finished HDR image (passes/post/dof.js).
  c.dof,
  c.exposure,
  c.bloom,
  c.tonemap,
];

/**
 * The passes that run down in a zone (src/world/zones), beside the walker and the post passes; every
 * other pass is off while you are in one. @param {import('./context.js').AppContext} c @returns {Pass[]}
 */
export const zonePasses = (c) => [c.walk.pass, c.exposure, c.bloom, c.tonemap, c.dof, c.cavePass, c.caveBeam];

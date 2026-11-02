// @ts-check
// The light on the stack (docs/future/19; src/world/stack): made with the land, after the meadow
// islet (it stands on the side the islet does not take), so it is in the ground before the water and
// the walk grid are laid over it; given the view, the walker, the zones and the clock once they
// exist. `?stack` (testing, unsaved) raises the causeway at once and puts you on it; `?stack=road`
// plays the causeway's reveal now; `?stack=lights` keeps the light at its foot on for the visit (an
// evening there: add `&hour=19`); `?stack=mouth` puts you in the mouth room, the lantern cold;
// `?stack=lamp` the same with the lantern lit and hung.
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import * as clock from '../core/clock.js';
import { get as getStore, update as updateStore, subscribe as subscribeStore } from '../core/store.js';
import { on, emitDeferred } from '../core/events.js';
import { loadRecipe } from '../core/recipes.js';
import { subSeed } from '../core/rng.js';
import { baseSampler } from '../world/terrain/landform.js';
import { tideParams } from '../world/tide.js';
import { createStack } from '../world/stack/index.js';
import { createRoadReveal } from '../world/stack/reveal.js';
import { createStackMouth } from '../world/stack/mouth.js';
import { createCavePass } from '../render/passes/cave.js';
import { edgeTarget, stepEdge, edgeMark } from '../world/camp/edge.js';

/** @param {import('./context.js').AppContext} ctx */
export async function land(ctx) {
  const { landRecipe, params, seed, terrain, waterRecipe } = ctx;
  if (!landRecipe.stack) return;
  const R = await loadRecipe('setpieces/stack');
  const terrainSeed = subSeed(seed, 'terrain');
  const stack = createStack({ S: landRecipe.stack, R, land: landRecipe, terrain, seed: subSeed(seed, 'stack'), terrainSeed,
    isletDeg: ctx.islet?.layout?.sideDeg ?? null, tide: tideParams(waterRecipe.tide), hours: () => clock.worldT() / clock.SECONDS_PER_HOUR,
    base: baseSampler(landRecipe, terrainSeed), test: params.has('stack') ? params.get('stack') ?? '' : null });
  Object.assign(ctx, { stack, stackRecipe: R });
}

/** @param {import('./context.js').AppContext} ctx */
export async function start(ctx) {
  const { camera, sim, stack, stackRecipe: R, terrain, walk, world, zones } = ctx;
  if (!stack) return;
  stack.attach({ camera, dayLengthH: () => world.state?.seasons?.dayLengthH ?? 12,
    walker: () => { const w = walk.walker; return walk.below && !walk.zone && w?.placed ? { x: w.x, z: w.z, yaw: w.yaw } : null; } });
  // Go down never sets you on the stack, its ledges or in the cave (docs/23; src/world/walk).
  walk.setLanding?.((/** @type {number} */ x, /** @type {number} */ z) => {
    const p = stack.landing(x, z);
    if (p) emitDeferred('island:notice', { text: R.words.noSetDown, showS: 5 });
    return p;
  });
  // Its glow and moths join the placed lanterns' in the camp's effects pass.
  ctx.lanterns?.addGlass?.(() => stack.glass());
  // The reveal waits for the return reveal, a zone, a stroke and the first evening.
  let otherReveal = false;
  on('reveal:started', (/** @type {any} */ p) => { if (p?.kind !== 'stack-road') otherReveal = true; });
  on('reveal:ended', (/** @type {any} */ p) => { if (p?.kind !== 'stack-road') otherReveal = false; });
  const reveal = createRoadReveal({ stack, R, camera, walk, clock,
    busy: () => otherReveal || !!zones.active() || zones.busy() || terrain.isBusy() || getStore('intro')?.done === false });
  // The mouth room: a second cave pass, drawn while it is the zone (src/app/passes.js).
  const mouthPass = createCavePass({ active: () => zones.active() === 'stack-mouth', name: 'stack-mouth' });
  const mouthBeam = mouthPass.beamPass();
  const mouth = createStackMouth({ R: await loadRecipe('world/stack-mouth'), stack, walk, zones, pass: mouthPass,
    day: () => clock.dayIndexOf(clock.worldT()), stretches: R.rubble.stretches });
  // Seeing the arch adds the driftwood staff to the workbench's makes (cook.json unlock 'staff').
  const staff = () => {
    const seen = (getStore('journal')?.flags ?? []).includes('setpiece:stack:arch');
    if (seen && !getStore('unlocks')?.staff) updateStore('unlocks', (u) => ({ ...u, staff: true }));
  };
  subscribeStore('journal', staff);
  subscribeStore('unlocks', staff);
  staff();
  /** A test link's spot to put you, tried each frame until the walk grid holds the causeway. @type {{ x: number, z: number, yaw: number, mouth: boolean, tries: number } | null} */
  ctx.stackPut = null;
  sim.addSystem({ id: 'stack', tick: (/** @type {any} */ f) => {
    stack.tick(); reveal.update(f.realDt ?? 0); mouth.prepare();
    const p = ctx.stackPut;
    if (p && p.tries-- > 0 && walk.placeAt(p.x, p.z, p.yaw, 'stand')) {
      ctx.stackPut = null;
      walk.downHere();
      if (p.mouth) zones.goNow('stack-mouth');
    } else if (p && p.tries <= 0) ctx.stackPut = null;
  } });
  // The ring's dashed edge while a brush ring comes near it, in the camp pad's style (frame.js).
  let edge = 0;
  /** @param {number} dt @param {any} ring the brush ring @param {any} tools the tools slice */
  const stackMark = (dt, ring, tools) => {
    const dash = getStore('campPad')?.dash ?? { opacity: 0.55, fadeS: 0.3 };
    const pad = { ...stack.ring, dash: { ...dash, showWithinM: R.dashWithinM } };
    edge = stepEdge(edge, edgeTarget(/** @type {any} */ (pad), ring, tools), dt, dash.opacity ?? 0.55, dash.fadeS);
    return edgeMark(/** @type {any} */ (pad), edge);
  };
  Object.assign(ctx, { stackReveal: reveal, stackMouth: mouth, mouthPass, mouthBeam, stackMark });
}

/** `?stack`, `?stack=road`, `?stack=mouth` (test links, unsaved). @param {import('./context.js').AppContext} ctx */
export function tests(ctx) {
  const { stack, stackReveal } = ctx;
  if (!stack) return;
  const t = stack.takeTest();
  if (t === null || t === 'lights-on' || t === 'lights') return;
  if (t === 'road') { stackReveal.playNow(); return; }
  // Up at once, with no reveal.
  if (!stack.risen) { const from = stack.startRoad(); stack.writeRoad(1); stack.roadDone(from, false); }
  const L = stack.layout, road = stack.road;
  const [fx, fz] = road ? [L.foot[0] * 0.7 + (road.box.x0 + road.box.x1) / 2 * 0.3, L.foot[1] * 0.7 + (road.box.z0 + road.box.z1) / 2 * 0.3] : L.stand;
  const inside = t === 'mouth' || t === 'lamp', x = inside ? L.stand[0] : fx, z = inside ? L.stand[1] : fz;
  // `?stack=lamp`: the old lantern already lit and hung, to see the room by it.
  if (t === 'lamp') updateStore('stack', (s) => ({ ...s, lantern: 'hung' }));
  ctx.stackPut = { x, z, yaw: Math.atan2(L.x - x, L.z - z), mouth: inside, tries: 600 };
}

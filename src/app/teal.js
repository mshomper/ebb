// @ts-check
// The teal and the teal hat (B3 wave 3): a winter flock on a reedy pond you dug. Their visits and
// the ground they want are S0's (src/app/shaped.js); this records what each look found as the
// flock's home for the hourly tick (src/world/creatures/flock.js), shows a visit, and makes the
// live flock (src/world/teal), which joins the schools so taps, Show me and the reveal find it.
// Their gift, the green wing feather (src/world/expansion.js, at their group moment), goes into a
// pouch, or onto the gift stone once that stands. Feather, linen cloth and rush cord make the teal
// hat at the workbench (cook.json teal-hat, out 'hat'): owned and worn at once in the kit's hat
// slot, the feather drawn in its band, and while you wade in it creatures start less (the hat's
// boon on presence's comfort rings, src/app/creatures.js).
// Run in order from src/app/systems.js, after eels.start; reads and adds to the start-up context.

import * as clock from '../core/clock.js';
import { on, emit, emitDeferred } from '../core/events.js';
import { get as getStore, update as updateStore } from '../core/store.js';
import { loadRecipe } from '../core/recipes.js';
import { homeOf } from '../world/ecology/shaped.js';
import { recordHome, bringFlock } from '../world/creatures/flock.js';
import { createTeals } from '../world/teal/index.js';
import { hasGiftStone } from '../world/camp/gifts.js';
import { featherMesh } from '../world/hen/feather.js';
import { WATER_CLASS } from '../world/water/summary.js';
import { waterCellCenter } from '../world/water/grid.js';

/** The hat's id in the kit, and the feather's pack kind. */
export const TEAL_HAT = 'teal', FEATHER = 'teal-feather';

/**
 * The hat's lift on every comfort ring (presence's ringK): its boon's wadeRingK while you stand in
 * water at least wadeDepthM deep wearing it, else 1. Pure. @param {any} boon kit.json items.hat.<id>.boon @param {number} depthM where you stand
 */
export const wadeRingK = (boon, depthM) => (boon?.wadeRingK && depthM >= (boon.wadeDepthM ?? 0.05) ? boon.wadeRingK : 1);

/** @param {import('./context.js').AppContext} ctx */
export async function start(ctx) {
  const { camera, camp, kit, pack, params, presence, schools, seed, shapedAfterLook, sim, speciesRecipes, terrain, water, world } = ctx;
  const R = speciesRecipes.teal;
  if (!R) return;
  const key = R.key, V = R.ecology.visit;
  const bird = await loadRecipe(`birds/${R.body.birds}`);
  // Their voice (recipes/audio/teal.json): when they call; src/audio makes the calls in code.
  const sounds = await loadRecipe('audio/teal');

  const teals = createTeals({ recipe: R, bird, seed, world, camera, presence, water: (x, z) => water.sampleLive(x, z),
    hours: () => clock.display() / clock.SECONDS_PER_HOUR, you: () => ctx.walk?.below ? ctx.walk.you() : null,
    record: () => updateStore('world', () => world.state), sounds, testFlushS: params.has('tealflush') ? 20 : 0 });
  updateStore('creatureSound', (c) => ({ ...(c ?? {}), teals: () => teals.voiced() }));
  sim.addSystem(teals);
  // With the schools, so the journal's taps and Show me, the reveal and the frame graph find it.
  schools.push(/** @type {any} */ (teals));

  // Each look at the shaped ground: the pond home for the hourly tick (met, its area, its middle).
  /** `?teals` placed its flock: its home is the test's, not what the looks find. */
  let testing = false;
  shapedAfterLook.push((report) => {
    if (testing) return;
    const home = homeOf(report, V.home);
    const at = home.best ?? world.state?.creatures?.[key]?.home ?? null;
    if (!at) return;
    const next = recordHome(world.state, key, { met: home.met, m: home.best?.areaM2 ?? at.m ?? 0, x: at.x, z: at.z });
    if (next !== world.state) { world.state = next; updateStore('world', () => world.state); }
  });
  on('visit:start', (/** @type {{ sp: string, show: any, x: number, z: number }} */ v) => teals.visit(v));

  // Their gift (expansion.js gives it at their group moment): the feather into a pouch (a small
  // heap at your feet when the pack is full), or laid on the gift stone once that stands.
  const giveFeather = () => {
    if (pack.room?.(FEATHER) ?? true) pack.add(FEATHER, 1);
    else pack.heapHere?.(FEATHER, 1);
  };
  on('progress:gifted', (/** @type {any} */ g) => {
    if (g?.kind !== 'gift' || g.id !== key) return;
    if (hasGiftStone(getStore('camp'))) emit('camp:gift-leave', { kind: FEATHER, from: key });
    else giveFeather();
  });
  on('camp:gift-taken', (/** @type {any} */ g) => { if (g?.kind === FEATHER) giveFeather(); });

  // The teal hat made at the workbench: owned, and put on.
  on('camp:made', (/** @type {{ make: string }} */ m) => {
    if (m.make !== 'teal-hat') return;
    kit.gain('hat', TEAL_HAT, true);
  });
  // Wading in it: the comfort rings shrink (read by presence each frame, src/app/creatures.js).
  ctx.hatRingK = () => {
    const boon = kit.hatBoon();
    const me = ctx.walk?.below ? ctx.walk.you() : null;
    return boon && me ? wadeRingK(boon, water.sampleLive(me[0], me[2]).depth) : 1;
  };
  // The feather in the hat's band, on the far side from the hen's band, carried by the hat's bone.
  const F = bird.hatFeather;
  if (F) {
    camp.props.addMesh(FEATHER, featherMesh(F), F.srgb, F.rough);
    camp.addProps(() => {
      if (getStore('kit')?.hat !== TEAL_HAT) return [];
      const on = ctx.walk?.figure?.()?.carried(F.bone, F.at, F.turnDeg);
      return on ? [{ key: FEATHER, x: on.x, y: on.y, z: on.z, yaw: on.yaw, pitch: on.pitch, roll: on.roll, scale: F.scale }] : [];
    });
  }

  // `?tealhat` (testing, unsaved): the feather, a handful of linen cloth and rush cord in the pack,
  // to make the hat at the workbench (with `?camp=bench`, standing at it).
  if (params.has('tealhat')) { pack.add(FEATHER, 1); pack.add('cloth', 1); pack.add('rush-cord', 1); }

  // `?tealflush` (testing, with `?teals`): the flock is flushed every 20 seconds by a pretend walker
  // beside it, so the rise, the lap round the pond and the landing can be watched from above.
  // `?teals` (testing, unsaved): a flock of 5 (or `?teals=N`) settles now on the still water
  // nearest the view, whatever the season; `&trust=` starts them knowing you that well (0.2
  // Tolerant, 0.45 Curious, 0.5 their group moment and gift).
  if (params.has(key)) {
    const n = Math.max(1, Math.min(10, Number.parseInt(params.get(key) ?? '5', 10) || 5));
    let wait = 0;
    sim.addSystem({ id: 'teals-test', tick(/** @type {any} */ f) {
      if (wait < 0 || !world.env.habitat?.() || !water.sim.live || getStore('testGrow')?.done === false) return;
      wait += f.realDt;
      if (!getStore('journal') && wait < 3) return;
      const at = pondNear(camera.target[0], camera.target[2]);
      if (!at) return;
      wait = -1;
      const r = bringFlock(world.state, clock.hourIndex(), world.env, R, n, at.x, at.z);
      // Seen in any season: the test keeps them here while they would be away.
      world.state = { ...r.state, creatures: { ...r.state.creatures, [key]: { ...r.state.creatures[key], dormant: false } } };
      teals.placeTest(at.x, at.z);
      testing = true;
      updateStore('world', () => world.state);
      for (const e of r.events) emitDeferred(e.name, e.payload);
      emitDeferred('world:ticked', { hour: clock.hourIndex(), events: r.events, state: world.state });
    } });
  }

  /** The deepest still water within reach of (x, z): a pond's middle, or null. @param {number} x @param {number} z */
  function pondNear(x, z) {
    const s = water.getSummary?.();
    if (!s?.rect) return null;
    let best = null, bestK = -Infinity;
    for (let j = 0; j < s.rect.h; j++) for (let i = 0; i < s.rect.w; i++) {
      if (s.cls[j * s.rect.w + i] !== WATER_CLASS.still) continue;
      const cx = waterCellCenter(s.rect.x + i), cz = waterCellCenter(s.rect.y + j);
      const d = water.sampleLive(cx, cz).depth;
      if (d < R.life.minDepthM) continue;
      // Deep water near the view first.
      const k = d * 4 - Math.hypot(cx - x, cz - z) * 0.05;
      if (k > bestK) { bestK = k; best = { x: cx, z: cz }; }
    }
    return best;
  }

  Object.assign(ctx, { teals });
}

// @ts-check
// Test links (unsaved): the start-time ones (`?day=`, `?hour=`, `?trust=`, `?autumn`), and the ones that
// set something up once the island is up (stand you somewhere, fill the pack, build a scene). A test
// link that only changes one argument or recipe stays one line in its own system's file.
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import * as clock from '../core/clock.js';
import { emitDeferred, on } from '../core/events.js';
import { get as getStore, update as updateStore, subscribe as subscribeStore } from '../core/store.js';
import { loadRecipe } from '../core/recipes.js';
import { subSeed } from '../core/rng.js';
import { createCreaturePass } from '../render/passes/creatures.js';
import { bakeBody } from '../world/creatures/body-bake.js';
import { previewSpots } from '../world/creatures/preview-spots.js';
import { moodsOf, mistyAutumnMorning, autumnStartOf } from '../world/finds/autumn.js';
import { HABITAT_CELLS, HABITAT_ORIGIN } from '../world/growth/habitat.js';
import { waterCellOf } from '../world/water/grid.js';
import { keyOf } from '../world/species.js';
import { bringSwarm } from '../world/creatures/swarms.js';
import { history, dispatch } from '../input/actions.js';
import { TEST_PARAMS } from '../save/autosave.js';
import { introStartHour } from '../world/intro/boot.js';
import { buildCliffDemo } from '../world/terrain/cliff-demo.js';
import { buildSandbarDemo } from '../world/walk/sandbar.js';

/**
 * `?trust=0.5` (testing): every frog, school and swarm here knows you at least this well from the next
 * hour, up to its ceiling (S6c, trust.js; swarms.js). Read into the world's env (src/app/world.js).
 * @param {URLSearchParams} params
 */
export const testTrust = (params) => Math.max(0, Math.min(1, Number.parseFloat(params.get('trust') ?? '0') || 0));

/** The start time and `?day=N` growing, before the world is made. @param {import('./context.js').AppContext} ctx */
export async function startTime(ctx) {
  const { back, params, seasonsRecipe, seed, skyRecipe } = ctx;
  // The world clock and the shared hourly tick (weather, seasons). A new world starts mid-morning.
  // `?day=N` starts a new world N game days in (14 per season: 15 is early summer), to see later seasons sooner.
  // `?frogs=N` (testing) starts on spring day 7 unless a day is given, after the frogs' winter sleep
  // (they wake 0.3 into spring, day 5).
  // `?dragonflies=N` starts on summer day 2: they fly from the start of summer (recipes/world/seasons.json).
  // `?damselflies=N` starts on the last day of spring (day 13): the first ones climb out at 0.9.
  // `?turtles=N` starts on summer day 2 too: they wake once the water has warmed (0.05 into summer).
  // `?dig=sleeper` starts on winter day 1 (day 43), when toads sleep in the ground (B1 D1).
  const testDay = params.has('dragonflies') || params.has('turtles') ? '15' : params.has('damselflies') ? '13' : params.has('frogs') ? '6' : params.get('dig') === 'sleeper' ? '43' : '0';
  const startDay = Math.max(0, Number.parseInt(params.get('day') ?? testDay, 10) || 0);
  // `?autumn` (testing, unsaved): a new world starts on its first misty autumn morning with fungi
  // grown (src/world/finds/autumn.js), and a kept log is laid near the view once the island is up.
  const autumnRecipe = await loadRecipe('species/autumn-finds');
  const autumnMoods = (/** @type {number} */ lean) => moodsOf(subSeed(seed, 'weather'), lean, seasonsRecipe.weather);
  const autumnDay = params.has('autumn') ? mistyAutumnMorning({ fromDay: 0, moodOf: autumnMoods(0), F: autumnRecipe.fungi }) : null;
  if (clock.worldT() === 0 && autumnDay !== null) clock.reset((autumnRecipe.webs.testHour + 24 * autumnDay) * clock.SECONDS_PER_HOUR);
  // `?hour=H` (testing, unsaved) starts a new world at that hour of the day: low water falls at 6
  // and 18, so `?sandbar&hour=7` opens in early light with the bar dry and the tide rising.
  const startHour = Math.min(23.9, Math.max(0, Number.parseFloat(params.get('hour') ?? '') || (skyRecipe.orbit.startHour ?? 10)));
  // A new island opens at dawn on spring day 0, for the first evening (src/world/intro/boot.js).
  const introRecipe = await loadRecipe('world/intro');
  const introHour = introStartHour(introRecipe, skyRecipe.orbit, params, !back, TEST_PARAMS,
    params.has('hour') || params.has('day') || testDay !== '0' || autumnDay !== null);
  if (clock.worldT() === 0 && introHour !== null) clock.reset(introHour * clock.SECONDS_PER_HOUR);
  // `?day=N` on a new island grows it (quick fixes, October 28, 2026): the island starts on day 0 and
  // its N days run through the catch-up before it shows, as if it had been left alone (src/sim/away.js,
  // store slice `testGrow`). The clock waits until then; the other test links apply on top (afterGrow).
  const growHours = params.has('day') && !back && clock.worldT() === 0 ? 24 * startDay : 0;
  if (clock.worldT() === 0) clock.reset((startHour + 24 * startDay - growHours) * clock.SECONDS_PER_HOUR);
  updateStore('testGrow', (g) => g ?? (growHours > 0 ? { hours: growHours, done: false } : null));
  if (growHours > 0) clock.hold(true);
  /** Run a test link's set-up now, or once `?day=N` has grown the island. @param {() => any} fn */
  const afterGrow = (fn) => {
    if (getStore('testGrow')?.done !== false) { fn(); return; }
    const off = subscribeStore('testGrow', (/** @type {any} */ g) => { if (g?.done) { off(); fn(); } });
  };
  updateStore('meta', (m) => { m.flow = clock.flow(); });
  Object.assign(ctx, { autumnRecipe, autumnMoods, autumnDay, introRecipe, afterGrow });
}

/** @param {import('./context.js').AppContext} ctx */
export function swarms(ctx) {
  const { params, sim, speciesRecipes, water, world } = ctx;
  // `?minnows=N`, `?dragonflies=N`, `?damselflies=N` (testing, unsaved): a group of N comes at once
  // and is settled, once the island, its water and the journal are up (as `?frogs` does). Under
  // `?debug`, window.ebb.summon() asks for one the same way (below).
  const testSwarms = ['minnow', 'dragonfly', 'damselfly', 'turtle'].filter((id) => params.has(keyOf(speciesRecipes[id])))
    .map((id) => ({ rec: speciesRecipes[id], count: Math.max(1, Math.min(30, Number.parseInt(params.get(keyOf(speciesRecipes[id])) ?? '12', 10) || 12)) }));
  let swarmWait = 0;
  if (testSwarms.length || params.has('debug')) sim.addSystem({ id: 'swarm-tests', tick(/** @type {any} */ f) {
    if (!testSwarms.length || !world.env.habitat?.() || !water.sim.live || getStore('testGrow')?.done === false) return;
    swarmWait += f.realDt;
    if (!getStore('journal') && swarmWait < 3) return;
    for (const t of testSwarms.splice(0)) {
      const r = bringSwarm(world.state, clock.hourIndex(), world.env, t.rec, t.count);
      world.state = r.state;
      updateStore('world', () => world.state);
      for (const e of r.events) emitDeferred(e.name, e.payload);
      emitDeferred('world:ticked', { hour: clock.hourIndex(), events: r.events, state: world.state });
    }
  } });
  Object.assign(ctx, { testSwarms });
}

/** @param {import('./context.js').AppContext} ctx */
export function treats(ctx) {
  const { back, camera, campRecipe, creatures, frogRecipe, pack, params, schools, sim, terrain, walk, water } = ctx;
  if (params.has('treats') && !back) { pack.add('wrack', 3); pack.add('leaf-pack', 3); pack.add('leaves', 1); pack.add('pondweed.strands', 3); }
  // `?turtles=N&treats`: worms, two lily leaf parcels, and a lily leaf with worms and cord to make
  // another at the bench (`&camp=bench`), in place of the frogs' and minnows' treats; you stand on
  // the bank by the turtles, facing them, so a treat set out lies at the water's edge.
  if (params.has('treats') && params.has('turtles') && !back) {
    for (const k of ['wrack', 'leaf-pack', 'leaves', 'pondweed.strands']) pack.take(k, 3);
    // At camp the pouches go to the bench's own kit too, so no made parcels: you make one.
    pack.add('worms', 3); if (!params.has('camp')) pack.add('lily-parcel', 2); pack.add('lilies.leaf', 1); pack.add('rush-cord', 1);
    // With `&camp=...` you start at camp instead, to make a parcel at the bench.
    let stood = params.has('camp');
    sim.addSystem({ id: 'turtle-treats-test', tick() {
      const f = stood ? null : schools.find((s) => s.id === 'turtles')?.schools()[0]?.fish[0];
      if (!f) return;
      stood = true;
      const dry = (/** @type {number} */ x, /** @type {number} */ z) => (water.sampleLive(x, z)?.depth ?? 0) <= 0.01;
      for (const d of [1.6, 2, 2.6, 3.2]) for (let i = 0; i < 16; i++) {
        // On dry ground, with water a short step toward the turtle: the edge is in reach.
        const a = (i / 16) * 2 * Math.PI, x = f.x + Math.sin(a) * d, z = f.z + Math.cos(a) * d;
        const yaw = Math.atan2(f.x - x, f.z - z);
        if (!dry(x, z) || dry(x + Math.sin(yaw) * 0.9, z + Math.cos(yaw) * 0.9)) continue;
        if (!walk.placeAt(x, z, yaw, 'stand')) continue;
        camera.setPose({ ...camera.pose(), target: [x, terrain.sampleHeight(x, z), z], yaw: yaw + Math.PI, distance: campRecipe.rest.viewDistanceM, pitch: (campRecipe.rest.viewPitchDeg * Math.PI) / 180 });
        walk.downHere();
        return;
      }
    } });
  }
  // `?treats&frogs=N`: once the frogs are there, you stand on the bank a few steps from one, facing it.
  if (params.has('treats') && params.has('frogs') && !params.has('turtles') && !back) {
    let stood = false;
    sim.addSystem({ id: 'treats-test', tick() {
      const f = stood ? null : creatures.frogs()[0];
      if (!f) return;
      stood = true;
      for (let i = 0; i < 12; i++) {
        // Just outside a shy frog's comfort ring (frog.json presence.ringM), so it comes at once.
        const a = (i / 12) * 2 * Math.PI, d = frogRecipe.presence.ringM + 0.9, x = f.x + Math.sin(a) * d, z = f.z + Math.cos(a) * d;
        if ((water.sampleLive(x, z)?.depth ?? 0) > 0.01) continue;
        const yaw = Math.atan2(f.x - x, f.z - z);
        if (!walk.placeAt(x, z, yaw, 'stand')) continue;
        camera.setPose({ ...camera.pose(), target: [x, terrain.sampleHeight(x, z), z], yaw: yaw + Math.PI, distance: campRecipe.rest.viewDistanceM, pitch: (campRecipe.rest.viewPitchDeg * Math.PI) / 180 });
        walk.downHere();
        return;
      }
    } });
  }
}

/** @param {import('./context.js').AppContext} ctx */
export function springCave(ctx) {
  const { afterGrow, back, dig, params, walk, zones } = ctx;
  // `?spring=cave` (a test link, unsaved): the ground above the spring given way, and you straight down in the cave.
  if (params.get('spring') === 'cave' && !back) afterGrow(() => {
    const spot = dig.story.spring();
    if (!spot) return;
    dig.debug.caveInNow();
    if (walk.placeAt(spot.x + 1.2, spot.z, -Math.PI / 2, 'stand')) walk.downHere();
    zones.goNow('spring-cave');
  });
}

/** @param {import('./context.js').AppContext} ctx */
export function digStood(ctx) {
  const { camera, terrain } = ctx;
  // A `?dig=` test link stands the walker by its spot (src/world/dig testSetUp): the view looks at it from close by.
  on('dig:test-stood', (/** @type {{ x: number, z: number, yaw: number, target: { x: number, z: number } }} */ p) => {
    const mx = (p.x + p.target.x) / 2, mz = (p.z + p.target.z) / 2;
    camera.setPose({ ...camera.pose(), target: [mx, terrain.sampleHeight(mx, mz), mz], yaw: p.yaw + Math.PI * 0.7, distance: 3.2, pitch: (38 * Math.PI) / 180 });
  });
}

/** @param {import('./context.js').AppContext} ctx */
export function lanterns(ctx) {
  const { back, camera, lanterns, pack, params, sim, terrain, walk, water } = ctx;
  if (params.has('lantern') && !back) {
    for (const k of ['clay', 'pebbles', 'sticks', 'rushes.stems']) pack.add(k, 1);
    let stood = false;
    sim.addSystem({ id: 'lantern-test', tick() {
      const pad = stood ? null : getStore('campPad');
      if (!pad || !water.getSummary?.()) return;
      const out = (pad.r ?? 3) + 2, ax = pad.fx ?? 0, az = pad.fz ?? 1;
      const p = lanterns.standNear(pad.x + ax * out, pad.z + az * out);
      if (!p) return;
      stood = true;
      // You a step from it, facing it, the view low behind you.
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * 2 * Math.PI, x = p.x + Math.sin(a) * 1.4, z = p.z + Math.cos(a) * 1.4, yaw = a + Math.PI;
        if ((water.sampleLive(x, z)?.depth ?? 0) > 0.01 || !walk.placeAt(x, z, yaw, 'stand')) continue;
        camera.setPose({ ...camera.pose(), target: [p.x, terrain.sampleHeight(p.x, p.z) + 0.5, p.z], yaw: yaw + Math.PI + 0.8, distance: 3.2, pitch: (12 * Math.PI) / 180 });
        walk.downHere();
        return;
      }
    } });
  }
  // `?lanterns=N` (a test link, unsaved; doc 06): N lanterns (up to 16) stood in a ring round the
  // camp, more than the eight small lights the shaders take, so the picker's choice and its fades can
  // be seen as you walk among them (add `&hour=20` for dusk).
  if (params.has('lanterns') && !back) {
    const want = Math.max(1, Math.min(16, Number.parseInt(params.get('lanterns') ?? '12', 10) || 12));
    let stood = false;
    sim.addSystem({ id: 'lanterns-test', tick() {
      const pad = stood ? null : getStore('campPad');
      if (!pad || !water.getSummary?.()) return;
      stood = true;
      for (let i = 0; i < want; i++) {
        const a = (i / want) * 2 * Math.PI, r = (pad.r ?? 4) + 1.6 + (i % 2) * 1.4;
        lanterns.standNear(pad.x + Math.cos(a) * r, pad.z + Math.sin(a) * r);
      }
    } });
  }
}

/** @param {import('./context.js').AppContext} ctx */
export function perch(ctx) {
  const { back, camera, campRecipe, pack, params, perchSticks, sim, terrain, walk, water, world } = ctx;
  if (params.has('perch') && !back) {
    pack.add('sticks', 2);
    let stood = false;
    sim.addSystem({ id: 'perch-test', tick() {
      const home = stood ? null : world.state?.creatures?.dragonflies?.groups?.[0];
      if (!home) return;
      const P = perchSticks.recipe, deep = (/** @type {number} */ x, /** @type {number} */ z) => water.sampleLive(x, z)?.depth ?? 0;
      for (let d = 1; d <= 8 && !stood; d += 0.5) for (let i = 0; i < 24 && !stood; i++) {
        // Dry ground, with the shallows a step or two in front, toward the pond.
        const a = (i / 24) * 2 * Math.PI, x = home.x + Math.sin(a) * d, z = home.z + Math.cos(a) * d, yaw = a + Math.PI;
        if (deep(x, z) > 0.01) continue;
        const w = deep(x + Math.sin(yaw) * 1.1, z + Math.cos(yaw) * 1.1);
        if (w < P.shallowM[0] || w > P.shallowM[1] || !walk.placeAt(x, z, yaw, 'stand')) continue;
        camera.setPose({ ...camera.pose(), target: [x, terrain.sampleHeight(x, z), z], yaw: yaw + Math.PI, distance: campRecipe.rest.viewDistanceM, pitch: (campRecipe.rest.viewPitchDeg * Math.PI) / 180 });
        walk.downHere();
        stood = true;
      }
    } });
  }
}

/** @param {import('./context.js').AppContext} ctx */
export function packs(ctx) {
  const { back, fishing, fishingRecipe, fishingTest, pack, params } = ctx;
  if (fishingTest !== null && !back) {
    pack.add('worms', fishingRecipe.test.worms);
    pack.add('bigworms', fishingRecipe.test.bigworms);
    updateStore('cook', (c) => ({ ...(c ?? {}), tools: [...new Set([...(c?.tools ?? []), 'line'])] }));
    // `?fishing=chart:N`: N of the island's fish sketched, and the Keeper book open on the chart.
    const chartN = /^chart:(\d+)$/.exec(fishingTest);
    if (chartN) {
      fishing.sketchTest(Number(chartN[1]));
      setTimeout(() => dispatch(/** @type {any} */ ({ type: 'ui.keeper', open: true, tab: 'chart' })), 2500);
    }
  }
  // `?sketch` (a test link, unsaved): a full pouch of charcoal sticks in the pack.
  if (params.has('sketch') && !back) pack.add('charcoal-sticks', 3);
  // `?planting` (a test link, unsaved; P2g): in the pack, water mint seed, an iris clump, two willow
  // withies, kelp for a good start and clay with campion seed for seed balls; the shovel made, for Lift.
  if (params.has('planting') && !back) {
    for (const [k, n] of [['watermint.seed', 3], ['willow.withies', 2], ['kelp', 1], ['clay', 1], ['campion.seed', 1]]) pack.add(/** @type {string} */ (k), /** @type {number} */ (n));
    pack.addClump('iris', 0.55, 0.8);
    updateStore('cook', (c) => ({ ...(c ?? {}), tools: [...new Set([...(c?.tools ?? []), 'shovel'])] }));
  }
}

/** @param {import('./context.js').AppContext} ctx */
export function autumn(ctx) {
  const { autumnDay, autumnRecipe, camera, pieces, sim, water, world } = ctx;
  /**
   * A dry, grassy ground point near the view's middle, out of the tide, for a test log: on a widening
   * spiral, the first where no water stands and the grass is thick. @returns {number[] | null}
   */
  function testLogSpot() {
    const t = camera.target, grass = world.state?.growth?.grass;
    for (let k = 0; k < 400; k++) {
      const r = 0.6 + k * 0.03, a = k * 2.399;
      const x = t[0] + Math.cos(a) * r, z = t[2] + Math.sin(a) * r;
      if ((water.sampleLive?.(x, z)?.depth ?? 0) > 0 || (water.sampleLive?.(x + 1, z)?.depth ?? 0) > 0 || (water.sampleLive?.(x - 1, z)?.depth ?? 0) > 0) continue;
      const i = Math.floor(x - HABITAT_ORIGIN), j = Math.floor(z - HABITAT_ORIGIN);
      if (grass && !(grass[j * HABITAT_CELLS + i] > 120)) continue;
      const s = water.getSummary?.();
      const wi = waterCellOf(x) - (s?.rect.x ?? 0), wj = waterCellOf(z) - (s?.rect.y ?? 0);
      if (s && wi >= 0 && wj >= 0 && wi < s.rect.w && wj < s.rect.h && s.band[wj * s.rect.w + wi]) continue;
      return [x, z];
    }
    return null;
  }
  /** Keep a log near the view as if carried there before this autumn (the fungi's test). @param {number} [x] @param {number} [z] */
  function keepTestLog(x, z) {
    const at = x === undefined || z === undefined ? testLogSpot() : [x, z];
    if (!at) return null;
    const day = Math.floor(clock.hourIndex() / 24), a0 = autumnStartOf(day);
    const F = autumnRecipe.fungi;
    return pieces.debugKeepLog(at[0], at[1], a0 === null ? F.restDays + 1 : day - a0 + F.restDays + 1);
  }
  // `?autumn`: once the water and the grass are up, a kept log near the view, and the camera looks at it.
  if (autumnDay !== null) {
    let laid = false, wait = 0;
    sim.addSystem({ id: 'autumn-test', tick(/** @type {any} */ f) {
      if (laid || !water.sim.live || !world.state?.growth?.grass || (wait += f.realDt) < 2) return;
      laid = true;
      const id = keepTestLog();
      const log = pieces.keptLogs().find((/** @type {any} */ l) => l.id === id);
      if (log) camera.focus(log.x, log.z, 2.6, 28);
    } });
  }
  Object.assign(ctx, { keepTestLog });
}

/** @param {import('./context.js').AppContext} ctx */
export async function frogScale(ctx) {
  const { camera, growth, params, terrain, water, world } = ctx;
  // `?frogscale` (ahead of S6): real-size frogs from the species recipe around the pond, and a
  // camera that may come close, to judge creature size on the island (src/ui/frog-scale.js).
  const frogScale = params.has('frogscale') ? await createFrogScale() : null;
  async function createFrogScale() {
    const recipe = await loadRecipe('species/frog');
    const mesh = bakeBody(recipe.body, recipe.bake.cellM);
    const pass = createCreaturePass({ mesh, recipe });
    camera.setClose({ minDistance: recipe.preview.closeMinDistanceM, minEyeHeight: recipe.preview.closeMinEyeHeightM });
    let size = recipe.body.displayScale ?? 1;
    /** @type {ReturnType<typeof previewSpots>} */ let found = null;
    const place = () => pass.setBeings((found?.spots ?? []).map((s) => ({ ...s, size })));
    return {
      pass, recipe, triangles: mesh.indices.length / 3,
      /** Find the spots (once the island has fresh water); null until then. */
      find() {
        if (found) return found;   // found once, from where the camera first looks, then kept
        if (!water.sim.live) return null;   // the live water copy gives the pad heights
        const target = camera.eye;
        found = previewSpots(growth.habitat?.() ?? world.env.habitat?.() ?? null, world.state?.growth, {
          ground: (x, z) => terrain.sampleHeight(x, z),
          surface: (x, z) => water.sampleLive(x, z).surface,
          from: [target[0], target[2]],
        });
        place();
        return found;
      },
      /** @param {number} s times real size */
      setSize(s) { size = s; place(); },
      get size() { return size; },
    };
  }
  Object.assign(ctx, { frogScale });
}

/** @param {import('./context.js').AppContext} ctx */
export function photo(ctx) {
  const { afterGrow, camera, params, photoRecipe, walk } = ctx;
  // `?photo` (testing, unsaved): on foot, then straight into photo mode; `?photo=soft` or
  // `?photo=pencil` with that filter, `&stop=0` the widest aperture (recipes/world/photo.json dof.fStops).
  if (params.has('photo')) afterGrow(() => {
    if (!walk.below) dispatch({ type: 'walk.down', source: 'key' });
    // Once the glide down has settled behind you (or after a few seconds in any case).
    const t0 = performance.now();
    const wait = setInterval(() => {
      const t = performance.now() - t0;
      if ((t < 2500 || !walk.below || camera.driven()) && t < 9000) return;
      clearInterval(wait);
      dispatch({ type: 'photo.open' });
      const f = params.get('photo') ?? '', stop = Number.parseInt(params.get('stop') ?? '', 10);
      dispatch({ type: 'photo.set', patch: { ...(photoRecipe.filters.list.includes(f) ? { filter: f } : {}), ...(Number.isFinite(stop) ? { stop } : {}) } });
    }, 250);
  });
}

/** @param {import('./context.js').AppContext} ctx */
export function demos(ctx) {
  const { camera, params, terrain, ww } = ctx;
  // `?cliffs` (testing, unsaved): a small cliff scene built with real Terrace and Cut strokes, a
  // spring on the upper shelf so its water falls over the faces (src/world/terrain/cliff-demo.js).
  if (params.has('cliffs')) {
    buildCliffDemo({
      terrain, history, spring: params.get('cliffs') !== 'nospring',
      tapSpring: (p, rate) => ww.tapSpring(p, rate),
      focus: (x, z, distance, pitchDeg) => camera.focus(x, z, distance, pitchDeg),
    }).then(() => emitDeferred('terrain:cliff-demo-built', { cliffChunks: terrain.cliffs.size }))
      .catch((err) => console.error('cliff demo failed', err));
  }

  // `?sandbar` (testing, unsaved; W1): a sandbar and a small islet off the shore, built with real
  // strokes, so the walker's low-tide crossing can be tried before the meadow islet exists.
  if (params.has('sandbar')) {
    buildSandbarDemo({ terrain, history, focus: (x, z, distance, pitchDeg) => camera.focus(x, z, distance, pitchDeg) })
      .then((L) => emitDeferred('walk:sandbar-built', { ok: !!L }))
      .catch((err) => console.error('sandbar demo failed', err));
  }
}

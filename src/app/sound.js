// @ts-check
// The island's sound slice (src/audio reads it) and the shaper's trail watch.
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import * as clock from '../core/clock.js';
import { on } from '../core/events.js';
import { get as getStore, update as updateStore } from '../core/store.js';
import { weatherAt } from '../world/weather.js';
import { state as tideState, tideParams } from '../world/tide.js';
import { soundNear, nothingNear } from '../world/sound-near.js';
import { groupFalls, fallsNear } from '../world/falls-near.js';
import { loadAudioRecipe } from '../audio/recipes.js';
import { firstsOf } from '../world/trails.js';
import { createShaperWatch } from '../world/shaper.js';

/** @param {import('./context.js').AppContext} ctx */
export async function start(ctx) {
  const { back, camera, coveRecipe, creatures, growthRecipe, noteFirst, seasonsRecipe, shaperRecipe, sim, water, waterRecipe, world, zones } = ctx;

  // The island's sound (src/audio, docs 17 and 25) reads the store slice `sound`, written here
  // about ten times a second: display time, season, weather, tide, the camera and what is near it.
  // Only the game starts the sound (src/main.js); for tool pages the slice is simply unread.
  const soundRecipe = await loadAudioRecipe('audio/game');
  const tideP = tideParams(waterRecipe.tide);
  let soundAcc = Infinity;
  let nearAcc = Infinity;
  let near = nothingNear();
  // The waterfalls, from the lips the falls pass reads back a couple of times a second.
  /** @type {import('../world/falls-near.js').Fall[]} */
  let falls = [];
  on('falls:lips', (/** @type {{ lips: Float32Array, count: number }} */ p) => { falls = groupFalls(p.lips, p.count, soundRecipe.falls); });
  // The shaper's trail (doc 13 "Trails"; src/world/shaper.js): the kinds of place you have made,
  // each noticed once, looked for when the water settles, every game hour and after time away.
  const shaperWatch = createShaperWatch({ world, water, recipe: shaperRecipe, coveRecipe, falls: () => falls,
    has: () => new Set(firstsOf(getStore('unlocks')?.earned ?? {}, 'shape').map((f) => f.id)),
    note: (id) => noteFirst({ trail: 'shape', kind: 'place', id, hour: clock.hourIndex() }) });
  // A first look a moment after the island is up (a loaded island notices what it already has).
  let shaperS = 3;
  for (const ev of ['world:ticked', 'water:summary-updated', 'journal:replaced']) on(ev, () => { shaperS = 0.5; });
  sim.addSystem({ id: 'shaper-watch', tick(/** @type {any} */ f) { if (shaperS > 0 && (shaperS -= f.realDt) <= 0) shaperWatch.look(); } });
  /** @param {number} realDt @param {number} display @param {{ index: number, phase: number }} season @param {any} day daylight.update's result */
  function publishSound(realDt, display, season, day) {
    const weather = day.weather;
    soundAcc += realDt;
    nearAcc += realDt;
    if (soundAcc < 1 / soundRecipe.updateHz) return;
    soundAcc = 0;
    if (nearAcc >= soundRecipe.near.nearEveryS) {
      nearAcc = 0;
      near = soundNear({ summary: water.getSummary(), growth: world.state?.growth, rushId: growthRecipe.cover?.[0] ?? null,
        x: camera.target[0], z: camera.target[2], recipe: soundRecipe.near });
      near.falls = fallsNear(falls, camera.target[0], camera.target[1], camera.target[2], soundRecipe.falls);
    }
    const frogs = world.state?.creatures?.frogs?.frogs ?? [];
    // Down in a zone: its own sound bed (the island's beds quiet, its own water near you).
    const zs = zones.zone()?.sound?.() ?? null;
    updateStore('sound', () => ({
      displayT: display, season: season.index, seasonPhase: season.phase,
      weather: zs ? { cloud: 0, rain: 0, mist: 0, wind: 0 } : { cloud: weather.cloud, rain: weather.rain, mist: weather.mist, wind: weatherAt(world.state?.weather, display, seasonsRecipe).wind },
      under: zs?.under ?? 0,
      tidePhase: tideState(display / clock.SECONDS_PER_HOUR, tideP).phase01,
      eye: [...camera.eye], target: [...camera.target], near: zs?.near ?? near,
      residents: frogs.length ? ['frog'] : [],
      // For the music (doc 24): the frogs own dusk while they call; a time preview starts no piece.
      worldT: clock.worldT(), sunAltDeg: (day.sm.sunAlt * 180) / Math.PI,
      frogsAwake: frogs.length > 0 && !world.state?.creatures?.frogs?.dormant,
      frogsCalling: creatures.frogs().some((a) => a.mode === 'call'),
      // A brand-new island (no save came back) opens with music soon after the first touch.
      freshIsland: !back,
    }));
  }
  Object.assign(ctx, { publishSound });
}

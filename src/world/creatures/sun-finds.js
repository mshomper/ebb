// @ts-check
// Small lives that come out to bask by what you set down (doc 13 season markers; docs/future/11
// finds), live: the slow worm beside a carried log on warm spring and summer mornings, and the
// common lizard flat on a sunny stone, more often among the gorse (rigged and alive, LZ: lizard-live.js). Nothing is saved: whether one is
// out is a seeded hash of the log or stone and the day, so every device sees the same, and they go
// in again when the hours, the season or the weather turn. Drawn by a creature pass of their own;
// shown() hands the finds module what a tap may land on. Composed into spring-live.js, which
// publishes the stones as seats in the store.

import { get as getStore } from '../../core/store.js';
import { display, SECONDS_PER_HOUR, HOURS_PER_DAY } from '../../core/clock.js';
import { hash32, subSeed } from '../../core/rng.js';
import { run } from '../../core/workers.js';
import { createCreaturePass } from '../../render/passes/creatures.js';
import { MAX_BONES } from './bodies.js';
import { poseSkeleton, axisAngle } from './pose.js';
import { poseLizard } from './rigs/lizard.js';
import { createLizards } from './lizard-live.js';
import { slowwormBody, tongueBody, poseSlowworm, tongueOut } from './slowworm.js';

const BAKE_JOB = { module: './world/creatures/bodies.js', fn: 'bakeVariant' };

/** Float 0..1 from a hash. @param {number} h */
const unit = (h) => (h >>> 8) / 16777216;

/**
 * Is one of these out now, by the hour, the season and the day's weather? Pure.
 * @param {any} R its recipe @param {number} hourOfDay @param {{ index: number, phase?: number } | undefined} seasons
 * @param {string | undefined} mood today's weather
 */
export function outNow(R, hourOfDay, seasons, mood) {
  if (!seasons || !R.seasons.includes(seasons.index)) return false;
  if (seasons.index === 0 && (seasons.phase ?? 1) < (R.springFrom ?? 0)) return false;
  return hourOfDay >= R.hours[0] && hourOfDay < R.hours[1] && R.moods.includes(mood ?? 'clear');
}

/**
 * @param {{ world: { state: any, env: any }, terrain: { sampleHeight: (x: number, z: number) => number },
 *   water: { sampleLive: (x: number, z: number) => { depth: number } }, pieces: any, recipes: { slowworm: any, lizard: any },
 *   presence?: import('./presence.js').Presence }} opts  presence: what the lizards feel coming close
 */
export function createSunFinds(opts) {
  const { world, terrain, water, pieces } = opts;
  const W = opts.recipes.slowworm, L = opts.recipes.lizard;
  const pass = createCreaturePass({ recipe: { body: { wetSpecular: L.body.wetSpecular, contactShadow: L.body.contactShadow, scaleReal: L.body.scaleReal } }, name: 'sun-finds' });
  /** Skeletons by mesh, once baked. @type {Record<string, any[]>} */ const rigs = {};
  const bake = (/** @type {string} */ key, /** @type {any} */ args) => run(BAKE_JOB, args, { lane: 'background' })
    .then((r) => { rigs[key] = r.bones; pass.setMesh(key, r); })
    .catch((err) => { if (err?.name !== 'Disposed') console.warn(`${key} bake failed`, err); });
  bake('slowworm', { id: 'slowworm', body: slowwormBody(W.body), variant: 0, cellM: W.bake.cellM });
  bake('slowworm-tongue', { id: 'slowworm-tongue', body: tongueBody(W.body, W.motion.tongue), variant: 0, cellM: W.motion.tongue.radiusM / 1.5 });
  bake('lizard', { id: 'lizard', body: L.body, variant: 0, cellM: L.bake.cellM });
  const seed = subSeed(world.env.seed, 'sun-finds');
  /** @type {{ sp: string, x: number, z: number, item: string | null, reach: number }[]} */ let shown = [];
  // The lizards' lives on their stones (lizard-live.js): jerks, push-ups, a dart when you come close.
  const lizards = createLizards({ R: L, ground: (x, z) => terrain.sampleHeight(x, z) });
  let lastT = -1;

  /** @param {number} t real seconds */
  function draw(t) {
    const h = display() / SECONDS_PER_HOUR, day = Math.floor(h / HOURS_PER_DAY), hourOfDay = h - day * HOURS_PER_DAY;
    const S = world.state?.seasons, mood = world.state?.weather?.today?.mood;
    /** @type {import('../../render/passes/creatures.js').Being[]} */ const beings = [];
    /** @type {typeof shown} */ const taps = [];
    // Slow worms: beside a kept log, lying along its flank.
    if (outNow(W, hourOfDay, S, mood) && pass.hasMesh('slowworm')) {
      const list = getStore('pieces')?.list ?? [];
      for (const log of pieces?.keptLogs?.() ?? []) {
        if (!log.still || unit(hash32(seed, log.seed, day, 0x5107)) >= W.chance) continue;
        const yaw = list.find((/** @type {any} */ q) => q.id === log.id)?.yaw ?? 0;
        const side = unit(hash32(seed, log.seed, day, 2)) < 0.5 ? 1 : -1;
        // Along the log's line, out from its middle by offM to one side.
        const ax = Math.sin(yaw), az = Math.cos(yaw), along = (W.along - 0.5) * log.length;
        let x = log.x + ax * along + az * side * (W.offM + log.size * 0.5), z = log.z + az * along - ax * side * (W.offM + log.size * 0.5);
        if (water.sampleLive(x, z).depth > 0.005) continue;
        // Now and then it slides a little along itself.
        const M = W.motion, every = M.slideEveryS[0] + (M.slideEveryS[1] - M.slideEveryS[0]) * unit(hash32(seed, log.seed, 3));
        const k = ((t % every) / M.slideS), slide = M.slideM * Math.min(1, Math.max(0, k)) * (1 - Math.min(1, Math.max(0, k - 1)));
        x += ax * slide; z += az * slide;
        // Posed by its chain of bones (slowworm.js): it slithers through its S as it slides, and
        // flicks its tongue (a mesh of its own on the same bones, drawn only while it is out).
        /** @type {Float32Array | undefined} */ let bones;
        const y = terrain.sampleHeight(x, z);
        if (rigs.slowworm) {
          const id = hash32(seed, log.seed, 0x7a);
          bones = new Float32Array(MAX_BONES * 16);
          poseSkeleton(rigs.slowworm, poseSlowworm(rigs.slowworm, { id, t, slidM: slide }, W.body, W.motion, axisAngle), bones, 0);
          if (pass.hasMesh('slowworm-tongue') && tongueOut(t, id, W.motion.tongue) > 0.02) beings.push({ x, y, z, yaw, size: W.body.displayScale, mesh: 'slowworm-tongue', bones });
        }
        beings.push({ x, y, z, yaw, size: W.body.displayScale, mesh: 'slowworm', bones });
        taps.push({ sp: 'slowworms', x, z, item: null, reach: W.find.tapM + W.body.lengthM * W.body.displayScale * 0.4 });
      }
    }
    // Common lizards: flat on a stone's top on dry ground, more often among the gorse, each living
    // its own life there (lizard-live.js), posed by its bones (rigs/lizard.js).
    const dt = lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - lastT));
    lastT = t;
    /** @type {Set<string>} */ const keep = new Set();
    if (outNow(L, hourOfDay, S, mood) && pass.hasMesh('lizard') && rigs.lizard) {
      const gorse = (world.state?.growth?.plants ?? []).filter((/** @type {any} */ p) => p.sp === 'gorse');
      for (const s of /** @type {any[]} */ (getStore('seats') ?? [])) {
        if (s.kind === 'log' || s.kind === 'raft' || s.inWater) continue;
        const nearGorse = gorse.some((/** @type {any} */ g) => (g.x - s.x) ** 2 + (g.z - s.z) ** 2 <= L.gorseM * L.gorseM);
        const hs = hash32(seed, Math.round(s.x * 100), Math.round(s.z * 100), day);
        if (unit(hs) >= (nearGorse ? L.gorseChance : L.chance)) continue;
        const key = `${Math.round(s.x * 100)},${Math.round(s.z * 100)},${day}`;
        lizards.get(key, hs, { x: s.x, y: s.y, z: s.z, yaw: unit(hash32(hs, 3)) * Math.PI * 2, r: s.r });
        keep.add(key);
      }
    }
    lizards.step(dt, keep, opts.presence?.sources() ?? []);
    for (const z of lizards.all()) {
      const b = new Float32Array(MAX_BONES * 16);
      poseSkeleton(rigs.lizard, poseLizard(rigs.lizard, z, L.motion, axisAngle), b, 0);
      beings.push({ x: z.x, y: z.y, z: z.z, yaw: z.yaw, size: L.body.displayScale, mesh: 'lizard', bones: b });
      taps.push({ sp: 'lizards', x: z.x, z: z.z, item: null, reach: L.find.tapM });
    }
    pass.setBeings(beings);
    shown = taps;
  }

  return { pass, draw, shown: () => shown };
}

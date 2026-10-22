// @ts-check
// Small lives that come out to bask by what you set down (doc 13 season markers; docs/future/11
// finds), live: the slow worm beside a carried log on warm spring and summer mornings, and the
// common lizard flat on a sunny stone, more often among the gorse. Nothing is saved: whether one is
// out is a seeded hash of the log or stone and the day, so every device sees the same, and they go
// in again when the hours, the season or the weather turn. Drawn by a creature pass of their own;
// shown() hands the finds module what a tap may land on. Composed into spring-live.js, which
// publishes the stones as seats in the store.

import { get as getStore } from '../../core/store.js';
import { display, SECONDS_PER_HOUR, HOURS_PER_DAY } from '../../core/clock.js';
import { hash32, subSeed } from '../../core/rng.js';
import { run } from '../../core/workers.js';
import { createCreaturePass } from '../../render/passes/creatures.js';

const BAKE_JOB = { module: './world/creatures/bodies.js', fn: 'bakeVariant' };

/** Float 0..1 from a hash. @param {number} h */
const unit = (h) => (h >>> 8) / 16777216;

/**
 * A slow worm's body as prims: a chain of capsules along a gentle S curve, thickest in the middle
 * and tapering to the tail, with its eyes and a dark line down each flank. Pure.
 * @param {any} B slowworm.json body @returns {any} a body to bake
 */
export function slowwormBody(B) {
  const n = B.segments, prims = [];
  /** A point along the body at share s (0 the snout, 1 the tail tip): forward is +z. @param {number} s */
  const at = (s) => [Math.sin(s * Math.PI * B.waves) * B.bend * B.lengthM * 0.12, B.radiusM, B.lengthM * (0.5 - s)];
  /** Its radius at s: the head a little narrower, thickest a third along, the tail tapering. @param {number} s */
  const rad = (s) => B.radiusM * (s < 0.08 ? 0.8 + 2.5 * s : s < 0.4 ? 1 : 1 - (1 - B.tipShare) * ((s - 0.4) / 0.6));
  for (let i = 0; i < n; i++) {
    const s0 = i / n, s1 = (i + 1) / n;
    prims.push({ type: 'capsule', bone: 'root', a: at(s0), b: at(s1), r: [rad(s0), rad(s1)], k: B.radiusM * 0.4, region: 'back' });
  }
  const head = at(0.03);
  for (const side of [1, -1]) prims.push({ type: 'sphere', bone: 'root', c: [head[0] + side * B.radiusM * 0.6, head[1] + B.radiusM * 0.35, head[2]], r: B.radiusM * 0.22, k: 0, region: 'eye' });
  return { prims, albedo: B.albedo, blotch: { scale: 1, amount: 0 }, bellyBelowNormalY: -0.2, skin: { blendM: 0.003 } };
}

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
 *   water: { sampleLive: (x: number, z: number) => { depth: number } }, pieces: any, recipes: { slowworm: any, lizard: any } }} opts
 */
export function createSunFinds(opts) {
  const { world, terrain, water, pieces } = opts;
  const W = opts.recipes.slowworm, L = opts.recipes.lizard;
  const pass = createCreaturePass({ recipe: { body: { wetSpecular: L.body.wetSpecular, contactShadow: L.body.contactShadow, scaleReal: L.body.scaleReal } }, name: 'sun-finds' });
  const bake = (/** @type {string} */ key, /** @type {any} */ args) => run(BAKE_JOB, args, { lane: 'background' })
    .then((r) => pass.setMesh(key, r))
    .catch((err) => { if (err?.name !== 'Disposed') console.warn(`${key} bake failed`, err); });
  bake('slowworm', { id: 'slowworm', body: slowwormBody(W.body), variant: 0, cellM: W.bake.cellM });
  bake('lizard', { id: 'lizard', body: L.body, variant: 0, cellM: L.bake.cellM });
  const seed = subSeed(world.env.seed, 'sun-finds');
  /** @type {{ sp: string, x: number, z: number, item: string | null, reach: number }[]} */ let shown = [];

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
        beings.push({ x, y: terrain.sampleHeight(x, z), z, yaw, size: W.body.displayScale, mesh: 'slowworm' });
        taps.push({ sp: 'slowworms', x, z, item: null, reach: W.find.tapM + W.body.lengthM * W.body.displayScale * 0.4 });
      }
    }
    // Common lizards: flat on a stone's top on dry ground, more often among the gorse.
    if (outNow(L, hourOfDay, S, mood) && pass.hasMesh('lizard')) {
      const gorse = (world.state?.growth?.plants ?? []).filter((/** @type {any} */ p) => p.sp === 'gorse');
      for (const s of /** @type {any[]} */ (getStore('seats') ?? [])) {
        if (s.kind === 'log' || s.kind === 'raft' || s.inWater) continue;
        const nearGorse = gorse.some((/** @type {any} */ g) => (g.x - s.x) ** 2 + (g.z - s.z) ** 2 <= L.gorseM * L.gorseM);
        const hs = hash32(seed, Math.round(s.x * 100), Math.round(s.z * 100), day);
        if (unit(hs) >= (nearGorse ? L.gorseChance : L.chance)) continue;
        // Head lifts now and then, and a quick push-up.
        const M = L.motion, every = M.lookEveryS[0] + (M.lookEveryS[1] - M.lookEveryS[0]) * unit(hash32(hs, 1));
        const ph = (t + unit(hash32(hs, 2)) * every) % every, lift = ph < M.pushS * 2 ? Math.sin((ph / (M.pushS * 2)) * Math.PI) * M.headLiftM : 0;
        beings.push({ x: s.x, y: s.y + lift, z: s.z, yaw: unit(hash32(hs, 3)) * Math.PI * 2, size: L.body.displayScale, mesh: 'lizard' });
        taps.push({ sp: 'lizards', x: s.x, z: s.z, item: null, reach: L.find.tapM });
      }
    }
    pass.setBeings(beings);
    shown = taps;
  }

  return { pass, draw, shown: () => shown };
}

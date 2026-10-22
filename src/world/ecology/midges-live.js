// @ts-check
// Live midges (S6b-5, docs 11, 12): the swarms you see, from the midge field the hourly tick keeps
// (midges.js). Swarms sit over the field's densest patches (midge-paths.js pickSwarms), many at
// dusk, a few by day, almost none at night, fewer in wind, none in a downpour (thicker on the still
// hours after rain), the total capped by the quality tier;
// each swarm's centre bobs and drifts downwind, and now and then one midge dips and rings the water.
// Drawn by src/render/passes/midges.js. Live look only: nothing here changes the world.

import { display, animT, SECONDS_PER_HOUR, HOURS_PER_DAY } from '../../core/clock.js';
import { createMidgePass } from '../../render/passes/midges.js';
import { createReturn } from '../creatures/reveal-return.js';
import { pickSwarms, swarmShareNow, afterRainNow, orbit, dipNow } from './midge-paths.js';

/**
 * @param {{ world: { state: any }, recipe: any, budget: number,
 *   ground: (x: number, z: number) => number, water: (x: number, z: number) => { surface: number, depth: number },
 *   wind: () => { strength: number, dir: number }, rain?: (hoursAgo: number) => number,
 *   ripples: { addImpulse: (x: number, z: number, strength?: number, radiusM?: number) => void } | null }} opts
 *   recipe: recipes/species/midge.json; budget: midges the quality tier allows (its boids); rain: the
 *   weather's rain 0..1 at display time, or that many game hours before
 */
export function createMidges(opts) {
  const { world, recipe, ripples } = opts;
  let budget = opts.budget;
  const S = recipe.swarm;
  const pass = createMidgePass({ recipe });
  /** @type {any} */ let field = null;
  let total = 0;
  /** @type {{ x: number, z: number, share: number, seed: number, y: number, lastDip: number }[]} */ let swarms = [];
  /** @type {(() => ({ x: number, z: number, r: number } | null)) | null} */ let noGo = null;
  /** @type {{ id: number, pos: number[], density: number }[]} */ let heard = [];
  const midHeight = ((S.heightM?.[0] ?? 0.3) + (S.heightM?.[1] ?? 1.2)) / 2;

  /** The swarms for the field as it stands (it changes each game hour). */
  function choose() {
    field = world.state?.ecology?.midges ?? null;
    // Over the reed clumps first, then the densest ground (midge-paths.js).
    const reeds = (world.state?.growth?.plants ?? []).filter((/** @type {any} */ p) => p.sp === 'reeds');
    swarms = pickSwarms(field, S, reeds).map((s) => ({ ...s, y: Math.max(opts.ground(s.x, s.z), opts.water(s.x, s.z).surface), lastDip: -1 }));
  }

  const comeBack = createReturn(recipe.reveal?.growS ?? 0.6);

  return {
    id: 'midges',
    /** The midges pass, for the frame graph. */
    pass,
    /** @type {import('../creatures/reveal-return.js').RevealHooks} the reveal on return (src/ui/reveal.js) */
    reveal: {
      species: 'midges',
      style: recipe.reveal?.return ?? 'thicken',
      spots: () => swarms.map((s) => ({ id: s.seed, x: s.x, z: s.z })),
      hide: () => comeBack.hide(),
      back: (o) => comeBack.back(animT(), swarms.map((s) => s.seed), o.windowS, o.effects),
      end: () => comeBack.end(),
    },
    /** How many midges are out now (tools). */
    total: () => total,
    /** A new quality tier's cap on midges (its boids), from the next frame. @param {number} n */
    setBudget(n) { budget = Math.max(0, n); },
    /**
     * A place the swarms keep out of while it lasts (the camp's smoking fire): a function giving
     * its centre and radius now, or null. Drawing only. @param {() => ({ x: number, z: number, r: number } | null)} fn
     */
    keepClear(fn) { noGo = fn; },
    /** The swarms now, with their centres (the frog lab, S6c's tongue catches). */
    swarms: () => swarms.slice(),
    /**
     * The swarms as the sound hears them (src/audio): centre, in the middle of their height band,
     * and how thick each is now (0..1 of a full swarm).
     */
    heard: () => heard.slice(),

    /** @param {import('../../sim/live-sim.js').FrameInfo} f */
    tick(f) {
      if ((world.state?.ecology?.midges ?? null) !== field) choose();
      if (!swarms.length) { total = 0; heard = []; pass.set([], f.animT); return; }
      const h = display() / SECONDS_PER_HOUR;
      const hour = h - Math.floor(h / HOURS_PER_DAY) * HOURS_PER_DAY;
      const dayLength = world.state?.seasons?.dayLengthH ?? 12;
      const wind = opts.wind();
      const rainAt = opts.rain ?? (() => 0);
      const share = swarmShareNow(hour, 12 + dayLength / 2, dayLength, wind.strength, S.density, rainAt(0), afterRainNow(rainAt, S.density.rain));
      // In the reveal on return each swarm thickens back in with the other animals (reveal-return.js).
      let counts = swarms.map((s) => Math.round(S.perSwarm * s.share * share * comeBack.at(s.seed, f.animT).k));
      const sum = counts.reduce((a, b) => a + b, 0);
      if (sum > budget) counts = counts.map((c) => Math.floor((c * budget) / sum));
      total = counts.reduce((a, b) => a + b, 0);
      const t = f.animT;
      const dx = Math.cos(wind.dir), dz = -Math.sin(wind.dir);
      const list = swarms.map((s, i) => {
        const u = (s.seed >>> 8) / 16777216;
        const drift = S.windDriftM * wind.strength * (0.6 + 0.4 * Math.sin(0.21 * t + u * 6.283));
        let x = s.x + dx * drift, z = s.z + dz * drift;
        // Smoke from the camp's fire keeps them clear (docs/future/13 C-29): pushed out to its edge.
        const ng = noGo?.();
        if (ng) {
          const ex = x - ng.x, ez = z - ng.z, d = Math.hypot(ex, ez);
          if (d < ng.r) { const k = d > 1e-6 ? ng.r / d : 0; x = ng.x + (k ? ex * k : ng.r); z = ng.z + ez * k; }
        }
        const bob = S.bob.amp * Math.sin(2 * Math.PI * S.bob.hz * t + u * 6.283);
        const dip = dipNow(s.seed, counts[i], t, S);
        // A dipping midge touches the water at the bottom of its dip: a tiny ring there.
        if (dip.index >= 0 && dip.phase >= 0.5 && s.lastDip !== dip.k && ripples) {
          s.lastDip = dip.k;
          const o = orbit(s.seed, dip.index, t, S);
          const w = opts.water(x + o[0], z + o[2]);
          if (w.depth > 0.01) ripples.addImpulse(x + o[0], z + o[2], undefined, 0.04);
        }
        return { x, y: s.y, z, bob, dip: dip.phase, dipIndex: dip.index, seed: s.seed, count: counts[i] };
      });
      pass.set(list, t);
      heard = list.map((s) => ({ id: s.seed, pos: [s.x, s.y + midHeight + s.bob, s.z], density: Math.min(1, s.count / Math.max(1, S.perSwarm)) }));
    },
  };
}

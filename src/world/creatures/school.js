// @ts-check
// A school of fish under the live water surface (M2 minnows; docs 11, 12): Reynolds boids
// (separation, alignment, cohesion) with a target the whole school swims for, kept in water deep
// enough and between the bed and the surface. Now and then the target jumps and the school turns as
// one, each fish banking into the turn, so their flanks catch the sun (the silver flash is the wet
// sheen, physically lit, never painted). Now and then one fish rises to sip at the surface and
// leaves a ring. A fast swoop overhead sends the school darting for the deep spot. At night they
// hang low and slow; in winter they rest in the deep spot.
//
// Live animation only (never saved): positions come from a seeded stream per school and a fixed
// step rate, so the same school moves the same way on every device. Plain Math is fine here.
// Numbers from the species recipe's motion block (recipes/species/minnow.json).

import { stream } from '../../core/rng.js';

/**
 * @typedef {{ x: number, y: number, z: number, vx: number, vy: number, vz: number,
 *   phase: number, roll: number, pitch: number, rise: number }} Fish
 *   phase: tail beat (radians); roll, pitch: radians, eased; rise: seconds left rising (0: not)
 * @typedef {{ water: (x: number, z: number) => { surface: number, depth: number },
 *   ring?: (x: number, z: number) => void }} SchoolEnv
 */

/**
 * @param {{ id: number, seed: number, count: number, home: { x: number, z: number }, deep: { x: number, z: number },
 *   size: number, M: any, env: SchoolEnv }} o
 *   size: drawn size (display scale; spacing scales with it, speeds stay real); M: recipe motion
 */
export function createSchool(o) {
  const { M, env } = o;
  const rng = stream(o.seed >>> 0, 0x5c0, o.id);
  const L = M.bodyM * o.size;   // one drawn body length
  /** @type {Fish[]} */ const fish = [];
  let home = { ...o.home }, deep = { ...o.deep };
  let target = { x: home.x, z: home.z }, nextTurn = 0, nextRise = 0, dartUntil = -1, t = 0;
  /** Crumbs you scattered on the water, and until when the school swirls up to them. @type {{ x: number, z: number } | null} */
  let food = null;
  let feedUntil = -1;
  /** @type {'day'|'night'|'winter'} */ let mood = 'day';

  /** Water at a point, with the bed. @param {number} x @param {number} z */
  const at = (x, z) => { const w = env.water(x, z); return { surface: w.surface, depth: w.depth, bed: w.surface - w.depth }; };

  /** A point in water at least `min` deep within `r` of (cx, cz), from the stream; else (cx, cz). */
  function pick(/** @type {number} */ cx, /** @type {number} */ cz, /** @type {number} */ r, /** @type {number} */ min) {
    for (let i = 0; i < 10; i++) {
      const a = rng.next() * Math.PI * 2, d = Math.sqrt(rng.next()) * r;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (at(x, z).depth >= min) return { x, z };
    }
    return { x: cx, z: cz };
  }

  /** How deep below the surface the school wants to be now (m), within the water there. */
  function wantY(/** @type {number} */ x, /** @type {number} */ z, /** @type {Fish} */ f) {
    const w = at(x, z);
    const clear = M.clearM;
    let y;
    if (f.rise > 0 || feedUntil > t) y = w.surface - clear * 0.5;
    else if (mood === 'day' && dartUntil < t) y = w.surface - M.dayDepthM;
    else y = w.bed + clear * 2;   // night, winter, darting: low
    return Math.min(w.surface - clear, Math.max(w.bed + clear, y));
  }

  /** Place n fish around a point. @param {number} n @param {{ x: number, z: number }} c */
  function spawn(n, c) {
    for (let i = 0; i < n; i++) {
      const p = pick(c.x, c.z, Math.max(0.3, L * 3), M.minDepthM);
      const a = rng.next() * Math.PI * 2;
      const f = { x: p.x, y: 0, z: p.z, vx: Math.cos(a) * M.cruiseMps, vy: 0, vz: Math.sin(a) * M.cruiseMps, phase: rng.next() * 6.283, roll: 0, pitch: 0, rise: 0 };
      f.y = wantY(f.x, f.z, f);
      fish.push(f);
    }
  }
  spawn(o.count, home);

  return {
    id: o.id,
    fish,
    /** The middle of the school now (for finding it, the camera and the sound). */
    centre() {
      let x = 0, y = 0, z = 0;
      for (const f of fish) { x += f.x; y += f.y; z += f.z; }
      const n = Math.max(1, fish.length);
      return { x: x / n, y: y / n, z: z / n };
    },
    /** The tick moved the school's home or deep spot (an edit, or the pool changed). */
    rehome(/** @type {{ x: number, z: number }} */ h, /** @type {{ x: number, z: number }} */ d) { home = { ...h }; deep = { ...d }; },
    /** The school grew or thinned in the tick: fish join near the others, or the last ones go. */
    resize(/** @type {number} */ n) {
      if (n > fish.length) spawn(n - fish.length, fish.length ? this.centre() : home);
      else fish.length = Math.max(0, n);
    },
    /** Day, night or winter rest. @param {'day'|'night'|'winter'} m */
    setMood(m) { mood = m; },
    /** A fast swoop overhead: dart for the deep spot. */
    startle() { dartUntil = t + M.dartS; feedUntil = -1; target = { ...deep }; nextTurn = t + M.dartS; },
    get darting() { return dartUntil > t; },
    /** Crumbs on the water here: the school swirls up to them for a while. @param {{ x: number, z: number }} p */
    feed(p) { food = { ...p }; feedUntil = t + M.feedS; nextTurn = feedUntil; },
    /** Swirling up to food now. */
    get feeding() { return feedUntil > t; },
    /**
     * One fixed step of dt seconds.
     * @param {number} dt
     */
    step(dt) {
      t += dt;
      const darting = dartUntil > t;
      const winter = mood === 'winter';
      // At food, the target circles the crumbs, so the school swirls around them near the surface.
      if (food && feedUntil > t) target = { x: food.x + Math.cos(t * M.swirlHz * 6.283) * M.swirlM, z: food.z + Math.sin(t * M.swirlHz * 6.283) * M.swirlM };
      // A new heading for the whole school now and then: it turns as one.
      if (t >= nextTurn) {
        target = winter ? pick(deep.x, deep.z, 0.4, M.minDepthM) : pick(home.x, home.z, M.leashM, M.minDepthM);
        const [a, b] = mood === 'day' ? M.turnEveryS : M.nightTurnEveryS;
        nextTurn = t + a + (b - a) * rng.next();
      }
      // Now and then one rises to sip at the surface (by day only), and rings it; at food, often.
      if (mood === 'day' && !darting && t >= nextRise && fish.length) {
        fish[rng.int(fish.length)].rise = M.riseS;
        const k = feedUntil > t ? M.feedRiseShare : 1;
        nextRise = t + k * (M.riseEveryS[0] + (M.riseEveryS[1] - M.riseEveryS[0]) * rng.next());
      }
      const cruise = darting ? M.dartMps : winter ? M.restMps : mood === 'night' ? M.nightMps : M.cruiseMps;
      const maxV = cruise * 1.6;
      const sep = M.sepBodies * L, view = M.viewBodies * L;
      const W = M.weights;
      for (let i = 0; i < fish.length; i++) {
        const f = fish[i];
        let ax = 0, ay = 0, az = 0;
        let cx = 0, cz = 0, avx = 0, avz = 0, n = 0;
        for (let j = 0; j < fish.length; j++) {
          if (j === i) continue;
          const g = fish[j];
          const dx = f.x - g.x, dy = f.y - g.y, dz = f.z - g.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > view * view) continue;
          if (d2 < sep * sep && d2 > 1e-10) { const d = Math.sqrt(d2); ax += (dx / d) * (1 - d / sep) * W.separate; ay += (dy / d) * (1 - d / sep) * W.separate; az += (dz / d) * (1 - d / sep) * W.separate; }
          cx += g.x; cz += g.z; avx += g.vx; avz += g.vz; n++;
        }
        if (n) {
          ax += ((cx / n - f.x) / view) * W.cohere; az += ((cz / n - f.z) / view) * W.cohere;
          ax += ((avx / n - f.vx) / Math.max(cruise, 1e-3)) * W.align; az += ((avz / n - f.vz) / Math.max(cruise, 1e-3)) * W.align;
        }
        // Toward the school's target.
        const tx = target.x - f.x, tz = target.z - f.z, td = Math.hypot(tx, tz) || 1;
        ax += (tx / td) * W.seek * Math.min(1, td / 0.3); az += (tz / td) * W.seek * Math.min(1, td / 0.3);
        // Keep off the shallows: look ahead, and turn back toward deeper water if it shoals.
        const sp = Math.hypot(f.vx, f.vz) || 1e-6;
        const ahead = at(f.x + (f.vx / sp) * M.lookM, f.z + (f.vz / sp) * M.lookM);
        if (ahead.depth < M.minDepthM) {
          const hx = deep.x - f.x, hz = deep.z - f.z, hd = Math.hypot(hx, hz) || 1;
          ax += (hx / hd) * W.shore; az += (hz / hd) * W.shore;
        }
        // The depth they want, gently.
        ay += (wantY(f.x, f.z, f) - f.y) * W.depth;
        // Integrate, then keep the speed in its band.
        const ox = f.x, oz = f.z;
        f.vx += ax * dt; f.vy += ay * dt; f.vz += az * dt;
        f.vy *= 0.9;
        // A rising fish swims straight up to sip at the surface.
        if (f.rise > 0) f.vy = Math.max(f.vy, M.riseMps);
        let v = Math.hypot(f.vx, f.vz);
        // Darting, a fish slows as it reaches the deep spot rather than overshooting it.
        const top = darting ? Math.max(M.cruiseMps, Math.min(maxV, td * M.dartEase)) : maxV;
        const minV = Math.min(cruise * 0.35, top);
        if (v > top) { f.vx *= top / v; f.vz *= top / v; v = top; }
        else if (v < minV && v > 1e-9) { f.vx *= minV / v; f.vz *= minV / v; v = minV; }
        f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
        // Never onto dry ground or out of the water.
        const w = at(f.x, f.z);
        if (w.depth < M.minDepthM * 0.5) { f.x = ox; f.z = oz; f.vx = -f.vx * 0.5; f.vz = -f.vz * 0.5; }
        const here = at(f.x, f.z);
        f.y = Math.min(here.surface - M.clearM * 0.4, Math.max(here.bed + M.clearM * 0.5, f.y));
        // Banking into a turn (lateral acceleration), pitching with the climb, eased.
        const lat = v > 1e-6 ? (f.vx * az - f.vz * ax) / v : 0;
        f.roll += (Math.max(-M.maxRoll, Math.min(M.maxRoll, lat * M.rollPerAccel)) - f.roll) * Math.min(1, dt * 6);
        f.pitch += (Math.max(-0.5, Math.min(0.5, Math.atan2(f.vy, Math.max(v, 1e-3)))) - f.pitch) * Math.min(1, dt * 4);
        f.phase += dt * 2 * Math.PI * (M.tailHz[0] + M.tailHz[1] * v);
        // A rising fish rings the water when it touches the surface.
        if (f.rise > 0) {
          f.rise -= dt;
          if (here.surface - f.y < M.clearM * 0.6) { env.ring?.(f.x, f.z); f.rise = 0; }
        }
      }
    },
  };
}

/** @typedef {ReturnType<typeof createSchool>} School */

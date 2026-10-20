// @ts-check
// Dragonflies on patrol (M2 southern hawkers; docs 11, 12, 23): each keeps a beat of a few hold
// points over the water near its group's home. It hovers at one for a moment, bobbing, then darts to
// the next; now and then it rests on a reed tip, wings still and flat. A fast swoop close by or an
// edit beside it sends it veering up and away, back to its beat a little later. At night it roosts
// on the reeds. The wings beat on a phase the pose turns into four wing bones (posePatrol).
//
// Live animation only (never saved): a seeded stream per group and a fixed step rate, so the same
// beat flies the same way on every device. Plain Math is fine here. Numbers from the species
// recipe's motion block (recipes/species/dragonfly.json). Same shape as school.js, so the live
// schools system (schools.js) runs either.

import { stream } from '../../core/rng.js';

/**
 * @typedef {{ x: number, y: number, z: number, vx: number, vy: number, vz: number, phase: number, roll: number, pitch: number,
 *   yaw: number, mode: 'hover'|'dart'|'perch'|'flee', until: number, at: number, beat: { x: number, y: number, z: number }[],
 *   perch: { x: number, y: number, z: number } | null, visiting: { x: number, y: number, z: number } | null, rise: number }} Flyer
 *   visiting: a curious one's look at you (setVisit)
 * @typedef {{ water: (x: number, z: number) => { surface: number, depth: number }, ground: (x: number, z: number) => number,
 *   perches: () => { x: number, z: number, h: number }[] }} PatrolEnv
 */

/**
 * @param {{ id: number, seed: number, count: number, home: { x: number, z: number }, deep: { x: number, z: number },
 *   size: number, M: any, env: PatrolEnv }} o
 */
export function createPatrol(o) {
  const { M, env } = o;
  const rng = stream(o.seed >>> 0, 0xd7a, o.id);
  /** @type {Flyer[]} */ const fish = [];
  let home = { ...o.home }, t = 0, fleeUntil = -1;
  /** @type {'day'|'night'|'winter'} */ let mood = 'day';
  const range = (/** @type {number[]} */ r) => r[0] + (r[1] - r[0]) * rng.next();

  /** The top of the water, or the ground, at a point. @param {number} x @param {number} z */
  const floor = (x, z) => { const w = env.water(x, z); return w.depth > 0.01 ? w.surface : env.ground(x, z); };

  /** A beat of hold points over the water near home (over land if no water is near). */
  function beatFor() {
    /** @type {{ x: number, y: number, z: number }[]} */ const pts = [];
    const n = Math.max(2, Math.round(range(M.beatPoints)));
    const cx = home.x + (rng.next() - 0.5) * M.beatM, cz = home.z + (rng.next() - 0.5) * M.beatM;
    for (let i = 0; i < n * 4 && pts.length < n; i++) {
      const a = rng.next() * Math.PI * 2, d = Math.sqrt(rng.next()) * M.beatM;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (env.water(x, z).depth < 0.05 && i < n * 3) continue;
      pts.push({ x, y: floor(x, z) + range(M.hoverHeightM), z });
    }
    while (pts.length < 2) pts.push({ x: cx, y: floor(cx, cz) + M.hoverHeightM[1], z: cz });
    return pts;
  }

  /** A reed tip near home to rest on, or null. */
  function perchNear() {
    const list = env.perches().filter((p) => (p.x - home.x) ** 2 + (p.z - home.z) ** 2 <= M.perchReachM * M.perchReachM);
    if (!list.length) return null;
    const p = list[rng.int(list.length)];
    const a = rng.next() * Math.PI * 2, r = rng.next() * 0.15;
    const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
    return { x, y: env.ground(x, z) + p.h * range(M.perchShare), z };
  }

  function spawn(/** @type {number} */ n) {
    for (let i = 0; i < n; i++) {
      const beat = beatFor();
      const b = beat[0];
      fish.push({ x: b.x, y: b.y, z: b.z, vx: 0, vy: 0, vz: 0, phase: rng.next() * 6.283, roll: 0, pitch: 0, yaw: rng.next() * 6.283,
        mode: 'hover', until: range(M.hoverS), at: 0, beat, perch: null, visiting: null, rise: 0 });
    }
  }
  spawn(o.count);

  /** Where you are looking, for a curious one to come and look back (doc 23), or null. @type {{ x: number, y: number, z: number } | null} */
  let visit = null;

  /** Next thing to do, after a hover, a dart, a rest or a flight. @param {Flyer} f */
  function next(f) {
    f.visiting = null;
    if (visit && mood === 'day' && rng.next() < M.visitChance) {
      f.perch = null; f.visiting = { ...visit }; f.mode = 'dart'; f.until = t + 6;
      return;
    }
    if (mood !== 'day' || (f.mode !== 'perch' && rng.next() < M.perchChance)) {
      const p = perchNear();
      if (p) { f.perch = p; f.mode = 'dart'; f.until = t + 6; return; }
    }
    f.perch = null;
    f.at = (f.at + 1 + rng.int(Math.max(1, f.beat.length - 1))) % f.beat.length;
    f.mode = 'dart';
    f.until = t + 6;
  }

  return {
    id: o.id,
    fish,
    centre() {
      let x = 0, y = 0, z = 0;
      for (const f of fish) { x += f.x; y += f.y; z += f.z; }
      const n = Math.max(1, fish.length);
      return { x: x / n, y: y / n, z: z / n };
    },
    rehome(/** @type {{ x: number, z: number }} */ h) {
      if ((h.x - home.x) ** 2 + (h.z - home.z) ** 2 < 1) return;
      home = { ...h };
      for (const f of fish) f.beat = beatFor();
    },
    resize(/** @type {number} */ n) { if (n > fish.length) spawn(n - fish.length); else fish.length = Math.max(0, n); },
    setMood(/** @type {'day'|'night'|'winter'} */ m) { mood = m; },
    startle() {
      fleeUntil = t + M.fleeS;
      for (const f of fish) {
        if (f.mode === 'perch' && mood !== 'day') continue;
        const a = rng.next() * Math.PI * 2;
        f.mode = 'flee'; f.perch = null; f.until = t + M.fleeS;
        f.vx += Math.cos(a) * M.dartMps; f.vz += Math.sin(a) * M.dartMps; f.vy += M.dartMps * 0.6;
      }
    },
    get darting() { return fleeUntil > t; },
    /**
     * A curious one now and then comes to hover near where you look (null: none do).
     * @param {{ x: number, y: number, z: number } | null} p
     */
    setVisit(p) { visit = p; },
    /** Dragonflies take no food from you. */
    feed() {},
    get feeding() { return false; },
    /** @param {number} dt */
    step(dt) {
      t += dt;
      for (const f of fish) {
        let target = f.perch ?? f.visiting ?? f.beat[f.at];
        if (f.mode === 'flee') {
          // Up and away, then back to the beat.
          if (t >= f.until) { f.mode = 'dart'; f.until = t + 6; }
          target = { x: f.x + f.vx, y: floor(f.x, f.z) + M.fleeHeightM, z: f.z + f.vz };
        }
        const dx = target.x - f.x, dy = target.y - f.y, dz = target.z - f.z;
        const d = Math.hypot(dx, dy, dz);
        let ax = 0, ay = 0, az = 0;
        if (f.mode === 'perch') {
          f.vx = f.vy = f.vz = 0;
          f.x = target.x; f.y = target.y; f.z = target.z;
          if (mood === 'day' && t >= f.until) next(f);
        } else if (f.mode === 'hover') {
          // Holding the point, bobbing a little.
          const bob = Math.sin(t * M.bobHz * 6.283 + f.phase * 0.1) * M.bobM;
          ax = dx * 12 - f.vx * 6; ay = (dy + bob) * 12 - f.vy * 6; az = dz * 12 - f.vz * 6;
          // Turning slowly to look around.
          f.yaw += Math.sin(t * 0.7 + f.phase) * dt * 0.8;
          if (t >= f.until) next(f);
        } else {
          // A dart: fast, eased in and out, straight to the point.
          const want = Math.min(M.dartMps, d * M.dartEase);
          const vx = d > 1e-6 ? (dx / d) * want : 0, vy = d > 1e-6 ? (dy / d) * want : 0, vz = d > 1e-6 ? (dz / d) * want : 0;
          ax = (vx - f.vx) * M.agility; ay = (vy - f.vy) * M.agility; az = (vz - f.vz) * M.agility;
          if (f.mode === 'dart' && (d < 0.04 || t >= f.until)) {
            if (f.perch) { f.mode = 'perch'; f.until = t + range(M.perchS); }
            else { f.mode = 'hover'; f.until = t + range(M.hoverS); }
          }
        }
        f.vx += ax * dt; f.vy += ay * dt; f.vz += az * dt;
        f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
        // Never into the water or the ground.
        const lo = floor(f.x, f.z) + M.clearM;
        if (f.y < lo && f.mode !== 'perch') { f.y = lo; if (f.vy < 0) f.vy = 0; }
        const v = Math.hypot(f.vx, f.vz);
        if (v > 0.3 && f.mode !== 'perch') f.yaw = Math.atan2(f.vx, f.vz);
        const lat = v > 1e-6 ? (f.vx * az - f.vz * ax) / v : 0;
        f.roll += (Math.max(-M.maxRoll, Math.min(M.maxRoll, lat * M.rollPerAccel)) - f.roll) * Math.min(1, dt * 8);
        f.pitch += ((f.mode === 'perch' ? 0 : Math.max(-0.6, Math.min(0.6, Math.atan2(f.vy, Math.max(v, 0.3))))) - f.pitch) * Math.min(1, dt * 6);
        f.phase += f.mode === 'perch' ? 0 : dt * 2 * Math.PI * (f.mode === 'hover' ? M.wingHz[0] : M.wingHz[1]);
      }
    },
  };
}

/**
 * The wings' bone moves for one flyer: fore and hind pairs beat out of step, flat and still on a
 * perch. @param {{ name: string, parent: number }[]} rig @param {Flyer} f @param {any} M
 * @param {number[]} q the root's turn (bank and pitch)
 * @param {(a: number[], angle: number) => number[]} axisAngle
 */
export function posePatrol(rig, f, M, q, axisAngle) {
  const resting = f.mode === 'perch';
  const beat = resting ? 0 : M.wingSwing;
  return rig.map((b) => {
    if (b.parent < 0) return { q };
    const left = b.name.endsWith('l') ? 1 : -1;
    const hind = b.name.startsWith('wing.h');
    const s = Math.sin(f.phase + (hind ? M.hindLag : 0));
    // About the body's long axis (+z): up and down.
    return { q: axisAngle([0, 0, 1], left * (beat * s + (resting ? -M.restDroop : 0))) };
  });
}

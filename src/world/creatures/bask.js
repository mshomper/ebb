// @ts-check
// Turtles basking (M2 European pond turtles; docs 12, 23): by day each one paddles to a basking
// spot near its group's home (a stone, a log or the raft: the seats the pieces publish in the store,
// src/world/creatures/spring-live.js), climbs out and rests there in the sun, head up, now and then
// turning it. When spots are few they stack, one on another's back. At night and in winter they sit
// low in the water. A fast swoop close by or an edit beside them sends every one sliding into the
// water, to stay under a while. Its head turns on its own bone (poseBask).
//
// Live animation only (never saved): a seeded stream per group and a fixed step rate, as patrol.js.
// Plain Math is fine here. Numbers from turtle.json's motion block. Same shape as school.js and
// patrol.js, so the live schools system (schools.js) runs it.

import { stream } from '../../core/rng.js';

/**
 * @typedef {{ x: number, y: number, z: number, r: number, kind?: string, room?: number, yaw?: number, inWater?: boolean }} Seat
 *   a basking spot: its top's middle (y), how far across it is (r), how many turtles it holds (room),
 *   and for a log or the raft the way its length runs (yaw)
 * @typedef {{ x: number, y: number, z: number, vx: number, vy: number, vz: number, roll: number, pitch: number, yaw: number,
 *   look: number, lookTo: number, nextLook: number, mode: 'swim'|'climb'|'bask'|'slide', until: number,
 *   goal: { x: number, z: number }, seat: number, from: { x: number, y: number, z: number } | null, under: number }} Turtle
 *   seat: the spot it is bound for or on (-1 none); from: where a climb or slide began; under: until when it stays under
 * @typedef {{ water: (x: number, z: number) => { surface: number, depth: number }, ground: (x: number, z: number) => number,
 *   seats: () => Seat[] }} BaskEnv
 */

/**
 * @param {{ id: number, seed: number, count: number, home: { x: number, z: number }, deep: { x: number, z: number },
 *   size: number, M: any, env: BaskEnv }} o
 */
export function createBask(o) {
  const { M, env } = o;
  const rng = stream(o.seed >>> 0, 0xba5c, o.id);
  /** @type {Turtle[]} */ const fish = [];
  let home = { ...o.home }, t = 0, fleeUntil = -1;
  /** @type {'day'|'night'|'winter'} */ let mood = 'day';
  const range = (/** @type {number[]} */ r) => r[0] + (r[1] - r[0]) * rng.next();
  // The shell's height, drawn: how far one turtle sits above the one it stacks on.
  const shellH = 0.045 * o.size;

  /** A point in water near home, at least minDepthM deep (home if none turns up). */
  function wanderPoint() {
    for (let i = 0; i < 12; i++) {
      const a = rng.next() * Math.PI * 2, d = Math.sqrt(rng.next()) * M.leashM;
      const x = home.x + Math.cos(a) * d, z = home.z + Math.sin(a) * d;
      if (env.water(x, z).depth >= M.minDepthM) return { x, z };
    }
    return { ...home };
  }

  /**
   * The places to bask near home, nearest spot first: each spot holds `room` turtles (a stone's top
   * one or two, the second on the first's back; a log or the raft a few side by side). Turtles past
   * the places there are stay in the water.
   * @returns {{ s: Seat, k: number }[]}
   */
  function placesNear() {
    const r2 = M.baskReachM * M.baskReachM;
    return env.seats().filter((s) => (s.x - home.x) ** 2 + (s.z - home.z) ** 2 <= r2)
      .sort((a, b) => ((a.x - home.x) ** 2 + (a.z - home.z) ** 2) - ((b.x - home.x) ** 2 + (b.z - home.z) ** 2))
      .flatMap((s) => Array.from({ length: Math.max(1, s.room ?? 1) }, (_, k) => ({ s, k })));
  }

  /**
   * Where a turtle rests in place k on a spot: on a stone the second climbs onto the first's back; on
   * a log or the raft they lie side by side. @param {Seat} s @param {number} k
   */
  function restOn(s, k) {
    if (s.kind === 'log' || s.kind === 'raft') {
      const a = s.yaw ?? 0, off = (k - ((s.room ?? 1) - 1) / 2) * M.sideM;
      return { x: s.x + Math.sin(a) * off, y: s.y, z: s.z + Math.cos(a) * off };
    }
    const a = (o.id * 1.7) % (Math.PI * 2), off = Math.min(s.r * 0.4, k * M.stackM);
    return { x: s.x + Math.cos(a) * off, y: s.y + k * shellH * 0.7, z: s.z + Math.sin(a) * off };
  }

  function spawn(/** @type {number} */ n) {
    for (let i = 0; i < n; i++) {
      const p = wanderPoint();
      const w = env.water(p.x, p.z);
      fish.push({ x: p.x, y: w.surface - 0.01 * o.size, z: p.z, vx: 0, vy: 0, vz: 0, roll: 0, pitch: 0, yaw: rng.next() * 6.283,
        look: 0, lookTo: 0, nextLook: range(M.lookEveryS), mode: 'swim', until: range(M.turnEveryS), goal: wanderPoint(), seat: -1, from: null, under: 0 });
    }
  }
  spawn(o.count);

  /** Send every turtle on a seat back into the water. */
  function slideAll() {
    for (const f of fish) {
      if (f.mode !== 'bask' && f.mode !== 'climb') continue;
      f.mode = 'slide'; f.from = { x: f.x, y: f.y, z: f.z }; f.until = t + M.climbS * 0.5;
      f.goal = wanderPoint(); f.seat = -1;
    }
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
      for (const f of fish) if (f.mode === 'swim') f.goal = wanderPoint();
    },
    resize(/** @type {number} */ n) { if (n > fish.length) spawn(n - fish.length); else fish.length = Math.max(0, n); },
    setMood(/** @type {'day'|'night'|'winter'} */ m) {
      if (m !== 'day' && mood === 'day') slideAll();
      mood = m;
    },
    startle() {
      fleeUntil = t + M.fleeS;
      slideAll();
      for (const f of fish) f.under = t + M.fleeS;
    },
    get darting() { return fleeUntil > t; },
    setVisit() {},
    /** Turtles take no food from you (yet: lily leaves, doc 12). */
    feed() {},
    get feeding() { return false; },
    /** @param {number} dt */
    step(dt) {
      t += dt;
      // Who rests where: by day, out of the water, the places near home are shared out in turn.
      const places = mood === 'day' && t >= fleeUntil ? placesNear() : [];
      fish.forEach((f, i) => {
        const w = env.water(f.x, f.z);
        // The head looks about now and then.
        if (t >= f.nextLook) { f.lookTo = (rng.next() * 2 - 1) * M.headTurnRad; f.nextLook = t + range(M.lookEveryS); }
        f.look += (f.lookTo - f.look) * Math.min(1, dt * 1.5);
        if (f.mode === 'bask' || f.mode === 'climb') {
          const p = places[f.seat];
          if (!p) { slideAll(); return; }
          const at = restOn(p.s, p.k);
          if (f.mode === 'climb') {
            const k = Math.min(1, 1 - (f.until - t) / M.climbS);
            const e = k * k * (3 - 2 * k);
            const from = f.from ?? at;
            f.x = from.x + (at.x - from.x) * e; f.z = from.z + (at.z - from.z) * e;
            f.y = from.y + (at.y - from.y) * e + Math.sin(e * Math.PI) * 0.02 * o.size;
            f.pitch = -0.35 * Math.sin(e * Math.PI);
            if (k >= 1) f.mode = 'bask';
          } else { f.x = at.x; f.y = at.y; f.z = at.z; f.pitch *= 0.9; }
          return;
        }
        if (f.mode === 'slide') {
          const k = Math.min(1, 1 - (f.until - t) / (M.climbS * 0.5));
          const from = f.from ?? f;
          const to = { x: from.x + Math.sin(f.yaw) * 0.25, z: from.z + Math.cos(f.yaw) * 0.25 };
          f.x = from.x + (to.x - from.x) * k; f.z = from.z + (to.z - from.z) * k;
          const wy = env.water(f.x, f.z).surface - 0.02 * o.size;
          f.y = from.y + (wy - from.y) * k;
          f.pitch = 0.4 * Math.sin(k * Math.PI);
          if (k >= 1) { f.mode = 'swim'; f.until = t + range(M.turnEveryS); }
          return;
        }
        // Swimming: to its place by day (if there is one for it), else about home, slowly, the head
        // just above the water.
        const seatI = i < places.length && t >= f.under ? i : -1;
        const target = seatI >= 0 ? places[seatI].s : f.goal;
        if (seatI < 0 && t >= f.until) { f.goal = wanderPoint(); f.until = t + range(M.turnEveryS); }
        const dx = target.x - f.x, dz = target.z - f.z, d = Math.hypot(dx, dz);
        if (seatI >= 0 && d <= Math.max(0.25, places[seatI].s.r + 0.15)) {
          f.mode = 'climb'; f.seat = seatI; f.from = { x: f.x, y: f.y, z: f.z }; f.until = t + M.climbS;
          return;
        }
        const want = d > 0.05 ? M.paddleMps : 0;
        const vx = d > 1e-6 ? (dx / d) * want : 0, vz = d > 1e-6 ? (dz / d) * want : 0;
        f.vx += (vx - f.vx) * Math.min(1, dt * 1.2); f.vz += (vz - f.vz) * Math.min(1, dt * 1.2);
        let nx = f.x + f.vx * dt, nz = f.z + f.vz * dt;
        // A turtle swims; it walks out only onto a seat.
        if (env.water(nx, nz).depth < 0.04 && seatI < 0) { nx = f.x; nz = f.z; f.goal = wanderPoint(); }
        f.x = nx; f.z = nz;
        const wy = (w.depth > 0.02 ? w.surface : env.ground(f.x, f.z)) - (mood === 'day' ? 0.012 : 0.022) * o.size;
        f.y += (wy - f.y) * Math.min(1, dt * 2);
        const v = Math.hypot(f.vx, f.vz);
        if (v > 0.01) {
          const yaw = Math.atan2(f.vx, f.vz);
          let dy = yaw - f.yaw;
          while (dy > Math.PI) dy -= 2 * Math.PI;
          while (dy < -Math.PI) dy += 2 * Math.PI;
          f.yaw += dy * Math.min(1, dt * 1.5);
        }
        f.pitch *= 0.9; f.roll *= 0.9;
      });
    },
  };
}

/**
 * The head's bone move for one turtle: turned about, as it looks round, and raised while basking.
 * @param {{ name: string, parent: number }[]} rig @param {Turtle} f @param {any} M
 * @param {number[]} q the root's turn (pitch and roll)
 * @param {(a: number[], angle: number) => number[]} axisAngle
 */
export function poseBask(rig, f, M, q, axisAngle) {
  void M;
  return rig.map((b) => {
    if (b.parent < 0) return { q };
    const up = f.mode === 'bask' ? -0.25 : 0;
    return { q: qmul(axisAngle([0, 1, 0], f.look), axisAngle([1, 0, 0], up)) };
  });
}

/** Quaternion product p * q (q first, then p), as schools.js's. @param {number[]} p @param {number[]} q */
function qmul(p, q) {
  return [
    p[3] * q[0] + p[0] * q[3] + p[1] * q[2] - p[2] * q[1],
    p[3] * q[1] - p[0] * q[2] + p[1] * q[3] + p[2] * q[0],
    p[3] * q[2] + p[0] * q[1] - p[1] * q[0] + p[2] * q[3],
    p[3] * q[3] - p[0] * q[0] - p[1] * q[1] - p[2] * q[2],
  ];
}

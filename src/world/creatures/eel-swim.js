// @ts-check
// Eels in their pond, alive (B3 wave 2; recipes/species/eel.json motion, kind eel). Each eel goes
// its own way (they do not school): by night it hunts low along the bed, nosing from one spot to
// the next within leashM of home; by day (and in the cold) it lies on the bed under the weed with
// only a slow ripple down its tail, now and then shifting a little. A walker coming fast close by
// sends it flicking down to the deep spot. When eels come (the hourly tick's arrival, or a test
// link), cross() lets them come up out of the sea on the land side nearest the pond and cross the
// wet grass to it, one after another, their bodies following their heads' track.
//
// It keeps the same shape as a school (school.js) so the live schools module draws it: fish, centre,
// rehome, resize, setMood, startle, darting, feed, feeding, step. Each eel carries its wave's phase
// and size for poseEel (eel.js). Live animation only (never saved): a seeded stream per group and a
// fixed step rate, so the same pond moves the same way on every device. Plain Math is fine here.

import { stream } from '../../core/rng.js';
import { HABITAT_ORIGIN } from '../growth/habitat.js';

/**
 * @typedef {{ x: number, y: number, z: number, vx: number, vy: number, vz: number, yaw: number,
 *   pitch: number, roll: number, phase: number, rise: number, wave: number, amp: number, even: number,
 *   mode: 'swim'|'rest'|'cross'|'wait'|'gone', goal: { x: number, z: number }, next: number,
 *   path?: { x: number, z: number }[], waitS?: number, shore?: boolean }} Eel
 *   shore: a visitor's path (it follows the whole path, in and out of the water, then is gone)
 * @typedef {{ water: (x: number, z: number) => { surface: number, depth: number }, ground?: (x: number, z: number) => number,
 *   ring?: (x: number, z: number) => void }} EelEnv
 */

/**
 * @param {{ id: number, seed: number, count: number, home: { x: number, z: number }, deep: { x: number, z: number },
 *   size: number, M: any, env: EelEnv }} o  size: drawn size (display scale); M: recipe motion
 */
export function createEelSwim(o) {
  const { M, env } = o;
  const rng = stream(o.seed >>> 0, 0xee1, o.id);
  /** @type {Eel[]} */ const fish = [];
  let home = { ...o.home }, deep = { ...o.deep }, t = 0, dartUntil = -1;
  /** @type {'day'|'night'|'winter'} */ let mood = 'day';
  /** Lying height above the bed or ground: half the body's thickness, drawn. */
  const lie = M.radiusM * o.size;

  /** Water at a point, with the bed. @param {number} x @param {number} z */
  const at = (x, z) => { const w = env.water(x, z); return { surface: w.surface, depth: w.depth, bed: w.surface - w.depth }; };

  /** A point in water at least `min` deep within `r` of (cx, cz), from the stream; else (cx, cz). */
  function pick(/** @type {number} */ cx, /** @type {number} */ cz, /** @type {number} */ r, /** @type {number} */ min) {
    for (let i = 0; i < 12; i++) {
      const a = rng.next() * Math.PI * 2, d = Math.sqrt(rng.next()) * r;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (at(x, z).depth >= min) return { x, z };
    }
    return { x: cx, z: cz };
  }

  /** A new eel near a point, lying on the bed. @param {{ x: number, z: number }} c @returns {Eel} */
  function make(c) {
    const p = pick(c.x, c.z, M.leashM * 0.5, M.minDepthM);
    const yaw = rng.next() * Math.PI * 2, w = at(p.x, p.z);
    return { x: p.x, y: w.bed + lie, z: p.z, vx: 0, vy: 0, vz: 0, yaw, pitch: 0, roll: 0, phase: 0, rise: 0,
      wave: rng.next() * 6.283, amp: M.restAmpM, even: 0, mode: 'rest', goal: p, next: t + rng.next() * 4 };
  }
  for (let i = 0; i < o.count; i++) fish.push(make(home));

  /** Where the eel wants to go next, for its mood. @param {Eel} e */
  function nextGoal(e) {
    const [a, b] = mood === 'night' ? M.huntEveryS : M.restEveryS;
    e.next = t + a + (b - a) * rng.next();
    e.goal = mood === 'night' ? pick(home.x, home.z, M.leashM, M.minDepthM) : pick(deep.x, deep.z, M.restM, M.minDepthM);
  }

  /** Steer an eel toward a point at speed v (it turns at most turnRad a second). @param {Eel} e */
  function steer(/** @type {Eel} */ e, /** @type {number} */ gx, /** @type {number} */ gz, /** @type {number} */ v, /** @type {number} */ dt) {
    const want = Math.atan2(gx - e.x, gz - e.z);
    let d = want - e.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    e.yaw += Math.max(-M.turnRad * dt, Math.min(M.turnRad * dt, d));
    // Slower through a tight turn.
    const sp = v * (0.4 + 0.6 * Math.max(0, Math.cos(d)));
    e.vx = Math.sin(e.yaw) * sp; e.vz = Math.cos(e.yaw) * sp;
  }

  return {
    id: o.id,
    fish,
    /** The middle of the group now (for finding it and the camera). */
    centre() {
      let x = 0, y = 0, z = 0, n = 0;
      for (const f of fish) { if (f.mode === 'wait') continue; x += f.x; y += f.y; z += f.z; n++; }
      return n ? { x: x / n, y: y / n, z: z / n } : { x: home.x, y: at(home.x, home.z).bed, z: home.z };
    },
    /** The tick moved the group's home or deep spot. */
    rehome(/** @type {{ x: number, z: number }} */ h, /** @type {{ x: number, z: number }} */ d) { home = { ...h }; deep = { ...d }; },
    /** More came, or some went. @param {number} n */
    resize(n) {
      while (fish.length < n) fish.push(make(home));
      if (fish.length > n) fish.length = Math.max(0, n);
    },
    /** Day, night or winter rest. @param {'day'|'night'|'winter'} m */
    setMood(m) { if (m !== mood) { mood = m; for (const f of fish) f.next = t; } },
    /** A walker close and fast: flick down to the deep spot. */
    startle() { dartUntil = t + M.dartS; for (const f of fish) if (f.mode !== 'cross' && f.mode !== 'wait') { f.mode = 'swim'; f.goal = pick(deep.x, deep.z, 0.3, M.minDepthM); f.next = dartUntil; } },
    get darting() { return dartUntil > t; },
    /** Eels take no food you offer (they hunt for themselves at night). */
    feed() {},
    get feeding() { return false; },
    /**
     * The last `n` eels come up out of the sea at `from` and cross the ground to the pond, one after
     * another (crossGapS apart), along a gently wandering line to the water nearest them.
     * @param {number} n @param {{ x: number, z: number }} from
     */
    cross(n, from) {
      const list = fish.slice(Math.max(0, fish.length - n));
      list.forEach((e, i) => {
        const end = pick(home.x, home.z, M.leashM * 0.4, M.minDepthM);
        const steps = Math.max(2, Math.ceil(Math.hypot(end.x - from.x, end.z - from.z) / M.crossStepM));
        const side = (rng.next() * 2 - 1) * M.crossWanderM;
        const nx = -(end.z - from.z), nz = end.x - from.x, nl = Math.hypot(nx, nz) || 1;
        /** @type {{ x: number, z: number }[]} */ const path = [];
        for (let k = 1; k <= steps; k++) {
          const s = k / steps, bow = Math.sin(s * Math.PI) * side + (rng.next() * 2 - 1) * M.crossWanderM * 0.25;
          path.push({ x: from.x + (end.x - from.x) * s + (nx / nl) * bow, z: from.z + (end.z - from.z) * s + (nz / nl) * bow });
        }
        Object.assign(e, { mode: 'wait', waitS: i * M.crossGapS, path, x: from.x, z: from.z, yaw: Math.atan2(path[0].x - from.x, path[0].z - from.z),
          y: (env.ground?.(from.x, from.z) ?? at(from.x, from.z).bed) + lie });
      });
    },
    /**
     * A visitor (B3 visits; ecology.visit.show kind shore-nose): the first eel comes in from the sea
     * at `sea`, noses up the wet shore past `land` by noseM, turns, and slips back out to sea, then
     * is gone. Call again for another look. @param {{ x: number, z: number }} land @param {{ x: number, z: number }} sea
     */
    visit(land, sea) {
      const e = fish[0];
      if (!e) return;
      const dx = land.x - sea.x, dz = land.z - sea.z, d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d;
      const up = { x: land.x + ux * M.noseM, z: land.z + uz * M.noseM };
      const side = (rng.next() * 2 - 1) * M.noseM;
      const path = [{ x: land.x - uz * side * 0.3, z: land.z + ux * side * 0.3 }, up, { x: up.x - uz * side, z: up.z + ux * side },
        { x: sea.x - uz * side, z: sea.z + ux * side }, { x: sea.x - ux * d, z: sea.z - uz * d }];
      Object.assign(e, { mode: 'cross', shore: true, path, x: sea.x, z: sea.z, yaw: Math.atan2(ux, uz), y: at(sea.x, sea.z).bed + lie });
    },
    /** Is the visitor done (gone back to sea)? */
    get gone() { return fish.every((f) => f.mode === 'gone'); },
    /** One fixed step of dt seconds. @param {number} dt */
    step(dt) {
      t += dt;
      const darting = dartUntil > t;
      for (const e of fish) {
        let v = 0;
        let even = 0, amp = M.restAmpM, slip = 1, idle = M.restWaveHz;
        if (e.mode === 'gone') continue;
        if (e.mode === 'wait') {
          if ((e.waitS = (e.waitS ?? 0) - dt) <= 0) e.mode = 'cross';
          continue;
        }
        if (e.mode === 'cross') {
          // Over the grass: the body follows the head's track, the wave fixed on the ground.
          const p = /** @type {{ x: number, z: number }[]} */ (e.path)[0];
          v = M.crossMps;
          steer(e, p.x, p.z, v, dt);
          even = 1; amp = M.crossAmpM; slip = 1; idle = 0;
          if (Math.hypot(p.x - e.x, p.z - e.z) < M.crossStepM * 0.6) e.path?.shift();
          const w = at(e.x, e.z);
          if (e.shore) { if (!e.path?.length) e.mode = 'gone'; }
          // In at the pond: the path's last step in deep enough water (the sea at the start, at high tide, is not the pond).
          else if (!e.path?.length || (w.depth >= M.minDepthM && e.path.length <= 1)) { e.mode = 'swim'; delete e.path; nextGoal(e); }
        } else {
          if (t >= e.next) { nextGoal(e); e.mode = 'swim'; }
          const d = Math.hypot(e.goal.x - e.x, e.goal.z - e.z);
          if (e.mode === 'swim') {
            v = darting ? M.dartMps : mood === 'night' ? M.huntMps : M.shiftMps;
            v *= Math.min(1, d / 0.25 + 0.2);
            steer(e, e.goal.x, e.goal.z, v, dt);
            even = 0; amp = darting ? M.dartAmpM : M.swimAmpM; slip = M.slip; idle = M.restWaveHz;
            // Arrived: by day it settles on the bed; by night it noses about, then moves on.
            if (d < 0.12) e.mode = mood === 'night' && !darting ? 'swim' : 'rest';
            if (d < 0.12 && mood === 'night') e.next = Math.min(e.next, t + 1 + rng.next() * 2);
          } else { e.vx *= 0.9; e.vz *= 0.9; }
        }
        // Move, never onto dry ground unless crossing.
        const ox = e.x, oz = e.z;
        e.x += e.vx * dt; e.z += e.vz * dt;
        const w = at(e.x, e.z);
        if (e.mode !== 'cross' && w.depth < M.minDepthM * 0.5) { e.x = ox; e.z = oz; e.yaw += Math.PI * 0.5; e.next = t; }
        // Low over the bed in the water, on the ground crossing (eased).
        const here = at(e.x, e.z);
        const wantY = e.mode === 'cross' && here.depth < M.minDepthM ? (env.ground?.(e.x, e.z) ?? here.bed) + lie
          : Math.min(here.surface - lie, here.bed + lie + (mood === 'night' && e.mode === 'swim' ? M.huntLiftM : 0));
        const oy = e.y;
        e.y += (wantY - e.y) * Math.min(1, dt * 5);
        const sp = Math.hypot(e.vx, e.vz);
        e.pitch += (Math.max(-0.4, Math.min(0.4, Math.atan2(e.y - oy, Math.max(sp * dt, 1e-4)))) - e.pitch) * Math.min(1, dt * 3);
        // The wave: as far as the body went (over k), plus the slip in the water and a slow ripple at rest.
        const k = (Math.PI * 2 * M.waves) / (M.lengthM * o.size);
        e.wave += dt * (k * sp / slip + Math.PI * 2 * idle);
        const ease = Math.min(1, dt * 2);
        e.amp += (amp - e.amp) * ease;
        e.even += (even - e.even) * ease;
        e.phase = e.wave;
      }
    },
  };
}

/** @typedef {ReturnType<typeof createEelSwim>} EelSwim */

/**
 * Where eels come up out of the sea for a pond at (x, z): the land square on the waterline nearest
 * it (land beside the sea), its middle in world meters; null on an island with no sea. Pure.
 * @param {any} hab the habitat grid @param {number} x @param {number} z
 * @returns {{ x: number, z: number } | null}
 */
export function shoreNear(hab, x, z) {
  if (!hab) return null;
  const n = hab.n;
  const sea = (/** @type {number} */ k) => k >= 0 && k < n * n && hab.sea[k];
  let best = -1, bestD = Infinity;
  for (let k = 0; k < n * n; k++) {
    if (!hab.open[k] || hab.sea[k] || hab.depthCm[k] > 0) continue;
    const i = k % n;
    if (!((i > 0 && sea(k - 1)) || (i < n - 1 && sea(k + 1)) || sea(k - n) || sea(k + n))) continue;
    const cx = HABITAT_ORIGIN + (k % n) + 0.5, cz = HABITAT_ORIGIN + Math.floor(k / n) + 0.5;
    const d = (cx - x) ** 2 + (cz - z) ** 2;
    if (d < bestD) { bestD = d; best = k; }
  }
  return best < 0 ? null : { x: HABITAT_ORIGIN + (best % n) + 0.5, z: HABITAT_ORIGIN + Math.floor(best / n) + 0.5 };
}

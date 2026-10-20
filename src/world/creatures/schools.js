// @ts-check
// Live schools and swarms (M2; docs 11, 12, 23): the groups the hourly tick keeps
// (src/world/creatures/swarms.js), alive. One of these runs per species whose recipe has
// ecology.kind 'swarm' and a body: its seeded body variants are baked in the background (bodies.js),
// each group becomes a school (school.js; dragonflies' patrol joins in M2 piece F), stepped at a
// fixed rate of real time, posed by its bones and drawn by its own creatures pass, with no contact
// shadow. A fast swoop of the camera close by startles a school; watching one closely, or tapping
// it, finds it for the journal (`creature:found`). Nothing here changes the world.

import { emitDeferred } from '../../core/events.js';
import { get as getStore, update as updateStore } from '../../core/store.js';
import { display, animT, seasonOf, hourIndex, SECONDS_PER_HOUR, HOURS_PER_DAY } from '../../core/clock.js';
import { createWatching } from './watching.js';
import { addSwarmEvent } from './swarms.js';
import { hash32 } from '../../core/rng.js';
import { run } from '../../core/workers.js';
import { createCreaturePass } from '../../render/passes/creatures.js';
import { MAX_BONES } from './bodies.js';
import { poseSkeleton } from './pose.js';
import { createReturn } from './reveal-return.js';
import { createSchool } from './school.js';
import { createPatrol, posePatrol } from './patrol.js';
import { cellCenter } from '../ecology/habitat.js';
import { keyOf } from '../species.js';

const BAKE_JOB = { module: './world/creatures/bodies.js', fn: 'bakeVariant' };

/** A unit quaternion turning `angle` radians about a unit axis. @param {number[]} a @param {number} angle */
export function axisAngle(a, angle) {
  const s = Math.sin(angle / 2);
  return [a[0] * s, a[1] * s, a[2] * s, Math.cos(angle / 2)];
}

/** Quaternion product p * q (q first, then p). @param {number[]} p @param {number[]} q */
export function qmul(p, q) {
  return [
    p[3] * q[0] + p[0] * q[3] + p[1] * q[2] - p[2] * q[1],
    p[3] * q[1] - p[0] * q[2] + p[1] * q[3] + p[2] * q[0],
    p[3] * q[2] + p[0] * q[1] - p[1] * q[0] + p[2] * q[3],
    p[3] * q[3] - p[0] * q[0] - p[1] * q[1] - p[2] * q[2],
  ];
}

/**
 * @param {{ world: { state: any, env: any }, recipe: any,
 *   water: { sim: { live: any }, sampleLive: (x: number, z: number) => { surface: number, depth: number } },
 *   ripples: { addImpulse: (x: number, z: number, strength?: number, radiusM?: number) => void } | null,
 *   camera: { target: ArrayLike<number>, eye: ArrayLike<number>, distance: number },
 *   presence?: import('./presence.js').Presence, budget?: number, ground?: (x: number, z: number) => number }} opts
 *   recipe: recipes/species/<id>.json (minnow: motion.kind school; dragonfly: patrol); budget: the
 *   most drawn at once (the quality tier); ground: terrain height
 */
export function createSchools(opts) {
  const { world, recipe, water, ripples, camera } = opts;
  const key = keyOf(recipe);
  const body = recipe.body, M = recipe.motion, P = recipe.presence, find = recipe.find;
  const variants = Math.max(1, body.variants ?? 1);
  const lods = recipe.bake.lods ?? [{ cellM: recipe.bake.cellM }];
  const pass = createCreaturePass({ recipe, name: key });
  let budget = Math.min(128, opts.budget ?? 128);
  /** Each variant's skeleton, once its first bake is back. @type {({ name: string, parent: number, pivot: number[] }[] | null)[]} */
  const rigs = Array.from({ length: variants }, () => null);
  for (let lod = lods.length - 1; lod >= 0; lod--) {
    for (let v = 0; v < variants; v++) {
      run(BAKE_JOB, { id: recipe.id, body, variant: v, cellM: lods[lod].cellM }, { lane: 'background' })
        .then((r) => { if (!rigs[v]) rigs[v] = r.bones; pass.setMesh(`${v}:${lod}`, r); })
        .catch((err) => { if (err?.name !== 'Disposed') console.warn(`${key} bake failed`, err); });
    }
  }

  /** The live schools by group id. @type {Map<number, import('./school.js').School>} */
  const schools = new Map();
  /** @type {any} */ let shown = null;
  let acc = 0, watched = 0;
  const watching = P.watch ? createWatching(P.watch) : null;
  /** Crumbs a school is swimming up to, by school id. @type {{ id: number, x: number, z: number }[]} */
  let foods = [];
  const stepS = 1 / (M.stepHz ?? 30);
  /** Seconds of real time these schools have run, the clock their rises are stamped with. */
  let clockS = 0;
  /** Rises to the surface, newest last, for the sound (as the frogs' plops). @type {{ n: number, t: number, x: number, y: number, z: number }[]} */
  const rises = [];
  let riseCount = 0;
  const env = {
    water: (/** @type {number} */ x, /** @type {number} */ z) => water.sampleLive(x, z),
    ground: (/** @type {number} */ x, /** @type {number} */ z) => opts.ground?.(x, z) ?? water.sampleLive(x, z).surface - water.sampleLive(x, z).depth,
    ring: (/** @type {number} */ x, /** @type {number} */ z) => {
      ripples?.addImpulse(x, z, M.ringStrength, M.ringM);
      rises.push({ n: riseCount++, t: clockS, x, y: water.sampleLive(x, z).surface, z });
      if (rises.length > 40) rises.shift();
    },
    // Reed and rush clumps to rest on (dragonflies): where each stands and how tall it has grown.
    perches: () => (world.state?.growth?.plants ?? []).filter((/** @type {any} */ p) => M.perchOn?.[p.sp] && p.stage >= 2)
      .map((/** @type {any} */ p) => ({ x: p.x, z: p.z, h: M.perchOn[p.sp] * Math.min(1, p.size) })),
  };
  const comeBack = createReturn(recipe.reveal?.growS ?? 0.6);
  const bones = new Float32Array(MAX_BONES * 16);

  /** The deep spot of a group's pool, from the tick's pools; else its home. @param {any} g */
  function deepOf(g) {
    const eco = world.state?.ecology?.[key];
    const p = eco?.pools?.find((/** @type {any} */ q) => (q.groups ?? []).includes(g.id));
    if (!p) return { x: g.x, z: g.z };
    const n = Math.round(Math.sqrt(eco.score.length));
    const [x, z] = cellCenter(p.deepK, n);
    return { x, z };
  }

  /** Bring the schools in line with the tick's groups. */
  function sync() {
    const S = world.state?.creatures?.[key];
    const groups = S && !S.dormant ? S.groups : [];
    const ids = new Set(groups.map((/** @type {any} */ g) => g.id));
    for (const id of [...schools.keys()]) if (!ids.has(id)) schools.delete(id);
    const share = Math.min(1, budget / Math.max(1, groups.reduce((/** @type {number} */ s, /** @type {any} */ g) => s + g.count, 0)));
    for (const g of groups) {
      const n = Math.max(1, Math.floor(g.count * share));
      const s = schools.get(g.id);
      if (s) { s.rehome({ x: g.x, z: g.z }, deepOf(g)); if (s.fish.length !== n) s.resize(n); continue; }
      const make = M.kind === 'patrol' ? createPatrol : createSchool;
      schools.set(g.id, /** @type {any} */ (make)({ id: g.id, seed: world.env.seed ^ hash32(key.length, 0x5c), count: n, home: { x: g.x, z: g.z },
        deep: deepOf(g), size: body.displayScale ?? 1, M, env }));
    }
  }

  /** Day, night or winter for the schools, from the hour and season shown. */
  function moodNow() {
    if (seasonOf(display()).index === 3) return 'winter';
    const h = display() / SECONDS_PER_HOUR;
    const hour = h - Math.floor(h / HOURS_PER_DAY) * HOURS_PER_DAY;
    const [from, to] = recipe.ecology.activity.hours ?? [6, 20];
    return hour >= from && hour < to ? 'day' : 'night';
  }

  /** Pose every fish and hand them to the pass. @param {number} t */
  function draw(t) {
    /** @type {import('../../render/passes/creatures.js').Being[]} */ const beings = [];
    const eye = camera.eye;
    const size = body.displayScale ?? 1;
    for (const s of schools.values()) {
      const back = comeBack.at(s.id, t);
      if (back.k <= 0) continue;
      s.fish.forEach((f, i) => {
        if (beings.length >= budget) return;
        const id = s.id * 1000 + i;
        const v = hash32(id, 0x7a) % variants;
        const rig = rigs[v] ?? rigs.find((r) => r) ?? null;
        const dist = Math.hypot(f.x - eye[0], f.y - eye[1], f.z - eye[2]);
        let lod = lods.findIndex((/** @type {any} */ l) => l.toM === undefined || dist <= l.toM);
        if (lod < 0) lod = lods.length - 1;
        let mesh = `${v}:${lod}`;
        if (!pass.hasMesh(mesh)) { const any = [...Array(lods.length).keys()].map((l) => `${v}:${l}`).find((k) => pass.hasMesh(k)); if (!any) return; mesh = any; }
        /** @type {Float32Array | null} */ let b = null;
        if (rig) {
          // The body banks and pitches about its middle; a fish's tail beats behind it, a
          // dragonfly's wings beat (patrol.js).
          const q = qmul(axisAngle([1, 0, 0], -f.pitch), axisAngle([0, 0, 1], f.roll));
          let moves;
          if (M.kind === 'patrol') moves = posePatrol(rig, /** @type {any} */ (f), M, q, axisAngle);
          else {
            const beat = Math.sin(f.phase) * M.tailSwing;
            moves = rig.map((bn) => (bn.parent < 0 ? { q } : bn.name === 'tail' ? { q: axisAngle([0, 1, 0], beat) } : bn.name === 'mid' ? { q: axisAngle([0, 1, 0], beat * 0.45) } : null));
          }
          b = new Float32Array(MAX_BONES * 16);
          poseSkeleton(rig, moves, b, 0);
        }
        const jitter = ((hash32(id, 0x51e) >>> 8) / 16777216) * 2 - 1;
        const yaw = /** @type {any} */ (f).yaw ?? Math.atan2(f.vx, f.vz);
        beings.push({ x: f.x, y: f.y, z: f.z, yaw, size: size * (1 + (body.sizeJitter ?? 0) * jitter) * back.k, mesh, bones: b ?? bones });
      });
    }
    pass.setBeings(beings);
  }

  return {
    id: key,
    /** The species' creatures pass, for the frame graph. */
    pass,
    /** The live schools (tools and tests). */
    schools: () => [...schools.values()],
    /**
     * Where each school is now and how many it has (the sound, tools). Each one's place too, with
     * whether it flies and how fast (a dragonfly's wings are heard from it, louder darting). The
     * recent rises to the surface (numbered, stamped in `now`'s seconds) ride on the first entry.
     */
    heard: () => [...schools.values()].map((s, i) => {
      const c = s.centre();
      return { species: key, id: s.id, pos: [c.x, c.y, c.z], count: s.fish.length,
        each: s.fish.map((f) => [f.x, f.y, f.z, /** @type {any} */ (f).mode === 'perch' ? 0 : 1, Math.hypot(f.vx, f.vy, f.vz)]),
        now: clockS, rises: i === 0 ? rises.map((r) => ({ n: r.n, t: r.t, pos: [r.x, r.y, r.z] })) : [] };
    }),
    /** A new quality tier's cap on how many are drawn. @param {number} n */
    setBudget(n) { budget = Math.max(0, Math.min(128, n)); shown = null; },
    /** @type {import('./reveal-return.js').RevealHooks} the reveal on return (src/ui/reveal.js) */
    reveal: {
      species: key,
      style: recipe.reveal?.return ?? 'thicken',
      spots: () => [...schools.values()].map((s) => { const c = s.centre(); return { id: s.id, x: c.x, z: c.z }; }),
      hide: () => comeBack.hide(),
      back: (o) => comeBack.back(animT(), [...schools.keys()], o.windowS, o.effects),
      end: () => comeBack.end(),
    },
    /**
     * The school a tap on the ground at (x, z) lands on, or null: within tapM of one of its fish,
     * more when the camera is far.
     * @param {number} x @param {number} z
     */
    at(x, z) {
      const r = find.tapM + find.tapPerM * camera.distance;
      let best = null, bestD = r * r;
      for (const s of schools.values()) {
        for (const f of s.fish) {
          const d = (f.x - x) * (f.x - x) + (f.z - z) * (f.z - z);
          if (d < bestD) { bestD = d; const c = s.centre(); best = { sp: key, id: s.id, x: c.x, z: c.z }; }
        }
      }
      return best;
    },

    /**
     * The Feed tool tapped (x, z) for this species: crumbs land on the water and the nearest school
     * within feed.reachM swirls up to them. Returns which message the tool card shows.
     * @param {number} x @param {number} z
     */
    feed(x, z) {
      const F = recipe.feed;
      const msg = (/** @type {string} */ k) => F?.messages?.[k] ?? '';
      if (!F) return '';
      if (!getStore('journal')?.species?.[key]?.ever) return msg('unknown');
      if (water.sampleLive(x, z).depth < 0.1) return msg('land');
      let best = null, bestD = F.reachM;
      for (const s of schools.values()) { const c = s.centre(); const d = Math.hypot(c.x - x, c.z - z); if (d < bestD) { bestD = d; best = s; } }
      // A few rings where the crumbs land.
      ripples?.addImpulse(x, z, 0.4, 0.04); ripples?.addImpulse(x + 0.06, z - 0.04, 0.3, 0.03);
      if (!best) return msg('none');
      best.feed({ x, z });
      foods = [...foods.filter((g) => g.id !== best.id), { id: best.id, x, z }];
      return msg('coming');
    },

    /** @param {import('../../sim/live-sim.js').FrameInfo} f */
    tick(f) {
      if (!water.sim.live) return;
      const S = world.state?.creatures?.[key];
      if (S !== shown) { shown = S; sync(); }
      const mood = moodNow();
      for (const s of schools.values()) s.setMood(/** @type {any} */ (mood));
      // Presence (doc 23): a fast swoop low over a school sends it darting for the deep spot.
      const src = opts.presence?.sources() ?? [];
      // Trust shrinks the comfort ring (and lets you closer at a faster pace), as the frogs'.
      const trust = S?.trust ?? 0;
      const ring = Math.max(P.ringMinM ?? 0, P.ringM * (1 - (P.ringTrustShrink ?? 0) * trust));
      // An edit right beside one (a sculpt or pour stroke) does it too.
      for (const p of src) {
        const fast = p.speed >= P.calmSpeed * (1 + 2 * trust);
        if (!fast && !p.editing) continue;
        for (const s of schools.values()) {
          if (s.darting) continue;
          // The nearest of them (a dragonfly's beat spreads over a few meters).
          const near = fast && s.fish.some((f) => Math.hypot(p.pos[0] - f.x, p.pos[1] - f.y, p.pos[2] - f.z) <= ring);
          const edited = p.edits.some((e) => s.fish.some((f) => Math.hypot(e.x - f.x, e.z - f.z) <= P.editReachM));
          if (near || edited) { s.startle(); emitDeferred('creature:startled', { species: key, id: s.id }); }
        }
      }
      // Quiet watching close by earns trust (doc 23), recorded now for the next hourly tick.
      if (watching && S && !S.dormant) {
        const looked = watching.step([...schools.values()].map((s) => { const c = s.centre(); return { id: s.id, x: c.x, y: c.y, z: c.z, mode: 'here' }; }), src, f.realDt);
        if (looked.length) {
          for (const w of looked) world.state = addSwarmEvent(world.state, key, { kind: 'watched', minutes: w.minutes, hour: hourIndex() });
          updateStore('world', () => world.state);
        }
      }
      // A curious one (dragonflies) now and then comes to hover near where you look.
      const curious = P.curiousAt !== undefined && trust >= P.curiousAt;
      for (const s of schools.values()) /** @type {any} */ (s).setVisit?.(curious ? { x: camera.target[0], y: camera.target[1] + (M.visitM ?? 0.7), z: camera.target[2] } : null);
      // Crumbs on the water: when the school reaches them it has eaten (once per offer).
      for (const fd of foods.slice()) {
        const s = schools.get(fd.id);
        if (!s) { foods = foods.filter((g) => g !== fd); continue; }
        const c = s.centre();
        if (Math.hypot(c.x - fd.x, c.z - fd.z) < 0.5) {
          foods = foods.filter((g) => g !== fd);
          world.state = addSwarmEvent(world.state, key, { kind: 'fed', hour: hourIndex() });
          updateStore('world', () => world.state);
        } else if (!s.feeding) foods = foods.filter((g) => g !== fd);
      }
      acc = Math.min(acc + f.realDt, stepS * 6);
      while (acc >= stepS) { clockS += stepS; for (const s of schools.values()) s.step(stepS); acc -= stepS; }
      draw(f.animT);
      // Watching one closely finds it: in the middle of the view, zoomed in, for a moment.
      if (getStore('journal')?.species?.[key]?.ever) return;
      const near = camera.distance <= find.lookDistM && [...schools.values()].some((s) => {
        const c = s.centre();
        return (c.x - camera.target[0]) ** 2 + (c.z - camera.target[2]) ** 2 <= find.lookM * find.lookM;
      });
      watched = near ? watched + f.realDt : 0;
      if (watched >= find.holdS) { watched = 0; emitDeferred('creature:found', { species: key, how: 'watched' }); }
    },
  };
}

/** @typedef {ReturnType<typeof createSchools>} Schools */

// @ts-check
// Live schools and swarms (M2; docs 11, 12, 23): the groups the hourly tick keeps
// (src/world/creatures/swarms.js), alive. One of these runs per species whose recipe has
// ecology.kind 'swarm' and a body: its seeded body variants are baked in the background (bodies.js),
// each group becomes a school (school.js; dragonflies' patrol joins in M2 piece F), stepped at a
// fixed rate of real time, posed by its bones and drawn by its own creatures pass, with no contact
// shadow. A fast swoop of the camera close by startles a school; watching one closely, or tapping
// it, finds it for the journal (`creature:found`). Nothing here changes the world.

import { emitDeferred } from '../../core/events.js';
import { get as getStore } from '../../core/store.js';
import { display, animT, seasonOf, SECONDS_PER_HOUR, HOURS_PER_DAY } from '../../core/clock.js';
import { hash32 } from '../../core/rng.js';
import { run } from '../../core/workers.js';
import { createCreaturePass } from '../../render/passes/creatures.js';
import { MAX_BONES } from './bodies.js';
import { poseSkeleton } from './pose.js';
import { createReturn } from './reveal-return.js';
import { createSchool } from './school.js';
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
 *   presence?: import('./presence.js').Presence, budget?: number }} opts
 *   recipe: recipes/species/<id>.json (minnow); budget: the most drawn at once (the quality tier)
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
  const stepS = 1 / (M.stepHz ?? 30);
  const env = {
    water: (/** @type {number} */ x, /** @type {number} */ z) => water.sampleLive(x, z),
    ring: (/** @type {number} */ x, /** @type {number} */ z) => ripples?.addImpulse(x, z, M.ringStrength, M.ringM),
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
      schools.set(g.id, createSchool({ id: g.id, seed: world.env.seed ^ hash32(key.length, 0x5c), count: n, home: { x: g.x, z: g.z },
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
          // The body banks and pitches about its middle; the tail beats behind it.
          const beat = Math.sin(f.phase) * M.tailSwing;
          const q = qmul(axisAngle([1, 0, 0], -f.pitch), axisAngle([0, 0, 1], f.roll));
          const moves = rig.map((bn) => (bn.parent < 0 ? { q } : bn.name === 'tail' ? { q: axisAngle([0, 1, 0], beat) } : bn.name === 'mid' ? { q: axisAngle([0, 1, 0], beat * 0.45) } : null));
          b = new Float32Array(MAX_BONES * 16);
          poseSkeleton(rig, moves, b, 0);
        }
        const jitter = ((hash32(id, 0x51e) >>> 8) / 16777216) * 2 - 1;
        beings.push({ x: f.x, y: f.y, z: f.z, yaw: Math.atan2(f.vx, f.vz), size: size * (1 + (body.sizeJitter ?? 0) * jitter) * back.k, mesh, bones: b ?? bones });
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
    /** Where each school is now and how many it has (the sound, tools). */
    heard: () => [...schools.values()].map((s) => { const c = s.centre(); return { species: key, id: s.id, pos: [c.x, c.y, c.z], count: s.fish.length }; }),
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

    /** @param {import('../../sim/live-sim.js').FrameInfo} f */
    tick(f) {
      if (!water.sim.live) return;
      const S = world.state?.creatures?.[key];
      if (S !== shown) { shown = S; sync(); }
      const mood = moodNow();
      for (const s of schools.values()) s.setMood(/** @type {any} */ (mood));
      // Presence (doc 23): a fast swoop low over a school sends it darting for the deep spot.
      const src = opts.presence?.sources() ?? [];
      // An edit right beside one (a sculpt or pour stroke) does it too.
      for (const p of src) {
        const fast = p.speed >= P.calmSpeed;
        if (!fast && !p.editing) continue;
        for (const s of schools.values()) {
          if (s.darting) continue;
          const c = s.centre();
          const near = fast && Math.hypot(p.pos[0] - c.x, p.pos[1] - c.y, p.pos[2] - c.z) <= P.ringM;
          const edited = p.edits.some((e) => Math.hypot(e.x - c.x, e.z - c.z) <= P.editReachM);
          if (near || edited) { s.startle(); emitDeferred('creature:startled', { species: key, id: s.id }); }
        }
      }
      acc = Math.min(acc + f.realDt, stepS * 6);
      while (acc >= stepS) { for (const s of schools.values()) s.step(stepS); acc -= stepS; }
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

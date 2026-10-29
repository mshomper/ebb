// @ts-check
// Live schools and swarms (M2; docs 11, 12, 23): the groups the hourly tick keeps
// (src/world/creatures/swarms.js), alive. One of these runs per species whose recipe has
// ecology.kind 'swarm' and a body: its seeded body variants are baked in the background (bodies.js),
// each group becomes a school (school.js; dragonflies' patrol joins in M2 piece F), stepped at a
// fixed rate of real time, posed by its bones and drawn by its own creatures pass, with no contact
// shadow. A fast swoop of the camera close by startles a school; watching one closely, or tapping
// it, finds it for the journal (`creature:found`). Nothing here changes the world.

import { emitDeferred, on } from '../../core/events.js';
import { get as getStore, update as updateStore } from '../../core/store.js';
import { display, animT, seasonOf, hourIndex, SECONDS_PER_HOUR, HOURS_PER_DAY } from '../../core/clock.js';
import { createWatching } from './watching.js';
import { ringScale } from './presence.js';
import { addSwarmEvent } from './swarms.js';
import { hash32 } from '../../core/rng.js';
import { run } from '../../core/workers.js';
import { createCreaturePass } from '../../render/passes/creatures.js';
import { MAX_BONES } from './bodies.js';
import { poseSkeleton, axisAngle } from './pose.js';
import { createReturn } from './reveal-return.js';
import { createSchool, poseSchool } from './school.js';
import { createPatrol, posePatrol } from './patrol.js';
import { createBask, poseBask } from './bask.js';
import { cellCenter } from '../ecology/habitat.js';
import { keyOf } from '../species.js';
import { turtleId } from './bonds.js';

const BAKE_JOB = { module: './world/creatures/bodies.js', fn: 'bakeVariant' };

export { axisAngle };

/**
 * The line a tap makes, from the eye through the tapped point (a little past it): for a body, how
 * far it is from that line and how far from the eye along it. Pure.
 * @param {ArrayLike<number>} eye @param {number[]} p the tapped point
 * @returns {(b: { x: number, y: number, z: number }) => { d: number, far: number }}
 */
export function tapRay(eye, p) {
  const dx = p[0] - eye[0], dy = p[1] - eye[1], dz = p[2] - eye[2];
  const l2 = Math.max(dx * dx + dy * dy + dz * dz, 1e-9);
  return (b) => {
    const t = Math.min(1.1, Math.max(0, ((b.x - eye[0]) * dx + (b.y - eye[1]) * dy + (b.z - eye[2]) * dz) / l2));
    const cx = eye[0] + dx * t, cy = eye[1] + dy * t, cz = eye[2] + dz * t;
    return { d: Math.hypot(b.x - cx, b.y - cy, b.z - cz), far: Math.sqrt(l2) * t };
  };
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
 *   presence?: import('./presence.js').Presence, budget?: number, ground?: (x: number, z: number) => number,
 *   you?: () => number[] | null }} opts
 *   recipe: recipes/species/<id>.json (minnow: motion.kind school; dragonfly: patrol); budget: the
 *   most drawn at once (the quality tier); ground: terrain height; you: where you stand on foot (W3),
 *   or null while you are above
 */
export function createSchools(opts) {
  const { world, recipe, water, ripples, camera } = opts;
  const key = keyOf(recipe);
  const body = recipe.body, M = recipe.motion, P = recipe.presence, find = recipe.find;
  const variants = Math.max(1, body.variants ?? 1);
  const lods = recipe.bake.lods ?? [{ cellM: recipe.bake.cellM }];
  // Wet eyes for a body whose recipe lists eye bones (the turtle's).
  const eyeAt = (/** @type {string} */ n) => (body.bones ?? []).findIndex((/** @type {any} */ b) => b.name === n);
  const pass = createCreaturePass({ recipe, name: key, eyeBones: eyeAt('eye.l') >= 0 ? [eyeAt('eye.l'), eyeAt('eye.r')] : undefined });
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
  /**
   * Crumbs (or a treat, P2h) a school is swimming up to, by school id; a treat's moment still lying
   * (waitS), its seconds nibbled (nibbleS) and how many swirls it has had.
   * @type {{ id: number, x: number, z: number, treat?: string, tid?: number, waitS?: number, nibbleS?: number, swirls?: number }[]}
   */
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
    // Perch sticks stood in the shallows (B1 P1; published by src/world/creatures/perch-sticks.js):
    // each one's tip, where a dragonfly lands.
    sticks: () => M.stickChance ? getStore('perchSticks') ?? [] : [],
    // Stones, logs and the raft to bask on (turtles; published by src/world/creatures/spring-live.js).
    seats: () => getStore('seats') ?? [],
    // Plants a turtle grazes (lily leaves, pondweed: motion.habits.grazeOn).
    food: () => (world.state?.growth?.plants ?? []).filter((/** @type {any} */ p) => M.habits?.grazeOn?.[p.sp] && p.stage >= 1)
      .map((/** @type {any} */ p) => ({ x: p.x, z: p.z, sp: p.sp })),
    // Where you are, for a turtle at the periscope to turn and face: on foot, or the camera's eye.
    viewer: () => opts.you?.() ?? camera.eye,
  };
  const comeBack = createReturn(recipe.reveal?.growS ?? 0.6);

  // The moment they come to know you (`creature:known` in an hour's events; swarms.js): the nearest
  // school rises to meet you at the bank, or a dragonfly comes and rests on your hat. On foot only;
  // above, the note says it.
  const K = recipe.known ?? {};
  on('world:ticked', (/** @type {{ events?: any[] }} */ p) => {
    if (!(p.events ?? []).some((e) => e.name === 'creature:known' && e.payload?.species === key)) return;
    const me = opts.you?.() ?? null;
    if (!me) return;
    if (M.kind === 'patrol') {
      for (const s of schools.values()) /** @type {any} */ (s).land?.(() => { const y = opts.you?.(); return y ? { x: y[0], y: y[1] + (K.hatM ?? 0.12), z: y[2] } : null; }, K.restS ?? 20);
      return;
    }
    if (M.kind !== 'school') return;
    // The water nearest you, deep enough for them; the nearest school within reach swirls up to it.
    let at = null, ad = Infinity;
    for (let r = 0.3; r <= (K.bankM ?? 3) && !at; r += 0.3) for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, x = me[0] + Math.cos(a) * r, z = me[2] + Math.sin(a) * r;
      if (water.sampleLive(x, z).depth >= (M.minDepthM ?? 0.1) && r < ad) { ad = r; at = { x, z }; }
    }
    if (!at) return;
    let best = null, bestD = K.reachM ?? 8;
    for (const s of schools.values()) { const c = s.centre(); const d = Math.hypot(c.x - at.x, c.z - at.z); if (d < bestD) { bestD = d; best = s; } }
    if (best) { best.feed(at); ripples?.addImpulse(at.x, at.z, 0.3, 0.05); }
  });
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
      const make = M.kind === 'patrol' ? createPatrol : M.kind === 'bask' ? createBask : createSchool;
      schools.set(g.id, /** @type {any} */ (make)({ id: g.id, seed: world.env.seed ^ hash32(key.length, 0x5c), count: n, home: { x: g.x, z: g.z },
        deep: deepOf(g), size: body.displayScale ?? 1, M, env, bones: body.bones }));
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
          else if (M.kind === 'bask') moves = poseBask(rig, /** @type {any} */ (f), M, q, axisAngle);
          else moves = poseSchool(rig, f, M, q, axisAngle);
          b = new Float32Array(MAX_BONES * 16);
          poseSkeleton(rig, moves, b, 0);
        }
        const jitter = ((hash32(id, 0x51e) >>> 8) / 16777216) * 2 - 1;
        const yaw = /** @type {any} */ (f).yaw ?? Math.atan2(f.vx, f.vz);
        // A turtle dries as it basks (its shell goes from glossy to matte).
        const wet = /** @type {any} */ (f).wet;
        beings.push({ x: f.x, y: f.y, z: f.z, yaw, size: size * (1 + (body.sizeJitter ?? 0) * jitter) * back.k, mesh, bones: b ?? bones,
          dry: wet === undefined ? 0 : 1 - wet });
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
     * What a tap lands on, or null. The tap hit the ground or water at (x, y, z); a dragonfly flies a
     * meter up and a fish swims under the surface, so the test is along the line from the camera's
     * eye through that point: the one nearest the line, within tapM of it plus tapPerM per meter
     * from the eye (a far one is small on screen). Without y, the ground point alone, as before.
     * The ring goes round a school's middle, or round the very dragonfly tapped.
     * @param {number} x @param {number} z @param {number} [y]
     */
    at(x, z, y) {
      const eye = camera.eye;
      const ray = y === undefined ? null : tapRay(eye, [x, y, z]);
      let best = null, bestK = 1;
      for (const s of schools.values()) {
        for (const f of s.fish) {
          let d, far;
          if (ray) ({ d, far } = ray(f));
          else { d = Math.hypot(f.x - x, f.z - z); far = camera.distance; }
          const k = d / (find.tapM + find.tapPerM * far);
          if (k < bestK) {
            bestK = k;
            // A turtle is tapped as itself (one: its id, bonds.js), ringed where it is.
            const one = M.kind === 'bask';
            const c = M.kind === 'patrol' || one ? f : s.centre();
            best = { sp: key, id: s.id, x: c.x, z: c.z, ...(one ? { one: turtleId(s.id, s.fish.indexOf(f)) } : {}) };
          }
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

    /**
     * A treat this species likes set in the water at (x, z) (P2h, treats.js): the nearest school
     * within reachM swirls up to it at once, found or not. Returns 'coming', 'none' or 'land'; once
     * eaten, `treat:taken` says so with the treat's id.
     * @param {number} x @param {number} z @param {{ treat: string, tid: number, reachM: number }} t
     */
    treat(x, z, t) {
      if (world.state?.creatures?.[key]?.dormant) return 'none';
      // Turtles (bask.js): set at the water's edge; the nearest turtle (or, for a treat that is torn
      // at, the group) slides in, swims over and takes it from the edge, by day.
      if (M.kind === 'bask') {
        const T = recipe.treat ?? {}, way = T.ways?.[t.treat] ?? {};
        let best = null, bestD = t.reachM;
        for (const s of schools.values()) for (const f of s.fish) { const d = Math.hypot(f.x - x, f.z - z); if (d < bestD) { bestD = d; best = s; } }
        if (!best || moodNow() !== 'day') return 'none';
        const ok = /** @type {any} */ (best).treat({ x, z, tid: t.tid, treat: t.treat, eatS: way.eatS ?? 4, shake: !!way.tear, all: !!way.all,
          waitS: T.noticeS ?? 0 });
        return ok ? 'coming' : 'none';
      }
      if (water.sampleLive(x, z).depth < 0.1) return 'land';
      let best = null, bestD = t.reachM;
      for (const s of schools.values()) { const c = s.centre(); const d = Math.hypot(c.x - x, c.z - z); if (d < bestD) { bestD = d; best = s; } }
      if (!best) return 'none';
      // It lies a moment first (treat.noticeS), then the school swirls up and nibbles (tick).
      foods = [...foods.filter((g) => g.id !== best.id), { id: best.id, x, z, treat: t.treat, tid: t.tid, waitS: recipe.treat?.noticeS ?? 0, nibbleS: 0, swirls: 0 }];
      return 'coming';
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
        // Only a source with a body is felt coming fast (doc 23, W3); an edit is felt from any.
        const fast = p.body && p.speed >= P.calmSpeed * (1 + 2 * trust);
        if (!fast && !p.editing) continue;
        for (const s of schools.values()) {
          if (s.darting) continue;
          // The nearest of them (a dragonfly's beat spreads over a few meters); lower and looking away is closer.
          const near = fast && s.fish.some((f) => Math.hypot(p.pos[0] - f.x, p.pos[1] - f.y, p.pos[2] - f.z)
            <= ring * (p.ringK ?? 1) * (P.multipliers ? ringScale(p, f.x, f.z, P.multipliers) : 1));
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
        // A treat: after its moment lying, the school swirls up to it, and keeps swirling round it
        // (up to a few times) while it nibbles, nibbleS seconds near before it is eaten.
        if (fd.treat) {
          if (/** @type {number} */ (fd.waitS) > 0) { fd.waitS = /** @type {number} */ (fd.waitS) - f.realDt; continue; }
          if (!s.feeding) {
            if ((fd.swirls = (fd.swirls ?? 0) + 1) > 4) { foods = foods.filter((g) => g !== fd); continue; }
            s.feed({ x: fd.x, z: fd.z });
          }
        }
        const c = s.centre();
        const near = Math.hypot(c.x - fd.x, c.z - fd.z) < 0.5;
        if (fd.treat && near) fd.nibbleS = (fd.nibbleS ?? 0) + f.realDt;
        // Each treat its own time (pondweed is grazed a little longer than a leaf pack is nibbled).
        const nibble = (fd.treat && recipe.treat?.nibbleSOf?.[fd.treat]) ?? recipe.treat?.nibbleS ?? 0;
        if (fd.treat ? (fd.nibbleS ?? 0) >= nibble : near) {
          foods = foods.filter((g) => g !== fd);
          if (fd.treat) {
            world.state = addSwarmEvent(world.state, key, { kind: 'treat', hour: hourIndex(), treat: fd.treat });
            emitDeferred('treat:taken', { species: key, id: fd.id, treat: fd.treat, tid: fd.tid });
          } else world.state = addSwarmEvent(world.state, key, { kind: 'fed', hour: hourIndex() });
          updateStore('world', () => world.state);
        } else if (!s.feeding && !fd.treat) foods = foods.filter((g) => g !== fd);
      }
      acc = Math.min(acc + f.realDt, stepS * 6);
      while (acc >= stepS) { clockS += stepS; for (const s of schools.values()) s.step(stepS); acc -= stepS; }
      // Turtles that have taken a treat from the edge (bask.js): each that ate knows you that much
      // better (bonds.js), and the treat is off the ground.
      for (const s of schools.values()) {
        for (const e of /** @type {any} */ (s).eaten?.() ?? []) {
          world.state = addSwarmEvent(world.state, key, { kind: 'treat', hour: hourIndex(), treat: e.treat, who: e.who.map((/** @type {number} */ i) => turtleId(s.id, i)) });
          updateStore('world', () => world.state);
          emitDeferred('treat:taken', { species: key, id: s.id, treat: e.treat, tid: e.tid });
        }
        // Dragonflies landing on a perch stick (patrol.js): with you on foot near it, their treat.
        // The stick stays; once a day counts (the hourly tick, treatGain).
        for (const l of /** @type {any} */ (s).landed?.() ?? []) {
          const me = opts.you?.() ?? null, T = recipe.treat;
          if (!T || !me || Math.hypot(me[0] - l.x, me[2] - l.z) > (T.nearM ?? 6)) continue;
          world.state = addSwarmEvent(world.state, key, { kind: 'treat', hour: hourIndex(), treat: T.id });
          updateStore('world', () => world.state);
          emitDeferred('perch:landed', { species: key, id: l.stick });
        }
      }
      draw(f.animT);
      // Watching one closely finds it: in the middle of the view, zoomed in, for a moment; or, on
      // foot, standing within reach of it (W3).
      if (getStore('journal')?.species?.[key]?.ever) return;
      const me = opts.you?.() ?? null;
      const near = me ? [...schools.values()].some((s) => { const c = s.centre(); return Math.hypot(c.x - me[0], c.z - me[2]) <= find.lookDistM + find.lookM; })
        : camera.distance <= find.lookDistM && [...schools.values()].some((s) => {
          const c = s.centre();
          return (c.x - camera.target[0]) ** 2 + (c.z - camera.target[2]) ** 2 <= find.lookM * find.lookM;
        });
      watched = near ? watched + f.realDt : 0;
      if (watched >= find.holdS) { watched = 0; emitDeferred('creature:found', { species: key, how: 'watched' }); }
    },
  };
}

/** @typedef {ReturnType<typeof createSchools>} Schools */

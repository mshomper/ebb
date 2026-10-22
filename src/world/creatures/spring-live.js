// @ts-check
// Spring at the pond, live (doc 13; the hourly side is spring.js): frogspawn clumps floating in the
// warm shallows, the tadpoles that wriggle round them, the froglets climbing out at the turn of
// summer, and the common toad on its night walk from a stone or log to the water. Drawn by two
// small creature passes of their own (in the water: no contact shadow; on the ground: with one),
// sized from frogspawn.json and toad.json. The finds module asks shown() what a tap may land on, so
// tapping any of them finds its page.
//
// It also keeps the basking spots: the stones, logs and raft the pieces hold, published in the
// store as `seats` (top heights, for the turtles, bask.js) and kept in the world as `basks` (where
// they are, for the hourly tick: turtles' shelter, the toad's walk). Pieces are not world state, so
// this is how the tick sees them; the same pieces give the same basks, live or while away.

import { get as getStore, update as updateStore } from '../../core/store.js';
import { display, hourIndex, SECONDS_PER_HOUR } from '../../core/clock.js';
import { cellCenter } from '../ecology/habitat.js';
import { hash32, subSeed } from '../../core/rng.js';
import { run } from '../../core/workers.js';
import { createCreaturePass } from '../../render/passes/creatures.js';
import { MAX_BONES } from './bodies.js';
import { poseSkeleton, axisAngle } from './pose.js';
import { toadAt, initialSpring, nearestPond, clumpBody, tadpoleBody } from './spring.js';

const BAKE_JOB = { module: './world/creatures/bodies.js', fn: 'bakeVariant' };

/** Float 0..1 from a hash. @param {number} h */
const unit = (h) => (h >>> 8) / 16777216;

/**
 * @param {{ world: { state: any, env: any }, terrain: { sampleHeight: (x: number, z: number) => number },
 *   water: { sim: { live: any }, sampleLive: (x: number, z: number) => { surface: number, depth: number } },
 *   camera: { target: ArrayLike<number> }, pieces: any, recipes: { frogspawn: any, toad: any, frog: any }, test?: string | null }} opts
 *   pieces: src/world/pieces (kept logs; seats() once the shaping work brings it); test: `?spring=`
 */
export function createSpring(opts) {
  const { world, terrain, water, pieces } = opts;
  const R = opts.recipes.frogspawn, T = opts.recipes.toad, frog = opts.recipes.frog;
  const B = R.body, TP = B.tadpole, FL = B.froglet;
  const wetPass = createCreaturePass({ recipe: { body: { wetSpecular: B.wetSpecular, contactShadow: 0, scaleReal: B.scaleReal } }, name: 'spring-water' });
  const landPass = createCreaturePass({ recipe: { body: { wetSpecular: T.body.wetSpecular, contactShadow: T.body.contactShadow, scaleReal: T.body.scaleReal } }, name: 'spring-land' });
  /** @type {Record<string, any[] | null>} skeletons, once baked */
  const rigs = { tadpole: null, froglet: null };
  const bake = (/** @type {any} */ pass, /** @type {string} */ key, /** @type {any} */ args, /** @type {string | null} */ rig) =>
    run(BAKE_JOB, args, { lane: 'background' })
      .then((r) => { if (rig) rigs[rig] = r.bones; pass.setMesh(key, r); })
      .catch((err) => { if (err?.name !== 'Disposed') console.warn(`spring ${key} bake failed`, err); });
  bake(wetPass, 'clump', { id: 'clump', body: clumpBody(R), variant: 0, cellM: B.clump.eggR / 2.5 }, null);
  bake(wetPass, 'tadpole', { id: 'tadpole', body: tadpoleBody(R), variant: 0, cellM: 0.0009 }, 'tadpole');
  const frogLods = frog.bake.lods ?? [{ cellM: frog.bake.cellM }];
  bake(landPass, 'froglet', { id: 'frog', body: frog.body, variant: 0, cellM: frogLods[frogLods.length - 1].cellM }, 'froglet');
  bake(landPass, 'toad', { id: 'toad', body: T.body, variant: 0, cellM: T.bake.cellM }, null);

  const seed = subSeed(world.env.seed, 'spring-live');
  /** Taps: what is shown now. @type {{ sp: string, x: number, z: number, item: string | null, reach: number }[]} */ let shown = [];
  let seatsAt = 0;

  /** The water's top or the ground at a point, whichever is higher. @param {number} x @param {number} z */
  const top = (x, z) => { const w = water.sampleLive(x, z); return w.depth > 0.005 ? w.surface : terrain.sampleHeight(x, z); };
  /**
   * Where a clump floats in the live water: its own spot, or, when the water there is shallower now
   * than the hourly grid says (the level eases with the season), the nearest spot within a meter
   * deep enough to float in. Looked for again every few seconds. @type {Map<number, { x: number, z: number, at: number }>}
   */
  const afloat = new Map();
  /** The dry directions froglets leave a clump by, found once per clump. @type {Map<number, number[]>} */
  const banks = new Map();
  /** @param {{ id: number, x: number, z: number }} c @param {number} t */
  function floatAt(c, t) {
    const had = afloat.get(c.id);
    if (had && t - had.at < 4) return had;
    const deep = R.lay.depthCm[0] / 100;
    let spot = { x: c.x, z: c.z, at: t };
    if (water.sampleLive(c.x, c.z).depth < deep) {
      search: for (let r = 0.2; r <= 1.01; r += 0.2) {
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2, x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
          if (water.sampleLive(x, z).depth >= deep) { spot = { x, z, at: t }; break search; }
        }
      }
    }
    afloat.set(c.id, spot);
    return spot;
  }

  /**
   * The basking spots: the pieces' own seats when they publish them (the shaping work: loose and pond
   * stones, the raft), else loose stones from the store; and the kept logs, lying still. Published as
   * `seats`; their places kept in the world as `basks` when they change.
   */
  function syncSeats() {
    // How many turtles a spot holds: a stone's top one, or two (the second on the first's back) if it
    // is big enough; the raft three; a log one per 0.35 m, side by side.
    const stoneRoom = (/** @type {number} */ r) => (r < 0.12 ? 1 : 2);
    /** @type {{ id: string, kind: string, x: number, y: number, z: number, r: number, room: number, yaw?: number, inWater: boolean }[]} */ const seats = [];
    const listed = pieces?.seats?.();
    const list = getStore('pieces')?.list ?? [];
    if (Array.isArray(listed)) {
      for (const s of listed) {
        const yaw = list.find((/** @type {any} */ p) => p.id === s.id)?.yaw ?? 0;
        seats.push({ id: s.id, kind: s.kind, x: s.x, y: s.y, z: s.z, r: s.r, room: s.kind === 'raft' ? 3 : stoneRoom(s.r), yaw, inWater: !!s.inWater });
      }
    } else {
      for (const p of list) {
        if (p.kind !== 'stone') continue;
        const r = p.size * 0.4;
        seats.push({ id: p.id, kind: 'stone', x: p.x, y: terrain.sampleHeight(p.x, p.z) + p.size * 0.42, z: p.z, r, room: stoneRoom(r), inWater: water.sampleLive(p.x, p.z).depth > 0.02 });
      }
    }
    const ids = new Set(seats.map((s) => s.id));
    for (const log of pieces?.keptLogs?.() ?? []) {
      if (!log.still || ids.has(log.id)) continue;
      const p = log.surface(0.5, Math.PI / 2).p;
      const yaw = list.find((/** @type {any} */ q) => q.id === log.id)?.yaw ?? 0;
      seats.push({ id: log.id, kind: 'log', x: p[0], y: p[1], z: p[2], r: Math.min(0.35, log.length * 0.3), room: Math.max(1, Math.floor(log.length / 0.35)),
        yaw, inWater: water.sampleLive(p[0], p[2]).depth > 0.02 });
    }
    updateStore('seats', () => seats);
    const basks = seats.map((s) => ({ x: Math.round(s.x * 100) / 100, z: Math.round(s.z * 100) / 100, kind: s.kind }))
      .sort((a, b) => a.x - b.x || a.z - b.z);
    if (JSON.stringify(basks) !== JSON.stringify(world.state?.basks ?? [])) {
      world.state = { ...world.state, basks };
      updateStore('world', () => world.state);
    }
  }

  /** Every clump, tadpole and froglet near now, and the toad. @param {number} t real seconds */
  function draw(t) {
    const S = world.state?.spring;
    const h = display() / SECONDS_PER_HOUR;
    /** @type {import('../../render/passes/creatures.js').Being[]} */ const wet = [], land = [];
    /** @type {typeof shown} */ const taps = [];
    for (const k0 of S?.clumps ?? []) {
      // Spawn and tadpoles keep to the live water; froglets set out from where the clump floated.
      const f0 = floatAt(k0, t), c = { ...k0, x: f0.x, z: f0.z };
      const cy = top(c.x, c.z);
      if (c.stage === 'spawn') {
        wet.push({ x: c.x, y: cy - B.clump.floatM * B.displayScale, z: c.z, yaw: unit(hash32(seed, c.id)) * Math.PI * 2, size: B.displayScale, mesh: 'clump' });
        taps.push({ sp: 'frogspawn', x: c.x, z: c.z, item: null, reach: B.clump.radiusM * B.displayScale + 0.1 });
      } else if (c.stage === 'tadpoles' && rigs.tadpole && wetPass.hasMesh('tadpole')) {
        const n = Math.min(TP.drawMost, c.tadpoles);
        for (let i = 0; i < n; i++) {
          const hs = hash32(seed, c.id, i);
          const r = TP.cloudM * Math.sqrt(unit(hash32(hs, 1))), a0 = unit(hash32(hs, 2)) * Math.PI * 2;
          const w = (TP.swimMps / Math.max(0.05, r)) * (unit(hash32(hs, 3)) < 0.5 ? 1 : -1);
          const at = (/** @type {number} */ s) => ({ x: c.x + Math.cos(a0 + s * w) * r + Math.sin(s * 0.7 + i) * 0.04, z: c.z + Math.sin(a0 + s * w) * r + Math.cos(s * 0.5 + i) * 0.04 });
          const p = at(t), q = at(t + 0.1);
          const wag = Math.sin(t * TP.wagHz * Math.PI * 2 + i) * TP.wagRad;
          const b = new Float32Array(MAX_BONES * 16);
          poseSkeleton(rigs.tadpole, [null, { q: axisAngle([0, 1, 0], wag) }], b, 0);
          wet.push({ x: p.x, y: top(p.x, p.z) - 0.012 - 0.02 * unit(hash32(hs, 4)), z: p.z, yaw: Math.atan2(q.x - p.x, q.z - p.z), size: TP.displayScale, mesh: 'tadpole', bones: b });
        }
        taps.push({ sp: 'frogspawn', x: c.x, z: c.z, item: null, reach: TP.cloudM + 0.15 });
      } else if (c.stage === 'froglets' && landPass.hasMesh('froglet')) {
        const span = R.froglets.leaveH;
        // They climb out toward the bank: the directions whose ground two meters off is dry.
        let dry = banks.get(c.id);
        if (!dry) {
          dry = [];
          for (let j = 0; j < 16; j++) {
            const a = (j / 16) * Math.PI * 2;
            if (water.sampleLive(c.x + Math.cos(a) * 2, c.z + Math.sin(a) * 2).depth < 0.005) dry.push(a);
          }
          if (!dry.length) dry.push(0);
          banks.set(c.id, dry);
        }
        for (let i = 0; i < c.froglets; i++) {
          const hs = hash32(seed, c.id, i, 0xf);
          // They climb out together, a wave over the first evening (waveShare of the time), and each
          // hops off over a few game hours.
          const start = c.leaveH - span + unit(hash32(hs, 1)) * span * FL.waveShare, dur = 2 + unit(hash32(hs, 2)) * 3;
          const k = (h - start) / dur;
          if (k < 0 || k > 1) continue;
          const a = dry[hash32(hs, 3) % dry.length] + (unit(hash32(hs, 5)) - 0.5) * 0.4, far = 1 + unit(hash32(hs, 4)) * 2;
          const hops = Math.max(4, Math.round(far / ((FL.hopM[0] + FL.hopM[1]) / 2)));
          const along = k * hops, f = along - Math.floor(along);
          const x = c.x + Math.cos(a) * far * k, z = c.z + Math.sin(a) * far * k;
          const y = top(x, z) + Math.sin(f * Math.PI) * 0.03;
          land.push({ x, y, z, yaw: Math.atan2(Math.cos(a), Math.sin(a)), size: FL.frogletScale * FL.displayScale, mesh: 'froglet' });
          taps.push({ sp: 'frogspawn', x, z, item: null, reach: 0.15 });
        }
      }
    }
    const toad = toadAt(S?.toad ?? null, h);
    if (toad && landPass.hasMesh('toad')) {
      const C = T.crawl;
      const step = (t / C.stepS) % 1;
      const y = terrain.sampleHeight(toad.x, toad.z) + (toad.t < 1 ? Math.max(0, Math.sin(step * Math.PI * 2)) * C.liftM : 0);
      const yaw = toad.yaw + (toad.t < 1 ? Math.sin(step * Math.PI * 2) * C.swayRad : 0);
      land.push({ x: toad.x, y, z: toad.z, yaw, size: T.body.displayScale, mesh: 'toad' });
      taps.push({ sp: 'toads', x: toad.x, z: toad.z, item: null, reach: T.find.tapM });
    }
    wetPass.setBeings(wet);
    landPass.setBeings(land);
    shown = taps;
  }

  /**
   * `?spring=spawn|tadpoles|froglets|toad` (testing): that stage set by the warm shallow nearest the
   * view (the toad a few meters off on dry ground, walking to it), as the hourly tick would.
   * @param {string} kind
   */
  function setTest(kind) {
    const hab = world.env.habitat?.(), seasons = world.state?.seasons;
    if (!hab || !seasons) return false;
    // Near the frogs if there are any (where they would lay), else near the middle of the view.
    const t = opts.camera.target, n = hab.n;
    const frogs = world.state?.creatures?.frogs?.frogs ?? [];
    const from = frogs.length ? frogs.map((/** @type {any} */ f) => [f.x, f.z]) : [[t[0], t[2]]];
    let best = -1, bestD = Infinity;
    for (let k = 0; k < n * n; k++) {
      const d = hab.open[k] && !hab.sea[k] && hab.still[k] ? hab.depthCm[k] : 0;
      if (d < R.lay.depthCm[0] || d > R.lay.depthCm[1]) continue;
      const [x, z] = cellCenter(k, n), dd = Math.min(...from.map((/** @type {number[]} */ p) => (x - p[0]) ** 2 + (z - p[1]) ** 2));
      if (dd < bestD) { bestD = dd; best = k; }
    }
    if (best < 0) return true;
    const [x, z] = cellCenter(best, n);
    const h = hourIndex(), prev = world.state.spring;
    const S = { ...(prev ?? initialSpring()), year: seasons.year ?? 0, clumps: [...(prev?.clumps ?? [])] };
    const clump = (/** @type {number} */ dx, /** @type {number} */ dz) => ({ id: S.nextId++, x: x + dx, z: z + dz, stage: 'spawn', laidH: h, hatchH: h + R.hatch.days * 24, tadpoles: 0, froglets: 0, leaveH: 0 });
    if (kind === 'spawn') S.clumps.push(clump(0, 0), clump(0.35, 0.2));
    else if (kind === 'tadpoles') S.clumps.push({ ...clump(0, 0), stage: 'tadpoles', hatchH: h, tadpoles: R.hatch.tadpoles });
    // As their wave begins, so they are hopping out as the island opens.
    else if (kind === 'froglets') S.clumps.push({ ...clump(0, 0), stage: 'froglets', hatchH: h, froglets: R.froglets.most, leaveH: h + R.froglets.leaveH - 1 });
    else if (kind === 'toad') {
      // Dry ground 3 to 6 m from that water, the nearest to the view.
      let from = null, fd = Infinity;
      for (let k = 0; k < n * n; k++) {
        if (!hab.open[k] || hab.sea[k] || hab.depthCm[k] > 0) continue;
        const [fx, fz] = cellCenter(k, n), d2 = (fx - x) ** 2 + (fz - z) ** 2;
        if (d2 < 9 || d2 > 36) continue;
        const p = nearestPond(hab, fx, fz, 8, T.walk.pondCm);
        if (!p) continue;
        const dd = (fx - t[0]) ** 2 + (fz - t[2]) ** 2;
        if (dd < fd) { fd = dd; from = { x: fx, z: fz, pond: p }; }
      }
      if (!from) return true;
      const now = display() / SECONDS_PER_HOUR;
      S.toad = { fromX: from.x, fromZ: from.z, toX: from.pond.x, toZ: from.pond.z, startH: now, endH: now + 1.5, goneH: now + 3, seed: 1 };
    }
    world.state = { ...world.state, spring: S };
    updateStore('world', () => world.state);
    return true;
  }
  let test = opts.test ?? null, testWait = 0;

  return {
    id: 'spring',
    /** The two passes, for the frame graph. */
    passes: [wetPass, landPass],
    /** What a tap may land on now (the finds module's addSource). */
    shown: () => shown,
    /** @param {import('../../sim/live-sim.js').FrameInfo} f */
    tick(f) {
      if (!water.sim.live) return;
      if ((seatsAt -= f.realDt) <= 0) { seatsAt = 1; syncSeats(); }
      if (test && (testWait += f.realDt) > 2 && setTest(test)) test = null;
      draw(f.animT);
    },
  };
}

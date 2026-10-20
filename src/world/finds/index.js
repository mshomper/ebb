// @ts-check
// Finds (docs/future/11): small shore lives with a body and one motion, found by tapping. Where they
// live comes from the ground: the shore zones (world/water/shore.js) and the water summary, so
// shaping the coast moves them and nothing is saved. Each 0.5 m cell of a kind's zones may hold a
// small group, decided by a seeded hash of the cell (and, for lugworm casts, of the tide), worked
// out only near the view's middle. Anemones live in rock pools, a hollow of rock in the tide band
// that holds water, and open under water and close at low tide or when you come close; periwinkles
// cluster on the wrack and drift a little each tide; lugworm casts are laid fresh after each tide on
// the sand the sea has left. Drawn by a creatures pass of their own, with no rig.

import { hash32 } from '../../core/rng.js';
import { WATER_CLASS } from '../water/summary.js';
import { WATER_CELL, waterCellCenter } from '../water/grid.js';
import { bakeBody } from '../creatures/body-bake.js';
import { packMesh } from '../creatures/bodies.js';
import { createCreaturePass } from '../../render/passes/creatures.js';
import { groundOfCell } from '../water/shore.js';
import { get as getStore } from '../../core/store.js';

const KINDS = /** @type {const} */ (['anemone', 'periwinkle', 'lugworm']);
const ROCK_ZONES = ['kelp', 'wrack', 'channelled'];
/** @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;

/**
 * The cells (water-cell indices into the summary rect) each kind may live in.
 * @param {{ rect: any, cls: Uint8Array, basin: Uint16Array, band: Uint8Array }} s the water summary
 * @param {{ zone: Uint8Array, ids: string[] }} z the shore zones
 * @param {any} kinds finds.json kinds
 * @param {(k: number) => boolean} [rockAt] is the cell painted rock (for pool floors below the shore zones)
 * @returns {Record<string, number[]>}
 */
export function findCells(s, z, kinds, rockAt = () => true) {
  /** @type {Record<string, number[]>} */ const out = {};
  for (const id of KINDS) out[id] = [];
  // A rock pool is a hollow (a basin) that reaches into the tide band, so the sea fills it at high
  // water and leaves it full at low; its floor may lie deeper than the band.
  const tidal = new Set();
  for (let k = 0; k < s.basin.length; k++) if (s.basin[k] && s.band[k]) tidal.add(s.basin[k]);
  for (let k = 0; k < z.zone.length; k++) {
    const v = z.zone[k];
    const zid = v ? z.ids[v - 1] : null;
    const pool = !!s.basin[k] && tidal.has(s.basin[k]) && (s.cls[k] === WATER_CLASS.still || s.cls[k] === WATER_CLASS.damp) &&
      (zid ? ROCK_ZONES.includes(zid) : rockAt(k));
    if (!zid && !pool) continue;
    for (const id of KINDS) {
      const zones = kinds[id].zones;
      if ((zid && zones.includes(zid)) || (pool && zones.includes('pool'))) out[id].push(k);
    }
  }
  return out;
}

/**
 * The finds in a group at one cell: positions and a seeded value each. Pure.
 * @param {number} seed @param {string} kind @param {number} k cell @param {any} K the kind's recipe
 * @param {number} cx @param {number} cz the cell's middle @param {number} tide the tide's index (casts and periwinkles move with it)
 * @returns {{ x: number, z: number, yaw: number, r: number, key: string }[]}
 */
export function groupAt(seed, kind, k, K, cx, cz, tide) {
  const salt = KINDS.indexOf(kind) + 1;
  const moving = kind === 'lugworm';
  const h0 = hash32(seed, k, salt * 7919 + (moving ? tide * 31 : 0));
  if (u01(h0) >= K.density) return [];
  const n = K.count[0] + Math.floor(u01(hash32(h0, 1)) * (K.count[1] - K.count[0] + 1));
  const out = [];
  for (let i = 0; i < n; i++) {
    const h = hash32(h0, 2, i);
    const a = u01(h) * Math.PI * 2, d = Math.sqrt(u01(hash32(h, 3))) * K.spreadM;
    // Periwinkles creep a little each tide.
    const drift = kind === 'periwinkle' ? (K.driftM ?? 0) * (u01(hash32(h, tide, 5)) - 0.5) * 2 : 0;
    out.push({ x: cx + Math.cos(a) * d + drift, z: cz + Math.sin(a) * d + drift * 0.6, yaw: u01(hash32(h, 4)) * Math.PI * 2, r: u01(hash32(h, 6)),
      key: `${kind}:${k}:${i}${moving ? `:${tide}` : ''}` });
  }
  return out;
}

/**
 * @param {{ water: any, shore: any, terrain: any, camera: any, recipe: any, seed: number }} opts
 *   shore: world/water/shore-live.js; recipe: recipes/species/finds.json
 */
export function createFinds(opts) {
  const { water, shore, terrain, camera, recipe } = opts;
  const pass = createCreaturePass({ recipe });
  const K = recipe.kinds;
  bakeMeshes(pass, recipe);
  /** @type {any} */ let zonesSeen = null;
  /** @type {Record<string, number[]>} */ let cells = { anemone: [], periwinkle: [], lugworm: [] };
  /** @type {any} */ let rect = null;
  /** How open each anemone is, 0..1, eased. @type {Map<string, number>} */ const open = new Map();
  /** @type {{ sp: string, x: number, z: number }[]} */ let shown = [];
  let clock = 0;

  function refresh() {
    const z = shore.zones?.();
    const s = water.getSummary?.();
    if (!z || !s || z === zonesSeen) return;
    zonesSeen = z;
    rect = z.rect;
    const material = getStore('terrainLive')?.mirror?.material;
    const R = rect;
    cells = findCells(s, z, K, (k) => !!material && groundOfCell(material, R.x + (k % R.w), R.y + Math.floor(k / R.w)) === 2);
  }

  return {
    id: 'finds',
    pass,
    /** @param {import('../../sim/live-sim.js').FrameInfo} f */
    tick(f) {
      clock += f.realDt;
      if (clock < 0.2) return;
      const dt = clock;
      clock = 0;
      refresh();
      if (!rect) return;
      const t = camera.target, eye = camera.eye;
      const near2 = recipe.nearM * recipe.nearM;
      const tide = Math.floor((f.displayT / 3600) / 12);
      /** @type {{ b: any, d: number, sp: string }[]} */ const all = [];
      for (const kind of KINDS) {
        const R = K[kind];
        for (const k of cells[kind]) {
          const i = k % rect.w, j = (k - i) / rect.w;
          const cx = waterCellCenter(rect.x + i), cz = waterCellCenter(rect.y + j);
          const dx = cx - t[0], dz = cz - t[2];
          const d2 = dx * dx + dz * dz;
          if (d2 > near2) continue;
          for (const g of groupAt(opts.seed, kind, k, R, cx, cz, tide)) {
            const live = water.sampleLive(g.x, g.z);
            const depth = live?.depth ?? 0;
            // Casts lie on sand the sea has left; under water there is nothing to see of them.
            if (kind === 'lugworm' && depth > 0.005) continue;
            const y = terrain.sampleHeight(g.x, g.z);
            let mesh = kind, size = R.scale;
            if (kind === 'anemone') {
              const near = Math.hypot(eye[0] - g.x, eye[1] - y, eye[2] - g.z) < R.closeM;
              const want = depth > 0.02 && !near ? 1 : 0;
              const was = open.get(g.key) ?? want;
              const now = was + (want - was) * Math.min(1, dt / R.easeS);
              open.set(g.key, now);
              mesh = now > 0.5 ? 'anemone-open' : 'anemone-shut';
              size *= 0.92 + 0.08 * now;
            }
            all.push({ b: { x: g.x, y: y - 0.002, z: g.z, yaw: g.yaw, size: size * (0.85 + 0.3 * g.r), mesh }, d: d2, sp: kind });
          }
        }
      }
      all.sort((a, b) => a.d - b.d);
      const list = all.slice(0, recipe.max);
      shown = list.map((e) => ({ sp: e.sp, x: e.b.x, z: e.b.z }));
      pass.setBeings(list.map((e) => e.b));
      if (open.size > 4000) open.clear();
    },
    /**
     * The find nearest a tapped ground point, if one is close enough.
     * @param {number} x @param {number} z @returns {{ sp: string, x: number, z: number } | null}
     */
    findAt(x, z) {
      const r = recipe.tapM + recipe.tapPerM * (camera.distance ?? 10);
      let best = null, bestD = r * r;
      for (const f of shown) {
        const d = (f.x - x) * (f.x - x) + (f.z - z) * (f.z - z);
        if (d < bestD) { bestD = d; best = f; }
      }
      return best;
    },
    /** What is drawn now (tools and tests). */
    shown: () => shown,
    /** The reveal on return has nothing to hide: finds simply are where the ground says. */
    cellSize: WATER_CELL,
  };
}

/** Bake each kind's meshes once and hand them to the pass. @param {any} pass @param {any} recipe */
function bakeMeshes(pass, recipe) {
  const base = recipe.body;
  /** @param {string} key @param {any[]} prims @param {any} albedo @param {number} cellM */
  const add = (key, prims, albedo, cellM) => {
    const mesh = bakeBody({ ...base, prims, albedo: { back: albedo[Object.keys(albedo)[0]], ...albedo } }, cellM);
    pass.setMesh(key, { data: packMesh(mesh), indices: mesh.indices });
  };
  const A = recipe.kinds.anemone;
  // The open anemone: its column and disc, and a ring of tentacles leaning out from the disc's rim.
  const T = A.tentacles, rim = A.open[1].r[0] * 0.8, top = A.open[1].c[1];
  const tentacles = [];
  for (let i = 0; i < T.count; i++) {
    const a = (i / T.count) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    tentacles.push({ type: 'capsule', a: [ca * rim, top, sa * rim], b: [ca * (rim + T.lengthM * T.lean), top + T.lengthM * (1 - T.lean * 0.5), sa * (rim + T.lengthM * T.lean)],
      r: [T.radiusM, T.radiusM * 0.6], k: 0.0015, region: 'crown' });
  }
  add('anemone-open', [...A.open, ...tentacles], A.albedo, 0.0009);
  add('anemone-shut', A.shut, A.albedo, 0.0009);
  const P = recipe.kinds.periwinkle;
  add('periwinkle', P.prims, P.albedo, 0.0007);
  // A lugworm cast: a coil of sand, a tube winding up on itself.
  const C = recipe.kinds.lugworm.coil, coil = [];
  for (let s = 0; s < C.steps; s++) {
    const t0 = s / C.steps, t1 = (s + 1) / C.steps;
    const at = (/** @type {number} */ t) => {
      const a = t * C.turns * Math.PI * 2, r = C.radiusM * (1 - 0.55 * t);
      return [Math.cos(a) * r, C.tubeM * 0.6 + C.riseM * t, Math.sin(a) * r];
    };
    coil.push({ type: 'capsule', a: at(t0), b: at(t1), r: [C.tubeM, C.tubeM * 0.95], k: 0.0006, region: 'cast' });
  }
  add('lugworm', coil, recipe.kinds.lugworm.albedo, 0.0008);
}

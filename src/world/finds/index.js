// @ts-check
// Finds (docs/future/11): small shore lives with a body and one motion, found by tapping. Where they
// live comes from the ground: the shore zones (world/water/shore.js) and the water summary, so
// shaping the coast moves them and nothing is saved. Each 0.5 m cell of a kind's zones may hold a
// small group, decided by a seeded hash of the cell (and, for lugworm casts, of the tide), worked
// out only near the view's middle. Anemones live in rock pools, a hollow of rock in the tide band
// that holds water, and open under water and close at low tide or when you come close; periwinkles
// cluster on the wrack and drift a little each tide; lugworm casts are laid fresh after each tide on
// the sand the sea has left. Anemones and periwinkles are models (models.js) drawn by a creatures
// pass of their own, with no rig; casts are drawn into the sand by the terrain shader (lib-casts).

import { hash32 } from '../../core/rng.js';
import { WATER_CLASS } from '../water/summary.js';
import { WATER_CELL, waterCellCenter, waterCellOf } from '../water/grid.js';
import { strandLines } from '../water/strandline.js';
import { tideParams } from '../tide.js';
import { packMesh } from '../creatures/bodies.js';
import { createCreaturePass } from '../../render/passes/creatures.js';
import { groundOfCell } from '../water/shore.js';
import { get as getStore } from '../../core/store.js';
import { loadFindModel, joinParts } from './models.js';
import { loadRig, bones } from './rig.js';

// New kinds go at the end: a kind's place here salts where its groups fall.
const KINDS = /** @type {const} */ (['anemone', 'periwinkle', 'lugworm', 'hermitcrab', 'ediblecrab', 'shells']);
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
 * The shell (if any) one high tide's strandline left in one cell, and where in the cell. Pure: the
 * same seed, cell and tide give the same shell. Rare shells come only with tides near spring.
 * @param {number} seed @param {number} k cell @param {number} tideId which high water left the line
 * @param {number} spring how far that tide was toward spring, -1 neap .. 1 the highest spring
 * @param {any} S finds.json kinds.shells
 * @returns {{ item: string, ox: number, oz: number, yaw: number, r: number } | null} offsets in cells (-0.5..0.5)
 */
export function shellAt(seed, k, tideId, spring, S) {
  const h0 = hash32(seed, k, (KINDS.indexOf('shells') + 1) * 7919 + tideId * 131);
  if (u01(h0) >= S.density) return null;
  const pool = S.items.filter((/** @type {any} */ it) => spring >= (it.springMin ?? -Infinity));
  const total = pool.reduce((/** @type {number} */ s, /** @type {any} */ it) => s + it.weight, 0);
  let pick = u01(hash32(h0, 9)) * total;
  let item = pool[pool.length - 1];
  for (const it of pool) { pick -= it.weight; if (pick < 0) { item = it; break; } }
  return { item: item.id, ox: u01(hash32(h0, 2)) - 0.5, oz: u01(hash32(h0, 3)) - 0.5, yaw: u01(hash32(h0, 4)) * Math.PI * 2, r: u01(hash32(h0, 6)) };
}

/**
 * @param {{ water: any, shore: any, terrain: any, camera: any, recipe: any, seed: number, tide?: any }} opts
 *   shore: world/water/shore-live.js; recipe: recipes/species/finds.json; tide: water.json `tide`
 *   (the strandline that shells wash up on follows it)
 */
export function createFinds(opts) {
  const { water, shore, terrain, camera, recipe } = opts;
  // Room for the hermit crab's rig (28 bones).
  const pass = createCreaturePass({ recipe, maxBones: 32 });
  const K = recipe.kinds;
  const tideP = tideParams(opts.tide);
  // The meshes arrive a moment after boot; until then nothing is drawn (casts need none).
  let ready = false;
  /** Rigged finds by kind (rig.js), posed each frame while they walk. @type {Record<string, import('./rig.js').Rig>} */
  let rigs = {};
  loadModels(pass, recipe).then((r) => { rigs = r; ready = true; }).catch((e) => console.warn('finds: models did not load', e));
  /** The casts near the view for the terrain pass: (x, z, size, yaw), ending at size 0. */
  const casts = new Float32Array(64);
  const castMax = 16;
  /** @type {any} */ let zonesSeen = null;
  /** @type {Record<string, number[]>} */ let cells = Object.fromEntries(KINDS.map((k) => [k, []]));
  /** @type {any} */ let rect = null;
  /** How open each anemone is, 0..1, eased. @type {Map<string, number>} */ const open = new Map();
  /** The crabs' moves: a hermit crab's walking clock (s), an edible crab's eased offset (m). @type {Map<string, any>} */
  const moves = new Map();
  /** @type {{ sp: string, x: number, z: number, item: string | null }[]} */ let shown = [];
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

  /**
   * What is near the view now, nearest first: each find's drawing (b) and, for the crabs, their
   * spot and recipe so stepCrabs can move them between scans.
   * @type {{ b: any, d: number, sp: string, g: any, R: any, depth: number }[]}
   */
  let list = [];
  /** What the last scan saw of the strandline (tools). */
  let shellCount = { lines: 0, band: 0, placed: 0 };

  /** Work out the finds near the view. @param {import('../../sim/live-sim.js').FrameInfo} f @param {number} dt */
  function scan(f, dt) {
    refresh();
    if (!rect) return;
    const t = camera.target, eye = camera.eye;
    const near2 = recipe.nearM * recipe.nearM;
    const tide = Math.floor((f.displayT / 3600) / 12);
    /** @type {typeof list} */ const all = [];
    for (const kind of KINDS) {
      const R = K[kind];
      for (const k of cells[kind]) {
        const i = k % rect.w, j = (k - i) / rect.w;
        const cx = waterCellCenter(rect.x + i), cz = waterCellCenter(rect.y + j);
        const dx = cx - t[0], dz = cz - t[2];
        const d2 = dx * dx + dz * dz;
        if (d2 > near2) continue;
        for (const g of groupAt(opts.seed, kind, k, R, cx, cz, tide)) {
          const depth = water.sampleLive(g.x, g.z)?.depth ?? 0;
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
          size *= 0.85 + 0.3 * g.r;
          all.push({ b: { x: g.x, y: y - 0.002 - (R.model?.buryM ?? 0) * size, z: g.z, yaw: g.yaw, size, mesh }, d: d2, sp: kind, g, R, depth });
        }
      }
    }
    shells(f, all);
    all.sort((a, b) => a.d - b.d);
    list = all.slice(0, recipe.max);
    // Casts are drawn into the sand by the terrain pass; the rest are meshes.
    casts.fill(0);
    let c = 0;
    for (const e of list) {
      if (e.sp !== 'lugworm' || c >= castMax) continue;
      casts.set([e.b.x, e.b.z, e.b.size, e.b.yaw], c * 4);
      c++;
    }
    stepCrabs(0);
    if (open.size > 4000) open.clear();
    if (moves.size > 4000) moves.clear();
  }

  /**
   * Shells on the strandlines near the view: where each recent high tide's waves reached, a cell
   * may hold a shell that tide left (shellAt). Under water there is none to see.
   * @param {import('../../sim/live-sim.js').FrameInfo} f @param {typeof list} all
   */
  function shells(f, all) {
    const S = K.shells, L = shore.recipe?.look?.strandline;
    shellCount = { lines: 0, band: 0, placed: 0 };
    if (!S || !L || !rect) return;
    const nowH = f.displayT / 3600;
    const lines = strandLines(nowH, tideP, L);
    shellCount.lines = lines.levels.length;
    if (!lines.levels.length) return;
    const t = camera.target, near = recipe.nearM;
    const i0 = Math.max(0, waterCellOf(t[0] - near) - rect.x), i1 = Math.min(rect.w - 1, waterCellOf(t[0] + near) - rect.x);
    const j0 = Math.max(0, waterCellOf(t[2] - near) - rect.y), j1 = Math.min(rect.h - 1, waterCellOf(t[2] + near) - rect.y);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = waterCellCenter(rect.x + i), cz = waterCellCenter(rect.y + j);
      const dx = cx - t[0], dz = cz - t[2], d2 = dx * dx + dz * dz;
      if (d2 > near * near) continue;
      const y = terrain.sampleHeight(cx, cz);
      for (let n = 0; n < lines.levels.length; n++) {
        if (Math.abs(y - lines.levels[n] - L.runupM) > S.lineToleranceM) continue;
        shellCount.band++;
        const tideId = Math.round((nowH - lines.ages[n] - tideP.phaseH) / tideP.periodH);
        const spring = (lines.levels[n] / tideP.amplitudeM - 1) / tideP.springNeap;
        const k = j * rect.w + i;
        const s = shellAt(opts.seed, k, tideId, spring, S);
        if (!s) break;
        const x = cx + s.ox * WATER_CELL, z = cz + s.oz * WATER_CELL;
        if ((water.sampleLive(x, z)?.depth ?? 0) > 0.005) break;
        shellCount.placed++;
        const size = S.scale * (0.85 + 0.3 * s.r);
        all.push({ b: { x, y: terrain.sampleHeight(x, z) - 0.001, z, yaw: s.yaw, size, mesh: `shells-${s.item}` }, d: d2, sp: 'shells', g: { key: `shells:${k}:${tideId}` }, R: S, depth: 0, item: s.item });
        break;
      }
    }
  }

  /**
   * Move the crabs by dt seconds. A hermit crab picks about its pool under water, a slow wander
   * about its spot, and keeps still out of the water or with you close; an edible crab runs
   * sideways away from you, and back to its spot once you leave.
   * @param {number} dt
   */
  function stepCrabs(dt) {
    const eye = camera.eye;
    for (const e of list) {
      if (e.sp !== 'hermitcrab' && e.sp !== 'ediblecrab') continue;
      const { g, R, b } = e;
      const m = moves.get(g.key) ?? { clock: 0, ox: 0, oz: 0, yaw: g.yaw, walking: false };
      const near = Math.hypot(eye[0] - (g.x + m.ox), eye[2] - (g.z + m.oz));
      if (e.sp === 'hermitcrab') {
        const C = R.creep;
        m.walking = e.depth > 0.02 && near > C.stillNearM;
        if (m.walking) m.clock += dt;
        const w = C.speedMps / C.rangeM, ph = g.r * 40;
        m.ox = C.rangeM * Math.sin(w * m.clock + ph);
        m.oz = C.rangeM * Math.sin(0.7 * w * m.clock + ph * 1.3);
        m.yaw = Math.atan2(Math.cos(w * m.clock + ph), 0.7 * Math.cos(0.7 * w * m.clock + ph * 1.3));
      } else {
        const S = R.scuttle;
        let tx = 0, tz = 0;
        if (near < S.nearM) {
          const ax = g.x + m.ox - eye[0], az = g.z + m.oz - eye[2], l = Math.hypot(ax, az) || 1;
          tx = (ax / l) * S.awayM; tz = (az / l) * S.awayM;
        }
        const k2 = Math.min(1, dt / (near < S.nearM ? S.easeS : S.easeS * 8));
        const px = m.ox, pz = m.oz;
        m.ox += (tx - m.ox) * k2; m.oz += (tz - m.oz) * k2;
        // Crabs walk sideways: face across the way it runs.
        const vx = m.ox - px, vz = m.oz - pz;
        m.walking = Math.hypot(vx, vz) > 1e-4;
        if (m.walking) m.yaw = Math.atan2(vx, vz) + Math.PI / 2;
      }
      // A rigged crab plays its walk while it moves and holds the last step while it waits.
      const rig = rigs[e.sp];
      if (rig) {
        if (m.walking) m.anim = (m.anim ?? g.r * rig.duration) + dt * (R.model.playRate ?? 1);
        b.bones = bones(rig, m.anim ?? g.r * rig.duration, m.pose);
        m.pose = b.bones;
      }
      moves.set(g.key, m);
      b.x = g.x + m.ox; b.z = g.z + m.oz;
      b.y = terrain.sampleHeight(b.x, b.z) - 0.002;
      b.yaw = m.yaw + ((R.model?.yawDeg ?? 0) * Math.PI) / 180;
    }
    shown = list.map((e) => ({ sp: e.sp, x: e.b.x, z: e.b.z, item: e.item ?? null }));
  }

  return {
    id: 'finds',
    pass,
    /** @param {import('../../sim/live-sim.js').FrameInfo} f */
    tick(f) {
      // The crabs move every frame; the rest is worked out a few times a second.
      clock += f.realDt;
      if (clock >= 0.2) { scan(f, clock); clock = 0; }
      if (!rect) return;
      stepCrabs(f.realDt);
      pass.setBeings(ready ? list.filter((e) => e.sp !== 'lugworm').map((e) => e.b) : []);
    },
    /**
     * The find nearest a tapped ground point, if one is close enough.
     * @param {number} x @param {number} z @returns {{ sp: string, x: number, z: number, item: string | null } | null} item: which shell, for shells
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
    /** Strandline lines, cells on them, and shells placed at the last look (tools). */
    shellCount: () => ({ ...shellCount, rect: !!rect, cells: Object.fromEntries(KINDS.map((k) => [k, cells[k].length])), list: list.length }),
    /** The casts near the view for the terrain pass (render/passes/terrain.js setCasts). */
    casts: () => casts,
    /** The casts' shape for the terrain pass (finds.json lugworm.cast). */
    castShape: recipe.kinds.lugworm.cast,
    /** The reveal on return has nothing to hide: finds simply are where the ground says. */
    cellSize: WATER_CELL,
  };
}

/**
 * Bring in the modeled anemone and periwinkle once their files arrive (assets/models/finds/). The
 * anemone's shut pose is the same model with its tentacles drawn down into the column.
 * @param {any} pass @param {any} recipe
 */
async function loadModels(pass, recipe) {
  const put = (/** @type {string} */ key, /** @type {any} */ mesh) => pass.setMesh(key, { data: packMesh(mesh), indices: mesh.indices });
  const A = recipe.kinds.anemone.model;
  // Every other kind with a model is one mesh under its own name; a rigged one keeps its skin.
  const others = KINDS.filter((k) => k !== 'anemone' && recipe.kinds[k].model && !recipe.kinds[k].model.rigged);
  const rigged = KINDS.filter((k) => recipe.kinds[k].model?.rigged);
  const [anemone, ...parts] = await Promise.all([loadFindModel(A.url), ...others.map((k) => loadFindModel(recipe.kinds[k].model.url))]);
  others.forEach((k, i) => { const M = recipe.kinds[k].model; put(k, joinParts(parts[i], M.heightM, M.rotDeg, (p) => p, M.tint)); });
  // Shells: one mesh per item, under shells-<id>.
  const items = recipe.kinds.shells?.items ?? [];
  const shellParts = await Promise.all(items.map((/** @type {any} */ it) => loadFindModel(it.model.url)));
  items.forEach((/** @type {any} */ it, /** @type {number} */ i) => put(`shells-${it.id}`, joinParts(shellParts[i], it.model.heightM, it.model.rotDeg, (p) => p, it.model.tint)));
  /** @type {Record<string, import('./rig.js').Rig>} */ const rigs = {};
  for (const k of rigged) {
    const M = recipe.kinds[k].model;
    const rig = await loadRig(M.url, M.heightM, M.rotDeg);
    pass.setMesh(k, { data: packMesh(rig, rig.joints, rig.weights), indices: rig.indices });
    rigs[k] = rig;
  }
  put('anemone-open', joinParts(anemone, A.heightM, A.rotDeg, (p) => p, A.tint));
  // Shut: the column sinks and widens a little; the tentacles fold in to a bud at its top.
  let top = 0;
  const body = anemone[A.bodyPart];
  for (let i = 0; i < body.count; i++) top = Math.max(top, body.vertices[i * 9 + 1]);
  const S = A.shut;
  put('anemone-shut', joinParts(anemone, A.heightM, A.rotDeg, (p, part) => shutAnemone(p, part, A.bodyPart, top, S), A.tint));
  return rigs;
}

/**
 * The anemone shut: the column sinks and its rim draws in to a dome; the tentacles fold down to a
 * bud at its top. Pure (tools/finds-models.html shows it too).
 * @param {number[]} p a vertex, in model units @param {number} part @param {number} bodyPart
 * @param {number} top the column's top @param {{ sink: number, widen: number, fold: number, close: number }} S
 */
export function shutAnemone(p, part, bodyPart, top, S) {
  if (part === bodyPart) {
    const t = Math.max(0, Math.min(1, p[1] / top));
    const r = S.widen * (1 - S.close * t * t);
    return [p[0] * r, p[1] * S.sink, p[2] * r];
  }
  const r = S.fold * (1 - S.close);
  return [p[0] * r, top * S.sink + (p[1] - top) * S.fold, p[2] * r];
}

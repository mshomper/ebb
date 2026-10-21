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
// Acorn barnacles crust the upper rock of the band and open and shut like the anemones; pond
// skaters glide on still fresh water by day. Both are built in procedural.js, with no model file.
// Common mussels clump on the low rock and gape under water, one valve mirrored into the hinged
// pair (mussel.js); sand dollars lie half buried on the low sand. The strandline follows the year
// (strand.js): summer tides strand moon jellyfish, clear and drawn by a pass of their own
// (jelly.js), and a winter storm tide leaves the rarer shells along its line.

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
import { legRig, legBones } from './leg-rig.js';
import { proceduralMeshes } from './procedural.js';
import { musselPair, musselBones } from './mussel.js';
import { jellyMesh } from './jelly.js';
import { jellyAt, isStormTide, seasonOfTide, weatherOfTide } from './strand.js';
import { createJellyPass } from '../../render/passes/jelly.js';

// New kinds go at the end: a kind's place here salts where its groups fall.
const KINDS = /** @type {const} */ (['anemone', 'periwinkle', 'lugworm', 'hermitcrab', 'ediblecrab', 'shells', 'barnacles', 'pondskaters', 'mussels', 'sanddollars']);
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
  const pools = poolCells(s, z, rockAt);
  const ponds = pondCells(s);
  for (let k = 0; k < z.zone.length; k++) {
    const v = z.zone[k];
    const zid = v ? z.ids[v - 1] : null;
    const pool = pools[k] === 1, pond = ponds[k] === 1;
    if (!zid && !pool && !pond) continue;
    for (const id of KINDS) {
      const zones = kinds[id]?.zones ?? [];
      if ((zid && zones.includes(zid)) || (pool && zones.includes('pool')) || (pond && zones.includes('pond'))) out[id].push(k);
    }
  }
  return out;
}

/**
 * The pond cells: 1 where a cell holds still fresh water, off the tide band and not in any hollow
 * that reaches it (so never a rock pool, even its deep floor) and never the sea.
 * @param {{ cls: Uint8Array, basin: Uint16Array, band: Uint8Array }} s the water summary
 */
export function pondCells(s) {
  const tidal = new Set();
  for (let k = 0; k < s.basin.length; k++) if (s.basin[k] && s.band[k]) tidal.add(s.basin[k]);
  const out = new Uint8Array(s.cls.length);
  for (let k = 0; k < s.cls.length; k++) {
    if (s.cls[k] === WATER_CLASS.still && !s.band[k] && !(s.basin[k] && tidal.has(s.basin[k]))) out[k] = 1;
  }
  return out;
}

/**
 * The rock pool cells: 1 where a cell is the floor of a rock pool, a hollow (a basin) of rock that
 * reaches into the tide band, so the sea fills it at high water and leaves it full at low; its floor
 * may lie deeper than the band. The journal's Web reads these too (journal/shore-presence.js).
 * @param {{ cls: Uint8Array, basin: Uint16Array, band: Uint8Array }} s the water summary
 * @param {{ zone: Uint8Array, ids: string[] }} z the shore zones
 * @param {(k: number) => boolean} [rockAt] is the cell painted rock
 */
export function poolCells(s, z, rockAt = () => true) {
  const tidal = new Set();
  for (let k = 0; k < s.basin.length; k++) if (s.basin[k] && s.band[k]) tidal.add(s.basin[k]);
  const out = new Uint8Array(z.zone.length);
  for (let k = 0; k < z.zone.length; k++) {
    if (!s.basin[k] || !tidal.has(s.basin[k]) || (s.cls[k] !== WATER_CLASS.still && s.cls[k] !== WATER_CLASS.damp)) continue;
    const v = z.zone[k];
    const zid = v ? z.ids[v - 1] : null;
    if (zid ? ROCK_ZONES.includes(zid) : rockAt(k)) out[k] = 1;
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
 * same seed, cell and tide give the same shell. Rare shells come only with tides near spring; a
 * winter storm tide (strand.js isStormTide) throws up more shells, and far more of the rare ones.
 * @param {number} seed @param {number} k cell @param {number} tideId which high water left the line
 * @param {number} spring how far that tide was toward spring, -1 neap .. 1 the highest spring
 * @param {any} S finds.json kinds.shells
 * @param {boolean} [storm] was that tide a storm tide
 * @returns {{ item: string, ox: number, oz: number, yaw: number, r: number, storm: boolean } | null} offsets in cells (-0.5..0.5)
 */
export function shellAt(seed, k, tideId, spring, S, storm = false) {
  const St = storm ? S.storm : null;
  const h0 = hash32(seed, k, (KINDS.indexOf('shells') + 1) * 7919 + tideId * 131);
  if (u01(h0) >= S.density * (St?.densityBoost ?? 1)) return null;
  const pool = S.items.filter((/** @type {any} */ it) => spring >= (it.springMin ?? -Infinity));
  const weight = (/** @type {any} */ it) => it.weight * (St && it.springMin !== undefined ? St.rareBoost : 1);
  const total = pool.reduce((/** @type {number} */ s, /** @type {any} */ it) => s + weight(it), 0);
  let pick = u01(hash32(h0, 9)) * total;
  let item = pool[pool.length - 1];
  for (const it of pool) { pick -= weight(it); if (pick < 0) { item = it; break; } }
  return { item: item.id, ox: u01(hash32(h0, 2)) - 0.5, oz: u01(hash32(h0, 3)) - 0.5, yaw: u01(hash32(h0, 4)) * Math.PI * 2, r: u01(hash32(h0, 6)), storm: !!St };
}

/**
 * @param {{ water: any, shore: any, terrain: any, camera: any, recipe: any, seed: number, tide?: any, shellsOn?: () => boolean,
 *   weather?: () => { weatherSeed: number, weather: any, state?: any } }} opts
 *   shore: world/water/shore-live.js; recipe: recipes/species/finds.json; tide: water.json `tide`
 *   (the strandline that shells wash up on follows it); shellsOn: whether the sea leaves shells yet;
 *   weather: the weather seed, seasons.json `weather` and the world's weather state (storm tides)
 */
export function createFinds(opts) {
  const { water, shore, terrain, camera, recipe } = opts;
  // Room for the hermit crab's rig (28 bones).
  const pass = createCreaturePass({ recipe, maxBones: 32 });
  const K = recipe.kinds;
  const tideP = tideParams(opts.tide);
  // Moon jellyfish are clear, so they have a translucent pass of their own, built from shape.
  const J = K.moonjelly;
  const jellyPass = J ? createJellyPass({ look: J.look }) : null;
  if (J && jellyPass) for (let v = 0; v < J.variants; v++) jellyPass.setMesh(`moonjelly-${v}`, jellyMesh(J.shape, v));
  /**
   * Testing (`?debug`, window.ebb.finds.force): a season for every line, a storm on every tide,
   * and lines thick with what they leave. null keeps the world's own.
   * @type {{ season: number | null, storm: boolean | null, dense: boolean }}
   */
  const force = { season: null, storm: null, dense: false };
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
  /** @type {{ sp: string, x: number, z: number, item: string | null, storm: boolean }[]} */ let shown = [];
  /** Finds drawn elsewhere that a tap may land on (addSource). @type {(() => { sp: string, x: number, z: number, item: string | null, reach?: number }[])[]} */
  const sources = [];
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
  let shellCount = { lines: 0, band: 0, placed: 0, jellies: 0, storms: 0 };

  /** Work out the finds near the view. @param {import('../../sim/live-sim.js').FrameInfo} f @param {number} dt */
  function scan(f, dt) {
    refresh();
    if (!rect) return;
    const t = camera.target, eye = camera.eye;
    const near2 = recipe.nearM * recipe.nearM;
    const tide = Math.floor((f.displayT / 3600) / 12);
    const hour = (((f.displayT / 3600) % 24) + 24) % 24;
    /** @type {typeof list} */ const all = [];
    for (const kind of KINDS) {
      const R = K[kind];
      if (!R) continue;
      // Some come out only in their hours of the day (pond skaters by day).
      if (R.hours && (hour < R.hours[0] || hour >= R.hours[1])) continue;
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
          // Pond skaters stand on the water, so only where there is some.
          if (kind === 'pondskaters' && depth <= R.minDepthM) continue;
          const y = terrain.sampleHeight(g.x, g.z);
          let mesh = kind, size = R.scale;
          /** @type {Float32Array | undefined} */ let pose;
          if (kind === 'anemone' || kind === 'barnacles' || kind === 'mussels') {
            const near = Math.hypot(eye[0] - g.x, eye[1] - y, eye[2] - g.z) < R.closeM;
            const want = depth > 0.02 && !near ? 1 : 0;
            const was = open.get(g.key) ?? want;
            const now = was + (want - was) * Math.min(1, dt / R.easeS);
            open.set(g.key, now);
            // A mussel's upper valve turns about the hinge (mussel.js); the others swap pose.
            if (kind === 'mussels') pose = rigs.mussels ? musselBones(/** @type {any} */ (rigs.mussels).hinge, (now * R.model.gapeDeg * Math.PI) / 180) : undefined;
            else mesh = now > 0.5 ? `${kind}-open` : `${kind}-shut`;
            if (kind === 'anemone') size *= 0.92 + 0.08 * now;
          }
          size *= 0.85 + 0.3 * g.r;
          const base = kind === 'pondskaters' ? y + depth + R.liftM : y - 0.002 - (R.model?.buryM ?? R.buryM ?? 0) * size;
          all.push({ b: { x: g.x, y: base, z: g.z, yaw: g.yaw, size, mesh, ...(pose ? { bones: pose } : {}) }, d: d2, sp: kind, g, R, depth });
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
    shellCount = { lines: 0, band: 0, placed: 0, jellies: 0, storms: 0 };
    // Shells wash up once the naturalist's notes have given them (world/expansion.js); moon
    // jellyfish strand in summer whatever the notes say, as the sea brings them.
    const shellsOn = !!S && (!opts.shellsOn || opts.shellsOn());
    if (!L || !rect || (!shellsOn && !J)) return;
    const nowH = f.displayT / 3600;
    const lines = strandLines(nowH, tideP, L);
    shellCount.lines = lines.levels.length;
    if (!lines.levels.length) return;
    // Each line's tide: which high water, how near spring, its season, and whether it was a storm.
    const W = opts.weather?.();
    const info = lines.levels.map((lvl, n) => {
      const tideId = Math.round((nowH - lines.ages[n] - tideP.phaseH) / tideP.periodH);
      const tideH = tideP.phaseH + tideId * tideP.periodH;
      const spring = (lvl / tideP.amplitudeM - 1) / tideP.springNeap;
      const season = force.season ?? seasonOfTide(tideH);
      const day = W ? weatherOfTide(tideH, W) : null;
      const storm = force.storm ?? (!!S?.storm && !!day && isStormTide(tideH, spring, { season, mood: day.mood, windStrength: day.windStrength }, S.storm));
      if (storm) shellCount.storms++;
      return { tideId, spring, season, storm, ageH: lines.ages[n] };
    });
    const Sd = S && force.dense ? { ...S, density: 0.3 } : S;
    const Jd = J && force.dense ? { ...J, density: 0.25 } : J;
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
        const { tideId, spring, storm } = info[n];
        const k = j * rect.w + i;
        const s = shellsOn ? shellAt(opts.seed, k, tideId, spring, Sd, storm) : null;
        if (s) {
          const x = cx + s.ox * WATER_CELL, z = cz + s.oz * WATER_CELL;
          if ((water.sampleLive(x, z)?.depth ?? 0) > 0.005) break;
          shellCount.placed++;
          const size = S.scale * (0.85 + 0.3 * s.r);
          all.push({ b: { x, y: terrain.sampleHeight(x, z) - 0.001, z, yaw: s.yaw, size, mesh: `shells-${s.item}` }, d: d2, sp: 'shells', g: { key: `shells:${k}:${tideId}` }, R: S, depth: 0, item: s.item, storm: s.storm });
          break;
        }
        // No shell here: a summer tide may have left a moon jellyfish instead.
        const jl = Jd ? jellyAt(opts.seed, k, tideId, info[n], Jd) : null;
        if (!jl) break;
        const x = cx + jl.ox * WATER_CELL, z = cz + jl.oz * WATER_CELL;
        if ((water.sampleLive(x, z)?.depth ?? 0) > 0.005) break;
        shellCount.jellies++;
        const v = Math.floor(jl.r * J.variants) % J.variants;
        all.push({ b: { x, y: terrain.sampleHeight(x, z) - 0.001, z, yaw: jl.yaw, size: jl.size, mesh: `moonjelly-${v}` }, d: d2, sp: 'moonjelly', g: { key: `moonjelly:${k}:${tideId}` }, R: J, depth: 0 });
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
      if (e.sp === 'pondskaters') { glide(e, dt); continue; }
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
      // A rigged crab steps while it moves (the gait, rig.js) and holds its last step while it waits.
      const rig = rigs[e.sp];
      if (rig?.legs) {
        // Legs step fast while it runs, and now and then twitch while it sits.
        const G = R.model.legs;
        m.step = (m.step ?? g.r * 6.283) + dt * 2 * Math.PI * (m.walking ? G.stepHz : G.idleHz);
        b.bones = legBones(rig.legs, m.step, m.walking ? G : { ...G, liftDeg: G.liftDeg * G.idleShare, sweepDeg: G.sweepDeg * G.idleShare }, m.pose);
        m.pose = b.bones;
      } else if (rig) {
        rig.gaitScale = R.creep?.gaitScale ?? 1;
        if (m.walking) m.step = (m.step ?? g.r * 6.283) + dt * 2 * Math.PI * (R.creep?.stepHz ?? 2);
        b.bones = bones(rig, -1, m.pose, m.step ?? g.r * 6.283);
        m.pose = b.bones;
      }
      moves.set(g.key, m);
      b.x = g.x + m.ox; b.z = g.z + m.oz;
      b.y = terrain.sampleHeight(b.x, b.z) - 0.002;
      b.yaw = m.yaw + ((R.model?.yawDeg ?? 0) * Math.PI) / 180;
    }
    shown = list.map((e) => ({ sp: e.sp, x: e.b.x, z: e.b.z, item: e.item ?? null, storm: !!e.storm }));
  }

  /**
   * Move a pond skater by dt seconds: a short dart in a seeded direction, a rest, another dart,
   * turning back toward its spot once it strays; when you come close it darts away from you.
   * @param {(typeof list)[number]} e @param {number} dt
   */
  function glide(e, dt) {
    const { g, R, b } = e, G = R.glide, eye = camera.eye;
    const seed = Math.floor(g.r * 16777216);
    const m = moves.get(g.key) ?? { ox: 0, oz: 0, yaw: g.yaw, fx: 0, fz: 0, tx: 0, tz: 0, t: 0, len: 0, rest: u01(hash32(seed, 0)) * G.pauseS[1], n: 0, fleeing: false };
    const x = g.x + m.ox, z = g.z + m.oz;
    const near = Math.hypot(eye[0] - x, eye[2] - z) < G.nearM;
    if (!near) m.fleeing = false;
    m.t += dt;
    const darting = m.t < m.len;
    /** Set off toward an offset from the spot (back toward the spot if that is dry). @param {number} tx @param {number} tz @param {number} s */
    const dart = (tx, tz, s) => {
      const far = Math.hypot(tx, tz), most = G.rangeM + G.fleeM;
      if (far > most) { tx *= most / far; tz *= most / far; }
      if ((water.sampleLive(g.x + tx, g.z + tz)?.depth ?? 0) <= R.minDepthM) { tx = m.ox * 0.3; tz = m.oz * 0.3; }
      Object.assign(m, { fx: m.ox, fz: m.oz, tx, tz, t: 0, len: s });
      if (Math.hypot(tx - m.ox, tz - m.oz) > 1e-4) m.yaw = Math.atan2(tx - m.ox, tz - m.oz);
    };
    if (near && (!m.fleeing || !darting)) {
      // Away from you, at once.
      const ax = x - eye[0], az = z - eye[2], l = Math.hypot(ax, az) || 1;
      dart(m.ox + (ax / l) * G.fleeM, m.oz + (az / l) * G.fleeM, G.fleeS);
      m.fleeing = true;
      m.rest = G.pauseS[0];
    } else if (!darting && m.t >= m.len + m.rest) {
      m.n++;
      const h = hash32(seed, m.n);
      let a = u01(h) * Math.PI * 2;
      // Strayed far from its spot: head back that way, give or take.
      if (Math.hypot(m.ox, m.oz) > G.rangeM * 0.6) a = Math.atan2(-m.oz, -m.ox) + (u01(hash32(h, 2)) - 0.5) * 1.2;
      const d = G.dartM * (0.5 + u01(hash32(h, 1)));
      dart(m.ox + Math.cos(a) * d, m.oz + Math.sin(a) * d, G.dartS);
      m.rest = G.pauseS[0] + u01(hash32(h, 3)) * (G.pauseS[1] - G.pauseS[0]);
    }
    // A dart starts fast and slows to a glide.
    const k = m.len > 0 ? Math.min(1, m.t / m.len) : 1, s = 1 - (1 - k) * (1 - k);
    m.ox = m.fx + (m.tx - m.fx) * s;
    m.oz = m.fz + (m.tz - m.fz) * s;
    moves.set(g.key, m);
    b.x = g.x + m.ox; b.z = g.z + m.oz;
    b.y = terrain.sampleHeight(b.x, b.z) + (water.sampleLive(b.x, b.z)?.depth ?? 0) + R.liftM;
    b.yaw = m.yaw;
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
      pass.setBeings(ready ? list.filter((e) => e.sp !== 'lugworm' && e.sp !== 'moonjelly').map((e) => e.b) : []);
      jellyPass?.setBeings(list.filter((e) => e.sp === 'moonjelly').map((e) => e.b));
    },
    /** The moon jellyfish's translucent pass, for the frame graph (after the opaque finds). */
    jellyPass,
    /**
     * Testing (`?debug`): force every strandline's season (0 spring .. 3 winter), a storm on every
     * tide, and lines thick with shells and jellyfish; null keeps the world's own.
     * @param {{ season?: number | null, storm?: boolean | null, dense?: boolean }} o
     */
    force(o) { Object.assign(force, o); return { ...force }; },
    /**
     * The find nearest a tapped ground point, if one is close enough.
     * @param {number} x @param {number} z @returns {{ sp: string, x: number, z: number, item: string | null, storm: boolean } | null}
     *   item: which shell, for shells; storm: a shell a winter storm tide left
     */
    findAt(x, z) {
      const r = recipe.tapM + recipe.tapPerM * (camera.distance ?? 10);
      let best = null, bestD = Infinity;
      // The finds shown here, then any from elsewhere (autumn's fungi and webs, autumn-live.js), each
      // within the tap's reach or its own, whichever is more.
      for (const f of [...shown, ...sources.flatMap((s) => s())]) {
        const d = (f.x - x) * (f.x - x) + (f.z - z) * (f.z - z);
        const reach = Math.max(r, /** @type {any} */ (f).reach ?? 0);
        if (d < reach * reach && d < bestD) { bestD = d; best = { sp: f.sp, x: f.x, z: f.z, item: f.item ?? null, storm: !!(/** @type {any} */ (f).storm) }; }
      }
      return best;
    },
    /**
     * Finds drawn elsewhere that a tap may land on too (autumn-live.js shown).
     * @param {() => { sp: string, x: number, z: number, item: string | null, reach?: number }[]} s
     */
    addSource(s) { sources.push(s); },
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
  // Barnacles and pond skaters are built here, with no file to wait for.
  for (const [key, mesh] of Object.entries(proceduralMeshes(recipe))) put(key, mesh);
  const A = recipe.kinds.anemone.model;
  // Every other kind with a model is one mesh under its own name; a rigged one keeps its skin.
  const others = KINDS.filter((k) => k !== 'anemone' && recipe.kinds[k].model && !recipe.kinds[k].model.rigged);
  const rigged = KINDS.filter((k) => recipe.kinds[k].model?.rigged);
  const [anemone, ...parts] = await Promise.all([loadFindModel(A.url), ...others.map((k) => loadFindModel(recipe.kinds[k].model.url))]);
  /** @type {Record<string, any>} rig.js rigs, or leg-rig.js legs (as { legs }) */ const rigs = {};
  others.forEach((k, i) => {
    const M = recipe.kinds[k].model;
    const mesh = joinParts(parts[i], M.heightM, M.rotDeg, (p) => p, M.tint);
    // A mussel's model is one valve: mirrored into the pair, the upper valve on its own bone.
    if (M.pair) {
      const pr = musselPair(mesh);
      pass.setMesh(k, { data: packMesh(pr.mesh, pr.joints, pr.weights), indices: pr.mesh.indices });
      rigs[k] = { hinge: pr.hinge };
    // A model with no skeleton but legs (the edible crab) is given leg bones by where its legs are.
    } else if (M.legs) {
      const lr = legRig(mesh, M.legs);
      pass.setMesh(k, { data: packMesh(mesh, lr.joints, lr.weights), indices: mesh.indices });
      rigs[k] = { legs: lr };
    } else put(k, M.petals ? petalShade(mesh, M.petals) : mesh);
  });
  // Shells: one mesh per item, under shells-<id>.
  const items = recipe.kinds.shells?.items ?? [];
  const shellParts = await Promise.all(items.map((/** @type {any} */ it) => loadFindModel(it.model.url)));
  items.forEach((/** @type {any} */ it, /** @type {number} */ i) => put(`shells-${it.id}`, joinParts(shellParts[i], it.model.heightM, it.model.rotDeg, (p) => p, it.model.tint)));
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
 * The sand dollar's five petals, painted into its colors: the scan's relief is too fine to show
 * them at this size, so the petal shapes on its back are made paler (by lift), as on the living one.
 * Pure; returns the mesh with its colors changed.
 * @param {{ vertices: Float32Array, count: number, indices: Uint32Array }} mesh
 * @param {{ lift: number, from: number, to: number, width: number }} P from, to: where a petal starts and
 *   ends, as a share of the radius; width: its widest half-width, as a share of the radius
 */
export function petalShade(mesh, P) {
  const V = mesh.vertices;
  let cx = 0, cz = 0, r = 0;
  for (let i = 0; i < mesh.count; i++) { cx += V[i * 9] / mesh.count; cz += V[i * 9 + 2] / mesh.count; }
  for (let i = 0; i < mesh.count; i++) r = Math.max(r, Math.hypot(V[i * 9] - cx, V[i * 9 + 2] - cz));
  for (let i = 0; i < mesh.count; i++) {
    const x = V[i * 9] - cx, z = V[i * 9 + 2] - cz, d = Math.hypot(x, z) / r;
    // The angle from the nearest petal's middle line (five, 72 degrees apart).
    const a = Math.atan2(z, x), step = (2 * Math.PI) / 5;
    const off = a - Math.round(a / step) * step;
    const t = (d - P.from) / (P.to - P.from);
    if (t <= 0 || t >= 1) continue;
    const half = P.width * Math.sin(Math.PI * t);
    if (Math.abs(Math.sin(off) * d) > half) continue;
    for (let k = 6; k < 9; k++) V[i * 9 + k] = Math.min(1, V[i * 9 + k] * P.lift);
  }
  return mesh;
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

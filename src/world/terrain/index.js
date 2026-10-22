// @ts-check
// The terrain system (docs/08): heightfield, sculpt and paint strokes, erosion-lite at stroke
// end, and undo tiles. Strokes run on the GPU; at stroke end the exact result is read back,
// quantized into the CPU mirror (the saved truth) and written back so GPU and mirror agree.

import { emitDeferred } from '../../core/events.js';
import { get as getStore, update as updateStore } from '../../core/store.js';
import { CELL, CHUNK_CELLS, WORLD_CELLS as N, WORLD_ORIGIN, quantize, dequantize, chunkKey, chunkFirstCell } from './grid.js';
import {
  createMirror, createTextures, uploadRect, syncFloat,
  sampleHeight, sampleNormal, sampleMaterial, raycast,
} from './heightfield.js';
import { createChunkTable, buildBases, pasteChunk } from './chunks.js';
import { createBrushGpu, circleRect, frameAmount, applyStampCpu, LAYER_INDEX, CLIFF_MODE } from './brushes.js';
import { cliffLevel, createCliffChunks } from './cliff.js';
import { createErosionGpu, encodeReadback } from './erosion.js';
import { tilesOf, copyTiles, pasteTiles, TILE_BYTES } from './undo.js';
import { makeBoulder, applyBoulder } from './boulder.js';

/** @typedef {import('./brushes.js').Brush} Brush */
/** @typedef {import('./heightfield.js').CellRect} CellRect */
/** @typedef {{ kind: 'terrain', before: import('./undo.js').Tile[], after: import('./undo.js').Tile[], bytes: number }} TerrainCommand */

/**
 * @typedef {Object} Stroke
 * @property {Brush} brush
 * @property {number} mode
 * @property {number} layer
 * @property {number} target      flatten height (ground under the cursor at stroke start)
 * @property {number} pressure
 * @property {number[] | null} cursor
 * @property {number[] | null} last
 * @property {CellRect | null} rect   union of stamp rects so far
 * @property {Set<number>} tileIds
 * @property {import('./undo.js').Tile[]} before
 * @property {boolean} ending
 * @property {(c: TerrainCommand | null) => void} resolve
 * @property {Promise<TerrainCommand | null>} done
 */

/**
 * @param {import('../../core/gpu.js').Gpu} gpu
 * @param {{ seed: number, recipe: any, land: any, landId?: string,
 *   passTimer?: (name: string) => GPUComputePassTimestampWrites | undefined }} opts
 *   seed is the terrain sub-seed; landId the land recipe's id as each chunk records it ('land/<id>'); passTimer lets a tools page time terrain compute passes
 */
export async function createTerrain(gpu, opts) {
  const { device } = gpu;
  const { recipe, land, seed } = opts;
  const rb = recipe.brush;

  // The open land: the land recipe's own chunk range (4 x 4 on the larger island), else the starter's.
  const chunks = createChunkTable();
  const c0 = land.chunkMin ?? recipe.starter.chunkMin, c1 = land.chunkMax ?? recipe.starter.chunkMax;
  const landId = opts.landId ?? recipe.starter.land;
  for (let cz = c0; cz <= c1; cz++) {
    for (let cx = c0; cx <= c1; cx++) chunks.open(cx, cz, landId);
  }
  const bounds = chunks.bounds();
  const edge = { openMin: bounds.openMin, openMax: bounds.openMax, edgeFade: rb.edgeFadeMeters };
  const marginCells = Math.ceil(recipe.erosion.marginMeters / CELL) + 1;

  // The mirror is kept in the store so a lost GPU device rebuilds the same island, edits and all.
  const live = getStore('terrainLive');
  /** @type {import('./heightfield.js').Mirror} */
  let mirror;
  if (live && live.seed === seed) {
    mirror = live.mirror;
  } else {
    mirror = createMirror();
    await buildBases(mirror, chunks.list(), land, seed);
    // The heights as generated, before any edit or saved chunk is put back, kept so the habitat can
    // tell which ground the player shaped (M2 dragonflies want a pond you made).
    updateStore('terrainLive', () => ({ seed, mirror, baseQ: mirror.heightQ.slice() }));
  }
  updateStore('chunks', (prev) => {
    const out = prev ?? {};
    for (const c of chunks.list()) {
      const key = chunkKey(c.cx, c.cz);
      out[key] ??= { state: 'open', land: c.land, seed, edited: false };
    }
    return out;
  });

  const tex = createTextures(device);
  uploadRect(device, tex, mirror, { x: 0, y: 0, w: N, h: N });
  // Chunks with a sheer step keep full mesh detail near the camera (docs/19).
  const cliffs = createCliffChunks(recipe.cliff.chunkStepM);
  cliffs.refresh(mirror.heightF, { x: 0, y: 0, w: N, h: N });
  const [brushGpu, erosionGpu] = await Promise.all([
    createBrushGpu(device, tex, rb.maxStampsPerFrame),
    createErosionGpu(device, tex, recipe.erosion),
  ]);

  /** @type {Stroke | null} */ let stroke = null;
  /** @type {{ st: Stroke, rect: CellRect, readback: { read: () => Promise<any> } } | null} */ let pending = null;
  /** @type {Promise<void> | null} */ let finalizing = null;
  /** @type {{ x: number, z: number, radius: number, hardness: number, visible: boolean, level: number | null }} */
  const ring = { x: 0, z: 0, radius: 1, hardness: rb.hardness, visible: false, level: null };
  /**
   * Steps keep their shape (src/world/pieces/steps.js): the brushes skip guarded cells on the GPU,
   * and at each edit's end this puts back what erosion or a boulder moved there, before the undo
   * tiles are taken. Returns whether it changed anything.
   * @type {((m: import('./heightfield.js').Mirror, r: CellRect) => boolean) | null}
   */
  let guard = null;

  /**
   * Grow a rect by m cells and clamp it to the open land.
   * @param {CellRect} r @param {number} m
   */
  function grow(r, m) {
    const o = bounds.cells;
    const x0 = Math.max(o.x, r.x - m);
    const y0 = Math.max(o.y, r.y - m);
    const x1 = Math.min(o.x + o.w, r.x + r.w + m);
    const y1 = Math.min(o.y + o.h, r.y + r.h + m);
    return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  }

  /** @param {CellRect | null} a @param {CellRect} b */
  function union(a, b) {
    if (!a) return { ...b };
    const x0 = Math.min(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    return { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 };
  }

  /** @param {CellRect} r */
  const worldRect = (r) => ({
    x0: WORLD_ORIGIN + r.x * CELL, z0: WORLD_ORIGIN + r.y * CELL,
    x1: WORLD_ORIGIN + (r.x + r.w) * CELL, z1: WORLD_ORIGIN + (r.y + r.h) * CELL,
  });

  /**
   * Turn this frame's cursor path into stamps, copying undo tiles before each first touch.
   * @param {Stroke} st @param {number} dt
   */
  function makeStamps(st, dt) {
    if (!st.cursor) return [];
    const r = st.brush.radius;
    const spacing = Math.max(rb.spacing * r, CELL);
    const from = st.last ?? st.cursor;
    const d = Math.hypot(st.cursor[0] - from[0], st.cursor[1] - from[1]);
    const n = Math.min(rb.maxStampsPerFrame, Math.max(1, Math.ceil(d / spacing)));
    // A Cliff stamp sets rather than adds, so its amount is not split across the frame's stamps.
    const amount = frameAmount(st.brush, st.pressure, dt, rb) / (st.mode === CLIFF_MODE ? 1 : n);
    const stamps = [];
    for (let i = 1; i <= n; i++) {
      const t = st.last ? i / n : 1;
      const x = from[0] + (st.cursor[0] - from[0]) * t;
      const z = from[1] + (st.cursor[1] - from[1]) * t;
      const rect = circleRect(x, z, r, bounds.cells);
      if (rect.w === 0 || rect.h === 0) continue;
      const fresh = tilesOf(grow(rect, marginCells)).filter((id) => !st.tileIds.has(id));
      for (const id of fresh) st.tileIds.add(id);
      if (fresh.length) st.before.push(...copyTiles(mirror, fresh));
      // Smooth: tap spacing in cells. Cliff: how far the shelf falls across the world-edge fade (m).
      const span = st.mode === CLIFF_MODE ? recipe.cliff.worldEdgeDropM : Math.max(1, Math.round((r * rb.smoothSpanFraction) / CELL));
      // A cliff stamp's hardness slot carries the rim width in meters (terrain-brush.wgsl).
      const hardness = st.mode === CLIFF_MODE ? recipe.cliff.edgeM : rb.hardness;
      const stamp = { x, z, radius: r, hardness, amount, target: st.target, mode: st.mode, layer: st.layer, span, rect };
      applyStampCpu(mirror.heightF, stamp, edge);
      st.rect = union(st.rect, rect);
      stamps.push(stamp);
    }
    st.last = st.cursor.slice();
    return stamps;
  }

  /**
   * Fold the read-back GPU result into the mirror, quantized, and push it back to the GPU.
   * @param {Stroke} st @param {CellRect} r @param {{ heights: Float32Array, materials: Uint8Array, pitch: number }} res
   */
  function finalize(st, r, res) {
    const rowF = res.pitch / 4;
    for (let j = 0; j < r.h; j++) {
      for (let i = 0; i < r.w; i++) {
        const k = (r.y + j) * N + r.x + i;
        const q = quantize(res.heights[j * rowF + i]);
        mirror.heightQ[k] = q;
        mirror.heightF[k] = dequantize(q);
        const s = j * res.pitch + i * 4;
        mirror.material[k * 4] = res.materials[s];
        mirror.material[k * 4 + 1] = res.materials[s + 1];
        mirror.material[k * 4 + 2] = res.materials[s + 2];
        mirror.material[k * 4 + 3] = res.materials[s + 3];
      }
    }
    guard?.(mirror, r);
    uploadRect(device, tex, mirror, r);
    const after = copyTiles(mirror, [...st.tileIds]);
    markEdited(r);
    emitDeferred('terrain:stroke-ended', { rect: worldRect(r) });
    st.resolve({ kind: 'terrain', before: st.before, after, bytes: (st.before.length + after.length) * TILE_BYTES });
  }

  /** @param {CellRect} r */
  function markEdited(r) {
    cliffs.refresh(mirror.heightF, r);
    updateStore('chunks', (all) => {
      for (const c of chunks.list()) {
        const x0 = chunkFirstCell(c.cx);
        const z0 = chunkFirstCell(c.cz);
        if (r.x < x0 + CHUNK_CELLS && r.x + r.w > x0 && r.y < z0 + CHUNK_CELLS && r.y + r.h > z0) all[chunkKey(c.cx, c.cz)].edited = true;
      }
    });
  }

  const terrain = {
    id: 'terrain',

    /** @param {number} x @param {number} z */
    sampleHeight: (x, z) => sampleHeight(mirror.heightF, x, z),
    /** @param {number} x @param {number} z @param {Float32Array|number[]} out */
    sampleNormal: (x, z, out) => sampleNormal(mirror.heightF, x, z, out),
    /** @param {number} x @param {number} z */
    sampleMaterial: (x, z) => sampleMaterial(mirror.material, x, z),
    /** @param {ArrayLike<number>} origin @param {ArrayLike<number>} dir */
    raycast: (origin, dir) => raycast(mirror.heightF, origin, dir),
    /** Above mean sea level (the high-tide line arrives with the tide in S4). @param {number} x @param {number} z */
    isLand: (x, z) => sampleHeight(mirror.heightF, x, z) > 0,
    /** @param {number} cx @param {number} cz */
    chunkState: (cx, cz) => chunks.state(cx, cz),
    openBounds: () => ({ openMin: bounds.openMin.slice(), openMax: bounds.openMax.slice() }),

    /** True while a stroke is live or settling; undo waits until it is not. */
    isBusy: () => !!stroke || !!pending || !!finalizing,

    /**
     * Start a stroke at a ground point. Returns false if a stroke is already live.
     * @param {Brush} brush @param {ArrayLike<number>} point world xyz @param {number} pressure 0..1
     */
    beginStroke(brush, point, pressure = 1) {
      if (stroke) return false;
      /** @type {(c: TerrainCommand | null) => void} */
      let resolve = () => {};
      /** @type {Promise<TerrainCommand | null>} */
      const done = new Promise((r) => { resolve = r; });
      const cliff = brush.kind === 'terrace' || brush.kind === 'cut';
      stroke = {
        done,
        brush: { ...brush },
        mode: brushGpu.modeOf(brush.kind),
        layer: LAYER_INDEX[brush.layer ?? 'grass'],
        // Flatten levels to the ground first touched; Terrace and Cut to that plus or minus Height.
        target: cliff ? terrain.cliffLevelAt(brush, point) : sampleHeight(mirror.heightF, point[0], point[2]),
        pressure,
        cursor: [point[0], point[2]],
        last: null,
        rect: null,
        tileIds: new Set(),
        before: [],
        ending: false,
        resolve,
      };
      return true;
    },

    /** @param {ArrayLike<number>} point @param {number} pressure */
    strokeTo(point, pressure = 1) {
      if (!stroke || stroke.ending) return;
      stroke.cursor = [point[0], point[2]];
      stroke.pressure = pressure;
    },

    /**
     * End the live stroke. Resolves with the undo command once the result has settled,
     * or null if the stroke changed nothing.
     * @returns {Promise<TerrainCommand | null>}
     */
    endStroke() {
      if (!stroke) return Promise.resolve(null);
      stroke.ending = true;
      return stroke.done;
    },

    /**
     * The Stone brush (docs/future/10): drop a seeded boulder at a ground point, lifted into the
     * heightfield and painted rock, and return its undo command (null if busy or nothing changed).
     * The same point gives the same boulder; tapping again on one piles another onto it.
     * @param {ArrayLike<number>} point world xyz @param {number} sizeM the main stone's radius (m)
     * @returns {TerrainCommand | null}
     */
    stampStone(point, sizeM) {
      if (terrain.isBusy()) return null;
      const b = makeBoulder(seed, point[0], point[2], sizeM, recipe.stone);
      const area = circleRect(point[0], point[2], b.reach + CELL, bounds.cells);
      if (area.w === 0 || area.h === 0) return null;
      const ids = tilesOf(area);
      const before = copyTiles(mirror, ids);
      // Fade out over the open land's edge, as brush strokes do.
      const fadeAt = (/** @type {number} */ i, /** @type {number} */ j) => {
        const x = WORLD_ORIGIN + (i + 0.5) * CELL, z = WORLD_ORIGIN + (j + 0.5) * CELL;
        const d = Math.min(x - edge.openMin[0], edge.openMax[0] - x, z - edge.openMin[1], edge.openMax[1] - z);
        return Math.min(1, Math.max(0, d / edge.edgeFade));
      };
      const r = applyBoulder(mirror, b, point[0], point[2], area, fadeAt);
      if (r.w === 0 || r.h === 0) return null;
      guard?.(mirror, r);
      uploadRect(device, tex, mirror, r);
      markEdited(r);
      emitDeferred('terrain:stroke-ended', { rect: worldRect(r) });
      const after = copyTiles(mirror, ids);
      return { kind: 'terrain', before, after, bytes: (before.length + after.length) * TILE_BYTES };
    },

    /**
     * An edit made on the CPU over a cell rect (Steps, src/world/pieces/steps.js): edit(mirror)
     * writes heights (heightQ and heightF) and paint inside the rect; returns its undo command, or
     * null if busy. @param {CellRect} rect @param {(m: import('./heightfield.js').Mirror) => void} edit
     * @returns {TerrainCommand | null}
     */
    editCells(rect, edit) {
      if (terrain.isBusy()) return null;
      const r = grow(rect, 0);
      if (r.w === 0 || r.h === 0) return null;
      const ids = tilesOf(r);
      const before = copyTiles(mirror, ids);
      edit(mirror);
      uploadRect(device, tex, mirror, r);
      markEdited(r);
      emitDeferred('terrain:stroke-ended', { rect: worldRect(r) });
      const after = copyTiles(mirror, ids);
      return { kind: 'terrain', before, after, bytes: (before.length + after.length) * TILE_BYTES };
    },

    /**
     * The cells the brushes leave alone, and what puts them back after an edit (see `guard`).
     * @param {Uint8Array} mask N x N, 1 guarded @param {CellRect} rect what changed in it
     * @param {(m: import('./heightfield.js').Mirror, r: CellRect) => boolean} apply
     */
    setGuard(mask, rect, apply) {
      guard = apply;
      const r = grow(rect, 0);
      if (r.w <= 0 || r.h <= 0) return;
      device.queue.writeTexture({ texture: tex.guard, origin: [r.x, r.y] }, mask.buffer,
        { offset: mask.byteOffset + r.y * N + r.x, bytesPerRow: N, rowsPerImage: r.h }, [r.w, r.h]);
    },

    /** World meters to a cell rect over the open land. @param {number} x0 @param {number} z0 @param {number} x1 @param {number} z1 */
    cellRect(x0, z0, x1, z1) {
      const i0 = Math.floor((x0 - WORLD_ORIGIN) / CELL), j0 = Math.floor((z0 - WORLD_ORIGIN) / CELL);
      return grow({ x: i0, y: j0, w: Math.ceil((x1 - WORLD_ORIGIN) / CELL) - i0 + 1, h: Math.ceil((z1 - WORLD_ORIGIN) / CELL) - j0 + 1 }, 0);
    },

    /**
     * Restore tiles from an undo command (before for undo, after for redo).
     * @param {import('./undo.js').Tile[]} tiles
     * @returns {boolean} false if busy (try again after the stroke settles)
     */
    applyTiles(tiles) {
      if (terrain.isBusy()) return false;
      const r = pasteTiles(mirror, tiles);
      syncFloat(mirror, r);
      uploadRect(device, tex, mirror, r);
      markEdited(r);
      emitDeferred('terrain:stroke-ended', { rect: worldRect(r) });
      return true;
    },

    /**
     * Put a save's edited chunks back (doc 18): heights and paint exactly as saved, over the regrown
     * land. Untouched chunks keep the land regrown from the seed.
     * @param {import('../../save/sections.js').SavedChunk[]} saved
     */
    restoreChunks(saved) {
      for (const c of saved) {
        if (!c.edited || !c.heightQ || !c.material || chunks.state(c.cx, c.cz) !== 'open') continue;
        pasteChunk(mirror, c.cx, c.cz, c.heightQ, c.material);
        uploadRect(device, tex, mirror, { x: chunkFirstCell(c.cx), y: chunkFirstCell(c.cz), w: CHUNK_CELLS, h: CHUNK_CELLS });
        updateStore('chunks', (all) => { all[chunkKey(c.cx, c.cz)].edited = true; });
        cliffs.refresh(mirror.heightF, { x: chunkFirstCell(c.cx), y: chunkFirstCell(c.cz), w: CHUNK_CELLS, h: CHUNK_CELLS });
      }
    },

    /** Chunks holding a cliff face: `has(cx, cz)`, and `version` that moves when the set changes. */
    cliffs,

    /**
     * The shelf a Terrace or Cut stroke started here would make (for the level line under the ring).
     * @param {Brush} brush @param {ArrayLike<number>} point world xyz
     */
    cliffLevelAt(brush, point) {
      const kind = brush.kind === 'cut' ? 'cut' : 'terrace';
      return cliffLevel(sampleHeight(mirror.heightF, point[0], point[2]), kind, brush.height ?? recipe.cliff.heightDefault, recipe.cliff, !!brush.sea);
    },

    /** The level of the live Terrace or Cut stroke, or null. */
    strokeLevel: () => (stroke && stroke.mode === CLIFF_MODE ? stroke.target : null),

    /** Brush ring drawn by the terrain shader; `level` adds the shelf's level line. @param {{ x?: number, z?: number, radius?: number, visible: boolean, level?: number | null }} r */
    setRing(r) {
      Object.assign(ring, r);
    },
    ring,

    /** Per-frame GPU work: stamps, and erosion plus readback when a stroke ends. */
    encode(/** @type {GPUCommandEncoder} */ encoder, /** @type {{ realDt: number }} */ f) {
      if (!stroke || finalizing || pending) return;
      const st = stroke;
      const stamps = makeStamps(st, Math.min(f.realDt, 0.1));
      brushGpu.encode(encoder, stamps, edge);
      if (!st.ending) return;
      stroke = null;
      if (!st.rect) { st.resolve(null); return; }
      const r = grow(st.rect, st.mode === 3 ? 0 : marginCells);
      // Faces a Cliff stroke made turn to rock first, so erosion keeps them sheer (docs/08).
      if (st.mode === CLIFF_MODE) brushGpu.encodeCliffRock(encoder, grow(st.rect, 1), recipe.cliff);
      if (st.mode !== 3) erosionGpu.encode(encoder, r, opts.passTimer?.('terrain-erosion'));
      pending = { st, rect: r, readback: encodeReadback(device, encoder, tex, r) };
    },

    /** Call after the frame's queue.submit: starts the readback of a settled stroke. */
    afterSubmit() {
      if (!pending) return;
      const p = pending;
      pending = null;
      finalizing = p.readback.read()
        .then((res) => finalize(p.st, p.rect, res))
        .catch((err) => { console.error('terrain readback failed', err); p.st.resolve(null); })
        .finally(() => { finalizing = null; });
    },

    gpu: {
      height: tex.height,
      material: tex.material,
      ground: tex.ground,
    },

    dispose() {
      for (const t of Object.values(tex)) t.destroy();
    },
  };
  return terrain;
}

/** @typedef {Awaited<ReturnType<typeof createTerrain>>} Terrain */

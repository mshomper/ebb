// @ts-check
// The island's placed pieces, live (doc 09, docs/future/10): loose stones drawn on the ground, set and
// removed with Sculpt's Loose stone mode (undoable, a soft cap), the handful that comes by itself
// when the naturalist's notes give stones (doc 13), and a stone tipping up when you tap it to look
// underneath. Keeps the saved store slice `pieces` (model.js PiecesState) and the tool card's
// `piecesUi` slice; listens for `piece:lifted` (src/world/journal) and the unlocks. app.js routes
// taps here with ground points; this module never reads the pointer.

import { get, update, subscribe } from '../../core/store.js';
import { on } from '../../core/events.js';
import { subSeed } from '../../core/rng.js';
import { hourIndex } from '../../core/clock.js';
import { packMesh } from '../creatures/bodies.js';
import { createCreaturePass } from '../../render/passes/creatures.js';
import { cleanPieces, makeStone, addPiece, removePiece, pieceAt, arrivingStones, tipAngle, tipDone, stoneBone } from './model.js';
import { stoneShapes } from './meshes.js';

/**
 * @param {{ terrain: any, water: any, camera: any, history: any, seed: number, recipe: any }} opts
 *   terrain: world/terrain (heights, painted ground); water: world/water (the summary, live depth);
 *   camera: the orbit camera (which way a lifted stone tips); history: input/actions.js `history`;
 *   seed: the world seed; recipe: recipes/world/pieces.json
 */
export function createPieces(opts) {
  const { terrain, water, camera, history, recipe } = opts;
  const piecesSeed = subSeed(opts.seed, 'pieces');
  const shapes = stoneShapes(recipe);
  const pass = createCreaturePass({ recipe: { body: recipe.look }, maxBones: 1 });
  shapes.forEach((s, i) => {
    pass.setMesh(`stone-${i}`, { data: packMesh(s.mesh), indices: s.mesh.indices });
    pass.setMesh(`damp-${i}`, { data: packMesh(s.damp), indices: s.damp.indices });
  });
  const shapeOf = (/** @type {{ seed: number }} */ p) => shapes[p.seed % shapes.length];
  /**
   * The damp patch's bone: the flat patch sheared to lie along the ground's slope under the stone,
   * so it neither sinks into a bank nor floats off it. @param {import('./model.js').Piece} p
   */
  function slopeBone(p) {
    const e = Math.max(0.1, p.size * 0.5);
    const gx = (terrain.sampleHeight(p.x + e, p.z) - terrain.sampleHeight(p.x - e, p.z)) / (2 * e);
    const gz = (terrain.sampleHeight(p.x, p.z + e) - terrain.sampleHeight(p.x, p.z - e)) / (2 * e);
    // The slope in the stone's own frame (its x and z axes turned by its yaw; creature-draw.wgsl place).
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    const a = gx * c - gz * s, b = gx * s + gz * c;
    return new Float32Array([1, a, 0, 0, 0, 1, 0, 0, 0, b, 1, 0, 0, 0, 0, 1]);
  }

  // What came back from the save (app.js put it in the store), or an empty list.
  update('pieces', (v) => cleanPieces(v));
  /** @returns {import('./model.js').PiecesState} */
  const state = () => get('pieces');

  /** Mirror the pieces into the tool card's slice. @param {string | null} [selectedId] @param {{ message?: string, refused?: boolean }} [say] */
  function sync(selectedId = get('piecesUi')?.selectedId ?? null, say) {
    const list = state().list;
    const sel = list.some((p) => p.id === selectedId) ? selectedId : null;
    update('piecesUi', (u) => ({ count: list.length, cap: recipe.cap, selectedId: sel,
      message: say?.message ?? '', refused: !!say?.refused, at: say ? performance.now() : u?.at ?? 0 }));
  }
  sync(null);

  // Setting and removing a stone are undoable commands.
  history.setApplier('piece', (/** @type {any} */ cmd, /** @type {'undo'|'redo'} */ dir) => {
    const adding = (cmd.op === 'add') === (dir === 'redo');
    const next = adding ? addPiece(state(), cmd.piece, Infinity) : removePiece(state(), cmd.piece.id).state;
    if (next) update('pieces', () => next);
    sync();
    return true;
  });

  /** Stones being lifted: seconds since the tap, and which way (in the stone's own frame) is toward you. @type {Map<string, { e: number, dir: number[] }>} */
  const lifts = new Map();
  const offLift = on('piece:lifted', (/** @type {{ id: string }} */ p) => {
    const s = state().list.find((q) => q.id === p.id);
    if (!s || lifts.has(s.id)) return;
    // Toward the eye, turned into the stone's frame (the inverse of its yaw; creature-draw.wgsl place).
    const wx = camera.eye[0] - s.x, wz = camera.eye[2] - s.z, l = Math.hypot(wx, wz) || 1;
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    const dx = (c * wx - sn * wz) / l, dz = (sn * wx + c * wz) / l;
    lifts.set(s.id, { e: 0, dir: [dx, dz] });
  });

  // The reward's handful comes once per island: when stones are given (live, after a catch-up, or
  // on a reload that finds them given but not yet come), as soon as the water summary is there.
  // `?stones` (unsaved) brings it too; `?sandbox` only opens the mode, so a kept island's handful
  // still waits for the reward.
  let pending = false;
  function arrive() {
    const u = get('unlocks');
    pending = (!!u?.earned?.stones || !!u?.stonesTest) && !state().arrived;
    if (!pending) return;
    const summary = water.getSummary?.();
    const material = get('terrainLive')?.mirror?.material ?? null;
    if (!summary || !material) return;
    const came = arrivingStones({ seed: piecesSeed, summary, material, ground: (x, z) => terrain.sampleHeight(x, z),
      recipe, hour: hourIndex(), nextId: state().nextId, existing: state().list });
    // No fresh water yet: wait for a pond, and try again when the water changes.
    if (!came.length) return;
    let s = state();
    for (const p of came) s = addPiece(s, p, recipe.cap) ?? s;
    update('pieces', () => ({ ...s, arrived: true }));
    pending = false;
    sync();
  }
  const offs = [subscribe('unlocks', arrive), on('water:summary-updated', arrive)];
  arrive();
  let pollS = 0;

  /** The stones as the draw pass wants them, with any lift's damp patch beneath. */
  function beings() {
    /** @type {any[]} */ const out = [];
    for (const p of state().list) {
      const sh = shapeOf(p), i = shapes.indexOf(sh);
      const y = terrain.sampleHeight(p.x, p.z);
      const lift = lifts.get(p.id);
      const angle = lift ? tipAngle(lift.e, recipe.tip) : 0;
      const dir = lift?.dir ?? [0, 1];
      const reach = 1 / Math.hypot(dir[0] / sh.hx, dir[1] / sh.hz);
      out.push({ x: p.x, y, z: p.z, yaw: p.yaw, size: p.size, mesh: `stone-${i}`, bones: stoneBone(angle, sh.hy * recipe.sink, dir, reach) });
      if (angle > 0.01) out.push({ x: p.x, y: y + 0.004, z: p.z, yaw: p.yaw, size: p.size, mesh: `damp-${i}`, bones: slopeBone(p) });
    }
    return out;
  }

  return {
    id: 'pieces',
    pass,

    /** Each frame: lifts move on in real seconds; the stones follow the ground under them. @param {import('../../sim/live-sim.js').FrameInfo} f */
    tick(f) {
      for (const [id, l] of lifts) { l.e += f.realDt; if (tipDone(l.e, recipe.tip)) lifts.delete(id); }
      if (pending && (pollS += f.realDt) > 0.5) { pollS = 0; arrive(); }
      pass.setBeings(beings());
    },

    /**
     * A tap with Sculpt's Loose stone mode at a ground point: select the stone there, or set a new
     * one under the cap (undoable). Water and the cap say so calmly instead.
     * @param {ArrayLike<number>} p
     */
    tap(p) {
      const hit = pieceAt(state().list, p[0], p[2], recipe.tapM + recipe.tapPerM * (camera.distance ?? 10));
      if (hit) { sync(hit.id); return; }
      if (state().list.length >= recipe.cap) { sync(null, { message: recipe.words.full }); return; }
      if ((water.sampleLive?.(p[0], p[2])?.depth ?? 0) > 0.02) { sync(null, { message: recipe.words.water, refused: true }); return; }
      const s = state();
      const piece = makeStone(piecesSeed, s.nextId, p[0], p[2], hourIndex(), recipe);
      const next = addPiece(s, piece, recipe.cap);
      if (!next) return;
      update('pieces', () => next);
      history.push({ kind: 'piece', bytes: 96, op: 'add', piece });
      sync(piece.id);
    },

    /** Remove a placed stone (undoable). @param {string} id */
    remove(id) {
      const r = removePiece(state(), id);
      if (!r.removed) return;
      update('pieces', () => r.state);
      lifts.delete(id);
      history.push({ kind: 'piece', bytes: 96, op: 'remove', piece: r.removed });
      sync(null);
    },

    /** Drop the selection (leaving the mode). */
    deselect() { if (get('piecesUi')?.selectedId) sync(null); },

    /**
     * The stone a tap at a ground point lands on, if any (the journal's tap card asks).
     * @param {number} x @param {number} z
     */
    pieceAt: (x, z) => pieceAt(state().list, x, z, recipe.tapM + recipe.tapPerM * (camera.distance ?? 10)),

    /**
     * The brush ring in the Loose stone mode: round the selected stone, else a small ring where a tap
     * would set one. @param {ArrayLike<number> | null} p the ground under the pointer
     */
    ring(p) {
      const sel = get('piecesUi')?.selectedId;
      const s = sel ? state().list.find((q) => q.id === sel) : null;
      if (s) return { x: s.x, z: s.z, radius: s.size * 0.7, visible: true };
      return p ? { x: p[0], z: p[2], radius: 0.3, visible: true } : { visible: false };
    },

    dispose() { offLift(); for (const off of offs) off(); },
  };
}

/** @typedef {ReturnType<typeof createPieces>} Pieces */

// @ts-check
// The island's placed pieces, live (doc 09, docs/future/10): loose stones drawn on the ground, set and
// removed with Sculpt's Loose stone mode (undoable, a soft cap), the handful that comes by itself
// when the naturalist's notes give stones (doc 13), and a stone tipping up when you tap it to look
// underneath. Driftwood (the reward at ten finds) washes up on the strandline after high tides
// (driftwood.js, unsaved), and a tapped log rolls over to show the damp sand under it. Carrying (the
// turtles' gift, unlocks.carry) lifts a stone or a log and sets it down where you tap next: a log
// carried off the strand is kept from then on, as a piece of kind 'log' (undoable, its own cap).
// Keeps the saved store slice `pieces` (model.js PiecesState), the tool card's `piecesUi` slice and
// `carry` (what is being carried, or null); listens for `piece:lifted` (src/world/journal) and the
// unlocks. app.js routes taps here with ground points; this module never reads the pointer. The kept
// logs and their surfaces (keptLogs) are what autumn's fungi grow on (src/world/finds/autumn-live.js).

import { get, update, subscribe } from '../../core/store.js';
import { on } from '../../core/events.js';
import { subSeed, hash32 } from '../../core/rng.js';
import { hourIndex } from '../../core/clock.js';
import { tideParams } from '../tide.js';
import { packMesh } from '../creatures/bodies.js';
import { createPiecesPass } from '../../render/passes/pieces.js';
import { cleanPieces, makeStone, makeLog, addPiece, removePiece, movePiece, countKind, pieceAt, arrivingStones,
  tipAngle, tipDone, stoneBone, leanBone, logBone, mul4 } from './model.js';
import { stoneShapes, logShapes } from './meshes.js';
import { strandLogs, cellHeights, strandMask } from './driftwood.js';
import { logSurface } from './log-surface.js';

/**
 * @param {{ terrain: any, water: any, camera: any, history: any, seed: number, recipe: any, ground: any, terrainRecipe: any,
 *   shore?: any, tide?: any }} opts
 *   terrain: world/terrain (heights, painted ground); water: world/water (the summary, live depth);
 *   camera: the orbit camera (which way a lifted stone tips); history: input/actions.js `history`;
 *   seed: the world seed; recipe: recipes/world/pieces.json; ground: render/ground-detail.js (the
 *   island's rock scans the stones are drawn with); terrainRecipe: terrain.json (those scans' tuning);
 *   shore: world/water/shore-live.js (its recipe's strandline, where driftwood lies); tide: water.json `tide`
 */
export function createPieces(opts) {
  const { terrain, water, camera, history, recipe } = opts;
  const D = recipe.driftwood;
  const piecesSeed = subSeed(opts.seed, 'pieces');
  const driftSeed = subSeed(opts.seed, 'driftwood');
  const tideP = tideParams(opts.tide);
  const shapes = stoneShapes(recipe);
  const logs = logShapes(recipe);
  const pass = createPiecesPass({ ground: opts.ground, recipe, terrainRecipe: opts.terrainRecipe });
  shapes.forEach((s, i) => {
    pass.setMesh(`stone-${i}`, { data: packMesh(s.mesh), indices: s.mesh.indices });
    pass.setMesh(`damp-${i}`, { data: packMesh(s.damp), indices: s.damp.indices });
  });
  logs.forEach((s, i) => pass.setMesh(`log-${i}`, { data: packMesh(s.mesh), indices: s.mesh.indices }));
  pass.setMesh('logdamp', { data: packMesh(logs[0].damp), indices: logs[0].damp.indices });
  const shapeOf = (/** @type {{ seed: number }} */ p) => shapes[p.seed % shapes.length];
  const ground = (/** @type {number} */ x, /** @type {number} */ z) => terrain.sampleHeight(x, z);
  /**
   * The ground's rise under a piece, along its own x and z (its axes turned by its yaw;
   * piece-draw.wgsl turn). @param {{ x: number, z: number, yaw: number }} p @param {number} reach
   * @returns {number[]}
   */
  function slopeOf(p, reach) {
    const e = Math.max(0.1, reach);
    const gx = (ground(p.x + e, p.z) - ground(p.x - e, p.z)) / (2 * e);
    const gz = (ground(p.x, p.z + e) - ground(p.x, p.z - e)) / (2 * e);
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    return [gx * c - gz * s, gx * s + gz * c];
  }
  /** The damp patch's bone: sheared to lie along the slope, so it neither sinks into a bank nor floats. @param {number[]} sl */
  const shear = (sl) => new Float32Array([1, sl[0], 0, 0, 0, 1, 0, 0, 0, sl[1], 1, 0, 0, 0, 0, 1]);
  /** Raised by h mesh units (a carried piece). @param {number} h */
  const raise = (h) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, h, 0, 1]);

  // What came back from the save (app.js put it in the store), or an empty list.
  update('pieces', (v) => cleanPieces(v));
  update('carry', () => null);
  /** @returns {import('./model.js').PiecesState} */
  const state = () => get('pieces');
  const stones = () => state().list.filter((p) => p.kind === 'stone');

  /** Mirror the pieces into the tool card's slice. @param {string | null} [selectedId] @param {{ message?: string, refused?: boolean }} [say] */
  function sync(selectedId = get('piecesUi')?.selectedId ?? null, say) {
    const list = state().list;
    const sel = list.some((p) => p.id === selectedId) ? selectedId : null;
    update('piecesUi', (u) => ({ count: countKind(list, 'stone'), cap: recipe.cap, selectedId: sel,
      message: say?.message ?? '', refused: !!say?.refused, at: say ? performance.now() : u?.at ?? 0 }));
  }
  sync(null);

  // Setting, removing and moving a piece are undoable commands.
  history.setApplier('piece', (/** @type {any} */ cmd, /** @type {'undo'|'redo'} */ dir) => {
    if (cmd.op === 'move') {
      const to = dir === 'undo' ? cmd.from : cmd.to;
      update('pieces', () => movePiece(state(), cmd.id, to.x, to.z));
      sync();
      return true;
    }
    const adding = (cmd.op === 'add') === (dir === 'redo');
    const next = adding ? addPiece(state(), cmd.piece, Infinity) : removePiece(state(), cmd.piece.id).state;
    if (next) update('pieces', () => next);
    sync();
    return true;
  });

  // ---- driftwood on the strandline (driftwood.js): worked out again at each high water ----
  /** @type {Float32Array | null} */ let heights = null;
  /** Where the sea's strand can be (driftwood.js strandMask). @type {Uint8Array | null} */ let mask = null;
  /** @type {any} */ let heightsRect = null;
  /** @type {import('./driftwood.js').StrandLog[]} */ let strand = [];
  /** The strand logs out of the water now (a rising tide covers them). @type {import('./driftwood.js').StrandLog[]} */ let strandShown = [];
  let strandKey = '';
  /** @param {number} nowH display hours */
  function refreshStrand(nowH) {
    const L = opts.shore?.recipe?.look?.strandline;
    const summary = water.getSummary?.();
    if (!get('unlocks')?.driftwood || !L || !summary) { strand = []; strandShown = []; strandKey = ''; return; }
    if (!heights || heightsRect !== summary.rect) {
      heights = cellHeights(summary.rect, ground);
      mask = strandMask(summary, D.bandReachM);
      heightsRect = summary.rect;
      strandKey = '';
    }
    const kept = new Set(state().list.filter((p) => p.kind === 'log').map((p) => p.seed));
    const key = `${Math.floor((nowH - tideP.phaseH) / tideP.periodH)}|${[...kept].join(',')}`;
    if (key !== strandKey) {
      strandKey = key;
      strand = strandLogs({ seed: driftSeed, nowH, tide: tideP, strand: L, rect: summary.rect, heights, height: ground, recipe: D, kept, mask });
    }
    strandShown = strand.filter((s) => (water.sampleLive?.(s.x, s.z)?.depth ?? 0) <= 0.005 || carrying?.id === s.key);
  }
  // The land changed: the strand's heights are looked at again.
  const offSummary = on('water:summary-updated', () => { heights = null; });

  /** A piece by id: kept, or a log on the strand (its id is its key). @param {string} id */
  function findPiece(id) {
    const kept = state().list.find((q) => q.id === id);
    if (kept) return { piece: /** @type {any} */ (kept), strand: null };
    const s = strandShown.find((q) => q.key === id);
    return s ? { piece: /** @type {any} */ ({ ...s, id: s.key }), strand: s } : null;
  }

  /** Pieces being lifted: seconds since the tap, and which way (in the piece's own frame) is toward you. @type {Map<string, { e: number, dir: number[] }>} */
  const lifts = new Map();
  const offLift = on('piece:lifted', (/** @type {{ id: string }} */ p) => {
    const s = findPiece(p.id)?.piece;
    if (!s || lifts.has(p.id) || carrying?.id === p.id) return;
    // Toward the eye, turned into the piece's frame (the inverse of its yaw; creature-draw.wgsl place).
    const wx = camera.eye[0] - s.x, wz = camera.eye[2] - s.z, l = Math.hypot(wx, wz) || 1;
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    const dx = (c * wx - sn * wz) / l, dz = (sn * wx + c * wz) / l;
    lifts.set(p.id, { e: 0, dir: [dx, dz] });
  });

  // ---- carrying (the turtles' gift) ----
  /** @type {{ id: string, kind: string, radius: number, strand: import('./driftwood.js').StrandLog | null } | null} */ let carrying = null;
  /** @param {typeof carrying} c */
  function setCarry(c) { carrying = c; update('carry', () => (c ? { id: c.id, kind: c.kind } : null)); }

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
    const came = arrivingStones({ seed: piecesSeed, summary, material, ground,
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
  let pollS = 0, strandS = 1;

  /**
   * The pieces as the draw pass wants them, each set into the ground and leaned with its slope,
   * with any lift's damp patch beneath; a carried piece hangs above its spot.
   * @returns {import('../../render/passes/pieces.js').PieceBeing[]}
   */
  function beings() {
    /** @type {import('../../render/passes/pieces.js').PieceBeing[]} */ const out = [];
    const liftM = D.carry.liftM;
    for (const p of state().list) {
      if (p.kind === 'log') { logBeing(p, p.id, out); continue; }
      const sh = shapeOf(p), i = shapes.indexOf(sh);
      const y = ground(p.x, p.z);
      const slope = slopeOf(p, p.size * 0.5);
      const lift = lifts.get(p.id);
      const held = carrying?.id === p.id;
      const angle = lift ? tipAngle(lift.e, recipe.tip) : 0;
      const dir = lift?.dir ?? [0, 1];
      const reach = 1 / Math.hypot(dir[0] / sh.hx, dir[1] / sh.hz);
      let bone = mul4(leanBone(slope[0], slope[1], recipe.lean), stoneBone(angle, sh.hy * recipe.sink, dir, reach));
      if (held) bone = mul4(raise(liftM / p.size), bone);
      const common = { x: p.x, z: p.z, yaw: p.yaw, size: p.size, slope, seed: (p.seed >>> 8) / 16777216 * 10, half: [sh.hx, sh.hz] };
      out.push({ ...common, y, mesh: `stone-${i}`, bone });
      if (angle > 0.01 || held) out.push({ ...common, y: y + 0.004, mesh: `damp-${i}`, bone: shear(slope), plain: true });
    }
    for (const s of strandShown) logBeing(s, s.key, out);
    return out;
  }

  /**
   * A log as the draw pass wants it: rolled away from you while lifted, raised while carried.
   * @param {{ x: number, z: number, yaw: number, seed: number, size: number, length?: number }} p @param {string} id
   * @param {import('../../render/passes/pieces.js').PieceBeing[]} out
   */
  function logBeing(p, id, out) {
    const len = p.length ?? 1, a = p.size / len;
    const i = p.seed % logs.length;
    const y = ground(p.x, p.z);
    const slope = slopeOf(p, Math.min(0.4, len * 0.3));
    const lift = lifts.get(id);
    const held = carrying?.id === id;
    const angle = lift ? tipAngle(lift.e, D.roll) : 0;
    // It rolls away from you, so the damp sand it lay on shows on your side of it.
    let bone = mul4(leanBone(slope[0], slope[1], D.lean), logBone(angle, (lift?.dir[0] ?? -1) < 0 ? 1 : -1, a, D.sink));
    if (held) bone = mul4(raise(D.carry.liftM / len), bone);
    const common = { x: p.x, z: p.z, yaw: p.yaw, size: len, slope, seed: (p.seed >>> 8) / 16777216 * 10, half: [(a / 2) * D.ringHalf[0], 0.5 * D.ringHalf[1]] };
    out.push({ ...common, y, mesh: `log-${i}`, bone, aspect: a });
    if (angle > 0.01 || held) out.push({ ...common, y: y + 0.004, mesh: 'logdamp', bone: mul4(shear(slope), new Float32Array([a, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])), plain: true });
  }

  /** How near a tap must be, from this far away. */
  const tapR = () => recipe.tapM + recipe.tapPerM * (camera.distance ?? 10);

  return {
    id: 'pieces',
    pass,

    /** Each frame: lifts move on in real seconds; the pieces follow the ground under them. @param {import('../../sim/live-sim.js').FrameInfo} f */
    tick(f) {
      for (const [id, l] of lifts) {
        l.e += f.realDt;
        const log = state().list.find((q) => q.id === id)?.kind === 'log' || id.startsWith('drift:');
        if (tipDone(l.e, log ? D.roll : recipe.tip)) lifts.delete(id);
      }
      if (pending && (pollS += f.realDt) > 0.5) { pollS = 0; arrive(); }
      if ((strandS += f.realDt) > 0.5) { strandS = 0; refreshStrand(f.displayT / 3600); }
      pass.setPieces(beings());
    },

    /**
     * Ground where no grass blade stands, under each stone and along each log (the grass and rush
     * passes' setClears), nearest the view first. @param {ArrayLike<number>} focus [x, y, z]
     */
    clears(focus) {
      /** @type {{ x: number, z: number, r: number, d: number }[]} */ const out = [];
      const put = (/** @type {number} */ x, /** @type {number} */ z, /** @type {number} */ r) => out.push({ x, z, r, d: (x - focus[0]) ** 2 + (z - focus[2]) ** 2 });
      for (const p of [...state().list, ...strandShown]) {
        if (p.kind !== 'log') { put(p.x, p.z, p.size * 0.5 * recipe.grassClear); continue; }
        const len = p.length ?? 1, r = p.size * 0.5 + D.grassClearM;
        const n = Math.min(6, Math.max(2, Math.ceil(len / (r * 1.6))));
        const ax = Math.sin(p.yaw), az = Math.cos(p.yaw);
        for (let k = 0; k < n; k++) { const t = (k / (n - 1) - 0.5) * (len - r); put(p.x + ax * t, p.z + az * t, r); }
      }
      return out.sort((a, b) => a.d - b.d);
    },

    /**
     * A tap with Sculpt's Loose stone mode at a ground point: select the stone there, or set a new
     * one under the cap (undoable). Water and the cap say so calmly instead.
     * @param {ArrayLike<number>} p
     */
    tap(p) {
      const hit = pieceAt(stones(), p[0], p[2], tapR());
      if (hit) { sync(hit.id); return; }
      if (countKind(state().list, 'stone') >= recipe.cap) { sync(null, { message: recipe.words.full }); return; }
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
     * The piece a tap at a ground point lands on, if any (the journal's tap card asks): a kept stone
     * or log, or a log lying on the strand (strand: true; its id is its key).
     * @param {number} x @param {number} z
     */
    pieceAt(x, z) {
      const all = [...state().list.map((p) => ({ ...p, strand: false })), ...strandShown.map((s) => ({ ...s, id: s.key, strand: true }))];
      return pieceAt(all, x, z, tapR(), D.tapReachM);
    },

    /** Lift a stone or a log to carry it (the card's Carry). @param {string} id @returns {boolean} */
    carry(id) {
      const f = findPiece(id);
      if (!f) return false;
      lifts.delete(id);
      const radius = f.piece.kind === 'log' ? (f.piece.length ?? 1) / 2 : f.piece.size * 0.7;
      setCarry({ id, kind: f.piece.kind, radius, strand: f.strand });
      return true;
    },

    /** Put it back where it was. */
    cancelCarry() { if (carrying) setCarry(null); },

    /** What is being carried (radius: the ring where it would go), or null. */
    carrying: () => (carrying ? { id: carrying.id, kind: carrying.kind, radius: carrying.radius } : null),

    /**
     * Set the carried piece down at a ground point: a kept piece moves there; a log off the strand
     * is kept from now on, under the logs' cap. Undoable. Water, and the cap, refuse calmly (the
     * reason says which); water keeps it carried, the cap puts it back.
     * @param {ArrayLike<number>} p @returns {{ ok: boolean, reason?: 'water' | 'full' | 'gone' }}
     */
    setDown(p) {
      if (!carrying) return { ok: false, reason: 'gone' };
      if ((water.sampleLive?.(p[0], p[2])?.depth ?? 0) > 0.02) return { ok: false, reason: 'water' };
      const s = state();
      if (carrying.strand) {
        const piece = makeLog(s.nextId, { ...carrying.strand, x: p[0], z: p[2] }, hourIndex());
        const next = addPiece(s, piece, D.cap);
        if (!next) { setCarry(null); return { ok: false, reason: 'full' }; }
        update('pieces', () => next);
        history.push({ kind: 'piece', bytes: 96, op: 'add', piece });
      } else {
        const was = s.list.find((q) => q.id === carrying?.id);
        if (!was) { setCarry(null); return { ok: false, reason: 'gone' }; }
        update('pieces', () => movePiece(s, was.id, p[0], p[2]));
        history.push({ kind: 'piece', bytes: 64, op: 'move', id: was.id, from: { x: was.x, z: was.z }, to: { x: p[0], z: p[2] } });
      }
      setCarry(null);
      strandS = 1;
      sync();
      return { ok: true };
    },

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

    /** The strand logs lying now (tools and tests). */
    strandLogs: () => strandShown,

    /**
     * The kept logs (carried off the strand and set down), for what grows on them (autumn's fungi,
     * src/world/finds/autumn-live.js): each with whether it lies still (not rolled by a tap, not
     * being carried) and its surface (log-surface.js) as it lies at rest.
     * @returns {{ id: string, seed: number, x: number, z: number, length: number, size: number, placedHour: number, still: boolean,
     *   surface: (t: number, a: number) => { p: number[], n: number[] } }[]}
     */
    keptLogs() {
      return state().list.filter((p) => p.kind === 'log').map((p) => {
        const len = p.length ?? 1, a = p.size / len;
        const bone = mul4(leanBone(...(/** @type {[number, number]} */ (slopeOf(p, Math.min(0.4, len * 0.3)))), D.lean), logBone(0, 1, a, D.sink));
        const pose = { bone, size: len, yaw: p.yaw, at: [p.x, ground(p.x, p.z), p.z] };
        const mesh = logs[p.seed % logs.length].mesh;
        return { id: p.id, seed: p.seed, x: p.x, z: p.z, length: len, size: p.size, placedHour: p.placedHour,
          still: !lifts.has(p.id) && carrying?.id !== p.id,
          surface: (/** @type {number} */ t, /** @type {number} */ ang) => logSurface(mesh, D.shape.rings, D.shape.around, pose, t, ang) };
      });
    },

    /**
     * `?debug` (window.ebb.debug.keptLog): keep a log at a ground point as if carried there long ago
     * (placedHour daysAgo game days back), its shape seeded from the point. Undoable like any set-down.
     * @param {number} x @param {number} z @param {number} daysAgo @returns {string | null} its id, or null at the cap or in water
     */
    debugKeepLog(x, z, daysAgo) {
      if ((water.sampleLive?.(x, z)?.depth ?? 0) > 0.02) return null;
      const s = state();
      const seed = hash32(driftSeed, Math.round(x * 100), Math.round(z * 100), 0xdeb) >>> 0;
      const u = (/** @type {number} */ k) => (hash32(seed, k) >>> 8) / 16777216;
      const log = { x, z, yaw: u(1) * 2 * Math.PI, seed, size: D.thickM[0] + (D.thickM[1] - D.thickM[0]) * (0.5 + 0.5 * u(2)),
        length: D.lengthM[0] + (D.lengthM[1] - D.lengthM[0]) * (0.4 + 0.6 * u(3)) };
      const piece = makeLog(s.nextId, log, hourIndex() - Math.round(daysAgo * 24));
      const next = addPiece(s, piece, D.cap);
      if (!next) return null;
      update('pieces', () => next);
      history.push({ kind: 'piece', bytes: 96, op: 'add', piece });
      sync();
      return piece.id;
    },

    dispose() { offLift(); offSummary(); for (const off of offs) off(); },
  };
}

/** @typedef {ReturnType<typeof createPieces>} Pieces */

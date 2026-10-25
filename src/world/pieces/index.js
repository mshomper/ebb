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
import { stoneShapes, logDamp } from './meshes.js';
import { createLogCache } from './log-cache.js';
import { logAge, dampShade, logMoss } from './log-age.js';
import { strandLogs, cellHeights, strandMask } from './driftwood.js';
import { logSurface } from './log-surface.js';
import { slabShapes } from './slabs.js';
import { raftShapes, makeRaft, raftRest } from './raft.js';
import { makeStepping, strideAfter, jitterOf, topOf, links, footingAt, stepBack } from './stepping.js';
import { onCampGround, crossesCampGround, offCampGround } from './camp-clear.js';
import { planFlight, flightGeom, flightHeightAt, flightRect, carveFlight, paintFlight, markGuard, crossesGuard, treadSlabs } from './steps.js';
import { emitDeferred } from '../../core/events.js';
import { WORLD_CELLS } from '../terrain/grid.js';
import { waterCellOf } from '../water/grid.js';

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
  const pass = createPiecesPass({ ground: opts.ground, recipe, terrainRecipe: opts.terrainRecipe });
  shapes.forEach((s, i) => {
    pass.setMesh(`stone-${i}`, { data: packMesh(s.mesh), indices: s.mesh.indices });
    pass.setMesh(`damp-${i}`, { data: packMesh(s.damp), indices: s.damp.indices });
  });
  // Every log is baked from its own seed (log-bake.js), the first time it is drawn.
  const logs = createLogCache(pass, D);
  // Pond stones and the slabs on Steps' treads (slabs.js): rounded slabs with a long skirt that
  // stands on a pond bed, or sinks out of sight into the ground.
  const S = recipe.stepping, ST = recipe.steps;
  const slabs = slabShapes(recipe);
  slabs.forEach((s, i) => pass.setMesh(`slab-${i}`, { data: packMesh(s.mesh), indices: s.mesh.indices }));
  // A tread's slabs are the same shapes with a short skirt, since a flight can stand out from the slope.
  const treadShapes = slabShapes({ ...recipe, stepping: { ...S, slab: { ...S.slab, skirtUnits: ST.slab.skirtUnits } } });
  treadShapes.forEach((s, i) => pass.setMesh(`tread-${i}`, { data: packMesh(s.mesh), indices: s.mesh.indices }));
  // Reed rafts (raft.js, the turtles' gift), afloat on the ponds.
  const RF = recipe.raft;
  const rafts = raftShapes(recipe);
  rafts.forEach((s, i) => pass.setMesh(`raft-${i}`, { data: packMesh(s.mesh), indices: s.mesh.indices }));
  const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const logDampMesh = logDamp(recipe);
  pass.setMesh('logdamp', { data: packMesh(logDampMesh), indices: logDampMesh.indices });
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
    // A line of pond stones laid (or removed) at once.
    if (cmd.op === 'addMany' || cmd.op === 'removeMany') {
      const adding = (cmd.op === 'addMany') === (dir === 'redo');
      let s = state();
      for (const p of cmd.pieces) s = adding ? addPiece(s, p, Infinity) ?? s : removePiece(s, p.id).state;
      update('pieces', () => s);
      sync();
      return true;
    }
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

  /**
   * Pieces being lifted: seconds since the lift, which way (in the piece's own frame) is toward you,
   * and how long it is held up (Lift on foot holds it longer, L3a; else the recipe's own).
   * @type {Map<string, { e: number, dir: number[], holdS: number | null }>}
   */
  const lifts = new Map();
  const offLift = on('piece:lifted', (/** @type {{ id: string, from?: number[], holdS?: number }} */ p) => {
    const s = findPiece(p.id)?.piece;
    if (!s || lifts.has(p.id) || carrying?.id === p.id) return;
    // Toward you (where you knelt, or the eye), turned into the piece's frame (the inverse of its
    // yaw; creature-draw.wgsl place).
    const from = p.from ?? [camera.eye[0], camera.eye[2]];
    const wx = from[0] - s.x, wz = from[1] - s.z, l = Math.hypot(wx, wz) || 1;
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    const dx = (c * wx - sn * wz) / l, dz = (sn * wx + c * wz) / l;
    lifts.set(p.id, { e: 0, dir: [dx, dz], holdS: p.holdS ?? null });
  });
  /** A lift's timing: the recipe's, held for holdS when the lift says so. @param {any} T @param {{ holdS: number | null } | undefined} l */
  const timed = (T, l) => (l?.holdS != null ? { ...T, holdS: l.holdS } : T);

  // ---- carrying (the turtles' gift) ----
  /** @type {{ id: string, kind: string, radius: number, strand: import('./driftwood.js').StrandLog | null } | null} */ let carrying = null;
  /** @param {typeof carrying} c */
  function setCarry(c) { carrying = c; update('carry', () => (c ? { id: c.id, kind: c.kind } : null)); }

  // ---- pond stones and Steps (stepping.js, steps.js) ----
  const pond = () => /** @type {import('./stepping.js').SteppingStone[]} */ (/** @type {any} */ (state().list.filter((p) => p.kind === 'stepping')));
  const flights = () => /** @type {import('./steps.js').Flight[]} */ (/** @type {any} */ (state().list.filter((p) => p.kind === 'steps')));
  /**
   * Water over a point now: the sea at the tide, and the live water (as the walker reads it); while
   * the live water is not read back yet, a pond's standing depth from the water summary.
   * @param {number} x @param {number} z
   */
  const depthAt = (x, z) => {
    let still = 0;
    const s = water.sim?.live ? null : water.getSummary?.();
    if (s) {
      const i = waterCellOf(x) - s.rect.x, j = waterCellOf(z) - s.rect.y;
      if (i >= 0 && j >= 0 && i < s.rect.w && j < s.rect.h) still = s.targetMm[j * s.rect.w + i] / 1000;
    }
    return Math.max(0, (water.tide ?? -Infinity) - ground(x, z), water.sampleLive?.(x, z)?.depth ?? 0, still);
  };
  /** @type {{ mode: string, message: string, refused: boolean }} */ let shapingSay = { mode: '', message: '', refused: false };
  /** @type {{ pond: string | null, steps: string | null, raft: string | null }} */ const shapingSel = { pond: null, steps: null, raft: null };
  const raftList = () => state().list.filter((p) => p.kind === 'raft');
  const raftShapeOf = (/** @type {{ seed: number }} */ p) => rafts[(p.seed >>> 0) % rafts.length];
  /** Each raft's level as drawn, eased toward where it rests, and its bob's clock. @type {Map<string, { y: number, afloat: boolean }>} */
  const raftAt = new Map();
  let raftClock = 0;
  /**
   * Where a raft is drawn now: easing toward the water as it is (or the ground under it), bobbing
   * gently while afloat. @param {any} p @param {number} dt real seconds since the last frame
   */
  function raftNow(p, dt) {
    const rest = raftRest(p, raftShapeOf(p), ground, depthAt, RF);
    const was = raftAt.get(p.id);
    const k = was ? 1 - Math.exp(-dt / RF.settleS) : 1;
    const y = was ? was.y + (rest.y - was.y) * k : rest.y;
    raftAt.set(p.id, { y, afloat: rest.afloat });
    const bob = rest.afloat ? RF.bobM * Math.sin((raftClock / RF.bobS) * 2 * Math.PI + (p.seed % 628) / 100) : 0;
    return { y: y + bob, afloat: rest.afloat };
  }
  /** Mirror pond stones and Steps into the tool card's slice. @param {{ mode: string, message: string, refused?: boolean }} [say] */
  function syncShaping(say) {
    if (say) shapingSay = { mode: say.mode, message: say.message, refused: !!say.refused };
    const list = state().list;
    for (const k of /** @type {const} */ (['pond', 'steps', 'raft'])) if (shapingSel[k] && !list.some((p) => p.id === shapingSel[k])) shapingSel[k] = null;
    const selStone = shapingSel.pond ? pond().find((p) => p.id === shapingSel.pond) : null;
    const runSize = selStone ? pond().filter((p) => p.run === selStone.run).length : 0;
    update('shapingUi', () => ({
      pond: { count: countKind(list, 'stepping'), cap: S.cap, selectedId: shapingSel.pond, run: runSize > 1 ? selStone?.run ?? null : null, hint: S.words.hint },
      steps: { count: countKind(list, 'steps'), cap: ST.cap, selectedId: shapingSel.steps, hint: ST.words.hint },
      raft: { count: countKind(list, 'raft'), cap: RF.cap, selectedId: shapingSel.raft, hint: RF.words.hint },
      words: { removeLine: S.words.removeLine },
      ...shapingSay, at: say ? performance.now() : get('shapingUi')?.at ?? 0 }));
  }

  // Where the walker can stand (src/world/walk footing): pond stones and the lines between them.
  /** @type {[import('./stepping.js').SteppingStone, import('./stepping.js').SteppingStone][]} */ let linked = [];
  let pondBox = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
  /** @type {Map<string, number[]>} */ let pondSeen = new Map();
  // The brushes' guard over Steps (terrain/index.js setGuard).
  const guardMask = new Uint8Array(WORLD_CELLS * WORLD_CELLS);
  const guardApply = (/** @type {any} */ m, /** @type {any} */ r) => {
    let changed = false;
    for (const f of flights()) changed = carveFlight(m, f, ST, r) || changed;
    return changed;
  };
  /** @type {Map<string, any>} */ let flightSeen = new Map();
  /** Treads' slabs per flight, worked out when the flights change. @type {{ f: any, slabs: ReturnType<typeof treadSlabs> }[]} */ let treads = [];

  /**
   * The list changed (a stone laid, a flight cut, undo, a load): the walker's footing and the
   * brushes' guard follow, each only where something moved.
   */
  function onList() {
    const stones = pond();
    const now = new Map(stones.map((p) => [p.id, [p.x, p.z, p.rise, p.size]]));
    let box = null;
    const grow = (/** @type {number[]} */ v) => { const r = 1.2; box = box ? { x0: Math.min(box.x0, v[0] - r), z0: Math.min(box.z0, v[1] - r), x1: Math.max(box.x1, v[0] + r), z1: Math.max(box.z1, v[1] + r) } : { x0: v[0] - r, z0: v[1] - r, x1: v[0] + r, z1: v[1] + r }; };
    for (const [id, v] of now) { const w = pondSeen.get(id); if (!w || w.some((a, i) => a !== v[i])) grow(v); }
    for (const [id, v] of pondSeen) if (!now.has(id)) grow(v);
    pondSeen = now;
    // Footing changed where a flight was cut or removed, too.
    for (const f of flights()) if (flightSeen.get(f.id) !== f) grow([f.x, f.z]), grow([f.x2, f.z2]), grow([(f.x + f.x2) / 2, (f.z + f.z2) / 2]);
    for (const [id, f] of flightSeen) if (!state().list.some((p) => p.id === id)) grow([f.x, f.z]), grow([f.x2, f.z2]);
    if (box) {
      linked = links(stones, S, ground);
      pondBox = stones.reduce((b, p) => ({ x0: Math.min(b.x0, p.x - 1), z0: Math.min(b.z0, p.z - 1), x1: Math.max(b.x1, p.x + 1), z1: Math.max(b.z1, p.z + 1) }),
        { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity });
      emitDeferred('pieces:footing-changed', { rect: box });
    }
    const fl = flights();
    const fNow = new Map(fl.map((f) => [f.id, f]));
    /** @type {any} */ let rect = null;
    const add = (/** @type {any} */ f) => {
      const r = flightRect(f, flightGeom(f, ST));
      rect = rect ? { x: Math.min(rect.x, r.x), y: Math.min(rect.y, r.y), w: Math.max(rect.x + rect.w, r.x + r.w) - Math.min(rect.x, r.x), h: Math.max(rect.y + rect.h, r.y + r.h) - Math.min(rect.y, r.y) } : r;
    };
    for (const [id, f] of fNow) if (flightSeen.get(id) !== f) add(f);
    for (const [id, f] of flightSeen) if (!fNow.has(id)) add(f);
    flightSeen = fNow;
    if (rect) {
      markGuard(guardMask, fl, ST, rect);
      terrain.setGuard?.(guardMask, rect, guardApply);
      treads = fl.map((f) => ({ f, slabs: treadSlabs(f, ST, slabs) }));
    }
    syncShaping();
  }
  const offList = subscribe('pieces', onList);
  onList();

  /** @type {{ run: string | null, last: number[] | null, laid: any[], stopped: boolean } | null} */ let laying = null;
  /** The camp pad, kept clear of every placed piece (camp-clear.js), or null before it is laid. */
  const padNow = () => get('campPad') ?? null;
  /** A pond stone's refusal on the card: the camp's own line, else the stepping stones' words. @param {string} r */
  const pondWords = (r) => (r === 'camp' ? recipe.words.camp : S.words[r]);
  /**
   * Lay one pond stone at a ground point, if it may go there: under the cap, off the camp ground,
   * water no deeper than maxDepthM, and not on top of another stone. Returns 'ok', or why not.
   * @param {number} x @param {number} z
   */
  function layOne(x, z) {
    const s = state();
    if (countKind(s.list, 'stepping') >= S.cap) return 'full';
    if (onCampGround(padNow(), x, z, S.apartM / 2)) return 'camp';
    const d = depthAt(x, z);
    if (d > S.maxDepthM) return 'deep';
    const a2 = S.apartM * S.apartM;
    if (s.list.some((p) => (p.kind === 'stepping' || p.kind === 'stone') && (p.x - x) ** 2 + (p.z - z) ** 2 < a2)) return 'near';
    const piece = makeStepping(piecesSeed, s.nextId, x, z, d, hourIndex(), laying?.run ?? null, S);
    // Never a stone nobody could step back from (F10): in deep water it must reach another stone
    // or ground the walker can stand on.
    if (!stepBack(piece, pond(), ground, depthAt, S)) return 'gap';
    const next = addPiece(s, /** @type {any} */ (piece), S.cap);
    if (!next) return 'full';
    update('pieces', () => next);
    if (laying) { laying.run ??= piece.id; laying.laid.push(piece); laying.last = [x, z]; }
    return 'ok';
  }

  /**
   * The nearest pond stone whose top a view ray crosses within its reach, or null.
   * @param {{ o: ArrayLike<number>, d: ArrayLike<number> }} ray
   */
  function stoneOnRay(ray) {
    let best = null, bestT = Infinity;
    if (Math.abs(ray.d[1]) < 1e-6) return null;
    for (const p of pond()) {
      const t = (topOf(p, ground) - ray.o[1]) / ray.d[1];
      if (!(t > 0) || t >= bestT) continue;
      const x = ray.o[0] + ray.d[0] * t, z = ray.o[2] + ray.d[2] * t;
      if ((x - p.x) ** 2 + (z - p.z) ** 2 <= (p.size * 0.55) ** 2) { best = p; bestT = t; }
    }
    return best;
  }

  /** The flight a ground point lands on, if any. @param {number} x @param {number} z */
  const flightAt = (x, z) => flights().find((f) => flightHeightAt(f, flightGeom(f, ST), x, z) !== null) ?? null;
  /** @type {{ a: number[], b: number[] } | null} */ let cutting = null;
  /** The plan a drag from a to b would make. @param {number[]} a @param {number[]} b */
  const planOf = (a, b) => planFlight(a, b, ground(a[0], a[1]), ground(b[0], b[1]), ST);

  history.setApplier('steps', (/** @type {any} */ cmd, /** @type {'undo'|'redo'} */ dir) => {
    const adding = dir === 'redo';
    // The ground first (busy while a stroke settles: try again shortly), then the record.
    if (!terrain.applyTiles(adding ? cmd.after : cmd.before)) return false;
    const next = adding ? addPiece(state(), cmd.piece, Infinity) : removePiece(state(), cmd.piece.id).state;
    if (next) update('pieces', () => next);
    syncShaping();
    return true;
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
    // Never on the camp ground.
    const came = offCampGround(padNow(), arrivingStones({ seed: piecesSeed, summary, material, ground,
      recipe, hour: hourIndex(), nextId: state().nextId, existing: state().list }));
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
  let pollS = 0, strandS = 1, frameDt = 0;

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
      // A flight is cut into the land; a pile at camp is drawn by src/world/pack/draw.js.
      if (p.kind === 'steps' || p.kind === 'pile') continue;
      if (p.kind === 'raft') {
        const sh = raftShapeOf(p), i = rafts.indexOf(sh), now = raftNow(p, frameDt);
        // Reeds, not stone: drawn plain (no rock scan) and with no damp ring on the water.
        out.push({ x: p.x, z: p.z, y: now.y, yaw: p.yaw, size: p.size, slope: [0, 0], seed: ((p.seed >>> 8) / 16777216) * 10,
          half: [sh.hx, sh.hz], mesh: `raft-${i}`, bone: IDENTITY, plain: true });
        continue;
      }
      if (p.kind === 'stepping') {
        const sp = /** @type {any} */ (p), y = ground(p.x, p.z);
        slabBeing(p.x, p.z, y, y + sp.rise, p.yaw, p.size, p.seed, sp.rise > S.wetM + S.freeboardM[1] ? 0 : S.lean, out, undefined, false, mossOf(p.placedHour));
        continue;
      }
      const sh = shapeOf(p), i = shapes.indexOf(sh);
      const y = ground(p.x, p.z);
      const slope = slopeOf(p, p.size * 0.5);
      const lift = lifts.get(p.id);
      const held = carrying?.id === p.id;
      const angle = lift ? tipAngle(lift.e, timed(recipe.tip, lift)) : 0;
      const dir = lift?.dir ?? [0, 1];
      const reach = 1 / Math.hypot(dir[0] / sh.hx, dir[1] / sh.hz);
      let bone = mul4(leanBone(slope[0], slope[1], recipe.lean), stoneBone(angle, sh.hy * recipe.sink, dir, reach));
      if (held) bone = mul4(raise(liftM / p.size), bone);
      const common = { x: p.x, z: p.z, yaw: p.yaw, size: p.size, slope, seed: (p.seed >>> 8) / 16777216 * 10, half: [sh.hx, sh.hz] };
      out.push({ ...common, y, mesh: `stone-${i}`, bone });
      if (angle > 0.01 || held) out.push({ ...common, y: y + 0.004, mesh: `damp-${i}`, bone: shear(slope), plain: true });
    }
    for (const s of strandShown) logBeing(s, s.key, out);
    for (const t of treads) {
      const moss = mossOf(t.f.placedHour);
      for (const s of t.slabs) slabBeing(s.x, s.z, s.y, s.top, s.yaw, s.size, hash32(t.f.seed, s.shape, Math.round(s.x * 100)), 0, out, s.shape, true, moss);
    }
    return out;
  }

  /**
   * A slab (a pond stone, or one on a Steps tread) as the draw pass wants it: its top at top, its
   * skirt reaching down past the ground at y into it, leaned with the ground by lean (0 upright).
   * @param {number} x @param {number} z @param {number} y the ground @param {number} top @param {number} yaw
   * @param {number} size @param {number} seed @param {number} lean @param {import('../../render/passes/pieces.js').PieceBeing[]} out
   * @param {number} [shape] which slab (else from the seed) @param {boolean} [tread] a Steps tread's short slab
   */
  function slabBeing(x, z, y, top, yaw, size, seed, lean, out, shape, tread = false, moss = 0) {
    const i = shape ?? (seed >>> 0) % slabs.length, sh = (tread ? treadShapes : slabs)[i];
    const slope = slopeOf({ x, z, yaw }, size * 0.5);
    const bone = mul4(leanBone(slope[0], slope[1], lean), raise((top - y) / size - sh.hy));
    out.push({ x, z, y, yaw, size, slope, seed: ((seed >>> 8) / 16777216) * 10, half: [sh.hx, sh.hz], mesh: `${tread ? 'tread' : 'slab'}-${i}`, bone, moss });
  }

  /**
   * How mossy a slab laid at placedHour has grown (doc 09: stepping stones gain moss rims): none for
   * its first startDays, then easing up to `most` by fullDays. World time, so it is as grown after
   * time away as it would have been. @param {number} placedHour
   */
  function mossOf(placedHour) {
    const M = S.moss, days = (hourIndex() - placedHour) / 24;
    const u = Math.min(1, Math.max(0, (days - M.startDays) / (M.fullDays - M.startDays)));
    return M.most * u * u * (3 - 2 * u);
  }

  /**
   * A log as the draw pass wants it: rolled away from you while lifted, raised while carried.
   * @param {{ x: number, z: number, yaw: number, seed: number, size: number, length?: number }} p @param {string} id
   * @param {import('../../render/passes/pieces.js').PieceBeing[]} out
   */
  function logBeing(p, id, out) {
    const len = p.length ?? 1, a = p.size / len;
    const log = logs.of(p);
    const y = ground(p.x, p.z);
    const slope = slopeOf(p, Math.min(0.4, len * 0.3));
    const lift = lifts.get(id);
    const held = carrying?.id === id;
    const angle = lift ? tipAngle(lift.e, timed(D.roll, lift)) : 0;
    // It rolls away from you, so the damp sand it lay on shows on your side of it.
    let bone = mul4(leanBone(slope[0], slope[1], D.lean), logBone(angle, (lift?.dir[0] ?? -1) < 0 ? 1 : -1, a, D.sink));
    if (held) bone = mul4(raise(D.carry.liftM / len), bone);
    const common = { x: p.x, z: p.z, yaw: p.yaw, size: len, slope, seed: (p.seed >>> 8) / 16777216 * 10, half: [(a / 2) * D.ringHalf[0], 0.5 * D.ringHalf[1]] };
    out.push({ ...common, y, mesh: log.key, bone, aspect: a, wear: logWear(p, log.sea) });
    if (angle > 0.01 || held) out.push({ ...common, y: y + 0.004, mesh: 'logdamp', bone: mul4(shear(slope), new Float32Array([a, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])), plain: true });
  }

  /** A kept log's ground, looked at again every refreshS or when it moves. @type {Map<string, { key: string, ds: { damp: number, shade: number }, s: number }>} */
  const grounds = new Map();
  let groundClock = 0;
  /** How damp and shaded a kept log lies (log-age.js). @param {{ id: string, x: number, z: number }} p */
  function groundOf(p) {
    const key = `${p.x.toFixed(2)}:${p.z.toFixed(2)}`;
    let g = grounds.get(p.id);
    if (!g || g.key !== key || groundClock - g.s > D.age.refreshS) {
      const ds = dampShade({ x: p.x, z: p.z, summary: water.getSummary?.(), plants: get('world')?.growth?.plants ?? [], ground, A: D.age });
      g = { key, ds, s: groundClock };
      grounds.set(p.id, g);
    }
    return g.ds;
  }
  /**
   * A log's wear for the draw pass: its time at sea, and a kept log's age and moss where it lies.
   * @param {{ id?: string, x: number, z: number, placedHour?: number }} p @param {number} sea
   */
  function logWear(p, sea) {
    if (p.placedHour === undefined || !p.id) return [sea, 0, 0, 0];
    const now = hourIndex();
    return [sea, logAge(p.placedHour, now, D.age), logMoss(p.placedHour, now, groundOf(/** @type {any} */ (p)), D.age.moss), 0];
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
        if (tipDone(l.e, timed(log ? D.roll : recipe.tip, l))) lifts.delete(id);
      }
      if (pending && (pollS += f.realDt) > 0.5) { pollS = 0; arrive(); }
      if ((strandS += f.realDt) > 0.5) { strandS = 0; refreshStrand(f.displayT / 3600); }
      frameDt = f.realDt;
      raftClock += f.realDt;
      logs.tick(f.realDt);
      groundClock += f.realDt;
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
        if (p.kind === 'steps' || p.kind === 'raft') continue;
        if (p.kind !== 'log') { put(p.x, p.z, p.size * 0.5 * recipe.grassClear); continue; }
        const len = p.length ?? 1, r = p.size * 0.5 + D.grassClearM;
        const n = Math.min(6, Math.max(2, Math.ceil(len / (r * 1.6))));
        const ax = Math.sin(p.yaw), az = Math.cos(p.yaw);
        for (let k = 0; k < n; k++) { const t = (k / (n - 1) - 0.5) * (len - r); put(p.x + ax * t, p.z + az * t, r); }
        // A bowed log's middle, a snapped arm's tip, a root's: its own shape (log-bake.js footprint).
        for (const [fx, fz] of logs.of(p).footprint) {
          const dx = fx * p.size, dz = fz * (len - r);
          put(p.x + az * dx + ax * dz, p.z - ax * dx + az * dz, r * 0.8);
        }
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
     * or log, a pile at camp, or a log lying on the strand (strand: true; its id is its key).
     * @param {number} x @param {number} z
     */
    pieceAt(x, z) {
      const kept = state().list.filter((p) => p.kind === 'stone' || p.kind === 'log' || p.kind === 'pile');
      const all = [...kept.map((p) => ({ ...p, strand: false })), ...strandShown.map((s) => ({ ...s, id: s.key, strand: true }))];
      return pieceAt(all, x, z, tapR(), D.tapReachM);
    },

    /**
     * A kept piece or a strand log by id (its record; a strand log's id is its key), with strand
     * true for one on the strand, or null. @param {string} id
     */
    piece(id) { const f = findPiece(id); return f ? { ...f.piece, strand: !!f.strand } : null; },

    /**
     * A lift under way (L3a: what lives underneath shows while it is up): seconds since it began, how
     * far it is rolled or tipped now (0..1 of its most), and when it will be down again; or null.
     * @param {string} id @returns {{ e: number, up: number, doneS: number, dir: number[] } | null}
     */
    liftNow(id) {
      const l = lifts.get(id);
      if (!l) return null;
      const log = state().list.find((q) => q.id === id)?.kind === 'log' || id.startsWith('drift:');
      const T = timed(log ? D.roll : recipe.tip, l);
      return { e: l.e, up: tipAngle(l.e, T) / ((T.tipDeg * Math.PI) / 180), doneS: T.tipS + T.holdS + T.settleS, dir: l.dir.slice() };
    },

    /**
     * A log's form and time at sea (log-bake.js), and its moss if it is kept (log-age.js): what the
     * journal's Driftwood page learns from a tap. @param {{ id: string, seed: number, size: number, length?: number, x: number, z: number, placedHour?: number, strand?: boolean }} p
     */
    logLook(p) {
      const b = logs.of(p);
      return { form: b.form, sea: b.sea, moss: p.strand ? 0 : logWear(p, b.sea)[2] };
    },

    /** Lift a stone or a log to carry it (the card's Carry). A pile is never carried. @param {string} id @returns {boolean} */
    carry(id) {
      const f = findPiece(id);
      if (!f || f.piece.kind === 'pile') return false;
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
     * reason says which); water and the camp ground keep it carried, the cap puts it back.
     * @param {ArrayLike<number>} p @returns {{ ok: boolean, reason?: 'water' | 'camp' | 'full' | 'gone' }}
     */
    setDown(p) {
      if (!carrying) return { ok: false, reason: 'gone' };
      if ((water.sampleLive?.(p[0], p[2])?.depth ?? 0) > 0.02) return { ok: false, reason: 'water' };
      // The camp ground stays clear: it stays carried, as in water.
      if (onCampGround(padNow(), p[0], p[2], carrying.radius)) return { ok: false, reason: 'camp' };
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
     * Each also says its form and time at sea (log-bake.js), and how aged it is and how damp and
     * shaded it lies (log-age.js), for the fungi's chance and, later, what lives underneath.
     * @returns {{ id: string, seed: number, x: number, z: number, length: number, size: number, placedHour: number, still: boolean,
     *   form: string, sea: number, age: number, damp: number, shade: number,
     *   surface: (t: number, a: number) => { p: number[], n: number[] } }[]}
     */
    keptLogs() {
      return state().list.filter((p) => p.kind === 'log').map((p) => {
        const len = p.length ?? 1, a = p.size / len;
        const bone = mul4(leanBone(...(/** @type {[number, number]} */ (slopeOf(p, Math.min(0.4, len * 0.3)))), D.lean), logBone(0, 1, a, D.sink));
        const pose = { bone, size: len, yaw: p.yaw, at: [p.x, ground(p.x, p.z), p.z] };
        const baked = logs.of(p), mesh = baked.mesh;
        const ds = groundOf(p);
        return { id: p.id, seed: p.seed, x: p.x, z: p.z, length: len, size: p.size, placedHour: p.placedHour,
          form: baked.form, sea: baked.sea, age: logAge(p.placedHour, hourIndex(), D.age), damp: ds.damp, shade: ds.shade,
          still: !lifts.has(p.id) && carrying?.id !== p.id,
          surface: (/** @type {number} */ t, /** @type {number} */ ang) => logSurface(mesh, D.shape.rings, D.shape.around, pose, t, ang) };
      });
    },

    /**
     * `?debug` (window.ebb.debug.keptLog): keep a log at a ground point as if carried there long ago
     * (placedHour daysAgo game days back, or the days a log takes to age fully if more), its shape
     * seeded from the point. Undoable like any set-down.
     * @param {number} x @param {number} z @param {number} daysAgo @returns {string | null} its id, or null at the cap or in water
     */
    debugKeepLog(x, z, daysAgo) {
      if ((water.sampleLive?.(x, z)?.depth ?? 0) > 0.02) return null;
      const s = state();
      const seed = hash32(driftSeed, Math.round(x * 100), Math.round(z * 100), 0xdeb) >>> 0;
      const u = (/** @type {number} */ k) => (hash32(seed, k) >>> 8) / 16777216;
      const log = { x, z, yaw: u(1) * 2 * Math.PI, seed, size: D.thickM[0] + (D.thickM[1] - D.thickM[0]) * (0.5 + 0.5 * u(2)),
        length: D.lengthM[0] + (D.lengthM[1] - D.lengthM[0]) * (0.4 + 0.6 * u(3)) };
      // At least fully aged where it lies (log-age.js), so it shows what an old kept log looks like
      // and always may fruit (autumn.js fungiChance).
      const piece = makeLog(s.nextId, log, hourIndex() - Math.round(Math.max(daysAgo, D.age.fullDays) * 24));
      const next = addPiece(s, piece, D.cap);
      if (!next) return null;
      update('pieces', () => next);
      history.push({ kind: 'piece', bytes: 96, op: 'add', piece });
      sync();
      return piece.id;
    },

    // ---- pond stones (Sculpt's Pond stones mode) ----

    /**
     * A drag (or tap) begins in the Pond stones mode at a ground point: on a pond stone it selects
     * it (the view ray's crossing with each stone's top, since a tall stone in water hides the bed
     * the ground point is on); elsewhere it starts a line with a stone there.
     * @param {ArrayLike<number>} p @param {{ o: ArrayLike<number>, d: ArrayLike<number> }} [ray] camera.ray
     */
    layBegin(p, ray) {
      const hit = (ray && stoneOnRay(ray)) || pieceAt(pond(), p[0], p[2], tapR());
      if (hit) { shapingSel.pond = hit.id; laying = null; syncShaping({ mode: 'pondstones', message: '' }); return; }
      shapingSel.pond = null;
      laying = { run: null, last: null, laid: [], stopped: false };
      const r = layOne(p[0], p[2]);
      if (r === 'near') laying.last = [p[0], p[2]];
      // On the camp ground: no stone here, but the line goes on and lays stones once it is off it.
      else if (r === 'camp') { laying.last = [p[0], p[2]]; syncShaping({ mode: 'pondstones', message: pondWords(r), refused: true }); return; }
      else if (r !== 'ok') { laying.stopped = true; syncShaping({ mode: 'pondstones', message: pondWords(r), refused: true }); return; }
      syncShaping({ mode: 'pondstones', message: '' });
    },

    /**
     * The drag moves on: a stone each stride along it (seeded, with a little sideways nudge),
     * until the water is too deep or the island holds all it can. @param {ArrayLike<number>} p
     */
    layTo(p) {
      if (!laying || laying.stopped || !laying.last) return;
      for (let guard = 0; guard < 16; guard++) {
        const [lx, lz] = laying.last, dx = p[0] - lx, dz = p[2] - lz;
        const d = Math.sqrt(dx * dx + dz * dz);
        const prev = laying.laid[laying.laid.length - 1];
        const stride = strideAfter(prev?.seed ?? hash32(piecesSeed, state().nextId), S);
        if (d < stride) break;
        const ux = dx / d, uz = dz / d, j = jitterOf(hash32(piecesSeed, state().nextId, 0x1a7), S);
        const x = lx + ux * stride - uz * j, z = lz + uz * stride + ux * j;
        const r = layOne(x, z);
        if (r === 'near') { laying.last = [lx + ux * stride, lz + uz * stride]; continue; }
        // A stride that lands on the camp ground is skipped, and the card says why (once).
        if (r === 'camp') {
          laying.last = [lx + ux * stride, lz + uz * stride];
          if (shapingSay.message !== pondWords(r)) syncShaping({ mode: 'pondstones', message: pondWords(r), refused: true });
          continue;
        }
        if (r !== 'ok') { laying.stopped = true; syncShaping({ mode: 'pondstones', message: pondWords(r), refused: true }); break; }
        // The next stride is measured from the line, not the nudged stone, so a line stays straight.
        laying.last = [lx + ux * stride, lz + uz * stride];
      }
      syncShaping();
    },

    /** The drag ends: the line is one step to undo. */
    layEnd() {
      if (laying?.laid.length) {
        history.push({ kind: 'piece', bytes: 64 * laying.laid.length, op: 'addMany', pieces: laying.laid });
        shapingSel.pond = laying.laid[laying.laid.length - 1].id;
      }
      laying = null;
      syncShaping();
    },

    /** Remove a whole line of pond stones (undoable). @param {string} run */
    removeRun(run) {
      const gone = pond().filter((p) => p.run === run);
      if (!gone.length) return;
      let s = state();
      for (const p of gone) s = removePiece(s, p.id).state;
      update('pieces', () => s);
      history.push({ kind: 'piece', bytes: 64 * gone.length, op: 'removeMany', pieces: gone });
      shapingSel.pond = null;
      syncShaping();
    },

    // ---- Steps (Sculpt's Steps mode) ----

    /** A drag begins in the Steps mode: on a flight it selects it; elsewhere it is the flight's first end. @param {ArrayLike<number>} p */
    stepsBegin(p) {
      const hit = flightAt(p[0], p[2]);
      if (hit) { shapingSel.steps = hit.id; cutting = null; syncShaping({ mode: 'steps', message: '' }); return; }
      shapingSel.steps = null;
      cutting = { a: [p[0], p[2]], b: [p[0], p[2]] };
      syncShaping({ mode: 'steps', message: '' });
    },

    /** The drag moves on: the card says, as you go, whether the flight would fit. @param {ArrayLike<number>} p */
    stepsTo(p) {
      if (!cutting) return;
      cutting.b = [p[0], p[2]];
      const plan = planOf(cutting.a, cutting.b);
      const dx = cutting.b[0] - cutting.a[0], dz = cutting.b[1] - cutting.a[1];
      // A flight may not start, end or pass over the camp ground: the card says so as you drag.
      if (crossesCampGround(padNow(), cutting.a, cutting.b, ST.widthM / 2)) {
        if (shapingSay.message !== recipe.words.camp) syncShaping({ mode: 'steps', message: recipe.words.camp, refused: true });
        return;
      }
      // Only once the drag has gone somewhere, and only for a run that wants more.
      if (!plan.ok && plan.reason === 'short' && dx * dx + dz * dz > 0.25) {
        const m = ST.words.short.replace('{m}', (Math.ceil((plan.needM ?? 0) * 2) / 2).toFixed(1));
        if (shapingSay.message !== m) syncShaping({ mode: 'steps', message: m, refused: true });
      } else if (plan.ok && shapingSay.refused) syncShaping({ mode: 'steps', message: '' });
    },

    /** The drag ends: cut the flight if it fits (undoable), or say calmly why not. */
    stepsEnd() {
      const c = cutting;
      cutting = null;
      if (!c) return;
      const dx = c.b[0] - c.a[0], dz = c.b[1] - c.a[1];
      if (dx * dx + dz * dz < 0.04) { syncShaping({ mode: 'steps', message: '' }); return; }
      /** @param {string} key */
      const say = (key) => syncShaping({ mode: 'steps', message: key === 'short' ? shapingSay.message || ST.words.short.replace('{m}', '') : ST.words[key], refused: true });
      if (countKind(state().list, 'steps') >= ST.cap) { say('full'); return; }
      if (crossesCampGround(padNow(), c.a, c.b, ST.widthM / 2)) { syncShaping({ mode: 'steps', message: recipe.words.camp, refused: true }); return; }
      if (depthAt(c.a[0], c.a[1]) > S.wetM || depthAt(c.b[0], c.b[1]) > S.wetM) { say('water'); return; }
      const plan = planOf(c.a, c.b);
      if (!plan.ok) { say(plan.reason); return; }
      const s = state();
      const seed = hash32(piecesSeed, s.nextId, 0x57e95);
      /** @type {any} */ const piece = { id: `p${s.nextId}`, kind: 'steps', x: plan.x, z: plan.z, x2: plan.x2, z2: plan.z2, yaw: 0,
        size: ST.widthM, top: plan.top, bottom: plan.bottom, risers: plan.risers, seed, placedHour: hourIndex() };
      if (crossesGuard(guardMask, piece, ST)) { say('overlap'); return; }
      const cmd = terrain.editCells(flightRect(piece, flightGeom(piece, ST)), (/** @type {any} */ m) => { carveFlight(m, piece, ST); paintFlight(m, piece, ST); });
      if (!cmd) return;
      const next = addPiece(s, piece, ST.cap);
      if (!next) return;
      update('pieces', () => next);
      history.push({ kind: 'steps', bytes: cmd.bytes + 96, piece, before: cmd.before, after: cmd.after });
      shapingSel.steps = piece.id;
      syncShaping({ mode: 'steps', message: '' });
    },

    /** Where a Steps drag is now (its two ends), for the ring. */
    cutting: () => (cutting ? { a: cutting.a.slice(), b: cutting.b.slice() } : null),

    /** The selected pond stone, flight or raft, for the ring. @param {'pondstones' | 'steps' | 'raft'} mode */
    selected(mode) {
      if (mode === 'raft') { const r = raftList().find((q) => q.id === shapingSel.raft); return r ? { x: r.x, z: r.z, radius: r.size * 0.6 } : null; }
      if (mode === 'pondstones') { const p = pond().find((q) => q.id === shapingSel.pond); return p ? { x: p.x, z: p.z, radius: p.size * 0.7 } : null; }
      const f = flights().find((q) => q.id === shapingSel.steps);
      if (!f) return null;
      const g = flightGeom(f, ST);
      return { x: (f.x + f.x2) / 2, z: (f.z + f.z2) / 2, radius: Math.max(g.len / 2 + g.land, g.half) };
    },

    /** Drop the Pond stones, Steps and Raft selections (leaving those modes). */
    deselectShaping() {
      if (shapingSel.pond || shapingSel.steps || shapingSel.raft) { shapingSel.pond = null; shapingSel.steps = null; shapingSel.raft = null; syncShaping(); }
    },

    // ---- reed rafts (the Water tool's Raft mode; the turtles' gift) ----

    /**
     * A tap in the Raft mode: on a raft (where the view ray crosses its top) it selects it; on open
     * fresh water it sets a new one under the cap (undoable); elsewhere the card says why not.
     * @param {ArrayLike<number>} p the ground point @param {{ o: ArrayLike<number>, d: ArrayLike<number> }} ray camera.ray
     */
    raftTap(p, ray) {
      /** @param {string} key */
      const say = (key) => syncShaping({ mode: 'raft', message: RF.words[key], refused: true });
      let hit = null, bestT = Infinity;
      if (Math.abs(ray.d[1]) > 1e-6) for (const r of raftList()) {
        const sh = raftShapeOf(r), top = (raftAt.get(r.id)?.y ?? raftRest(r, sh, ground, depthAt, RF).y) + sh.hy * r.size;
        const t = (top - ray.o[1]) / ray.d[1];
        if (!(t > 0) || t >= bestT) continue;
        const dx = ray.o[0] + ray.d[0] * t - r.x, dz = ray.o[2] + ray.d[2] * t - r.z;
        const c = Math.cos(r.yaw), s = Math.sin(r.yaw), u = c * dx - s * dz, v = s * dx + c * dz;
        if ((u / (sh.hx * r.size)) ** 2 + (v / (0.5 * r.size)) ** 2 <= 1) { hit = r; bestT = t; }
      }
      if (hit) { shapingSel.raft = hit.id; syncShaping({ mode: 'raft', message: '' }); return; }
      shapingSel.raft = null;
      const r = this.raftAdd(p);
      if (!r.ok) { syncShaping({ mode: 'raft', message: r.message, refused: true }); return; }
      shapingSel.raft = r.id;
      syncShaping({ mode: 'raft', message: '' });
    },

    /**
     * Could a reed raft float at a ground point? The same rules as the Raft mode: under the cap, off
     * the camp ground, on fresh open water deep enough under its whole mat, apart from other rafts
     * and stones. Changes nothing (the gift spot's ring, D1a).
     * @param {ArrayLike<number>} p @returns {{ ok: true, piece: any } | { ok: false, reason: string, message: string }}
     */
    raftCheck(p) {
      const no = (/** @type {string} */ reason, msg = RF.words[reason]) => ({ ok: /** @type {false} */ (false), reason, message: msg });
      const s = state();
      if (countKind(s.list, 'raft') >= RF.cap) return no('full');
      const x = p[0], z = p[2];
      // Never on the camp ground (a pond dug beside the pad may reach its edge).
      if (onCampGround(padNow(), x, z, RF.sizeM[1] / 2)) return no('camp', recipe.words.camp);
      // The sea: water whose surface is the tide's (a pond's bed may lie below the tide, its surface not).
      const tide = water.tide ?? -Infinity;
      if (tide > ground(x, z) && ground(x, z) + depthAt(x, z) <= tide + 0.05) return no('sea');
      const piece = makeRaft(piecesSeed, s.nextId, x, z, hourIndex(), RF);
      const sh = raftShapeOf(piece), w = sh.hx * piece.size, l = 0.45 * piece.size;
      const ax = Math.sin(piece.yaw), az = Math.cos(piece.yaw);
      const rim = [[w, 0], [-w, 0], [0, l], [0, -l]].every(([u, t]) => depthAt(x + az * u + ax * t, z - ax * u + az * t) >= RF.rimDepthM);
      if (depthAt(x, z) < RF.minDepthM || !rim) return no('shallow');
      const a2 = RF.apartM * RF.apartM;
      if (s.list.some((q) => (q.kind === 'raft' || q.kind === 'stepping' || q.kind === 'stone') && (q.x - x) ** 2 + (q.z - z) ** 2 < a2)) return no('near');
      return { ok: /** @type {true} */ (true), piece };
    },

    /**
     * Set a reed raft at a ground point if raftCheck allows it (undoable).
     * @param {ArrayLike<number>} p @returns {{ ok: true, id: string } | { ok: false, reason: string, message: string }}
     */
    raftAdd(p) {
      const c = this.raftCheck(p);
      if (!c.ok) return c;
      const next = addPiece(state(), c.piece, RF.cap);
      if (!next) return { ok: false, reason: 'full', message: RF.words.full };
      update('pieces', () => next);
      history.push({ kind: 'piece', bytes: 96, op: 'add', piece: c.piece });
      return { ok: true, id: c.piece.id };
    },

    /**
     * The walker's footing (src/world/walk): the top of a pond stone, or of the line between two
     * of a line's stones, under a point, or -Infinity. @param {number} x @param {number} z
     */
    footing(x, z) {
      let best = -Infinity;
      // A flight's treads, slabs and all: footing, so the walk grid takes each tread as level
      // ground rather than reading the cut's walls beside it as a steep slope.
      for (const t of treads) {
        const g = flightGeom(t.f, ST), h = flightHeightAt(t.f, g, x, z);
        if (h !== null) best = Math.max(best, h + (h < t.f.top - 1e-6 && h > t.f.bottom + 1e-6 ? ST.slab.riseM : 0));
      }
      if (x < pondBox.x0 || x > pondBox.x1 || z < pondBox.z0 || z > pondBox.z1) return best;
      return Math.max(best, footingAt(pond(), linked, ground, S, x, z));
    },

    /**
     * Where the creatures may sit and bask (doc 09, cover type `stone`): every reed raft, loose stone
     * and pond stone, with its top, how far from its middle a sitter may be, and how the water stands now
     * round it (wet: water at its foot; inWater: it stands in water). Sunny until shade is worked out.
     * @returns {{ id: string, kind: string, x: number, y: number, z: number, r: number, cover: 'stone', sunny: boolean, wet: boolean, inWater: boolean }[]}
     */
    seats() {
      // A raft: its top as it floats now (or rests on the mud), always counted as standing in water
      // while afloat; turtles bask on it and herons stand on it.
      const onRafts = raftList().map((p) => {
        const sh = raftShapeOf(p), now = raftAt.get(p.id) ?? raftRest(p, sh, ground, depthAt, RF);
        return { id: p.id, kind: p.kind, x: p.x, y: now.y + sh.hy * p.size, z: p.z, r: Math.max(0.05, sh.hx * p.size - RF.sitInsetM),
          cover: /** @type {'stone'} */ ('stone'), sunny: true, wet: true, inWater: now.afloat };
      });
      return [...onRafts, ...state().list.filter((p) => p.kind === 'stone' || p.kind === 'stepping').map((p) => {
        const sh = p.kind === 'stone' ? shapeOf(p) : slabs[(p.seed >>> 0) % slabs.length];
        const y = p.kind === 'stone' ? ground(p.x, p.z) + sh.hy * p.size * (1 - recipe.sink) : topOf(/** @type {any} */ (p), ground);
        const d = depthAt(p.x, p.z);
        return { id: p.id, kind: p.kind, x: p.x, y, z: p.z, r: Math.max(0.02, Math.min(sh.hx, sh.hz) * p.size - S.sitInsetM), cover: /** @type {'stone'} */ ('stone'),
          sunny: true, wet: d > 0.005 || depthAt(p.x + p.size * 0.6, p.z) > 0.005, inWater: d > S.wetM };
      })];
    },

    dispose() { offLift(); offSummary(); offList(); for (const off of offs) off(); },
  };
}

/** @typedef {ReturnType<typeof createPieces>} Pieces */

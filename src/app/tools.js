// @ts-check
// The shaping tools from above (brushes, water, stones, Plant and Feed), planting on foot, carrying,
// trail notes, undo and the brush ring.
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import * as clock from '../core/clock.js';
import { emitDeferred, on } from '../core/events.js';
import { get as getStore, update as updateStore } from '../core/store.js';
import { onPad } from '../world/camp/layout.js';
import { createPlantTool } from '../world/growth/plant-tool.js';
import { createSowing } from '../world/sowing/index.js';
import { createPlanting } from '../world/sowing/planting.js';
import { mountSowOverlay } from '../ui/sow-overlay.js';
import { keptFamily } from '../world/expansion.js';
import { addFirst, keptFirsts, seenMark } from '../world/trails.js';
import { mountFishingOverlay } from '../ui/fishing-overlay.js';
import { history } from '../input/actions.js';

/** @param {import('./context.js').AppContext} ctx */
export function start(ctx) {
  const { camera, campRecipe, creatures, fishing, flora, groundAt, growth, growthRecipe, nets, netsRecipe, pack, pieces, piecesRecipe, presence, rb, schools, sowingRecipe, terrain, terrainRecipe, walk, walkerRecipe, water, world, ww } = ctx;
  // The input's shared state (src/app/pointer.js): the pointer, the stroke, a held pour, undo waiting.
  const S = ctx.input;
  const tools = () => getStore('tools');
  /** @returns {import('../world/terrain/brushes.js').Brush} */
  function currentBrush() {
    const t = tools();
    const kind = t.tool === 'sculpt' ? t.sculptMode : t.tool === 'smooth' ? 'smooth' : 'paint';
    return { kind, radius: t.size, strength: t.strength, layer: t.paintLayer, height: t.cliffHeight ?? terrainRecipe.cliff.heightDefault, sea: S.shiftHeld };
  }
  const isCliffMode = () => tools().tool === 'sculpt' && (tools().sculptMode === 'terrace' || tools().sculptMode === 'cut');
  /** @param {number} size */
  const clampSize = (size) => Math.min(rb.radiusRange[1], Math.max(rb.radiusRange[0], size));

  function finishStroke() {
    if (!S.stroking) { S.wantStroke = false; return; }
    S.stroking = false;
    S.wantStroke = false;
    // Plants whose ground rose past their bury depth go under, and ride in the undo (bury.js).
    terrain.endStroke().then((cmd) => { if (cmd) history.push(growth.buryFor(cmd)); });
  }

  // ---- the water tool (docs/07): pour and drain while held; springs on tap (when unlocked) ----
  /**
   * The camp ground stays clear (docs/future/13 CP-01): true when a ground point is on the live pad
   * (store slice `campPad`), after saying so in one quiet line on the island unless `quiet`.
   * @param {ArrayLike<number>} p @param {boolean} [quiet]
   */
  function onCampPad(p, quiet = false) {
    if (!onPad(getStore('campPad') ?? null, p[0], p[2])) return false;
    // On the tool card's own line, since the island notes step aside while a card is open on narrower windows.
    if (!quiet) updateStore('campUi', () => ({ message: campRecipe.words.clear, refused: true, at: performance.now() }));
    return true;
  }
  /** The pour held over the pad has said so once this press. */
  let pourRefusedOnPad = false;

  /** Each frame while pour or drain is held: the brush source under the pointer. No water is poured on the camp pad. */
  function updatePour() {
    const t = tools();
    let p = S.pouring && t.tool === 'water' ? groundAt(S.pouring.x, S.pouring.y) : null;
    if (!S.pouring) pourRefusedOnPad = false;
    if (p && t.waterMode === 'pour' && onCampPad(p, pourRefusedOnPad)) { pourRefusedOnPad = true; p = null; }
    if (p) presence.edit(p[0], p[2]);
    ww.holdBrush(p, t);
  }

  /** Tap with the spring mode: select a placed spring, or place a new one under the cap. @param {number} x @param {number} y */
  function springTap(x, y) {
    if (!getStore('unlocks')?.springs) return;
    const p = groundAt(x, y);
    // A spring already there (an older island's) can still be selected; a new one is refused on the pad.
    if (p && !ww.water.springAt(p[0], p[2], 1.0) && onCampPad(p)) return;
    if (p) ww.tapSpring(p, tools().springRate);
  }

  /**
   * Sculpt's Stone mode (docs/future/10): set a seeded boulder where you tap, undoable. The size slider
   * is the boulder's width, within terrain.json stone.widthM. @param {number} x @param {number} y
   */
  function stoneTap(x, y) {
    const p = groundAt(x, y);
    if (!p) return;
    presence.edit(p[0], p[2]);
    const [wMin, wMax] = terrainRecipe.stone.widthM;
    const cmd = terrain.stampStone(p, Math.min(wMax, Math.max(wMin, tools().size)) / 2);
    if (cmd) { history.push(growth.buryFor(cmd)); emitDeferred('terrain:stone-set', { x: p[0], z: p[2] }); }
  }

  /** Sculpt's Loose stone mode: select a placed stone, or set one under the cap (src/world/pieces). @param {number} x @param {number} y */
  function looseStoneTap(x, y) {
    if (!getStore('unlocks')?.stones) return;
    const p = groundAt(x, y);
    if (!p) return;
    // A stone already there can still be selected; a new one is refused on the camp pad.
    if (!pieces.pieceAt(p[0], p[2]) && onCampPad(p)) return;
    presence.edit(p[0], p[2]);
    pieces.tap(p);
  }

  /**
   * Sculpt's Pond stones and Steps modes (src/world/pieces): a drag lays a line of stones, or cuts
   * a flight from where it began to where it ends; a tap on one selects it.
   * @type {'pondstones' | 'steps' | null}
   */
  let shapingDrag = null;
  /** @param {'tool.begin' | 'tool.move'} type @param {number} x @param {number} y */
  function shapingDragTo(type, x, y) {
    const mode = tools().sculptMode;
    if ((mode === 'pondstones' && !getStore('unlocks')?.pondStones) || (mode === 'steps' && !getStore('unlocks')?.steps)) return;
    const p = groundAt(x, y);
    if (!p) return;
    if (type === 'tool.begin') {
      finishShapingDrag();
      shapingDrag = mode;
      presence.edit(p[0], p[2]);
      if (mode === 'pondstones') pieces.layBegin(p, camera.ray(x, y)); else pieces.stepsBegin(p);
    } else if (shapingDrag === 'pondstones') pieces.layTo(p);
    else if (shapingDrag === 'steps') pieces.stepsTo(p);
  }
  function finishShapingDrag() {
    if (shapingDrag === 'pondstones') pieces.layEnd();
    else if (shapingDrag === 'steps') pieces.stepsEnd();
    shapingDrag = null;
  }

  // The Plant tool (src/world/growth/plant-tool.js): plants a seed where the ground suits it, rings where.
  // A tap on the camp pad is refused with the camp's words (CP-16, recipes/world/camp.json).
  const plantTool = createPlantTool({ growth, world, flora, recipe: growthRecipe.marks, campWords: campRecipe?.words ?? null });
  /** @param {number} x @param {number} y */
  function plantTap(x, y) {
    const p = groundAt(x, y);
    if (p) presence.edit(p[0], p[2]);
    if (p && plantTool.tap(tools().plantSpecies ?? 'reeds', p)) updateStore('world', () => world.state);
  }
  // Planting on foot (D1a, src/world/sowing): the seed tin, the gift spot and the net in hand, the
  // ring under the pointer, a click to sow, place or set; drawn over the island by sow-overlay.js.
  // P2g (src/world/sowing/planting.js): saved seed, seed balls, clumps and withies from the pack, and
  // the plant card's Lift with the shovel.
  const planting = createPlanting({ recipe: sowingRecipe, plantTool, growth, pack, flora, walk,
    hasShovel: () => !!getStore('cook')?.tools?.includes('shovel'), plants: () => world.state?.growth?.plants ?? [],
    ground: (x, z) => terrain.sampleHeight(x, z), worldChanged: () => updateStore('world', () => world.state) });
  const sowing = createSowing({ recipe: sowingRecipe, plantTool, pieces, nets, fishing, walk, planting,
    ground: (x, z) => terrain.sampleHeight(x, z),
    depth: (x, z) => water.sampleLive(x, z)?.depth ?? 0,
    worldChanged: () => updateStore('world', () => world.state) });
  updateStore('hand', () => null);
  const sowOverlay = mountSowOverlay(document.body, sowingRecipe);
  const fishingOverlay = mountFishingOverlay(document.body);

  // The Feed tool (S6c-2, src/world/creatures/feeding.js): food lands where you tap and a frog may
  // come for it. Not an edit: a gentle toss never startles. Its line goes to the tool card (`feedUi`).
  /** @param {number} x @param {number} y */
  function feedTap(x, y) {
    const p = groundAt(x, y);
    if (!p) return;
    // Who you are feeding: the chosen chip, else the first found (as the tool shows it, src/ui/tools.js).
    const known = ['frogs', ...schools.map((s) => s.id)].filter((id) => getStore('journal')?.species?.[id]?.ever);
    const chosen = tools().feedSpecies;
    const sp = chosen && known.includes(chosen) ? chosen : known[0] ?? 'frogs';
    const school = schools.find((s) => s.id === sp);
    const message = school ? school.feed(p[0], p[2]) : creatures.feed(p[0], p[2]);
    updateStore('feedUi', () => ({ message, at: performance.now() }));
  }

  /**
   * Feed from the hand (W4, only on foot): you kneel and the food goes down just in front of you.
   * Food in the water is for a school you have found (the minnows), on land for the frogs. Its line
   * goes on the island.
   */
  function feedHere() {
    const p = walk.feedPoint();
    if (!p) return;
    const known = schools.filter((s) => getStore('journal')?.species?.[s.id]?.ever);
    const wet = (water.sampleLive(p[0], p[2])?.depth ?? 0) > 0.03;
    const message = wet && known.length ? known[0].feed(p[0], p[2])
      : getStore('journal')?.species?.frogs?.ever || !known.length ? creatures.feed(p[0], p[2]) : walkerRecipe.words.feedNone;
    if (message) emitDeferred('island:notice', { text: message, showS: walkerRecipe.words.noticeS });
  }

  /** Where a piece or a pile stands, for a gesture toward it. @param {string} id */
  function pieceSpot(id) {
    const p = pieces.piece(id);
    return p ? { x: p.x, z: p.z } : undefined;
  }

  /**
   * Set a carried stone or log down where the tap lands (src/world/pieces, undoable). In water it
   * stays carried and the card says so; at the logs' cap it goes back and the card says that.
   * @param {number} x @param {number} y
   */
  function carryTap(x, y) {
    const p = groundAt(x, y);
    if (!p) return;
    presence.edit(p[0], p[2]);
    const was = pieces.carrying();
    const r = pieces.setDown(p);
    if (r.ok) updateStore('identify', () => null);
    // A lantern set down somewhere new (B2 L1) says it still lights itself there.
    if (r.ok && was?.kind === 'lantern') emitDeferred('island:notice', { text: piecesRecipe.lantern.words.moved, showS: 5 });
    else {
      // Water and the camp ground keep it carried, with a line saying why; the cap puts it back.
      const still = r.reason === 'water' || r.reason === 'camp';
      updateStore('identify', (c) => (c ? { ...c, carrying: still, carryNote: r.reason === 'gone' ? null : r.reason, canCarry: still } : c));
    }
  }

  /**
   * A keepsake kept, noted for good in the saved unlocks: its family (src/world/expansion.js gives the
   * general net at four), and the beachcomber's firsts it brings (src/world/trails.js: its family,
   * its rarity, its mark). @param {any} n its numbers
   */
  function noteKept(n) {
    if (!n?.family) return;
    updateStore('unlocks', (u) => {
      let earned = keptFamily(u?.earned, n.family);
      for (const f of keptFirsts(n, clock.hourIndex())) earned = addFirst(earned, f);
      return { ...u, earned };
    });
  }
  /** Firsts for the trails (a mark seen, a place made): written once, for good. @param {import('../world/trails.js').First | null} f */
  function noteFirst(f) {
    if (f) updateStore('unlocks', (u) => { const earned = addFirst(u?.earned, f); return earned === u?.earned ? u : { ...u, earned }; });
  }
  // A keepsake with a mark seen, on the beach or on the haul tray: noticing is enough.
  on('keepsake:seen', (/** @type {{ n: any }} */ p) => noteFirst(seenMark(p.n, clock.hourIndex())));

  /** @param {'undo'|'redo'} dir */
  function runHistory(dir) {
    const ok = dir === 'undo' ? history.undo() : history.redo();
    S.queuedHistory = ok ? null : dir; // busy: retry once the stroke has settled
  }

  /** Keep the brush ring on the ground under the pointer, even as the camera moves. */
  function updateRing() {
    const t = tools();
    // Spring mode marks the selected spring, else a small ring where a tap would place one.
    if (t.tool === 'water' && t.waterMode === 'spring') {
      const sel = getStore('waterUi')?.selectedId;
      const s = sel ? water.springs().find((x) => x.id === sel) : null;
      const p = !s && S.pointer.inside ? groundAt(S.pointer.x, S.pointer.y) : null;
      if (s) terrain.setRing({ x: s.x, z: s.z, radius: 0.8, visible: true });
      else if (p) terrain.setRing({ x: p[0], z: p[2], radius: 0.6, visible: true });
      else terrain.setRing({ visible: false });
      return;
    }
    // Raft mode: round the selected raft, else where a tap would set one.
    if (t.tool === 'water' && t.waterMode === 'raft') {
      const sel = pieces.selected('raft');
      const p = !sel && S.pointer.inside ? groundAt(S.pointer.x, S.pointer.y) : null;
      terrain.setRing(sel ? { ...sel, visible: true, level: null } : p ? { x: p[0], z: p[2], radius: 0.6, visible: true, level: null } : { visible: false, level: null });
      return;
    }
    // Net mode: a ring where a tap would cast the net.
    if (t.tool === 'water' && t.waterMode === 'net') {
      const p = S.pointer.inside ? groundAt(S.pointer.x, S.pointer.y) : null;
      terrain.setRing(p ? { x: p[0], z: p[2], radius: netsRecipe.look.netWidthM / 2, visible: true, level: null } : { visible: false, level: null });
      return;
    }
    // Carrying a stone or a log: a ring where a tap would set it down.
    const held = !t.tool ? pieces.carrying() : null;
    if (held) {
      const p = S.pointer.inside ? groundAt(S.pointer.x, S.pointer.y) : null;
      terrain.setRing(p ? { x: p[0], z: p[2], radius: held.radius, visible: true, level: null } : { visible: false, level: null });
      return;
    }
    // Loose stone mode marks the selected stone, else a small ring where a tap would set one.
    if (t.tool === 'sculpt' && t.sculptMode === 'loosestone') {
      terrain.setRing({ ...pieces.ring(S.pointer.inside ? groundAt(S.pointer.x, S.pointer.y) : null), level: null });
      return;
    }
    // Pond stones and Steps mark the selected stone or flight, else where a drag would begin: a
    // stone's width, or a flight's, round the pointer (and its far end while cutting).
    if (t.tool === 'sculpt' && (t.sculptMode === 'pondstones' || t.sculptMode === 'steps')) {
      const sel = pieces.selected(t.sculptMode);
      const p = S.pointer.inside ? groundAt(S.pointer.x, S.pointer.y) : null;
      if (sel) terrain.setRing({ ...sel, visible: true, level: null });
      else if (p) terrain.setRing({ x: p[0], z: p[2], radius: t.sculptMode === 'steps' ? 0.8 : 0.3, visible: true, level: null });
      else terrain.setRing({ visible: false, level: null });
      return;
    }
    const p = t.tool && S.pointer.inside ? groundAt(S.pointer.x, S.pointer.y) : null;
    // The Plant tool marks just the spot a seed would go; Feed, where the food would land.
    // Terrace and Cut also draw a thin line where the ground meets the shelf's level (docs/15).
    const level = !p || !isCliffMode() ? null : terrain.strokeLevel() ?? terrain.cliffLevelAt(currentBrush(), p);
    if (p) terrain.setRing({ x: p[0], z: p[2], radius: t.tool === 'plant' ? 0.4 : t.tool === 'feed' ? 0.2 : t.size, visible: true, level });
    else terrain.setRing({ visible: false, level: null });
  }
  Object.assign(ctx, { tools, currentBrush, isCliffMode, clampSize, finishStroke, updatePour, springTap, stoneTap, looseStoneTap, shapingDragTo, finishShapingDrag, plantTool, plantTap, planting, sowing, sowOverlay, fishingOverlay, feedTap, feedHere, pieceSpot, carryTap, noteKept, noteFirst, runHistory, updateRing });
}

// @ts-check
// Pointing and clicking: what a tap or a rest lands on, the hover tag, walking with the keys and the
// mouse, and where the pointer aims.
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import { emitDeferred, on } from '../core/events.js';
import { get as getStore, update as updateStore } from '../core/store.js';
import { liftFor } from '../render/lift.js';
import { dispatch } from '../input/actions.js';
import { createWalkControls } from '../world/walk/controls.js';
import { clickKind, clickPlan } from '../world/walk/click.js';

/** @param {import('./context.js').AppContext} ctx */
export function start(ctx) {
  const { cairns, camera, camp, canvas, lanterns, perchSticks, pieces, sketchRecipe, spreadOf, terrain, walk, walkerRecipe, water, zoneCardAt, zones } = ctx;
  // ---- tools and strokes ----
  /**
   * The input's shared state (src/app/tools.js and actions.js change it, the frame reads it): the
   * pointer over the canvas from above, a stroke under way or wanted, an undo or redo waiting for a
   * stroke to settle, Shift held at a stroke's start (desktop: Terrace and Cut level to mean sea
   * level), the screen point of a held pour or drain, and where the pointer is on the canvas while
   * something is in hand (CSS pixels; the sowing ring is re-cast under it every frame).
   */
  ctx.input = { pointer: { x: 0, y: 0, inside: false }, stroking: false, wantStroke: false,
    queuedHistory: /** @type {null | 'undo' | 'redo'} */ (null), shiftHeld: false,
    pouring: /** @type {null | { x: number, y: number }} */ (null), sowScreen: /** @type {number[] | null} */ (null) };
  const S = ctx.input;

  /** @param {number} x @param {number} y */
  /**
   * The stone or log a tap below lands on (L3a): low down, the ray grazes past a log onto the ground
   * behind it, so it is tried where it passes a little over the ground too, nearest first.
   * @param {number} x @param {number} y @param {number[]} point the ground the tap landed on
   */
  function pieceUnderTap(x, y, point) {
    const r = camera.ray(x, y);
    // What sits up on the hearth or by the fire (a pot, the cup, a piece firing) wins over the ring
    // under it: the ray is tried against each one's own height.
    const lifted = camp.liftedUnderRay(r.o, r.d);
    if (lifted) return lifted;
    // A perch stick stands up out of the water (B1 P1): the ray is tried against the stick itself.
    const stick = perchSticks.underRay(r.o, r.d);
    if (stick) return /** @type {any} */ (stick);
    // So does a lantern on its post (B2 L1).
    const lamp = lanterns.underRay(r.o, r.d);
    if (lamp) return /** @type {any} */ (lamp);
    // A cairn stands up off the ground too (docs/future/14).
    const cairn = cairns.underRay(r.o, r.d);
    if (cairn) return /** @type {any} */ (cairn);
    for (const h of [0.3, 0.2, 0.12, 0.05]) {
      if (r.d[1] > -1e-4) break;
      const t = (point[1] + h - r.o[1]) / r.d[1];
      if (!(t > 0)) continue;
      const hit = pieces.pieceAt(r.o[0] + r.d[0] * t, r.o[2] + r.d[2] * t);
      if (hit) return hit;
    }
    return pieces.pieceAt(point[0], point[2]);
  }
  /**
   * What a ground point holds, as a card (the journal's cardAt), and the journal's species words;
   * main.js hands these in once the journal exists (setCards, src/app/api.js). Null until then.
   * @type {{ cardAt: (x: number, z: number, y?: number) => any, species: Record<string, any> } | null}
   */
  ctx.cards = null;
  /** A thing you clicked on and are walking to: its card opens when you stop. @type {number[] | null} */
  let cardOnArrival = null;

  /**
   * A click below (src/world/walk/click.js): walk, walk to a thing then open its card, or open a card
   * where you stand. A walk elsewhere puts away the card that was open (not a Show me ring).
   * @param {number} sx @param {number} sy CSS pixels @param {number[]} p the ground point
   */
  function clickBelow(sx, sy, p) {
    const card = ctx.cards?.cardAt(p[0], p[2], p[1]) ?? null;
    const kind = clickKind(card, ctx.cards?.species ?? {});
    const wx = card?.wx ?? p[0], wz = card?.wz ?? p[2];
    // A thing out in the water (a perch stick) opens from the bank: its reach is wider than its ring.
    const plan = clickPlan(kind, walk.distTo(wx, wz), card?.reachR ?? card?.r ?? 0, walkerRecipe.click, !!card?.gathers?.length);
    cardOnArrival = null;
    if (plan.kind === 'card') { emitDeferred('look:tapped', { x: sx, y: sy, point: p }); return; }
    if (!getStore('identify')?.pinned) updateStore('identify', () => null);
    if (plan.kind === 'approach') {
      if (walk.tap(sx, sy, [wx, p[1], wz], plan.reachM)) cardOnArrival = p;
      return;
    }
    walk.tap(sx, sy, p);
  }

  /**
   * What the walker would sketch (P2i): the creature, plant or find nearest the middle of the view,
   * within reach. The view is sampled in rings out from its middle through the journal's cards, so
   * the first one found is the nearest the middle. Null above, or with nothing there.
   * @returns {{ id: string, name: string, x: number, z: number } | null}
   */
  function sketchSubject() {
    if (!walk.below || !ctx.cards || zones.active()) return null;
    const w = canvas.clientWidth, h = canvas.clientHeight, s = sketchRecipe.viewSampleSpreadPx ?? 70;
    for (let ring = 0; ring <= 4; ring++) {
      for (let k = 0; k < (ring ? 8 : 1); k++) {
        const a = (k / 8) * 2 * Math.PI, p = groundAt(w / 2 + Math.cos(a) * ring * s, h / 2 + Math.sin(a) * ring * s);
        const c = p ? ctx.cards.cardAt(p[0], p[2], p[1]) : null;
        if (!c?.sp || !sketchRecipe.subjects.includes(c.sp)) continue;
        const x = c.wx ?? p?.[0] ?? 0, z = c.wz ?? p?.[2] ?? 0;
        // Named by its kind, singular and without its article ("school of minnows"), never a frog's own name.
        const sw = ctx.cards.species?.[c.sp], name = String(sw?.card ?? sw?.name ?? c.name ?? c.sp).replace(/^(a|an|the) /i, '');
        if (walk.distTo(x, z) <= sketchRecipe.reachM) return { id: c.sp, name, x, z };
      }
    }
    return null;
  }

  /**
   * After a Set down or Take up on a pile's or a store's card: the card again as it is now (the
   * pile's new size, or the store empty), kept where it is on screen; closed if nothing is there.
   */
  function refreshStoreCard() {
    const c = getStore('identify');
    if (!c || !(c.piece || c.store) || !ctx.cards) return;
    const next = ctx.cards.cardAt(c.wx, c.wz);
    updateStore('identify', () => (next ? { ...next, x: c.x, y: c.y, at: performance.now() } : null));
  }

  /**
   * Hovering below: what a click there would use (null over plain walking ground). Names what a
   * click would gather when there is something (else the thing itself), at the thing's own spot.
   * @param {number} ox @param {number} oy canvas point
   * @returns {{ key: string, name: string, wx: number, wz: number, lift: import('../render/lift.js').LiftTarget[] } | null}
   */
  function hoverPick(ox, oy) {
    // Down in a zone (the spring's cave): its own cards, as its tap finds them (zoneCardAt).
    if (walk.below && zones.active()) {
      const c = zones.busy() ? null : zoneCardAt(ox, oy).card;
      return c ? { key: `${c.sp}|${Math.round(c.wx * 10)}|${Math.round(c.wz * 10)}`, name: c.name, wx: c.wx, wz: c.wz, lift: [] } : null;
    }
    if (!walk.below || !ctx.cards || zones.active()) return null;
    const p = groundAt(ox, oy);
    const pc = p ? pieceUnderTap(ox, oy, p) : null;
    const q = pc && p ? [pc.x, p[1], pc.z] : p;
    const card = q ? ctx.cards.cardAt(q[0], q[2], q[1]) : null;
    if (!card || !q) return null;
    const plan = clickPlan(clickKind(card, ctx.cards.species), walk.distTo(card.wx ?? q[0], card.wz ?? q[2]), card.reachR ?? card.r ?? 0, walkerRecipe.click, !!card.gathers?.length);
    if (plan.kind === 'walk') return null;
    const g = card.gathers?.[0];
    const at = g?.spot ? [g.spot.x, g.spot.z] : Number.isFinite(g?.x) ? [g.x, g.z] : [card.wx ?? q[0], card.wz ?? q[2]];
    const name = g?.name ?? card.name;
    return { key: `${name}|${Math.round(at[0] * 10)}|${Math.round(at[1] * 10)}`, name, wx: at[0], wz: at[1], lift: liftFor(card, spreadOf) };
  }
  /**
   * The hover tag (F4; src/ui/hover-tag.js reads the store slice `hover`): the hand cursor follows
   * the pointer a few times a second, but the tag names a thing only once the pointer rests on it
   * (recipes/world/walker.json click.hoverRestS), sits over the thing and never chases the pointer.
   * Moving onto another thing hides it until a new rest.
   */
  let hoverAt = 0, restTimer = 0, restX = -1e9, restY = -1e9;
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    // Photo mode names nothing and lifts nothing: what is under the pointer stays as it is in the picture.
    if (getStore('photo')?.open) { hoverOff(); return; }
    const C = walkerRecipe.click;
    const ox = e.offsetX, oy = e.offsetY;
    // Something in hand (D1a): the sowing ring follows the pointer, and nothing else is named.
    if (walk.below && getStore('hand')) {
      S.sowScreen = e.buttons ? null : [ox, oy];
      ctx.sowing.setPointer(S.sowScreen ? aimAt(ox, oy) : null);
      if (getStore('hover')) updateStore('hover', () => null);
      canvas.classList.remove('ebb-can-use');
      return;
    }
    if (Math.hypot(ox - restX, oy - restY) > (C.hoverRestPx ?? 4)) {
      restX = ox; restY = oy;
      clearTimeout(restTimer);
      restTimer = e.buttons ? 0 : window.setTimeout(() => {
        const h = hoverPick(ox, oy);
        if (h && h.key !== getStore('hover')?.key) updateStore('hover', () => h);
      }, (C.hoverRestS ?? 0.25) * 1000);
    }
    const now = performance.now();
    if (now - hoverAt < 1000 / C.hoverHz) return;
    hoverAt = now;
    const h = e.buttons ? null : hoverPick(ox, oy);
    const was = getStore('hover');
    if (was && was.key !== h?.key) updateStore('hover', () => null);
    canvas.classList.toggle('ebb-can-use', !!h);
  });
  const hoverOff = () => {
    clearTimeout(restTimer); restX = restY = -1e9;
    if (getStore('hover')) updateStore('hover', () => null);
    canvas.classList.remove('ebb-can-use');
  };
  canvas.addEventListener('pointerleave', () => { hoverOff(); S.sowScreen = null; ctx.sowing.setPointer(null); });
  canvas.addEventListener('pointerdown', hoverOff);

  // ---- walking with the keys and the mouse (WASD; src/world/walk/controls.js) ----
  /** What the centre dot rests on, and since when (ms): its tag shows after hoverRestS, as a pointer's rest. */
  let dotKey = '', dotSince = 0;
  const walkControls = createWalkControls({
    canvas, walk, camera, recipe: walkerRecipe,
    // A card or panel over the view: keys wait, and the pointer is freed to use it.
    open: () => !!getStore('identify') || !!getStore('journalUi')?.open || !!getStore('haul') || !!getStore('shelfPending')
      || !!getStore('sketchbookUi')?.open || !!getStore('stationView') || !!getStore('keeperUi')?.open || !!getStore('photo')?.open,
    aiming: () => !!getStore('hand'),
    use: (x, y) => dispatch({ type: 'look.tap', x, y, source: 'mouse' }),
    hover: (x, y) => {
      if (getStore('hand')) { ctx.sowing.setPointer(aimAt(x, y)); return; }
      const h = hoverPick(x, y), key = h?.key ?? '', now = performance.now();
      if (key !== dotKey) { dotKey = key; dotSince = now; if (getStore('hover')) updateStore('hover', () => null); }
      else if (h && now - dotSince >= walkerRecipe.click.hoverRestS * 1000 && getStore('hover')?.key !== key) updateStore('hover', () => h);
    },
    pan: (dx, dy) => camera.pan(dx, dy),
  });
  // A movement key or a roll takes over from a click walk: the card it would open, and a walk to sow, are let go.
  on('walk:keys', () => { cardOnArrival = null; ctx.sowing.cancelWalk(); });

  /** Each frame: you reached the thing you clicked on, so its card opens beside it. */
  function arriveForCard() {
    if (!cardOnArrival) return;
    if (!walk.below) { cardOnArrival = null; return; }
    if (walk.busy()) return;
    const p = cardOnArrival;
    cardOnArrival = null;
    const at = getStore('view')?.project?.(p[0], p[2]);
    emitDeferred('look:tapped', { x: at?.x ?? ctx.size.cssW / 2, y: at?.y ?? ctx.size.cssH / 2, point: p });
  }

  function groundAt(x, y) {
    const r = camera.ray(x, y);
    const hit = terrain.raycast(r.o, r.d);
    if (!hit.hit) return null;
    const ob = terrain.openBounds();
    const [px, , pz] = hit.point;
    if (px < ob.openMin[0] || px > ob.openMax[0] || pz < ob.openMin[1] || pz > ob.openMax[1]) return null;
    return hit.point;
  }
  /**
   * Where the pointer aims: the ground, or with the fishing line in hand (F17) the sea's surface
   * under the pointer where the ray meets water first, so the cast ring stays under the cursor
   * instead of sliding out to where the ray reaches the sea bed. @param {number} x @param {number} y
   */
  function aimAt(x, y) {
    const g = groundAt(x, y);
    if (getStore('hand')?.kind !== 'line') return g;
    const r = camera.ray(x, y);
    if (r.d[1] >= -1e-4) return g;
    const t = (water.tide - r.o[1]) / r.d[1];
    if (t <= 0) return g;
    const px = r.o[0] + r.d[0] * t, pz = r.o[2] + r.d[2] * t, gy = terrain.sampleHeight(px, pz);
    // Water there, and met before the ground: aim at the surface.
    if (gy >= water.tide) return g;
    if (g && Math.hypot(g[0] - r.o[0], g[1] - r.o[1], g[2] - r.o[2]) < t * Math.hypot(r.d[0], r.d[1], r.d[2])) return g;
    const ob = terrain.openBounds();
    if (px < ob.openMin[0] || px > ob.openMax[0] || pz < ob.openMin[1] || pz > ob.openMax[1]) return g;
    return [px, gy, pz];
  }
  Object.assign(ctx, { pieceUnderTap, clickBelow, sketchSubject, refreshStoreCard, hoverOff, walkControls, arriveForCard, groundAt, aimAt });
}

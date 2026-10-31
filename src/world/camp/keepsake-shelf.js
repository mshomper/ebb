// @ts-check
// The keepsake shelf at camp, live (B2, Matt, October 30, 2026; docs/future/12, docs/future/13):
//
//   Made at the workbench from a stick, woven twigs and rush cord (cook.json makes `keepsake-shelf`,
//   out 'slot' into the `shelf` slot beside the tent, turned to face the pad's middle), and drawn with
//   its model (assets/models/camp/keepsake-shelf.glb, through the camp's props pass). The keepsakes
//   kept in the Keeper book's Shelf tab (the store slice `keepsakes`, src/world/keepsakes/shelf.js)
//   stand in its sixteen spots in the same order, each rebuilt from its saved numbers as the tab
//   rebuilds them, and turned and sized to sit well (shelf-fit.js). Keep one or let one go and the
//   shelf follows at once.
//   Its card: Look along the shelf opens the Keeper book's Shelf tab (`ui.keeper`); the letter tin on
//   top opens the letters read. Clicked from above, the view eases round to look at it.
//
// Nothing here is saved but the slot record the make writes (model.js); the keepsakes are the
// keepsakes section's.

import { get, update, subscribe } from '../../core/store.js';
import { dispatch, onAction } from '../../input/actions.js';
import { registerCardAction } from '../../ui/card-actions.js';
import { createCreaturePass } from '../../render/passes/creatures.js';
import { packMesh } from '../creatures/bodies.js';
import { keepsakeMesh } from '../keepsakes/families/index.js';
import { cleanShelf, SHELF_CAP } from '../keepsakes/shelf.js';
import { inSlot } from './model.js';
import { shelfFit, shelfPoint, rayShelfBox, shelfLook } from './shelf-fit.js';

/**
 * @param {{ R: any, K: any, camp: () => import('./model.js').Camp, where: import('./where.js').Where,
 *   frame: { addProps: (f: () => import('../../render/passes/props.js').Prop[]) => void },
 *   camera?: any, below: () => boolean }} k
 *   R: recipes/world/camp.json; K: recipes/world/keepsakes.json (the families' numbers, for the
 *   meshes; null: the shelf stands empty); camera: eased to the shelf when it is clicked from above;
 *   below: whether you are down on foot
 */
export function createKeepsakeShelf(k) {
  const S = k.R.keepsakeShelf, W = k.R.words.keepsakeShelf ?? {};
  const pass = createCreaturePass({ recipe: { body: { scaleReal: [S.pass.lengthM, S.pass.lengthM], contactShadow: 0, wetSpecular: { roughness: S.pass.roughness, strength: 0 } } },
    maxBones: 1, name: 'camp-shelf', liftGroup: 'props' });
  /** Meshes on the GPU by key (a keepsake's numbers and its entry's seed). @type {Set<string>} */ const meshes = new Set();

  const built = () => !!inSlot(k.camp(), 'shelf');
  /** Where the shelf stands, its +z toward the pad's middle, or null before it is made. */
  const at = () => (built() ? k.where.slotAt('shelf') : null);
  /** Where you stand to look at it: in the room kept clear in front of it. */
  function standAt() {
    const a = at();
    if (!a) return null;
    const p = shelfPoint(a, [0, 0, (a.slot.d ?? 0.45) / 2 + S.standM]);
    return { x: p[0], z: p[2] };
  }

  /** A keepsake's mesh, fitted and on the GPU once. @param {import('../keepsakes/shelf.js').ShelfEntry} e */
  function meshKey(e) {
    const key = `ks:${e.id}:${JSON.stringify(e.n)}`;
    if (meshes.has(key)) return key;
    try {
      const fit = shelfFit(keepsakeMesh(e.n, k.K), e.n, S, e.id);
      pass.setMesh(key, { data: packMesh(fit.mesh), indices: fit.mesh.indices });
      meshes.add(key);
      return key;
    } catch (err) {
      // A family whose parts are not loaded (an artifact before its bases): its spot stays empty.
      console.warn(`camp shelf: ${e.n?.family} not drawn (${/** @type {Error} */ (err).message})`);
      return null;
    }
  }

  // ---- drawing ----

  let drawKey = '';
  function draw() {
    const a = at(), shelf = k.K ? cleanShelf(get('keepsakes')).shelf : [];
    const key = JSON.stringify([a?.x, a?.y, a?.z, a?.yaw, shelf.map((e) => e.id)]);
    if (key === drawKey) return;
    drawKey = key;
    /** @type {import('../../render/passes/creatures.js').Being[]} */ const out = [];
    if (a) {
      shelf.slice(0, Math.min(SHELF_CAP, S.slotsM.length)).forEach((e, i) => {
        const mesh = meshKey(e);
        if (!mesh) return;
        const p = shelfPoint(a, S.slotsM[i]);
        out.push({ x: p[0], y: p[1] + S.sitM, z: p[2], yaw: a.yaw, size: 1, mesh });
      });
    }
    pass.setBeings(out);
  }
  k.frame.addProps(() => {
    const a = at();
    return a ? [{ key: S.model, x: a.x, y: a.y, z: a.z, yaw: a.yaw, shade: k.R.props.models[S.model]?.shade }] : [];
  });

  // ---- the card ----

  /** Is a ground point on the letter tin (its spot on top, seen from above)? @param {number} x @param {number} z */
  function onTin(x, z) {
    const a = at();
    if (!a) return false;
    const p = shelfPoint(a, S.letterTinM);
    return Math.hypot(x - p[0], z - p[2]) <= S.tinCardM;
  }
  /** Is a ground point on the shelf's footprint, grown by cardPadM? @param {number} x @param {number} z */
  function onShelf(x, z) {
    const a = at();
    if (!a) return false;
    const c = Math.cos(a.yaw), s = Math.sin(a.yaw), dx = x - a.x, dz = z - a.z;
    const bx = c * dx - s * dz, bz = s * dx + c * dz;
    return Math.abs(bx) <= (a.slot.w ?? 1.3) / 2 + S.cardPadM && Math.abs(bz) <= (a.slot.d ?? 0.45) / 2 + S.cardPadM;
  }

  /** Open the Keeper book at the Shelf tab, on the shelf itself or (letters) on the letters read. @param {boolean} letters */
  function openShelf(letters) {
    update('shelfUi', () => (letters ? { letters: true } : null));
    dispatch(/** @type {any} */ ({ type: 'ui.keeper', open: true, tab: 'shelf', page: null }));
  }

  // From above, opening the shelf's card eases the view round to look at it from the front.
  let wasOpen = false;
  function ease() {
    const card = get('identify'), open = card?.camp === 'shelf' || card?.camp === 'shelfTin';
    if (open && !wasOpen && !k.below() && k.camera?.focus) {
      const a = at();
      if (a) {
        const L = shelfLook(a, S);
        k.camera.focus(L.target[0], L.target[2], L.distance, L.pitchDeg, L.target[1], L.yaw, true);
      }
    }
    wasOpen = open;
  }

  const offs = [
    subscribe('identify', ease),
    onAction((/** @type {any} */ a) => {
      if (a.type === 'camp.shelfOpen') openShelf(false);
      else if (a.type === 'camp.shelfLetters') openShelf(true);
    }),
    registerCardAction({ id: 'campshelfopen', icon: 'shelf', order: 4, main: (c) => c?.camp === 'shelf', label: W.open ?? 'Look along the shelf',
      when: (c) => c?.camp === 'shelf' || c?.camp === 'shelfTin', action: () => ({ type: 'camp.shelfOpen' }) }),
    registerCardAction({ id: 'campshelfletters', icon: 'notes', order: 5, main: (c) => c?.camp === 'shelfTin', label: W.letters ?? 'Read the letters',
      when: (c) => c?.camp === 'shelf' || c?.camp === 'shelfTin', action: () => ({ type: 'camp.shelfLetters' }) }),
  ];

  return {
    pass,
    /** The card at a ground point: the letter tin, else the shelf, or null. @param {number} x @param {number} z */
    cardAt(x, z) {
      const a = at(), stand = standAt();
      if (!a || !stand) return null;
      const tin = onTin(x, z);
      if (!tin && !onShelf(x, z)) return null;
      const s = k.K ? cleanShelf(get('keepsakes')) : { shelf: [], letters: [] };
      const base = { noPage: true, stage: -1, sub: null, canCarry: false, campPage: true, wx: stand.x, wz: stand.z, r: S.liftM, reachR: S.reachM };
      if (tin) return { ...base, sp: 'camp:shelf-tin', camp: 'shelfTin', name: W.tinName, icon: 'notes', text: s.letters.length ? W.tinLine : W.tinNone };
      return { ...base, sp: 'camp:shelf', camp: 'shelf', name: W.name, icon: 'shelf', text: s.shelf.length ? W.line : W.empty };
    },
    /**
     * Where a view ray meets the shelf (its boards or the tin on top), as the ground point the cards
     * read: low down a click on the shelf would otherwise pass it to the ground behind.
     * @param {number[]} o @param {number[]} d @returns {{ x: number, z: number } | null}
     */
    underRay(o, d) {
      const a = at();
      if (!a) return null;
      const T = S.letterTinM, h = S.tinHalfM;
      const tTin = rayShelfBox(o, d, a, [T[0] - h[0], T[1] - h[1], T[2] - h[2]], [T[0] + h[0], T[1] + h[1], T[2] + h[2]]);
      const B = S.boxM, tShelf = rayShelfBox(o, d, a, B[0], B[1]);
      // The tin sits inside the shelf's box: a ray through it is the tin's.
      if (Number.isFinite(tTin)) { const p = shelfPoint(a, T); return { x: p[0], z: p[2] }; }
      return Number.isFinite(tShelf) ? { x: a.x, z: a.z } : null;
    },
    /** Each frame. */
    update() { draw(); },
    /** Where each kept keepsake stands now, in the world (tests, the test link). */
    standing() {
      const a = at();
      if (!a || !k.K) return [];
      return cleanShelf(get('keepsakes')).shelf.slice(0, S.slotsM.length).map((e, i) => ({ id: e.id, family: e.n.family, at: shelfPoint(a, S.slotsM[i]) }));
    },
    at, standAt,
    dispose() { for (const off of offs) off(); },
  };
}


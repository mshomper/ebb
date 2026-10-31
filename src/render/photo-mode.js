// @ts-check
// Photo mode (B2 P1, approved October 30, 2026): P or Photo on the ground bar. While it is open
//   - the view is a free camera (src/render/free-camera.js) that never startles anything;
//   - world time pauses (the clock's flow goes to 0; creatures keep breathing on animation time),
//     and the hour dial moves only the look (the clock's display time);
//   - the lens has depth of field (passes/post/dof.js), focused by a click, with an f-number;
//   - the tonemap paints the chosen filter after the palette (Soft, Pencil);
//   - Shot draws the frame offscreen at up to twice the window and saves it as a PNG
//     (passes/post/photo.js).
// The bar (src/ui/photo.js) reads the store slice `photo` and sends the actions photo.open,
// photo.close, photo.toggle, photo.set { patch } and photo.shot. While open, the app hands every
// view action here first (action()): a drag looks, the wheel steps, a click focuses.
// Numbers: recipes/world/photo.json.

import { createFreeCamera } from './free-camera.js';
import { attachMoveKeys, typing } from '../input/move-keys.js';
import { createPhotoCapture, photoSize, savePng } from './passes/post/photo.js';
import { update as updateStore, get as getStore } from '../core/store.js';
import { emitDeferred } from '../core/events.js';
import { SECONDS_PER_DAY, SECONDS_PER_HOUR } from '../core/clock.js';

/**
 * The slice `photo` a fresh photo mode starts with (pure). @param {any} R recipes/world/photo.json
 */
export function photoDefaults(R) {
  return { open: false, stop: R.dof.startStop, filter: 'none', aspect: 0, thirds: false, margin: false, ev: 0, hour: null, focusUv: [0.5, 0.5], busy: false };
}

/**
 * @param {{
 *   recipe: any,
 *   camera: import('./camera.js').OrbitCamera,
 *   clock: { flow: () => any, setFlow: (f: any) => void, worldT: () => number, setDisplayOverride: (t: number | null) => void },
 *   dof: ReturnType<typeof import('./passes/post/dof.js').createDofPass>,
 *   tonemap: { set: (v: any) => void, captureTo: (t: GPUTexture | null) => void },
 *   device: GPUDevice, format: GPUTextureFormat,
 *   ground: (x: number, z: number) => number,
 *   island: { center: number[], radius: number },
 *   walker: () => number[] | null,
 *   viewSize: () => [number, number],
 *   onOpen?: () => void,
 * }} o
 *   walker: your feet (x, z) while you are on foot, else null; viewSize: the canvas in CSS pixels;
 *   onOpen: put the shaping tools, cards and panels away
 */
export function createPhotoMode(o) {
  const R = o.recipe;
  const free = createFreeCamera(R.camera, { ground: o.ground, island: o.island });
  const capture = createPhotoCapture(o.device, o.format);
  updateStore('photo', () => photoDefaults(R));
  o.tonemap.set({ filter: 0, filters: { ...R.filters, paperHex: R.frame.paperHex } });
  /** @type {any} */ let flowBefore = 1;
  let shotPending = false, shotDrawn = false;
  /** Frames after a shot that the dynamic resolution should not count (the resize and the read take time). */
  let quiet = 0;
  const S = () => getStore('photo') ?? photoDefaults(R);
  const isOpen = () => !!S().open;

  const keys = attachMoveKeys(window, { active: isOpen });
  /** Q and E (down and up), held. */
  const vert = new Set();
  /** @param {KeyboardEvent} e */
  const vDown = (e) => {
    if (!isOpen() || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'KeyQ' || e.code === 'KeyE' || e.code === 'PageDown' || e.code === 'PageUp') { vert.add(e.code); e.preventDefault(); }
  };
  /** @param {KeyboardEvent} e */
  const vUp = (e) => vert.delete(e.code);
  const vBlur = () => vert.clear();
  addEventListener('keydown', vDown);
  addEventListener('keyup', vUp);
  addEventListener('blur', vBlur);

  /** Apply the slice to the lens, the filter and the clock. */
  function apply() {
    const s = S();
    o.dof.set({ on: s.open, fStop: R.dof.fStops[s.stop] ?? 4, focusUv: s.focusUv });
    o.tonemap.set({ filter: s.open ? Math.max(0, R.filters.list.indexOf(s.filter)) : 0, lens: s.open });
    if (s.open && typeof s.hour === 'number') {
      const day = Math.floor(o.clock.worldT() / SECONDS_PER_DAY) * SECONDS_PER_DAY;
      o.clock.setDisplayOverride(day + s.hour * SECONDS_PER_HOUR);
    } else o.clock.setDisplayOverride(null);
  }

  function open() {
    if (isOpen()) return;
    o.onOpen?.();
    const w = o.walker();
    free.start(o.camera.eye, o.camera.target, w);
    // From above, start low over what you were looking at would be a jump; start where the view is.
    flowBefore = o.clock.flow();
    o.clock.setFlow(0);
    updateStore('photo', (p) => ({ ...p, open: true, hour: null, focusUv: [0.5, 0.5] }));
    o.dof.set({ snap: true });
    apply();
    emitDeferred('photo:opened', { above: free.above });
  }

  function close() {
    if (!isOpen()) return;
    updateStore('photo', (p) => ({ ...p, open: false, hour: null }));
    o.camera.setFree(null);
    o.clock.setFlow(flowBefore);
    keys.release();
    vert.clear();
    apply();
    emitDeferred('photo:closed', {});
  }

  return {
    /** Is photo mode open? */
    get isOpen() { return isOpen(); },
    open, close,

    /**
     * A view or photo action. While open, view actions are photo mode's and the rest of the
     * island's actions wait; returns true when it took the action.
     * @param {any} a
     */
    action(a) {
      switch (a.type) {
        case 'photo.open': open(); return true;
        case 'photo.close': close(); return true;
        case 'photo.toggle': if (isOpen()) close(); else open(); return true;
        case 'photo.set': updateStore('photo', (p) => ({ ...p, ...a.patch })); apply(); return true;
        case 'photo.shot': if (isOpen() && !S().busy) { shotPending = true; updateStore('photo', (p) => ({ ...p, busy: true })); } return true;
        default: break;
      }
      if (!isOpen()) return false;
      if (a.type === 'camera.pan' || a.type === 'camera.orbit') free.look(a.dx, a.dy);
      else if (a.type === 'camera.zoom') free.move(0, 0, 0, (-Math.log(a.factor) / Math.log(1.12)) * R.camera.wheelM);
      else if (a.type === 'look.tap') {
        const [w, h] = o.viewSize();
        updateStore('photo', (p) => ({ ...p, focusUv: [Math.min(1, Math.max(0, a.x / w)), Math.min(1, Math.max(0, a.y / h))] }));
        apply();
      }
      // Everything else (tools, walking, cards, time) waits until photo mode closes.
      return true;
    },

    /** Each frame, before the orbit camera updates. @param {number} dt real seconds */
    update(dt) {
      if (!isOpen()) return;
      const a = keys.axes();
      const v = (vert.has('KeyE') || vert.has('PageUp') ? 1 : 0) - (vert.has('KeyQ') || vert.has('PageDown') ? 1 : 0);
      const pace = free.pace * (keys.run ? R.camera.runK : 1) * dt;
      if (a.forward || a.right || v) free.move(a.forward * pace, a.right * pace, v * pace);
      free.update(dt);
      o.camera.setFree(free.pose());
    },

    /** Exposure in stops while open (added brightness: subtract from EV100). */
    ev: () => (isOpen() ? S().ev : 0),

    /**
     * Before the frame graph is sized: the size to draw a shot at (window pixels in), or null.
     * @param {number} w @param {number} h
     * @returns {[number, number] | null}
     */
    shotSize(w, h) {
      if (!shotPending) return null;
      return photoSize(w, h, R.export.scale, R.export.maxSidePx, o.device.limits.maxTextureDimension2D);
    },
    /** The graph is sized for the shot: point the tonemap at the photo's target. @param {[number, number]} size */
    beforeRender(size) {
      if (!shotPending) return;
      o.tonemap.captureTo(capture.target(size[0], size[1]));
      shotPending = false;
      shotDrawn = true;
    },
    /** After the graph recorded: copy a shot out. @param {GPUCommandEncoder} encoder */
    afterRender(encoder) {
      if (shotDrawn) capture.copy(encoder);
    },
    /** After submit: save a shot. */
    afterSubmit() {
      if (quiet > 0) quiet--;
      if (!shotDrawn) return;
      shotDrawn = false;
      quiet = 3;
      const s = S();
      capture.finish({ aspect: R.frame.aspects[s.aspect] ?? null, marginK: s.margin ? R.frame.marginK : 0, paperHex: R.frame.paperHex })
        ?.then((blob) => {
          savePng(blob, R.export.fileStem);
          emitDeferred('photo:taken', { bytes: blob.size });
          // The bar says so (the island notes are put away while photo mode is open).
          updateStore('photo', (p) => ({ ...p, saved: performance.now() }));
        })
        .catch((err) => console.warn('ebb photo: the picture was not saved', err))
        .finally(() => updateStore('photo', (p) => ({ ...p, busy: false })));
    },
    /** Is this frame a shot, or just after one (the dynamic resolution should not count it)? */
    get shooting() { return shotPending || shotDrawn || quiet > 0; },

    dispose() {
      close();
      keys.dispose();
      removeEventListener('keydown', vDown);
      removeEventListener('keyup', vUp);
      removeEventListener('blur', vBlur);
    },
  };
}

/** @typedef {ReturnType<typeof createPhotoMode>} PhotoMode */

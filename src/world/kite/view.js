// @ts-check
// The view from the kite (docs/future/20, 'The kite'; Matt, November 1, 2026: it rises only when
// you press Rise with it). Through photo mode's free camera (src/render/camera.js setFree): from
// where the view is, it glides up over riseS to behind the kite, high and slow, holding the island,
// the islet and the stack offshore in one frame, and drifts a little either way. A free view is one
// the game drives, so it never startles anything. Any key, click or wheel brings the view back
// (P is photo mode's own key: photo mode opens from here and takes the free camera over).

import { viewGoal, freePose, ease } from './rules.js';

/**
 * @param {{ camera: any, fovY: number, V: any, things: () => { x: number, z: number, r: number }[],
 *   kite: () => number[] | null, photoOpen: () => boolean, onHeld: () => void }} o
 *   V: kite.json view; things: what the view frames; kite: the kite's point now, or null;
 *   onHeld: once a view has been held sketchAfterS at the top (a sketchbook page)
 */
export function createKiteView(o) {
  const V = o.V;
  /** @type {{ t: number, from: number[], fromLook: number[], at: number, held: boolean } | null} */ let on = null;

  function stop() {
    if (!on) return;
    on = null;
    o.camera.setFree(null);
  }
  /** Any key (but photo mode's), a click or the wheel: the view comes back. @param {Event} e */
  function input(e) {
    if (!on || performance.now() - on.at < 350 || o.photoOpen()) return;
    const k = /** @type {KeyboardEvent} */ (e);
    if (e.type === 'keydown' && (k.code === 'KeyP' || k.ctrlKey || k.metaKey || k.altKey)) return;
    const onCanvas = e.target instanceof HTMLCanvasElement;
    stop();
    // A click or a turn of the wheel over the island only brings the view back; it never walks.
    if (onCanvas && e.type !== 'keydown') { e.stopPropagation(); e.preventDefault(); }
  }
  const opts = { capture: true };
  window.addEventListener('keydown', input, opts);
  window.addEventListener('pointerdown', input, opts);
  window.addEventListener('wheel', input, { capture: true, passive: false });

  return {
    /** Is the view up with the kite? */
    get viewing() { return !!on; },
    /** Rise with the kite, from where the view is now. */
    start() {
      if (on || !o.kite() || o.photoOpen()) return;
      on = { t: 0, from: [...o.camera.eye], fromLook: [...o.camera.target], at: performance.now(), held: false };
    },
    stop,
    /** Each frame. @param {number} dt real seconds */
    tick(dt) {
      if (!on) return;
      // Photo mode opened from the view: the free camera is its now, and closing it comes back to you.
      if (o.photoOpen()) { on = null; return; }
      const kite = o.kite();
      if (!kite) { stop(); return; }
      on.t += dt;
      const g = viewGoal(o.things(), kite, o.fovY, on.t, V), k = ease(on.t / V.riseS);
      const mix = (/** @type {number[]} */ a, /** @type {number[]} */ b) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
      o.camera.setFree(freePose(mix(on.from, g.eye), mix(on.fromLook, g.look)));
      if (!on.held && on.t >= V.riseS + V.sketchAfterS) { on.held = true; o.onHeld(); }
    },
    dispose() {
      stop();
      window.removeEventListener('keydown', input, opts);
      window.removeEventListener('pointerdown', input, opts);
      window.removeEventListener('wheel', input, opts);
    },
  };
}

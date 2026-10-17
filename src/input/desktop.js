// @ts-check
// Mouse, pen and wheel input in the look state (docs/15, desktop bindings):
// left or middle drag (or Space + left drag) pans, right drag orbits, wheel or trackpad pinch zooms toward the cursor.

import { dispatch } from './actions.js';

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ wheelZoomPerNotch: number }} opts
 * @returns {() => void} detach
 */
export function attachDesktopInput(canvas, opts) {
  /** @type {{ id: number, mode: 'pan'|'orbit', x: number, y: number } | null} */
  let drag = null;

  /** @param {PointerEvent} e */
  const down = (e) => {
    if (e.pointerType === 'touch' || drag) return;
    const mode = e.button === 2 ? 'orbit' : e.button === 0 || e.button === 1 ? 'pan' : null;
    if (!mode) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    drag = { id: e.pointerId, mode, x: e.clientX, y: e.clientY };
  };

  /** @param {PointerEvent} e */
  const move = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (dx === 0 && dy === 0) return;
    dispatch({ type: drag.mode === 'orbit' ? 'camera.orbit' : 'camera.pan', dx, dy });
  };

  /** @param {PointerEvent} e */
  const up = (e) => {
    if (drag && e.pointerId === drag.id) drag = null;
  };

  /** @param {WheelEvent} e */
  const wheel = (e) => {
    e.preventDefault();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 33;
    else if (e.deltaMode === 2) dy *= 600;
    if (e.ctrlKey) dy *= 4; // trackpad pinch arrives as small ctrl+wheel deltas
    const factor = Math.pow(1 + opts.wheelZoomPerNotch, dy / 100);
    const r = canvas.getBoundingClientRect();
    dispatch({ type: 'camera.zoom', factor, x: e.clientX - r.left, y: e.clientY - r.top });
  };

  /** @param {Event} e */
  const noMenu = (e) => e.preventDefault();

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('contextmenu', noMenu);

  return () => {
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
    canvas.removeEventListener('wheel', wheel);
    canvas.removeEventListener('contextmenu', noMenu);
  };
}

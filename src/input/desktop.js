// @ts-check
// Mouse, pen, wheel and keyboard input (docs/15, desktop bindings):
// left drag uses the active tool (pans in the look state), middle drag or Space + left drag pans,
// right drag orbits, wheel or trackpad pinch zooms toward the cursor.
// A short still left click with no tool is a tap (look.tap: the journal names what grows there).
// Keys: 1 2 3 pick a tool (again returns to look), J opens or closes the journal, Esc closes the
// journal or returns to look, [ ] resize the brush, Ctrl+Z undo, Ctrl+Shift+Z or Ctrl+Y redo.
// On foot, W A S D, Shift, Space and mouse look are src/world/walk/controls.js; an Esc that frees the
// pointer from mouse look does nothing more.

import { dispatch } from './actions.js';
import { get } from '../core/store.js';
import { escapeFreesPointer } from './mouse-look.js';

const TOOL_KEYS = /** @type {const} */ (['sculpt', 'smooth', 'paint']);
/** A click that moves less than this (px) and lasts less than this (ms) is a tap. */
const TAP_PX = 6;
const TAP_MS = 400;

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ wheelZoomPerNotch: number }} opts
 * @param {{ resizeStep: number }} brush
 * @returns {() => void} detach
 */
export function attachDesktopInput(canvas, opts, brush) {
  /** @type {{ id: number, mode: 'pan'|'orbit'|'tool', x: number, y: number, sx: number, sy: number, t: number, tap: boolean } | null} */
  let drag = null;
  let spaceHeld = false;

  const toolActive = () => !!get('tools')?.tool;
  const local = (/** @type {PointerEvent} */ e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const source = (/** @type {PointerEvent} */ e) => (e.pointerType === 'pen' ? 'pen' : 'mouse');
  const pressure = (/** @type {PointerEvent} */ e) => (e.pointerType === 'pen' ? Math.max(0.05, e.pressure || 0.5) : 1);

  /** @param {PointerEvent} e */
  const down = (e) => {
    if (e.pointerType === 'touch' || drag) return;
    let mode = /** @type {'pan'|'orbit'|'tool'|null} */ (null);
    if (e.button === 2) mode = 'orbit';
    else if (e.button === 1) mode = 'pan';
    else if (e.button === 0) mode = toolActive() && !spaceHeld ? 'tool' : 'pan';
    if (!mode) return;
    e.preventDefault();
    canvas.focus?.({ preventScroll: true });
    try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    // A short, still left click with no tool is a tap: the journal names what grows there.
    drag = { id: e.pointerId, mode, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(),
      tap: e.button === 0 && mode === 'pan' && !toolActive() };
    if (mode === 'tool') {
      const p = local(e);
      // Shift levels a Terrace or Cut to mean sea level (docs/15).
      dispatch({ type: 'tool.begin', x: p.x, y: p.y, pressure: pressure(e), source: source(e), shift: e.shiftKey });
    }
  };

  /** @param {PointerEvent} e */
  const move = (e) => {
    if (e.pointerType === 'touch') return;
    if (!drag || e.pointerId !== drag.id) {
      if (!drag) {
        const p = local(e);
        dispatch({ type: 'tool.hover', x: p.x, y: p.y, inside: true, source: source(e) });
      }
      return;
    }
    if (drag.mode === 'tool') {
      const p = local(e);
      dispatch({ type: 'tool.hover', x: p.x, y: p.y, inside: true, source: source(e) });
      dispatch({ type: 'tool.move', x: p.x, y: p.y, pressure: pressure(e), source: source(e) });
      return;
    }
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (dx === 0 && dy === 0) return;
    dispatch({ type: drag.mode === 'orbit' ? 'camera.orbit' : 'camera.pan', dx, dy });
  };

  /** @param {PointerEvent} e */
  const up = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.mode === 'tool') dispatch({ type: e.type === 'pointercancel' ? 'tool.cancel' : 'tool.end', source: source(e) });
    if (drag.tap && e.type === 'pointerup' && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < TAP_PX && performance.now() - drag.t < TAP_MS) {
      const p = local(e);
      dispatch({ type: 'look.tap', x: p.x, y: p.y, source: source(e) });
    }
    drag = null;
  };

  /** @param {PointerEvent} e */
  const leave = (e) => {
    if (e.pointerType === 'touch' || drag) return;
    dispatch({ type: 'tool.hover', x: 0, y: 0, inside: false, source: source(e) });
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

  /** @param {KeyboardEvent} e */
  const keydown = (e) => {
    const t = /** @type {HTMLElement | null} */ (e.target);
    if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && /** @type {HTMLInputElement} */ (t).type !== 'range'))) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      dispatch({ type: e.shiftKey ? 'history.redo' : 'history.undo', source: 'key' });
    } else if (ctrl && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      dispatch({ type: 'history.redo', source: 'key' });
    } else if (ctrl || e.altKey) {
      return;
    } else if (e.code === 'Space') {
      if (t && t.tagName === 'BUTTON') return;
      spaceHeld = true;
      e.preventDefault();
    } else if (/^Digit[1-3]$/.test(e.code)) {
      const id = TOOL_KEYS[Number(e.code.slice(5)) - 1];
      dispatch({ type: 'tool.select', toolId: get('tools')?.tool === id ? null : id, source: 'key' });
    } else if (e.code === 'KeyJ') {
      dispatch({ type: 'ui.journal', toggle: true });
    } else if (e.code === 'KeyI') {
      // The Walker page (src/ui/walker-page.js): what the walker wears and carries.
      dispatch({ type: 'ui.walkerPage', toggle: true });
    } else if (e.code === 'KeyG') {
      dispatch({ type: get('walk')?.below ? 'walk.up' : 'walk.down', source: 'key' });
    } else if (e.code === 'KeyH') {
      dispatch({ type: 'ui.hideHud', source: 'key' });
    } else if (e.key === 'Escape') {
      // On foot with mouse look, the first Esc only frees the pointer (src/input/mouse-look.js).
      if (escapeFreesPointer()) return;
      if (get('walkerPageUi')?.open) dispatch({ type: 'ui.walkerPage', open: false });
      else if (get('journalUi')?.open) dispatch({ type: 'ui.journal', open: false });
      // A seed, a gift or the net in hand is put away first (D1a).
      else if (get('walk')?.below && get('hand')) dispatch({ type: 'hand.putAway', source: 'key' });
      else if (get('walk')?.below) dispatch({ type: 'walk.up', source: 'key' });
      else dispatch({ type: 'tool.select', toolId: null, source: 'key' });
    } else if (e.key === '[' || e.key === ']') {
      dispatch({ type: 'brush.resize', factor: e.key === ']' ? brush.resizeStep : 1 / brush.resizeStep, source: 'key' });
    }
  };

  /** @param {KeyboardEvent} e */
  const keyup = (e) => {
    if (e.code === 'Space') spaceHeld = false;
  };
  const blur = () => { spaceHeld = false; };

  /** @param {Event} e */
  const noMenu = (e) => e.preventDefault();

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', leave);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('contextmenu', noMenu);
  window.addEventListener('keydown', keydown);
  window.addEventListener('keyup', keyup);
  window.addEventListener('blur', blur);

  return () => {
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
    canvas.removeEventListener('pointerleave', leave);
    canvas.removeEventListener('wheel', wheel);
    canvas.removeEventListener('contextmenu', noMenu);
    window.removeEventListener('keydown', keydown);
    window.removeEventListener('keyup', keyup);
    window.removeEventListener('blur', blur);
  };
}

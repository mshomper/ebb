// @ts-check
// Touch input (docs/15, touch bindings):
// one finger uses the active tool, or pans in the look state (a quick still tap there is look.tap,
// which the journal answers by naming what grows under the finger); two fingers drag to orbit,
// pinch to zoom and twist to turn; a three-finger tap undoes.
// Each two-finger motion waits behind its own dead zone so a pinch does not wobble the yaw.
// A one-finger stroke starts only after a short delay or a little travel, so a second finger
// landing late leaves no stray mark; a second finger arriving mid-stroke ends the stroke.

import { dispatch } from './actions.js';
import { get } from '../core/store.js';

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ gestureDeadZone: { px: number, pinch: number, twistDeg: number } }} opts
 * @param {{ strokeDelayMs?: number, strokeStartPx?: number, tapMs?: number }} [tool]
 * @returns {() => void} detach
 */
export function attachTouchInput(canvas, opts, tool = {}) {
  const dz = opts.gestureDeadZone;
  const strokeDelay = tool.strokeDelayMs ?? 80;
  const strokeStartPx = tool.strokeStartPx ?? 8;
  const tapMs = tool.tapMs ?? 350;
  /** @type {Map<number, { x: number, y: number }>} */
  const fingers = new Map();
  /** @type {null | { cx: number, cy: number, dist: number, angle: number, live: { orbit: boolean, pinch: boolean, twist: boolean }, start: { cx: number, cy: number, dist: number, angle: number } }} */
  let pair = null;
  /** @type {null | { x: number, y: number, live: boolean, sx: number, sy: number, mode: 'pan'|'tool'|'none', stroking: boolean, timer: number, t: number }} */
  let single = null;
  /** @type {null | { t: number, start: Map<number, {x: number, y: number}>, moved: boolean }} */
  let triple = null;
  let hadMultiple = false;

  const toolActive = () => !!get('tools')?.tool;
  const local = (/** @type {PointerEvent} */ e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function endSingle() {
    if (!single) return;
    clearTimeout(single.timer);
    if (single.stroking) dispatch({ type: 'tool.end', source: 'touch' });
    single = null;
  }

  function startStroke() {
    if (!single || single.stroking || single.mode !== 'tool') return;
    single.stroking = true;
    single.live = true;
    dispatch({ type: 'tool.hover', x: single.sx, y: single.sy, inside: true, source: 'touch' });
    dispatch({ type: 'tool.begin', x: single.sx, y: single.sy, pressure: 1, source: 'touch' });
    if (single.x !== single.sx || single.y !== single.sy) {
      dispatch({ type: 'tool.hover', x: single.x, y: single.y, inside: true, source: 'touch' });
      dispatch({ type: 'tool.move', x: single.x, y: single.y, pressure: 1, source: 'touch' });
    }
  }

  function resetGesture() {
    endSingle();
    pair = null;
    const pts = [...fingers.values()];
    if (pts.length === 1) {
      // A finger left over from a two-finger gesture pans in the look state but never sculpts.
      const mode = toolActive() ? (hadMultiple ? 'none' : 'tool') : 'pan';
      single = { x: pts[0].x, y: pts[0].y, sx: pts[0].x, sy: pts[0].y, live: false, mode, stroking: false, timer: 0, t: performance.now() };
      if (mode === 'tool') single.timer = window.setTimeout(startStroke, strokeDelay);
    } else if (pts.length >= 2) {
      const g = measure(pts[0], pts[1]);
      pair = { ...g, start: { ...g }, live: { orbit: false, pinch: false, twist: false } };
    }
  }

  /** @param {PointerEvent} e */
  const down = (e) => {
    if (e.pointerType !== 'touch') return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    fingers.set(e.pointerId, local(e));
    if (fingers.size >= 2) hadMultiple = true;
    if (fingers.size === 3) triple = { t: performance.now(), start: new Map(fingers), moved: false };
    else if (fingers.size > 3) triple = null;
    resetGesture();
  };

  /** @param {PointerEvent} e */
  const move = (e) => {
    if (e.pointerType !== 'touch' || !fingers.has(e.pointerId)) return;
    const p = local(e);
    fingers.set(e.pointerId, p);
    if (triple) {
      const s = triple.start.get(e.pointerId);
      if (s && Math.hypot(p.x - s.x, p.y - s.y) > strokeStartPx * 2) triple.moved = true;
    }
    const pts = [...fingers.values()];

    if (pts.length === 1 && single) {
      const q = pts[0];
      const far = Math.hypot(q.x - single.sx, q.y - single.sy);
      if (single.mode === 'pan') {
        if (!single.live && far >= dz.px) single.live = true;
        if (single.live) dispatch({ type: 'camera.pan', dx: q.x - single.x, dy: q.y - single.y });
      } else if (single.mode === 'tool') {
        single.x = q.x;
        single.y = q.y;
        if (!single.stroking && far >= strokeStartPx) startStroke();
        else if (single.stroking) {
          dispatch({ type: 'tool.hover', x: q.x, y: q.y, inside: true, source: 'touch' });
          dispatch({ type: 'tool.move', x: q.x, y: q.y, pressure: 1, source: 'touch' });
        }
      }
      single.x = q.x;
      single.y = q.y;
      return;
    }

    if (pts.length >= 2 && pair) {
      const g = measure(pts[0], pts[1]);
      const s = pair.start;
      if (!pair.live.orbit && Math.hypot(g.cx - s.cx, g.cy - s.cy) >= dz.px) pair.live.orbit = true;
      if (!pair.live.pinch && Math.abs(g.dist / s.dist - 1) >= dz.pinch) pair.live.pinch = true;
      if (!pair.live.twist && Math.abs(wrap(g.angle - s.angle)) >= dz.twistDeg * Math.PI / 180) pair.live.twist = true;

      if (pair.live.orbit) dispatch({ type: 'camera.orbit', dx: g.cx - pair.cx, dy: g.cy - pair.cy });
      if (pair.live.pinch && g.dist > 0 && pair.dist > 0) {
        dispatch({ type: 'camera.zoom', factor: pair.dist / g.dist, x: g.cx, y: g.cy });
      }
      if (pair.live.twist) dispatch({ type: 'camera.twist', angle: wrap(g.angle - pair.angle) });
      pair.cx = g.cx;
      pair.cy = g.cy;
      pair.dist = g.dist;
      pair.angle = g.angle;
    }
  };

  /** @param {PointerEvent} e */
  const up = (e) => {
    if (!fingers.delete(e.pointerId)) return;
    if (fingers.size === 0) {
      if (triple && !triple.moved && performance.now() - triple.t < tapMs) dispatch({ type: 'history.undo', source: 'touch' });
      // A quick one-finger tap with no tool, that never panned: the journal names what grows there.
      if (single && single.mode === 'pan' && !single.live && !hadMultiple && performance.now() - single.t < tapMs) {
        dispatch({ type: 'look.tap', x: single.sx, y: single.sy, source: 'touch' });
      }
      triple = null;
      hadMultiple = false;
      endSingle();
      if (toolActive()) dispatch({ type: 'tool.hover', x: 0, y: 0, inside: false, source: 'touch' });
      pair = null;
      return;
    }
    resetGesture();
  };

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  return () => {
    endSingle();
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
  };
}

/** @param {{x:number,y:number}} a @param {{x:number,y:number}} b */
function measure(a, b) {
  return {
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
    dist: Math.hypot(b.x - a.x, b.y - a.y),
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

/** @param {number} a */
function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

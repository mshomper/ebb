// @ts-check
// Touch input in the look state (docs/15, touch bindings):
// one finger pans; two fingers drag to orbit, pinch to zoom and twist to turn.
// Each two-finger motion waits behind its own dead zone so a pinch does not wobble the yaw.

import { dispatch } from './actions.js';

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ gestureDeadZone: { px: number, pinch: number, twistDeg: number } }} opts
 * @returns {() => void} detach
 */
export function attachTouchInput(canvas, opts) {
  const dz = opts.gestureDeadZone;
  /** @type {Map<number, { x: number, y: number }>} */
  const fingers = new Map();
  /** @type {null | { cx: number, cy: number, dist: number, angle: number, live: { orbit: boolean, pinch: boolean, twist: boolean }, start: { cx: number, cy: number, dist: number, angle: number } }} */
  let pair = null;
  /** @type {null | { x: number, y: number, live: boolean, sx: number, sy: number }} */
  let single = null;

  const local = (/** @type {PointerEvent} */ e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function resetGesture() {
    pair = null;
    single = null;
    const pts = [...fingers.values()];
    if (pts.length === 1) {
      single = { x: pts[0].x, y: pts[0].y, sx: pts[0].x, sy: pts[0].y, live: false };
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
    resetGesture();
  };

  /** @param {PointerEvent} e */
  const move = (e) => {
    if (e.pointerType !== 'touch' || !fingers.has(e.pointerId)) return;
    fingers.set(e.pointerId, local(e));
    const pts = [...fingers.values()];

    if (pts.length === 1 && single) {
      const p = pts[0];
      if (!single.live && Math.hypot(p.x - single.sx, p.y - single.sy) >= dz.px) single.live = true;
      if (single.live) dispatch({ type: 'camera.pan', dx: p.x - single.x, dy: p.y - single.y });
      single.x = p.x;
      single.y = p.y;
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
    resetGesture();
  };

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  return () => {
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

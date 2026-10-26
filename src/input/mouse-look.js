// @ts-check
// Mouse look on foot (doc 23, walking with the keys; WASD, October 26, 2026; the standard PC
// third-person scheme): below, with nothing open, a click into the view captures the pointer (pointer
// lock); then moving the mouse turns the camera with no button held, a small drawn dot marks the
// middle of the view, and a left click uses whatever the dot rests on. Holding Alt frees the pointer
// (the browser's Alt menu is kept from taking focus) to click cards, the pack and the HUD; letting go
// captures it again unless something was clicked meanwhile. Esc frees it (the browser's own rule) and
// is then used up: the next Esc works as before. Opening a card or panel frees it; the next click into
// the view brings mouse look back. From above the pointer is never captured. DOM only.

/** When the pointer was last freed (ms, performance.now), for Esc. */
let freedAt = -Infinity;
/** @type {HTMLCanvasElement | null} */ let lockedOn = null;

/** Is the pointer captured for mouse look now? */
export const pointerLocked = () => !!lockedOn && document.pointerLockElement === lockedOn;

/**
 * Did this Esc free the pointer (it is captured, or was freed a moment ago by the browser)? Then the
 * Esc is used up, and does nothing else (src/input/desktop.js).
 */
export const escapeFreesPointer = () => pointerLocked() || performance.now() - freedAt < 250;

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{
 *   wanted: () => boolean,
 *   look: (dx: number, dy: number) => void,
 *   use: (x: number, y: number) => void,
 * }} o
 *   wanted: may the pointer be captured now (on foot, nothing open over the view);
 *   look: a mouse movement in pixels; use: a left click at the middle of the view (CSS pixels)
 */
export function attachMouseLook(canvas, o) {
  let altFreed = false, clickedFree = false;
  const dot = document.createElement('div');
  dot.className = 'ebb-look-dot';
  dot.setAttribute('aria-hidden', 'true');
  // A drawn mark, not a glyph: a soft ring round a dot, in the brand ink and paper.
  dot.innerHTML = '<svg viewBox="0 0 20 20" width="20" height="20"><circle cx="10" cy="10" r="6" fill="none" stroke="#FBF7F0" stroke-width="2" opacity="0.85"/><circle cx="10" cy="10" r="2.6" fill="#1E2624" stroke="#FBF7F0" stroke-width="1.4"/></svg>';
  Object.assign(dot.style, { position: 'fixed', width: '20px', height: '20px', marginLeft: '-10px', marginTop: '-10px', pointerEvents: 'none', zIndex: '5', display: 'none' });
  document.body.append(dot);
  const middle = () => ({ x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 });
  const placeDot = () => {
    const r = canvas.getBoundingClientRect();
    dot.style.left = `${r.left + r.width / 2}px`;
    dot.style.top = `${r.top + r.height / 2}px`;
  };
  const lock = () => {
    if (pointerLocked() || !o.wanted()) return;
    lockedOn = canvas;
    try { /** @type {any} */ (canvas.requestPointerLock())?.catch?.(() => {}); } catch { /* not allowed now: the next click tries again */ }
  };
  const free = () => { if (pointerLocked()) document.exitPointerLock(); };

  /** @param {PointerEvent} e */
  const down = (e) => {
    if (e.pointerType === 'touch') return;
    if (pointerLocked()) {
      // Captured: a left click uses what the dot rests on; nothing else of the click is used.
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.button === 0) { const m = middle(); o.use(m.x, m.y); }
      return;
    }
    if (e.altKey) { clickedFree = true; return; }
    // On foot with the pointer free: this click captures it (and is not a click on the world).
    if (e.button === 0 && o.wanted()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      lock();
    }
  };
  /** @param {PointerEvent} e */
  const move = (e) => {
    if (!pointerLocked()) return;
    e.stopImmediatePropagation();
    if (e.movementX || e.movementY) o.look(e.movementX, e.movementY);
  };
  /** Swallow the rest of a captured click, so nothing reads it as a tap or a drag. @param {PointerEvent} e */
  const swallow = (e) => { if (pointerLocked()) e.stopImmediatePropagation(); };
  /** @param {KeyboardEvent} e */
  const keydown = (e) => {
    if (e.key !== 'Alt') return;
    e.preventDefault();
    if (pointerLocked() && !e.repeat) { altFreed = true; clickedFree = false; free(); }
  };
  /** @param {KeyboardEvent} e */
  const keyup = (e) => {
    if (e.key !== 'Alt') return;
    e.preventDefault();
    if (altFreed && !clickedFree) lock();
    altFreed = false;
  };
  const anyDown = () => { if (altFreed) clickedFree = true; };
  const changed = () => {
    const on = pointerLocked();
    if (!on) freedAt = performance.now();
    placeDot();
    dot.style.display = on ? 'block' : 'none';
  };

  canvas.addEventListener('pointerdown', down, { capture: true });
  canvas.addEventListener('pointermove', move, { capture: true });
  canvas.addEventListener('pointerup', swallow, { capture: true });
  window.addEventListener('pointerdown', anyDown, { capture: true });
  window.addEventListener('keydown', keydown);
  window.addEventListener('keyup', keyup);
  window.addEventListener('resize', placeDot);
  document.addEventListener('pointerlockchange', changed);
  return {
    /** Each frame: let the pointer go when a card or panel opens, or you go up. */
    update() { if (pointerLocked() && !o.wanted()) free(); },
    /** The middle of the view (CSS pixels on the canvas), where the dot is. */
    middle,
    get locked() { return pointerLocked(); },
    dispose() {
      free();
      canvas.removeEventListener('pointerdown', down, { capture: true });
      canvas.removeEventListener('pointermove', move, { capture: true });
      canvas.removeEventListener('pointerup', swallow, { capture: true });
      window.removeEventListener('pointerdown', anyDown, { capture: true });
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('resize', placeDot);
      document.removeEventListener('pointerlockchange', changed);
      dot.remove();
    },
  };
}

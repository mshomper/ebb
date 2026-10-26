// @ts-check
// Held movement keys (doc 23, walking with the keys; WASD, October 26, 2026): W A S D and the arrow
// keys, read as a way relative to the camera (forward and right, each -1..1, a diagonal normalised so
// it is never faster), and Shift held to run. Space is a press (the dodge roll below). Every key is let
// go when the window loses focus, and none is read while typing (a creature's name, a text box).
// Q and E are left unbound on foot: the Hollow's special moves, later. DOM only; no store.

const CODES = /** @type {Record<string, 'f' | 'b' | 'l' | 'r'>} */ ({
  KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r',
});

/** Is a key going into a text field (or a control that takes keys of its own)? @param {EventTarget | null} t */
export function typing(t) {
  const el = /** @type {HTMLElement | null} */ (t);
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  return el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && /** @type {HTMLInputElement} */ (el).type !== 'range');
}

/**
 * The way the keys held point, camera-relative: forward (W, up) and right (D, right), the pair
 * scaled so a diagonal has length 1. Pure. @param {Iterable<string>} codes KeyboardEvent.code values
 */
export function keyAxes(codes) {
  const ways = new Set([...codes].map((c) => CODES[c]));
  const f = (ways.has('f') ? 1 : 0) - (ways.has('b') ? 1 : 0);
  const r = (ways.has('r') ? 1 : 0) - (ways.has('l') ? 1 : 0);
  const l = Math.hypot(f, r);
  return l > 0 ? { forward: f / l, right: r / l } : { forward: 0, right: 0 };
}

/**
 * Turn a camera-relative way into the world, along the ground (the camera's yaw as in
 * src/render/camera.js: the eye sits at +sin(yaw), +cos(yaw) from what it looks at). Pure.
 * @param {number} forward @param {number} right @param {number} camYaw
 * @returns {[number, number]} world x, z
 */
export function worldWay(forward, right, camYaw) {
  const s = Math.sin(camYaw), c = Math.cos(camYaw);
  // Forward along the ground is (-sin, -cos); right is (cos, -sin).
  return [-s * forward + c * right, -c * forward - s * right];
}

/**
 * Track the movement keys on a window. onPress(name) fires on a fresh press: 'move' for a movement
 * key (it takes over from a click walk), 'roll' for Space; for Space it returns true when it used the
 * key (the browser's own use is then stopped).
 * @param {Window} win
 * @param {{ onPress?: (name: 'move' | 'roll', e: KeyboardEvent) => boolean | void, active?: () => boolean }} [o]
 *   active: are the keys read now (nothing open over the view); keys held still let go
 */
export function attachMoveKeys(win, o = {}) {
  /** Movement keys down now, by code (W and the up arrow are both kept). @type {Set<string>} */
  const held = new Set();
  let shift = false;
  const active = o.active ?? (() => true);

  /** @param {KeyboardEvent} e */
  const down = (e) => {
    shift = e.shiftKey;
    if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey || !active()) return;
    if (CODES[e.code]) {
      e.preventDefault();
      if (!held.has(e.code) && !e.repeat) o.onPress?.('move', e);
      held.add(e.code);
    } else if (e.code === 'Space' && !e.repeat) {
      if (o.onPress?.('roll', e)) e.preventDefault();
    }
  };
  /** @param {KeyboardEvent} e */
  const up = (e) => { shift = e.shiftKey; held.delete(e.code); };
  const release = () => { held.clear(); shift = false; };

  win.addEventListener('keydown', down);
  win.addEventListener('keyup', up);
  win.addEventListener('blur', release);
  return {
    /** The way held now, camera-relative. */
    axes: () => keyAxes(held),
    /** Is any movement key held? */
    get any() { return held.size > 0; },
    /** Shift held (run). */
    get run() { return shift; },
    /** Let every key go (a panel opened over the view). */
    release,
    dispose() {
      win.removeEventListener('keydown', down);
      win.removeEventListener('keyup', up);
      win.removeEventListener('blur', release);
    },
  };
}

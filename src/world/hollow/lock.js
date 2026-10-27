// @ts-check
// Lock-on (doc 16, Lock-on: Tab; H0, October 27, 2026). Tab locks onto the thing nearest the middle of
// the view; Tab again moves to the next one to its right (left to right across the view), and one
// more Tab after the last turns the lock off. Nothing is held. Only things in the lantern's light, or
// glinting at its edge, can be locked. When the target breaks, the lock moves to the nearest thing
// still lockable, or turns off; it drops after outOfReachS out of the light, and on Esc. Pure: the
// caller says what is on screen each time.

/**
 * A thing the lock may take, as the caller sees it now.
 * @typedef {{ id: number, sx: number, distM: number, lockable: boolean }} LockCandidate
 *   sx: across the view, -1 at the left edge to 1 at the right (off screen beyond); distM: from the walker
 */

/** @param {{ outOfReachS: number }} L */
export function createLock(L) {
  /** @type {number | null} */ let target = null;
  let outS = 0;
  /** @param {LockCandidate[]} c */
  const usable = (c) => c.filter((t) => t.lockable && Math.abs(t.sx) <= 1);
  return {
    /** The locked thing's id, or null. */
    get target() { return target; },
    /**
     * Tab: lock the thing nearest the middle, or move to the next to the right, or turn off after the last.
     * @param {LockCandidate[]} cands @returns {number | null}
     */
    press(cands) {
      const ok = usable(cands);
      outS = 0;
      if (target === null) {
        const best = ok.reduce((/** @type {LockCandidate | null} */ m, t) => (!m || Math.abs(t.sx) < Math.abs(m.sx) ? t : m), null);
        target = best ? best.id : null;
        return target;
      }
      const now = cands.find((t) => t.id === target);
      const from = now ? now.sx : -Infinity;
      const next = ok.filter((t) => t.id !== target && (t.sx > from || (t.sx === from && t.id > /** @type {number} */ (target))))
        .sort((a, b) => a.sx - b.sx || a.id - b.id)[0];
      target = next ? next.id : null;
      return target;
    },
    /** Esc, or anything else that lets go. */
    drop() { target = null; outS = 0; },
    /**
     * Each frame: follow the target, move on when it breaks (it is no longer among the candidates),
     * drop it after outOfReachS out of the light. Returns why it changed, or null.
     * @param {number} dt @param {LockCandidate[]} cands
     * @returns {'moved' | 'off' | 'dropped' | null}
     */
    update(dt, cands) {
      if (target === null) return null;
      const now = cands.find((t) => t.id === target);
      if (!now) {
        const ok = cands.filter((t) => t.lockable);
        const next = ok.reduce((/** @type {LockCandidate | null} */ m, t) => (!m || t.distM < m.distM ? t : m), null);
        target = next ? next.id : null;
        outS = 0;
        return next ? 'moved' : 'off';
      }
      outS = now.lockable ? 0 : outS + dt;
      if (outS >= L.outOfReachS) { target = null; outS = 0; return 'dropped'; }
      return null;
    },
  };
}

// @ts-check
// Zones, live (docs/26-zones.md): places below or beyond the island that you go to and come back
// from, the spring's cave first. A zone registers what it brings: enter and leave (it moves the
// walker in and out, src/world/walk enterZone and leaveZone), what is drawn (its passes are enabled
// while it is the zone; app.js turns the island's off), its light and sound bed, its cards, where a
// click meets its floor and how far the view may sit back. Going is a fade to black, the swap while
// the screen is dark, and a fade back in (zone.js); the island keeps simulating all the while:
// world time, catch-up and the save go on exactly as they do on the island, and a save made below
// keeps the island spot you went down from (walk.spot), so it reloads you by the way down.
// Writes the store slice `zone` { id } (null on the island). Events: zone:entered { id },
// zone:left { id }. Numbers: recipes/world/zones.json.

import { update } from '../../core/store.js';
import { emitDeferred } from '../../core/events.js';
import { idleFade, stepFade, darkness, startFade } from './zone.js';

/**
 * @typedef {{ id: string, enter: () => boolean, leave: () => void, tick?: (dt: number) => void,
 *   cardAt?: (x: number, z: number) => any, light?: (d: any) => { uniforms: number[], sunDir: number[], sunIlluminance: number[] },
 *   sound?: () => any, groundAt?: (ro: number[], rd: number[]) => number[] | null, viewRoom?: (target: ArrayLike<number>, eye: ArrayLike<number>) => number,
 *   ready?: () => boolean }} Zone
 */

/** @param {{ R: any, host?: HTMLElement | null }} o R: recipes/world/zones.json; host: where the fade's veil goes (none in tests) */
export function createZones(o) {
  const R = o.R;
  /** @type {Map<string, Zone>} */ const zones = new Map();
  /** @type {string | null} */ let current = null;
  let fade = idleFade();
  // The veil: a plain dark layer over the view (under the HUD), clear until a fade.
  /** @type {HTMLElement | null} */ let veil = null;
  if (o.host && typeof document !== 'undefined') {
    veil = document.createElement('div');
    veil.className = 'ebb-zone-veil';
    veil.setAttribute('aria-hidden', 'true');
    Object.assign(veil.style, { position: 'fixed', inset: '0', background: R.color ?? '#000', opacity: '0', pointerEvents: 'none', zIndex: '1' });
    o.host.appendChild(veil);
  }
  const publish = () => update('zone', () => ({ id: current }));
  publish();

  /** The swap, while the screen is dark: out of the zone left, into the zone entered. */
  function swap() {
    const from = fade.from ? zones.get(fade.from) : null, to = fade.to ? zones.get(fade.to) : null;
    if (from && current === from.id) { from.leave(); emitDeferred('zone:left', { id: from.id }); current = null; }
    if (to && to.enter()) { current = to.id; emitDeferred('zone:entered', { id: to.id }); }
    publish();
  }

  return {
    /** A zone the game can go to. @param {Zone} z */
    register(z) { zones.set(z.id, z); },
    /** Go down (or in) to a zone, fading through dark. @param {string} id */
    go(id) { if (zones.get(id)?.ready?.() !== false) fade = startFade(fade, id, current); },
    /** Back up to the island, fading through dark. */
    back() { if (current) fade = startFade(fade, null, current); },
    /** Straight into a zone with no fade (the test links). @param {string} id */
    goNow(id) { fade = { phase: 'hold', t: 0, to: id, from: current }; swap(); },
    /** The zone you are in, or null on the island. */
    active: () => current,
    /** The zone's own parts (its light, sound, cards), or null on the island. */
    zone: () => (current ? zones.get(current) ?? null : null),
    /** Mid-fade: taps and keys wait. */
    busy: () => fade.phase !== 'idle',
    /** How dark the veil is now (0..1). */
    darkness: () => darkness(fade, R),
    /** Each frame, before the camera: the fade, the swap, the zone's own tick. @param {number} dt real seconds */
    tick(dt) {
      const s = stepFade(fade, dt, R);
      fade = s.fade;
      if (s.swap) swap();
      if (veil) veil.style.opacity = String(darkness(fade, R));
      if (current) zones.get(current)?.tick?.(dt);
    },
  };
}

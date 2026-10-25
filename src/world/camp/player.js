// @ts-check
// The camp's acts, played (docs/future/13 section 3.3): walk into reach of a spot, face a thing,
// play an act (src/world/figure/acts.js), then make the change when it ends. One press always
// completes: a new press while one is still walking there takes over. Listens to walk:act-done and
// walk:arrived. Live only; nothing here is saved.

import { on } from '../../core/events.js';

/** @param {{ walk: any, terrain: { sampleHeight: (x: number, z: number) => number } }} o */
export function createActPlayer(o) {
  /** @type {{ act: string, then: () => void } | null} */ let pending = null;
  /** An act waiting for you to walk into reach first. @type {{ start: () => void, x: number, z: number, reachM: number, since: number } | null} */ let approach = null;
  let taps = 0;
  /**
   * Walk into reach of `stand` (within reachM), face `face`, play an act, then do `then` when it
   * ends. Already in reach, it plays at once. @param {string} act @param {{ x: number, z: number }} stand
   * @param {number} reachM @param {{ x: number, z: number }} face @param {() => void} then
   * @param {() => void} [started] when the act begins
   */
  function play(act, stand, reachM, face, then, started) {
    // A new press takes over from one still walking there (one press always completes).
    if (pending || !o.walk.below) return false;
    approach = null;
    const go = () => {
      approach = null;
      o.walk.faceToward(face.x, face.z);
      if (!o.walk.act(act)) return;
      pending = { act, then };
      started?.();
    };
    if (o.walk.distTo(stand.x, stand.z) <= reachM) { go(); return true; }
    // Off screen and apart each time, so the walk never reads it as a double tap.
    taps += 97;
    if (!o.walk.tap(-1e5 - taps, -1e5, [stand.x, o.terrain.sampleHeight(stand.x, stand.z), stand.z], reachM)) return false;
    approach = { start: go, x: stand.x, z: stand.z, reachM, since: 0 };
    return true;
  }

  /**
   * Each frame: an approach whose walk has ended (an arrival the walk never reported, or a walk
   * that had nowhere to go) starts its act if you are in reach, and is let go if you are not.
   * @param {number} dt
   */
  function watch(dt) {
    if (!approach) return;
    approach.since += dt;
    if (approach.since < 0.3 || o.walk.busy()) return;
    if (o.walk.distTo(approach.x, approach.z) <= approach.reachM + 0.6) approach.start();
    else approach = null;
  }
  const offs = [
    on('walk:act-done', (/** @type {any} */ p) => {
      if (!pending || p.name !== pending.act) return;
      const then = pending.then;
      pending = null;
      then();
    }),
    // In reach: the act begins. Arriving anywhere else (you clicked away) lets it go.
    on('walk:arrived', () => {
      if (!approach) return;
      if (o.walk.distTo(approach.x, approach.z) <= approach.reachM + 0.6) approach.start();
      else approach = null;
    }),
  ];
  return {
    play, watch,
    /** The act playing now, or null. */
    act: () => pending?.act ?? null,
    /** An act is playing. */
    playing: () => !!pending,
    /** An act is playing or waiting for you to walk there. */
    busy: () => !!pending || !!approach,
    dispose() { for (const off of offs) off(); },
  };
}

/** @typedef {ReturnType<typeof createActPlayer>} ActPlayer */

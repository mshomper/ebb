// @ts-check
// The causeway's reveal (docs/future/19, 'The causeway rises'; Matt, November 1, 2026: the game
// pauses so the player sees it). Once the causeway is due and you are not busy (a stroke, a card,
// the journal or the Keeper book, a station, a zone), time holds, the view glides out to frame the
// shore and the stack, and over revealS real seconds the boulders surface from the land end out to
// the stack; one line in journal italic; then the view comes back to where you were (down with you
// again if you were on foot) and time runs on. Due while you were away, it plays when you open the
// game, before the morning notes (reveal:started holds them). Numbers: recipes/setpieces/stack.json road.

import { get } from '../../core/store.js';
import { emitDeferred } from '../../core/events.js';

/**
 * @param {{ stack: import('./index.js').Stack, R: any, camera: any, walk: any, clock: { hold: (on: boolean) => void },
 *   busy: () => boolean }} o
 *   R: recipes/setpieces/stack.json; busy: anything the reveal should wait for, beyond its own list
 */
export function createRoadReveal(o) {
  const { stack, R, camera, walk } = o, D = R.road;
  /** @type {{ t: number, from: [number, number], pose: any, below: boolean, written: number } | null} */ let run = null;

  /** Is the player in the middle of something? */
  const busy = () => o.busy() || !!get('identify') || !!get('journalUi')?.open || !!get('keeperUi')?.open || !!get('stationView')
    || (typeof document !== 'undefined' && document.hidden);

  function begin() {
    const from = stack.startRoad(), L = stack.layout;
    const below = !!walk.below, pose = camera.pose();
    if (below) walk.up();
    o.clock.hold(true);
    const k = D.camera.share, x = from[0] + (L.x - from[0]) * k, z = from[1] + (L.z - from[1]) * k;
    // Looking out along the road from the island's side, a little turned so the stack stands off-centre.
    const yaw = Math.atan2(-(L.x - from[0]), -(L.z - from[1])) + 0.5;
    camera.focus(x, z, D.camera.distanceM, D.camera.pitchDeg, undefined, yaw);
    emitDeferred('reveal:started', { kind: 'stack-road' });
    run = { t: 0, from, pose, below, written: -1 };
  }

  function end() {
    if (!run) return;
    const r = run;
    run = null;
    if (!stack.risen) { stack.writeRoad(1); stack.roadDone(r.from, false); }
    o.clock.hold(false);
    camera.setPose(r.pose);
    if (r.below) walk.downHere();
    emitDeferred('reveal:ended', { kind: 'stack-road' });
  }

  return {
    id: 'stack-reveal',
    /** Playing now? */
    get playing() { return !!run; },
    /** Start it now, due or not (`?stack=road`). */
    playNow() { if (!run && !stack.risen) begin(); },
    /** Each frame (real seconds): wait for a quiet moment, then the beat. @param {number} dt */
    update(dt) {
      if (!run) {
        if (stack.roadDue() && !busy()) begin();
        return;
      }
      run.t += Math.min(dt, 0.1);
      const p = Math.min(1, run.t / D.revealS);
      if (p < 1 && run.t - run.written >= D.stepS) { if (stack.writeRoad(p)) run.written = run.t; }
      if (p >= 1 && run.written < D.revealS) {
        // Up: its line, in journal italic (the journal's note), while the view still holds on it.
        if (stack.writeRoad(1)) { run.written = D.revealS; stack.roadDone(run.from, false); }
      }
      if (run.t >= D.revealS + D.settleS) end();
    },
  };
}

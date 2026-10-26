// @ts-check
// The movement arena's actors (doc 23; WASD, October 26, 2026): stand-ins that react to the walker.
// Each actor kind is a factory in KINDS that returns { x, z, update(dt, you), shapes(), note }:
// update reads you (where, how fast, posture, gaze) and moves the actor; shapes() gives what to draw
// (boxes, as props); note says what it last did, for the arena's log. The frog uses the game's own
// presence numbers (recipes/species/frog.json presence: its ring, scaled by posture and gaze as
// src/world/creatures/presence.js ringScale, and its calm pace): a source inside the ring faster than
// the calm pace startles it, and it hops fleeM away. The Hollow's training dummies are the next
// kind: a wind-up tell, then a swing, timed from their own recipe (doc 23, the arena and the Hollow).

import { ringScale } from '../../src/world/creatures/presence.js';

/**
 * What the walker is, for the actors: where, speed, posture and the way it looks along the ground.
 * @typedef {{ x: number, z: number, speed: number, posture: 'stand'|'kneel'|'sit', gaze: [number, number] | null, rolling: boolean }} You
 */

/**
 * The frog stand-in. @param {{ x: number, z: number }} at @param {any} P recipes/species/frog.json presence
 */
function frog(at, P) {
  const s = { x: at.x, z: at.z, hop: /** @type {{ from: number[], to: number[], t: number } | null} */ (null), startles: 0, calmPasses: 0 };
  let note = 'Sitting still.';
  let inside = false;
  return {
    kind: 'frog',
    get x() { return s.x; },
    get z() { return s.z; },
    get note() { return note; },
    get startles() { return s.startles; },
    /** The ring now, as the walker stands (m). @param {You} you */
    ring(you) {
      const src = { pos: /** @type {[number, number, number]} */ ([you.x, 0, you.z]), posture: you.posture, gaze: you.gaze };
      return P.ringM * ringScale(/** @type {any} */ (src), s.x, s.z, P.multipliers);
    },
    /** @param {number} dt @param {You} you */
    update(dt, you) {
      if (s.hop) {
        s.hop.t = Math.min(1, s.hop.t + dt / 0.35);
        s.x = s.hop.from[0] + (s.hop.to[0] - s.hop.from[0]) * s.hop.t;
        s.z = s.hop.from[1] + (s.hop.to[1] - s.hop.from[1]) * s.hop.t;
        if (s.hop.t >= 1) s.hop = null;
        return;
      }
      const d = Math.hypot(you.x - s.x, you.z - s.z), r = this.ring(you);
      if (d < r && you.speed > P.calmSpeed) {
        // Startled: a hop away from you.
        const ux = (s.x - you.x) / (d || 1), uz = (s.z - you.z) / (d || 1);
        s.hop = { from: [s.x, s.z], to: [s.x + ux * P.fleeM, s.z + uz * P.fleeM], t: 0 };
        s.startles++;
        note = `Startled: you came within ${d.toFixed(1)} m at ${you.speed.toFixed(2)} m/s${you.rolling ? ', rolling' : ''} (its ring ${r.toFixed(1)} m, calm under ${P.calmSpeed} m/s).`;
        inside = false;
        return;
      }
      if (d < r && !inside) note = `You are inside its ring at ${you.speed.toFixed(2)} m/s: calm.`;
      inside = d < r;
    },
    /** Boxes to draw: [cx, cy, cz, hx, hy, hz, yaw, r, g, b]. @param {(x: number, z: number) => number} ground */
    shapes(ground) {
      const y = ground(s.x, s.z) + (s.hop ? Math.sin(Math.PI * s.hop.t) * 0.3 : 0);
      return [[s.x, y + 0.1, s.z, 0.16, 0.1, 0.2, 0, 0.37, 0.5, 0.36]];
    },
  };
}

/** Actor kinds by name. @type {Record<string, (at: any, recipes: Record<string, any>) => any>} */
export const KINDS = {
  frog: (at, rec) => frog(at, rec.frog.presence),
};

/** @typedef {ReturnType<typeof frog>} Actor */

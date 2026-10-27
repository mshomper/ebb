// @ts-check
// The movement arena's actors (doc 23; WASD, October 26, 2026): stand-ins that react to the walker.
// Each actor kind is a factory in KINDS that returns { x, z, update(dt, you), shapes(), note }:
// update reads you (where, how fast, posture, gaze) and moves the actor; shapes() gives what to draw
// (boxes, as props); note says what it last did, for the arena's log. The frog uses the game's own
// presence numbers (recipes/species/frog.json presence: its ring, scaled by posture and gaze as
// src/world/creatures/presence.js ringScale, and its calm pace): a source inside the ring faster than
// the calm pace startles it, and it hops fleeM away. The Hollow's stand-ins (H0, October 27, 2026) are
// three more kinds, lunger, watcher and motes: their steps run in src/world/hollow/foes.js, timed from
// recipes/world/hollow.json foes, and here they are drawn as plain shapes showing their tells.
// Motes' swirl reads the arena's clock for drawing only; where the cluster is comes from the seeded
// steps. Since H2 (October 27, 2026) the motes are Matt's model, five a swarm (mote-swarm.js), and the
// lunger is Matt's silt crawler, rigged and moving by crawler-motion.js on the same steps; the watcher
// is the hagstone watcher from the generator, its float, weed and light by watcher-motion.js.

import { ringScale } from '../../src/world/creatures/presence.js';
import { createFoe } from '../../src/world/hollow/foes.js';
import { createSwarm } from '../../src/world/hollow/mote-swarm.js';
import { createCrawlerMotion } from '../../src/world/hollow/crawler-motion.js';
import { createWatcherMotion } from '../../src/world/hollow/watcher-motion.js';
import { hash32 } from '../../src/core/rng.js';

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

/** A colour drawn unlit (the stage reads a negative colour as light of its own). @param {number[]} c */
const glow = (c) => c.map((v) => -Math.max(1e-3, v));

/**
 * A Hollow stand-in (H0; src/world/hollow/foes.js): the thing's steps run there, and this draws it
 * as plain shapes, showing its tell. update(dt, you) needs the lantern and the open ground in you
 * (the Hollow layer, tools/arena/hollow.js, adds them) and returns what it did (strikes, calls).
 * @param {'lunger' | 'watcher' | 'motes'} kind @param {{ x: number, z: number, id: number }} at @param {Record<string, any>} rec
 */
function standIn(kind, at, rec) {
  const H = rec.hollow;
  const f = createFoe(kind, at.id, at, H.foes[kind], rec.seed ?? 1, H.swing);
  const SIZE = { lunger: 0.4, watcher: 0.45, motes: 0.5 };
  // H2: the motes are Matt's model, each worked out round the cluster (mote-swarm.js) and drawn by
  // tools/arena/mote-pass.js; the plain shapes stay only if the model is not loaded.
  const swarm = kind === 'motes' && rec.moteAcrossM ? createSwarm(f, H.foes.motes.mote, hash32(rec.seed ?? 1, at.id), rec.moteAcrossM) : null;
  // The lunger is Matt's silt crawler (H2): its rig moved by crawler-motion.js, drawn by tools/arena/crawler-pass.js.
  const crawler = kind === 'lunger' && rec.crawlerModel ? createCrawlerMotion(f, rec.crawlerModel, H.foes.lunger, hash32(rec.seed ?? 1, at.id, 0x637277)) : null;
  // The watcher is the hagstone from the generator (H2): its float, weed and hole's light moved by
  // watcher-motion.js, drawn by tools/arena/watcher-pass.js. Its cues (the tell, the call) go to rec.onCue.
  const watcher = kind === 'watcher' && rec.watcherModel ? createWatcherMotion(f, rec.watcherModel, H.foes.watcher, hash32(rec.seed ?? 1, at.id, 0x776174), rec.onCue) : null;
  return {
    kind, foe: f, id: at.id, swarm, crawler, watcher,
    get x() { return f.x; },
    get z() { return f.z; },
    get note() { return `${H.foes[kind].name}: ${f.note}`; },
    get startles() { return 0; },
    get broken() { return f.broken; },
    /** Its own radius (m), for hits and the lock ring. */
    size: SIZE[kind],
    ring() { return 0; },
    /** @param {number} dt @param {any} you */
    update(dt, you) { return f.update(dt, { you, lamp: you.lamp, open: you.open, crowd: you.crowd }); },
    /** @param {(x: number, z: number) => number} ground */
    shapes(ground) {
      if (f.broken || crawler || watcher) return [];
      // Hit: it flashes pale and hops, tipping back (hurt, 0..1).
      const hurt = Math.min(1, f.hurtS / 0.2), flash = /** @param {number[]} col */ (col) => (hurt > 0 ? col.map((v) => v + (1.6 - v) * hurt) : col);
      const y = ground(f.x, f.z) + Math.sin(Math.min(1, hurt) * Math.PI) * 0.12, c = Math.cos(f.yaw), s = Math.sin(f.yaw), tell = f.step === 'wind', stun = f.stunS > 0 && hurt === 0;
      /** A point ahead (fwd) and to the side (side) of it, turned with it. @param {number} fwd @param {number} side */
      const at2 = (fwd, side) => [f.x + s * fwd + c * side, f.z + c * fwd - s * side];
      if (kind === 'lunger') {
        const lift = tell ? Math.min(1, f.t / 0.2) * 0.22 : 0, [fx, fz] = at2(0.36, 0);
        const [lx, lz] = at2(0.42, 0.22), [rx, rz] = at2(0.42, -0.22);
        const claw = tell ? [0.95, 0.85, 0.7] : [0.5, 0.42, 0.34];
        return [
          [f.x, y + 0.16, f.z, 0.32, 0.16, 0.36, f.yaw, ...flash(stun ? [0.55, 0.62, 0.8] : f.step === 'recover' ? [0.62, 0.5, 0.38] : [0.45, 0.38, 0.3])],
          // The armored front: a darker plate.
          [fx, y + 0.2, fz, 0.34, 0.19, 0.06, f.yaw, 0.26, 0.24, 0.22],
          [lx, y + 0.2 + lift, lz, 0.06, 0.06, 0.14, f.yaw, ...claw],
          [rx, y + 0.2 + lift, rz, 0.06, 0.06, 0.14, f.yaw, ...claw],
        ];
      }
      if (kind === 'watcher') {
        const hy = y + 1.5 + Math.sin(f.x * 3 + f.z) * 0.05, [hx, hz] = at2(0.36, 0);
        const bright = tell ? 0.5 + 0.5 * Math.min(1, f.t / (H.foes.watcher.windS || 1)) : f.step === 'close' || f.step === 'notice' ? 0.35 : 0.15;
        return [
          [f.x, hy, f.z, 0.42, 0.4, 0.34, f.yaw, ...flash(stun ? [0.55, 0.62, 0.8] : [0.5, 0.5, 0.47])],
          // The hole through it, glowing brighter for its tell.
          [hx, hy, hz, 0.13, 0.13, 0.04, f.yaw, ...glow([1.6 * bright, 1.3 * bright, 0.7 * bright])],
        ];
      }
      if (swarm) return [];
      // Motes: a loose swarm round the cluster's middle, bunched tight in the tell.
      const tight = tell ? 0.35 : f.step === 'recover' ? 1.6 : 1;
      return f.members.map(([ph, sp, r], i) => {
        const a = ph + performance.now() / 1000 * sp * 2.2, rr = r * tight;
        return /** @type {number[]} */ ([f.x + Math.sin(a) * rr, y + 0.6 + Math.sin(a * 1.7 + i) * 0.18 * tight, f.z + Math.cos(a) * rr, 0.05, 0.05, 0.05, a, ...glow([0.32, 0.22, 0.16])]);
      });
    },
  };
}

/** Actor kinds by name. @type {Record<string, (at: any, recipes: Record<string, any>) => any>} */
export const KINDS = {
  frog: (at, rec) => frog(at, rec.frog.presence),
  lunger: (at, rec) => standIn('lunger', at, rec),
  watcher: (at, rec) => standIn('watcher', at, rec),
  motes: (at, rec) => standIn('motes', at, rec),
};

/** @typedef {ReturnType<typeof frog>} Actor */

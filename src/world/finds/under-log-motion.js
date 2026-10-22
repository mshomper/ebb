// @ts-check
// How a creature uncovered by a Lift runs for cover (docs/future/11 L3a): it freezes for a beat,
// then runs for its spot under the log's edge, weaving a little left and right, turning to face
// the way it runs, and stops there. A beetle may first dash further out into the open and only
// turn back for cover later. Everything comes from the find's start, its seeded r, its target and
// the kind's `scuttle` numbers, so the same lift plays the same way every time. Pure.

import { det } from '../../core/rng.js';

/**
 * @typedef {{ x: number, z: number, yaw: number, r: number, tx: number, tz: number }} Uncovered
 *   start spot, facing (yaw 0 faces +z), a seeded 0..1 r, and the target under the log's edge
 * @typedef {{ x: number, z: number, yaw: number, running: boolean, step: number }} Scuttle
 * @typedef {{ kind: 'still', t0: number, t1: number } | { kind: 'run', t0: number, t1: number, ax: number, az: number, bx: number, bz: number }} Leg
 */

const TAU = det.PI * 2;

/** @param {number} a @param {number} b @param {number} t */
function turnTo(a, b, t) {
  let d = (b - a) % TAU;
  if (d > det.PI) d -= TAU;
  if (d < -det.PI) d += TAU;
  return a + d * t;
}

/**
 * The legs of the run: still, then each dash, with the times they start and end.
 * @param {Uncovered} e @param {any} S under-log.json <kind>.scuttle @returns {Leg[]}
 */
function plan(e, S) {
  const r = e.r;
  const freeze = S.freezeS[0] + (S.freezeS[1] - S.freezeS[0]) * r;
  /** @type {Leg[]} */ const legs = [{ kind: 'still', t0: 0, t1: freeze }];
  let t = freeze, x = e.x, z = e.z;
  /** @param {number} bx @param {number} bz */
  const dash = (bx, bz) => {
    const d = Math.hypot(bx - x, bz - z), dt = d / Math.max(S.speedMps, 1e-6);
    if (d < 1e-9) return;
    legs.push({ kind: 'run', t0: t, t1: t + dt, ax: x, az: z, bx, bz });
    t += dt; x = bx; z = bz;
  };
  if (S.outM) {
    // Out into the open first: away from cover, veering by up to outSpreadDeg either way.
    let ax = x - e.tx, az = z - e.tz;
    const l = Math.hypot(ax, az);
    if (l < 1e-9) { ax = det.sin(e.yaw); az = det.cos(e.yaw); } else { ax /= l; az /= l; }
    const v = ((r * 2 - 1) * (S.outSpreadDeg ?? 0) * det.PI) / 180, c = det.cos(v), s = det.sin(v);
    dash(x + (ax * c - az * s) * S.outM, z + (ax * s + az * c) * S.outM);
    // Then it waits until backAfterS (from the lift) before turning back for cover.
    const back = S.backAfterS ?? 0;
    if (back > t) { legs.push({ kind: 'still', t0: t, t1: back }); t = back; }
  }
  dash(e.tx, e.tz);
  legs.push({ kind: 'still', t0: t, t1: Infinity });
  return legs;
}

/**
 * Where an uncovered find is at t seconds after the lift, which way it faces, whether it runs, and
 * its leg phase (radians: stepHz while running, idleHz while still).
 * @param {Uncovered} e @param {number} t @param {any} S under-log.json <kind>.scuttle
 * @returns {Scuttle}
 */
export function scuttle(e, t, S) {
  t = Math.max(0, t);
  const legs = plan(e, S);
  let step = e.r * TAU, x = e.x, z = e.z, yaw = e.yaw, running = false;
  for (const L of legs) {
    const span = Math.min(t, L.t1) - L.t0;
    if (span < 0) break;
    if (L.kind === 'still') { step += span * TAU * S.idleHz; continue; }
    step += span * TAU * S.stepHz;
    const len = Math.hypot(L.bx - L.ax, L.bz - L.az), dx = (L.bx - L.ax) / len, dz = (L.bz - L.az) / len;
    const s = Math.min(len, span * S.speedMps), f = s / len;
    // Weaving: a seeded wave across the path, fading to nothing at both ends.
    const k = TAU / Math.max(S.wanderEveryM, 1e-6), ph = e.r * 7.1 + L.t0;
    const env = det.sin(det.PI * f), denv = (det.PI / len) * det.cos(det.PI * f);
    const off = S.wanderM * env * det.sin(k * s + ph), doff = S.wanderM * (denv * det.sin(k * s + ph) + env * k * det.cos(k * s + ph));
    x = L.ax + dx * s - dz * off; z = L.az + dz * s + dx * off;
    // Face along the path (its weave too), turning from where it faced over turnS.
    const face = det.atan2(dx - dz * doff, dz + dx * doff);
    yaw = turnTo(yaw, face, Math.min(1, span / Math.max(S.turnS, 1e-6)));
    running = t < L.t1;
  }
  return { x, z, yaw, running, step };
}

/**
 * When the run is over (the find sits at its target from then on), for callers that free it.
 * @param {Uncovered} e @param {any} S @returns {number} seconds after the lift
 */
export function scuttleEnds(e, S) {
  const legs = plan(e, S);
  return legs[legs.length - 1].t0;
}

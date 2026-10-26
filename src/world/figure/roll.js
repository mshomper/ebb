// @ts-check
// The dodge roll on the walker's rig (doc 23; WASD, October 26, 2026, Space): tuck, roll over the
// shoulder, back up onto the feet. motion.js curls the body into a ball over the roll (the tuck: knees
// to the chest, spine and head curled, hands to the shins), and the whole posed figure turns once
// about a point in the middle of the ball, on an axis tilted across the back so it goes over one
// shoulder. Numbers: recipes/world/figure.json roll (body meters). Pure; live animation only.

import { moveMatrix, mul } from '../creatures/pose.js';
import { qaxis, norm, smooth } from './kinematics.js';

/** 0..1 between a and b, eased. @param {number} u @param {number} a @param {number} b */
const ease = (u, a, b) => smooth(Math.min(1, Math.max(0, (u - a) / (b - a))));

/**
 * The roll at share u (0..1) of its length: how tucked (0..1) and how far turned (radians).
 * @param {any} RO recipes/world/figure.json roll @param {number} u
 */
export function rollPose(RO, u) {
  if (u < 0) return { tuck: 0, angle: 0 };
  const tuck = Math.min(ease(u, 0, RO.tuck[0]), 1 - ease(u, RO.tuck[1], 1));
  return { tuck, angle: 2 * Math.PI * ease(u, RO.turn[0], RO.turn[1]) };
}

/**
 * Turn every posed bone (body space, 16 floats each) by the roll's angle about the ball's middle.
 * Then the ball is lowered or raised so its lowest joint touches the ground.
 * @param {any} RO @param {Float32Array} bones @param {number} angle @param {number} groundY the ground under you (body m)
 * @param {number[][]} pivots each bone's rest joint (body m)
 */
export function turnBones(RO, bones, angle, groundY, pivots) {
  if (!angle) return;
  const M = moveMatrix([0, groundY + RO.pivotY, RO.pivotZ], { q: qaxis(norm([1, 0, RO.shoulderTilt]), angle) });
  const tmp = new Float32Array(16);
  for (let o = 0; o < bones.length; o += 16) {
    tmp.set(bones.subarray(o, o + 16));
    mul(M, tmp, bones, o);
  }
  // Keep the ball on the ground all the way round: the lowest joint sits contactM over it.
  let low = Infinity;
  pivots.forEach((p, i) => {
    const o = i * 16;
    low = Math.min(low, bones[o + 1] * p[0] + bones[o + 5] * p[1] + bones[o + 9] * p[2] + bones[o + 13]);
  });
  // Eased in and out at the turn's ends, so setting off and landing never jump.
  const w = Math.min(1, angle / 0.6, (2 * Math.PI - angle) / 0.6);
  const dy = (groundY + RO.contactM - low) * Math.max(0, w);
  for (let o = 0; o < bones.length; o += 16) bones[o + 13] += dy;
}

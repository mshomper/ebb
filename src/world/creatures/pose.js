// @ts-check
// Posing a creature (S6b, doc 11): each bone moves about its own pivot (a turn, a stretch, a shift),
// on top of its parent, and the result is one matrix per bone that the draw pass skins the body
// with. The body's rest pose is every bone still, so a still skeleton draws the baked body exactly.
// Live animation only (never saved); plain Math is fine here.

/** @typedef {{ q?: number[], s?: number[], t?: number[] }} BoneMove  q: quaternion [x, y, z, w]; s: scale; t: shift (body m) */

/** out = a * b, column-major 4x4. @param {Float32Array | number[]} a @param {Float32Array | number[]} b @param {Float32Array} out @param {number} o */
export function mul(a, b, out, o) {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[o + c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
}

/**
 * One bone's move about its pivot p: translate(p + t) * rotate(q) * scale(s) * translate(-p).
 * @param {number[]} p @param {BoneMove} m @returns {number[]}
 */
export function moveMatrix(p, m) {
  const [x, y, z, w] = m.q ?? [0, 0, 0, 1];
  const [sx, sy, sz] = m.s ?? [1, 1, 1];
  const t = m.t ?? [0, 0, 0];
  // Rotation columns, each scaled.
  const r = [
    (1 - 2 * (y * y + z * z)) * sx, (2 * (x * y + z * w)) * sx, (2 * (x * z - y * w)) * sx,
    (2 * (x * y - z * w)) * sy, (1 - 2 * (x * x + z * z)) * sy, (2 * (y * z + x * w)) * sy,
    (2 * (x * z + y * w)) * sz, (2 * (y * z - x * w)) * sz, (1 - 2 * (x * x + y * y)) * sz,
  ];
  // The pivot carried through: p + t - R S p.
  const tx = p[0] + t[0] - (r[0] * p[0] + r[3] * p[1] + r[6] * p[2]);
  const ty = p[1] + t[1] - (r[1] * p[0] + r[4] * p[1] + r[7] * p[2]);
  const tz = p[2] + t[2] - (r[2] * p[0] + r[5] * p[1] + r[8] * p[2]);
  return [r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, tx, ty, tz, 1];
}

/**
 * Every bone's matrix (body space), parents first, written as 16 floats a bone from `offset`.
 * @param {{ parent: number, pivot: number[] }[]} skeleton @param {(BoneMove | null)[]} moves one per bone, null for still
 * @param {Float32Array} out @param {number} offset in floats
 */
export function poseSkeleton(skeleton, moves, out, offset) {
  for (let i = 0; i < skeleton.length; i++) {
    const b = skeleton[i];
    const local = moves[i] ? moveMatrix(b.pivot, /** @type {BoneMove} */ (moves[i])) : null;
    const o = offset + i * 16;
    if (b.parent < 0) {
      if (local) out.set(local, o); else out.set(IDENTITY, o);
    } else {
      const parent = out.subarray(offset + b.parent * 16, offset + b.parent * 16 + 16);
      if (local) mul(parent, local, out, o); else out.set(parent, o);
    }
  }
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** A unit quaternion turning `angle` radians about a unit axis. @param {number[]} a @param {number} angle */
export function axisAngle(a, angle) {
  const s = Math.sin(angle / 2);
  return [a[0] * s, a[1] * s, a[2] * s, Math.cos(angle / 2)];
}

/** A small hash to 0..1 for a frog's own timing. @param {number} id @param {number} k */
function h01(id, k) {
  let x = Math.imul(id ^ Math.imul(k, 0x9e3779b1), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/**
 * The still frog, alive: the throat swelling and the body breathing, and now and then a blink.
 * @param {{ name: string }[]} skeleton @param {number} t seconds of animation time @param {number} id the frog
 * @param {any} motion recipes/species/frog.json motion
 * @returns {(BoneMove | null)[]}
 */
export function idleMoves(skeleton, t, id, motion) {
  const B = motion.breath, K = motion.blink;
  const moves = skeleton.map(() => /** @type {BoneMove | null} */ (null));
  const at = (/** @type {string} */ name) => skeleton.findIndex((b) => b.name === name);
  // Breathing: the throat pulses down and forward; the body barely rises.
  const ph = h01(id, 1) * Math.PI * 2;
  const breath = 0.5 + 0.5 * Math.sin(t * B.hz * Math.PI * 2 + ph);
  const throat = at('throat');
  if (throat >= 0) moves[throat] = { s: [1 + 0.4 * B.sac * breath, 1 + B.sac * breath, 1 + 0.7 * B.sac * breath] };
  const torso = at('torso');
  if (torso >= 0) moves[torso] = { s: [1 + B.torso * breath, 1 + B.torso * breath, 1] };
  // A blink, every few seconds, out of step with other frogs: as a frog does, the eyes sink into
  // the head (retractM) under their lids, a little flattened (squash).
  const span = K.everyS[0] + (K.everyS[1] - K.everyS[0]) * h01(id, 2);
  const into = (t + h01(id, 3) * span) % span;
  if (into < K.s) {
    const closed = 1 - Math.abs(into / K.s * 2 - 1);
    const sy = 1 - (1 - K.squash) * closed;
    const down = (K.retractM ?? 0) * closed;
    for (const eye of ['eye.l', 'eye.r']) { const i = at(eye); if (i >= 0) moves[i] = down ? { s: [1, sy, 1], t: [0, -down, 0] } : { s: [1, sy, 1] }; }
  }
  return moves;
}

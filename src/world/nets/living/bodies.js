// @ts-check
// Living catches built with the creature body bake (docs/future/12, K6): blended shapes in real
// meters, body-local +z forward, y up, origin in the middle, baked by bakeBody as the minnows are.
// One plan per body form: eel (sand eel), goby, pipe (pipefish), flat (young plaice), wrasse,
// shrimp and crab. Every size is a share of the catch's length L, so a bigger catch is the same
// shape scaled; fins are kept a little thicker than one bake cell so they never break up. Pure.

import { bakeBody } from '../../creatures/body-bake.js';

/** Bake cells along the body, per plan: thin bodies need finer cells. */
const RES = /** @type {Record<string, number>} */ ({ eel: 90, goby: 60, pipe: 140, flat: 60, wrasse: 64, shrimp: 70, crab: 40 });

/**
 * @typedef {{ kind: string, plan: string, lengthM: number, h: number, w: number, morph: boolean,
 *   blot: number[], curl: number }} BodyNumbers h, w: height and width as shares of the length;
 *   blot: the blotches' offset (each one marked its own way); curl: a shrimp's curl, a crab's stance
 */

const sph = (/** @type {number[]} */ c, /** @type {number} */ r, /** @type {string} */ region, k = 0) => ({ type: 'sphere', c, r, region, k });
const ell = (/** @type {number[]} */ c, /** @type {number[]} */ r, /** @type {string} */ region, k = 0, rot = [0, 0, 0]) => ({ type: 'ellipsoid', c, r, region, k, rot });
const cap = (/** @type {number[]} */ a, /** @type {number[]} */ b, /** @type {number[]} */ r, /** @type {string} */ region, k = 0) => ({ type: 'capsule', a, b, r, region, k });

/**
 * The primitives for one catch. @param {BodyNumbers} n @param {number} t a fin's half thickness (m)
 * @returns {any[]}
 */
export function bodyPrims(n, t) {
  const L = n.lengthM, H = n.h * L / 2, W = n.w * L / 2;
  const both = (/** @type {(s: number) => any} */ f) => [f(1), f(-1)];
  switch (n.plan) {
    case 'eel': return [
      cap([0, 0, 0.36 * L], [0, 0.002 * L, -0.42 * L], [H, 0.014 * L], 'back'),
      cap([0, -0.004 * L, 0.36 * L], [0, -0.012 * L, 0.5 * L], [0.85 * H, 0.012 * L], 'back', 0.02 * L),
      ell([0, H * 0.85, -0.06 * L], [t, 0.016 * L, 0.27 * L], 'fin', 0.01 * L),
      ell([0, 0.022 * L, -0.47 * L], [t, 0.032 * L, 0.05 * L], 'fin', 0.008 * L, [-34, 0, 0]),
      ell([0, -0.02 * L, -0.47 * L], [t, 0.032 * L, 0.05 * L], 'fin', 0.008 * L, [34, 0, 0]),
      ...both((s) => sph([s * 0.62 * W, 0.012 * L, 0.42 * L], 0.013 * L, 'eye', 0.003 * L)),
    ];
    case 'goby': return [
      ell([0, 0, 0.24 * L], [W * 1.1, H, 0.22 * L], 'back'),
      cap([0, -0.005 * L, 0.12 * L], [0, 0.005 * L, -0.38 * L], [H * 0.82, 0.035 * L], 'back', 0.05 * L),
      ell([0, H + 0.03 * L, 0.04 * L], [t, 0.055 * L, 0.07 * L], 'fin', 0.02 * L),
      ell([0, H * 0.75 + 0.03 * L, -0.17 * L], [t, 0.05 * L, 0.11 * L], 'fin', 0.02 * L),
      ell([0, -H * 0.7 - 0.02 * L, -0.17 * L], [t, 0.04 * L, 0.1 * L], 'fin', 0.02 * L),
      ell([0, 0.004 * L, -0.45 * L], [t, 0.075 * L, 0.08 * L], 'fin', 0.02 * L),
      ...both((s) => ell([s * W * 1.05, -0.03 * L, 0.12 * L], [0.07 * L, t, 0.06 * L], 'fin', 0.015 * L, [0, 0, s * -20])),
      ...both((s) => sph([s * 0.045 * L, H * 0.82, 0.33 * L], 0.032 * L, 'eye', 0.005 * L)),
    ];
    case 'pipe': return [
      cap([0, 0, 0.28 * L], [0, 0, -0.46 * L], [H, H * 0.45], 'back'),
      ell([0, 0.002 * L, 0.27 * L], [W * 1.25, H * 1.25, 0.05 * L], 'back', 0.01 * L),
      cap([0, 0.003 * L, 0.3 * L], [0, 0.006 * L, 0.5 * L], [H * 0.6, H * 0.38], 'back', 0.008 * L),
      ell([0, H + 0.008 * L, -0.05 * L], [t, 0.013 * L, 0.06 * L], 'fin', 0.006 * L),
      ell([0, 0, -0.49 * L], [t, 0.022 * L, 0.02 * L], 'fin', 0.005 * L),
      ...both((s) => sph([s * W * 1.0, 0.005 * L, 0.29 * L], Math.max(0.011 * L, t * 1.4), 'eye', 0.002 * L)),
    ];
    case 'flat': return [
      ell([0, 0, 0.02 * L], [W, H, 0.4 * L], 'back'),
      ell([0, -H * 0.2, 0.0], [W + 0.05 * L, t, 0.44 * L], 'fin', 0.03 * L),
      ell([0, 0, -0.46 * L], [0.11 * L, t, 0.07 * L], 'fin', 0.03 * L),
      sph([0.035 * L, H * 0.85, 0.3 * L], 0.026 * L, 'eye', 0.006 * L),
      sph([-0.04 * L, H * 0.75, 0.26 * L], 0.026 * L, 'eye', 0.006 * L),
    ];
    case 'wrasse': return [
      ell([0, 0, 0.04 * L], [W, H, 0.36 * L], 'back'),
      cap([0, 0, -0.18 * L], [0, 0.004 * L, -0.4 * L], [0.09 * L, 0.04 * L], 'back', 0.05 * L),
      ell([0, 0.004 * L, -0.46 * L], [t, 0.09 * L, 0.08 * L], 'fin', 0.02 * L),
      ell([0, H * 0.92, -0.08 * L], [t, 0.05 * L, 0.3 * L], 'fin', 0.03 * L),
      ell([0, -H * 0.8, -0.2 * L], [t, 0.04 * L, 0.12 * L], 'fin', 0.02 * L),
      ell([0, -0.03 * L, 0.39 * L], [0.04 * L, 0.03 * L, 0.035 * L], 'belly', 0.015 * L),
      ...both((s) => ell([s * W * 0.95, -0.03 * L, 0.12 * L], [t, 0.05 * L, 0.06 * L], 'fin', 0.01 * L, [0, s * 30, 0])),
      ...both((s) => sph([s * W * 0.72, 0.05 * L, 0.29 * L], 0.03 * L, 'eye', 0.005 * L)),
    ];
    case 'shrimp': {
      // A spine from the head (s 0) to the tail (s 1): arched, the tail curling under.
      const at = (/** @type {number} */ s) => [0, (0.1 * Math.sin(Math.PI * s) - n.curl * Math.max(0, s - 0.65) ** 2 * 1.4) * L, (0.42 - 0.84 * s) * L];
      const out = [ell(at(0.14), [W, H, 0.2 * L], 'back')];
      for (let i = 0; i < 8; i++) {
        const s = 0.33 + i * 0.08, r = H * (0.92 - i * 0.085);
        out.push(ell(at(s), [r * (W / H), r, 0.06 * L], 'back', 0.03 * L));
      }
      const tail = at(0.95);
      out.push(...both((s) => ell([s * 0.03 * L, tail[1], tail[2] - 0.02 * L], [0.04 * L, t, 0.07 * L], 'fin', 0.03 * L, [0, s * 20, 0])));
      const head = at(0);
      out.push(cap([0, head[1] + 0.02 * L, head[2]], [0, head[1] + 0.05 * L, head[2] + 0.12 * L], [t * 1.6, t], 'back', 0.01 * L));
      out.push(...both((s) => cap([s * 0.02 * L, head[1] + 0.03 * L, head[2]], [s * 0.1 * L, head[1] + 0.12 * L, head[2] + 0.45 * L], [t * 1.2, t], 'fin', 0.008 * L)));
      for (let i = 0; i < 4; i++) {
        const p = at(0.22 + i * 0.1);
        out.push(...both((s) => cap([s * 0.02 * L, p[1] - H * 0.7, p[2]], [s * 0.05 * L, p[1] - H * 0.7 - 0.09 * L, p[2] + 0.02 * L], [t * 1.1, t], 'fin', 0.006 * L)));
      }
      out.push(...both((s) => sph([s * 0.04 * L, head[1] + 0.035 * L, head[2] + 0.02 * L], 0.026 * L, 'eye', 0.004 * L)));
      return out;
    }
    case 'crab': {
      const y0 = 0.32 * L;
      const out = [ell([0, y0, 0], [W, H, 0.5 * L], 'back')];
      // Four walking legs a side, each out and up to a knee, then down to its tip.
      [0.16, 0.02, -0.13, -0.27].forEach((z, i) => {
        out.push(...both((s) => {
          const root = [s * W * 0.82, y0 - 0.04 * L, z * L];
          const knee = [s * (W + 0.32 * L), y0 + 0.1 * L * n.curl, (z - 0.06 - i * 0.03) * L];
          return cap(root, knee, [0.07 * L, 0.05 * L], 'fin', 0.03 * L);
        }));
        out.push(...both((s) => {
          const knee = [s * (W + 0.32 * L), y0 + 0.1 * L * n.curl, (z - 0.06 - i * 0.03) * L];
          const tip = [s * (W + 0.5 * L), 0.0, (z - 0.12 - i * 0.05) * L];
          return cap(knee, tip, [0.05 * L, 0.025 * L], 'fin', 0.02 * L);
        }));
      });
      // Claws: an arm forward, a pincer at its end.
      out.push(...both((s) => cap([s * W * 0.6, y0 - 0.02 * L, 0.32 * L], [s * W * 0.95, y0 - 0.06 * L, 0.6 * L], [0.075 * L, 0.06 * L], 'fin', 0.03 * L)));
      out.push(...both((s) => ell([s * W * 0.9, y0 - 0.06 * L, 0.74 * L], [0.12 * L, 0.085 * L, 0.17 * L], 'back', 0.03 * L, [0, s * -15, 0])));
      out.push(...both((s) => sph([s * 0.13 * L, y0 + H * 0.85, 0.47 * L], 0.045 * L, 'eye', 0.01 * L)));
      return out;
    }
    default: return [sph([0, 0, 0], L / 2, 'back')];
  }
}

/**
 * Bake a catch's body: the mesh in the creature pass's layout (9 floats a vertex).
 * @param {BodyNumbers} n @param {any} kind recipes/world/nets.json catches.kinds[n.kind]
 * @returns {{ vertices: Float32Array, indices: Uint32Array, count: number }}
 */
export function bakeCatch(n, kind) {
  const cell = n.lengthM / (RES[n.plan] ?? 60);
  const A = { ...kind.albedo };
  let amount = kind.blotch.amount;
  if (n.morph && kind.morph) {
    for (const k of ['back', 'belly', 'blotch', 'fin']) if (kind.morph[k]) A[k] = kind.morph[k];
    if (kind.morph.amount !== undefined) amount = kind.morph.amount;
  }
  const body = {
    prims: bodyPrims(n, cell * 0.75),
    albedo: A,
    blotch: { scale: kind.blotch.scale / (n.lengthM / 0.1), amount, offset: n.blot },
    bellyBelowNormalY: n.plan === 'flat' ? -0.3 : -0.15,
  };
  const m = bakeBody(body, cell);
  return { vertices: m.vertices, indices: m.indices, count: m.count };
}

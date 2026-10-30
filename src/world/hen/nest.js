// @ts-check
// Where the hen's eggs lie (docs/future/15, slice 4), drawn and tapped: her scrape under the scrub
// (a shallow dark hollow), the nest box at camp (session-made, a basic shape: a box of sticks with
// a rush lining, in the camp's `nest` slot), the eggs waiting in either, and her moulted feather by
// the roost in autumn. Each has a card; a nest with eggs offers Take an egg (src/app.js hen.egg).
// Pure meshes in the props pass's layout (position, normal, uv: 8 floats a vertex) and pure cards.
// Numbers: recipes/species/hen.json eggs.

import { stick } from './perch.js';

/** @typedef {{ data: Float32Array, indices: Uint32Array }} PropMesh */

/**
 * An egg: an ellipsoid a touch fuller at one end, lying on its side along z, its lowest point on the
 * origin. @param {number[]} eggM [length, width] (m) @param {number} [n] @returns {PropMesh}
 */
export function eggMesh(eggM, n = 10) {
  /** @type {number[]} */ const V = [];
  /** @type {number[]} */ const I = [];
  const a = eggM[0] / 2, b = eggM[1] / 2;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI, z = -Math.cos(t) * a;
    // Fuller toward +z, the blunt end.
    const r = Math.sin(t) * b * (1 + 0.12 * (z / a));
    for (let j = 0; j <= n; j++) {
      const p = (j / n) * Math.PI * 2, x = Math.cos(p) * r, y = Math.sin(p) * r + b;
      const nx = Math.cos(p) * Math.sin(t) / b, ny = Math.sin(p) * Math.sin(t) / b, nz = -Math.cos(t) / a;
      const l = Math.hypot(nx, ny, nz) || 1;
      V.push(x, y, z, nx / l, ny / l, nz / l, j / n, i / n);
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const p = i * (n + 1) + j, q = p + n + 1;
    I.push(p, q, p + 1, p + 1, q, q + 1);
  }
  return { data: new Float32Array(V), indices: new Uint32Array(I) };
}

/**
 * The scrape: a shallow dished disc a hair above the ground, darker earth scratched bare.
 * @param {number} r radius (m) @param {number} [n] @returns {PropMesh}
 */
export function scrapeMesh(r, n = 18) {
  const V = [0, 0.003, 0, 0, 1, 0, 0.5, 0.5];
  /** @type {number[]} */ const I = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2, wob = 1 + 0.12 * Math.sin(a * 3);
    V.push(Math.sin(a) * r * wob, 0.006, Math.cos(a) * r * wob, 0, 1, 0, 0.5 + 0.5 * Math.sin(a), 0.5 + 0.5 * Math.cos(a));
  }
  for (let i = 1; i <= n; i++) I.push(0, i, i + 1);
  return { data: new Float32Array(V), indices: new Uint32Array(I) };
}

/**
 * The nest box: an open square box of sticks laid in courses on a floor of sticks, the origin on the
 * ground at its middle (its rush bed is drawn on its own, bedMesh, in the rushes' colour). @param {number} [w] its width (m) @returns {PropMesh}
 */
export function nestBoxMesh(w = 0.34) {
  /** @type {number[]} */ const V = [];
  /** @type {number[]} */ const I = [];
  const h = w * 0.5, s = w / 2, r = 0.012;
  // Courses of sticks, crossing at the corners, alternating which pair is on top.
  for (let c = 0; c < 4; c++) {
    const y = r + c * (h / 4), long = s + 0.03;
    if (c % 2 === 0) for (const z of [-s, s]) stick(V, I, [-long, y, z], [long, y, z], r, r * 0.9);
    else for (const x of [-s, s]) stick(V, I, [x, y, -long], [x, y, long], r, r * 0.9);
  }
  // The floor: sticks side by side.
  for (let i = 0; i < 6; i++) { const z = -s + (i + 0.5) * (w / 6); stick(V, I, [-s, 0.01, z], [s, 0.01, z], 0.01, 0.01, 5); }
  return { data: new Float32Array(V), indices: new Uint32Array(I) };
}

/**
 * The nest box's rush bed: a rounded mound of rushes filling the box, a little hollow in its middle.
 * @param {number} [w] the box's width (m) @param {number} [n] @returns {PropMesh}
 */
export function bedMesh(w = 0.34, n = 16) {
  const r = w * 0.46, V = [0, 0.03, 0, 0, 1, 0, 0.5, 0.5];
  /** @type {number[]} */ const I = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2, wob = 1 + 0.08 * Math.sin(a * 5);
    V.push(Math.sin(a) * r * wob, 0.05, Math.cos(a) * r * wob, Math.sin(a) * 0.4, 0.9, Math.cos(a) * 0.4, 0.5 + 0.5 * Math.sin(a), 0.5 + 0.5 * Math.cos(a));
  }
  for (let i = 1; i <= n; i++) I.push(0, i, i + 1);
  return { data: new Float32Array(V), indices: new Uint32Array(I) };
}

/**
 * Where each egg in a nest lies: a small cluster about the nest's middle, turned this way and that.
 * Pure. @param {number} n eggs @param {{ x: number, z: number }} at @param {number} spreadM
 * @returns {{ x: number, z: number, yaw: number }[]}
 */
export function eggSpots(n, at, spreadM) {
  return Array.from({ length: n }, (_, i) => {
    const a = i * 2.4 + 0.6, d = i === 0 && n === 1 ? 0 : spreadM;
    return { x: at.x + Math.sin(a) * d, z: at.z + Math.cos(a) * d, yaw: a * 1.7 };
  });
}

/**
 * A nest's card (her scrape, or the nest box): its name, how many eggs, and Take an egg while there
 * are some. @param {{ x: number, z: number }} at @param {'scrape'|'box'} where @param {number} eggs @param {any} W hen.json eggs.words
 */
export const nestCard = (at, where, eggs, W) => ({ sp: where === 'box' ? 'hen-nestbox' : 'hen-scrape', henNest: where, eggs,
  name: where === 'box' ? W.nest : W.scrape, sub: null, icon: where === 'box' ? 'nest-box' : 'egg',
  text: [where === 'box' ? W.nestLine : W.scrapeLine, W.scrapeEggs?.[Math.min(eggs, (W.scrapeEggs?.length ?? 1) - 1)] ?? ''].filter(Boolean).join(' '),
  wx: at.x, wz: at.z, r: 0.35, stage: -1, noPage: true });

/** Her moulted feather's card: seen, and left where it lies. @param {{ x: number, z: number }} at @param {any} W */
export const moultCard = (at, W) => ({ sp: 'hen-moult', name: W.moult, sub: null, icon: 'feather', text: W.moultLine, wx: at.x, wz: at.z, r: 0.3, stage: -1, noPage: true });

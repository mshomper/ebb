// @ts-check
// Tiny worker jobs used by tools/unit-tests.html to prove the pool works.

import { stream } from './rng.js';

/**
 * Sum of i*i for i = 1..n.
 * @param {{n: number}} args
 * @returns {number}
 */
export function sumSquares({ n }) {
  let s = 0;
  for (let i = 1; i <= n; i++) s += i * i;
  return s;
}

/**
 * Float32 values from a seeded stream, returned by transfer.
 * @param {{length: number, seed: number}} args
 * @returns {{buffer: ArrayBuffer, __transfer: ArrayBuffer[]}}
 */
export function fillBuffer({ length, seed }) {
  const arr = new Float32Array(length);
  const s = stream(seed, 0x5e1f);
  for (let i = 0; i < length; i++) arr[i] = s.next();
  return { buffer: arr.buffer, __transfer: [arr.buffer] };
}

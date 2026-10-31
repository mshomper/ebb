// @ts-check
// The seeded random numbers (src/core/rng.js): the PCG hash against a BigInt reference, stable
// known values, streams, and the det.* functions against Math. Moved from the test page on
// October 31, 2026, so it runs in workers and in Node (tools/run-tests.mjs).

import { hash32, subSeed, stream, det } from '../src/core/rng.js';

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addRngTests(test, assert, eq) {
  /** Independent PCG reference in BigInt, to check the Math.imul version. @param {number} v */
  function refPcg(v) {
    const M = 0x100000000n;
    const state = (BigInt(v >>> 0) * 747796405n + 2891336453n) % M;
    const word = (((state >> ((state >> 28n) + 4n)) ^ state) * 277803737n) % M;
    return Number((word >> 22n) ^ word);
  }

  test('rng', 'hash32 matches a BigInt reference of the PCG hash', () => {
    for (const x of [0, 1, 2, 12345, 0x7fffffff, 0x80000000, 0xffffffff, -1, -77]) eq(hash32(x), refPcg(x), `hash32(${x})`);
    eq(hash32(42, 7), refPcg((refPcg(42) ^ 7) >>> 0), 'hash32(42, 7)');
  });

  test('rng', 'hash32, subSeed and stream known values are stable', () => {
    eq(hash32(0), 129708002, 'hash32(0)');
    eq(hash32(1), 2831084092, 'hash32(1)');
    eq(hash32(42, 7, 1207), 2634068183, 'hash32(42,7,1207)');
    eq(hash32(0xffffffff, 123), 3149477041, 'hash32(0xffffffff,123)');
    eq(subSeed(42, 'growth'), 700129222, "subSeed(42,'growth')");
    const s = stream(42, 1, 2);
    eq(s.nextU32(), 533647707, 'stream(42,1,2) #0');
    eq(s.nextU32(), 1185724525, 'stream(42,1,2) #1');
  });

  test('rng', 'same seed and keys give the same sequence', () => {
    const a = stream(9001, 3, 1207), b = stream(9001, 3, 1207);
    for (let i = 0; i < 1000; i++) eq(a.nextU32(), b.nextU32(), `value ${i}`);
  });

  test('rng', 'different seed or keys give a different sequence', () => {
    const a = stream(1, 5), b = stream(2, 5), c = stream(1, 6);
    let sameB = 0, sameC = 0;
    for (let i = 0; i < 100; i++) {
      const x = a.nextU32();
      if (x === b.nextU32()) sameB++;
      if (x === c.nextU32()) sameC++;
    }
    assert(sameB === 0 && sameC === 0, `matches: seed ${sameB}, keys ${sameC}`);
    assert(subSeed(1, 'growth') !== subSeed(1, 'weather'), 'sub-seeds collide');
  });

  test('rng', 'next, range and int stay in bounds with a sensible mean', () => {
    const s = stream(77);
    let sum = 0;
    for (let i = 0; i < 20000; i++) {
      const v = s.next();
      assert(v >= 0 && v < 1, `next out of range: ${v}`);
      sum += v;
      const r = s.range(-3, 5);
      assert(r >= -3 && r < 5, `range out of bounds: ${r}`);
      const n = s.int(10);
      assert(Number.isInteger(n) && n >= 0 && n < 10, `int out of bounds: ${n}`);
    }
    const mean = sum / 20000;
    assert(Math.abs(mean - 0.5) < 0.01, `mean ${mean}`);
  });

  /**
   * @param {string} name
   * @param {(...a: number[]) => number} f
   * @param {(...a: number[]) => number} g
   * @param {number[][]} inputs
   * @param {'abs'|'rel'} mode
   * @param {number} tol
   */
  function sweepCheck(name, f, g, inputs, mode, tol) {
    let worst = 0, at = '';
    for (const x of inputs) {
      const a = f(...x), b = g(...x);
      const err = mode === 'abs' ? Math.abs(a - b) : Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
      if (!(err <= worst)) { worst = err; at = x.join(', '); }
    }
    assert(worst <= tol, `${name} worst error ${worst} at (${at})`);
    return worst;
  }
  /** @param {number} a @param {number} b @param {number} n */
  const sweep = (a, b, n) => Array.from({ length: n }, (_, i) => [a + (b - a) * i / (n - 1)]);

  test('rng', 'det.sin and det.cos match Math within 1e-10 over -1000..1000', () => {
    sweepCheck('sin', det.sin, Math.sin, sweep(-1000, 1000, 50001), 'abs', 1e-10);
    sweepCheck('cos', det.cos, Math.cos, sweep(-1000, 1000, 50001), 'abs', 1e-10);
  });

  test('rng', 'det.exp and det.log match Math within 1e-10 relative', () => {
    sweepCheck('exp', det.exp, Math.exp, sweep(-700, 700, 50001), 'rel', 1e-10);
    sweepCheck('log', det.log, Math.log, sweep(1e-6, 1e6, 50001), 'rel', 1e-10);
    eq(det.log(0), -Infinity, 'log(0)');
    assert(Number.isNaN(det.log(-1)), 'log(-1) should be NaN');
  });

  test('rng', 'det.pow and det.atan2 match Math', () => {
    const pw = sweep(0.01, 100, 2001).flatMap(([x]) => [[x, 2.5], [x, -1.3], [x, 0.5], [x, 7]]);
    sweepCheck('pow', det.pow, Math.pow, pw, 'rel', 1e-10);
    eq(det.pow(-2, 3), -8, 'pow(-2,3)');
    const at = Array.from({ length: 20000 }, (_, i) => [Math.sin(i * 1.7) * (1 + i % 50), Math.cos(i * 2.3) * (1 + i % 7)]);
    sweepCheck('atan2', det.atan2, Math.atan2, at, 'abs', 1e-10);
  });
}

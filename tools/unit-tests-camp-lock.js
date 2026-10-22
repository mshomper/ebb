// @ts-check
// The camp pad lock (docs/future/13 CP-01) for tools/unit-tests.html: the lock mask is 0 on the pad
// and rises to 1 over lockFadeM outside it, and the CPU brush twins (raise, flatten, Cliff) leave
// every pad cell exactly as it was while fading in to the full stroke over the fade.

import { padMask, onPad } from '../src/world/camp/layout.js';
import { applyStampCpu, circleRect, CLIFF_MODE } from '../src/world/terrain/brushes.js';
import { WORLD_CELLS as N, CELL, WORLD_ORIGIN } from '../src/world/terrain/grid.js';

const G = 'camp lock';
const ALL = { x: 0, y: 0, w: N, h: N };
/** A pad at (4, -3), 3 m across the level ground, fading over 1 m. @type {any} */
const PAD = { x: 4, z: -3, r: 3, h: 1, blend: 2, fx: 1, fz: 0, lockFadeM: 1 };
const OPEN = { openMin: [-48, -48], openMax: [48, 48], edgeFade: 2 };

/** A flat heightfield at h. @param {number} h */
const flat = (h) => new Float32Array(N * N).fill(h);
/** @param {number} i */
const cx = (i) => WORLD_ORIGIN + (i + 0.5) * CELL;

/**
 * Every cell the stamp's rect covers, with its distance to the pad center.
 * @param {any} st @param {(k: number, x: number, z: number, d: number) => void} fn
 */
function eachCell(st, fn) {
  for (let j = st.rect.y; j < st.rect.y + st.rect.h; j++) for (let i = st.rect.x; i < st.rect.x + st.rect.w; i++) {
    const x = cx(i), z = cx(j);
    fn(j * N + i, x, z, Math.hypot(x - PAD.x, z - PAD.z));
  }
}

/** A stamp over the pad (centered on it, wide enough to reach well past the fade). @param {number} mode @param {number} amount @param {number} [target] */
const stampOver = (mode, amount, target = 0) => {
  const radius = 8;
  return { x: PAD.x, z: PAD.z, radius, hardness: mode === CLIFF_MODE ? 0.5 : 0.6, amount, target, mode, layer: 0, span: 1, rect: circleRect(PAD.x, PAD.z, radius, ALL) };
};

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addCampLockTests(test, assert, eq) {
  test(G, 'the mask is 0 on the pad, 1 a fade past it, a smoothstep between, and 1 with no pad', () => {
    eq(padMask(null, 0, 0), 1, 'no pad');
    eq(padMask(PAD, PAD.x, PAD.z), 0, 'the center');
    eq(padMask(PAD, PAD.x + PAD.r, PAD.z), 0, 'the rim');
    eq(padMask(PAD, PAD.x, PAD.z + PAD.r + PAD.lockFadeM), 1, 'a fade outside');
    eq(padMask(PAD, PAD.x + PAD.r + 0.5, PAD.z), 0.5, 'halfway is a half');
    let last = -1;
    for (let d = 0; d <= 6; d += 0.05) {
      const m = padMask(PAD, PAD.x + d, PAD.z);
      assert(m >= last - 1e-12 && m >= 0 && m <= 1, `rises steadily at ${d.toFixed(2)} m`);
      last = m;
    }
    assert(onPad(PAD, PAD.x + 2.9, PAD.z) && !onPad(PAD, PAD.x + 3.1, PAD.z) && !onPad(null, 0, 0), 'onPad is the disc');
  });

  test(G, 'raise leaves every pad cell untouched and fades in to the full stroke over 1 m', () => {
    const st = stampOver(0, 0.5);
    const free = flat(1), locked = flat(1);
    applyStampCpu(free, st, OPEN);
    applyStampCpu(locked, st, { ...OPEN, pad: PAD });
    let pad = 0, fade = 0, full = 0;
    eachCell(st, (k, x, z, d) => {
      const want = 1 + (free[k] - 1) * padMask(PAD, x, z);
      assert(Math.abs(locked[k] - want) < 1e-6, `cell at ${d.toFixed(2)} m is the free stroke times the mask`);
      if (d <= PAD.r) { eq(locked[k], 1, `pad cell at ${d.toFixed(2)} m`); pad++; }
      else if (d < PAD.r + PAD.lockFadeM) fade++;
      else if (free[k] !== 1) { eq(locked[k], free[k], `past the fade at ${d.toFixed(2)} m`); full++; }
    });
    assert(pad > 50 && fade > 10 && full > 50, `covers the pad (${pad}), the fade (${fade}) and beyond (${full})`);
    assert(free[Math.floor((PAD.z - WORLD_ORIGIN) / CELL) * N + Math.floor((PAD.x - WORLD_ORIGIN) / CELL)] > 1.4, 'with no pad the stroke lifts the center');
  });

  test(G, 'flatten and the Cliff shelf leave every pad cell untouched', () => {
    for (const st of [stampOver(2, 4, -1), stampOver(CLIFF_MODE, 1.5, 2.5), stampOver(CLIFF_MODE, -1.5, -0.5)]) {
      const hf = flat(1);
      applyStampCpu(hf, st, { ...OPEN, pad: PAD });
      let moved = 0;
      eachCell(st, (k, x, z, d) => {
        if (d <= PAD.r) eq(hf[k], 1, `mode ${st.mode} amount ${st.amount}: pad cell at ${d.toFixed(2)} m`);
        else if (d > PAD.r + PAD.lockFadeM + CELL && hf[k] !== 1) moved++;
      });
      assert(moved > 20, `mode ${st.mode} amount ${st.amount} still shapes the ground past the fade (${moved})`);
    }
  });

  test(G, 'a pad with no stroke over it changes nothing elsewhere: no pad behaves as before', () => {
    const st = stampOver(0, 0.3);
    const a = flat(0.5), b = flat(0.5);
    applyStampCpu(a, st, OPEN);
    applyStampCpu(b, st, { ...OPEN, pad: null });
    let same = true;
    eachCell(st, (k) => { if (a[k] !== b[k]) same = false; });
    assert(same, 'pad: null is the stroke as it always was');
  });
}

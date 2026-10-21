// @ts-check
// `?sandbar` (testing, unsaved; doc 23, the walker; W1): a sandbar and a small islet off the
// island's shore, until the meadow islet itself is built (doc 13). The bar's top sits half a meter
// under mean sea level, so it is dry only near low water, can be waded for a while either side of
// it and is too deep at high water; the islet climbs from the bar in quarter-meter shelves, each a
// step the walker can take. Laid out along the first diagonal from the island's middle that
// reaches open sea, so it stays inside the open land. The layout is pure (tools/walk-lab.html
// raises it into its heights with barHeight); the game builds it with real Terrace and Cut strokes
// (buildSandbarDemo), each one on the undo stack like a drawn one.

/** The bar's top (m, under mean sea level) and the islet's shelves. */
export const BAR = Object.freeze({ topM: -0.5, halfWidthM: 1.6, isletR: 5, isletTopM: 1, stepM: 0.25 });
/** Along the bar (0 at the shore end, 1 at the islet): built to sea level, then two quarter-meter cuts. */
const BAR_CUTS = /** @type {const} */ ([[0.1, 1, 0], [0.18, 0.98, -0.25], [0.3, 0.85, -0.5]]);
/** Width of each of the islet's rings (m). */
const ISLET_RING_M = 0.6;

/**
 * Where the bar runs: from just inside the shore out to the islet.
 * @param {(x: number, z: number) => number} ground
 * @returns {{ from: [number, number], to: [number, number], islet: [number, number] } | null}
 */
export function sandbarLayout(ground) {
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const ux = sx * Math.SQRT1_2, uz = sz * Math.SQRT1_2;
    let shore = -1, deep = -1;
    for (let r = 10; r < 60; r += 0.5) {
      const h = ground(ux * r, uz * r);
      if (shore < 0 && h < 0) shore = r;
      if (shore >= 0 && h < -1.5) { deep = r; break; }
    }
    if (shore < 0 || deep < 0) continue;
    const end = deep + 5, mid = end + BAR.isletR - 1;
    return { from: [ux * (shore - 1), uz * (shore - 1)], to: [ux * end, uz * end], islet: [ux * mid, uz * mid] };
  }
  return null;
}

/**
 * The ground with the test bar and islet raised into it (the lab's version of the strokes).
 * @param {number} h ground now @param {number} x @param {number} z
 * @param {NonNullable<ReturnType<typeof sandbarLayout>>} L
 */
export function barHeight(h, x, z, L) {
  const [ax, az] = L.from, [bx, bz] = L.to;
  const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz;
  const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
  const off = Math.hypot(x - (ax + vx * t), z - (az + vz * t));
  // Built up to sea level, then cut down a quarter meter at a time toward the middle, so every
  // step along it is one the walker can take (as the strokes below do).
  if (off <= BAR.halfWidthM) {
    for (const [t0, t1, level] of BAR_CUTS) {
      if (t >= t0 && t <= t1) h = level === 0 ? Math.max(h, 0) : Math.min(h, level);
    }
  }
  const d = Math.hypot(x - L.islet[0], z - L.islet[1]);
  if (d <= BAR.isletR) {
    const ring = Math.min(BAR.isletTopM / BAR.stepM + 1, Math.floor((BAR.isletR - d) / ISLET_RING_M));
    h = -BAR.stepM + ring * BAR.stepM;
  }
  return h;
}

/**
 * Build the bar and islet in the game with real strokes, then glide to look at them.
 * @param {{ terrain: import('../terrain/index.js').Terrain, history: { push: (c: any) => void },
 *   focus: (x: number, z: number, distance: number, pitchDeg: number) => void }} o
 */
export async function buildSandbarDemo(o) {
  const { terrain } = o;
  const L = sandbarLayout((x, z) => terrain.sampleHeight(x, z));
  if (!L) return null;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));
  /** @param {number} x @param {number} z */
  const at = (x, z) => [x, terrain.sampleHeight(x, z), z];
  /**
   * One stroke along a path, a little each frame, as a drag would.
   * @param {'terrace'|'cut'} kind @param {number} radius @param {number} height @param {boolean} sea @param {number[][]} path
   */
  async function stroke(kind, radius, height, sea, path) {
    while (terrain.isBusy()) await frame();
    if (!terrain.beginStroke({ kind, radius, strength: 1, height, sea }, at(path[0][0], path[0][1]))) return;
    for (let i = 1; i < path.length; i++) {
      const [x0, z0] = path[i - 1], [x1, z1] = path[i];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / radius));
      for (let k = 1; k <= n; k++) {
        terrain.strokeTo(at(x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n));
        await frame();
      }
    }
    const cmd = await terrain.endStroke();
    if (cmd) o.history.push(cmd);
  }
  const [ax, az] = L.from, [bx, bz] = L.to, [ix, iz] = L.islet;
  const along = (/** @type {number} */ t) => [ax + (bx - ax) * t, az + (bz - az) * t];
  // The bar: built up to mean sea level from the sea floor, then cut down a quarter meter at a time
  // toward its middle (each cut starts offshore, so it levels from the bar, not the beach).
  for (const [t0, t1, level] of BAR_CUTS) {
    if (level === 0) await stroke('terrace', BAR.halfWidthM, 3, true, [along(t0), along(t1)]);
    else await stroke('cut', BAR.halfWidthM, BAR.stepM, false, [along((t0 + t1) / 2), along(t0), along(t1)]);
  }
  // The islet: a round shelf at sea level cut a quarter meter down, to meet the bar's end, then
  // quarter-meter shelves, each a ring smaller.
  const dot = [[ix, iz], [ix + 0.01, iz]];
  await stroke('terrace', BAR.isletR, 3, true, dot);
  await stroke('cut', BAR.isletR, BAR.stepM, false, dot);
  const shelves = Math.round(BAR.isletTopM / BAR.stepM) + 1;
  for (let s = 1; s <= shelves; s++) await stroke('terrace', BAR.isletR - s * ISLET_RING_M, BAR.stepM, false, dot);
  while (terrain.isBusy()) await frame();
  o.focus((ax + ix) / 2, (az + iz) / 2, 34, 40);
  return L;
}

// @ts-check
// `?shape=bar|wall|pond|wrack` (testing, unsaved; B3 S0): shapes each kind of ground a B3 newcomer
// wants, so later sessions and the B3 review can set them up without drawing them by hand. The
// layout is pure and read from the island's own heights (tools/shaped-lab.html raises the same shapes
// into its heights with shapedHeight); the game builds them with real Terrace and Cut strokes, each
// on the undo stack like a drawn one (buildShapedDemo).
//   bar   a raised bar offshore, parallel to the shore: built up to sea level, then cut a quarter
//         meter down, so it is dry at low tide and under water at high tide
//   wall  a Terrace shelf along the waterline, its sea face sheer and painted rock (as every sheer face is)
//   pond  a round pond cut into the grass behind the shore, near the sea
//   wrack nothing to shape: the strandline is thick with wrack and has lain long (src/app/shaped.js)
// Sizes from recipes/world/shaped.json test.

/** The directions tried, from the island's middle (radians, x = cos, z = sin). */
const DIRS = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ((i + 0.3) * Math.PI) / 4);

/**
 * Along one direction from the middle: where the ground first dips under the sea (shore, m from the
 * middle) and where it is deeper than 1.2 m (deep), or null.
 * @param {(x: number, z: number) => number} ground @param {number} a
 */
export function shoreRay(ground, a) {
  const ux = Math.cos(a), uz = Math.sin(a);
  let shore = -1;
  for (let r = 6; r < 90; r += 0.5) {
    const h = ground(ux * r, uz * r);
    if (shore < 0 && h < 0) shore = r;
    if (shore >= 0 && h < -1.2) return { ux, uz, shore, deep: r };
  }
  return null;
}

/**
 * Where each test ground goes: three different directions, the first with open sea for the bar,
 * the next for the wall, the next for the pond. Null parts where the island has no room.
 * @param {(x: number, z: number) => number} ground @param {any} T recipes/world/shaped.json test
 */
export function shapedLayout(ground, T) {
  const rays = DIRS.map((a) => ({ a, ray: shoreRay(ground, a) })).filter((r) => r.ray);
  const pick = (/** @type {number} */ i) => rays[(i * 3) % Math.max(1, rays.length)] ?? null;
  /** @type {{ bar: { from: number[], to: number[] } | null, wall: { path: number[][] } | null, pond: { x: number, z: number } | null }} */
  const L = { bar: null, wall: null, pond: null };
  const b = pick(0);
  if (b?.ray) {
    const { ux, uz, deep } = b.ray, r = deep + T.bar.halfWidthM + 1, h = T.bar.lengthM / 2;
    L.bar = { from: [ux * r - uz * h, uz * r + ux * h], to: [ux * r + uz * h, uz * r - ux * h] };
  }
  const w = pick(1);
  if (w?.ray && w !== b) {
    // Along the waterline: the shore radius at each step of the arc, a little inland.
    const r0 = w.ray.shore, da = (1.6 * T.wall.lengthM) / r0, steps = Math.max(2, Math.ceil(T.wall.lengthM / 1.5));
    /** @type {number[][]} */ const path = [];
    for (let s = 0; s <= steps; s++) {
      const ray = shoreRay(ground, w.a - da / 2 + (da * s) / steps);
      if (ray) path.push([ray.ux * (ray.shore - T.wall.radiusM * 0.6), ray.uz * (ray.shore - T.wall.radiusM * 0.6)]);
    }
    // Trimmed to lengthM along the path, from its middle out.
    const len = (/** @type {number[][]} */ q) => q.reduce((t, v, i) => (i ? t + Math.hypot(v[0] - q[i - 1][0], v[1] - q[i - 1][1]) : 0), 0);
    while (path.length > 2 && len(path) > T.wall.lengthM) { if (path.length % 2) path.pop(); else path.shift(); }
    if (path.length >= 2) L.wall = { path };
  }
  const p = pick(2);
  if (p?.ray && p !== b && p !== w) {
    const r = Math.max(4, p.ray.shore - T.pond.radiusM - 9);
    L.pond = { x: p.ray.ux * r, z: p.ray.uz * r };
  }
  return L;
}

/** Distance from (x, z) to the segment a-b. @param {number} x @param {number} z @param {number[]} a @param {number[]} b */
function segDist(x, z, a, b) {
  const vx = b[0] - a[0], vz = b[1] - a[1], l2 = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / l2));
  return Math.hypot(x - (a[0] + vx * t), z - (a[1] + vz * t));
}

/**
 * The ground with a test ground raised into it (the lab's version of the strokes): the bar levelled
 * at topM, the wall's shelf at the waterline plus heightM, the pond cut depthM down.
 * @param {number} h ground now @param {number} x @param {number} z @param {'bar'|'wall'|'pond'} kind
 * @param {ReturnType<typeof shapedLayout>} L @param {any} T @param {number} [pondFloor] the pond's floor (the lab passes ground - depth at its middle)
 */
export function shapedHeight(h, x, z, kind, L, T, pondFloor) {
  if (kind === 'bar' && L.bar && segDist(x, z, L.bar.from, L.bar.to) <= T.bar.halfWidthM) return T.bar.topM;
  if (kind === 'wall' && L.wall) {
    for (let i = 1; i < L.wall.path.length; i++) if (segDist(x, z, L.wall.path[i - 1], L.wall.path[i]) <= T.wall.radiusM) return Math.max(h, T.wall.heightM);
  }
  if (kind === 'pond' && L.pond && Math.hypot(x - L.pond.x, z - L.pond.z) <= T.pond.radiusM) return Math.min(h, pondFloor ?? h - T.pond.depthM);
  return h;
}

/**
 * Build the test grounds in the game with real strokes, then glide to look at the first.
 * @param {{ terrain: import('../terrain/index.js').Terrain, history: { push: (c: any) => void }, kinds: string[], T: any,
 *   focus: (x: number, z: number, distance: number, pitchDeg: number) => void }} o
 */
export async function buildShapedDemo(o) {
  const { terrain, T } = o;
  const L = shapedLayout((x, z) => terrain.sampleHeight(x, z), T);
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
  /** @type {number[] | null} */ let look = null;
  if (o.kinds.includes('bar') && L.bar) {
    // Built up to mean sea level from the sea floor, then cut down to its top (a quarter meter at a time).
    await stroke('terrace', T.bar.halfWidthM, 3, true, [L.bar.from, L.bar.to]);
    const mid = [(L.bar.from[0] + L.bar.to[0]) / 2, (L.bar.from[1] + L.bar.to[1]) / 2];
    for (let d = 0.25; d <= -T.bar.topM + 0.01; d += 0.25) await stroke('cut', T.bar.halfWidthM, 0.25, false, [mid, L.bar.from, L.bar.to]);
    look ??= mid;
  }
  if (o.kinds.includes('wall') && L.wall) {
    // Started at the waterline, so the shelf stands heightM above it, its sea face sheer.
    await stroke('terrace', T.wall.radiusM, T.wall.heightM, false, L.wall.path);
    look ??= L.wall.path[Math.floor(L.wall.path.length / 2)];
  }
  if (o.kinds.includes('pond') && L.pond) {
    const dot = [[L.pond.x, L.pond.z], [L.pond.x + 0.01, L.pond.z]];
    await stroke('cut', T.pond.radiusM, T.pond.depthM, false, dot);
    look ??= [L.pond.x, L.pond.z];
  }
  while (terrain.isBusy()) await frame();
  if (look) o.focus(look[0], look[1], 30, 42);
  return L;
}

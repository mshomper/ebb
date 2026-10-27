// @ts-check
// The hagstone watcher's shape and colour as a signed field (H2; the orchestrator's draft 2, approved by
// Matt on October 27, 2026): metres, Y up, the hole looking along +Z, the origin at the stone's middle.
// A lopsided, flattened pebble with an off-centre hole whose polished rim flares out toward the faces,
// a barnacle crust on the lower left only, and four flat wrack blades hanging from the underside. Every
// number is recipes/world/hollow.json foes.watcher.stone.prep. Pure and seeded: the draft's own small
// generator (a fixed LCG from prep.seed, kept so the approved look comes out exactly the same), only
// + - * / and Math on the samples. Used by tools/hollow-prep/watcher.mjs.

/** Smooth hash value noise in -1..1, the same everywhere. @param {number} x @param {number} y @param {number} z */
function noise(x, y, z) {
  const hash = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ c) => {
    let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const fade = (/** @type {number} */ t) => t * t * (3 - 2 * t);
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
  let r = 0;
  for (let c = 0; c < 8; c++) {
    const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
    r += (dx ? xf : 1 - xf) * (dy ? yf : 1 - yf) * (dz ? zf : 1 - zf) * hash(xi + dx, yi + dy, zi + dz);
  }
  return r * 2 - 1;
}
/** @param {number} x @param {number} y @param {number} z */
const fbm = (x, y, z) => noise(x, y, z) * 0.6 + noise(x * 2.1, y * 2.1, z * 2.1) * 0.28 + noise(x * 4.3, y * 4.3, z * 4.3) * 0.12;
const smin = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ k) => -smin(-a, -b, k);
/** @param {number[]} a @param {number[]} b @param {number} t */
const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * Math.max(0, Math.min(1, t)));

/**
 * The watcher's field and colours from its prep recipe.
 * @param {any} P recipes/world/hollow.json foes.watcher.stone.prep
 */
export function watcherField(P) {
  let seed = P.seed;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const R = P.radiiM, H = P.hole, C = P.crust, A = P.albedo, Bl = P.blades;

  /** The flattened pebble's distance (an ellipsoid's bound). @param {number} x @param {number} y @param {number} z */
  function ellipsoid(x, y, z) {
    const k0 = Math.hypot(x / R[0], y / R[1], z / R[2]);
    const k1 = Math.hypot(x / (R[0] * R[0]), y / (R[1] * R[1]), z / (R[2] * R[2]));
    return k0 * (k0 - 1) / k1;
  }
  /** Distance from the hole's wall (negative inside the hole), flaring toward the faces. @param {number} x @param {number} y @param {number} z */
  const holeAt = (x, y, z) => Math.hypot(x - H.x, y - H.y) - H.rM * (1 + H.flareShare * (Math.abs(z) / R[2]) ** 2);
  /** The stone: leaned, thicker below, worn, the hole worn through with a soft rim. @param {number} x @param {number} y @param {number} z */
  function stone(x, y, z) {
    let d = ellipsoid(x, y + x * P.leanShare, z * (1 + P.bulgeShare * (y < 0 ? -y : 0)));
    d += P.wearM * fbm(x * P.wearFreq, y * P.wearFreq, z * P.wearFreq);
    return smax(d, -holeAt(x, y, z), H.blendM);
  }

  // Barnacles: shells on the lower left face and back only, pulled onto the surface.
  /** @type {{ p: number[], r: number }[]} */ const barnacles = [];
  while (barnacles.length < C.count) {
    const u = rnd() * Math.PI * 2, v = Math.acos(rnd() * 2 - 1);
    let p = [Math.sin(v) * Math.cos(u) * R[0], Math.cos(v) * R[1], Math.sin(v) * Math.sin(u) * R[2]];
    if (!(p[0] < C.maxX && p[1] < C.maxY)) continue;
    if (Math.hypot(p[0] - H.x, p[1] - H.y) < H.rM + C.clearM) continue;
    for (let it = 0; it < 6; it++) {
      const d = stone(p[0], p[1], p[2]), e = 1e-3;
      const g = [stone(p[0] + e, p[1], p[2]) - d, stone(p[0], p[1] + e, p[2]) - d, stone(p[0], p[1], p[2] + e) - d];
      const gl = Math.hypot(g[0], g[1], g[2]) || 1;
      p = p.map((c, i) => c - d * g[i] / gl);
    }
    barnacles.push({ p, r: C.rM[0] + rnd() * (C.rM[1] - C.rM[0]) });
  }
  /** The crust: each shell a ring with a pit in it. @param {number} x @param {number} y @param {number} z */
  function crust(x, y, z) {
    let d = 1e9;
    for (const b of barnacles) {
      const s = Math.hypot(x - b.p[0], y - b.p[1], z - b.p[2]);
      if (s > b.r * 2) continue;
      d = Math.min(d, Math.max(s - b.r, -(s - b.r * C.pitShare)));
    }
    return d;
  }
  /** The whole stone with its crust. @param {number} x @param {number} y @param {number} z */
  const solid = (x, y, z) => smin(stone(x, y, z), crust(x, y, z), C.blendM);

  // The weed: four flat blades from the underside, uneven, each with a seeded bend, twist and frill.
  const blades = Bl.roots.map((/** @type {number[]} */ root, /** @type {number} */ s) => {
    const top = [root[0], -0.2, root[1]];
    for (let it = 0; it < 30; it++) { if (stone(top[0], top[1], top[2]) > -0.004) break; top[1] -= 0.005; }
    for (let it = 0; it < 40 && stone(top[0], top[1], top[2]) > 0.004; it++) top[1] += 0.004;
    top[1] += 0.01; // the root just inside the stone
    const len = Bl.lengthsM[s], bend = (rnd() - 0.5) * Bl.bendM, n = 10;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push([top[0] + bend * Math.sin(t * 2.4), top[1] - len * t, top[2] + bend * 0.5 * Math.sin(t * 3.1 + 1)]);
    }
    return { pts, len, twist: Bl.twist[0] + rnd() * (Bl.twist[1] - Bl.twist[0]), phase: rnd() * 6.28, w0: rnd() * Math.PI };
  });
  /** A point along a blade's middle line, u 0 at the root to 1 at the tip. @param {typeof blades[0]} b @param {number} u */
  const along = (b, u) => {
    const n = b.pts.length - 1, f = Math.min(n - 1e-9, Math.max(0, u) * n), i = Math.floor(f), t = f - i;
    return b.pts[i].map((c, k) => c + (b.pts[i + 1][k] - c) * t);
  };

  /** The stone's albedo at a surface point (linear). @param {number} x @param {number} y @param {number} z */
  function stoneColor(x, y, z) {
    let c = A.stone;
    const band = Math.sin((x * 0.5 + y * 0.85) * A.bandFreq + 2.5 * fbm(x * 3, y * 3, z * 3));
    c = mix(c, A.band, (band - 0.55) * 2.2);
    c = mix(c, A.mottle, 0.5 + 0.5 * fbm(x * 9, y * 9, z * 9) - 0.35);
    const lichen = fbm(x * 7 + 3, y * 7, z * 7 + 1) + (y - 0.05) * 2.2;
    c = mix(c, A.lichen, (lichen - 0.35) * 3);
    const rim = Math.hypot(x - H.x, y - H.y) - H.rM;
    c = mix(c, A.rim, 1 - rim / A.rimM);
    if (crust(x, y, z) < stone(x, y, z) - 0.001) c = mix(A.barnacle, A.barnacleDark, 0.5 + 0.5 * fbm(x * 40, y * 40, z * 40));
    return c;
  }
  /** A blade's albedo, darker at the root, lighter at the tip. @param {number} u */
  const weedColor = (u) => mix(A.weedRoot, A.weedTip, u * 1.2);

  return { stone, crust, solid, holeAt, barnacles, blades, along, stoneColor, weedColor };
}

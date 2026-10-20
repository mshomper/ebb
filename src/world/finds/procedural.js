// @ts-check
// Procedural find meshes (docs/future/11): finds with no model file are built here from a few
// numbers in finds.json (each kind's `shape`), in the creature pass's vertex layout (position,
// normal, linear albedo: 9 floats), in meters at real size, base on y = 0. Every scatter is seeded
// through hash32 from the recipe's own seed, so a mesh is the same on every load.
//
// Acorn barnacles: a crust of small low cones clustered on a rough disc, each a ring of plates round
// a dark opening; open, a few feathery cirri reach out of each opening, shut, the opening is closed
// by plates. Pond skaters: a slim dark body on two short front legs and four long thin ones, splayed
// over the water, with a pale ring under each long foot where the surface dimples and catches light.

import { hash32 } from '../../core/rng.js';

/** @typedef {{ vertices: Float32Array, count: number, indices: Uint32Array }} Mesh */

/** @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;

/** A mesh under construction: vertices go in as 9 floats each, triangles by index. */
function builder() {
  /** @type {number[]} */ const v = [];
  /** @type {number[]} */ const idx = [];
  return {
    /** @param {number[]} p @param {number[]} n @param {number[]} c @returns {number} its index */
    vert(p, n, c) {
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      v.push(p[0], p[1], p[2], n[0] / l, n[1] / l, n[2] / l, c[0], c[1], c[2]);
      return v.length / 9 - 1;
    },
    /** @param {number} a @param {number} b @param {number} c */
    tri(a, b, c) { idx.push(a, b, c); },
    /** @returns {Mesh} */
    done() {
      const vertices = new Float32Array(v);
      let lo = Infinity;
      for (let i = 1; i < vertices.length; i += 9) lo = Math.min(lo, vertices[i]);
      for (let i = 1; i < vertices.length; i += 9) vertices[i] -= lo;
      return { vertices, count: v.length / 9, indices: Uint32Array.from(idx) };
    },
  };
}

/**
 * A surface turned about a vertical axis at (cx, cz): rings from a profile of [r, y, colour index]
 * points, outside and upward first. Normals come from the profile's slope, so the outside faces out.
 * @param {ReturnType<typeof builder>} m @param {[number, number, number][]} prof @param {number[][]} colors
 * @param {number} cx @param {number} cz @param {number} seg @param {(a: number) => number} [ridge] radius multiplier by angle
 */
function lathe(m, prof, colors, cx, cz, seg, ridge = () => 1) {
  const rings = prof.map(([r, y, ci], i) => {
    const a = prof[Math.max(0, i - 1)], b = prof[Math.min(prof.length - 1, i + 1)];
    // Outward normal in the (r, y) plane: the profile's direction turned a quarter.
    const dr = b[0] - a[0], dy = b[1] - a[1];
    const nr = dy, ny = -dr;
    /** @type {number[]} */ const ring = [];
    for (let j = 0; j < seg; j++) {
      const t = (j / seg) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t), k = r * ridge(t);
      ring.push(m.vert([cx + c * k, y, cz + s * k], [c * nr, ny, s * nr], colors[ci]));
    }
    return ring;
  });
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let j = 0; j < seg; j++) {
      const a = rings[i][j], b = rings[i][(j + 1) % seg], c = rings[i + 1][j], d = rings[i + 1][(j + 1) % seg];
      m.tri(a, c, b);
      m.tri(b, c, d);
    }
  }
}

/**
 * A tube along a path of points with a radius at each (0 closes it to a point), its rings square to
 * the path. @param {ReturnType<typeof builder>} m @param {number[][]} pts @param {number[]} radii
 * @param {number[]} color @param {number} [sides]
 */
function tube(m, pts, radii, color, sides = 5) {
  /** @type {number[][]} */ const rings = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    // A side vector square to the path (from up, or from x when the path runs up).
    let ux = 0, uy = 1, uz = 0;
    if (Math.abs(ty) > 0.9) { ux = 1; uy = 0; }
    let sx = ty * uz - tz * uy, sy = tz * ux - tx * uz, sz = tx * uy - ty * ux;
    const sl = Math.hypot(sx, sy, sz) || 1;
    sx /= sl; sy /= sl; sz /= sl;
    const qx = sy * tz - sz * ty, qy = sz * tx - sx * tz, qz = sx * ty - sy * tx;
    /** @type {number[]} */ const ring = [];
    for (let j = 0; j < sides; j++) {
      const t = (j / sides) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
      const nx = sx * c + qx * s, ny = sy * c + qy * s, nz = sz * c + qz * s;
      const r = radii[i];
      ring.push(m.vert([pts[i][0] + nx * r, pts[i][1] + ny * r, pts[i][2] + nz * r], [nx, ny, nz], color));
    }
    rings.push(ring);
  }
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let j = 0; j < sides; j++) {
      const a = rings[i][j], b = rings[i][(j + 1) % sides], c = rings[i + 1][j], d = rings[i + 1][(j + 1) % sides];
      m.tri(a, c, b);
      m.tri(b, c, d);
    }
  }
}

/**
 * A flat ring lying on y at (cx, cz), facing up. @param {ReturnType<typeof builder>} m
 * @param {number} cx @param {number} y @param {number} cz @param {number} r0 inner @param {number} r1 outer
 * @param {number[]} color @param {number} [seg]
 */
function annulus(m, cx, y, cz, r0, r1, color, seg = 14) {
  /** @type {number[][]} */ const base = [];
  for (let j = 0; j < seg; j++) {
    const t = (j / seg) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    base.push([m.vert([cx + c * r0, y, cz + s * r0], [0, 1, 0], color), m.vert([cx + c * r1, y, cz + s * r1], [0, 1, 0], color)]);
  }
  for (let j = 0; j < seg; j++) {
    const [a, b] = base[j], [c, d] = base[(j + 1) % seg];
    m.tri(a, c, b);
    m.tri(b, c, d);
  }
}

/**
 * Where a barnacle patch's cones sit: up to the recipe's count on a rough disc, none overlapping,
 * seeded. Pure. @param {any} S finds.json kinds.barnacles.shape
 * @returns {{ x: number, z: number, r: number, h: number, yaw: number, tone: number }[]}
 */
export function barnacleLayout(S) {
  const n = S.count[0] + Math.floor(u01(hash32(S.seed, 1)) * (S.count[1] - S.count[0] + 1));
  /** @type {{ x: number, z: number, r: number, h: number, yaw: number, tone: number }[]} */ const out = [];
  for (let tries = 0; out.length < n && tries < 400; tries++) {
    const h = hash32(S.seed, 2, tries);
    const r = S.coneRadiusM[0] + u01(hash32(h, 1)) * (S.coneRadiusM[1] - S.coneRadiusM[0]);
    const a = u01(hash32(h, 2)) * Math.PI * 2;
    // A rough edge: the disc's reach wobbles with the angle.
    const reach = S.patchRadiusM * (1 + S.roughness * Math.sin(a * 3 + S.seed));
    const d = Math.sqrt(u01(hash32(h, 3))) * Math.max(0, reach - r);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (out.some((c) => Math.hypot(c.x - x, c.z - z) < (c.r + r) * S.spacing)) continue;
    out.push({ x, z, r, h: r * S.heightShare * (0.85 + 0.3 * u01(hash32(h, 4))), yaw: u01(hash32(h, 5)) * Math.PI * 2, tone: u01(hash32(h, 6)) });
  }
  return out;
}

/**
 * A barnacle patch, open (cirri out of each opening) or shut (the openings closed by plates).
 * @param {any} S finds.json kinds.barnacles.shape @param {boolean} open @returns {Mesh}
 */
export function barnacleMesh(S, open) {
  const m = builder();
  for (const c of barnacleLayout(S)) {
    const k = 0.92 + 0.16 * c.tone;
    const shell = S.albedo.map((/** @type {number} */ x) => x * k);
    const plates = S.plateAlbedo, hole = S.openingAlbedo;
    const r = c.r, h = c.h, ro = r * S.openingShare;
    // Outside wall, the rim, then down into the dark opening, or over the closing plates to a shallow peak.
    /** @type {[number, number, number][]} */
    const prof = open
      ? [[r, 0, 0], [r * 0.72, h * 0.5, 0], [ro * 1.15, h, 0], [ro, h * 0.92, 1], [ro * 0.7, h * 0.7, 1], [0, h * 0.62, 1]]
      : [[r, 0, 0], [r * 0.72, h * 0.5, 0], [ro * 1.15, h, 0], [ro, h * 0.98, 2], [ro * 0.5, h * 1.04, 2], [0, h * 1.08, 2]];
    // Six wall plates: the wall bulges a little between their seams.
    lathe(m, prof, [shell, hole, plates], c.x, c.z, 12,(t) => 1 + S.plateBulge * Math.abs(Math.cos(3 * (t + c.yaw))));
    if (!open) continue;
    // Cirri: thin curled legs fanning out of the opening, each a little feathery with side hairs.
    const C = S.cirri;
    for (let i = 0; i < C.count; i++) {
      const fan = c.yaw + ((i / Math.max(1, C.count - 1)) - 0.5) * C.fanDeg * (Math.PI / 180);
      const dx = Math.cos(fan), dz = Math.sin(fan);
      const L = C.lengthM * (0.8 + 0.4 * u01(hash32(S.seed, 7, i)));
      /** @type {number[][]} */ const pts = [];
      for (let s = 0; s <= 5; s++) {
        // Up out of the opening, then curling over toward the fan's side.
        const t = s / 5, a = t * Math.PI * 0.75;
        pts.push([c.x + dx * L * 0.5 * (1 - Math.cos(a)), h * 0.75 + L * 0.55 * Math.sin(a), c.z + dz * L * 0.5 * (1 - Math.cos(a))]);
      }
      tube(m, pts, pts.map((_, s) => C.radiusM * (1 - s / 6)), C.albedo, 3);
      // A few side hairs along the outer half, which make the fan read as feathery.
      for (let s = 3; s <= 4; s++) {
        const p = pts[s];
        tube(m, [p, [p[0] + dx * C.hairM, p[1] + C.hairM * 0.4, p[2] + dz * C.hairM]], [C.radiusM * 0.5, 0], C.albedo, 3);
      }
    }
  }
  return m.done();
}

/**
 * A pond skater, facing +z: slim body held above the water, two short front legs, four long thin
 * legs splayed out and lying on the surface at the feet, and a pale ring under each long foot.
 * @param {any} S finds.json kinds.pondskaters.shape @returns {Mesh}
 */
export function pondSkaterMesh(S) {
  const m = builder();
  const L = S.bodyLengthM, R = S.bodyRadiusM, y = S.rideM;
  // Body: head forward (+z), thorax broad, abdomen tapering behind.
  const share = [0, 0.08, 0.25, 0.45, 0.62, 0.78, 0.9, 0.97, 1];
  const width = [0, 0.55, 0.8, 0.95, 1, 0.9, 0.75, 0.6, 0];
  tube(m, share.map((s) => [0, y + R * 0.2 * Math.sin(s * Math.PI), -L / 2 + s * L]), width.map((w) => w * R), S.bodyAlbedo, 7);
  const leg = (/** @type {number[][]} */ pts) => tube(m, pts, pts.map((_, i) => S.legRadiusM * (i === pts.length - 1 ? 0.5 : 1)), S.legAlbedo, 4);
  for (const side of [-1, 1]) {
    // Front legs: short, bent forward and down, held up off the water.
    const fz = L * 0.36, F = S.frontLegM;
    leg([[side * R * 0.5, y, fz], [side * F * 0.45, y + R * 0.6, fz + F * 0.35], [side * F * 0.55, y * 0.5, fz + F * 0.7]]);
    // Middle and hind legs: up to a high knee, then down and out along the water to the foot.
    for (const [z0, len, ang] of [[L * 0.12, S.midLegM, S.midAngleDeg], [-L * 0.02, S.hindLegM, S.hindAngleDeg]]) {
      const a = (ang * Math.PI) / 180, dx = side * Math.cos(a), dz = Math.sin(a);
      const knee = [dx * len * 0.3, y + S.kneeM, z0 + dz * len * 0.3];
      const touch = [dx * len * 0.55, S.footM, z0 + dz * len * 0.55];
      const foot = [dx * len, S.footM, z0 + dz * len];
      leg([[side * R * 0.4, y, z0], knee, touch, foot]);
      // Where the foot presses the surface it dimples, and the dimple catches the light.
      const mid = [(touch[0] + foot[0]) / 2, (touch[2] + foot[2]) / 2];
      annulus(m, mid[0], 0, mid[1], S.dimpleRadiusM * 0.55, S.dimpleRadiusM, S.dimpleAlbedo);
    }
  }
  return m.done();
}

/**
 * The procedural meshes by name, for the finds pass (index.js loadModels).
 * @param {any} recipe finds.json @returns {Record<string, Mesh>}
 */
export function proceduralMeshes(recipe) {
  /** @type {Record<string, Mesh>} */ const out = {};
  const B = recipe.kinds.barnacles?.shape, P = recipe.kinds.pondskaters?.shape;
  if (B) { out['barnacles-open'] = barnacleMesh(B, true); out['barnacles-shut'] = barnacleMesh(B, false); }
  if (P) out.pondskaters = pondSkaterMesh(P);
  return out;
}

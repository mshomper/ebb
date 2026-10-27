// @ts-check
// Each depth's chamber shapes (H1, the floor maker; doc 16, The depths): a floor plan dressed into
// the primitives its signed field is made of. Chambers are blended ellipsoids (or, in the glass
// halls, faceted pockets cut by planes) with a flat floor; then each depth adds its own: shelves and
// puddle hollows on the wet shelf, columns and hanging stone in the dripstone, a deep channel with
// causeways in the silt deeps, crystals in the glass halls. Passages are bent tubes with flat floors.
// The sponge widens the chambers and joins them with fat tubes for its gyroid to fill (field.js).
// Every number is in recipes/world/hollow.json (floors.shapes). Pure and deterministic, and the
// result is plain arrays so it can be posted to a worker.

import { stream, subSeed, det } from '../../core/rng.js';

/**
 * @typedef {Object} Prim one shape: air ones carve, rock ones fill
 * @property {'ell'|'poly'|'box'|'cone'|'hex'} t
 * @property {number[]} c centre (or a cone's base)
 * @property {number[]} [r] ellipsoid radii (local x, y, z)
 * @property {number} [cos] yaw, as its cos and sin
 * @property {number} [sin]
 * @property {number[][]} [planes] a faceted pocket's planes [nx, ny, nz, offset]
 * @property {number[]} [h] a box's half sizes (x, y, z) and its rounding in h[3]
 * @property {number[]} [b] a cone's tip
 * @property {number} [ra] a cone's radius at its base
 * @property {number} [rb] a cone's radius at its tip
 * @property {number[]} [ax] a hex prism's frame: axis, then two across (9 numbers)
 * @property {number} [hr] a hex prism's radius and half length
 * @property {number} [hl]
 */
/**
 * @typedef {Object} DressedChamber
 * @property {number} id
 * @property {string} kind
 * @property {number} x
 * @property {number} z
 * @property {number} y floor
 * @property {number} reach how far its rock reaches from the centre in plan (m)
 * @property {number} height floor to roof (m)
 * @property {Prim[]} blobs air, blended over blend (m)
 * @property {number} blend
 * @property {Prim[]} airAdd air carved below the floor (puddles, the channel)
 * @property {Prim[]} rockAdd rock filled in after (shelves, causeways)
 * @property {number} waterY water stands below this inside the chamber (-Infinity: none)
 */
/**
 * @typedef {Object} DressedFloor
 * @property {import('./plan.js').FloorPlan} plan
 * @property {DressedChamber[]} chambers
 * @property {{ pts: number[][], r: number, lift: number }[]} passages
 * @property {Prim[]} rock rock stood in the air after the chambers join (columns, hanging stone, crystals)
 * @property {any} wear
 * @property {number} passageBlend
 * @property {number} cellShare how much coarser this depth's mesh is sampled (its busier rock)
 * @property {any} sponge the gyroid's numbers, or null
 * @property {number} noiseSeed
 */

/** A chamber-local point (dx, dz along its yaw) to world. @param {any} ch @param {number} lx @param {number} lz */
function toWorld(ch, lx, lz) { return [ch.x + lx * ch.cos - lz * ch.sin, ch.z + lx * ch.sin + lz * ch.cos]; }

/** Distance from (x, z) to the lane from a door to the chamber's centre. @param {number} x @param {number} z @param {any} ch @param {any} d */
function laneDist(x, z, ch, d) {
  const bx = ch.x - d.x, bz = ch.z - d.z, l2 = bx * bx + bz * bz;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - d.x) * bx + (z - d.z) * bz) / l2)) : 0;
  const ex = x - d.x - bx * t, ez = z - d.z - bz * t;
  return Math.sqrt(ex * ex + ez * ez);
}

/** Clear of every door lane by at least m? @param {number} x @param {number} z @param {any} ch @param {number} m */
const clearOfLanes = (x, z, ch, m) => ch.doors.every((/** @type {any} */ d) => laneDist(x, z, ch, d) >= m);

/**
 * Dress a plan into its field's primitives.
 * @param {import('./plan.js').FloorPlan} plan @param {any} F recipe floors
 * @returns {DressedFloor}
 */
export function dressFloor(plan, F) {
  const root = subSeed(plan.inputs.seed, 'hollow-shape');
  const keys = [plan.inputs.trip, plan.inputs.floor, plan.inputs.attempt];
  const sponge = plan.flavor === 'sponge' ? F.shapes.sponge : null;
  const id = plan.depthId;
  const S = F.shapes[id];
  /** @type {DressedChamber[]} */ const chambers = [];
  /** @type {Prim[]} */ const rock = [];
  for (const ch of plan.chambers) {
    const s = stream(root, ...keys, ch.id);
    const height = s.range(S.heightM[0], S.heightM[1]);
    const grow = sponge ? sponge.growShare : 1;
    const out = id === 'glass' ? glassChamber(ch, S, s, height, grow, rock)
      : id === 'silt' ? siltChamber(ch, S, s, height, grow)
        : roundChamber(ch, S, s, height, grow);
    // Each depth's own pieces (the sponge keeps only the chamber shapes and its lattice).
    if (!sponge) {
      if (id === 'shelf') shelfPieces(ch, S, s, out);
      else if (id === 'drip') dripPieces(ch, S, s, out, rock);
      else if (id === 'silt') siltPieces(ch, S, s, out);
    }
    chambers.push(out);
  }
  const P = F.passage;
  const passages = plan.passages.map((p) => {
    const r = sponge ? sponge.joinRadiusM : p.r;
    return { pts: p.pts, r, lift: r * P.liftShare };
  });
  return { plan, chambers, passages, rock, wear: F.wear, passageBlend: P.blendM, sponge, cellShare: S.cellShare ?? 1, noiseSeed: subSeed(root, `${keys.join('.')}`) };
}

/** @param {any} ch @param {number} height @param {number} reach @param {number} blend @returns {DressedChamber} */
function base(ch, height, reach, blend) {
  return { id: ch.id, kind: ch.kind, x: ch.x, z: ch.z, y: ch.y, reach, height, blobs: [], blend, airAdd: [], rockAdd: [], waterY: -Infinity };
}

/** Wet shelf and dripstone rooms: a few ellipsoids round the centre. @param {any} ch @param {any} S @param {any} s @param {number} h @param {number} grow */
function roundChamber(ch, S, s, h, grow) {
  const r = ch.r * grow;
  const out = base(ch, h, r * 1.15, S.blendM);
  const n = S.blobs[0] + s.int(S.blobs[1] - S.blobs[0] + 1);
  for (let b = 0; b < n; b++) {
    const a = s.range(0, 2 * det.PI), d = b === 0 ? 0 : s.range(0.4, 1) * S.spreadShare * r;
    const rx = r * (1 - S.spreadShare * 0.5) * s.range(0.85, 1.1);
    const yaw = s.range(0, 2 * det.PI);
    out.blobs.push({ t: 'ell', c: [ch.x + det.cos(a) * d, ch.y + h * 0.35, ch.z + det.sin(a) * d], r: [rx, h * 0.65, rx * S.squash * s.range(0.85, 1.1)], cos: det.cos(yaw), sin: det.sin(yaw) });
  }
  return out;
}

/** Silt deeps rooms: long, the blobs strung along the chamber's yaw. @param {any} ch @param {any} S @param {any} s @param {number} h @param {number} grow */
function siltChamber(ch, S, s, h, grow) {
  const L = ch.r * S.lengthShare * grow, W = ch.r * S.widthShare * grow;
  const out = base(ch, h, L * 1.1, S.blendM);
  const n = S.blobs[0] + s.int(S.blobs[1] - S.blobs[0] + 1);
  for (let b = 0; b < n; b++) {
    const t = n === 1 ? 0 : (b / (n - 1)) * 2 - 1;
    const [x, z] = toWorld(ch, t * L * 0.4 + s.range(-0.5, 0.5), s.range(-0.5, 0.5));
    out.blobs.push({ t: 'ell', c: [x, ch.y + h * 0.35, z], r: [L * 0.62 * s.range(0.9, 1.05), h * 0.65, W * s.range(0.9, 1.05)], cos: ch.cos, sin: ch.sin });
  }
  return out;
}

/**
 * Glass halls rooms: a faceted pocket (a convex shape cut by planes) and a second smaller one, with
 * crystals standing out of the walls and floor. @param {any} ch @param {any} S @param {any} s @param {number} h @param {number} grow @param {Prim[]} rock
 */
function glassChamber(ch, S, s, h, grow, rock) {
  const r = ch.r * grow;
  const out = base(ch, h, r * 1.15, S.blendM);
  const pocket = (/** @type {number} */ cx, /** @type {number} */ cz, /** @type {number} */ rr, /** @type {number} */ hh) => {
    const n = S.facets[0] + s.int(S.facets[1] - S.facets[0] + 1);
    const ring = n - 4, top = hh * 0.65, a0 = s.range(0, 2 * det.PI);
    /** @type {number[][]} */ const planes = [];
    const DEG = det.PI / 180;
    for (let i = 0; i < ring; i++) {
      const a = a0 + (i / ring) * 2 * det.PI + s.range(-0.2, 0.2), e = s.range(S.wallTiltDeg[0], S.wallTiltDeg[1]) * DEG;
      planes.push([det.cos(a) * det.cos(e), det.sin(e), det.sin(a) * det.cos(e), rr * s.range(S.offsetShare[0], S.offsetShare[1])]);
    }
    for (let i = 0; i < 4; i++) {
      const a = a0 + (i / 4) * 2 * det.PI + s.range(-0.4, 0.4), e = s.range(S.roofTiltDeg[0], S.roofTiltDeg[1]) * DEG;
      planes.push([det.cos(a) * det.cos(e), det.sin(e), det.sin(a) * det.cos(e), top * det.sin(e) * s.range(0.88, 1)]);
    }
    return { t: /** @type {'poly'} */ ('poly'), c: [cx, ch.y + hh * 0.35, cz], planes };
  };
  out.blobs.push(pocket(ch.x, ch.z, r, h));
  const a = s.range(0, 2 * det.PI);
  out.blobs.push(pocket(ch.x + det.cos(a) * r * 0.5, ch.z + det.sin(a) * r * 0.5, r * S.secondShare, h * 0.8));

  // Crystals: hexagonal prisms rooted in the rock, pointing into the room.
  const C = S.crystals, main = out.blobs[0];
  const n = C.count[0] + s.int(C.count[1] - C.count[0] + 1);
  for (let i = 0; i < n; i++) {
    const len = s.range(C.lengthM[0], C.lengthM[1]), rad = s.range(C.radiusM[0], C.radiusM[1]);
    let basePt, axis;
    if (s.next() < C.floorShare) {
      const aa = s.range(0, 2 * det.PI), d = s.range(0.45, 0.8) * r;
      const x = ch.x + det.cos(aa) * d, z = ch.z + det.sin(aa) * d;
      if (!clearOfLanes(x, z, ch, 2.5)) continue;
      basePt = [x, ch.y - 0.3, z];
      axis = norm([s.range(-0.35, 0.35), 1, s.range(-0.35, 0.35)]);
    } else {
      // A point on the pocket's wall along a random direction (the nearest plane it meets).
      const aa = s.range(0, 2 * det.PI), e = s.range(-0.1, 1.2);
      const dir = [det.cos(aa) * det.cos(e), det.sin(e), det.sin(aa) * det.cos(e)];
      let t = Infinity;
      for (const p of /** @type {number[][]} */ (main.planes)) { const dn = dir[0] * p[0] + dir[1] * p[1] + dir[2] * p[2]; if (dn > 1e-6) t = Math.min(t, p[3] / dn); }
      if (!(t < Infinity)) continue;
      basePt = [main.c[0] + dir[0] * t * 1.04, main.c[1] + dir[1] * t * 1.04, main.c[2] + dir[2] * t * 1.04];
      if (basePt[1] < ch.y + 0.8) continue;
      axis = norm([-dir[0] + s.range(-0.4, 0.4), -dir[1] + s.range(-0.4, 0.4), -dir[2] + s.range(-0.4, 0.4)]);
    }
    rock.push(hexPrism(basePt, axis, rad, len, s.range(0, det.PI)));
  }
  return out;
}

/** @param {number[]} v */
function norm(v) { const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

/** A hex prism from a base point along an axis, turned by spin. @param {number[]} b @param {number[]} ax @param {number} r @param {number} len @param {number} spin @returns {Prim} */
function hexPrism(b, ax, r, len, spin) {
  // Two directions across the axis, turned by spin about it.
  const up = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let u = norm([up[1] * ax[2] - up[2] * ax[1], up[2] * ax[0] - up[0] * ax[2], up[0] * ax[1] - up[1] * ax[0]]);
  let v = [ax[1] * u[2] - ax[2] * u[1], ax[2] * u[0] - ax[0] * u[2], ax[0] * u[1] - ax[1] * u[0]];
  const cs = det.cos(spin), sn = det.sin(spin);
  [u, v] = [[u[0] * cs + v[0] * sn, u[1] * cs + v[1] * sn, u[2] * cs + v[2] * sn], [v[0] * cs - u[0] * sn, v[1] * cs - u[1] * sn, v[2] * cs - u[2] * sn]];
  const hl = len / 2;
  return { t: 'hex', c: [b[0] + ax[0] * hl, b[1] + ax[1] * hl, b[2] + ax[2] * hl], ax: [...ax, ...u, ...v], hr: r, hl };
}

/** Wet shelf: raised shelves (low ones a step up, high ones a ledge) and puddle hollows. @param {any} ch @param {any} S @param {any} s @param {DressedChamber} out */
function shelfPieces(ch, S, s, out) {
  const Sh = S.shelves;
  const n = Sh.count[0] + s.int(Sh.count[1] - Sh.count[0] + 1);
  for (let i = 0; i < n; i++) {
    const a = s.range(0, 2 * det.PI), d = s.range(0.25, 0.65) * ch.r;
    const x = ch.x + det.cos(a) * d, z = ch.z + det.sin(a) * d;
    const high = s.next() < Sh.highShare;
    const sx = s.range(Sh.sizeM[0], Sh.sizeM[1]) / 2, sz = s.range(Sh.sizeM[0], Sh.sizeM[1]) / 2, yaw = s.range(0, det.PI);
    if (high && !clearOfLanes(x, z, ch, Math.max(sx, sz) + 1.5)) continue;
    const top = ch.y + (high ? Sh.highM : Sh.lowM), bottom = ch.y - 1;
    out.rockAdd.push({ t: 'box', c: [x, (top + bottom) / 2, z], h: [sx, (top - bottom) / 2, sz, 0.25], cos: det.cos(yaw), sin: det.sin(yaw) });
  }
  const Pu = S.puddles;
  const m = Pu.count[0] + s.int(Pu.count[1] - Pu.count[0] + 1);
  for (let i = 0; i < m; i++) {
    const a = s.range(0, 2 * det.PI), d = s.range(0.1, 0.6) * ch.r, R = s.range(Pu.radiusM[0], Pu.radiusM[1]), yaw = s.range(0, det.PI);
    out.airAdd.push({ t: 'ell', c: [ch.x + det.cos(a) * d, ch.y, ch.z + det.sin(a) * d], r: [R, Pu.depthM, R * s.range(0.6, 1)], cos: det.cos(yaw), sin: det.sin(yaw) });
  }
  if (m > 0) out.waterY = ch.y - Pu.depthM + Pu.waterM;
}

/** Dripstone: columns floor to roof (kept off the door lanes), hanging stone and floor stone. @param {any} ch @param {any} S @param {any} s @param {DressedChamber} out @param {Prim[]} rock */
function dripPieces(ch, S, s, out, rock) {
  const Co = S.columns;
  const n = Co.count[0] + s.int(Co.count[1] - Co.count[0] + 1);
  /** @type {number[][]} */ const placed = [];
  for (let i = 0; i < n; i++) {
    for (let t = 0; t < 10; t++) {
      const a = s.range(0, 2 * det.PI), d = s.range(0.2, 0.65) * ch.r, cr = s.range(Co.radiusM[0], Co.radiusM[1]);
      const x = ch.x + det.cos(a) * d, z = ch.z + det.sin(a) * d;
      if (!clearOfLanes(x, z, ch, cr + Co.doorClearM / 2)) continue;
      if (placed.some(([px, pz, pr]) => Math.sqrt((px - x) * (px - x) + (pz - z) * (pz - z)) < pr + cr + 2)) continue;
      placed.push([x, z, cr]);
      // An hourglass: flared where it meets the floor and the roof.
      const mid = ch.y + out.height * 0.45, top = ch.y + out.height + 1;
      rock.push({ t: 'cone', c: [x, ch.y - 0.5, z], b: [x, mid, z], ra: cr * 1.7, rb: cr });
      rock.push({ t: 'cone', c: [x, top, z], b: [x, mid, z], ra: cr * 1.9, rb: cr });
      break;
    }
  }
  const St = S.stalactites;
  const m = St.count[0] + s.int(St.count[1] - St.count[0] + 1);
  for (let i = 0; i < m; i++) {
    const a = s.range(0, 2 * det.PI), d = s.range(0.05, 0.75) * ch.r;
    const x = ch.x + det.cos(a) * d, z = ch.z + det.sin(a) * d;
    const roof = roofAt(out, x, z);
    if (roof === null) continue;
    const len = Math.min(s.range(St.lengthM[0], St.lengthM[1]), roof - ch.y - 3);
    if (len < 0.4) continue;
    rock.push({ t: 'cone', c: [x, roof + 0.6, z], b: [x + s.range(-0.15, 0.15), roof - len, z + s.range(-0.15, 0.15)], ra: s.range(St.radiusM[0], St.radiusM[1]), rb: 0.04 });
  }
  const Sg = S.stalagmites;
  const k = Sg.count[0] + s.int(Sg.count[1] - Sg.count[0] + 1);
  for (let i = 0; i < k; i++) {
    const a = s.range(0, 2 * det.PI), d = s.range(0.2, 0.7) * ch.r, sr = s.range(Sg.radiusM[0], Sg.radiusM[1]);
    const x = ch.x + det.cos(a) * d, z = ch.z + det.sin(a) * d;
    if (!clearOfLanes(x, z, ch, sr + 1.5)) continue;
    rock.push({ t: 'cone', c: [x, ch.y - 0.3, z], b: [x, ch.y + s.range(Sg.lengthM[0], Sg.lengthM[1]), z], ra: sr, rb: 0.05 });
  }
}

/** Silt deeps: a deep channel down the chamber's length, crossed by causeways. @param {any} ch @param {any} S @param {any} s @param {DressedChamber} out */
function siltPieces(ch, S, s, out) {
  const Cn = S.channel, L = ch.r * S.lengthShare;
  const hw = s.range(Cn.widthM[0], Cn.widthM[1]) / 2, hx = L * Cn.lengthShare;
  const bottom = ch.y - Cn.depthM, top = ch.y + 0.6;
  out.airAdd.push({ t: 'box', c: [ch.x, (top + bottom) / 2, ch.z], h: [hx, (top - bottom) / 2, hw, 0.4], cos: ch.cos, sin: ch.sin });
  out.waterY = ch.y - Cn.waterM;
  const Cw = S.causeways;
  const n = Cw.count[0] + s.int(Cw.count[1] - Cw.count[0] + 1);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? s.range(-0.3, 0.3) : (i / (n - 1)) * 1.2 - 0.6 + s.range(-0.1, 0.1);
    const [x, z] = toWorld(ch, t * hx, 0);
    const w = s.range(Cw.widthM[0], Cw.widthM[1]) / 2, cb = ch.y - 3;
    out.rockAdd.push({ t: 'box', c: [x, (ch.y + cb) / 2, z], h: [w, (ch.y - cb) / 2, hw + 0.8, 0.15], cos: ch.cos, sin: ch.sin });
  }
}

/** The roof over (x, z) inside a chamber's blobs, or null outside them. @param {DressedChamber} out @param {number} x @param {number} z */
function roofAt(out, x, z) {
  let inside = false;
  for (let y = out.y + 0.5; y < out.y + out.height + 2; y += 0.1) {
    let d = Infinity;
    for (const b of out.blobs) d = Math.min(d, ellDist(b, x, y, z));
    if (d < 0) inside = true;
    else if (inside) return y;
  }
  return null;
}

/**
 * Ellipsoid distance (the bound used by body-bake.js), yawed about y.
 * @param {Prim} q @param {number} x @param {number} y @param {number} z
 */
export function ellDist(q, x, y, z) {
  const r = /** @type {number[]} */ (q.r), cs = /** @type {number} */ (q.cos), sn = /** @type {number} */ (q.sin);
  const dx = x - q.c[0], dy = y - q.c[1], dz = z - q.c[2];
  const lx = dx * cs + dz * sn, lz = -dx * sn + dz * cs;
  const ax = lx / r[0], ay = dy / r[1], az = lz / r[2];
  const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
  const bx = ax / r[0], by = ay / r[1], bz = az / r[2];
  const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
  return k1 > 1e-12 ? (k0 * (k0 - 1)) / k1 : -Math.min(r[0], r[1], r[2]);
}

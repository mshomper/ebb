// The camp pieces sessions make (docs/future/13 section 3.12 "Models"; doc 13 "Trails", the
// forager's stops), built in code at their real size with the kit (kit.mjs): meters, y up, the front
// toward +z, the base on y = 0. Colours are physical albedo (linear), picked from the real
// materials; the soft painted look comes later from the palette at the tonemap. Each builder gives
// { mesh, material }; made-pieces.mjs turns it into a glTF document for build-models.mjs.
//
// Pieces worn or held hang the way they are worn: the gathering knife point down from the belt, the
// seed scoop mouth down from its cord, the walking stick upright, the pressing frame upright on its
// cord loop. Placing them on the walker is the build sessions' part.

import { mesh, grid, hash01, noise3, lin, mix, shade, lathe, superShape, sweep, blob, slab, box, rot, chain, place, mark } from './kit.mjs';

/** @typedef {import('./kit.mjs').Mesh} Mesh */
/** @typedef {{ mesh: Mesh, material: { name: string, roughness: number, metallic: number } }} Piece */

const TAU = Math.PI * 2;

// ---- Hearth stones ----

/**
 * Three flat-topped shore stones inside the fire ring (fire-ring.glb, 1.0 m across, its stones from
 * about 0.25 m out), set 120 degrees apart between the arms of the star fire, their tops level at
 * about 9 cm so a pot of 0.2 to 0.3 m sits across them. Origin at the ring's middle; one stone toward
 * the back (-z), two toward the front. Coloured from the shore stone's own greys (stone.glb), with
 * soot on the faces that look into the fire.
 * @param {{ dark: number[], mid: number[], pale: number[] }} stone the single stone's colours
 * @returns {Piece}
 */
export function hearthStones(stone) {
  const m = mesh();
  const ringR = 0.145;
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i * TAU) / 3, seed = 11 + i * 7;
    const k = 0.9 + 0.2 * hash01(seed, 1, 2);
    const r = [0.072 * k, 0.066, 0.056 * k];
    const v0 = mark(m);
    blob(m, r, seed, (p, up) => {
      const s = 1 / 0.07;
      const blot = 0.6 * noise3(p[0] * s * 1.4, p[1] * s * 1.4, p[2] * s * 1.4, seed) + 0.4 * noise3(p[0] * s * 4, p[1] * s * 4, p[2] * s * 4, seed + 3);
      const fleck = hash01(Math.floor(p[0] * 260), Math.floor(p[1] * 260), Math.floor(p[2] * 260) + seed) > 0.93 ? 1 : 0;
      let c = mix(mix(stone.dark, stone.mid, blot), stone.pale, fleck);
      // Worn paler on the flat top where pots have sat.
      if (up > 0.6) c = mix(c, stone.mid, 0.35);
      // Soot on the inner face (local -x, turned toward the middle below).
      const soot = Math.max(0, Math.min(1, (-p[0] / r[0] - 0.2) / 0.6)) * (0.55 + 0.45 * noise3(p[1] * 60, p[2] * 60, 0, seed));
      return mix(c, shade(stone.dark, 0.25), soot * 0.75);
    }, { flatTop: 0.5, lump: 0.06, nu: 36, nv: 20 });
    // Lift onto the ground: the blob's underside sits at -0.7 r[1] at the lowest.
    place(m, v0, chain(rot('y', -a), rot('z', 0.03 * (hash01(seed, 5, 5) - 0.5))), [Math.cos(a) * ringR, r[1] * 0.7, Math.sin(a) * ringR]);
  }
  return { mesh: m, material: { name: 'hearth-stones', roughness: 0.85, metallic: 0 } };
}

// ---- The camp store: a lidded rush hamper ----

const RUSH = lin([170, 150, 106]), RUSH_GREEN = lin([146, 142, 100]), RUSH_DARK = lin([104, 88, 60]);
const WITHY = lin([112, 82, 66]), WITHY_PEELED = lin([196, 172, 132]);

/** The hamper's sizes (m): half width (x), half depth (z), wall height, and the lid. */
const HAMPER = { a: 0.25, b: 0.18, n: 3.2, h: 0.33, base: 0.92, lidH: 0.05 };

/** A rush colour for one coil row: straw, a few rows greener, the grooves between rows darker. @param {number} row @param {number} groove 0..1 */
function rushAt(row, groove, seed = 0) {
  const t = hash01(row, 7, seed);
  const c = mix(RUSH, RUSH_GREEN, t > 0.7 ? 0.7 : t * 0.3);
  return mix(shade(c, 0.85 + 0.25 * hash01(row, 3, seed)), RUSH_DARK, groove * 0.7);
}

/**
 * One hamper body: a rounded oblong of coiled rush rows stitched over upright stakes, a little
 * wider at the top, with a rolled rim and a short inside wall. Twined over and under, so each row
 * bulges between the stakes it passes in front of. Base at y = y0.
 * @param {Mesh} m @param {number} y0 @param {number} seed
 */
function hamperBody(m, y0, seed) {
  const H = HAMPER, rows = 26, stakes = 44, shape = superShape(1, H.b / H.a, H.n);
  // The profile in (radius along x, y), walked so the outside faces out: under the base outward, up
  // the wall, over the rim, down a little inside and in across a hidden floor.
  const prof = [[0, 0], [H.a * H.base - 0.01, 0], [H.a * H.base, 0.012]];
  for (let k = 1; k <= 24; k++) { const t = k / 24; prof.push([H.a * (H.base + (1 - H.base) * t), 0.012 + (H.h - 0.012) * t]); }
  prof.push([H.a + 0.008, H.h + 0.006], [H.a + 0.004, H.h + 0.014], [H.a - 0.006, H.h + 0.012], [H.a - 0.012, H.h - 0.01], [H.a - 0.014, H.h - 0.03], [0, H.h - 0.03]);
  // Arc length along the profile, so the rows space evenly up the wall.
  const len = [0];
  for (let i = 1; i < prof.length; i++) len.push(len[i - 1] + Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]));
  const total = len[len.length - 1];
  const at = (/** @type {number} */ v) => {
    const s = v * total;
    let i = 1;
    while (i < len.length - 1 && len[i] < s) i++;
    const f = (s - len[i - 1]) / (len[i] - len[i - 1] || 1);
    return [prof[i - 1][0] + (prof[i][0] - prof[i - 1][0]) * f, prof[i - 1][1] + (prof[i][1] - prof[i - 1][1]) * f];
  };
  const wall = (/** @type {number} */ y) => y > 0.012 && y < H.h;
  const rowOf = (/** @type {number} */ y) => ((y - 0.012) / (H.h - 0.012)) * rows;
  const v0 = lathe(m, stakes * 3, 110, (v) => at(v), (u, v, p) => {
    const y = p[1];
    if (!wall(y)) {
      // The base and the rim: a darker binding wrapped on the slant round the rim.
      const wrap = 0.5 + 0.5 * Math.sin((u * 90 + y * 400) * TAU);
      return y >= H.h ? mix(rushAt(99, 0, seed), RUSH_DARK, 0.35 * wrap) : rushAt(98, 0.3, seed);
    }
    const r = rowOf(y), row = Math.floor(r), f = r - row;
    const groove = Math.max(0, 1 - Math.sin(f * Math.PI) * 1.6);
    const stake = (u * stakes + (row % 2) * 0.5) % 1;
    return shade(rushAt(row, groove, seed), 0.9 + 0.12 * Math.sin(stake * Math.PI));
  }, {
    shape,
    bump: (u, v) => {
      const y = at(v)[1];
      if (!wall(y)) return 0;
      const r = rowOf(y), row = Math.floor(r), f = r - row;
      const over = Math.sin(((u * stakes + (row % 2) * 0.5) % 1) * Math.PI);
      return 0.0032 * Math.sin(f * Math.PI) ** 0.6 * (0.55 + 0.45 * over);
    },
  });
  place(m, v0, rot('y', 0), [0, y0, 0]);
}

/**
 * The hamper's rush lid: a shallow dome coiled round from the middle, a short skirt over the rim,
 * and a twisted rush loop to lift it by. Its underside at y = y0.
 * @param {Mesh} m @param {number} y0 @param {number} seed
 */
function rushLid(m, y0, seed) {
  const H = HAMPER, A = H.a + 0.016, rings = 16, shape = superShape(1, (H.b + 0.016) / A, H.n);
  const prof = (/** @type {number} */ v) => {
    // Out under the skirt, up its face, then over the dome to the middle.
    if (v < 0.1) return [A * (v / 0.1) * 0.98, 0.012];
    if (v < 0.14) return [A * 0.98 + (A * 0.02) * ((v - 0.1) / 0.04), 0.012 - 0.012 * ((v - 0.1) / 0.04)];
    if (v < 0.3) return [A, ((v - 0.14) / 0.16) * 0.036];
    const t = (v - 0.3) / 0.7;
    return [A * (1 - t), 0.036 + 0.016 * Math.sin(t * Math.PI / 2)];
  };
  const v0 = lathe(m, 108, 64, prof, (u, v, p) => {
    if (v < 0.3) return mix(rushAt(96, 0, seed), RUSH_DARK, 0.3 * (0.5 + 0.5 * Math.sin((u * 80 + p[1] * 300) * TAU)));
    const r = ((v - 0.3) / 0.7) * rings, row = Math.floor(r), f = r - row;
    const groove = Math.max(0, 1 - Math.sin(f * Math.PI) * 1.6);
    return shade(rushAt(row + 40, groove, seed), 0.92 + 0.1 * Math.sin(((u * 36 + row * 0.5) % 1) * Math.PI));
  }, {
    shape,
    bump: (u, v) => {
      if (v < 0.3) return v < 0.14 ? 0 : 0.002;
      const r = ((v - 0.3) / 0.7) * rings, f = r - Math.floor(r);
      return 0.0025 * Math.sin(f * Math.PI) ** 0.6;
    },
  });
  place(m, v0, rot('y', 0), [0, y0, 0]);
  // The loop: a twisted rush arch across the lid's middle, along x.
  const v1 = mark(m);
  sweep(m, 10, 40, (t) => [(t - 0.5) * 0.07, 0.05 + Math.sin(t * Math.PI) * 0.028, 0], (t, a) => 0.0055 * (1 + 0.18 * Math.sin(a * 2 + t * 40)),
    (t, a) => shade(rushAt(95, 0, seed), 0.85 + 0.25 * (0.5 + 0.5 * Math.sin(a * 2 + t * 40))), { endRound: 0.06 });
  place(m, v1, rot('y', 0), [0, y0, 0]);
}

/**
 * A willow-withy lid for the grown store: rods laid across (along z) and arched a little, a rim rod
 * round the edge and two binders along x, peeled buff rods among the brown ones. Underside at y0.
 * @param {Mesh} m @param {number} y0
 */
function withyLid(m, y0) {
  const H = HAMPER, A = H.a + 0.012, B = H.b + 0.012, shape = superShape(A, B, H.n);
  const halfZ = (/** @type {number} */ x) => B * Math.max(0, 1 - Math.abs(x / A) ** H.n) ** (1 / H.n);
  const rods = 26;
  for (let i = 0; i < rods; i++) {
    const x = -A + 0.02 + ((2 * A - 0.04) * i) / (rods - 1), hz = halfZ(x) - 0.004;
    const peeled = hash01(i, 21, 4) > 0.72, base = peeled ? WITHY_PEELED : WITHY, r = 0.0065 + 0.0015 * hash01(i, 2, 9);
    const v0 = mark(m);
    sweep(m, 8, 24, (t) => [x + 0.002 * Math.sin(t * 7 + i), 0.012 + 0.026 * Math.sin(t * Math.PI) * (1 - (x / A) ** 2), (t - 0.5) * 2 * hz],
      () => r, (t, a) => shade(base, 0.85 + 0.25 * noise3(t * 30, a, i, 5)), { flatEnds: true });
    place(m, v0, rot('y', 0), [0, y0, 0]);
  }
  // The rim rod, round the outline, and two binders across the top along x.
  const v1 = mark(m);
  sweep(m, 10, 160, (t) => { const s = shape(t); return [s[0], 0.012, s[1]]; }, () => 0.0085, (t, a) => shade(WITHY, 0.8 + 0.3 * noise3(t * 60, a, 1, 8)));
  for (const z of [-0.07, 0.07]) {
    sweep(m, 8, 40, (t) => { const x = (t - 0.5) * 2 * (A - 0.01); return [x, 0.012 + 0.026 * (1 - (z / B) ** 2) * (1 - (x / A) ** 2) + 0.007, z]; },
      () => 0.0055, (t, a) => shade(WITHY_PEELED, 0.8 + 0.25 * noise3(t * 40, a, z * 10, 3)), { endRound: 0.04 });
  }
  place(m, v1, rot('y', 0), [0, y0, 0]);
}

/** The camp store (P2j, Matt's pick): one lidded rush hamper, about knee high. @returns {Piece} */
export function campStore() {
  const m = mesh();
  hamperBody(m, 0, 1);
  rushLid(m, HAMPER.h - 0.02, 1);
  return { mesh: m, material: { name: 'camp-store', roughness: 0.9, metallic: 0 } };
}

/** The grown store: two hampers stacked, a willow-withy lid on top. @returns {Piece} */
export function campStoreGrown() {
  const m = mesh();
  hamperBody(m, 0, 1);
  // The upper hamper sits down inside the lower one's rim by its base's taper.
  hamperBody(m, HAMPER.h - 0.006, 2);
  withyLid(m, 2 * HAMPER.h - 0.006 + 0.01);
  return { mesh: m, material: { name: 'camp-store-grown', roughness: 0.9, metallic: 0 } };
}

// ---- The forager's trail ----

/**
 * A small gathering knife: a short steel blade with a slight hook toward the edge, a pale ash
 * handle bound with cord at the bolster. Hangs point down from the belt: the point at y = 0, the
 * edge toward -x, the flat facing +z. 17 cm long.
 * @returns {Piece}
 */
export function gatheringKnife() {
  const m = mesh();
  const steel = lin([112, 114, 114]), edge = lin([170, 172, 170]), ash = lin([168, 128, 84]), cord = lin([92, 70, 48]);
  // The blade, drawn lying along +x (spine up, edge down), the hook at the point.
  const out = [];
  // s from the bolster (0) to the point (1): the edge rises to the point, the spine drops to meet it.
  for (let i = 0; i <= 16; i++) { const s = 1 - i / 16; out.push([0.088 * s, -0.003 - 0.016 * (1 - s * s)]); }
  for (let i = 1; i < 16; i++) { const s = i / 16; out.push([0.088 * s, 0.004 - 0.007 * s ** 4]); }
  const vb = mark(m);
  slab(m, out.reverse(), 0.0026, (x, y) => (y < -0.003 - 0.016 * (1 - (x / 0.088) ** 2) + 0.004 ? edge : shade(steel, 0.9 + 0.15 * noise3(x * 200, y * 200, 0, 4))), { bevel: 0.45 });
  // The handle: an oval section, swelling a little to the butt, the cord wrap by the blade.
  sweep(m, 14, 30, (t) => [0.01 - 0.095 * t, 0, 0], (t, a) => (0.0105 + 0.0018 * Math.sin(t * Math.PI * 0.9)) * (1 - 0.25 * Math.sin(a) ** 2),
    (t, a) => (t < 0.22 ? shade(cord, 0.8 + 0.3 * (0.5 + 0.5 * Math.sin(t * 180 + a))) : shade(ash, 0.85 + 0.2 * noise3(t * 20, Math.cos(a) * 3, Math.sin(a) * 3, 2))),
    { endRound: 0.08 });
  // Hang it: the point down, the edge toward -x, the flat toward +z.
  place(m, vb, rot('z', -Math.PI / 2), [0, 0.088, 0]);
  return { mesh: m, material: { name: 'gathering-knife', roughness: 0.55, metallic: 0 } };
}

/**
 * A horn seed scoop: the tip of a cow's horn split along its length into a curved trough, the lip
 * rounded, dark at the closed tip and cream to grey along the grain, a leather thong through the
 * tip to hang it by. Hangs mouth down from the belt: the mouth at y = 0, the scoop opening toward
 * +z. 13 cm long.
 * @returns {Piece}
 */
export function seedScoop() {
  const m = mesh();
  const horn = lin([172, 150, 110]), hornGrey = lin([108, 96, 82]), tip = lin([62, 52, 46]), thong = lin([96, 64, 40]);
  const L = 0.13, R = 0.027, th = 0.0022;
  // The middle line: a gentle curve from the mouth (t = 0) to the tip (t = 1), in the y-z plane.
  const path = (/** @type {number} */ t) => [0, L * t, -0.032 * Math.sin(t * Math.PI * 0.75)];
  const radius = (/** @type {number} */ t) => R * (1 - t) ** 0.8 + 0.0015;
  // Half the section's opening at t: an open trough at the mouth closing toward the tip.
  const open = (/** @type {number} */ t) => Math.PI * (0.55 + 0.4 * t ** 1.5);
  const color = (/** @type {number} */ t, /** @type {number} */ a) => {
    const grain = noise3(t * 6, Math.cos(a) * 4, Math.sin(a) * 4, 3) * 0.6 + 0.4 * noise3(t * 30, Math.cos(a) * 12, 0, 7);
    return mix(mix(horn, hornGrey, grain * 0.9), tip, Math.max(0, (t - 0.2) / 0.8) ** 0.8);
  };
  // Section point at (t, angle round from the back of the trough, -z side), at radius r.
  const at = (/** @type {number} */ t, /** @type {number} */ ang, /** @type {number} */ r) => {
    const p = path(t);
    return [Math.sin(ang) * r, p[1], p[2] - Math.cos(ang) * r];
  };
  // Outside and inside skins of the trough (the inside one wound back so it faces in).
  for (const side of [1, -1]) {
    const g = (/** @type {number} */ u, /** @type {number} */ v) => {
      const w = open(v), ang = side > 0 ? -w + 2 * w * u : w - 2 * w * u;
      return { p: at(v, ang, side > 0 ? radius(v) : Math.max(0.0004, radius(v) - th)), c: side > 0 ? color(v, ang) : shade(color(v, ang), 1.08) };
    };
    grid(m, 24, 40, g, false);
  }
  // The lip: a rounded rim along both edges and round the mouth, joining the two skins.
  const rim = [];
  /** How far toward the tip each rim point is, for its colour. @type {number[]} */ const rimT = [];
  for (let i = 40; i >= 0; i--) { rim.push(at(i / 40, -open(i / 40), radius(i / 40) - th / 2)); rimT.push(i / 40); }
  for (let i = 1; i < 24; i++) { const w = open(0), ang = -w + (2 * w * i) / 24; rim.push(at(0, ang, radius(0) - th / 2)); rimT.push(0); }
  for (let i = 0; i <= 40; i++) { rim.push(at(i / 40, open(i / 40), radius(i / 40) - th / 2)); rimT.push(i / 40); }
  const ri = (/** @type {number} */ t) => Math.round(t * (rim.length - 1));
  sweep(m, 8, rim.length - 1, (t) => rim[ri(t)], () => th * 0.62, (t, a) => shade(color(rimT[ri(t)], a), 1.05));
  // The thong: a loop through the tip.
  const tp = path(0.9);
  sweep(m, 8, 40, (t) => [Math.sin(t * TAU) * 0.004, tp[1] + 0.012 + Math.cos(t * TAU) * -0.016 + 0.004, tp[2]], () => 0.0018, (t) => shade(thong, 0.85 + 0.2 * Math.sin(t * 30)));
  return { mesh: m, material: { name: 'seed-scoop', roughness: 0.5, metallic: 0 } };
}



/**
 * A lidded tea caddy tin: a round tin with a slip-on lid, a pressed bead round its middle, worn to
 * bright metal on the rims, dulled grey elsewhere with a few rust freckles. Sits on the apothecary
 * bench. 12 cm tall.
 * @returns {Piece}
 */
export function teaCaddy() {
  const m = mesh();
  const tin = lin([168, 168, 162]), bright = lin([214, 212, 204]), dull = lin([118, 118, 112]), rust = lin([128, 76, 46]);
  const R = 0.04, H = 0.098;
  const tone = (/** @type {number[]} */ p, /** @type {number} */ rim) => {
    const n = noise3(p[0] * 40, p[1] * 40, p[2] * 40, 6);
    let c = mix(tin, dull, n * 0.7);
    if (hash01(Math.floor(p[0] * 300), Math.floor(p[1] * 300), Math.floor(p[2] * 300)) > 0.985) c = rust;
    return mix(c, bright, rim);
  };
  // The body: up the side with a bead at the middle, the neck stepped in for the lid.
  const body = (/** @type {number} */ v) => {
    if (v < 0.06) return [R * (v / 0.06) * 0.97, 0];
    if (v < 0.1) return [R * 0.97 + R * 0.03 * ((v - 0.06) / 0.04), 0.003 * ((v - 0.06) / 0.04)];
    if (v < 0.8) { const t = (v - 0.1) / 0.7, y = 0.003 + t * (H - 0.03); const bead = Math.exp(-(((y - H * 0.42) / 0.003) ** 2)); return [R + 0.0018 * bead, y]; }
    if (v < 0.86) return [R - 0.0025 * ((v - 0.8) / 0.06), H - 0.027];
    if (v < 0.95) return [R - 0.0025, H - 0.027 + 0.027 * ((v - 0.86) / 0.09)];
    return [(R - 0.0025) * (1 - (v - 0.95) / 0.05), H];
  };
  lathe(m, 48, 56, body, (u, v, p) => tone(p, v < 0.1 || (v > 0.78 && v < 0.82) ? 0.6 : 0));
  // The lid: a skirt over the neck, a gently domed top with a rolled edge.
  const LR = R + 0.0012, y0 = H - 0.026, LH = 0.03;
  const lid = (/** @type {number} */ v) => {
    if (v < 0.08) return [LR - 0.0015 + 0.0015 * (v / 0.08), y0];
    if (v < 0.55) return [LR, y0 + ((v - 0.08) / 0.47) * LH];
    if (v < 0.65) return [LR - 0.002 * ((v - 0.55) / 0.1), y0 + LH + 0.0015 * Math.sin(((v - 0.55) / 0.1) * Math.PI)];
    const t = (v - 0.65) / 0.35;
    return [(LR - 0.002) * (1 - t), y0 + LH + 0.003 * Math.sin(t * Math.PI / 2)];
  };
  lathe(m, 48, 40, lid, (u, v, p) => tone(p, (v > 0.5 && v < 0.68) || v < 0.1 ? 0.7 : 0));
  return { mesh: m, material: { name: 'tea-caddy', roughness: 0.42, metallic: 1 } };
}

/**
 * A hazel walking stick, a thumbstick: a straight hazel rod forked at the top for the thumb, glossy
 * coppery bark with pale lenticels, a few nodes, the fork's crotch rubbed pale by the hand, the foot
 * cut square and worn. Stands upright, the fork opening toward the sides (x). 1.2 m tall.
 * @returns {Piece}
 */
export function walkingStick() {
  const m = mesh();
  const bark = lin([122, 88, 66]), barkGrey = lin([128, 118, 104]), lent = lin([196, 176, 142]), wood = lin([214, 190, 150]);
  const barkAt = (/** @type {number} */ t, /** @type {number} */ a, /** @type {number} */ seed, /** @type {number} */ len) => {
    let c = mix(bark, barkGrey, noise3(t * len * 8, Math.cos(a) * 2, Math.sin(a) * 2, seed) * 0.7);
    if (hash01(Math.floor(t * len * 140), Math.floor(((a + Math.PI) / TAU) * 20), seed) > 0.93) c = lent;
    return c;
  };
  const top = 1.08;
  const shaft = (/** @type {number} */ t) => [0.01 * (noise3(t * 4, 0, 0, 2) - 0.5) * 2, top * t, 0.01 * (noise3(t * 4, 5, 0, 3) - 0.5) * 2];
  const nodes = [0.27, 0.52, 0.78];
  sweep(m, 16, 120, shaft, (t) => (0.0145 - 0.002 * t) + nodes.reduce((s, n) => s + 0.0022 * Math.exp(-(((t - n) / 0.008) ** 2)), 0),
    (t, a) => (t < 0.02 ? mix(barkAt(t, a, 1, top), wood, 0.5) : t > 0.97 ? mix(barkAt(t, a, 1, top), wood, 0.45) : barkAt(t, a, 1, top)), { flatEnds: true });
  // The fork: two tines from just below the top, out at 22 degrees to either side, cut flat.
  const s = shaft(1);
  for (const side of [-1, 1]) {
    const ang = side * 0.38, len = 0.13;
    sweep(m, 12, 30, (t) => [s[0] + Math.sin(ang) * len * t + side * 0.004 * t * t, s[1] - 0.02 + Math.cos(ang) * len * t, s[2]],
      (t) => 0.0118 - 0.0025 * t, (t, a) => (t < 0.25 ? mix(barkAt(t, a, 4 + side, len), wood, 0.55 * (1 - t / 0.25)) : barkAt(t, a, 4 + side, len)), { flatEnds: true });
  }
  return { mesh: m, material: { name: 'walking-stick', roughness: 0.55, metallic: 0 } };
}

/**
 * A pressing frame: a small wooden frame split by a cross into four panes, each holding one pressed
 * flower on pale paper (yellow tormentil, pink thrift, blue speedwell, white chamomile with its
 * yellow eye), each with a stem and a leaf, and a cord loop at the top to hang it on the tent pole.
 * Upright, the flowers facing +z. About 26 cm square.
 * @returns {Piece}
 */
export function pressingFrame() {
  const m = mesh();
  const wood = lin([150, 128, 102]), paper = lin([226, 214, 188]), leaf = lin([96, 116, 62]), cord = lin([150, 120, 82]);
  const W = 0.26, bar = 0.018, deep = 0.014, mid = 0.008;
  const grain = (/** @type {number[]} */ p, /** @type {number} */ k) => shade(wood, 0.85 + 0.25 * noise3(p[0] * k, p[1] * k, p[2] * 30, 12));
  // The paper behind, then the frame's four bars and the cross.
  let v = mark(m);
  box(m, [W - bar, W - bar, 0.003], (p) => shade(paper, 0.95 + 0.08 * noise3(p[0] * 40, p[1] * 40, 0, 2)));
  place(m, v, rot('y', 0), [0, W / 2, -deep / 2 + 0.003]);
  for (const [sx, sy, x, y] of [[W, bar, 0, bar / 2], [W, bar, 0, W - bar / 2], [bar, W - 2 * bar, -W / 2 + bar / 2, W / 2], [bar, W - 2 * bar, W / 2 - bar / 2, W / 2]]) {
    v = mark(m);
    box(m, [sx, sy, deep], (p) => grain(p, sx > sy ? 30 : 4));
    place(m, v, rot('y', 0), [x, y, 0]);
  }
  for (const [sx, sy] of [[W - 2 * bar, mid], [mid, W - 2 * bar]]) {
    v = mark(m);
    box(m, [sx, sy, deep * 0.6], (p) => grain(p, 20));
    place(m, v, rot('y', 0), [0, W / 2, -deep * 0.15]);
  }
  // The flowers: each a flat flower head with a stem and a leaf, pressed onto the paper.
  const pane = (W - 2 * bar - mid) / 2, zf = -deep / 2 + 0.0052;
  /** @param {number} cx @param {number} cy @param {number} n petals @param {number} r1 @param {number} r2 @param {number[]} col @param {number[] | null} eye @param {number} seed */
  const flower = (cx, cy, n, r1, r2, col, eye, seed) => {
    // Stem and leaf below the head.
    let q = mark(m);
    slab(m, [[-0.0012, -0.06], [0.0012, -0.06], [0.0014, 0], [-0.0014, 0]], 0.0006, () => shade(leaf, 0.9));
    place(m, q, rot('z', 0.12 * (hash01(seed, 1, 1) - 0.5)), [cx, cy, zf]);
    q = mark(m);
    const lf = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12; lf.push([0.026 * t, 0.007 * Math.sin(t * Math.PI)]); }
    for (let i = 11; i > 0; i--) { const t = i / 12; lf.push([0.026 * t, -0.005 * Math.sin(t * Math.PI)]); }
    slab(m, lf, 0.0006, (x) => shade(leaf, 0.85 + 0.3 * (x / 0.026)));
    place(m, q, rot('z', (hash01(seed, 2, 2) > 0.5 ? 1 : -1) * 0.5 + (hash01(seed, 2, 2) > 0.5 ? 0 : Math.PI)), [cx, cy - 0.035, zf + 0.0002]);
    // The head: n rounded petals.
    q = mark(m);
    const head = [];
    for (let i = 0; i < n * 8; i++) {
      const a = (i / (n * 8)) * TAU, r = r1 + (r2 - r1) * Math.abs(Math.cos((a * n) / 2)) ** 0.7;
      head.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    slab(m, head, 0.0007, (x, y) => shade(col, 0.88 + 0.2 * (Math.hypot(x, y) / r2)));
    place(m, q, rot('z', hash01(seed, 3, 3)), [cx, cy, zf + 0.0005]);
    if (eye) {
      q = mark(m);
      const e = [];
      for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; e.push([Math.cos(a) * r2 * 0.32, Math.sin(a) * r2 * 0.32]); }
      slab(m, e, 0.0012, () => eye);
      place(m, q, rot('y', 0), [cx, cy, zf + 0.0009]);
    }
  };
  const ox = (pane + mid) / 2, oy = W / 2;
  flower(-ox, oy + ox + 0.012, 5, 0.006, 0.016, lin([226, 186, 58]), lin([200, 150, 40]), 1);
  flower(ox, oy + ox + 0.014, 22, 0.011, 0.015, lin([214, 136, 166]), null, 2);
  flower(-ox, oy - ox + 0.014, 4, 0.004, 0.012, lin([104, 132, 204]), lin([236, 232, 220]), 3);
  flower(ox, oy - ox + 0.014, 18, 0.006, 0.018, lin([236, 232, 216]), lin([222, 180, 52]), 4);
  // The cord loop, tied to the two top corners.
  sweep(m, 8, 60, (t) => [(t - 0.5) * (W - 0.03), W - 0.002 + Math.sin(t * Math.PI) * 0.075, -0.002], () => 0.0022,
    (t) => shade(cord, 0.85 + 0.2 * Math.sin(t * 120)), { endRound: 0.03 });
  return { mesh: m, material: { name: 'pressing-frame', roughness: 0.85, metallic: 0 } };
}

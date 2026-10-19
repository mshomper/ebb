// @ts-check
// How each flora species is drawn (docs 10, 14): its shader, how many vertices one plant takes,
// and how its recipe packs into the draw buffer the shader reads. Used by the flora pass
// (flora.js). Reeds keep the S5b-1 layout of flora-draw.wgsl; the other species share the
// FloraCommon header of lib-flora.wgsl (wind, season albedo and wet darkening, season position,
// seed, pixel width floor) and add their own vec4fs from float 12 on.

const DEG = Math.PI / 180;
const SEASONS = /** @type {const} */ (['spring', 'summer', 'autumn', 'winter']);

/**
 * @typedef {Object} FloraKind
 * @property {string} shader      file in src/shaders without extension
 * @property {string} vs          vertex entry point
 * @property {string} fs          fragment entry point
 * @property {(r: any) => number} vertices  vertices one plant may need
 * @property {(r: any, f: Float32Array) => void} pack  the recipe's fixed values
 * @property {(r: any, f: Float32Array, u: { time: number, wind: number, windDir: number, season: number,
 *   pressed?: { u: number, pad: number, dipM: number, bearing: number }[] }) => void} frame  each frame (pressed: lily pads frogs sit on)
 */

/**
 * A season value blended through the year: each season's value holds at its middle and eases into
 * the next (as the grass does). @param {Record<string, number[]>} A @param {number} s season position (0..4)
 */
export function seasonBlend(A, s) {
  const t = s - 0.5;
  const i0 = ((Math.floor(t) % 4) + 4) % 4;
  const i1 = (i0 + 1) % 4;
  let k = t - Math.floor(t);
  k = k * k * (3 - 2 * k);
  const a = A[SEASONS[i0]];
  const b = A[SEASONS[i1]];
  return [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * k);
}

/** The FloraCommon header, each frame. @param {any} r @param {Float32Array} f @param {{ time: number, wind: number, windDir: number, season: number }} u */
function common(r, f, u) {
  f[0] = Math.cos(u.windDir); f[1] = -Math.sin(u.windDir);
  f[2] = u.time % 3600; f[3] = Math.min(1, Math.max(0, u.wind));
  f.set(seasonBlend(r.season.albedo, u.season), 4);
  f[7] = r.look.wetDarken;
  f[8] = ((u.season % 4) + 4) % 4; f[9] = (r.seed >>> 0) % 100000; f[10] = r.look.pixelWidth ?? 1;
}

/** @type {Record<string, FloraKind>} */
export const FLORA_KINDS = {
  reeds: {
    shader: 'flora-draw', vs: 'vsFlora', fs: 'fsFlora',
    vertices: (r) => 21 * Math.ceil(r.shape.stemsPerClump[1]),
    pack(r, f) {
      const S = r.shape, L = r.look, W = r.wind;
      f[7] = L.wetDarken;
      f.set(r.season.albedo.winter, 8); f[11] = L.dormantLean;
      f.set(r.season.seedHead, 12); f[15] = L.headShare;
      f.set([S.stemsPerClump[0], S.stemsPerClump[1], S.clumpRadius, S.maxHeight], 16);
      f.set([S.stemWidth, S.leanDeg * DEG, S.seedHead.length, S.seedHead.width], 20);
      f.set([W.stiffness, W.sway, 1 / L.gustM, L.gustSpeed], 24);
      f.set([L.heightVar, L.headGapM, L.pixelWidth, L.rootShade], 28);
      f.set([L.sinkM, L.edgeShorter, (r.seed >>> 0) % 100000, L.radiusMin], 32);
      f[36] = L.sproutM; f[37] = L.seedShoots;
    },
    frame(r, f, u) {
      f[0] = Math.cos(u.windDir); f[1] = -Math.sin(u.windDir);
      f[2] = u.time % 3600; f[3] = Math.min(1, Math.max(0, u.wind));
      f.set(seasonBlend(r.season.albedo, u.season), 4);
    },
  },

  lilies: {
    shader: 'flora-lilies', vs: 'vsLily', fs: 'fsLily',
    // Pads of 36 vertices (at most 12), then flowers of 90.
    vertices: (r) => 36 * Math.min(12, r.shape.padsPerPlant[1]) + 90 * r.shape.flowersPerPlant,
    pack(r, f) {
      const S = r.shape, L = r.look, C = r.season;
      f.set([S.padsPerPlant[0], S.padsPerPlant[1], S.spreadRadius, S.padRadius], 12);
      f.set([S.padVar, S.notchDeg * DEG, L.lift, L.radiusMin], 16);
      f.set([L.sproutPads, L.dormantPads, L.dormantSize, L.flowerShare], 20);
      f.set([S.petals, S.flowerRadius, S.cup, S.heartShare], 24);
      f.set(C.young, 28); f[31] = C.youngShare;
      f.set(C.flower, 32); f[35] = C.roughness;
      f.set(C.heart, 36); f[39] = C.f0;
      f.set([r.wind.bob, r.wind.turnDeg * DEG, S.flowersPerPlant, r.wind.swingM], 40);
    },
    frame(r, f, u) {
      common(r, f, u);
      // Pads frogs sit on (S6b-3), at most four: plant hash number, pad, dip (m), bearing to the frog.
      for (let k = 0; k < 4; k++) {
        const q = u.pressed?.[k];
        f.set(q ? [q.u, q.pad, q.dipM, q.bearing] : [0, 0, 0, 0], 44 + k * 4);
      }
    },
  },

  iris: {
    shader: 'flora-iris', vs: 'vsIris', fs: 'fsIris',
    // Leaves of 21 vertices, then flowers of 42.
    vertices: (r) => 21 * r.shape.fansPerClump[1] * r.shape.leavesPerFan[1] + 42 * r.shape.flowersPerClump[1],
    pack(r, f) {
      const S = r.shape, L = r.look, C = r.season;
      f.set([S.fansPerClump[0], S.fansPerClump[1], S.clumpRadius, S.maxHeight], 12);
      f.set([S.leavesPerFan[0], S.leavesPerFan[1], S.leafWidth, S.fanDeg * DEG], 16);
      f.set([S.arch, S.flowersPerClump[0], S.flowersPerClump[1], S.stalkShare], 20);
      f.set([S.flowerSize, L.sproutM, L.seedLeaves, L.heightVar], 24);
      f.set([L.dormantHeight, L.sinkM, L.rootShade, C.autumnTips], 28);
      f.set(C.tipBrown, 32); f[35] = r.wind.stiffness;
      f.set(C.flower, 36); f[39] = r.wind.sway;
      f.set(C.stalk, 40); f[43] = 1 / L.gustM;
      f[44] = L.gustSpeed;
    },
    frame: common,
  },

  thrift: {
    shader: 'flora-thrift', vs: 'vsThrift', fs: 'fsThrift',
    // Blades of 3 vertices, then pompoms of 24.
    vertices: (r) => 3 * r.shape.bladesPerCushion[1] + 24 * r.shape.flowersPerCushion[1],
    pack(r, f) {
      const S = r.shape, L = r.look, C = r.season;
      f.set([S.bladesPerCushion[0], S.bladesPerCushion[1], S.cushionRadius, S.cushionHeight], 12);
      f.set([S.bladeWidth, S.flowersPerCushion[0], S.flowersPerCushion[1], S.stalkHeight], 16);
      f.set([S.stalkWidth, S.headRadius, L.sproutM, L.seedBlades], 20);
      f.set([L.heightVar, L.radiusMin, L.rootShade, r.wind.sway], 24);
      f.set(C.flower, 28); f[31] = 1 / L.gustM;
      f.set(C.stalk, 32); f[35] = L.gustSpeed;
    },
    frame: common,
  },
};

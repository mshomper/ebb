// @ts-check
// How each flora species is drawn (docs 10, 14): its shader, how many vertices one plant takes,
// and how its recipe packs into the draw buffer the shader reads. Used by the flora pass
// (flora.js). Reeds keep the S5b-1 layout of flora-draw.wgsl; the other species share the
// FloraCommon header of lib-flora.wgsl (wind, season albedo and wet darkening, season position,
// seed, pixel width floor) and add their own vec4fs from float 12 on.

const DEG = Math.PI / 180;
const SEASONS = /** @type {const} */ (['spring', 'summer', 'autumn', 'winter']);
/** A thrift-drawn head's form (flora-thrift.wgsl form.x). @type {Record<string, number>} */
const HEAD_FORMS = { ball: 0, flat: 1, daisy: 2 };

/**
 * @typedef {Object} FloraKind
 * @property {string} shader      file in src/shaders without extension
 * @property {string} vs          vertex entry point
 * @property {string} fs          fragment entry point
 * @property {(r: any) => number} vertices  vertices one plant may need
 * @property {{ vs: string, fs: string, vertices: (r: any) => number }} [shadow]  a soft contact shadow under each
 *   plant, drawn before the plants with a multiplying blend (shrubs)
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
  return a.map((v, i) => v + (b[i] - v) * k);
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
    // Leaves of 21 vertices, then flowers of 42 (flag) or 81 (cup).
    vertices: (r) => 21 * r.shape.fansPerClump[1] * r.shape.leavesPerFan[1] + (r.shape.flower === 'cup' ? 81 : 42) * r.shape.flowersPerClump[1],
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
      // The flower and leaf shapes (marsh marigold: a glossy cup and kidney leaves; iris: flag, sword).
      const G = r.gloss ?? {}, U = S.cup ?? {};
      f.set([L.gustSpeed, S.flower === 'cup' ? 1 : 0, S.leaf === 'kidney' ? 1 : 0, 0], 44);
      f.set([G.petalRoughness ?? 0, G.leafRoughness ?? 0, G.f0 ?? 0.04, 0], 48);
      f.set([(U.riseDeg ?? 45) * DEG, U.curl ?? 0, U.widthShare ?? 0.9, U.lengthShare ?? 0.5], 52);
    },
    frame: common,
  },

  // Curled pondweed (M2, the minnows' gift): stems under the water, each a strip of 36 vertices and
  // up to 18 leaves of 6 (flora-pondweed.wgsl BLOCK).
  pondweed: {
    shader: 'flora-pondweed', vs: 'vsWeed', fs: 'fsWeed',
    vertices: (r) => Math.ceil(r.shape.stemsPerPlant[1]) * (36 + 6 * 18),
    pack(r, f) {
      const S = r.shape, L = r.look, C = r.season, W = r.wind;
      f.set([S.stemsPerPlant[0], S.stemsPerPlant[1], S.spreadRadius, S.maxLengthM], 12);
      f.set([S.topClearM, S.stemWidth, S.leafGapM, S.leafLength], 16);
      f.set([S.leafWidth, S.leafTwistDeg * DEG, S.waves, 18], 20);
      f.set([L.rootShade, L.sproutM, L.seedStems, L.dormantStems], 24);
      f.set([L.dormantShare, L.radiusMin, W.swayM, W.swayHz], 28);
      f.set([C.stemShade, C.tipLight, C.roughness, S.leanM ?? 0.15], 32);
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
      // The head's form and the winter crown (P2b; thrift and campion keep the ball and stay green).
      const H = S.head ?? {}, W = r.crown;
      f.set([HEAD_FORMS[H.form] ?? 0, H.dome ?? 0, W ? 1 : 0, H.heartShare ?? 0], 36);
      f.set(C.heart ?? [0, 0, 0], 40); f[43] = H.petals ?? 0;
      f.set(W?.albedo ?? [0, 0, 0], 44); f[47] = W?.heightShare ?? 1;
    },
    frame: common,
  },

  // Shrubs (grey willow, and gorse with other numbers and flowers among its needles): stems of 60 vertices (a stem of four
  // segments and two forks of three), then cards of 6 on each stem and fork. The contact shadow is
  // a few stacked, draped discs of 144 vertices, drawn first with a multiplying blend.
  shrub: {
    shader: 'flora-shrub', vs: 'vsShrub', fs: 'fsShrub',
    vertices: (r) => 60 * r.shape.stemsPerShrub[1] + 18 * r.shape.stemsPerShrub[1] * r.shape.cardsPerBranch,
    shadow: { vs: 'vsShrubShadow', fs: 'fsShrubShadow', vertices: (r) => 144 * Math.max(1, r.contactShadow?.layers ?? 1) },
    pack(r, f) {
      const S = r.shape, L = r.look, C = r.season, W = r.wind, P = r.phenology ?? {}, D = r.contactShadow ?? {};
      const out = P.leafOut ?? [-1, -1], fall = P.leafFall ?? [-1, -1];
      f.set([S.stemsPerShrub[0], S.stemsPerShrub[1], S.maxHeight, S.crownRadius], 12);
      f.set([S.clumpRadius, S.stemWidth, S.twigWidth, S.leanShare], 16);
      f.set([S.forks[0], S.forks[1], S.forkDeg * DEG, S.arch], 20);
      f.set([S.forkAt[0], S.forkAt[1], L.heightVar, L.crownMiddle], 24);
      f.set([S.cardsPerBranch, S.cardM, S.leafM, S.leafWidth], 28);
      f.set([S.leafGrid, S.catkinsPerCard ?? 0, S.catkinM ?? 0.02, L.sproutM], 32);
      f.set([out[0], out[1], fall[0], fall[1]], 36);
      f.set([r.flowering?.[0] ?? 0, r.flowering?.[1] ?? 0, P.maleShare ?? 1, L.rootShade], 40);
      f.set(C.bark, 44); f[47] = L.innerShade;
      f.set(C.twig, 48); f[51] = W.stiffness;
      f.set(C.catkin ?? C.twig, 52); f[55] = W.sway;
      f.set(C.pollen ?? C.twig, 56); f[59] = W.flutter;
      f.set(C.female ?? C.pollen ?? C.twig, 60); f[63] = L.gustSpeed;
      f.set([1 / L.gustM, D.strength ?? 0, D.radiusShare ?? 1, D.bareShare ?? 1], 64);
      f.set([D.sunShift ?? 0, D.liftM ?? 0.03, L.undersideShare ?? 0, 0], 68);
      // z: the per-plant phenology jitter in seasons (14 game days each), as world/growth/phenology.js reads it.
      f.set([Math.max(1, D.layers ?? 1), D.layerM ?? 0, (P.jitterDays ?? 0) / 14, 0], 72);
      // Flowers among the leaves (gorse; none on willow) and how far cards are drawn to the crown.
      f.set(C.flower ?? [0, 0, 0], 76); f[79] = S.flowerM ?? 0;
      f.set([0, L.crownPull ?? 0.3, 0, 0], 80);
    },
    frame(r, f, u) {
      common(r, f, u);
      // This season's share of leaf cells in flower, blended through the year as the albedo is.
      const F = r.season.flowerShare;
      f[80] = F ? Math.max(0, seasonBlend(F, u.season)[0]) : 0;
    },
  },
};

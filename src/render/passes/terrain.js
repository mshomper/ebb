// @ts-check
// Opaque pass for M1: the heightfield terrain (one LOD'd grid mesh per open chunk) into the HDR
// target (docs/04, 08). The sea is the water pass's (passes/water.js). Reads the terrain's GPU
// textures; never changes them.

import { makeBuffer, makeShaderModule } from '../../core/gpu.js';
import { CHUNK_SIZE, CHUNK_MIN } from '../../world/terrain/grid.js';
import { LODS, MAX_CHUNKS, createIndexBuffers, packChunks } from '../terrain-mesh.js';
import { tideParams } from '../../world/tide.js';
import { strandLines } from '../../world/water/strandline.js';

/** @typedef {import('../frame-graph.js').PassContext} PassContext */

const DRAW_BYTES = 1424;  // 384 of look, 16 marker rings (floats 96..159), the drowned meadow (160..167), wet-to-dry grass (168..175), the shore (176..195), the strandline and kelp (196..235), wrack fronds (236..251), lugworm casts (252..323), the Cliff level line (324..327), the drying margin (328..343), the camp pad (344..355)
const GROUND_BYTES = 336;
const DEG = Math.PI / 180;
/** @type {Record<string, number>} GroundDetail.tiling.x in lib-ground.wgsl */
const TILING_MODES = { grid: 0, hex: 1, two: 2 };
/** The tier's cliff full-detail distance (m); `?cliffdetail=0` turns it off for side-by-side checks. @param {number | undefined} m */
const cliffDistance = (m) => (new URLSearchParams(location.search).get('cliffdetail') === '0' ? 0 : m ?? 45);

/**
 * @param {{ terrain: import('../../world/terrain/index.js').Terrain, recipe: any, seed: number,
 *   getEye: () => ArrayLike<number>, tier: string, getTide?: () => number, getHours?: () => number, lodDistances?: number[], cliffDetailM?: number,
 *   water: { depthTextures: GPUTexture[], current: () => number, damp?: GPUTexture, dampWet?: number, vel: GPUTexture, caustics: any, tide?: any },
 *   moss: GPUTexture, causticLayers?: number, wetness: { textures: GPUTexture[], current: () => number },
 *   ground: { views: { a: GPUTextureView, b: GPUTextureView }, sampler: GPUSampler, version: number, fade: number },
 *   groundTier: any, probe: { view: GPUTextureView, sampler: GPUSampler }, rings?: any, cover: GPUTexture,
 *   shore: { texture: GPUTexture, look: any } }} opts
 *   ground: src/render/ground-detail.js; groundTier: the tier's `ground` block;
 *   water.caustics: water.json `caustics`; causticLayers: the tier's (0 off, default 2);
 *   wetness: src/world/terrain/wetness.js (water.damp and water.dampWet now feed it, not this pass);
 *   probe: the sky probe (atmosphere.probeView, probeSampler), reflected by wet ground and puddles;
 *   rings: water.json `ripples.rings`, the raindrop rings drawn in puddles; cover: the growth step's
 *   plant cover (world/growth coverTex), whose b channel tints the grass layer wet to dry; shore: the
 *   shore cover (world/water/shore-live.js) and shore.json `look`
 */
export function createTerrainPass(opts) {
  const { terrain, recipe } = opts;
  const tideP = tideParams(opts.water.tide);
  /** @type {GPURenderPipeline} */ let landPipeline;
  /** @type {GPUBindGroup[][]} groups[water depth index][wetness index] */ let groups = [];
  /** @type {GPUBuffer} */ let drawBuffer;
  /** @type {GPUBuffer} */ let chunkBuffer;
  /** @type {{ buffer: GPUBuffer, count: number }[]} */ let indexBuffers = [];
  const draw = new ArrayBuffer(DRAW_BYTES);
  const f = new Float32Array(draw);
  const u = new Uint32Array(draw);
  const chunkData = new Float32Array(MAX_CHUNKS * 4);
  const maxQuads = opts.tier === 'low' ? recipe.render.lowTierMaxQuads : LODS[0];
  /** Mesh LOD switch distances (m): the tier's, else the terrain recipe's. @type {number[]} */
  let lodDistances = opts.lodDistances ?? recipe.render.lodDistances;
  /** Cliff chunks closer than this (m) draw at full detail: the tier's cliffDetailM. */
  let cliffDetailM = cliffDistance(opts.cliffDetailM);
  // Caustic layers on underwater ground, per tier; `?caustics=0` turns them off for side-by-side checks.
  const causticsOff = new URLSearchParams(location.search).get('caustics') === '0' || !opts.water.caustics;
  /** @param {number | undefined} n */
  const causticLayers = (n) => (causticsOff ? 0 : n ?? 2);
  /** @type {GPUBuffer} */ let groundBuffer;
  /** @type {() => void} */ let makeGroup = () => {};
  let groundVersion = -1;
  // GroundDetail uniform (lib-ground.wgsl): per-layer params, then the shared settings.
  const gf = new Float32Array(GROUND_BYTES / 4);
  {
    const d = recipe.detail;
    ['grass', 'sand', 'rock', 'soil'].forEach((id, i) => {
      const l = d.layers[id];
      gf.set([l.heightAmplitudeM, l.normalStrength, l.roughness[0], l.roughness[1]], i * 4);
    });
    gf[16] = 0; gf[17] = d.heightInfluence; gf[18] = d.blendDepth; gf[19] = 0;
    gf[20] = d.sunTerminator[0]; gf[21] = d.sunTerminator[1]; gf[22] = d.f0; gf[23] = opts.groundTier.detailFadeMeters;
    gf[24] = opts.groundTier.specular === 'full' ? 2 : opts.groundTier.specular === 'sun' ? 1 : 0;
    // Cliff projection (triplanar) on steep slopes, per tier; cos of the from and full slope angles.
    gf[25] = opts.groundTier.triplanar ? 1 : 0;
    gf[26] = Math.cos(d.steepDeg[0] * DEG); gf[27] = Math.cos(d.steepDeg[1] * DEG);
    // Each material repeats at its own tile size (rock finer than grass and sand).
    ['grass', 'sand', 'rock', 'soil'].forEach((id, i) => { gf[28 + i] = 1 / (d.layers[id].tileMeters ?? d.tileMeters); });
    // Repeat hiding (G2): hex tiling on desktop tiers, the two-scale mix on low. `?tiling=grid|hex|two`
    // forces one for side-by-side checks.
    const forced = new URLSearchParams(location.search).get('tiling');
    const mode = forced ? (TILING_MODES[forced] ?? 1) : opts.groundTier.hexTiling ? 1 : 2;
    gf[32] = mode; gf[33] = d.hex.density; gf[34] = d.hex.sharpness; gf[35] = d.twoScale.size;
    gf[36] = 1 / d.macro.scalesM[0]; gf[37] = 1 / d.macro.scalesM[1]; gf[38] = d.macro.strength; gf[39] = d.macro.hue;
    gf[40] = d.macro.second; gf[41] = 1 / d.twoScale.noiseMeters;
    // Moss, the fifth layer: its detail parameters, tile size and flat albedo for the far look.
    const ml = d.layers.moss;
    gf.set([ml.heightAmplitudeM, ml.normalStrength, ml.roughness[0], ml.roughness[1]], 44);
    gf[48] = 1 / (ml.tileMeters ?? d.tileMeters);
    gf.set(recipe.materials.albedoMoss, 49);
    const cap = recipe.moss.maxCover;
    gf.set([cap.grass, cap.sand, cap.rock, cap.soil], 52);
    // Porosity per material (G3 wet look), from the detail layers.
    gf.set(['grass', 'sand', 'rock', 'soil'].map((id) => d.layers[id].porosity), 56);
    gf[60] = d.layers.moss.porosity;
    // Cliff rock (G4), layer 5: rock's scan for steep faces.
    const cl = d.layers.cliff;
    gf.set([cl.heightAmplitudeM, cl.normalStrength, cl.roughness[0], cl.roughness[1]], 64);
    gf[68] = 1 / (cl.tileMeters ?? d.tileMeters);
    // Drifting grain (G4): angle field, jitter and scale jitter, then each layer's share.
    const G = d.grain;
    gf[72] = G.spreadDeg * DEG; gf[73] = 1 / G.fieldM; gf[74] = G.jitterDeg * DEG; gf[75] = G.scaleJitter;
    gf.set(['grass', 'sand', 'rock', 'soil'].map((id) => G.layers[id] ?? 0), 76);
    gf[80] = G.layers.moss ?? 0; gf[81] = G.layers.cliff ?? 0;
  }

  function packStatic() {
    const m = recipe.materials;
    f.set(m.albedoGrass, 0); f[3] = m.variation;
    f.set(m.albedoSand, 4); f[7] = m.variationScale;
    f.set(m.albedoRock, 8); f[11] = m.blendSharpness;
    f.set(m.albedoSoil, 12); f[15] = m.wetDarkening;
    f.set(recipe.sea.albedo, 16); f[19] = recipe.sea.specular;
    f.set(recipe.ring.color, 20); f[23] = recipe.ring.opacity;
    f[29] = recipe.ring.width;
    f[30] = Math.cos((recipe.steepRockDeg - recipe.steepRockSoftDeg) * DEG);
    f[31] = Math.cos((recipe.steepRockDeg + recipe.steepRockSoftDeg) * DEG);
    f[32] = recipe.beachBand[0]; f[33] = recipe.beachBand[1];
    f[34] = recipe.render.skirtDepth; f[35] = recipe.sea.extent;
    f[36] = recipe.sea.shallowDepth; u[37] = opts.seed >>> 0;
    const uw = recipe.underwater;
    f.set(m.albedoSilt, 40); f[43] = uw.siltCover;
    f[44] = uw.bedDepthM[0]; f[45] = uw.bedDepthM[1]; f[46] = uw.siltDepthM[0]; f[47] = uw.siltDepthM[1];
    // The drowned meadow (floats 160..167): olive weed over a grassy bed under shallow, still water.
    const dm = uw.drownedMeadow;
    if (dm) {
      f.set(dm.albedo, 160); f[163] = dm.cover;
      f[164] = dm.depthM[0]; f[165] = dm.depthM[1]; f[166] = dm.stillMps[0]; f[167] = dm.stillMps[1];
    }
    // The shore (floats 176..195, shore.json `look`): wrack on the moss scan at its own albedo,
    // lichen and mud as albedo factors, ripples drawn in the shader (off on the tiers listed).
    const S = opts.shore.look;
    for (let i = 0; i < 3; i++) f[176 + i] = S.wrackAlbedo[i] / m.albedoMoss[i];
    f[179] = 1 / S.wrackClumpM[0]; f[180] = 1 / S.wrackClumpM[1];
    f.set(S.lichenAlbedo, 181);
    f[184] = 1 / S.lichenClumpM[0]; f[185] = 1 / S.lichenClumpM[1]; f[186] = S.mudWet;
    const R = S.ripple;
    f[188] = (2 * Math.PI) / R.wavelengthM; f[189] = R.slope; f[190] = (R.offTiers ?? []).includes(opts.tier) ? 0 : 1; f[191] = R.wavelengthM;
    f.set(S.mudAlbedo, 192); f[195] = 1 / R.warpM;
    // The strandline's litter and the kelp (floats 212..235); the lines themselves follow the
    // tide each frame (record).
    const L = S.strandline, K = S.kelp;
    f[212] = L.runupM; f[213] = L.halfWidthM; f[214] = (L.offTiers ?? []).includes(opts.tier) ? 0 : 1; f[215] = L.density;
    f[216] = L.strand.cellM; f[217] = L.strand.lengthM[0]; f[218] = L.strand.lengthM[1]; f[219] = L.strand.widthM;
    f.set(L.strand.albedo, 220); f[223] = L.strand.crossShare;
    f.set(K.albedo, 224); f[227] = K.widthM;
    f[228] = K.cellM[0]; f[229] = K.cellM[1]; f[230] = K.lengthM[0]; f[231] = K.lengthM[1];
    f[232] = K.relief; f[233] = L.kelpShare;
    // Wrack fronds (floats 236..251), drawn close up over the wrack mat; off on the tiers listed.
    const FR = S.fronds;
    f.set(FR.albedo, 236); f[239] = FR.widthM;
    f[240] = FR.cellM[0]; f[241] = FR.cellM[1]; f[242] = FR.lengthM[0]; f[243] = FR.lengthM[1];
    f[244] = FR.bladderM; f[245] = FR.relief; f[246] = FR.fadeM[0]; f[247] = FR.fadeM[1];
    f[248] = (FR.offTiers ?? []).includes(opts.tier) ? 0 : 1; f[249] = FR.hideMat; f[250] = FR.bladderTone;
    // Caustics (lib-caustics.wgsl), floats 48..75: look, depthFade, wave0..2, motion, misc.
    const c = opts.water.caustics;
    f[49] = causticLayers(opts.causticLayers);
    if (!c) return;
    f[48] = c.strength; f[50] = c.peakM; f[51] = c.shallowContrast;
    f[52] = c.fadeInM[0]; f[53] = c.fadeInM[1]; f[54] = c.fadeOutM[0]; f[55] = c.fadeOutM[1];
    const W = c.waves;
    f.set([W.count, W.wavelengthM[0], W.wavelengthM[1], W.slope], 56);
    f[60] = W.speedShare; f[61] = W.directionJitterDeg * DEG;
    f[68] = c.focusGain; f[69] = c.flowDrift; f[70] = c.flowPeriodS; f[71] = c.projection;
    f[72] = c.softFloor; f[73] = c.softPerM; f[74] = c.minFinestPx;
  }

  /** Wet ground (G3, terrain.json wetGround), floats 76..95: damp look, puddles, raindrop rings. */
  function packWet() {
    const g = recipe.wetGround;
    f[76] = g.damp.roughness[0]; f[77] = g.damp.roughness[1]; f[78] = g.damp.albedo[0]; f[79] = g.damp.albedo[1];
    const P = g.puddles;
    f[80] = Math.cos(P.flatDeg[1] * DEG); f[81] = Math.cos(P.flatDeg[0] * DEG);
    f[82] = 1 / P.undulationM; f[83] = P.undulationShare;
    f[84] = P.roughness; f[85] = P.albedo; f[86] = P.maxCover; f[87] = P.f0; f[39] = P.turf;
    // Raindrop rings (water.json ripples.rings); f[88] follows the rain (setRain).
    const RR = opts.rings;
    if (RR) { f[89] = RR.cellM; f[90] = RR.lifeS; f[91] = RR.crestM; f[92] = RR.radiusM; f[93] = RR.slope; }
    // The drying margin (A8, terrain.json wetness.dryingMargin), floats 328..343.
    const M = recipe.wetness.dryingMargin;
    if (M) {
      f.set(M.albedo, 328); f[331] = M.cover;
      f[332] = M.dampShare[0]; f[333] = M.dampShare[1]; f[334] = M.crackShare[0]; f[335] = M.crackShare[1];
      f[336] = 1 / M.crackCellM; f[337] = M.crackWidthM; f[338] = M.crackDark; f[339] = M.crackRelief;
      f[340] = M.fadeShare; f[341] = M.porosity; f[342] = 1;
    }
  }

  return {
    name: 'opaque',

    /**
     * Apply a quality tier's distances without rebuilding (the startup probe may step down).
     * @param {{ lodDistances?: number[], cliffDetailM?: number, ground: { detailFadeMeters: number }, causticLayers?: number, name?: string }} t
     *   name: the tier's name (the shore's ripples are off on some)
     */
    /** Rain now, 0..1: how many raindrop rings fall in puddles. @param {number} r */
    setRain(r) { f[88] = Math.min(1, Math.max(0, r)) * (opts.rings?.maxShare ?? 0); },

    /**
     * Wet-to-dry grass this season (src/world/growth/lush.js lushLook): the ground's grass layer
     * takes the same tint as the blades, as a share of the season's grass albedo, so the wet rings
     * and the dry rise still read past where blades end. @param {ReturnType<typeof import('../../world/growth/lush.js').lushLook> | null} L
     */
    setLush(L) {
      if (!L) { f[175] = 0; return; }
      for (let i = 0; i < 3; i++) { f[168 + i] = L.dry[i] / L.base[i]; f[172 + i] = L.wet[i] / L.base[i]; }
      f[171] = L.mid; f[175] = 1;
    },

    /**
     * Marker rings on the ground (the Plant tool): up to 16 of (x, z, radius m, opacity 0..1),
     * the list ending at the first opacity of 0. A negative radius draws the ring dashed (the camp
     * pad's edge, CP-01), with the dash, gap and width from setCampPad. @param {Float32Array} marks 64 floats
     */
    setMarks(marks) { f.set(marks.subarray(0, 64), 96); },

    /**
     * The keeper's camp pad (store slice `campPad`, src/world/camp/layout.js), floats 344..355:
     * its trodden look (CP-02), drawn analytically from the pad, and its dashed edge's pattern (CP-01).
     * Null (an older island before its pad is stamped) clears the wear.
     * The ground texture's a channel ("path wear", heightfield.js) stays free for the desire paths (CP-10).
     * @param {import('../../world/camp/layout.js').Pad | null} pad
     */
    setCampPad(pad) {
      f.fill(0, 344, 356);
      if (!pad) return;
      f[344] = pad.x; f[345] = pad.z; f[346] = pad.r; f[347] = pad.wear ?? 0;
      const look = pad.camp?.wearLook ?? {};
      f[348] = pad.edgeWearM ?? 1; f[349] = look.albedoLift ?? 1; f[350] = look.dry ?? 0; f[351] = look.mossKeep ?? 1;
      const D = pad.dash ?? {};
      f[352] = D.dashM ?? 0.35; f[353] = D.gapM ?? 0.25; f[354] = D.widthM ?? 0.06;
    },

    /**
     * Lugworm casts near the view (world/finds/index.js): up to 16 of (x, z, size, yaw), the list
     * ending at the first size of 0, and their shape (finds.json lugworm.cast) once.
     * @param {Float32Array} casts 64 floats @param {any} [shape]
     */
    setCasts(casts, shape) {
      f.set(casts.subarray(0, 64), 252);
      if (shape) {
        f[316] = shape.radiusM; f[317] = shape.tubeM; f[318] = shape.turns; f[319] = shape.riseM;
        f.set(shape.albedo, 320); f[323] = shape.drawM;
      }
    },

    setTier(t) {
      lodDistances = t.lodDistances ?? recipe.render.lodDistances;
      cliffDetailM = cliffDistance(t.cliffDetailM);
      if (t.name) {
        f[190] = (opts.shore.look.ripple.offTiers ?? []).includes(t.name) ? 0 : 1;
        f[214] = (opts.shore.look.strandline.offTiers ?? []).includes(t.name) ? 0 : 1;
        f[248] = (opts.shore.look.fronds.offTiers ?? []).includes(t.name) ? 0 : 1;
      }
      gf[23] = t.ground.detailFadeMeters;
      f[49] = causticLayers(t.causticLayers);
    },
    reads: [],
    writes: ['hdr', 'depth'],
    enabled: () => true,

    /** @param {PassContext} ctx */
    async setup(ctx) {
      const { device } = ctx;
      const module = await makeShaderModule(device, 'terrain-draw');
      const layout2 = device.createBindGroupLayout({
        label: 'terrain-draw',
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: {} },
          { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
          { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
          { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
          { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
          { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
          { binding: 7, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
          { binding: 8, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
          { binding: 9, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
          { binding: 10, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }, // visual wetness
          { binding: 11, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
          { binding: 12, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
          { binding: 13, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: 'cube' } },
          { binding: 14, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
          { binding: 15, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }, // plant cover (b: lush)
          { binding: 16, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }, // shore cover
        ],
      });
      const layout = device.createPipelineLayout({ label: 'opaque', bindGroupLayouts: [ctx.layouts.frame, ctx.layouts.lighting, layout2] });
      /** @param {string} vs @param {string} fs */
      const make = (vs, fs) => device.createRenderPipelineAsync({
        label: `opaque-${vs}`,
        layout,
        vertex: { module, entryPoint: vs },
        fragment: { module, entryPoint: fs, targets: [{ format: 'rgba16float' }, { format: 'rgb10a2unorm' }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
      });
      landPipeline = await make('vsLand', 'fsLand');

      drawBuffer = makeBuffer(device, { label: 'terrain-draw', size: DRAW_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      chunkBuffer = makeBuffer(device, { label: 'terrain-chunks', size: MAX_CHUNKS * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      indexBuffers = createIndexBuffers(device);

      const sampler = device.createSampler({ label: 'terrain-linear', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
      groundBuffer = makeBuffer(device, { label: 'ground-detail', size: GROUND_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      // Rebuilt whenever the ground detail arrays are replaced (placeholder, then the loaded set).
      makeGroup = () => {
        // One group per pair of water depth and wetness textures (both ping-pong).
        const heightView = terrain.gpu.height.createView();
        const materialView = terrain.gpu.material.createView();
        const mossView = opts.moss.createView();
        const velView = opts.water.vel.createView();
        const coverView = opts.cover.createView();
        const shoreView = opts.shore.texture.createView();
        const wetViews = opts.wetness.textures.map((t) => t.createView());
        groups = opts.water.depthTextures.map((/** @type {GPUTexture} */ wt) => {
          const depthView = wt.createView();
          return wetViews.map((wetView) => device.createBindGroup({
            label: 'terrain-draw',
            layout: layout2,
            entries: [
              { binding: 0, resource: { buffer: drawBuffer } },
              { binding: 1, resource: { buffer: chunkBuffer } },
              { binding: 2, resource: heightView },
              { binding: 3, resource: materialView },
              { binding: 4, resource: sampler },
              { binding: 5, resource: opts.ground.views.a },
              { binding: 6, resource: opts.ground.views.b },
              { binding: 7, resource: opts.ground.sampler },
              { binding: 8, resource: { buffer: groundBuffer } },
              { binding: 9, resource: depthView },
              { binding: 10, resource: wetView },
              { binding: 11, resource: mossView },
              { binding: 12, resource: velView },
              { binding: 13, resource: opts.probe.view },
              { binding: 14, resource: opts.probe.sampler },
              { binding: 15, resource: coverView },
              { binding: 16, resource: shoreView },
            ],
          }));
        });
        groundVersion = opts.ground.version;
      };
      makeGroup();
      packStatic();
      packWet();
    },

    resize() {},

    /** @param {GPUCommandEncoder} encoder @param {PassContext} ctx */
    record(encoder, ctx) {
      const { device } = ctx;
      const ring = terrain.ring;
      f[24] = ring.x; f[25] = ring.z; f[26] = ring.radius; f[27] = ring.hardness; f[28] = ring.visible ? 1 : 0;
      // Terrace and Cut: the line where the ground meets the shelf's level (floats 324..327).
      f[324] = ring.level ?? 0; f[325] = ring.visible && ring.level !== null ? 1 : 0; f[326] = recipe.cliff.levelLineWidthM;
      f[38] = opts.getTide?.() ?? 0;
      // The strandline: the lines the last high tides left (floats 196..211), newest first.
      if (opts.getHours) {
        const sl = strandLines(opts.getHours(), tideP, opts.shore.look.strandline);
        for (let i = 0; i < 8; i++) { f[196 + i] = sl.levels[i] ?? 0; f[204 + i] = sl.strengths[i] ?? 0; }
      }
      device.queue.writeBuffer(drawBuffer, 0, draw);
      if (opts.ground.version !== groundVersion) makeGroup();
      gf[19] = opts.ground.fade;
      device.queue.writeBuffer(groundBuffer, 0, gf);

      // Pick a LOD per open chunk by distance from the eye, grouped so each LOD is one draw.
      const eye = opts.getEye();
      /** @type {number[][]} */ const byLod = [[], [], []];
      for (let cz = CHUNK_MIN; cz < CHUNK_MIN + 6; cz++) {
        for (let cx = CHUNK_MIN; cx < CHUNK_MIN + 6; cx++) {
          if (terrain.chunkState(cx, cz) !== 'open') continue;
          const d = Math.hypot(eye[0] - cx * CHUNK_SIZE, eye[1] - 2, eye[2] - cz * CHUNK_SIZE) - CHUNK_SIZE * 0.5;
          let lod = d < lodDistances[0] ? 0 : d < lodDistances[1] ? 1 : 2;
          while (LODS[lod] > maxQuads && lod < 2) lod++;
          // A chunk holding a cliff face keeps full detail near the camera, on every tier, so
          // walls never go soft or jagged (docs/19).
          if (d < cliffDetailM && terrain.cliffs.has(cx, cz)) lod = 0;
          byLod[lod].push(cx, cz);
        }
      }
      const draws = packChunks(chunkData, byLod);
      device.queue.writeBuffer(chunkBuffer, 0, chunkData);


      const pass = encoder.beginRenderPass({
        label: 'opaque',
        colorAttachments: [
          { view: ctx.targets.hdr.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
          { view: ctx.targets.normalId.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0.5, 0.5, 0, 0] },
        ],
        depthStencilAttachment: { view: ctx.targets.depth.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 0 },
        timestampWrites: ctx.timestampWrites('opaque'),
      });
      pass.setBindGroup(0, ctx.groups.frame);
      pass.setBindGroup(1, ctx.groups.lighting);
      pass.setBindGroup(2, groups[opts.water.current()][opts.wetness.current()]);
      pass.setPipeline(landPipeline);
      for (const d of draws) {
        const ib = indexBuffers[d.lod];
        pass.setIndexBuffer(ib.buffer, 'uint16');
        pass.drawIndexed(ib.count, d.count, 0, 0, d.first);
      }
      pass.end();
    },
  };
}

// Terrain and sea in the opaque pass (docs/04, 08).
// Land: one grid mesh per open chunk, LOD 128/64/32 quads a side, with skirts that hide cracks
// between LODs; heights come from the height texture in the vertex shader. Materials blend by
// weight with a little height-style sharpening; steep slopes turn to rock and the shore band to sand.
// Lighting is physical (lib-lighting: sun and moon with shadows, sky SH fill, aerial perspective);
// no palette colors here (docs/05). Water and the sea are drawn by the water pass (water-draw.wgsl);
// the bed under them gets its caustics here, where the live water depth is already read.

// #include common
// #include lib-hash
// #include lighting-bindings
// #include lib-sky
// #include lib-terrain
// #include lib-lighting
// #include lib-ground
// #include lib-water
// #include lib-caustics

struct TerrainDraw {
  albedoGrass: vec3f, variation: f32,
  albedoSand: vec3f, variationScale: f32,
  albedoRock: vec3f, blendSharpness: f32,
  albedoSoil: vec3f, wetDarkening: f32,
  albedoSea: vec3f, seaSpecular: f32,
  ringColor: vec3f, ringOpacity: f32,   // ring color is in exposed (display-referred) units: it is UI
  ringCenter: vec2f, ringRadius: f32, ringHardness: f32,
  ringVisible: f32, ringWidth: f32, steepCosLow: f32, steepCosHigh: f32,
  beachLow: f32, beachHigh: f32, skirtDepth: f32, seaExtent: f32,
  shallowDepth: f32, seed: u32, tide: f32, _p0: f32,   // tide: sea level now (m)
  albedoSilt: vec3f, siltCover: f32,    // the fine mud that settles on pond beds; most of the bed it covers
  bedDepth: vec2f, siltDepth: vec2f,    // water depths (m) over which grass gives way to a bare bed, and silt settles
  caustics: Caustics,                   // lib-caustics.wgsl
  wetLook: vec4f,                       // x roughness of soaked ground, y how far it goes there, z wetness where the sheen starts
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var<uniform> td: TerrainDraw;
@group(2) @binding(1) var<uniform> chunks: array<TerrainChunk, 36>;
@group(2) @binding(2) var heightTex: texture_2d<f32>;
@group(2) @binding(3) var materialTex: texture_2d<f32>;
@group(2) @binding(4) var linearSampler: sampler;
@group(2) @binding(5) var groundA: texture_2d_array<f32>;
@group(2) @binding(6) var groundB: texture_2d_array<f32>;
@group(2) @binding(7) var groundSampler: sampler;
@group(2) @binding(8) var<uniform> ground: GroundDetail;
@group(2) @binding(9) var waterDepth: texture_2d<f32>;   // live water depth (m), water-depth.wgsl
@group(2) @binding(10) var wetMap: texture_2d<f32>;      // visual wetness, r 0..1 (rgba8unorm, 0.25 m), terrain-wetness.wgsl
@group(2) @binding(11) var mossTex: texture_2d<f32>;     // moss cover 0..1 (r8unorm, 0.5 m), moss-live.js
@group(2) @binding(12) var waterVel: texture_2d<f32>;    // live water velocity (rg32float, m/s, x and z)

// Live water depth (m) here, bilinear between the 0.5 m cells.
fn waterDepthAt(xz: vec2f) -> f32 {
  let g = waterCellCoord(xz);
  let c = vec2i(floor(g));
  let f = g - floor(g);
  let hi = vec2i(WATER_CELLS - 1);
  let d00 = textureLoad(waterDepth, clamp(c, vec2i(0), hi), 0).r;
  let d10 = textureLoad(waterDepth, clamp(c + vec2i(1, 0), vec2i(0), hi), 0).r;
  let d01 = textureLoad(waterDepth, clamp(c + vec2i(0, 1), vec2i(0), hi), 0).r;
  let d11 = textureLoad(waterDepth, clamp(c + vec2i(1, 1), vec2i(0), hi), 0).r;
  return mix(mix(d00, d10, f.x), mix(d01, d11, f.x), f.y);
}

// Live water velocity (m/s, x and z) here, bilinear between the 0.5 m cells.
fn waterVelAt(xz: vec2f) -> vec2f {
  let g = waterCellCoord(xz);
  let c = vec2i(floor(g));
  let f = g - floor(g);
  let hi = vec2i(WATER_CELLS - 1);
  let v00 = textureLoad(waterVel, clamp(c, vec2i(0), hi), 0).rg;
  let v10 = textureLoad(waterVel, clamp(c + vec2i(1, 0), vec2i(0), hi), 0).rg;
  let v01 = textureLoad(waterVel, clamp(c + vec2i(0, 1), vec2i(0), hi), 0).rg;
  let v11 = textureLoad(waterVel, clamp(c + vec2i(1, 1), vec2i(0), hi), 0).rg;
  return mix(mix(v00, v10, f.x), mix(v01, v11, f.x), f.y);
}

// Second target (normalId, rgb10a2unorm): octahedral world normal in RG, water flag in B,
// outline group in A (0 none, 1 terrain, 2 structures and foliage, 3 creatures; docs/04, 05).
struct FsOut {
  @location(0) color: vec4f,
  @location(1) normalId: vec4f,
};

fn octEncode(n: vec3f) -> vec2f {
  var p = n.xz / (abs(n.x) + abs(n.y) + abs(n.z));
  if (n.y < 0.0) { p = (1.0 - abs(p.yx)) * select(vec2f(-1.0), vec2f(1.0), p >= vec2f(0.0)); }
  return p * 0.5 + 0.5;
}

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
};

@vertex
fn vsLand(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VsOut {
  var out: VsOut;
  out.world = terrainMeshVertex(heightTex, chunks[ii], vi, td.skirtDepth);
  out.pos = frame.viewProj * vec4f(out.world, 1.0);
  return out;
}

// Soft brush ring: an outer ring at the radius and a faint inner one where the falloff starts.
fn ringAlpha(xz: vec2f) -> f32 {
  if (td.ringVisible < 0.5) { return 0.0; }
  let d = distance(xz, td.ringCenter);
  let w = td.ringWidth * td.ringRadius + 0.03;
  let outer = 1.0 - smoothstep(0.0, w, abs(d - td.ringRadius));
  let inner = 1.0 - smoothstep(0.0, w * 0.7, abs(d - td.ringRadius * td.ringHardness));
  return clamp(outer + 0.35 * inner, 0.0, 1.0) * td.ringOpacity;
}

@fragment
fn fsLand(in: VsOut) -> FsOut {
  let xz = in.world.xz;
  let y = in.world.y;
  let fw = fwidth(xz);   // world size of this pixel, for filtering the caustic lines
  let n = terrainNormal(heightTex, xz);
  var w = textureSampleLevel(materialTex, linearSampler, terrainUv(xz), 0.0); // grass, sand, rock, soil

  // Derived layers: steep slopes show rock, the shore band shows sand (painted rock stays rock).
  let steep = 1.0 - smoothstep(td.steepCosHigh, td.steepCosLow, n.y);
  w = mix(w, vec4f(0.0, 0.0, 1.0, 0.0), steep);
  let beach = 1.0 - smoothstep(td.beachHigh - 0.15, td.beachHigh + 0.15, y);
  w = mix(w, vec4f(0.0, 1.0 - w.z, w.z, 0.0), beach);
  // Grass does not grow under water: past the first few centimeters of depth a grassy bed is bare
  // soil, so from above the waterline reads as grass giving way to the bed (sand and stone stay).
  let wdep = waterDepthAt(xz);
  let sub = smoothstep(td.bedDepth.x, td.bedDepth.y, wdep);
  w = vec4f(w.x * (1.0 - sub), w.y, w.z, w.w + w.x * sub);

  // Height-style blend: each layer gets its own noise "relief"; layers within blendSharpness
  // of the top score share the pixel, so edges break up softly instead of fading flat.
  let p = xz * td.variationScale;
  let relief = vec4f(
    valueNoise2(p, td.seed),
    valueNoise2(p * 1.7 + vec2f(13.1, 7.3), td.seed + 1u),
    valueNoise2(p * 0.9 + vec2f(3.7, 21.9), td.seed + 2u),
    valueNoise2(p * 1.3 + vec2f(29.3, 5.1), td.seed + 3u));
  let present = step(vec4f(0.004), w);
  let score = (w + (relief - 0.5) * td.blendSharpness) * present - (1.0 - present);
  let top = max(max(score.x, score.y), max(score.z, score.w));
  var wf = max(score - (top - td.blendSharpness), vec4f(0.0));
  wf /= max(wf.x + wf.y + wf.z + wf.w, 1e-4);

  var albedo = td.albedoGrass * wf.x + td.albedoSand * wf.y + td.albedoRock * wf.z + td.albedoSoil * wf.w;
  albedo *= 1.0 + td.variation * (valueNoise2(p * 3.1 + vec2f(41.0, 17.0), td.seed + 4u) - 0.5);
  // Moss (world/growth/moss-live.js) where the ground stays damp. It is a mosaic, not a carpet: a
  // soft partial cover in clumps at three scales (patches of a few meters, clumps of about a meter,
  // tufts of 20 to 30 cm), never a hard edge. More cover fills more of the clumps in.
  let mossCover = textureSampleLevel(mossTex, linearSampler, terrainUv(xz), 0.0).r;
  let clumps = valueNoise2(xz * 0.3 + vec2f(2.1, 7.7), td.seed + 11u) * 0.45
             + valueNoise2(xz * 1.0, td.seed + 9u) * 0.35
             + valueNoise2(xz * 3.6 + vec2f(5.3, 1.9), td.seed + 10u) * 0.2;
  let density = mossCover * smoothstep(0.3, 0.75, clumps + (mossCover - 0.5) * 0.35);
  // The ground caps how far moss can take over: grass competes and always shows through, damp soil
  // and stone hold the most, loose sand (painted, or the beach band) almost none. Below the cap the
  // height blend lets grass tufts and stone tops stand up through the moss.
  let cap = dot(w, ground.mossRules) / max(w.x + w.y + w.z + w.w, 1e-4);
  let moss = min(density, 1.0) * cap * (1.0 - sub);
  albedo = mix(albedo, ground.mossTile.yzw, moss);
  // Scanned detail (docs/22) takes over once loaded and near enough; the flat look stays the fallback.
  let gd = groundDetail(in.world, n, w, moss, distance(in.world, frame.cameraPos));
  albedo = mix(albedo, gd.albedo, gd.amount);
  // Silt: in deeper, quieter water fine mud settles over the soft parts of the bed (not on sand or
  // stone), in soft drifts, so a pond floor is a dark, even brown with the bed showing through.
  let soft = w.w / max(w.x + w.y + w.z + w.w, 1e-4);
  let drift = 0.75 + 0.5 * valueNoise2(xz * 0.45 + vec2f(17.3, 4.1), td.seed + 12u);
  let silt = clamp(smoothstep(td.siltDepth.x, td.siltDepth.y, wdep) * td.siltCover * soft * drift, 0.0, 1.0);
  albedo = mix(albedo, td.albedoSilt, silt);
  // Macro variation (docs/22): a slow tone drift near and far, so no repeat survives at a distance.
  albedo *= groundMacro(xz, td.seed);
  // Wet ground is darker (docs/06, 08). The visual wetness map (world/terrain/wetness.js) remembers
  // live water, the tide, rain and damp hollows, spreads into banks and dries over game time, so
  // the flats the tide just uncovered stay dark a while after the sea slides off them.
  let wet = textureSampleLevel(wetMap, linearSampler, terrainUv(xz), 0.0).r;
  // Moss is already a damp surface; its color changes less when wet than bare soil does.
  albedo *= mix(1.0, td.wetDarkening, wet * (1.0 - 0.6 * moss));
  // Freshly soaked ground has a gentle sheen, gone before the darkness is (not under water; puddles
  // and the full wet specular are step G3).
  let sheen = smoothstep(td.wetLook.z, 1.0, wet) * td.wetLook.y * (1.0 - sub);
  let roughness = mix(gd.roughness, td.wetLook.x, sheen);

  // Caustics (lib-caustics): focused sun on the bed under live water, or moon at night. They scale
  // only direct light, so they are gone in shadow and nearly so by moonlight.
  let toLight = select(frame.moonDir, frame.sunDir, frame.sunDir.y > 0.0);
  var caustic = 1.0;
  if (wdep > td.caustics.depthFade.x && toLight.y > 0.0 && td.caustics.look.y > 0.5) {
    let entry = causticEntry(xz, toLight, wdep, td.caustics.motion.w);
    caustic = causticLight(td.caustics, entry, waterVelAt(entry), wdep, max(fw.x, fw.y), frame.animTime, td.seed);
  }

  var color = shadeGround(albedo, in.world, n, gd.normal, roughness, gd.cavity, in.pos, ground.terminator, ground.f0, ground.specMode, caustic);
  color = mix(color, td.ringColor, ringAlpha(xz));
  // normalId keeps the mesh normal, so pebbles and cracks never get outlines (docs/22).
  return FsOut(vec4f(color, 1.0), vec4f(octEncode(n), 0.0, 1.0 / 3.0));
}

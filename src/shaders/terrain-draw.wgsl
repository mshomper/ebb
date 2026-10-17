// Terrain and sea in the opaque pass (docs/04, 08).
// Land: one grid mesh per open chunk, LOD 128/64/32 quads a side, with skirts that hide cracks
// between LODs; heights come from the height texture in the vertex shader. Materials blend by
// weight with a little height-style sharpening; steep slopes turn to rock and the shore band to sand.
// Lighting is physical (lib-lighting: sun and moon with shadows, sky SH fill, aerial perspective);
// no palette colors here (docs/05). Water and the sea are drawn by the water pass (water-draw.wgsl).

// #include common
// #include lib-hash
// #include lighting-bindings
// #include lib-sky
// #include lib-terrain
// #include lib-lighting
// #include lib-ground
// #include lib-water

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
  shallowDepth: f32, seed: u32, tide: f32, dampWet: f32,   // tide: sea level now (m); dampWet: damp hollow wetness
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
@group(2) @binding(10) var dampHollows: texture_2d<f32>; // the water summary's damp hollows (r8unorm, 0.5 m)
@group(2) @binding(11) var mossTex: texture_2d<f32>;     // moss cover 0..1 (r8unorm, 0.5 m), moss-live.js

// How soaked the ground is from live water nearby: 1 under water, fading out over about 0.75 m of
// bank (capillary rise). The visual wetness pass (S4c) adds drying over time and the tide flats.
fn wetFromWater(xz: vec2f) -> f32 {
  let c = vec2i(floor(waterCellCoord(xz) + 0.5));
  var w = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let q = clamp(c + vec2i(i, j), vec2i(0), vec2i(WATER_CELLS - 1));
      // A film of a few millimeters dampens; a centimeter or more soaks.
      let wd = smoothstep(0.002, 0.012, textureLoad(waterDepth, q, 0).r);
      w = max(w, wd * (1.0 - smoothstep(0.2, 0.75, distance(xz, waterCellCenter(q)))));
    }
  }
  return w;
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
  let n = terrainNormal(heightTex, xz);
  var w = textureSampleLevel(materialTex, linearSampler, terrainUv(xz), 0.0); // grass, sand, rock, soil

  // Derived layers: steep slopes show rock, the shore band shows sand (painted rock stays rock).
  let steep = 1.0 - smoothstep(td.steepCosHigh, td.steepCosLow, n.y);
  w = mix(w, vec4f(0.0, 0.0, 1.0, 0.0), steep);
  let beach = 1.0 - smoothstep(td.beachHigh - 0.15, td.beachHigh + 0.15, y);
  w = mix(w, vec4f(0.0, 1.0 - w.z, w.z, 0.0), beach);

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
  // Moss (world/growth/moss-live.js) lies over the painted layers where the ground stays damp. Its
  // edge is broken up by noise, so a patch creeps outward in lobes rather than a smooth blob.
  let mossCover = textureSampleLevel(mossTex, linearSampler, terrainUv(xz), 0.0).r;
  // Three scales: the band widens and narrows along a bank (4 m), lobes (1.4 m), small bare gaps (0.4 m).
  let mossNoise = (valueNoise2(xz * 0.25 + vec2f(2.1, 7.7), td.seed + 11u) - 0.5) * 0.6
                + (valueNoise2(xz * 0.7, td.seed + 9u) - 0.5) * 0.4
                + (valueNoise2(xz * 2.5 + vec2f(5.3, 1.9), td.seed + 10u) - 0.5) * 0.3;
  // The damp map says where moss could grow; the ground says how well. Loose sand (painted, or the
  // beach band) dries fast and shifts, so moss barely holds; damp stone holds it best (moss fills
  // the cracks first and, with more cover, climbs over the stone tops through the height blend).
  let substrate = (1.0 - ground.mossRules.x * w.y) * (1.0 + ground.mossRules.y * w.z);
  let moss = select(0.0, smoothstep(0.35, 0.65, mossCover * substrate + mossNoise), mossCover > 0.01);
  albedo = mix(albedo, ground.mossTile.yzw, moss);
  // Scanned detail (docs/22) takes over once loaded and near enough; the flat look stays the fallback.
  let gd = groundDetail(in.world, n, w, moss, distance(in.world, frame.cameraPos));
  albedo = mix(albedo, gd.albedo, gd.amount);
  // Macro variation (docs/22): a slow tone drift near and far, so no repeat survives at a distance.
  albedo *= groundMacro(xz, td.seed);
  // Wet ground is darker: below the tide line always, and everywhere while it rains (docs/06).
  // Near live water (ponds, streams) the banks are soaked too. The visual wetness pass (S4c)
  // adds drying over time, the spray line and the tide flats.
  // Damp hollows (the water summary: dips that collect water but hold no pond) stay damp, with
  // soft edges from the filtered 0.5 m map.
  let damp = textureSampleLevel(dampHollows, linearSampler, terrainUv(xz), 0.0).r * td.dampWet;
  let wet = max(max(max(1.0 - smoothstep(td.tide - 0.05, td.tide + 0.25, y), light.weather.w), wetFromWater(xz)), damp);
  // Moss is already a damp surface; its color changes less when wet than bare soil does.
  albedo *= mix(1.0, td.wetDarkening, wet * (1.0 - 0.6 * moss));

  var color = shadeGround(albedo, in.world, n, gd.normal, gd.roughness, gd.cavity, in.pos, ground.terminator, ground.f0, ground.specMode);
  color = mix(color, td.ringColor, ringAlpha(xz));
  // normalId keeps the mesh normal, so pebbles and cracks never get outlines (docs/22).
  return FsOut(vec4f(color, 1.0), vec4f(octEncode(n), 0.0, 1.0 / 3.0));
}

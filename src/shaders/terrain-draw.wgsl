// Terrain and sea in the opaque pass (docs/04, 08).
// Land: one grid mesh per open chunk, LOD 128/64/32 quads a side, with skirts that hide cracks
// between LODs; heights come from the height texture in the vertex shader. Materials blend by
// weight with a little height-style sharpening; steep slopes turn to rock and the shore band to sand.
// Lighting is physical (lux in, nits out, pre-exposed); no palette colors here (docs/05).
// The sea is still the flat M0 plane until the water step (S4).

// #include common
// #include lib-hash
// #include lib-sky-plain
// #include lib-terrain

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
  shallowDepth: f32, seed: u32, _p0: f32, _p1: f32,
};

struct Chunk {
  originCell: vec2f,  // window cell of the chunk's first vertex
  step: f32,          // cells per quad
  quads: f32,         // quads per side
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> sky: SkyPlain;
@group(2) @binding(0) var<uniform> td: TerrainDraw;
@group(2) @binding(1) var<uniform> chunks: array<Chunk, 36>;
@group(2) @binding(2) var heightTex: texture_2d<f32>;
@group(2) @binding(3) var materialTex: texture_2d<f32>;
@group(2) @binding(4) var linearSampler: sampler;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
};

@vertex
fn vsLand(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VsOut {
  let ch = chunks[ii];
  let n = u32(ch.quads);
  let row = n + 1u;
  var g: vec2u;
  var skirt = false;
  if (vi < row * row) {
    g = vec2u(vi % row, vi / row);
  } else {
    // Skirt vertices: four edges of row vertices each, dropped below the ground.
    let k = vi - row * row;
    let e = k / row;
    let t = k % row;
    skirt = true;
    if (e == 0u) { g = vec2u(t, 0u); }
    else if (e == 1u) { g = vec2u(n, t); }
    else if (e == 2u) { g = vec2u(t, n); }
    else { g = vec2u(0u, t); }
  }
  let cell = min(vec2i(ch.originCell + vec2f(g) * ch.step), vec2i(TERRAIN_CELLS - 1));
  let xz = TERRAIN_ORIGIN + (vec2f(cell) + 0.5) * TERRAIN_CELL;
  var h = terrainLoad(heightTex, cell);
  if (skirt) { h -= td.skirtDepth; }
  var out: VsOut;
  out.world = vec3f(xz.x, h, xz.y);
  out.pos = frame.viewProj * vec4f(out.world, 1.0);
  return out;
}

@vertex
fn vsSea(@builtin(vertex_index) vi: u32) -> VsOut {
  let c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0),
                          vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, 1.0))[vi];
  let xz = c * td.seaExtent * 0.5;
  var out: VsOut;
  out.world = vec3f(xz.x, 0.0, xz.y);
  out.pos = frame.viewProj * vec4f(out.world, 1.0);
  return out;
}

fn shadeDiffuse(albedo: vec3f, n: vec3f) -> vec3f {
  let sun = frame.sunIlluminance * max(dot(n, frame.sunDir), 0.0) / PI;
  return albedo * (sun + skyAmbient(sky, n));
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
fn fsLand(in: VsOut) -> @location(0) vec4f {
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
  // Wet ground below the waterline is darker (wetness proper arrives with water in S4).
  albedo *= mix(1.0, td.wetDarkening, 1.0 - smoothstep(-0.05, 0.25, y));

  var color = shadeDiffuse(albedo, n) * frame.exposure;
  color = mix(color, td.ringColor, ringAlpha(xz));
  return vec4f(color, 1.0);
}

@fragment
fn fsSea(in: VsOut) -> @location(0) vec4f {
  let v = normalize(frame.cameraPos - in.world);
  let depth = -terrainHeight(heightTex, in.world.xz);
  let shallow = 1.0 - smoothstep(0.0, td.shallowDepth, depth);
  let albedo = mix(td.albedoSea, td.albedoSand * 0.55, shallow * 0.6);
  let body = shadeDiffuse(albedo, vec3f(0.0, 1.0, 0.0));
  let r = reflect(-v, vec3f(0.0, 1.0, 0.0));
  let f0 = td.seaSpecular;
  let fresnel = f0 + (1.0 - f0) * pow(1.0 - max(v.y, 0.0), 5.0);
  let refl = skyRadiance(sky, r, frame.sunDir);
  var color = mix(body, refl, fresnel) * frame.exposure;
  color = mix(color, td.ringColor, ringAlpha(in.world.xz));
  return vec4f(color, 1.0);
}

// M0 placeholder island and sea, drawn in the opaque pass.
// Land is a generated grid (no vertex buffers); the sea is a large flat quad at y = 0.
// Lighting is physical (lux in, nits out, pre-exposed); no palette colors here (docs/05).

// #include common
// #include lib-hash
// #include lib-sky-plain

struct Island {
  radius: f32,
  coastNoise: f32,
  coastNoiseScale: f32,
  plateauHeight: f32,
  beachWidth: f32,
  seabedDepth: f32,
  gridSize: f32,
  gridExtent: f32,
  seaExtent: f32,
  seaSpecular: f32,
  seed: u32,
  _p0: f32,
  albedoSand: vec3f,
  _p1: f32,
  albedoGrass: vec3f,
  _p2: f32,
  albedoSea: vec3f,
  _p3: f32,
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> sky: SkyPlain;
@group(2) @binding(0) var<uniform> island: Island;

fn islandHeight(p: vec2f) -> f32 {
  let r = length(p);
  let n = valueNoise2(p * island.coastNoiseScale, island.seed) * 2.0 - 1.0;
  let coast = island.radius + island.coastNoise * n;
  let d = r - coast;
  let dome = island.plateauHeight * (1.0 - 0.3 * (r * r) / (coast * coast));
  let s = smoothstep(-1.2 * island.beachWidth, 2.0 * island.beachWidth, d);
  return mix(dome, island.seabedDepth, s);
}

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
};

@vertex
fn vsLand(@builtin(vertex_index) vi: u32) -> VsOut {
  let n = u32(island.gridSize);
  let quad = vi / 6u;
  let corner = array<vec2u, 6>(vec2u(0u, 0u), vec2u(0u, 1u), vec2u(1u, 0u),
                               vec2u(1u, 0u), vec2u(0u, 1u), vec2u(1u, 1u))[vi % 6u];
  let cell = vec2u(quad % n, quad / n) + corner;
  let step = island.gridExtent / f32(n);
  let xz = (vec2f(cell) - f32(n) * 0.5) * step;
  let h = islandHeight(xz);
  let e = step * 0.5;
  let dx = islandHeight(xz + vec2f(e, 0.0)) - islandHeight(xz - vec2f(e, 0.0));
  let dz = islandHeight(xz + vec2f(0.0, e)) - islandHeight(xz - vec2f(0.0, e));
  var out: VsOut;
  out.world = vec3f(xz.x, h, xz.y);
  out.normal = normalize(vec3f(-dx, 2.0 * e, -dz));
  out.pos = frame.viewProj * vec4f(out.world, 1.0);
  return out;
}

@vertex
fn vsSea(@builtin(vertex_index) vi: u32) -> VsOut {
  let c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0),
                          vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, 1.0))[vi];
  let xz = c * island.seaExtent * 0.5;
  var out: VsOut;
  out.world = vec3f(xz.x, 0.0, xz.y);
  out.normal = vec3f(0.0, 1.0, 0.0);
  out.pos = frame.viewProj * vec4f(out.world, 1.0);
  return out;
}

fn shadeDiffuse(albedo: vec3f, n: vec3f) -> vec3f {
  let sun = frame.sunIlluminance * max(dot(n, frame.sunDir), 0.0) / PI;
  return albedo * (sun + skyAmbient(sky, n));
}

@fragment
fn fsLand(in: VsOut) -> @location(0) vec4f {
  let n = normalize(in.normal);
  let grassMix = smoothstep(0.35, 0.75, in.world.y) * smoothstep(0.55, 0.85, n.y);
  let albedo = mix(island.albedoSand, island.albedoGrass, grassMix);
  return vec4f(shadeDiffuse(albedo, n) * frame.exposure, 1.0);
}

@fragment
fn fsSea(in: VsOut) -> @location(0) vec4f {
  let v = normalize(frame.cameraPos - in.world);
  let depth = -islandHeight(in.world.xz);
  let shallow = 1.0 - smoothstep(0.0, 2.5, depth);
  let albedo = mix(island.albedoSea, island.albedoSand * 0.55, shallow * 0.6);
  let body = shadeDiffuse(albedo, vec3f(0.0, 1.0, 0.0));
  let r = reflect(-v, vec3f(0.0, 1.0, 0.0));
  let f0 = island.seaSpecular;
  let fresnel = f0 + (1.0 - f0) * pow(1.0 - max(v.y, 0.0), 5.0);
  let refl = skyRadiance(sky, r, frame.sunDir);
  let radiance = mix(body, refl, fresnel);
  return vec4f(radiance * frame.exposure, 1.0);
}

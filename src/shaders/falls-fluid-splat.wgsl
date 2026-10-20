// Waterfall droplets drawn as spheres into the half-resolution fluid targets (screen-space fluid,
// van der Laan et al. 2009; Green, GDC 2010):
//   fsDepth   the nearest sphere surface: linear view depth (m) to a r32float target, and the
//             sphere's real depth to the pass's own depth buffer so the nearest wins
//   fsThick   accumulated water thickness along the view (m) and how much of it has taken in air,
//             added up over every sphere (no depth test among them)
// Both are hidden where the scene stands in front (the full-resolution scene depth).

// #include common

struct FluidDraw {
  radius: f32, bulk: f32, aerateS: f32, density: f32,   // droplet radius (m); growth as it falls; s to whiten; thickness per sphere
  toFull: vec2f, halfSize: vec2f,                       // half-res pixel to full-res pixel; half-res size
};

struct Particle { p: vec4f, v: vec4f, c: vec4f };   // as in falls-particles.wgsl

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> fd: FluidDraw;
@group(1) @binding(1) var<storage, read> particles: array<Particle>;
@group(1) @binding(2) var sceneDepth: texture_depth_2d;

struct SplatOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) center: vec3f,   // view space
  @location(2) @interpolate(flat) r: f32,
  @location(3) @interpolate(flat) aer: f32,
};

@vertex
fn vsSplat(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SplatOut {
  let pt = particles[ii];
  var out: SplatOut;
  let corner = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi];
  if (pt.v.w <= 0.0) { out.pos = vec4f(2.0, 2.0, 0.5, 1.0); return out; }
  // Falling water bulks out as it breaks up and takes in air.
  let age = pt.p.w;
  let r = fd.radius * (1.0 + fd.bulk * smoothstep(0.0, 0.6, age));
  let c = (frame.view * vec4f(pt.p.xyz, 1.0)).xyz;
  // The quad sits on the sphere's near side, so it is never clipped by the ground behind it.
  let q = c + vec3f(corner * r, r);
  out.pos = frame.proj * vec4f(q, 1.0);
  out.uv = corner;
  out.center = c;
  out.r = r;
  // Air taken in as it falls, more in some lanes than others: white streaks that run with the water.
  out.aer = smoothstep(0.0, fd.aerateS, age) * mix(0.15, 1.0, pt.c.x);
  return out;
}

// Reverse-Z with an infinite far plane: depth = near / distance. True where the scene stands in front.
fn hiddenByScene(fragXY: vec2f, ndcDepth: f32) -> bool {
  let full = vec2i(fragXY * fd.toFull);
  return ndcDepth < textureLoad(sceneDepth, full, 0);
}

struct DepthOut {
  @location(0) linear: vec4f,
  @builtin(frag_depth) depth: f32,
};

@fragment
fn fsDepth(in: SplatOut) -> DepthOut {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 1.0) { discard; }
  let pv = in.center + vec3f(in.uv * in.r, sqrt(1.0 - r2) * in.r);
  let clip = frame.proj * vec4f(pv, 1.0);
  let d = clip.z / clip.w;
  if (hiddenByScene(in.pos.xy, d)) { discard; }
  var out: DepthOut;
  out.linear = vec4f(-pv.z, 0.0, 0.0, 0.0);
  out.depth = d;
  return out;
}

@fragment
fn fsThick(in: SplatOut) -> @location(0) vec4f {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 1.0) { discard; }
  let nz = sqrt(1.0 - r2);
  let pv = in.center + vec3f(in.uv * in.r, nz * in.r);
  let clip = frame.proj * vec4f(pv, 1.0);
  if (hiddenByScene(in.pos.xy, clip.z / clip.w)) { discard; }
  let t = 2.0 * nz * in.r * fd.density;
  return vec4f(t, t * in.aer, 0.0, 0.0);
}

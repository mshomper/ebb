// The hen (docs/future/15): the creature body draw (creature-draw.wgsl), skinned by her bones and lit
// the same way (sun and moon with shadows, sky fill, aerial perspective), coloured from the model's
// own colour map: a vertex's colour slot holds its UV and a 2. The map's soft feather edges are cut
// to a hard edge (cut.x) rather than blended, and a feather seen from behind is lit from its own
// side. Light stays physical; the palette applies at the tonemap.

// #include common
// #include lib-hash
// #include lighting-bindings
// #include lib-sky
// #include lib-lighting

struct HenDraw {
  look: vec4f,     // x feather roughness, y sheen strength, z contact shadow darkness 0..1, w contact radius (body lengths)
  body: vec4f,     // x body length (m, at size 1)
  glint: vec4f,    // unused here (the creature pass's eye glint)
  cut: vec4f,      // x the colour map's alpha below which nothing is drawn, y how far her feathers stand out (m: fluffed, slice 3)
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var<uniform> hd: HenDraw;
// Two vec4f per individual: (x, y, z, yaw in radians), (size, first bone, spare, lift).
@group(2) @binding(1) var<storage, read> beings: array<vec4f>;
@group(2) @binding(2) var<storage, read> bones: array<mat4x4f>;
@group(2) @binding(3) var colourMap: texture_2d<f32>;
@group(2) @binding(4) var normalMap: texture_2d<f32>;
@group(2) @binding(5) var mapSampler: sampler;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
};

struct FsOut {
  @location(0) color: vec4f,
  @location(1) normalId: vec4f,
};

fn octEncode(n: vec3f) -> vec2f {
  var p = n.xz / (abs(n.x) + abs(n.y) + abs(n.z));
  if (n.y < 0.0) { p = (1.0 - abs(p.yx)) * select(vec2f(-1.0), vec2f(1.0), p >= vec2f(0.0)); }
  return p * 0.5 + 0.5;
}

/** Body-local to world: size, then yaw about +y (body +z forward), then the individual's spot. */
fn place(local: vec3f, at: vec4f, size: f32) -> vec3f {
  let c = cos(at.w);
  let s = sin(at.w);
  let p = local * size;
  return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z) + at.xyz;
}

@vertex
fn vsBody(@location(0) position: vec3f, @location(1) normal: vec3f, @location(2) albedo: vec3f,
          @location(3) joints: vec4u, @location(4) weights: vec4f,
          @builtin(instance_index) ii: u32) -> VsOut {
  let at = beings[ii * 2u];
  let size = beings[ii * 2u + 1u].x;
  let first = u32(beings[ii * 2u + 1u].y);
  let m = bones[first + joints.x] * weights.x + bones[first + joints.y] * weights.y
        + bones[first + joints.z] * weights.z + bones[first + joints.w] * weights.w;
  let posed = (m * vec4f(position, 1.0)).xyz;
  let nPosed = normalize((m * vec4f(normal, 0.0)).xyz + vec3f(0.0, 1e-6, 0.0));
  // Fluffed (roosting, in rain): the body feathers stand out along the normal; the legs stay thin.
  let fluffed = posed + nPosed * hd.cut.y * smoothstep(0.15, 0.2, position.y);
  let world = place(fluffed, at, size);
  let c = cos(at.w);
  let s = sin(at.w);
  var o: VsOut;
  o.world = world;
  o.pos = frame.viewProj * vec4f(world, 1.0);
  o.normal = vec3f(c * nPosed.x + s * nPosed.z, nPosed.y, -s * nPosed.x + c * nPosed.z);
  o.uv = albedo.xy;
  return o;
}

@fragment
fn fsBody(in: VsOut, @builtin(front_facing) front: bool) -> FsOut {
  let tex = textureSample(colourMap, mapSampler, in.uv);
  if (tex.a < hd.cut.x) { discard; }
  let n = normalize(in.normal) * select(-1.0, 1.0, front);
  let viewDist = distance(in.world, frame.cameraPos);
  let v = (frame.cameraPos - in.world) / max(viewDist, 1e-4);
  let vis = shadowVisibility(in.world, n, viewDist, in.pos.xy);
  let casterIsSun = dot(light.shadowDir, frame.sunDir) > 0.999;
  let sunVis = select(1.0, vis, casterIsSun);
  let moonVis = select(vis, 1.0, casterIsSun);
  let ao = mix(0.55, 1.0, clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
  let albedo = tex.rgb;
  let direct = frame.sunIlluminance * max(dot(n, frame.sunDir), 0.0) * sunVis
             + frame.moonIlluminance * max(dot(n, frame.moonDir), 0.0) * moonVis
             + pointIllum(in.world, n, 0.15);
  var radiance = albedo * (direct / PI + skyAmbient(n) * ao);
  // Feathers: a faint, broad sheen.
  radiance += hd.look.y * (frame.sunIlluminance * sunVis * ggxSpecular(n, v, frame.sunDir, hd.look.x, 0.04)
                         + frame.moonIlluminance * moonVis * ggxSpecular(n, v, frame.moonDir, hd.look.x, 0.04));
  let color = applyAerial(radiance * frame.exposure, in.pos.xy * frame.invRenderSize, viewDist);
  let safe = select(vec3f(0.0), color, color == color);
  return FsOut(vec4f(max(safe, vec3f(0.0)), 1.0), vec4f(octEncode(n), 0.0, 1.0));
}

// ---- contact shadow: a soft dark disc on what she stands on ----

struct ShadowOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

var<private> QUAD: array<vec2f, 6> = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
  vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

@vertex
fn vsShadow(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> ShadowOut {
  let at = beings[ii * 2u];
  let size = beings[ii * 2u + 1u].x;
  let q = QUAD[vi];
  let local = vec3f(q.x * 0.55, 0.0015 / size, q.y * 0.7) * hd.body.x * hd.look.w;
  var o: ShadowOut;
  o.pos = frame.viewProj * vec4f(place(local, at, size), 1.0);
  o.uv = q;
  return o;
}

@fragment
fn fsShadow(in: ShadowOut) -> @location(0) vec4f {
  let r = length(in.uv);
  let dark = hd.look.z * (1.0 - smoothstep(0.25, 1.0, r));
  return vec4f(vec3f(1.0 - dark), 1.0);
}

// The grey seals (B3 wave 3): the creature body draw (creature-draw.wgsl), skinned by their bones and
// lit the same way (sun and moon with shadows, sky fill, aerial perspective). Matt's model has no
// UVs, so the coat is painted here from the rest pose: a grey ground, a darker back and a paler
// belly by which way the skin faces at rest, dark blotches from a 3D noise over the body (each
// seal its own offset), darker and glossier while wet from the sea. The pup is cream white, and
// greys in patches as it moults. The colours are physical albedo (recipes/species/seal.json
// body.coat); the palette applies at the tonemap.

// #include common
// #include lib-hash
// #include lighting-bindings
// #include lib-sky
// #include lib-lighting

struct SealDraw {
  look: vec4f,     // x wet roughness, y wet sheen strength, z contact shadow darkness 0..1, w contact radius (body lengths)
  body: vec4f,     // x body length (m, at size 1)
  glint: vec4f,    // unused here
  grey: vec4f,     // rgb the coat's ground, w blotch size (m)
  back: vec4f,     // rgb the back, w blotch cut
  belly: vec4f,    // rgb the belly, w blotch strength
  dark: vec4f,     // rgb the blotches, w how much darker wet
  white: vec4f,    // rgb the pup's coat, w dry roughness
  eye: vec4f,      // rgb the eyes, w dry sheen strength
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var<uniform> sd: SealDraw;
// Two vec4f per individual: (x, y, z, yaw in radians), (size, first bone, coat, lift). coat packs
// the seal's number (0..15, its blotches), how white (0..1 in hundredths) and how dry (0..1):
// number * 1000 + whiteHundredths * 2 + dry.
@group(2) @binding(1) var<storage, read> beings: array<vec4f>;
@group(2) @binding(2) var<storage, read> bones: array<mat4x4f>;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) rest: vec3f,      // where this is on the body at rest (m)
  @location(3) restN: vec3f,     // which way it faces at rest
  @location(4) @interpolate(flat) part: f32,   // 0 coat, 1 eye, 2 jaw
  @location(5) @interpolate(flat) coat: vec3f, // seal number, white, dry
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
  let info = beings[ii * 2u + 1u];
  let size = info.x;
  let first = u32(info.y);
  let m = bones[first + joints.x] * weights.x + bones[first + joints.y] * weights.y
        + bones[first + joints.z] * weights.z + bones[first + joints.w] * weights.w;
  let posed = (m * vec4f(position, 1.0)).xyz;
  let nPosed = normalize((m * vec4f(normal, 0.0)).xyz + vec3f(0.0, 1e-6, 0.0));
  let world = place(posed, at, size);
  let c = cos(at.w);
  let s = sin(at.w);
  var o: VsOut;
  o.world = world;
  o.pos = frame.viewProj * vec4f(world, 1.0);
  o.normal = vec3f(c * nPosed.x + s * nPosed.z, nPosed.y, -s * nPosed.x + c * nPosed.z);
  o.rest = position;
  o.restN = normal;
  o.part = albedo.x;
  let num = floor(info.z / 1000.0);
  let rem = info.z - num * 1000.0;
  let whiteH = floor(rem / 2.0);
  o.coat = vec3f(num, whiteH / 100.0, clamp(rem - whiteH * 2.0, 0.0, 1.0));
  return o;
}

// A lattice hash 0..1, a smooth value noise in 3D over it, and a few octaves of that.
fn sealHash(p: vec3f) -> f32 { return hashToFloat(hash3(bitcast<vec3u>(vec3i(p)))); }

fn vnoise(p: vec3f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (3.0 - 2.0 * f);
  let n000 = sealHash(i);
  let n100 = sealHash(i + vec3f(1.0, 0.0, 0.0));
  let n010 = sealHash(i + vec3f(0.0, 1.0, 0.0));
  let n110 = sealHash(i + vec3f(1.0, 1.0, 0.0));
  let n001 = sealHash(i + vec3f(0.0, 0.0, 1.0));
  let n101 = sealHash(i + vec3f(1.0, 0.0, 1.0));
  let n011 = sealHash(i + vec3f(0.0, 1.0, 1.0));
  let n111 = sealHash(i + vec3f(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}

fn fbm(p: vec3f) -> f32 {
  return vnoise(p) * 0.55 + vnoise(p * 2.07 + 11.3) * 0.3 + vnoise(p * 4.3 + 27.1) * 0.15;
}

@fragment
fn fsBody(in: VsOut, @builtin(front_facing) front: bool) -> FsOut {
  let n = normalize(in.normal) * select(-1.0, 1.0, front);
  let viewDist = distance(in.world, frame.cameraPos);
  let v = (frame.cameraPos - in.world) / max(viewDist, 1e-4);
  let vis = shadowVisibility(in.world, n, viewDist, in.pos.xy);
  let casterIsSun = dot(light.shadowDir, frame.sunDir) > 0.999;
  let sunVis = select(1.0, vis, casterIsSun);
  let moonVis = select(vis, 1.0, casterIsSun);
  let ao = mix(0.55, 1.0, clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
  let wet = 1.0 - in.coat.z;
  let white = in.coat.y;

  // The coat: back and belly by how the skin faced at rest, blotches over it.
  let up = normalize(in.restN).y;
  var albedo = sd.grey.rgb;
  albedo = mix(albedo, sd.back.rgb, smoothstep(0.15, 0.85, up));
  albedo = mix(albedo, sd.belly.rgb, smoothstep(-0.1, -0.75, up));
  let off = vec3f(in.coat.x * 17.3, in.coat.x * 5.1, in.coat.x * 9.7);
  let blot = smoothstep(sd.back.w, sd.back.w + 0.08, fbm(in.rest / sd.grey.w + off));
  // Fainter on the dark back, where there is little to see.
  albedo = mix(albedo, sd.dark.rgb, blot * sd.belly.w * mix(1.0, 0.45, smoothstep(0.3, 0.9, up)));
  // The pup: cream white, greying in patches as it moults.
  let moult = step(vnoise(in.rest * 6.0 + off), white * 1.05);
  albedo = mix(albedo, sd.white.rgb * mix(0.92, 1.0, smoothstep(-0.5, 0.5, up)), moult * step(0.001, white));
  var rough = mix(sd.white.w, sd.look.x, wet);
  var sheen = mix(sd.eye.w, sd.look.y, wet);
  if (in.part > 0.5 && in.part < 1.5) { albedo = sd.eye.rgb; rough = 0.08; sheen = 1.0; }
  else { albedo = albedo * (1.0 - sd.dark.w * wet); }

  let direct = frame.sunIlluminance * max(dot(n, frame.sunDir), 0.0) * sunVis
             + frame.moonIlluminance * max(dot(n, frame.moonDir), 0.0) * moonVis
             + pointIllum(in.world, n, 0.15);
  var radiance = albedo * (direct / PI + skyAmbient(n) * ao);
  radiance += sheen * (frame.sunIlluminance * sunVis * ggxSpecular(n, v, frame.sunDir, rough, 0.04)
                     + frame.moonIlluminance * moonVis * ggxSpecular(n, v, frame.moonDir, rough, 0.04));
  let color = applyAerial(radiance * frame.exposure, in.pos.xy * frame.invRenderSize, viewDist);
  let safe = select(vec3f(0.0), color, color == color);
  return FsOut(vec4f(max(safe, vec3f(0.0)), 1.0), vec4f(octEncode(n), 0.0, 1.0));
}

// ---- contact shadow: a soft dark oval on what a hauled-out seal lies on ----

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
  let local = vec3f(q.x * 0.22, 0.0015 / size, q.y * 0.55) * sd.body.x * sd.look.w;
  var o: ShadowOut;
  o.pos = frame.viewProj * vec4f(place(local, at, size), 1.0);
  o.uv = q;
  return o;
}

@fragment
fn fsShadow(in: ShadowOut) -> @location(0) vec4f {
  let r = length(in.uv);
  let dark = sd.look.z * (1.0 - smoothstep(0.25, 1.0, r));
  return vec4f(vec3f(1.0 - dark), 1.0);
}

// Creatures (doc 11): a baked body mesh drawn once per individual and skinned by its bones (S6b), lit like the rest of the island
// (sun and moon with shadows, sky fill, aerial perspective) plus a wet GGX sheen, into the HDR,
// normal and depth targets with outline group 3 (creatures get clear lines, docs/05). Under each
// one a soft contact shadow darkens what it sits on, so a body never floats. Albedo is physical and
// comes from the species recipe (docs/05: the palette does the painting).

// #include common
// #include lib-hash
// #include lighting-bindings
// #include lib-sky
// #include lib-lighting

struct CreatureDraw {
  look: vec4f,     // x wet roughness, y wet specular strength, z contact shadow darkness 0..1, w contact radius (body lengths)
  body: vec4f,     // x body length (m, at size 1), yzw spare
  glint: vec4f,    // x, y the two eye bones (-1 none), z cornea roughness, w strength
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var<uniform> cd: CreatureDraw;
// Two vec4f per individual: (x, y, z, yaw in radians), (size, first bone, spare, spare).
@group(2) @binding(1) var<storage, read> beings: array<vec4f>;
// Bone matrices (body space, the rest pose is identity), MAX_BONES per individual (bodies.js).
@group(2) @binding(2) var<storage, read> bones: array<mat4x4f>;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) albedo: vec3f,
  @location(3) eye: f32,       // how much of the skin here follows an eye bone (the wet cornea)
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
  // Skinning: the vertex follows up to four bones by its weights.
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
  o.albedo = albedo;
  // The eyes are the skin that follows the eye bones.
  var eye = 0.0;
  for (var k = 0; k < 4; k++) {
    let j = f32(joints[k]);
    if (j == cd.glint.x || j == cd.glint.y) { eye += weights[k]; }
  }
  o.eye = eye;
  return o;
}

@fragment
fn fsBody(in: VsOut) -> FsOut {
  let n = normalize(in.normal);
  let viewDist = distance(in.world, frame.cameraPos);
  let v = (frame.cameraPos - in.world) / max(viewDist, 1e-4);
  let vis = shadowVisibility(in.world, n, viewDist, in.pos.xy);
  let casterIsSun = dot(light.shadowDir, frame.sunDir) > 0.999;
  let sunVis = select(1.0, vis, casterIsSun);
  let moonVis = select(vis, 1.0, casterIsSun);
  // Self-shading from below: the underside sits in its own shade.
  let ao = mix(0.55, 1.0, clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
  let direct = frame.sunIlluminance * max(dot(n, frame.sunDir), 0.0) * sunVis
             + frame.moonIlluminance * max(dot(n, frame.moonDir), 0.0) * moonVis;
  var radiance = in.albedo * (direct / PI + skyAmbient(n) * ao);
  // Wet skin: a GGX sheen from the sun and moon.
  radiance += cd.look.y * (frame.sunIlluminance * sunVis * ggxSpecular(n, v, frame.sunDir, cd.look.x, 0.02)
                         + frame.moonIlluminance * moonVis * ggxSpecular(n, v, frame.moonDir, cd.look.x, 0.02));
  // Wet eyes: the cornea is smooth, so the sun and moon make a sharp point in it and the sky shows
  // in it at a glancing view. Physically lit (water-like Fresnel), never painted.
  let g = smoothstep(0.5, 0.9, in.eye) * cd.glint.w;
  if (g > 0.0) {
    radiance += g * (frame.sunIlluminance * sunVis * ggxSpecular(n, v, frame.sunDir, cd.glint.z, 0.02)
                   + frame.moonIlluminance * moonVis * ggxSpecular(n, v, frame.moonDir, cd.glint.z, 0.02));
    let fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    radiance += g * fres * skyAmbient(reflect(-v, n)) / PI;
  }
  let color = applyAerial(radiance * frame.exposure, in.pos.xy * frame.invRenderSize, viewDist);
  // Never let a bad value through: one NaN would spread over the whole frame through bloom.
  let safe = select(vec3f(0.0), color, color == color);
  return FsOut(vec4f(max(safe, vec3f(0.0)), 1.0), vec4f(octEncode(n), 0.0, 1.0));
}

// ---- contact shadow: a soft dark disc on what the body sits on ----

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
  // An oval a little longer than wide, just above the ground so it never fights it.
  let local = vec3f(q.x * 0.55, 0.0015 / size, q.y * 0.7) * cd.body.x * cd.look.w;
  var o: ShadowOut;
  o.pos = frame.viewProj * vec4f(place(local, at, size), 1.0);
  o.uv = q;
  return o;
}

@fragment
fn fsShadow(in: ShadowOut) -> @location(0) vec4f {
  let r = length(in.uv);
  let dark = cd.look.z * (1.0 - smoothstep(0.25, 1.0, r));
  // Multiplied into the HDR color: 1 leaves it, less darkens it.
  return vec4f(vec3f(1.0 - dark), 1.0);
}

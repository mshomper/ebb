// Creatures (doc 11): a baked body mesh drawn once per individual, lit like the rest of the island
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
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var<uniform> cd: CreatureDraw;
// Two vec4f per individual: (x, y, z, yaw in radians), (size, spare, spare, spare).
@group(2) @binding(1) var<storage, read> beings: array<vec4f>;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) albedo: vec3f,
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
          @builtin(instance_index) ii: u32) -> VsOut {
  let at = beings[ii * 2u];
  let size = beings[ii * 2u + 1u].x;
  let world = place(position, at, size);
  let c = cos(at.w);
  let s = sin(at.w);
  var o: VsOut;
  o.world = world;
  o.pos = frame.viewProj * vec4f(world, 1.0);
  o.normal = vec3f(c * normal.x + s * normal.z, normal.y, -s * normal.x + c * normal.z);
  o.albedo = albedo;
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

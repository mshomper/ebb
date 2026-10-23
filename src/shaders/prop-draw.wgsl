// Props (docs/future/13 section 3.4): Matt's made models (the tent, the fire ring and its wood, the
// lantern; later the camp's piles), drawn with their own paint maps: base colour (sRGB, so it reads
// back linear), roughness from the green of the metallic-roughness map, and a tangent-space normal
// map, perturbed in a cotangent frame from screen derivatives (Schüler 2006), since the models carry
// no tangents. Lit like the creatures (sun and moon with shadows, sky fill, the small lights, GGX,
// aerial perspective). A fire's wood can char (darker, sunk lower as it burns down) and glow from its
// embers. Under each prop a soft contact shadow; into the sun's shadow map through prop-cast.wgsl. Physical
// albedo only: the palette paints at tonemap (docs/05).

// #include common
// #include lib-hash
// #include lighting-bindings
// #include lib-sky
// #include lib-lighting
// #include lib-lift

struct PropDraw {
  ember: vec4f,     // rgb ember glow (cd/m2 at full glow, linear), w flicker speed (Hz)
  charCol: vec4f,   // rgb charcoal albedo, w spare
  liftTint: vec4f,  // the lift (lib-lift.wgsl, F5): warm tint and its strength
  liftRim: vec4f,   // rim colour and its power
};

struct Prop {
  at: vec4f,        // x, y, z (ground under its origin), yaw (radians, 0: its +z faces +z)
  more: vec4f,      // x scale, y char 0..1, z ember glow 0..1, w squash of its height (1 as made)
  look: vec4f,      // x albedo scale, y roughness scale, z normal strength, w normal map's green sign
  shade: vec4f,     // contact shadow: x, y half sizes along its own x and z (m), z darkness 0..1, w the prop's lift 0..1 (F5: hovered or its card open)
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var<uniform> pd: PropDraw;
@group(2) @binding(1) var<storage, read> props: array<Prop>;
@group(3) @binding(0) var baseMap: texture_2d<f32>;
@group(3) @binding(1) var roughMap: texture_2d<f32>;
@group(3) @binding(2) var normalMap: texture_2d<f32>;
@group(3) @binding(3) var mapSampler: sampler;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) localY: f32,
  @location(4) @interpolate(flat) ii: u32,
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

/** A direction in the prop's frame turned by its yaw into the world (piece-draw.wgsl turn). */
fn turn(d: vec3f, yaw: f32) -> vec3f {
  let c = cos(yaw);
  let s = sin(yaw);
  return vec3f(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);
}

fn placed(position: vec3f, pr: Prop) -> vec3f {
  let p = position * vec3f(1.0, pr.more.w, 1.0) * pr.more.x;
  return turn(p, pr.at.w) + pr.at.xyz;
}

@vertex
fn vsProp(@location(0) position: vec3f, @location(1) normal: vec3f, @location(2) uv: vec2f,
          @builtin(instance_index) ii: u32) -> VsOut {
  let pr = props[ii];
  var o: VsOut;
  o.world = placed(position, pr);
  o.pos = frame.viewProj * vec4f(o.world, 1.0);
  // A squash in height takes the inverse on the normal, so it stays true.
  o.normal = turn(normalize(normal * vec3f(1.0, 1.0 / max(pr.more.w, 0.05), 1.0)), pr.at.w);
  o.uv = uv;
  o.localY = position.y;
  o.ii = ii;
  return o;
}

/** The normal map's normal in the frame of the surface (n, its position p and uv). */
fn perturb(n: vec3f, p: vec3f, uv: vec2f, tn: vec3f) -> vec3f {
  let dp1 = dpdx(p);
  let dp2 = dpdy(p);
  let duv1 = dpdx(uv);
  let duv2 = dpdy(uv);
  let dp2perp = cross(dp2, n);
  let dp1perp = cross(n, dp1);
  let t = dp2perp * duv1.x + dp1perp * duv2.x;
  let b = dp2perp * duv1.y + dp1perp * duv2.y;
  let m = max(dot(t, t), dot(b, b));
  if (m < 1e-20) { return n; }
  let inv = inverseSqrt(m);
  return normalize(t * inv * tn.x + b * inv * tn.y + n * tn.z);
}

@fragment
fn fsProp(in: VsOut) -> FsOut {
  let pr = props[in.ii];
  var nMesh = normalize(in.normal);
  // Two-sided canvas: the side you see.
  if (dot(nMesh, frame.cameraPos - in.world) < 0.0) { nMesh = -nMesh; }
  let base = textureSample(baseMap, mapSampler, in.uv);
  let mr = textureSample(roughMap, mapSampler, in.uv);
  let nm = textureSample(normalMap, mapSampler, in.uv).xyz * 2.0 - 1.0;
  let tn = normalize(vec3f(nm.x * pr.look.z, nm.y * pr.look.z * pr.look.w, max(nm.z, 0.05)));
  let n = perturb(nMesh, in.world, in.uv, tn);
  // Char: the wood blackens from the bottom up as it burns, all of it at char 1.
  let charred = smoothstep(-0.05, 0.15, pr.more.y * 1.2 - in.localY * 2.0 + 0.1);
  let albedo = mix(base.rgb * pr.look.x, pd.charCol.rgb, charred * pr.more.y);
  let rough = clamp(mr.g * pr.look.y, 0.04, 1.0);

  let viewDist = distance(in.world, frame.cameraPos);
  let v = (frame.cameraPos - in.world) / max(viewDist, 1e-4);
  let vis = shadowVisibility(in.world, nMesh, viewDist, in.pos.xy);
  let casterIsSun = dot(light.shadowDir, frame.sunDir) > 0.999;
  let sunVis = select(1.0, vis, casterIsSun);
  let moonVis = select(vis, 1.0, casterIsSun);
  let direct = frame.sunIlluminance * max(dot(n, frame.sunDir), 0.0) * sunVis
             + frame.moonIlluminance * max(dot(n, frame.moonDir), 0.0) * moonVis
             + pointIllum(in.world, n, 0.1);
  let ao = mix(0.6, 1.0, clamp(nMesh.y * 0.5 + 0.5, 0.0, 1.0));
  var radiance = albedo * (direct / PI + skyAmbient(n) * ao);
  radiance += frame.sunIlluminance * sunVis * ggxSpecular(n, v, frame.sunDir, rough, 0.04)
            + frame.moonIlluminance * moonVis * ggxSpecular(n, v, frame.moonDir, rough, 0.04);
  // Embers: the dark, low wood glows in slow patches that breathe.
  if (pr.more.z > 0.0) {
    let t = frame.animTime * pd.ember.w;
    let patchy = valueNoise2(in.uv * 18.0 + vec2f(t * 0.37, -t * 0.21), 131u) * 0.7 + valueNoise2(in.uv * 53.0 - vec2f(t * 0.6, t * 0.4), 137u) * 0.3;
    let low = 1.0 - smoothstep(0.04, 0.2, in.localY * pr.more.w);
    let dark = 1.0 - smoothstep(0.05, 0.25, dot(base.rgb, vec3f(0.333)));
    let k = pr.more.z * smoothstep(0.42, 0.8, patchy) * max(low, dark * 0.6);
    radiance += pd.ember.rgb * k;
  }
  let color = applyAerial(radiance * frame.exposure, in.pos.xy * frame.invRenderSize, viewDist);
  let lifted = liftShade(color, nMesh, v, pr.shade.w, pd.liftTint, pd.liftRim);
  let safe = select(vec3f(0.0), lifted, lifted == lifted);
  // Outline group 2, as the placed pieces: a soft line against the ground.
  return FsOut(vec4f(max(safe, vec3f(0.0)), 1.0), vec4f(octEncode(nMesh), 0.0, 2.0 / 3.0));
}

// ---- the contact shadow: a soft darkening of the ground under the prop ----

struct ShadeOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) dark: f32,
};

var<private> QUAD: array<vec2f, 6> = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
  vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

@vertex
fn vsShade(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> ShadeOut {
  let pr = props[ii];
  let q = QUAD[vi];
  let local = vec3f(q.x * pr.shade.x, 0.004, q.y * pr.shade.y);
  var o: ShadeOut;
  o.pos = frame.viewProj * vec4f(turn(local, pr.at.w) + pr.at.xyz, 1.0);
  o.uv = q;
  o.dark = pr.shade.z;
  return o;
}

@fragment
fn fsShade(in: ShadeOut) -> @location(0) vec4f {
  let r = length(in.uv);
  let dark = in.dark * (1.0 - smoothstep(0.35, 1.0, r));
  return vec4f(vec3f(1.0 - dark), 1.0);
}

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
// #include lib-lift

struct CreatureDraw {
  look: vec4f,     // x wet roughness, y wet specular strength, z contact shadow darkness 0..1, w contact radius (body lengths)
  body: vec4f,     // x body length (m, at size 1), yzw spare
  glint: vec4f,    // x, y the two eye bones (-1 none), z cornea roughness, w strength
  // A turtle's shell plates, worked out per pixel so the seams and dots stay crisp however close
  // you come (shell.x 0: none). From the shell piece's scutes block (recipes/species/turtle.json).
  shell: vec4f,    // x on, y the rim's height (cutY), z seam width (oval units), w groove darkening
  shellC: vec4f,   // xyz the shell piece's centre, w streak share
  shellR: vec4f,   // xyz its radii, w streaks start this far from a plate's middle
  oval: vec4f,     // the plates' oval: centre x, z and radii x, z
  scute: vec4f,    // x costal u, y marginal ring radius, z marginals, w streaks per plate
  dots: vec4f,     // x streak width, y dots per meter, z dot cut, w how many vertebrals
  list: array<vec4f, 3>, // the vertebrals' v, then the costals' v
  baseCol: vec4f,  // the shell's colour, w how many costals
  seamCol: vec4f,
  fleckCol: vec4f,
  // Drying (a turtle basking): dry roughness, dry sheen, how much darker it is wet (0: no drying).
  wet: vec4f,
  // The lift (lib-lift.wgsl): warm tint and its strength, rim colour and its power.
  liftTint: vec4f,
  liftRim: vec4f,
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var<uniform> cd: CreatureDraw;
// Two vec4f per individual: (x, y, z, yaw in radians), (size, first bone, dry 0..1, lift 0..1).
@group(2) @binding(1) var<storage, read> beings: array<vec4f>;
// Bone matrices (body space, the rest pose is identity), MAX_BONES per individual (bodies.js).
@group(2) @binding(2) var<storage, read> bones: array<mat4x4f>;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) albedo: vec3f,
  @location(3) eye: f32,       // how much of the skin here follows an eye bone (the wet cornea)
  @location(4) rest: vec3f,    // where this is on the body as baked (body meters), for the shell plates
  @location(5) stiff: f32,     // 1 on skin that moves with the root bone alone (a shell)
  @location(6) dry: f32,
  @location(7) @interpolate(flat) lift: f32,
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
  o.rest = position;
  o.stiff = select(0.0, 1.0, joints.x == 0u && weights.x > 0.99);
  o.dry = beings[ii * 2u + 1u].z;
  o.lift = beings[ii * 2u + 1u].w;
  return o;
}

// ---- a turtle's shell plates, per pixel (the same pattern body-bake.js bakes for far off) ----

fn shellHash(a: i32, b: i32, c: i32) -> f32 {
  var n = u32(a) * 374761393u + u32(b) * 668265263u + u32(c) * 2147483647u;
  n = (n ^ (n >> 13u)) * 1274126177u;
  return f32(n ^ (n >> 16u)) / 4294967296.0;
}

fn shellNoise(p: vec3f) -> f32 {
  let i = vec3i(floor(p));
  let f = p - floor(p);
  let w = f * f * (3.0 - 2.0 * f);
  let x00 = mix(shellHash(i.x, i.y, i.z), shellHash(i.x + 1, i.y, i.z), w.x);
  let x10 = mix(shellHash(i.x, i.y + 1, i.z), shellHash(i.x + 1, i.y + 1, i.z), w.x);
  let x01 = mix(shellHash(i.x, i.y, i.z + 1), shellHash(i.x + 1, i.y, i.z + 1), w.x);
  let x11 = mix(shellHash(i.x, i.y + 1, i.z + 1), shellHash(i.x + 1, i.y + 1, i.z + 1), w.x);
  return mix(mix(x00, x10, w.y), mix(x01, x11, w.y), w.z);
}

fn listAt(k: i32) -> f32 { return cd.list[k / 4][k % 4]; }

/** The shell's colour at a point of it, and how deep in a seam's groove it is (0..1). */
fn shellLook(p: vec3f) -> vec4f {
  let u = (p.x - cd.oval.x) / cd.oval.z;
  let v = (p.z - cd.oval.y) / cd.oval.w;
  let nv = i32(cd.dots.w);
  let nc = i32(cd.baseCol.w);
  var d1 = 1e9; var d2 = 1e9; var best = 0; var bc = vec2f(0.0);
  var k = 0;
  // Vertebrals down the middle, costals either side, marginals round the rim: the order body-bake.js uses.
  for (var i = 0; i < nv; i++) {
    let c = vec2f(0.0, listAt(i));
    let d = distance(vec2f(u, v), c);
    if (d < d1) { d2 = d1; d1 = d; best = k; bc = c; } else if (d < d2) { d2 = d; }
    k++;
  }
  for (var i = 0; i < nc; i++) {
    for (var s = 0; s < 2; s++) {
      let c = vec2f(select(-cd.scute.x, cd.scute.x, s == 0), listAt(nv + i));
      let d = distance(vec2f(u, v), c);
      if (d < d1) { d2 = d1; d1 = d; best = k; bc = c; } else if (d < d2) { d2 = d; }
      k++;
    }
  }
  let nm = i32(cd.scute.z);
  for (var i = 0; i < nm; i++) {
    let a = (f32(i) + 0.5) / f32(nm) * 6.2831853;
    let c = vec2f(sin(a), cos(a)) * cd.scute.y;
    let d = distance(vec2f(u, v), c);
    if (d < d1) { d2 = d1; d1 = d; best = k; bc = c; } else if (d < d2) { d2 = d; }
    k++;
  }
  let seam = (d2 - d1) * 0.5;
  let aa = max(fwidth(seam), 1e-5);
  let inSeam = 1.0 - smoothstep(cd.shell.z * 0.5 - aa, cd.shell.z * 0.5 + aa, seam);
  let groove = 1.0 - smoothstep(0.0, cd.shell.z * 1.6, seam);
  var col = cd.baseCol.rgb;
  // Dots strung in lines fanning out from each plate's middle.
  let du = u - bc.x; let dv = v - bc.y;
  let a = (atan2(du, dv) / 6.2831853 + 0.5) * cd.scute.w + shellHash(best, 7, 0) * 3.0;
  let id = floor(a);
  let mid = abs(a - id - 0.5) * 2.0;
  let n = shellNoise(p * cd.dots.y);
  let na = max(fwidth(n), 1e-4);
  let streak = shellHash(best, i32(id), 0) < cd.shellC.w && d1 > cd.shellR.w && mid < cd.dots.x;
  col = mix(col, cd.fleckCol.rgb, select(0.0, smoothstep(cd.dots.z - na, cd.dots.z + na, n), streak));
  col = mix(col, cd.seamCol.rgb, inSeam);
  return vec4f(col, groove);
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
  var ao = mix(0.55, 1.0, clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
  var albedo = in.albedo;
  // A turtle's shell: its plates drawn per pixel where the shell is (the dome above its rim), with
  // a little shade down in each seam's groove.
  // (Worked out before the test, so its edge smoothing stays in uniform control flow.)
  if (cd.shell.x > 0.5) {
    let s = shellLook(in.rest);
    let q = (in.rest - cd.shellC.xyz) / cd.shellR.xyz;
    let on = in.stiff > 0.5 && in.rest.y > cd.shell.y + 0.0004 && abs(length(q) - 1.0) < 0.12;
    albedo = select(albedo, s.rgb, on);
    ao *= select(1.0, 1.0 - cd.shell.w * s.a, on);
  }
  // Drying in the sun: wet it is darker and glossy, dry paler and matte.
  var rough = cd.look.x;
  var sheen = cd.look.y;
  if (cd.wet.z > 0.0) {
    albedo *= mix(cd.wet.z, 1.0, in.dry);
    rough = mix(rough, cd.wet.x, in.dry);
    sheen = mix(sheen, cd.wet.y, in.dry);
  }
  let direct = frame.sunIlluminance * max(dot(n, frame.sunDir), 0.0) * sunVis
             + frame.moonIlluminance * max(dot(n, frame.moonDir), 0.0) * moonVis
             + pointIllum(in.world, n, 0.0);
  var radiance = albedo * (direct / PI + skyAmbient(n) * ao);
  // Wet skin: a GGX sheen from the sun and moon.
  radiance += sheen * (frame.sunIlluminance * sunVis * ggxSpecular(n, v, frame.sunDir, rough, 0.02)
                     + frame.moonIlluminance * moonVis * ggxSpecular(n, v, frame.moonDir, rough, 0.02));
  // Wet eyes: the cornea is smooth, so the sun and moon make a sharp point in it and the sky shows
  // in it at a glancing view. Physically lit (water-like Fresnel), never painted.
  let g = smoothstep(0.5, 0.9, in.eye) * cd.glint.w;
  if (g > 0.0) {
    radiance += g * (frame.sunIlluminance * sunVis * ggxSpecular(n, v, frame.sunDir, cd.glint.z, 0.02)
                   + frame.moonIlluminance * moonVis * ggxSpecular(n, v, frame.moonDir, cd.glint.z, 0.02));
    let fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    radiance += g * fres * skyAmbient(reflect(-v, n)) / PI;
  }
  let color = liftShade(applyAerial(radiance * frame.exposure, in.pos.xy * frame.invRenderSize, viewDist), n, v, in.lift, cd.liftTint, cd.liftRim);
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

// The Walker page's portrait (K3; src/render/portrait.js): the walker's figure in its own small view,
// skinned by its 20 bones as figure-draw.wgsl does, with the carrier worn as one more rigid "bone"
// (index 20). Lit in linear light by one soft key light and a sky fill, with the eyes drawn on the
// head (lib-figure-eyes.wgsl). The page is paper, not the island, so there is no sun, shadow map or
// aerial perspective here: the light stays physical and a gentle filmic curve brings it to the
// screen. A vertex's colour slot holds (u, v, 2) for the figure's map, (u, v, 3) for the carrier's,
// or a linear colour.

// #include lib-figure-eyes

struct Portrait {
  viewProj: mat4x4f,
  cam: vec4f,      // xyz camera position (body m)
  key: vec4f,      // xyz toward the key light, w its strength
  keyRgb: vec4f,   // rgb the key's colour, w the rim strength
  sky: vec4f,      // rgb the sky fill, w exposure
  eyes: FigureEyes,
};

@group(0) @binding(0) var<uniform> P: Portrait;
@group(0) @binding(1) var<storage, read> bones: array<mat4x4f>;
@group(0) @binding(2) var figureMap: texture_2d<f32>;
@group(0) @binding(3) var figureNormal: texture_2d<f32>;
@group(0) @binding(4) var propMap: texture_2d<f32>;
@group(0) @binding(5) var mapSampler: sampler;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) albedo: vec3f,
  @location(3) rest: vec3f,
  @location(4) head: f32,
  @location(5) rx: vec3f,
  @location(6) ry: vec3f,
  @location(7) rz: vec3f,
};

@vertex
fn vsMain(@location(0) position: vec3f, @location(1) normal: vec3f, @location(2) albedo: vec3f,
          @location(3) joints: vec4u, @location(4) weights: vec4f) -> VsOut {
  let m = bones[joints.x] * weights.x + bones[joints.y] * weights.y
        + bones[joints.z] * weights.z + bones[joints.w] * weights.w;
  let world = (m * vec4f(position, 1.0)).xyz;
  var o: VsOut;
  o.world = world;
  o.pos = P.viewProj * vec4f(world, 1.0);
  o.normal = normalize((m * vec4f(normal, 0.0)).xyz + vec3f(0.0, 1e-6, 0.0));
  o.rx = m[0].xyz;
  o.ry = m[1].xyz;
  o.rz = m[2].xyz;
  o.albedo = albedo;
  o.rest = position;
  var head = 0.0;
  for (var k = 0; k < 4; k++) {
    if (f32(joints[k]) == P.eyes.size.w) { head += weights[k]; }
  }
  o.head = head;
  return o;
}

/** A soft filmic shoulder (Hable's curve, white at 6), to the screen's sRGB. */
fn filmic(x: vec3f) -> vec3f {
  let a = 0.22; let b = 0.30; let c = 0.10; let d = 0.20; let e = 0.01; let f = 0.30;
  let h = ((x * (a * x + c * b) + d * e) / (x * (a * x + b) + d * f)) - e / f;
  let w = 6.0;
  let hw = ((w * (a * w + c * b) + d * e) / (w * (a * w + b) + d * f)) - e / f;
  return clamp(h / hw, vec3f(0.0), vec3f(1.0));
}
fn toSrgb(c: vec3f) -> vec3f {
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308));
}

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4f {
  let figureMapped = in.albedo.z > 1.5 && in.albedo.z < 2.5;
  let propMapped = in.albedo.z > 2.5;
  let fc = textureSample(figureMap, mapSampler, in.albedo.xy).rgb;
  let fnm = textureSample(figureNormal, mapSampler, in.albedo.xy).xyz * 2.0 - 1.0;
  let pc = textureSample(propMap, mapSampler, in.albedo.xy).rgb;
  let n = select(normalize(in.normal), normalize(mat3x3f(in.rx, in.ry, in.rz) * fnm), figureMapped);
  let v = normalize(P.cam.xyz - in.world);
  let eye = figureEyes(in.rest, in.head, P.eyes);
  var base = select(in.albedo, fc, figureMapped);
  base = select(base, pc, propMapped);
  let albedo = mix(base, P.eyes.albedo.rgb, eye);
  let l = normalize(P.key.xyz);
  // The key, wrapped a little so the far side is not black; the sky from above; a faint rim behind.
  let key = P.key.w * max((dot(n, l) + 0.25) / 1.25, 0.0) * P.keyRgb.rgb;
  let sky = P.sky.rgb * mix(0.55, 1.0, n.y * 0.5 + 0.5);
  let rim = P.keyRgb.w * pow(1.0 - max(dot(n, v), 0.0), 3.0) * P.sky.rgb;
  let radiance = albedo * (key + sky) + rim * albedo + eye * 0.15 * P.eyes.albedo.rgb;
  return vec4f(toSrgb(filmic(radiance * P.sky.w)), 1.0);
}

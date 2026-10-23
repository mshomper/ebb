// Shared by the flora shaders (flora-lilies, flora-iris, flora-thrift; docs 10, 14): the uniform
// header every species' draw buffer starts with, the plant instance buffer, the stem curve, the
// wind gust and the lighting of thin plant parts. Needs `common`, `lib-hash`, `lighting-bindings`,
// `lib-sky` and `lib-lighting` included first, and the including shader to declare `frame`.

// The first three vec4f of every species' draw buffer (src/render/passes/flora-kinds.js).
struct FloraCommon {
  wind: vec4f,      // xy direction the wind blows toward, z real seconds, w wind strength 0..1
  albedo: vec4f,    // xyz season leaf albedo (linear), w wet darkening
  misc: vec4f,      // x season position (0 spring .. 4), y seed, z pixel width floor (pixels), w spare
};

// Stages as in src/world/growth/coarse.js.
const FLORA_SEED: u32 = 0u;
const FLORA_FLOWERING: u32 = 4u;
const FLORA_DORMANT: u32 = 5u;

// Two vec4f per plant: (x, z, size, stage), (species, hash, age, ground height).
@group(2) @binding(1) var<storage, read> plants: array<vec4f>;

fn floraOct(n: vec3f) -> vec2f {
  var p = n.xz / (abs(n.x) + abs(n.y) + abs(n.z));
  if (n.y < 0.0) { p = (1.0 - abs(p.yx)) * select(vec2f(-1.0), vec2f(1.0), p >= vec2f(0.0)); }
  return p * 0.5 + 0.5;
}

// A point on a stem or leaf at level t: the leaning axis plus a bend that grows as t^k (stiff at
// the base), pulled back to the stem's length so a bent stem dips instead of stretching.
fn floraCurve(base: vec3f, axis: vec3f, bend: vec3f, height: f32, k: f32, t: f32) -> vec3f {
  let chord = axis * t + bend * pow(max(t, 1e-4), k);
  return base + chord * (height * t / max(length(chord), 1e-5));
}

// The curve's direction at level t (the derivative of the unpulled curve).
fn floraTangent(axis: vec3f, bend: vec3f, k: f32, t: f32) -> vec3f {
  return normalize(axis + bend * k * pow(max(t, 1e-3), k - 1.0));
}

// Passing gusts plus a little flutter per plant part (h 0..1): the wind's strength multiplier.
fn floraGust(c: FloraCommon, at: vec2f, invGustM: f32, gustSpeed: f32, h: f32) -> f32 {
  let phase = dot(at, c.wind.xy) * invGustM - c.wind.z * gustSpeed * invGustM;
  return 0.6 + 0.4 * sin(phase * 6.2831853) + 0.25 * sin(c.wind.z * 1.7 + h * 6.2831853);
}

// Meters a pixel spans at a world point, for keeping far parts a pixel or so wide.
fn floraPixelM(p: vec3f) -> f32 {
  return length(frame.cameraPos - p) * 2.0 / (frame.proj[1][1] * frame.renderSize.y);
}

// A thin plant part lit like the reeds: sun and moon with shadows and `wrap` (light through a thin
// leaf or petal), sky fill scaled by `ao`, a GGX sun highlight when f0 > 0 (waxy lily pads),
// darker in rain, then aerial perspective. Physical albedo; pre-exposed.
fn floraShade(c: FloraCommon, world: vec3f, nIn: vec3f, albedoIn: vec3f, ao: f32, fragXY: vec2f,
              wrap: f32, roughness: f32, f0: f32) -> vec3f {
  let viewDist = distance(world, frame.cameraPos);
  let v = (frame.cameraPos - world) / max(viewDist, 1e-4);
  // Two-sided: the side that faces the camera.
  let n = select(nIn, -nIn, dot(nIn, v) < 0.0);
  let albedo = albedoIn * mix(1.0, c.albedo.w, light.weather.w);
  let vis = shadowVisibility(world, n, viewDist, fragXY);
  let casterIsSun = dot(light.shadowDir, frame.sunDir) > 0.999;
  let sunVis = select(1.0, vis, casterIsSun);
  let moonVis = select(vis, 1.0, casterIsSun);
  let sunNl = clamp(dot(n, frame.sunDir) * (1.0 - wrap) + wrap, 0.0, 1.0);
  let moonNl = clamp(dot(n, frame.moonDir) * (1.0 - wrap) + wrap, 0.0, 1.0);
  var radiance = albedo * ((frame.sunIlluminance * sunNl * sunVis + frame.moonIlluminance * moonNl * moonVis + pointIllum(world, n, wrap)) / PI
                           + skyAmbient(n) * ao);
  if (f0 > 0.0) { radiance += frame.sunIlluminance * sunVis * ggxSpecular(n, v, frame.sunDir, roughness, f0); }
  return applyAerial(radiance * frame.exposure, fragXY * frame.invRenderSize, viewDist);
}

// normalId for plants: outline group 0 (no lines), with an upright normal so the ground beside a
// plant sees no normal edge either.
fn floraNormalId() -> vec4f {
  return vec4f(floraOct(vec3f(0.0, 1.0, 0.0)), 0.0, 0.0);
}

// Shared structs for every pipeline (docs/04, bind group conventions).
// Group 0 binding 0 is FrameUniforms in every pipeline. Layout is mirrored in src/render/frame-uniforms.js.

struct FrameUniforms {
  view: mat4x4f,
  proj: mat4x4f,
  viewProj: mat4x4f,
  invViewProj: mat4x4f,
  prevViewProj: mat4x4f,
  cameraPos: vec3f,
  near: f32,
  renderSize: vec2f,
  invRenderSize: vec2f,
  animTime: f32,        // real seconds, runs while paused
  displayHours: f32,    // display time in game hours, wrapped per year
  dayFrac: f32,
  yearFrac: f32,
  seasonPhase: f32,
  moonPhase: f32,
  exposure: f32,        // linear multiplier applied before writing radiance (pre-exposed HDR)
  ev100: f32,
  sunDir: vec3f,        // unit vector toward the sun
  tierFlags: u32,
  sunIlluminance: vec3f, // lux, after atmosphere
  frameIndex: u32,
  moonDir: vec3f,
  _pad0: f32,
  moonIlluminance: vec3f,
  _pad1: f32,
};

// Group 1 binding 0 in every lit pipeline. Layout is mirrored in src/render/lighting.js.
struct LightUniforms {
  cascadeViewProj: array<mat4x4f, 3>,
  cascadeSplits: vec4f,     // xyz: view distance where cascades 0..2 end (meters), w: cascade count
  shadowDir: vec3f,         // unit vector toward the shadow-casting light (sun, or moon at night)
  shadowStrength: f32,      // 0..1, fades through twilight while the caster swaps
  shadowTexel: vec4f,       // world-space texel size per cascade (xyz), w: filter taps for this tier
  weather: vec4f,           // x cloud cover, y rain, z mist, w ground wetness (all 0..1)
  aerial: vec4f,            // x aerial-perspective max distance (m), y slice count, z extra shadow normal offset on upright faces (texels), w spare
};

const PI: f32 = 3.14159265358979;

struct FullscreenOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

// One triangle covering the screen. z = 0 is the far plane with reverse-Z.
fn fullscreenTriangle(vi: u32) -> FullscreenOut {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var out: FullscreenOut;
  out.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2f(p.x, 1.0 - p.y);
  return out;
}

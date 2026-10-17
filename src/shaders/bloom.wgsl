// Bloom (docs/05, "Bloom"): Jimenez 2014, "Next Generation Post Processing in Call of Duty: Advanced Warfare".
// Downsample the pre-exposed HDR into a mip chain with the 13-tap filter (Karis average on the first
// step so single very bright texels, like the sun disk, do not flicker), then upsample with a 3x3 tent
// and blend each level in. No threshold: every level is a normalized blur, so the result is a soft
// copy of the image with about the same energy. The tonemap adds it at a small mix (recipe, ~4%).
// All passes are fullscreen-triangle render passes into rgba16float attachments (portable to phones).

// #include common

struct BloomParams {
  weight: f32,   // upsample: share of the blurred lower level vs this level's downsample, 0..1
  radius: f32,   // upsample: tent radius in source (lower level) texels
  _pad0: f32,
  _pad1: f32,
};

@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;
@group(0) @binding(2) var<uniform> params: BloomParams;
@group(0) @binding(3) var baseTex: texture_2d<f32>;

// True only for the first downsample (from the full-res HDR target).
override karis: bool = false;

const LUMA = vec3f(0.2126, 0.7152, 0.0722);
const HALF_MAX: f32 = 60000.0;

@vertex
fn vsMain(@builtin(vertex_index) vi: u32) -> FullscreenOut {
  return fullscreenTriangle(vi);
}

fn tap(uv: vec2f, offset: vec2f, texel: vec2f) -> vec3f {
  return textureSampleLevel(srcTex, srcSampler, uv + offset * texel, 0.0).rgb;
}

fn karisWeight(c: vec3f) -> f32 {
  return 1.0 / (1.0 + dot(c, LUMA));
}

@fragment
fn fsDown(in: FullscreenOut) -> @location(0) vec4f {
  let texel = 1.0 / vec2f(textureDimensions(srcTex));
  let uv = in.uv;
  // 13 bilinear taps covering a 6x6 source footprint (36 texels).
  let a = tap(uv, vec2f(-2.0, -2.0), texel);
  let b = tap(uv, vec2f( 0.0, -2.0), texel);
  let c = tap(uv, vec2f( 2.0, -2.0), texel);
  let d = tap(uv, vec2f(-2.0,  0.0), texel);
  let e = tap(uv, vec2f( 0.0,  0.0), texel);
  let f = tap(uv, vec2f( 2.0,  0.0), texel);
  let g = tap(uv, vec2f(-2.0,  2.0), texel);
  let h = tap(uv, vec2f( 0.0,  2.0), texel);
  let i = tap(uv, vec2f( 2.0,  2.0), texel);
  let j = tap(uv, vec2f(-1.0, -1.0), texel);
  let k = tap(uv, vec2f( 1.0, -1.0), texel);
  let l = tap(uv, vec2f(-1.0,  1.0), texel);
  let m = tap(uv, vec2f( 1.0,  1.0), texel);

  // Five overlapping 2x2 boxes: the center box weighs 0.5, the four corner boxes 0.125 each.
  let g0 = (j + k + l + m) * 0.25;
  let g1 = (a + b + d + e) * 0.25;
  let g2 = (b + c + e + f) * 0.25;
  let g3 = (d + e + g + h) * 0.25;
  let g4 = (e + f + h + i) * 0.25;

  var outc: vec3f;
  if (karis) {
    // Karis average: weight each box by 1 / (1 + luma), renormalized, so a lone firefly cannot dominate.
    let w0 = 0.5 * karisWeight(g0);
    let w1 = 0.125 * karisWeight(g1);
    let w2 = 0.125 * karisWeight(g2);
    let w3 = 0.125 * karisWeight(g3);
    let w4 = 0.125 * karisWeight(g4);
    outc = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / max(w0 + w1 + w2 + w3 + w4, 1e-6);
  } else {
    outc = g0 * 0.5 + (g1 + g2 + g3 + g4) * 0.125;
  }
  // Keep inside half-float range and drop negatives, so nothing turns into inf further down.
  outc = clamp(outc, vec3f(0.0), vec3f(HALF_MAX));
  return vec4f(outc, 1.0);
}

@fragment
fn fsUp(in: FullscreenOut) -> @location(0) vec4f {
  let texel = params.radius / vec2f(textureDimensions(srcTex));
  let uv = in.uv;
  // 3x3 tent (1 2 1 / 2 4 2 / 1 2 1) / 16 over the lower, already accumulated level.
  var s = tap(uv, vec2f(0.0, 0.0), texel) * 4.0;
  s += (tap(uv, vec2f(0.0, -1.0), texel) + tap(uv, vec2f(-1.0, 0.0), texel)
      + tap(uv, vec2f(1.0, 0.0), texel) + tap(uv, vec2f(0.0, 1.0), texel)) * 2.0;
  s += tap(uv, vec2f(-1.0, -1.0), texel) + tap(uv, vec2f(1.0, -1.0), texel)
     + tap(uv, vec2f(-1.0, 1.0), texel) + tap(uv, vec2f(1.0, 1.0), texel);
  s *= 1.0 / 16.0;
  let base = textureSampleLevel(baseTex, srcSampler, uv, 0.0).rgb;
  return vec4f(mix(base, s, params.weight), 1.0);
}

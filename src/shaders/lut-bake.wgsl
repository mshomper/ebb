// Palette LUT bake (docs/05, "Palette baking"). One thread per texel of a 32^3 rgba16float LUT.
// Input domain: the AgX output, display-encoded sRGB 0..1; texel (i, j, k) holds the input
// (i, j, k) / 31. Output: the final display-encoded sRGB color for that input.
// Steps, all in OKLab: Gaussian anchor pull, keep light, grade (lift / gamma / gain on L, chroma
// scale, split tone weighted by L), gamut clip at constant L and hue.
// src/render/passes/post/lut-bake.js bakeColor() is the same math on the CPU.

// #include lib-oklab

const LUT_SIZE: u32 = 32u;

struct BakeParams {
  keepLuminance: f32,
  lift: f32,
  gamma: f32,
  gain: f32,
  chroma: f32,
  shadowAmt: f32,
  highlightAmt: f32,
  anchorCount: u32,
  shadowTint: vec3f,     // OKLab
  _pad0: f32,
  highlightTint: vec3f,  // OKLab
  _pad1: f32,
};

struct Anchor {
  source: vec3f,         // the anchor's `from` color, OKLab (`from` is reserved in WGSL)
  radius: f32,
  delta: vec3f,          // to - from, OKLab
  strength: f32,
};

@group(0) @binding(0) var<uniform> params: BakeParams;
@group(0) @binding(1) var<storage, read> anchors: array<Anchor>;
@group(0) @binding(2) var lut: texture_storage_3d<rgba16float, write>;

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (any(gid >= vec3u(LUT_SIZE))) { return; }
  let rgb = vec3f(gid) / f32(LUT_SIZE - 1u);
  let lab0 = linearToOklab(srgbToLinear3(rgb));

  // 1. Anchor pull: a Gaussian radial basis field over OKLab.
  var offset = vec3f(0.0);
  var wsum = 0.0;
  let n = min(params.anchorCount, arrayLength(&anchors));
  for (var i = 0u; i < n; i++) {
    let a = anchors[i];
    let d = length(lab0 - a.source) / a.radius;
    let w = a.strength * exp(-d * d);
    offset += w * a.delta;
    wsum += w;
  }
  var lab = lab0 + offset / max(1.0, wsum);

  // 2. Keep light.
  lab.x = mix(lab.x, lab0.x, params.keepLuminance);

  // 3. Grade.
  var L = clamp(lab.x, 0.0, 1.0);
  L = pow(max(params.lift + L * (params.gain - params.lift), 0.0), 1.0 / params.gamma);
  var ab = lab.yz * params.chroma;
  let Lw = clamp(L, 0.0, 1.0);
  let ws = params.shadowAmt * (1.0 - Lw) * (1.0 - Lw);
  let wh = params.highlightAmt * Lw * Lw;
  ab = mix(ab, params.shadowTint.yz, ws);
  ab = mix(ab, params.highlightTint.yz, wh);

  // 4. Gamut clip, then back to display-encoded sRGB.
  let fit = gamutClipOklab(vec3f(L, ab));
  let outRgb = linearToSrgb3(clamp(oklabToLinear(fit), vec3f(0.0), vec3f(1.0)));
  textureStore(lut, gid, vec4f(clamp(outRgb, vec3f(0.0), vec3f(1.0)), 1.0));
}

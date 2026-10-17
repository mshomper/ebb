// Placeholder tonemap and present: pre-exposed HDR -> AgX-style curve -> dither -> screen.
// The palette LUT lookup is added here in M1 S3 (docs/05); this is the only place it will live.

// #include common
// #include lib-hash

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var hdrTex: texture_2d<f32>;
@group(2) @binding(1) var hdrSampler: sampler;

// AgX base, polynomial sigmoid fit (Benjamin Wrensch, "Minimal AgX implementation", 2023).
fn agxContrast(x: vec3f) -> vec3f {
  let x2 = x * x;
  let x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

fn agx(color: vec3f) -> vec3f {
  let inset = mat3x3f(
    vec3f(0.842479062253094, 0.0423282422610123, 0.0423756549057051),
    vec3f(0.0784335999999992, 0.878468636469772, 0.0784336),
    vec3f(0.0792237451477643, 0.0791661274605434, 0.879142973793104));
  let minEv = -12.47393;
  let maxEv = 4.026069;
  var c = inset * max(color, vec3f(1e-10));
  c = clamp(log2(c), vec3f(minEv), vec3f(maxEv));
  c = (c - minEv) / (maxEv - minEv);
  return agxContrast(c);
}

fn agxEotf(c: vec3f) -> vec3f {
  let outset = mat3x3f(
    vec3f(1.19687900512017, -0.0528968517574562, -0.0529716355144438),
    vec3f(-0.0980208811401368, 1.15190312990417, -0.0980434501171241),
    vec3f(-0.0990297440797205, -0.0989611768448433, 1.15107367264116));
  return outset * c; // stays display-encoded (approximately sRGB), written to a non-sRGB swapchain
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> FullscreenOut {
  return fullscreenTriangle(vi);
}

@fragment
fn fs(in: FullscreenOut) -> @location(0) vec4f {
  let hdr = textureSampleLevel(hdrTex, hdrSampler, in.uv, 0.0).rgb;
  var c = agxEotf(agx(hdr));
  let noise = hashToFloat(hash3(vec3u(vec2u(in.pos.xy), frame.frameIndex & 63u))) - 0.5;
  c += noise / 255.0;
  return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), 1.0);
}

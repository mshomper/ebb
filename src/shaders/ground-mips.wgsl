// Ground detail mips (docs/22 "Mips"). One dispatch per level per array, z = array layer.
// Each texel of level l+1 is the 2x2 box average of level l.
// Array A: albedo averaged in linear light (the source is read through the sRGB view, so loads
// decode; storage textures cannot be sRGB, so the result is encoded here), height averaged.
// Array B: normals decoded to unit vectors and averaged; the averaged normal's shortening becomes
// extra roughness (Toksvig, "Mipmapping Normal Maps", 2004), the renormalized normal is stored;
// cavity averaged.

@group(0) @binding(0) var srcA: texture_2d_array<f32>;                          // level l, rgba8unorm-srgb view
@group(0) @binding(1) var dstA: texture_storage_2d_array<rgba8unorm, write>;    // level l+1, raw bytes
@group(0) @binding(2) var srcB: texture_2d_array<f32>;                          // level l
@group(0) @binding(3) var dstB: texture_storage_2d_array<rgba8unorm, write>;    // level l+1

// The four level-l texels under destination texel d (clamped, so odd sizes stay in range).
fn tap(d: vec2u, i: u32, srcSize: vec2u) -> vec2i {
  let p = d * 2u + vec2u(i & 1u, i >> 1u);
  return vec2i(min(p, srcSize - 1u));
}

fn linearToSrgb(c: vec3f) -> vec3f {
  let x = clamp(c, vec3f(0.0), vec3f(1.0));
  return select(1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055, 12.92 * x, x <= vec3f(0.0031308));
}

@compute @workgroup_size(8, 8)
fn csMipA(@builtin(global_invocation_id) gid: vec3u) {
  if (any(gid.xy >= textureDimensions(dstA))) { return; }
  let s = textureDimensions(srcA);
  let layer = i32(gid.z);
  var sum = vec4f(0.0);
  for (var i = 0u; i < 4u; i++) {
    sum += textureLoad(srcA, tap(gid.xy, i, s), layer, 0);   // rgb linear, a height
  }
  let m = sum * 0.25;
  textureStore(dstA, gid.xy, layer, vec4f(linearToSrgb(m.rgb), m.a));
}

@compute @workgroup_size(8, 8)
fn csMipB(@builtin(global_invocation_id) gid: vec3u) {
  if (any(gid.xy >= textureDimensions(dstB))) { return; }
  let s = textureDimensions(srcB);
  let layer = i32(gid.z);
  var n = vec3f(0.0);
  var alpha2 = 0.0;   // mean of GGX alpha^2, alpha = roughness^2
  var cavity = 0.0;
  for (var i = 0u; i < 4u; i++) {
    let t = textureLoad(srcB, tap(gid.xy, i, s), layer, 0);
    let xy = t.rg * 2.0 - 1.0;
    n += normalize(vec3f(xy, sqrt(max(1.0 - dot(xy, xy), 0.0))));
    let alpha = t.b * t.b;
    alpha2 += alpha * alpha;
    cavity += t.a;
  }
  n *= 0.25;
  alpha2 *= 0.25;
  cavity *= 0.25;
  // Toksvig: sigma^2 = (1 - |n|) / |n|, added in alpha^2 space and clamped to 1.
  let len = length(n);
  let sigma2 = max(1.0 - len, 0.0) / max(len, 1e-4);
  let alphaOut = sqrt(min(alpha2 + sigma2, 1.0));
  let roughness = sqrt(alphaOut);
  let nOut = select(vec3f(0.0, 0.0, 1.0), n / len, len > 1e-4);
  textureStore(dstB, gid.xy, layer, vec4f(nOut.xy * 0.5 + 0.5, roughness, cavity));
}

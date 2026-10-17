// Ground detail repack (docs/22). Each material ships as three opaque RGB WebPs (browsers damage
// alpha when encoding), uploaded as raw bytes into staging textures. This pass writes mip 0 of one
// array layer: A = albedo sRGB bytes unchanged + height, B = normal XY + roughness + cavity.
// Loads and stores are plain unorm, so every byte passes through exactly.

@group(0) @binding(0) var srcA: texture_2d<f32>;   // a.webp: albedo, sRGB-encoded RGB
@group(0) @binding(1) var srcB: texture_2d<f32>;   // b.webp: R,G normal X,Y (OpenGL, 0..1), B roughness
@group(0) @binding(2) var srcC: texture_2d<f32>;   // c.webp: R height, G cavity
@group(0) @binding(3) var dstA: texture_storage_2d<rgba8unorm, write>;  // array A, one layer, mip 0
@group(0) @binding(4) var dstB: texture_storage_2d<rgba8unorm, write>;  // array B, one layer, mip 0

@compute @workgroup_size(8, 8)
fn csPack(@builtin(global_invocation_id) gid: vec3u) {
  if (any(gid.xy >= textureDimensions(dstA))) { return; }
  let p = vec2i(gid.xy);
  let a = textureLoad(srcA, p, 0);
  let b = textureLoad(srcB, p, 0);
  let c = textureLoad(srcC, p, 0);
  textureStore(dstA, gid.xy, vec4f(a.rgb, c.r));
  textureStore(dstB, gid.xy, vec4f(b.rg, b.b, c.g));
}

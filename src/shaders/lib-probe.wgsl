// Sky probe helpers (docs/06 "Ambient light", docs/07 "Reflection"). Declares no bindings.
//
// The probe is a small cube (64² on high and ultra, 32² on medium and low, rgba16float) rebuilt every
// frame by sky-probe.wgsl from the sky-view LUT, the overcast dome and the ground hemisphere. Sun and
// moon disks and stars are left out: water and wet ground add those as GGX glints of their own.
// Mip m is GGX-prefiltered for perceptual roughness m / (levels - 1), so mip 0 is the mirror sky.
//
// How a consumer samples it (bind the atmosphere's probeView as texture_cube<f32>, sampleType 'float',
// viewDimension 'cube', and probeSampler as a 'filtering' sampler):
//   let levels = f32(textureNumLevels(probeTex));
//   let nits = textureSampleLevel(probeTex, probeSampler, dir, probeLod(r, levels)).rgb * SKY_LUT_INV_SCALE;
// Stored values are nits * SKY_LUT_SCALE (1/32, as the sky-view LUT), so the result is nits, not
// pre-exposed: multiply by frame.exposure like every other radiance.

const PROBE_SCALE: f32 = 0.03125;       // stored value = nits * PROBE_SCALE, same as SKY_LUT_SCALE
const PROBE_INV_SCALE: f32 = 32.0;
const PROBE_MAX_STORED: f32 = 60000.0;  // clamp under fp16 max (65504)

// Mip to sample for a perceptual roughness r in 0..1 (r = sqrt(GGX alpha)); levels = mip count.
fn probeLod(perceptualRoughness: f32, levels: f32) -> f32 {
  return clamp(perceptualRoughness, 0.0, 1.0) * (levels - 1.0);
}

// World direction through a cube texel, face 0..5 = +X, -X, +Y, -Y, +Z, -Z, uv in 0..1 with (0, 0) at
// the first texel row's left edge (texel centers at (i + 0.5) / size). Inverse of the WebGPU (Vulkan,
// D3D) face selection: on face +X, s = -z / |x| and t = -y / |x|, and so on, so textureSampleLevel on
// the cube view with this direction lands on this texel. Not normalized.
fn probeFaceDir(face: u32, uv: vec2f) -> vec3f {
  let sc = uv.x * 2.0 - 1.0;
  let tc = uv.y * 2.0 - 1.0;
  if (face == 0u) { return vec3f(1.0, -tc, -sc); }
  if (face == 1u) { return vec3f(-1.0, -tc, sc); }
  if (face == 2u) { return vec3f(sc, 1.0, tc); }
  if (face == 3u) { return vec3f(sc, -1.0, -tc); }
  if (face == 4u) { return vec3f(sc, -tc, 1.0); }
  return vec3f(-sc, -tc, -1.0);
}

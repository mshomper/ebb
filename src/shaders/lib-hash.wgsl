// Counter-based hashing, the GPU twin of hash32 in src/core/rng.js
// (PCG hash, Jarzynski and Olano, "Hash Functions for GPU Rendering", JCGT 2020).

fn pcg(v: u32) -> u32 {
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

// Same folding as hash32(a, b, c) in rng.js: h = pcg(a); h = pcg(h ^ b); h = pcg(h ^ c).
fn hash2(v: vec2u) -> u32 {
  return pcg(pcg(v.x) ^ v.y);
}

fn hash3(v: vec3u) -> u32 {
  return pcg(pcg(pcg(v.x) ^ v.y) ^ v.z);
}

// Uniform float in [0, 1) from the top 24 bits.
fn hashToFloat(h: u32) -> f32 {
  return f32(h >> 8u) * (1.0 / 16777216.0);
}

// Smooth value noise in [0, 1], seeded.
fn valueNoise2(p: vec2f, seed: u32) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (3.0 - 2.0 * f);
  let c = vec2u(vec2i(i) + vec2i(1 << 20));
  let a = hashToFloat(hash3(vec3u(c, seed)));
  let b = hashToFloat(hash3(vec3u(c + vec2u(1u, 0u), seed)));
  let d = hashToFloat(hash3(vec3u(c + vec2u(0u, 1u), seed)));
  let e = hashToFloat(hash3(vec3u(c + vec2u(1u, 1u), seed)));
  return mix(mix(a, b, u.x), mix(d, e, u.x), u.y);
}

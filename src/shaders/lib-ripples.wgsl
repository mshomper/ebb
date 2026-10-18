// Ripple field lookups for drawing (docs/07, Ripples). The field is a world-anchored toroidal
// window of N x N texels (src/world/water/ripples.js): world texel c = floor(xz / texelM) lives at
// index c mod N, and the window holds texels origin .. origin + N - 1. Heights are r32float meters,
// read with textureLoad (texture binding sampleType 'unfilterable-float').

// Mirrors the info buffer in src/world/water/ripples.js (32 bytes).
struct RippleInfo {
  origin: vec2i,          // world texel index of the window's first texel
  size: u32,              // N, texels per side
  texelM: f32,            // meters per texel
  normalStrength: f32,    // scale on the slope (recipe ripples.normalStrength)
  edgeFadeM: f32,         // the slope fades to zero over this distance inside the window edge
  _p0: f32,
  _p1: f32,
};

// Height (m) of world texel c, zero outside the window.
fn rippleHeightAt(tex: texture_2d<f32>, info: RippleInfo, c: vec2i) -> f32 {
  let n = i32(info.size);
  let k = c - info.origin;
  if (any(k < vec2i(0)) || any(k >= vec2i(n))) { return 0.0; }
  let idx = ((c % n) + n) % n;
  return textureLoad(tex, idx, 0).r;
}

// d(height)/dx and d(height)/dz (meters per meter) at a world point, scaled by normalStrength:
// central differences at the four nearest texel centers, blended bilinearly, faded near the
// window edge. Add it to the surface slope: n = normalize(vec3f(-s.x, 1, -s.y)).
fn rippleSlope(tex: texture_2d<f32>, info: RippleInfo, xz: vec2f) -> vec2f {
  if (info.size == 0u) { return vec2f(0.0); }
  let u = xz / info.texelM - 0.5;   // texel centers sit on integers
  let i = vec2i(floor(u));
  let f = u - floor(u);
  // The 4 x 4 block around the point, minus its corners: 12 loads.
  let h10 = rippleHeightAt(tex, info, i + vec2i(0, -1));
  let h20 = rippleHeightAt(tex, info, i + vec2i(1, -1));
  let h01 = rippleHeightAt(tex, info, i + vec2i(-1, 0));
  let h11 = rippleHeightAt(tex, info, i);
  let h21 = rippleHeightAt(tex, info, i + vec2i(1, 0));
  let h31 = rippleHeightAt(tex, info, i + vec2i(2, 0));
  let h02 = rippleHeightAt(tex, info, i + vec2i(-1, 1));
  let h12 = rippleHeightAt(tex, info, i + vec2i(0, 1));
  let h22 = rippleHeightAt(tex, info, i + vec2i(1, 1));
  let h32 = rippleHeightAt(tex, info, i + vec2i(2, 1));
  let h13 = rippleHeightAt(tex, info, i + vec2i(0, 2));
  let h23 = rippleHeightAt(tex, info, i + vec2i(1, 2));
  // Slopes (x2 texel) at the centers (0,0) (1,0) (0,1) (1,1) relative to i.
  let s00 = vec2f(h21 - h01, h12 - h10);
  let s10 = vec2f(h31 - h11, h22 - h20);
  let s01 = vec2f(h22 - h02, h13 - h11);
  let s11 = vec2f(h32 - h12, h23 - h21);
  let s = mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y) / (2.0 * info.texelM);
  // Fade toward the window edge, where the field is held at rest.
  let lo = vec2f(info.origin) * info.texelM;
  let hi = lo + f32(info.size) * info.texelM;
  let edge = min(min(xz.x - lo.x, hi.x - xz.x), min(xz.y - lo.y, hi.y - xz.y));
  let fade = smoothstep(0.0, max(info.edgeFadeM, 1e-3), edge);
  return s * info.normalStrength * fade;
}

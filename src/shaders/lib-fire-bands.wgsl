// The painted flame (Matt's fire study, October 29, 2026; camp.json fireSim bands): the heat a ray
// collected through the fire sim, mapped to soft colour bands, rose ember to orange to amber to a
// cream core, with a soft orange halo outside the edge. Painted in display colour after the tonemap
// and the palette (the fire's one sanctioned exception to "painted last"; spec section 4).
// The band colours come in through FireBands, fixed from the recipe today. The hook for palette
// keys (spec 10.2): whoever fills FireBands may tint c0..c3 by the time of day or season first.

struct FireBands {
  c0: vec4f,    // rose ember (display sRGB), w: the edge
  c1: vec4f,    // orange, w: band 1
  c2: vec4f,    // amber, w: band 2
  c3: vec4f,    // cream core, w: band 3
  look: vec4f,  // x: stylize 0..1, y: soft width, z: banded width, w: halo strength
};

/** The band width at this stylize: soft at 0, banded at 1. */
fn fireBandWidth(B: FireBands) -> f32 { return mix(B.look.y, B.look.z, B.look.x); }

/** How much the painted flame covers at collected heat h, 0..1. */
fn fireAlpha(B: FireBands, h: f32) -> f32 {
  let w = fireBandWidth(B);
  return smoothstep(B.c0.w - w, B.c0.w + w, h);
}

/** The flame's colour for collected heat h. */
fn fireBandRamp(B: FireBands, h: f32, w: f32) -> vec3f {
  var c = B.c0.rgb;
  c = mix(c, B.c1.rgb, smoothstep(B.c1.w - w, B.c1.w + w, h));
  c = mix(c, B.c2.rgb, smoothstep(B.c2.w - w, B.c2.w + w, h));
  c = mix(c, B.c3.rgb, smoothstep(B.c3.w - w, B.c3.w + w, h));
  return c;
}

/**
 * Paint the flame over a display colour col (0..1) from collected heat h. glow: how strongly the
 * halo shows (the study's min(level * 2 + 0.2, 1)).
 */
fn firePaint(B: FireBands, col: vec3f, h: f32, glow: f32) -> vec3f {
  let w = fireBandWidth(B);
  let alpha = smoothstep(B.c0.w - w, B.c0.w + w, h);
  var c = mix(col, fireBandRamp(B, h, w), alpha * mix(0.85, 1.0, B.look.x));
  let halo = smoothstep(0.0, 0.18, h) * (1.0 - alpha);
  c += vec3f(1.0, 0.45, 0.2) * halo * B.look.w * glow;
  return c;
}

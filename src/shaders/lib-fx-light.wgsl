// The Q and E move effects' lights (doc 16, the move effects; src/world/hollow/fx-layout.js): up to
// eight point lights that add to the lantern in the Hollow, falling off like it, (1 - smoothstep(0,
// reach, d))^2, with the same soft wrap, 0.35 + 0.65 N.L. A shader that includes this declares
// `var<uniform> fxl: FxLights;` at a binding of its own (WGSL lets a function use a global declared
// further down). With no lights set, fxLight is zero and the look is as before.
//
// Soft shadows (the cinematic pass, November 3, 2026): a light marked shadow (its second vec4's w is
// 1) is blocked by up to twelve upright capsules, the walker, the Hollow's things and the pillars,
// each a foot and top height and a radius. A point is shaded by how near the line from it to the
// light passes each capsule's axis, softened over count.z metres: an analytic soft shadow, with no
// shadow map. A capsule the point or the light sits inside is skipped, so nothing shadows its own
// skin and a flash at the walker's hands still lights the room.

struct FxLights {
  count: vec4f,               // x how many lights (0..8), y how many capsules (0..12), z the shadows' softness (m)
  l: array<vec4f, 16>,        // two each: x, y, z, reach (m); r, g, b (linear light), shadow (1 casts)
  occ: array<vec4f, 12>,      // one each: x, z, radius (m), foot y; and the top's y is in occTop
  occTop: array<vec4f, 3>,    // the twelve tops, four to a vec4
};

/** The shortest distance between segments a0-a1 and b0-b1. */
fn fxSegDist(a0: vec3f, a1: vec3f, b0: vec3f, b1: vec3f) -> f32 {
  let d1 = a1 - a0; let d2 = b1 - b0; let r = a0 - b0;
  let a = dot(d1, d1); let e = dot(d2, d2); let f = dot(d2, r);
  let c = dot(d1, r); let b = dot(d1, d2);
  let den = a * e - b * b;
  var s = select(0.0, clamp((b * f - c * e) / den, 0.0, 1.0), den > 1e-8);
  var t = (b * s + f) / max(e, 1e-8);
  if (t < 0.0) { t = 0.0; s = clamp(-c / max(a, 1e-8), 0.0, 1.0); }
  else if (t > 1.0) { t = 1.0; s = clamp((b - c) / max(a, 1e-8), 0.0, 1.0); }
  return length((a0 + d1 * s) - (b0 + d2 * t));
}

/** How much of a shadow-casting light at lp reaches world (1 all, 0 none). */
fn fxShadow(world: vec3f, lp: vec3f) -> f32 {
  let n = min(u32(fxl.count.y), 12u);
  let soft = max(fxl.count.z, 0.02);
  var k = 1.0;
  for (var i = 0u; i < n; i++) {
    let o = fxl.occ[i];
    let top = fxl.occTop[i / 4u][i % 4u];
    let b0 = vec3f(o.x, o.w, o.y); let b1 = vec3f(o.x, top, o.y);
    // A point inside (or on the skin of) this capsule is not shadowed by it, nor is a light inside it
    // (a flash at the walker's own hands).
    if (fxSegDist(world, world, b0, b1) < o.z * 1.15 || fxSegDist(lp, lp, b0, b1) < o.z * 1.6) { continue; }
    let d = fxSegDist(world, lp, b0, b1);
    k *= smoothstep(o.z - soft * 0.5, o.z + soft, d);
  }
  return k;
}

/** The effect lights' sum on a point with normal n. */
fn fxLight(world: vec3f, n: vec3f) -> vec3f {
  var c = vec3f(0.0);
  let count = min(u32(fxl.count.x), 8u);
  for (var i = 0u; i < count; i++) {
    let a = fxl.l[i * 2u];
    let col = fxl.l[i * 2u + 1u];
    let d = a.xyz - world;
    let dist = length(d);
    if (dist > a.w) { continue; }
    let fall = 1.0 - smoothstep(0.0, max(a.w, 1e-3), dist);
    let nl = 0.35 + 0.65 * max(dot(n, d / max(dist, 1e-3)), 0.0);
    var sh = 1.0;
    if (col.w > 0.5) { sh = fxShadow(world, a.xyz); }
    c += col.rgb * (fall * fall * nl * sh);
  }
  return c;
}

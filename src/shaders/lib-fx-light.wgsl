// The Q and E move effects' lights (doc 16, the move effects; src/world/hollow/fx-layout.js): up to
// eight point lights that add to the lantern in the Hollow, falling off like it, (1 - smoothstep(0,
// reach, d))^2, with the same soft wrap, 0.35 + 0.65 N.L. A shader that includes this declares
// `var<uniform> fxl: FxLights;` at a binding of its own (WGSL lets a function use a global declared
// further down). With no lights set, fxLight is zero and the look is as before.

struct FxLights {
  count: vec4f,               // x how many lights (0..8)
  l: array<vec4f, 16>,        // two each: x, y, z, reach (m); r, g, b (linear light), unused
};

/** The effect lights' sum on a point with normal n. */
fn fxLight(world: vec3f, n: vec3f) -> vec3f {
  var c = vec3f(0.0);
  let count = min(u32(fxl.count.x), 8u);
  for (var i = 0u; i < count; i++) {
    let a = fxl.l[i * 2u];
    let d = a.xyz - world;
    let dist = length(d);
    let fall = 1.0 - smoothstep(0.0, max(a.w, 1e-3), dist);
    let nl = 0.35 + 0.65 * max(dot(n, d / max(dist, 1e-3)), 0.0);
    c += fxl.l[i * 2u + 1u].rgb * (fall * fall * nl);
  }
  return c;
}

// The lift (F5, Matt, October 23, 2026): a thing the pointer rests on, or whose card is open, is
// lifted a little instead of ringed on the ground: a slight warm tint on its own light and a thin rim
// of light at its edge. Applied to the pre-exposed colour, so it reads the same by day and by night.
// lift 0..1 per instance (src/render/lift.js liftAt); tint: rgb warm colour, w strength; rim: rgb
// (times its strength), w power (recipes/world/highlight.json, src/render/lift.js liftLook).

fn liftShade(color: vec3f, n: vec3f, v: vec3f, lift: f32, tint: vec4f, rim: vec4f) -> vec3f {
  if (lift <= 0.0) { return color; }
  let edge = pow(1.0 - clamp(abs(dot(n, v)), 0.0, 1.0), max(rim.w, 0.5));
  return color * mix(vec3f(1.0), tint.rgb * (1.0 + tint.w), lift) + rim.rgb * edge * lift;
}

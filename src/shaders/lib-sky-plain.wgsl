// M0 placeholder sky radiance, in nits. Bound at group 1 binding 0 (shared lighting).
// Replaced by the physical sky LUTs in M1 S2 (docs/06).

struct SkyPlain {
  zenith: vec3f,
  glowPower: f32,
  horizon: vec3f,
  _p0: f32,
  glow: vec3f,
  _p1: f32,
  groundBounce: vec3f,
  _p2: f32,
};

fn skyRadiance(sky: SkyPlain, dir: vec3f, sunDir: vec3f) -> vec3f {
  let up = clamp(dir.y, 0.0, 1.0);
  let t = 1.0 - pow(1.0 - up, 3.0);
  var c = mix(sky.horizon, sky.zenith, t);
  let toward = max(dot(normalize(dir), sunDir), 0.0);
  c += sky.glow * pow(toward, sky.glowPower) * (1.0 - 0.6 * up);
  return c;
}

// Average radiance seen by a surface with normal n (cheap hemisphere blend).
fn skyAmbient(sky: SkyPlain, n: vec3f) -> vec3f {
  let sky_avg = mix(sky.horizon, sky.zenith, 0.5);
  return mix(sky.groundBounce, sky_avg, n.y * 0.5 + 0.5);
}

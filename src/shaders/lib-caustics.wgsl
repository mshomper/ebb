// Caustics on underwater ground (docs/07), computed the physical way. A rippled surface bends the
// sunlight entering it; where a ripple curves like a lens, the refracted rays bunch together on the
// bed and the light there is brighter, where it curves the other way they spread and it is dimmer.
// For a surface height field h and a bed at depth d, a ray entering at x lands at
//   x + k grad h(x),   k = d (1 - 1/n) gain   (small slopes, light from above, n = 1.333)
// and the light on the bed scales with 1 / |det(I + k Hessian(h))| (the Jacobian of that map; the
// light is conserved, only redistributed). Shallow water barely focuses; around half a meter deep
// the bright filaments are sharpest; deeper, the rays cross over and blur, so the contrast is
// softened by depth and finally faded out.
// The ripple field is the caustics' own: a handful of plane waves (the recipe's `waves`) with an
// exact Hessian, drifted with the current by a two-phase flow map (Vlachos 2010) so stream
// caustics run downstream.
// The result multiplies only direct light. Needs `lib-hash` included first.
// Recipe: recipes/world/water.json `caustics`.

struct Caustics {
  look: vec4f,      // x strength (0..1), y octave count (0 off), z peak depth (m), w contrast share in the shallowest water
  depthFade: vec4f, // xy fade in over these depths (m), zw fade out over these
  wave0: vec4f,     // x wave count, y shortest and z longest wavelength (m), w slope of each wave
  wave1: vec4f,     // x speed share of real water waves, y direction jitter (rad), zw spare
  wave2: vec4f,     // spare
  motion: vec4f,    // x focus gain, y flow drift (share of the water speed), z flow period (s), w projection (1: Snell)
  misc: vec4f,      // x softening floor of |det|, y extra softening per m of depth, z smallest octave's size in pixels before it fades, w spare
};

// Where the light reaching a bed point at `depth` entered the water. Snell (n = 1.333): the ray
// runs d tan(theta_t) sideways toward the light; `k` scales the run (1 is physical).
fn causticEntry(xz: vec2f, toLight: vec3f, depth: f32, k: f32) -> vec2f {
  let s2 = dot(toLight.xz, toLight.xz);   // sin^2 of the incidence angle
  return xz + toLight.xz * (depth * k / (1.333 * sqrt(max(1.0 - s2 / 1.7769, 1e-3))));
}

// Hessian (d2h/dx2, d2h/dz2, d2h/dxdz) of the ripple field at p (m): a sum of plane waves in
// scattered directions with wavelengths spread geometrically between the recipe's bounds, each
// moving at its own (slowed) water-wave speed. Plane waves have an exact Hessian and no lattice,
// so the caustic net is organic in every direction. On the low tier the finest waves are dropped.
fn causticHessian(cs: Caustics, p: vec2f, t: f32, seed: u32) -> vec3f {
  let count = select(u32(cs.wave0.x * 0.6 + 0.5), u32(cs.wave0.x + 0.5), cs.look.y > 1.5);
  var hxx = 0.0;
  var hzz = 0.0;
  var hxz = 0.0;
  for (var i = 0u; i < count; i++) {
    let h = hash3(vec3u(i, seed, 977u));
    let r = vec3f(f32(h & 1023u), f32((h >> 10u) & 1023u), f32((h >> 20u) & 1023u)) / 1023.0;
    // Directions: golden-angle steps plus a jitter, so no two waves line up.
    let ang = f32(i) * 2.3999632 + (r.x - 0.5) * cs.wave1.y;
    let dir = vec2f(cos(ang), sin(ang));
    let lambda = cs.wave0.y * pow(cs.wave0.z / cs.wave0.y, (f32(i) + r.y * 0.5) / max(f32(u32(cs.wave0.x + 0.5)) - 1.0, 1.0));
    let kk = 6.2831853 / lambda;
    let omega = cs.wave1.x * sqrt(9.81 * kk + 0.074 / 1000.0 * kk * kk * kk);
    let theta = kk * dot(dir, p) - omega * t + 6.2831853 * r.z;
    // Height a sin(theta): the Hessian is -a k^2 sin(theta) dir dir^T. Every wave bends light
    // equally (a k^2 the same; the recipe slope is the shortest wave's), so no two or three
    // dominate and beat into a regular lattice.
    let c = -cs.wave0.w * (6.2831853 / cs.wave0.y) * sin(theta);
    hxx += c * dir.x * dir.x;
    hzz += c * dir.y * dir.y;
    hxz += c * dir.x * dir.y;
  }
  return vec3f(hxx, hzz, hxz);
}

// Light focus at p for a lens strength k: 1 / |det(I + k H)|, softened by `soft` so a fold line is a
// bright filament, not a spike.
fn causticFocus(cs: Caustics, p: vec2f, k: f32, soft: f32, t: f32, seed: u32) -> f32 {
  let hs = causticHessian(cs, p, t, seed);
  let det = (1.0 + k * hs.x) * (1.0 + k * hs.y) - k * k * hs.z * hs.z;
  return 1.0 / sqrt(det * det + soft * soft);
}

// Multiplier on direct light at a bed point (about 1 on average). entry: causticEntry of the point;
// flow: the water velocity there (m/s); depth: water above the bed (m); footprint: world size of
// the pixel (m).
fn causticLight(cs: Caustics, entry: vec2f, flow: vec2f, depth: f32, footprint: f32, t: f32, seed: u32) -> f32 {
  if (cs.look.y < 0.5) { return 1.0; }
  // Contrast by depth: faint in the first centimeters, full near the focal depth, faded out deep.
  let fd = cs.depthFade;
  var contrast = cs.look.x * smoothstep(fd.x, fd.y, depth) * mix(cs.look.w, 1.0, smoothstep(fd.y, cs.look.z, depth))
               * (1.0 - smoothstep(fd.z, fd.w, depth));
  // Far away the filaments get thinner than a pixel and would shimmer: fade them out first.
  contrast *= smoothstep(0.5 * cs.misc.z, cs.misc.z, cs.wave0.y / max(footprint, 1e-5));
  if (contrast < 0.002) { return 1.0; }
  let k = depth * 0.25 * cs.motion.x;
  let soft = cs.misc.x + cs.misc.y * depth;

  // Flow drift: two copies, each sliding with the water for one period and faded out as it resets,
  // half a period apart. Still water takes one copy.
  let drift = flow * cs.motion.y;
  let period = max(cs.motion.z, 0.1);
  var focus: f32;
  if (length(drift) * period < 0.02) {
    focus = causticFocus(cs, entry, k, soft, t, seed);
  } else {
    let ph = fract(t / period + vec2f(0.0, 0.5));
    let wt = 1.0 - abs(2.0 * ph - 1.0);
    focus = causticFocus(cs, entry - drift * ((ph.x - 0.5) * period), k, soft, t, seed) * wt.x
          + causticFocus(cs, entry - drift * ((ph.y - 0.5) * period) + vec2f(5.1, 3.3), k, soft, t, seed) * wt.y;
  }
  return max(1.0 + contrast * (focus - 1.0), 0.0);
}

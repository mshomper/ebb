// Caustics on underwater ground (docs/07). Light focused by the moving water surface draws a net
// of bright, wavering lines on the bed. The pattern lives on the surface: a bed point at depth d
// reads it where its refracted light ray entered the water. Each layer is a Voronoi ridge (F2 - F1,
// bright where two cells meet) whose cell points orbit slowly, so the net wavers; two layers at
// different sizes, angles and drift directions interweave. Both drift with the local flow (the
// two-phase flow map, Vlachos 2010), so stream caustics run downstream. The result multiplies only
// direct light and averages 1: caustics move light around on the bed, they never add any.
// Needs `lib-hash` included first. Recipe: recipes/world/water.json `caustics`.

struct Caustics {
  look: vec4f,      // x strength, y layer count (0 off), z peak depth (m), w contrast share in the shallowest water
  depthFade: vec4f, // xy fade in over these depths (m), zw fade out over these
  layer0: vec4f,    // x 1 / cell size (per m), yz base scroll (m/s, world x and z), w orbit speed (rad/s)
  layer1: vec4f,
  width: vec4f,     // x line width (cells), y extra width per m of depth past the peak, zw mean fit m(w) = z w + w w^2
  motion: vec4f,    // x orbit radius (cells), y flow drift (share of the water speed), z flow period (s), w projection (1: Snell)
  misc: vec4f,      // x line width floor (pixels) before a line is filtered, y lattice warp (cells), z brightness drift along lines (0..1), w glow around a line (share of its core)
};

// Where the light reaching a bed point at `depth` entered the water. Snell (n = 1.333): the ray
// runs d tan(theta_t) sideways toward the light; `k` scales the run (1 is physical).
fn causticEntry(xz: vec2f, toLight: vec3f, depth: f32, k: f32) -> vec2f {
  let s2 = dot(toLight.xz, toLight.xz);   // sin^2 of the incidence angle
  return xz + toLight.xz * (depth * k / (1.333 * sqrt(max(1.0 - s2 / 1.7769, 1e-3))));
}

// F2 - F1 of a jittered grid (cell units) whose points circle their home spot at their own speed.
fn causticRidge(p: vec2f, t: f32, orbitSpeed: f32, orbitR: f32, seed: u32) -> f32 {
  let c = floor(p);
  let f = p - c;
  let ci = vec2i(c) + vec2i(1 << 20);
  var f1 = 8.0;
  var f2 = 8.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let o = vec2i(i, j);
      // One hash, four bytes: home spot (xy), orbit speed share and orbit phase.
      let h = hash3(vec3u(vec2u(ci + o), seed));
      let r = vec4f(f32(h & 255u), f32((h >> 8u) & 255u), f32((h >> 16u) & 255u), f32(h >> 24u)) / 255.0;
      let a = orbitSpeed * t * (0.6 + 0.8 * r.z) + 6.2831853 * r.w;
      let q = vec2f(o) + 0.2 + 0.6 * r.xy + orbitR * vec2f(cos(a), sin(a)) - f;
      let d = dot(q, q);
      f2 = min(f2, max(f1, d));
      f1 = min(f1, d);
    }
  }
  return sqrt(f2) - sqrt(f1);
}

// Slow swirl of the lattice (cell units, mean 0): bends the cell walls into the curved, uneven
// lines real caustics have instead of a straight crackle.
fn causticWarp(p: vec2f, t: f32, amount: f32, seed: u32) -> vec2f {
  let q = p * 0.45 + vec2f(0.13 * t, -0.09 * t);
  return p + amount * (vec2f(valueNoise2(q, seed + 31u), valueNoise2(q + vec2f(5.2, 1.3), seed + 32u)) - 0.5);
}

// One layer's lines: the ridge profile times a brightness that drifts along the line (mean 1),
// so some stretches glow and others fade, as focused light does.
fn causticLayer(p: vec2f, t: f32, w: f32, orbitSpeed: f32, cs: Caustics, seed: u32) -> f32 {
  let pw = causticWarp(p, t, cs.misc.y, seed);
  let ridge = causticRidge(pw, t, orbitSpeed, cs.motion.x, seed);
  // A thin bright core in a soft glow three times as wide, as focused light falls off.
  let line = 1.0 - smoothstep(0.0, w, ridge) + cs.misc.w * (1.0 - smoothstep(0.0, min(3.0 * w, 0.5), ridge));
  let glow = mix(1.0, 2.0 * valueNoise2(p * 0.8 + vec2f(0.21 * t, 0.17 * t), seed + 33u), cs.misc.z);
  return line * glow;
}

// Light share at `pos` (m) relative to the lattice, mean about m0 (+ m1 with two layers); w0 and w1
// are the layers' line widths. The layers add, so where lines cross the light doubles up.
fn causticNet(cs: Caustics, pos: vec2f, t: f32, w0: f32, w1: f32, seed: u32) -> f32 {
  let p0 = (pos - cs.layer0.yz * t) * cs.layer0.x;
  var lit = causticLayer(p0, t, w0, cs.layer0.w, cs, seed);
  if (cs.look.y > 1.5) {
    // The second lattice is turned 37 degrees so the two never line up.
    let turn = mat2x2f(0.8, 0.6, -0.6, 0.8);
    let p1 = turn * ((pos - cs.layer1.yz * t) * cs.layer1.x) + vec2f(3.1, 7.7);
    lit += causticLayer(p1, t, w1, cs.layer1.w, cs, seed + 1u);
  }
  return lit;
}

// Mean of one layer's lines at width w (cells), measured offline and fit in the recipe.
fn causticMean(w: f32, fit: vec2f) -> f32 {
  return clamp(fit.x * w + fit.y * w * w, 1e-3, 0.95);
}

// Multiplier on direct light at a bed point (mean 1). entry: causticEntry of the point; flow: the
// water velocity there (m/s); depth: water above the bed (m); footprint: world size of the pixel (m).
fn causticLight(cs: Caustics, entry: vec2f, flow: vec2f, depth: f32, footprint: f32, t: f32, seed: u32) -> f32 {
  if (cs.look.y < 0.5) { return 1.0; }
  // Contrast by depth: faint in the first centimeters, strongest near the waves' focal depth, then
  // blurred away in deep water.
  let fd = cs.depthFade;
  let contrast = cs.look.x * smoothstep(fd.x, fd.y, depth) * mix(cs.look.w, 1.0, smoothstep(fd.y, cs.look.z, depth))
               * (1.0 - smoothstep(fd.z, fd.w, depth));
  // Deep water widens the lines. Far away a pixel covers more than a line: the line widens to the
  // pixel and its contrast drops by the same share (a box filter), so the mean stays 1.
  let wDepth = cs.width.x * (1.0 + cs.width.y * max(depth - cs.look.z, 0.0));
  let w0 = min(max(wDepth, footprint * cs.misc.x * cs.layer0.x), 0.5);
  let w1 = min(max(wDepth, footprint * cs.misc.x * cs.layer1.x), 0.5);
  let two = cs.look.y > 1.5;
  let amount = contrast * wDepth / select(w0, max(w0, w1), two);
  if (amount < 0.002) { return 1.0; }
  let m0 = causticMean(w0, cs.width.zw) + cs.misc.w * causticMean(min(3.0 * w0, 0.5), cs.width.zw);
  let m1 = causticMean(w1, cs.width.zw) + cs.misc.w * causticMean(min(3.0 * w1, 0.5), cs.width.zw);
  let mean = select(m0, m0 + m1, two);

  // Flow drift: two copies, each sliding with the water for one period and faded out as it resets,
  // half a period apart. Still water (drift under a quarter line width) takes one copy.
  let drift = flow * cs.motion.y;
  let period = max(cs.motion.z, 0.1);
  var lit: f32;
  if (length(drift) * period * 0.5 < 0.25 * cs.width.x / cs.layer0.x) {
    lit = causticNet(cs, entry, t, w0, w1, seed);
  } else {
    let ph = fract(t / period + vec2f(0.0, 0.5));
    let wt = 1.0 - abs(2.0 * ph - 1.0);
    lit = causticNet(cs, entry - drift * ((ph.x - 0.5) * period), t, w0, w1, seed) * wt.x
        + causticNet(cs, entry - drift * ((ph.y - 0.5) * period), t, w0, w1, seed) * wt.y;
  }
  return max(1.0 + amount * (lit / mean - 1.0), 0.0);
}

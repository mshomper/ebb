// Raindrop rings (docs/07, 22): each drop leaves two or three fine crests that spread out and fade
// within a second, finer than the ripple field can hold. Drawn on the water (water-draw.wgsl) and in
// rain puddles (terrain-draw.wgsl). Drops fall on a world grid of cells; each cell holds one drop per
// lifetime at a hashed spot and time, and how many cells are active follows the rain. Two offset
// grids are layered, so the drops never line up. Needs `lib-hash` included first.
// Numbers: water.json `ripples.rings` (packed by the water and terrain passes).

struct RainRings {
  a: vec4f,   // x share of drop cells active (follows the rain), y cell size (m), z ring life (s), w crest spacing (m)
  b: vec4f,   // x ring radius at the end of its life (m), y crest slope
};

fn rainRingLayer(rr: RainRings, xz: vec2f, t: f32, layer: u32) -> vec2f {
  let cellM = rr.a.y;
  let life = rr.a.z;
  let k = 6.2831853 / rr.a.w;               // crest wavenumber
  let p = xz / cellM + f32(layer) * vec2f(0.37, 0.71);
  let base = floor(p);
  var g = vec2f(0.0);
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let cell = base + vec2f(f32(i), f32(j));
      let ci = vec2u(vec2i(cell) + vec2i(1 << 20));
      // A new drop every lifetime: hash the cell and which lifetime this is.
      let h0 = hash3(vec3u(ci, layer * 7919u + 3u));
      let tt = t / life + hashToFloat(h0);
      let n = u32(floor(tt));
      let age = fract(tt);                    // 0..1 through this drop's life
      let h = hash3(vec3u(ci, n * 2u + layer));
      if (hashToFloat(h) > rr.a.x) { continue; }   // fewer drops in light rain
      let spot = (cell + 0.15 + 0.7 * vec2f(hashToFloat(pcg(h)), hashToFloat(pcg(h ^ 0x9e37u)))) * cellM;
      let off = xz - spot;
      let dist = length(off);
      let radius = rr.b.x * sqrt(age);        // fast at first, slowing as it spreads
      let x = dist - radius;
      // A short train of crests just inside the front, fading as the ring ages and widens.
      let envelope = exp(-x * x / (rr.a.w * rr.a.w * 1.5)) * (1.0 - age) * (1.0 - age);
      let dh = rr.b.y * envelope * cos(k * x);   // slope along the radius
      g += off / max(dist, 1e-4) * dh;
    }
  }
  return g;
}

// Surface slope (dh/dx, dh/dz) of the raindrop rings at xz, both grids.
fn rainRings(rr: RainRings, xz: vec2f, t: f32) -> vec2f {
  if (rr.a.x <= 0.001) { return vec2f(0.0); }
  return rainRingLayer(rr, xz, t, 0u) + rainRingLayer(rr, xz, t + 0.37, 1u);
}

// How much of the rings a pixel can hold: 1 when its footprint (m) is small against the crest
// spacing, fading to 0 before the crests would shimmer.
fn rainRingsVisible(rr: RainRings, pixelM: f32) -> f32 {
  return 1.0 - smoothstep(0.25, 0.5, pixelM / rr.a.w);
}

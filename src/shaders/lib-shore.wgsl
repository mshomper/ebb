// Shore litter and kelp (docs/future/10, Z3), drawn rather than scanned, since no CC0 seaweed scan
// exists: thin strands of dried wrack along each strandline, and broad kelp blades lying downslope
// over rock at the lowest tides (and a few broken ones in the strandline). Each is a set of
// segments placed by hashing a small grid around the point, so nothing is stored and every device
// draws the same litter. A pixel too large to hold a strand gets the strands' average cover
// instead, so far views never shimmer. The including shader includes lib-hash first.

struct Litter {
  cover: f32,    // 0..1 of the pixel the litter covers
  grad: vec2f,   // height gradient (world x, z) of its relief, for the normal
  tone: f32,     // 0..1, a per-piece value for albedo variation
};

fn litterHash(c: vec2i, salt: u32) -> u32 {
  return hash3(vec3u(vec2u(c + vec2i(1 << 20)), salt));
}

// Thin strands in a grid of `cellM` cells, mostly lying along `along` (a unit vector in xz, the
// shore's direction), a `crossShare` of them turned any way. `density` 0..1 is the share of
// possible strands present here (the strandline's strength); lenM the strands' length range.
fn strandLitter(xz: vec2f, along: vec2f, density: f32, cellM: f32, lenM: vec2f, widthM: f32, crossShare: f32, pixM: f32) -> Litter {
  var o: Litter;
  o.cover = 0.0; o.grad = vec2f(0.0); o.tone = 0.5;
  let perp = vec2f(-along.y, along.x);
  let q = vec2f(dot(xz, along), dot(xz, perp));
  let base = vec2i(floor(q / cellM));
  var best = 0.0;
  for (var dj = -1; dj <= 1; dj++) {
    for (var di = -1; di <= 1; di++) {
      let c = base + vec2i(di, dj);
      for (var s = 0u; s < 2u; s++) {
        var h = litterHash(c, 0x5a1u + s);
        if (hashToFloat(h) >= density) { continue; }
        h = pcg(h); let r2 = hashToFloat(h);
        h = pcg(h); let r3 = hashToFloat(h);
        h = pcg(h); let r4 = hashToFloat(h);
        h = pcg(h); let r5 = hashToFloat(h);
        h = pcg(h); let r6 = hashToFloat(h);
        h = pcg(h); let r7 = hashToFloat(h);
        let center = (vec2f(c) + vec2f(r2, r3)) * cellM;
        let ang = select((r5 - 0.5) * 0.6, r5 * 3.14159265, r4 < crossShare);
        let dir = vec2f(cos(ang), sin(ang));
        let hl = mix(lenM.x, lenM.y, r6) * 0.5;
        let a = center - dir * hl;
        let ab = dir * (2.0 * hl);
        let t = clamp(dot(q - a, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
        let off = q - (a + ab * t);
        let d = length(off);
        let w = widthM * (0.6 + 0.8 * r7) * (1.0 - 0.5 * abs(t - 0.5));
        if (d < w && r7 + 0.001 > best) {
          best = r7 + 0.001;
          o.cover = 1.0;
          o.tone = r2;
          // A round strand: its slope across is d / sqrt(w^2 - d^2), capped so edges stay soft.
          let g = min(d / sqrt(max(w * w - d * d, 1e-8)), 2.0) * 0.5;
          let gq = off / max(d, 1e-6) * -g;
          o.grad = along * gq.x + perp * gq.y;
        }
      }
    }
  }
  // Average cover of the strands (two per cell, mean length, mean width x 2), for large pixels.
  let mean = density * 2.0 * (0.5 * (lenM.x + lenM.y)) * (2.0 * widthM) / (cellM * cellM);
  let k = smoothstep(widthM * 0.8, widthM * 3.0, pixM);
  o.cover = mix(o.cover, min(mean, 1.0), k);
  o.grad *= 1.0 - k;
  return o;
}

// Kelp blades: broad straps lying along `down` (a unit vector in xz, downslope, or along the shore
// in a strandline), tapering to tip and base, with a raised midrib, a slight curve, overlapping
// each other. Grid cells are `cell.x` across by `cell.y` along; `cover` 0..1 the share present.
// With `fromMap`, a blade is present by the shore cover's kelp (g) at its own center rather than
// `cover`, so whole blades lie across the zone's edge instead of being cut along it (this reads
// terrain-draw.wgsl's shoreTex and linearSampler).
fn kelpBlades(xz: vec2f, down: vec2f, cover: f32, cell: vec2f, lenM: vec2f, widthM: f32, relief: f32, pixM: f32, fromMap: bool) -> Litter {
  var o: Litter;
  o.cover = 0.0; o.grad = vec2f(0.0); o.tone = 0.5;
  let across = vec2f(-down.y, down.x);
  let q = vec2f(dot(xz, across), dot(xz, down));
  let base = vec2i(floor(q / cell));
  var top = -1.0;
  for (var dj = -1; dj <= 1; dj++) {
    for (var di = -1; di <= 1; di++) {
      let c = base + vec2i(di, dj);
      var h = litterHash(c, 0x6b3u);
      let r1 = hashToFloat(h);
      h = pcg(h); let r2 = hashToFloat(h);
      h = pcg(h); let r3 = hashToFloat(h);
      h = pcg(h); let r4 = hashToFloat(h);
      h = pcg(h); let r5 = hashToFloat(h);
      h = pcg(h); let r6 = hashToFloat(h);
      let len = mix(lenM.x, lenM.y, r4);
      let center = (vec2f(c) + vec2f(r2, r3)) * cell;
      var present = cover;
      if (fromMap) { present = textureSampleLevel(shoreTex, linearSampler, terrainUv(across * center.x + down * center.y), 0.0).g; }
      if (r1 >= present) { continue; }
      let t = (q.y - (center.y - 0.5 * len)) / len;
      if (t < 0.0 || t > 1.0) { continue; }
      // A gentle curve and a lean across, different for every blade, kept within a cell either side
      // (the search reaches one cell each way, so a blade that strayed further would be cut off).
      let w = widthM * (0.05 + 0.95 * sqrt(sin(3.14159265 * t))) * (0.7 + 0.3 * r6);
      let room = max(cell.x - widthM, 0.0);
      let off = room * ((r5 - 0.5) * (t - 0.5) * 1.6 + (r6 - 0.5) * (t - 0.5) * (t - 0.5) * 2.0);
      let dx = q.x - (center.x + off);
      if (abs(dx) < w && r6 > top) {
        top = r6;
        o.cover = 1.0;
        o.tone = r2;
        let f = dx / w;
        o.grad = across * (-2.0 * f / w * relief * 0.01);
      }
    }
  }
  let k = smoothstep(widthM * 0.4, widthM * 1.5, pixM);
  o.cover = mix(o.cover, min(cover * 0.9, 1.0), k);
  o.grad *= 1.0 - k;
  return o;
}

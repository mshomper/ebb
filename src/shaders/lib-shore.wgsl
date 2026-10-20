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

// Wrack fronds (bladderwrack, Fucus): narrow straps draped downslope (`down`) over rock, each
// forking once and often twice toward the tip, with paired air bladders either side of the midrib,
// overlapping into a mat. One frond per grid cell (`cell.x` across by `cell.y` along). A frond is
// present by the shore cover's wrack (r) at its own center, thinned by the same clump noise the
// mat uses (`clump`: 1 / patch and clump sizes, `seed`), so fronds lie across clump edges whole.
// `widthM` a strap's half-width, `bladderM` a bladder's radius. `tone` is 0..1 per frond, and
// above 1 on a bladder (lighter, raised). Reads terrain-draw.wgsl's shoreTex and linearSampler.
fn wrackFronds(xz: vec2f, down: vec2f, cell: vec2f, lenM: vec2f, widthM: f32, bladderM: f32, relief: f32,
               clump: vec2f, seed: u32, cover: f32, pixM: f32) -> Litter {
  var o: Litter;
  o.cover = 0.0; o.grad = vec2f(0.0); o.tone = 0.5;
  let across = vec2f(-down.y, down.x);
  let q = vec2f(dot(xz, across), dot(xz, down));
  let base = vec2i(floor(q / cell));
  // A frond strays up to two cells either side: the search reaches two cells across, one along.
  let room = max(2.0 * cell.x - widthM, 0.0) * 0.8;
  var top = -1.0;
  for (var dj = -1; dj <= 1; dj++) {
    for (var di = -2; di <= 2; di++) {
      let c = base + vec2i(di, dj);
      var h = litterHash(c, 0x7c5u);
      let r1 = hashToFloat(h);
      // Only a frond drawn over the ones found so far can change the pixel.
      if (r1 <= top) { continue; }
      h = pcg(h); let r2 = hashToFloat(h);
      h = pcg(h); let r3 = hashToFloat(h);
      h = pcg(h); let r4 = hashToFloat(h);
      let len = mix(lenM.x, lenM.y, r4);
      let center = (vec2f(c) + vec2f(r2, r3)) * cell;
      let t = (q.y - (center.y - 0.5 * len)) / len;
      if (t < 0.0 || t > 1.0) { continue; }
      h = pcg(h); let r5 = hashToFloat(h);
      h = pcg(h); let r6 = hashToFloat(h);
      h = pcg(h); let r7 = hashToFloat(h);
      // The stem leans a little; past the fork (tf) the branches part, and again past tf2.
      let tf = 0.35 + 0.2 * r5;
      let tf2 = select(2.0, tf + (1.0 - tf) * (0.45 + 0.2 * r6), r6 > 0.35);
      // A lean and a slow wave along the frond, as it lies where the water left it.
      // Fronds lie at an angle of up to about 15 degrees off downslope, so the mat has no grain.
      let lean = room * 0.45 * (r7 - 0.5) * (2.0 * t - 1.0) + widthM * 0.9 * sin(t * (5.0 + 4.0 * r6) + r7 * 6.2831853) * t;
      let s1 = room * 0.3 * clamp((t - tf) / (1.0 - tf), 0.0, 1.0);
      let s2 = room * 0.15 * clamp((t - tf2) / max(1.0 - tf2, 0.05), 0.0, 1.0);
      let x0 = q.x - (center.x + lean);
      // Distance across to the nearest strap: one stem, two branches, four tips.
      var dx = x0;
      var best = 1e9;
      for (var b = 0; b < 4; b++) {
        let side1 = select(-1.0, 1.0, (b & 1) == 1);
        let side2 = select(-1.0, 1.0, (b & 2) == 2);
        let d = x0 - side1 * s1 - side2 * s2;
        if (abs(d) < best) { best = abs(d); dx = d; }
      }
      // Straps narrow a little toward the tip and round off there; the stem is thinnest.
      let w = widthM * (0.55 + 0.45 * smoothstep(0.0, 0.25, t)) * (1.0 - 0.45 * smoothstep(0.85, 1.0, t)) * (0.8 + 0.4 * r2);
      // Paired bladders either side of the midrib, at two spots on each strap.
      let tb1 = tf * 0.75;
      let tb2 = mix(tf, 1.0, 0.45);
      let dtb = select(t - tb2, t - tb1, abs(t - tb1) < abs(t - tb2)) * len;   // along, signed
      let bxs = (abs(dx) - w * 0.55) * select(-1.0, 1.0, dx > 0.0);           // across, signed
      let bx = abs(bxs);
      let bl = length(vec2f(bx, dtb)) / max(bladderM, 1e-4);
      let onBladder = bl < 1.0 && r3 > 0.25;
      if (abs(dx) >= w && !onBladder) { continue; }
      // Present where the mat is: the wrack cover at the frond's middle, in clumps, read only for
      // a frond that covers this pixel (the costly part, so it comes last). The same clumps as
      // the mat, a little wider, so fronds lie on the mat and fringe its edges.
      let mid = across * center.x + down * center.y;
      let wr = textureSampleLevel(shoreTex, linearSampler, terrainUv(mid), 0.0).r;
      let cl = valueNoise2(mid * clump.x + vec2f(4.3, 9.1), seed + 31u) * 0.6
             + valueNoise2(mid * clump.y + vec2f(1.7, 3.3), seed + 32u) * 0.4;
      let present = min(1.0, wr * 1.3) * smoothstep(0.27, 0.55, cl + (wr - 0.5) * 0.4);
      if (r1 < present) {
        top = r1;
        o.cover = 1.0;
        o.tone = select(r2, 1.4, onBladder);
        // The midrib ridge, and a dome on a bladder.
        let f = clamp(dx / w, -1.0, 1.0);
        var g = across * (-2.0 * f / w * relief * 0.01);
        if (onBladder) { g = -(across * bxs + down * dtb) / max(bladderM * bladderM, 1e-6) * relief * 0.02; }
        o.grad = g;
      }
    }
  }
  // Fronds give way to their average once a strap is about two pixels wide, before lines form.
  let k = smoothstep(widthM * 0.35, widthM * 1.0, pixM);
  o.cover = mix(o.cover, min(cover, 1.0) * 0.8, k);
  o.grad *= 1.0 - k;
  return o;
}

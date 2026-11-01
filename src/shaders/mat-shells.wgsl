// Mats (B3a): the meadow islet's wild thyme, red clover and bird's-foot trefoil as low living
// carpets, drawn as shells with no mesh. The ground under the mats is drawn again a few times, each
// copy (an instance) a little higher, on a world grid built from vertex_index over the mats' box.
// Each copy keeps only the pixels where a leaf clump would reach that height: clumps are domes on a
// jittered cell grid, so together the copies make a lumpy carpet with real depth, and the lowest
// copy is the mat's flat color, all that is left far away. At a low look each copy marches down
// through the gap to the copy below, so the gaps never show as bands. Flowers are spots on the top copies
// while in flower. The same file draws clover's round heads on their stalks (vsHead/fsHead), from
// the clover share, a few per square meter. Lit like the grass; no palette colors here (docs/05).

// #include common
// #include lib-hash
// #include lighting-bindings
// #include lib-sky
// #include lib-terrain
// #include lib-lighting

struct MatLook {
  albedo: vec4f,   // rgb albedo this season (linear), w carpet height at full cover now (m)
  flower: vec4f,   // rgb flower albedo, w how much it is in flower now (0..1)
  shape: vec4f,    // x leaf clump size (m), y flower spot size (m), z share of spots that flower, w patch edge wobble size (m)
  extra: vec4f,    // x 1 when this channel holds a mat, y how much its flowers tint it far off now (0..1), z flower head radius (share of a spot), w a march step's reach (leaf clumps)
};

struct MatDraw {
  box: vec4f,                    // x, z of the grid's corner (m), cells across x and z
  grid: vec4f,                   // x cell size (m), y most copies, z full copies within (m), w one copy past (m)
  misc: vec4f,                   // x real seconds, y wind 0..1, z the sea's level now plus its waves (m), w seed
  misc2: vec4f,                  // xy direction the wind blows toward, z most march steps per copy (1 none)
  mats: array<MatLook, 4>,       // per channel of matTex
  heads: vec4f,                  // clover heads: x spacing (m), y, z stalk height range (m), w head radius (m)
  headColor: vec4f,              // rgb head albedo, w how much clover is in flower now (0 draws none)
  stalkColor: vec4f,             // rgb stalk albedo, w the clover's channel in matTex
  pushes: array<vec4f, 4>,       // where the walker presses the mats: x, z, radius (m), strength 0..1
  headGrid: vec4f,               // x, z of the head grid's corner (m), z heads per side, w how far heads are drawn (m)
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var<uniform> md: MatDraw;
@group(2) @binding(1) var heightTex: texture_2d<f32>;
@group(2) @binding(2) var matTex: texture_2d<f32>;      // mats 0..1, 1 m world grid from -80 m (world/growth matTex)
@group(2) @binding(3) var linearSampler: sampler;

struct ShellOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) groundN: vec3f,
  @location(2) t: f32,           // 0 the flat copy on the ground .. 1 the top copy
  @location(3) press: f32,       // how hard the walker presses here
  @location(4) slab: vec2f,      // x the carpet's height here (m), y the step in t down to the copy below (0 the flat copy)
};

struct FsOut {
  @location(0) color: vec4f,
  @location(1) normalId: vec4f,
};

const CORNERS6 = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));

fn octEncode(n: vec3f) -> vec2f {
  var p = n.xz / (abs(n.x) + abs(n.y) + abs(n.z));
  if (n.y < 0.0) { p = (1.0 - abs(p.yx)) * select(vec2f(-1.0), vec2f(1.0), p >= vec2f(0.0)); }
  return p * 0.5 + 0.5;
}

fn matsAt(xz: vec2f) -> vec4f {
  return textureSampleLevel(matTex, linearSampler, (xz + 80.0) / 192.0, 0.0);
}

fn pressAt(xz: vec2f) -> f32 {
  var press = 0.0;
  for (var i = 0; i < 4; i++) {
    let pu = md.pushes[i];
    if (pu.w <= 0.0) { continue; }
    let d = distance(xz, pu.xy);
    if (d < pu.z) { press = max(press, pu.w * (1.0 - d / pu.z) * (1.0 - d / pu.z)); }
  }
  return press;
}

fn shellNothing() -> ShellOut {
  var o: ShellOut;
  o.pos = vec4f(0.0, 0.0, -2.0, 1.0);   // outside the clip volume: the triangle is dropped
  o.world = vec3f(0.0); o.groundN = vec3f(0.0, 1.0, 0.0); o.t = 0.0; o.press = 0.0; o.slab = vec2f(0.0);
  return o;
}

/** How many copies stand at this distance from the eye: all near, one (the flat color) far off. */
fn copiesAt(dist: f32) -> f32 {
  return max(1.0, ceil(mix(md.grid.y, 1.0, smoothstep(md.grid.z, md.grid.w, dist))));
}

@vertex
fn vsShell(@builtin(vertex_index) vi: u32, @builtin(instance_index) layer: u32) -> ShellOut {
  let across = u32(md.box.z);
  let quad = vi / 6u;
  let cell = vec2f(f32(quad % across), f32(quad / across));
  let s = md.grid.x;
  let xz = md.box.xy + (cell + CORNERS6[vi % 6u]) * s;
  // Copies past the distance's count are dropped before any texture is read (the mats lie about a
  // meter above the sea; the exact height comes after). The count is the quad's, from its middle,
  // so a quad is kept or dropped whole and its copies stay flat.
  let q0 = md.box.xy + cell * s;
  let mid = q0 + 0.5 * s;
  let flatDist = distance(vec3f(mid.x, 1.0, mid.y), frame.cameraPos);
  let n = copiesAt(flatDist);
  if (f32(layer) >= n) { return shellNothing(); }
  // A quad with no mat at any corner is dropped whole.
  let m00 = matsAt(q0); let m10 = matsAt(q0 + vec2f(s, 0.0)); let m01 = matsAt(q0 + vec2f(0.0, s)); let m11 = matsAt(q0 + vec2f(s, s));
  let mx = max(max(m00, m10), max(m01, m11));
  if (max(max(mx.x, mx.y), max(mx.z, mx.w)) < 0.02) { return shellNothing(); }
  let groundH = terrainHeight(heightTex, xz);
  if (groundH < md.misc.z) { return shellNothing(); }
  let nG = terrainNormal(heightTex, xz);
  // The carpet's height here: each mat's height by its share, lower where the mat is thin.
  let m = matsAt(xz);
  var hSum = 0.0; var wSum = 0.0; var most = 0.0;
  for (var c = 0; c < 4; c++) {
    let w = m[c] * md.mats[c].extra.x;
    hSum += w * md.mats[c].albedo.w; wSum += w; most = max(most, w);
  }
  let press = pressAt(xz);
  let height = hSum / max(wSum, 1e-4) * mix(0.35, 1.0, smoothstep(0.1, 0.7, most)) * (1.0 - 0.6 * press);
  let t = select(f32(layer) / max(n - 1.0, 1.0), 0.0, n < 1.5);
  // The flat copy sits just off the ground so it never fights it; the rest climb to the top.
  let p = vec3f(xz.x, groundH, xz.y) + nG * (0.012 + height * t);
  var o: ShellOut;
  o.world = p;
  o.pos = frame.viewProj * vec4f(p, 1.0);
  o.groundN = nG;
  o.t = t;
  o.press = press;
  o.slab = vec2f(height, select(1.0 / max(n - 1.0, 1.0), 0.0, layer == 0u));
  return o;
}

/** Nearest jittered point of a cell grid: x its distance (cells), y, z two hashes, w unused. */
fn cellular(q: vec2f, seed: u32) -> vec4f {
  let base = floor(q);
  var best = vec4f(9.0, 0.0, 0.0, 0.0);
  var off = vec2f(0.0);
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let c = base + vec2f(f32(i), f32(j));
      let h = hash3(vec3u(vec2u(vec2i(c) + vec2i(1 << 20)), seed));
      let pt = c + vec2f(hashToFloat(h), hashToFloat(pcg(h)));
      let d = distance(q, pt);
      if (d < best.x) { best = vec4f(d, hashToFloat(pcg(h ^ 0x9e37u)), hashToFloat(pcg(h ^ 0x51edu)), 0.0); off = q - pt; }
    }
  }
  return vec4f(best.x, best.y, best.z, atan2(off.y, off.x));
}

struct CarpetHit {
  hit: bool,
  flower: f32,     // 1 on a flower head
  n: vec3f,        // the leaf dome's or flower's normal
  tone: f32,       // the clump's own shade (0..1)
  tint: f32,       // the flower's own shade (0..1)
  top: f32,        // the clump's top, as a share of the carpet's height
  t: f32,          // the height tested, as a share of the carpet's height
  world: vec3f,
};

/**
 * Is there carpet at this point and height (t, 0 the floor .. 1 the top) for mat `pick` at cover
 * `cov`? Leaf clumps are domes on a jittered grid, lower and fewer where the cover is thin; flowers
 * are small round heads on the carpet's top while in flower (and spots on the flat copy far off).
 */
fn carpetAt(xz: vec2f, t: f32, cov: f32, pick: i32, groundN: vec3f) -> CarpetHit {
  let seedU = u32(md.misc.w);
  let L = md.mats[pick];
  let lc = cellular(xz / L.shape.x, seedU + 101u + u32(pick) * 31u);
  let top = mix(0.45, 1.0, lc.y) * mix(0.5, 1.0, cov);
  let keepClump = lc.z < mix(0.35, 1.0, cov);
  var o = CarpetHit(true, 0.0, groundN, lc.y, 0.0, top, t, vec3f(0.0));
  if (L.flower.w > 0.0 && L.shape.y > 0.0) {
    let fc = cellular(xz / L.shape.y, seedU + 211u + u32(pick) * 13u);
    let open = fc.y < L.shape.z * L.flower.w * cov;
    let ft = (t - 0.84) / 0.16;
    let fr = select(md.mats[pick].extra.z * sqrt(max(0.0, 1.0 - ft * ft)), 0.3, t == 0.0);
    if (open && fc.x < fr) {
      let tilt = vec2f(cos(fc.w), sin(fc.w)) * (fc.x / max(fr, 1e-3));
      o.flower = 1.0; o.tint = lc.z;
      o.n = normalize(groundN + vec3f(tilt.x, 0.0, tilt.y) * 0.8);
      return o;
    }
  }
  if (t > 0.0) {
    let r = 0.78 * sqrt(max(0.0, 1.0 - (t / top) * (t / top)));
    if (!keepClump || t > top || lc.x > r) { o.hit = false; return o; }
    // The dome's slope tilts the normal outward from the clump's middle.
    let tilt = vec2f(cos(lc.w), sin(lc.w)) * (lc.x / max(r, 1e-3));
    o.n = normalize(groundN + vec3f(tilt.x, 0.0, tilt.y) * 0.9);
  } else if (cov < 0.5 && lc.z > cov * 2.0) {
    // The flat copy thins with the cover at a patch's rim (dithered by the clumps).
    o.hit = false;
  }
  return o;
}

@fragment
fn fsShell(in: ShellOut) -> FsOut {
  let xz = in.world.xz;
  let seedU = u32(md.misc.w);
  let m = matsAt(xz);
  // Which mat this pixel belongs to: the one with the most share here, its edge wobbled by a slow
  // noise so a patch's rim is ragged, never the 1 m grid's square.
  var pick = -1; var cov = 0.0;
  for (var c = 0; c < 4; c++) {
    if (md.mats[c].extra.x < 0.5) { continue; }
    let e = md.mats[c].shape.w;
    let edge = (valueNoise2(xz / e, seedU + u32(c) * 17u) - 0.5) + 0.7 * (valueNoise2(xz / (e * 4.0) + 5.3, seedU + u32(c) * 17u + 3u) - 0.5);
    let k = smoothstep(0.06, 0.8, m[c] + edge * 0.4);
    if (k > cov) { cov = k; pick = c; }
  }
  if (pick < 0 || cov <= 0.01) { discard; }
  let L = md.mats[pick];
  // March down through the gap to the copy below, in steps no longer than a share of a leaf clump
  // across the ground, so at a low angle the gap between two copies is filled by the clumps' own
  // domes instead of showing as a band; from above one step (this copy's own height) is enough.
  var steps = 1u;
  var dLen = 0.0;
  var dT = 0.0;
  let view = normalize(in.world - frame.cameraPos);
  let down = -dot(view, in.groundN);
  if (in.slab.y > 0.0 && down > 1e-3 && md.misc2.z > 1.0) {
    let drop = in.slab.x * in.slab.y;
    let run = drop / down * sqrt(max(0.0, 1.0 - down * down));
    steps = u32(clamp(ceil(run / (L.shape.x * L.extra.w)), 1.0, md.misc2.z));
    dLen = drop / down / f32(steps);
    dT = in.slab.y / f32(steps);
  }
  var hit = CarpetHit(false, 0.0, in.groundN, 0.0, 0.0, 1.0, in.t, in.world);
  for (var i = 0u; i < steps; i++) {
    let p = in.world + view * (dLen * f32(i));
    hit = carpetAt(p.xz, in.t - dT * f32(i), cov, pick, in.groundN);
    hit.world = p;
    if (hit.hit) { break; }
  }
  if (!hit.hit) { discard; }
  let t = hit.t;
  let n = hit.n;
  let flower = hit.flower;
  // Self-shade: the carpet's floor is dark, clump tops catch the light; each clump a little apart.
  let viewDist = distance(hit.world, frame.cameraPos);
  let ao = mix(0.6, 1.08, select(t / max(hit.top, 1e-3), 0.75, t == 0.0));
  var albedo = L.albedo.rgb * (0.86 + 0.3 * hit.tone) * ao;
  albedo = mix(albedo, L.flower.rgb * (0.85 + 0.3 * hit.tint), flower);
  if (t == 0.0) {
    // Far off only the flat copy is left: lit as the carpet's tops and tinted by its flowers, so
    // from above the mats read as soft drifts of their flowers' color over the sand.
    let far = smoothstep(md.grid.z, md.grid.w, viewDist);
    albedo = mix(albedo, mix(L.albedo.rgb * (0.9 + 0.25 * hit.tone), L.flower.rgb, L.extra.y), far);
  }
  albedo *= mix(1.0, 0.8, light.weather.w);
  let vis = shadowVisibility(hit.world, in.groundN, viewDist, in.pos.xy);
  let casterIsSun = dot(light.shadowDir, frame.sunDir) > 0.999;
  let sunVis = select(1.0, vis, casterIsSun);
  let moonVis = select(vis, 1.0, casterIsSun);
  let sunNl = clamp(dot(n, frame.sunDir) * 0.8 + 0.2, 0.0, 1.0);
  let moonNl = clamp(dot(n, frame.moonDir) * 0.8 + 0.2, 0.0, 1.0);
  let radiance = albedo * ((frame.sunIlluminance * sunNl * sunVis + frame.moonIlluminance * moonNl * moonVis + pointIllum(hit.world, n, 0.2)) / PI
                           + skyAmbient(n) * mix(0.6, 1.0, max(t, smoothstep(md.grid.z, md.grid.w, viewDist))));
  let color = applyAerial(radiance * frame.exposure, in.pos.xy * frame.invRenderSize, viewDist);
  // normalId: the ground's normal and the terrain's outline group, so the mats never get outlines.
  return FsOut(vec4f(color, 1.0), vec4f(octEncode(normalize(in.groundN)), 0.0, 1.0 / 3.0));
}

// ---- Clover heads ----

struct HeadOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) uv: vec2f,        // head: -1..1 across the disc; stalk: x across, y up
  @location(2) kind: f32,        // 0 stalk, 1 head
  @location(3) tint: f32,
  @location(4) groundN: vec3f,
};

fn headNothing() -> HeadOut {
  var o: HeadOut;
  o.pos = vec4f(0.0, 0.0, -2.0, 1.0);
  o.world = vec3f(0.0); o.uv = vec2f(0.0); o.kind = 0.0; o.tint = 0.0; o.groundN = vec3f(0.0, 1.0, 0.0);
  return o;
}

@vertex
fn vsHead(@builtin(vertex_index) vi: u32) -> HeadOut {
  let per = u32(md.headGrid.z);
  let head = vi / 12u;
  let k = vi % 12u;
  let cell = md.headGrid.xy / md.heads.x + vec2f(f32(head % per), f32(head / per));
  let h0 = hash3(vec3u(vec2u(vec2i(cell) + vec2i(1 << 20)), u32(md.misc.w) + 307u));
  let h1 = pcg(h0); let h2 = pcg(h1); let h3 = pcg(h2);
  let xz = (cell + vec2f(hashToFloat(h0), hashToFloat(h1))) * md.heads.x;
  if (distance(xz, frame.cameraPos.xz) > md.headGrid.w) { return headNothing(); }
  let ch = u32(md.stalkColor.w);
  let clover = matsAt(xz)[ch];
  // A head stands where clover is thick enough, more of them the thicker it is, while in flower.
  if (hashToFloat(h2) > smoothstep(0.2, 0.75, clover) * md.headColor.w) { return headNothing(); }
  let groundH = terrainHeight(heightTex, xz);
  if (groundH < md.misc.z) { return headNothing(); }
  let nG = terrainNormal(heightTex, xz);
  let press = pressAt(xz);
  let tall = mix(md.heads.y, md.heads.z, hashToFloat(h3)) * mix(0.7, 1.0, clover) * (1.0 - 0.6 * press);
  // A little lean of its own, and the wind.
  let yaw = hashToFloat(pcg(h3)) * 6.2831853;
  let sway = md.misc.y * 0.12 * (0.6 + 0.4 * sin(md.misc.x * 2.1 + hashToFloat(h1) * 6.28));
  let lean = vec2f(cos(yaw), sin(yaw)) * 0.12 + md.misc2.xy * sway;
  let base = vec3f(xz.x, groundH, xz.y);
  let topP = base + vec3f(lean.x * tall, tall, lean.y * tall);
  let toCam = normalize(frame.cameraPos - topP);
  let right = normalize(cross(vec3f(0.0, 1.0, 0.0), toCam) + vec3f(1e-4, 0.0, 0.0));
  let up = normalize(cross(toCam, right));
  let corner = CORNERS6[k % 6u] * 2.0 - 1.0;
  var o: HeadOut;
  o.groundN = nG;
  o.tint = hashToFloat(pcg(h2 ^ 0x77u));
  if (k < 6u) {
    // The stalk: a thin strip from the ground to just under the head, never under a pixel wide.
    let pixelM = distance(topP, frame.cameraPos) * 2.0 / (frame.proj[1][1] * frame.renderSize.y);
    let w = max(0.0035, pixelM * 0.8);
    let along = (corner.y + 1.0) * 0.5;
    let p = mix(base, topP, along) + right * corner.x * w * 0.5;
    o.world = p; o.uv = vec2f(corner.x, along); o.kind = 0.0;
    o.pos = frame.viewProj * vec4f(p, 1.0);
  } else {
    // The head: a disc facing the eye, shaded as a ball.
    let r = md.heads.w * mix(0.8, 1.15, o.tint);
    let c = topP + vec3f(0.0, r * 0.6, 0.0);
    let p = c + (right * corner.x + up * corner.y) * r;
    o.world = p; o.uv = corner; o.kind = 1.0;
    o.pos = frame.viewProj * vec4f(p, 1.0);
  }
  return o;
}

@fragment
fn fsHead(in: HeadOut) -> FsOut {
  var albedo = md.stalkColor.rgb;
  var n = in.groundN;
  let toCam = normalize(frame.cameraPos - in.world);
  if (in.kind > 0.5) {
    let r2 = dot(in.uv, in.uv);
    if (r2 > 1.0) { discard; }
    // A ball of tiny tube flowers: the sphere's normal, bumped by a fine floret pattern; darker
    // and browner low on the head, where the oldest florets fade.
    let right = normalize(cross(vec3f(0.0, 1.0, 0.0), toCam) + vec3f(1e-4, 0.0, 0.0));
    let up = normalize(cross(toCam, right));
    let z = sqrt(1.0 - r2);
    n = normalize(right * in.uv.x + up * in.uv.y + toCam * z);
    let floret = valueNoise2(in.uv * 6.0 + in.tint * 17.0, 401u);
    albedo = md.headColor.rgb * (0.75 + 0.45 * floret) * mix(0.7, 1.05, in.uv.y * 0.5 + 0.5);
  } else {
    n = normalize(mix(in.groundN, toCam, 0.5));
    albedo *= mix(0.6, 1.0, in.uv.y);
  }
  albedo *= mix(1.0, 0.8, light.weather.w);
  let viewDist = distance(in.world, frame.cameraPos);
  let vis = shadowVisibility(in.world, in.groundN, viewDist, in.pos.xy);
  let casterIsSun = dot(light.shadowDir, frame.sunDir) > 0.999;
  let sunVis = select(1.0, vis, casterIsSun);
  let moonVis = select(vis, 1.0, casterIsSun);
  let sunNl = clamp(dot(n, frame.sunDir) * 0.8 + 0.2, 0.0, 1.0);
  let moonNl = clamp(dot(n, frame.moonDir) * 0.8 + 0.2, 0.0, 1.0);
  let radiance = albedo * ((frame.sunIlluminance * sunNl * sunVis + frame.moonIlluminance * moonNl * moonVis + pointIllum(in.world, n, 0.2)) / PI
                           + skyAmbient(n));
  let color = applyAerial(radiance * frame.exposure, in.pos.xy * frame.invRenderSize, viewDist);
  return FsOut(vec4f(color, 1.0), vec4f(octEncode(normalize(in.groundN)), 0.0, 1.0 / 3.0));
}

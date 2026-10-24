// Water lilies (docs 10, 14): flat notched pads floating on the live water, one instance per plant
// from the growth engine's instance buffer, no mesh. Each pad is a fan of twelve triangles around
// its center with a wedge cut to the middle; every point of it sits a little above the water
// simulation's surface there (bed plus depth, interpolated like the water mesh), so pads ride the
// level as a pond fills or drains and lie on the mud where it dries. Overlapping pads stack in thin
// layers and share one slow swell, so they never cross; they turn a little and swing on their stems
// downwind, anchored to the plant. A flowering
// plant opens a cup of pointed white petals with a yellow heart. Lit like the reeds, with a waxy
// GGX sun highlight on the pads; season albedo is physical and comes from recipes/flora/lilies.json.

// #include common
// #include lib-hash
// #include lighting-bindings
// #include lib-sky
// #include lib-lighting
// #include lib-terrain
// #include lib-water
// #include lib-flora

struct LilyDraw {
  c: FloraCommon,
  shape: vec4f,     // x pads on a new plant, y pads on a full one, z spread radius (m), w pad radius (m)
  pad: vec4f,       // x pad size variation, y notch (radians), z lift above the water (m), w new spread share
  stages: vec4f,    // x pads on a seed, y pads while dormant, z dormant pad size share, w share of plants that flower
  flower: vec4f,    // x petals, y petal length (m), z cup 0..1, w heart share of the petal length
  young: vec4f,     // xyz young pad albedo (linear), w share of young pads
  petal: vec4f,     // xyz petal albedo (linear), w pad roughness
  heart: vec4f,     // xyz heart albedo (linear), w pad reflectance f0
  wind: vec4f,      // x bob (m), y turn in the wind (radians), z flowers per plant, w swing on the stem (m)
  // Pads a frog sits on (S6b-3): x the plant's hash number, y the pad, z how far it dips (m, 0 none),
  // w the bearing to the frog (radians, x = cos, z = sin). The pad tips a little toward the frog.
  pressed: array<vec4f, 4>,
};

const PAD_VERTS: u32 = 36u;      // twelve fan triangles
const MAX_PADS: u32 = 12u;
const MAX_PETALS: u32 = 12u;
const FLOWER_VERTS: u32 = 90u;   // MAX_PETALS petals of two triangles, then a six-triangle heart

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var<uniform> ld: LilyDraw;
@group(2) @binding(2) var heightTex: texture_2d<f32>;
@group(2) @binding(3) var waterDepth: texture_2d<f32>;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) albedo: vec3f,
  @location(3) look: vec3f,      // x wrap, y roughness, z f0 (0: no highlight)
};

struct FsOut {
  @location(0) color: vec4f,
  @location(1) normalId: vec4f,
};

fn nothing() -> VsOut {
  var o: VsOut;
  o.pos = vec4f(0.0, 0.0, -2.0, 1.0);   // outside the clip volume: the triangle is dropped
  o.world = vec3f(0.0); o.normal = vec3f(0.0, 1.0, 0.0); o.albedo = vec3f(0.0); o.look = vec3f(0.0);
  return o;
}

// The water surface at a world point, interpolated over the four nearest water cells that are wet
// (the water mesh runs between cell centers the same way); the ground where none is.
fn surfaceAt(xz: vec2f) -> f32 {
  let u = waterCellCoord(xz);
  let i = vec2i(floor(u));
  let f = u - floor(u);
  var sum = 0.0;
  var w = 0.0;
  for (var k = 0; k < 4; k++) {
    let o = vec2i(k & 1, k >> 1);
    let c = clamp(i + o, vec2i(0), vec2i(WATER_CELLS - 1));
    let d = textureLoad(waterDepth, c, 0).r;
    let wk = select(1.0 - f.x, f.x, o.x == 1) * select(1.0 - f.y, f.y, o.y == 1);
    if (d > 0.01) { sum += (waterBed(heightTex, c) + d) * wk; w += wk; }
  }
  let ground = terrainHeight(heightTex, xz);
  if (w < 1e-3) { return ground; }
  return max(sum / w, ground);
}

// Pads stack in 16 layers this far apart, so two that overlap never share a height.
const LAYER_M: f32 = 0.0008;

// The bob: one slow, gentle swell over the pond, the same for every pad at a point, so pads that
// overlap rise and fall together. It grows a little with the wind.
fn bobAt(xz: vec2f) -> f32 {
  let w = ld.c.wind.xy;
  let t = ld.c.wind.z;
  let a = ld.wind.x * (0.3 + ld.c.wind.w);
  return a * (0.6 * sin(dot(xz, w) * 4.0 - t * 1.3) + 0.4 * sin(dot(xz, vec2f(-w.y, w.x)) * 3.1 + t * 0.9));
}

// The bob's slope (dy/dx, dy/dz), for tilting a pad with the swell.
fn bobSlope(xz: vec2f) -> vec2f {
  let w = ld.c.wind.xy;
  let q = vec2f(-w.y, w.x);
  let t = ld.c.wind.z;
  let a = ld.wind.x * (0.3 + ld.c.wind.w);
  return a * (0.6 * 4.0 * cos(dot(xz, w) * 4.0 - t * 1.3) * w + 0.4 * 3.1 * cos(dot(xz, q) * 3.1 + t * 0.9) * q);
}

// How far a pad has swung on its stem: downwind by the wind's strength (share `reach` of the stem's
// swing), easing with slow gusts, plus a small slow wander (phase h 0..1) so calm pads still drift.
fn swing(plant: vec2f, reach: f32, h: f32) -> vec2f {
  let t = ld.c.wind.z;
  let gust = 0.75 + 0.25 * sin(t * 0.35 + dot(plant, ld.c.wind.xy) * 0.4);
  let wander = vec2f(sin(t * 0.21 + h * 6.2831853), cos(t * 0.17 + h * 4.1)) * 0.25;
  return (ld.c.wind.xy * ld.c.wind.w * gust * reach + wander) * ld.wind.w;
}

fn emit(p: vec3f, n: vec3f, albedo: vec3f, look: vec3f) -> VsOut {
  var o: VsOut;
  o.world = p;
  o.pos = frame.viewProj * vec4f(p, 1.0);
  o.normal = n;
  o.albedo = albedo;
  o.look = look;
  return o;
}

@vertex
fn vsLily(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VsOut {
  let a = plants[ii * FLORA_STRIDE];
  let b = plants[ii * FLORA_STRIDE + 1u];
  let stage = u32(round(a.w));
  let size = clamp(a.z, 0.0, 1.0);
  let seed = stage == FLORA_SEED;
  let dormant = stage == FLORA_DORMANT;
  let plantU = u32(b.y * 16777216.0);
  let salt = u32(ld.c.misc.y);
  let padsMax = min(u32(ld.shape.y), MAX_PADS);
  let spread = ld.shape.z * select(mix(ld.pad.w, 1.0, size), 0.2, seed);
  let windT = ld.c.wind.z;

  if (vi < padsMax * PAD_VERTS) {
    // ---- a pad ----
    let pad = vi / PAD_VERTS;
    let slot = vi % PAD_VERTS;
    var pads = u32(round(mix(ld.shape.x, ld.shape.y, size)));
    var scale = mix(0.45, 1.0, size);
    if (seed) { pads = u32(ld.stages.x); scale = 0.35; }
    if (dormant) { pads = min(pads, u32(ld.stages.y)); scale *= ld.stages.z; }
    if (pad >= pads) { return nothing(); }
    let h0 = hash3(vec3u(plantU, pad, salt));
    let h1 = pcg(h0);
    let h2 = pcg(h1);
    let h3 = pcg(h2);
    let v = vec4f(hashToFloat(h0), hashToFloat(h1), hashToFloat(h2), hashToFloat(h3));
    // Spread evenly over a disc (r = R sqrt(u)); pad 0 near the middle.
    let ang = v.x * 6.2831853;
    let r = spread * sqrt(v.y) * select(1.0, 0.3, pad == 0u);
    let center = a.xy + vec2f(cos(ang), sin(ang)) * r + swing(a.xy, 0.7 + 0.3 * v.z, v.w);
    let radius = ld.shape.w * scale * (1.0 - ld.pad.x * 0.5 + ld.pad.x * v.z);
    // Turn a little in the wind, each pad out of step.
    let sway = ld.c.wind.w * sin(windT * 0.7 + v.w * 6.2831853);
    let yaw = v.w * 6.2831853 + ld.wind.y * sway;
    // The fan: twelve wedges from the notch's edge around to its other edge.
    let tri = slot / 3u;
    let corner = slot % 3u;
    let notch = ld.pad.y;
    let wedge = (6.2831853 - notch) / 12.0;
    var local = vec2f(0.0);
    if (corner != 0u) {
      let t = yaw + notch * 0.5 + wedge * f32(tri + corner - 1u);
      local = vec2f(cos(t), sin(t)) * radius;
    }
    // Every point of the pad on the water at that point, plus the shared bob and its own layer, so
    // overlapping pads (of this plant or a neighbor) ride the same surface and never cross.
    let xz = center + local;
    let layer = f32((pad * 5u + plantU) % 16u);
    var p = vec3f(xz.x, surfaceAt(xz) + ld.pad.z + bobAt(xz) + layer * LAYER_M, xz.y);
    // A frog's weight: the pad dips a few millimetres, a little more on the frog's side.
    for (var k = 0u; k < 4u; k++) {
      let q = ld.pressed[k];
      if (q.z > 0.0 && u32(q.x) == plantU && u32(q.y) == pad) {
        let lean = select(0.0, dot(local / max(radius, 1e-4), vec2f(cos(q.w), sin(q.w))), corner != 0u);
        p.y -= q.z * (0.65 + 0.35 * lean);
      }
    }
    // Tilted with the bob, and slightly by hash so neighboring pads catch the sun differently.
    let g = bobSlope(center);
    let n = normalize(vec3f(-g.x + (v.z - 0.5) * 0.08, 1.0, -g.y + (v.w - 0.5) * 0.08));
    let tint = 0.85 + 0.3 * hashToFloat(pcg(h3));
    let young = hashToFloat(pcg(h3 ^ 0x9e37u)) < ld.young.w;
    let albedo = select(ld.c.albedo.xyz, ld.young.xyz, young) * tint;
    return emit(p, n, albedo, vec3f(0.1, ld.petal.w, ld.heart.w));
  }

  // ---- a flower: flowering plants only, on most plants ----
  let k = vi - padsMax * PAD_VERTS;
  let fi = k / FLOWER_VERTS;
  let slot = k % FLOWER_VERTS;
  if (stage != FLORA_FLOWERING || fi >= u32(ld.wind.z)) { return nothing(); }
  let hf = hash3(vec3u(plantU, 0x51u + fi, salt));
  if (hashToFloat(hf) > ld.stages.w) { return nothing(); }
  // Beside the middle pad, a little in from its rim.
  let fa = hashToFloat(pcg(hf)) * 6.2831853;
  let center = a.xy + vec2f(cos(fa), sin(fa)) * ld.shape.w * 0.6 * f32(fi + 1u) + swing(a.xy, 0.85, hashToFloat(hf));
  // Above the top pad layer.
  let base = vec3f(center.x, surfaceAt(center) + ld.pad.z + bobAt(center) + 16.0 * LAYER_M + 0.004, center.y);
  let len = ld.flower.y * (0.9 + 0.2 * hashToFloat(pcg(pcg(hf))));
  let petals = min(u32(ld.flower.x), MAX_PETALS);
  let up = vec3f(0.0, 1.0, 0.0);

  if (slot < MAX_PETALS * 6u) {
    let pi = slot / 6u;
    if (pi >= petals) { return nothing(); }
    let corner = slot % 6u;
    // Two rings: inner petals stand more upright and a little shorter.
    let inner = (pi & 1u) == 1u;
    let theta = fa + f32(pi) * 6.2831853 / f32(petals);
    let elev = ld.flower.z * select(0.55, 1.05, inner);
    let l = len * select(1.0, 0.85, inner);
    let dirH = vec3f(cos(theta), 0.0, sin(theta));
    let dir = dirH * cos(elev) + up * sin(elev);
    let across = vec3f(-dirH.z, 0.0, dirH.x);
    let n = normalize(up * cos(elev) - dirH * sin(elev));
    // A kite: center, one side, tip; center, tip, other side.
    let width = l * 0.36;
    var p = base;
    let c = corner % 3u;
    let sideSign = select(-1.0, 1.0, corner >= 3u);
    if ((corner < 3u && c == 1u) || (corner >= 3u && c == 2u)) { p = base + dir * (l * 0.45) + across * (width * sideSign); }
    if ((corner < 3u && c == 2u) || (corner >= 3u && c == 1u)) { p = base + dir * l; }
    return emit(p, n, ld.petal.xyz * (0.9 + 0.1 * f32(inner)), vec3f(0.35, 1.0, 0.0));
  }
  // The heart: a small raised yellow fan in the cup.
  let hk = slot - MAX_PETALS * 6u;
  let tri = hk / 3u;
  let corner = hk % 3u;
  let hr = len * ld.flower.w;
  var p = base + up * (hr * 0.6);
  if (corner != 0u) {
    let t = fa + f32(tri + corner - 1u) * 6.2831853 / 6.0;
    p = base + vec3f(cos(t) * hr, hr * 0.25, sin(t) * hr);
  }
  return emit(p, up, ld.heart.xyz, vec3f(0.3, 1.0, 0.0));
}

@fragment
fn fsLily(in: VsOut) -> FsOut {
  let color = floraShade(ld.c, in.world, normalize(in.normal), in.albedo, 1.0, in.pos.xy, in.look.x, in.look.y, in.look.z);
  return FsOut(vec4f(color, 1.0), floraNormalId());
}

// Water lilies (docs 10, 14): flat notched pads floating on the live water, one instance per plant
// from the growth engine's instance buffer, no mesh. Each pad is a fan of twelve triangles around
// its center with a wedge cut to the middle; it sits a little above the water simulation's surface
// (bed plus depth, interpolated like the water mesh), so pads ride the level as a pond fills or
// drains and lie on the mud where it dries. Pads bob and turn a little in the wind. A flowering
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
  wind: vec4f,      // x bob (m), y turn in the wind (radians), z flowers per plant, w spare
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
  let a = plants[ii * 2u];
  let b = plants[ii * 2u + 1u];
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
    let center = a.xy + vec2f(cos(ang), sin(ang)) * r;
    let radius = ld.shape.w * scale * (1.0 - ld.pad.x * 0.5 + ld.pad.x * v.z);
    // Turn and bob with the wind; each pad a little out of step.
    let sway = ld.c.wind.w * sin(windT * 0.7 + v.w * 6.2831853);
    let yaw = v.w * 6.2831853 + ld.wind.y * sway;
    let bob = ld.wind.x * (0.3 + ld.c.wind.w) * sin(windT * 1.3 + v.x * 6.2831853);
    // Stacked by index so overlapping pads never fight.
    let y = surfaceAt(center) + ld.pad.z + bob + f32(pad) * 0.0015;
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
    let p = vec3f(center.x + local.x, y, center.y + local.y);
    // A slight hashed tilt, so neighboring pads catch the sun differently.
    let n = normalize(vec3f((v.z - 0.5) * 0.08, 1.0, (v.w - 0.5) * 0.08));
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
  let center = a.xy + vec2f(cos(fa), sin(fa)) * ld.shape.w * 0.6 * f32(fi + 1u);
  let base = vec3f(center.x, surfaceAt(center) + ld.pad.z + 0.006, center.y);
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

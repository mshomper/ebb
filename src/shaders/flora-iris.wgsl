// Yellow flag iris (docs 10, 14): clumps of flat sword-leaf fans with no mesh, one instance per
// plant from the growth engine's instance buffer. A clump is a few fans; each fan's leaves lie flat
// in one upright plane (as iris leaves do), spread either side of upright and arching outward, the
// middle ones tallest, each with a slight twist so a fan seen edge-on still shows. Each leaf is
// three segments and a pointed tip (21 vertices) that sway with the wind, stiff at the base. In
// autumn the tips brown; a dormant clump keeps short brown leaves. A flowering clump carries yellow
// flowers on stalks a little above the leaves: three drooping falls and three small upright
// standards. Lit like the reeds; season albedo is physical (recipes/flora/iris.json).

// #include common
// #include lib-hash
// #include lighting-bindings
// #include lib-sky
// #include lib-lighting
// #include lib-flora

struct IrisDraw {
  c: FloraCommon,
  shape: vec4f,     // x fans in a new clump, y fans in a full one, z clump radius (m), w full leaf height (m)
  leaf: vec4f,      // x leaves on a new fan, y leaves on a full one, z leaf width (m), w fan spread (radians)
  bloom: vec4f,     // x arch (share of height), y flowers on a new clump, z on a full one, w stalk share of leaf height
  look: vec4f,      // x flower size (m), y sprout height (m), z leaves on a seed, w height variation
  look2: vec4f,     // x dormant height share, y sink below the bed (m), z root shade, w autumn tip reach
  tip: vec4f,       // xyz autumn tip albedo (linear), w stiffness 0..1
  flower: vec4f,    // xyz flower albedo (linear), w sway per unit wind
  stalk: vec4f,     // xyz stalk albedo (linear), w 1 / gust size (1/m)
  gust: vec4f,      // x gust speed (m/s), yzw spare
};

const LEAF_VERTS: u32 = 21u;     // three segments and a tip
const FLOWER_VERTS: u32 = 42u;   // a stalk quad, then six petals of two triangles

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var<uniform> ird: IrisDraw;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) albedo: vec3f,
  @location(3) ao: f32,
};

struct FsOut {
  @location(0) color: vec4f,
  @location(1) normalId: vec4f,
};

// The corners of a leaf: (side -1..1, level 0..1) for three segments and a tip.
var<private> LEAF: array<vec2f, 21> = array<vec2f, 21>(
  vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(-1.0, 0.35),
  vec2f(1.0, 0.0), vec2f(1.0, 0.35), vec2f(-1.0, 0.35),
  vec2f(-1.0, 0.35), vec2f(1.0, 0.35), vec2f(-1.0, 0.7),
  vec2f(1.0, 0.35), vec2f(1.0, 0.7), vec2f(-1.0, 0.7),
  vec2f(-1.0, 0.7), vec2f(1.0, 0.7), vec2f(-1.0, 0.9),
  vec2f(1.0, 0.7), vec2f(1.0, 0.9), vec2f(-1.0, 0.9),
  vec2f(-1.0, 0.9), vec2f(1.0, 0.9), vec2f(0.0, 1.0));
var<private> QUAD: array<vec2f, 6> = array<vec2f, 6>(
  vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(-1.0, 1.0),
  vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

fn nothing() -> VsOut {
  var o: VsOut;
  o.pos = vec4f(0.0, 0.0, -2.0, 1.0);   // outside the clip volume: the triangle is dropped
  o.world = vec3f(0.0); o.normal = vec3f(0.0, 1.0, 0.0); o.albedo = vec3f(0.0); o.ao = 1.0;
  return o;
}

fn emit(p: vec3f, n: vec3f, albedo: vec3f, ao: f32) -> VsOut {
  var o: VsOut;
  o.world = p;
  o.pos = frame.viewProj * vec4f(p, 1.0);
  o.normal = n;
  o.albedo = albedo;
  o.ao = ao;
  return o;
}

// Leaf width along its length: a little narrower at the base, full in the middle, to a point.
fn leafWidth(t: f32) -> f32 {
  if (t < 0.35) { return mix(0.75, 1.0, t / 0.35); }
  if (t < 0.7) { return 1.0; }
  return mix(1.0, 0.55, (t - 0.7) / 0.2);
}

// Where fan f of a clump stands, and its bearing (radians), from the plant's hash.
fn fanBase(plantU: u32, f: u32, salt: u32, center: vec2f, radius: f32) -> vec3f {
  let h = hash3(vec3u(plantU, f, salt));
  let ang = hashToFloat(h) * 6.2831853;
  let r = radius * hashToFloat(pcg(h)) * select(1.0, 0.25, f == 0u);
  let xz = center + vec2f(cos(ang), sin(ang)) * r;
  return vec3f(xz.x, hashToFloat(pcg(pcg(h))) * 3.14159265, xz.y);   // y carries the bearing
}

@vertex
fn vsIris(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VsOut {
  let a = plants[ii * 2u];
  let b = plants[ii * 2u + 1u];
  let stage = u32(round(a.w));
  let size = clamp(a.z, 0.0, 1.0);
  let seed = stage == FLORA_SEED;
  let dormant = stage == FLORA_DORMANT;
  let plantU = u32(b.y * 16777216.0);
  let salt = u32(ird.c.misc.y);
  let fansMax = u32(ird.shape.y);
  let leavesMax = u32(ird.leaf.y);
  let fans = select(u32(round(mix(ird.shape.x, ird.shape.y, size))), 1u, seed);
  let radius = ird.shape.z * mix(0.4, 1.0, size);
  let full = max(ird.shape.w * size, ird.look.y);
  let k = 1.0 + 3.0 * clamp(ird.tip.w, 0.0, 1.0);
  let up = vec3f(0.0, 1.0, 0.0);
  let pos = ird.c.misc.x;

  if (vi < fansMax * leavesMax * LEAF_VERTS) {
    // ---- a leaf ----
    let leafI = vi / LEAF_VERTS;
    let slot = vi % LEAF_VERTS;
    let f = leafI / leavesMax;
    let j = leafI % leavesMax;
    let leaves = select(u32(round(mix(ird.leaf.x, ird.leaf.y, size))), u32(ird.look.z), seed);
    if (f >= fans || j >= leaves) { return nothing(); }
    let fb = fanBase(plantU, f, salt, a.xy, radius);
    let bearing = fb.y;
    let d = vec3f(cos(bearing), 0.0, sin(bearing));       // in the fan's plane, across it
    let planeN = vec3f(-d.z, 0.0, d.x);                   // the fan plane's normal
    let h0 = hash3(vec3u(plantU, f * 16u + j, salt ^ 0x1e15u));
    let h1 = pcg(h0);
    let h2 = pcg(h1);
    let v = vec3f(hashToFloat(h0), hashToFloat(h1), hashToFloat(h2));
    // Spread over the fan, the middle leaves tallest and most upright.
    let s = select((f32(j) + 0.5) / f32(leaves) * 2.0 - 1.0, 0.0, leaves == 1u);
    let tilt = ird.leaf.w * (s + (v.x - 0.5) * 0.3);
    var height = full * (1.0 - ird.look.w * 0.5 + ird.look.w * v.y) * (1.0 - 0.35 * abs(s));
    if (dormant) { height *= ird.look2.x; }
    let axis = d * sin(tilt) + up * cos(tilt);
    // Arch outward on the leaf's own side, plus the wind (gusts, a little flutter per leaf).
    let gust = floraGust(ird.c, fb.xz, ird.stalk.w, ird.gust.x, v.z);
    let windV = vec3f(ird.c.wind.x, 0.0, ird.c.wind.y) * (ird.c.wind.w * ird.flower.w * gust);
    let bend = d * (select(-1.0, 1.0, s >= 0.0) * ird.bloom.x * (0.5 + abs(s))) + windV;
    let corner = LEAF[slot];
    let t = corner.y;
    let base = vec3f(fb.x, b.w - ird.look2.y, fb.z);
    let p0 = floraCurve(base, axis, bend, height, k, t);
    let tangent = floraTangent(axis, bend, k, t);
    // Flat in the fan plane, twisting a little toward the tip.
    let twist = (v.z - 0.5) * 1.4 * t;
    let side = normalize(cross(tangent, planeN));
    let n0 = normalize(cross(side, tangent));
    let sideT = side * cos(twist) + n0 * sin(twist);
    let n = n0 * cos(twist) - side * sin(twist);
    let width = max(ird.leaf.z * (0.8 + 0.4 * v.x), floraPixelM(p0) * ird.c.misc.z) * leafWidth(t);
    let p = p0 + sideT * corner.x * width * 0.5;
    // Albedo: the season's, browning from the tip in autumn and all over while dormant.
    let autumn = smoothstep(2.1, 2.9, pos) * (1.0 - smoothstep(3.9, 4.0, pos));
    let reach = ird.look2.w * autumn;
    let brown = select(smoothstep(1.0 - reach, 1.0 - reach + 0.12, t) * step(0.001, reach), 0.85, dormant);
    let tint = 0.88 + 0.24 * hashToFloat(pcg(h2));
    let albedo = mix(ird.c.albedo.xyz, ird.tip.xyz, brown) * tint * (0.85 + 0.3 * t);
    return emit(p, n, albedo, mix(ird.look2.z, 1.0, t));
  }

  // ---- a flower: flowering clumps only, one per fan at most ----
  let kf = vi - fansMax * leavesMax * LEAF_VERTS;
  let fi = kf / FLOWER_VERTS;
  let slot = kf % FLOWER_VERTS;
  let flowers = u32(round(mix(ird.bloom.y, ird.bloom.z, size)));
  if (stage != FLORA_FLOWERING || fi >= min(flowers, fans)) { return nothing(); }
  let fb = fanBase(plantU, fi, salt, a.xy, radius);
  let hs = hash3(vec3u(plantU, fi, salt ^ 0x5a1cu));
  let hv = vec2f(hashToFloat(hs), hashToFloat(pcg(hs)));
  let stalkH = full * ird.bloom.w * (0.9 + 0.2 * hv.x);
  let lean = (hv.y - 0.5) * 0.25;
  let axis = normalize(vec3f(cos(fb.y) * lean, 1.0, sin(fb.y) * lean));
  let gust = floraGust(ird.c, fb.xz, ird.stalk.w, ird.gust.x, hv.x);
  let bend = vec3f(ird.c.wind.x, 0.0, ird.c.wind.y) * (ird.c.wind.w * ird.flower.w * gust);
  let base = vec3f(fb.x, b.w - ird.look2.y, fb.z);
  let top = floraCurve(base, axis, bend, stalkH, k, 1.0);

  if (slot < 6u) {
    // The stalk: a thin camera-facing strip.
    let corner = QUAD[slot];
    let p0 = floraCurve(base, axis, bend, stalkH, k, corner.y);
    let tangent = floraTangent(axis, bend, k, corner.y);
    var side = cross(tangent, frame.cameraPos - p0);
    side = select(vec3f(1.0, 0.0, 0.0), normalize(side), length(side) > 1e-5);
    let width = max(ird.leaf.z * 0.25, floraPixelM(p0) * ird.c.misc.z);
    let n = normalize(cross(side, tangent));
    return emit(p0 + side * corner.x * width * 0.5, n, ird.stalk.xyz, mix(ird.look2.z, 1.0, corner.y));
  }
  // Six petals: three falls drooping outward, three small standards between them, upright.
  let pk = slot - 6u;
  let pi = pk / 6u;
  let corner = pk % 6u;
  let fall = pi < 3u;
  let theta = fb.y + f32(pi % 3u) * 2.0943951 + select(1.0471976, 0.0, fall);
  let elev = select(1.15, -0.55, fall);
  let l = ird.look.x * select(0.6, 1.0, fall);
  let width = l * select(0.35, 0.6, fall);
  let dirH = vec3f(cos(theta), 0.0, sin(theta));
  let dir = dirH * cos(elev) + up * sin(elev);
  let across = vec3f(-dirH.z, 0.0, dirH.x);
  let n = normalize(cross(across, dir));
  let c = corner % 3u;
  let sideSign = select(-1.0, 1.0, corner >= 3u);
  // Falls first rise a little, then droop: their widest point sits up and out from the center.
  let mid = top + dir * (l * 0.45) + up * select(0.0, l * 0.25, fall);
  var p = top;
  if ((corner < 3u && c == 1u) || (corner >= 3u && c == 2u)) { p = mid + across * (width * 0.5 * sideSign); }
  if ((corner < 3u && c == 2u) || (corner >= 3u && c == 1u)) { p = top + dir * l; }
  return emit(p, n, ird.flower.xyz * select(0.9, 1.0, fall), 1.0);
}

@fragment
fn fsIris(in: VsOut) -> FsOut {
  // The side facing the camera, leaned toward the sky: an upright leaf takes the light of the open
  // sky above it rather than only the horizon's.
  var n = normalize(in.normal);
  if (dot(n, frame.cameraPos - in.world) < 0.0) { n = -n; }
  n = normalize(n + vec3f(0.0, 0.7, 0.0));
  let color = floraShade(ird.c, in.world, n, in.albedo, in.ao, in.pos.xy, 0.45, 1.0, 0.0);
  return FsOut(vec4f(color, 1.0), floraNormalId());
}

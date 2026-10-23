// Flora (docs 10, 14): reed clumps as GPU geometry with no mesh, one instance per plant from the
// growth engine's instance buffer. A seed shows as a few short shoots; no stem stands shorter than a
// sprout. Each stem is five triangles (two segments and a tip) built from
// vertex_index, at a hashed spot in the clump (denser in the middle) with a hashed lean that fans
// outward; it sways with the wind and passing gusts, stiff at the base and freer at the top. A
// flowering clump carries brown cattail heads near the top of most stems: a short camera-facing
// band shaded like a cylinder. Stems start at the bed, so the water pass shows them through the
// water. Lit like the grass (sun and moon with shadows, sky fill, aerial perspective) with a little
// wrap; season albedo is physical and comes from recipes/flora/reeds.json (docs/05).

// #include common
// #include lib-hash
// #include lighting-bindings
// #include lib-sky
// #include lib-lighting

struct FloraDraw {
  wind: vec4f,      // xy direction the wind blows toward, z real seconds, w wind strength 0..1
  albedo: vec4f,    // xyz season stem albedo (linear), w wet darkening
  dormant: vec4f,   // xyz dormant stalk albedo (linear), w lean factor for dormant stalks
  head: vec4f,      // xyz seed head albedo (linear), w share of stems with a head
  shape: vec4f,     // x stems in a new clump, y stems in a full clump, z clump radius (m), w full height (m)
  shape2: vec4f,    // x stem width (m), y rest lean (radians), z head length (m), w head width (m)
  sway: vec4f,      // x stiffness 0..1, y sway per unit wind, z 1 / gust size (1/m), w gust speed (m/s)
  look: vec4f,      // x height variation, y gap above the head (m), z pixel width floor (pixels), w root shade
  look2: vec4f,     // x sink below the ground (m), y how much shorter outer stems are, z seed, w new clump radius share
  look3: vec4f,     // x sprout height (m): the shortest a stem stands, and a seed's shoots; y shoots on a seed; zw spare
};

// Reeds are species 0 (recipes/flora/reeds.json index). Stages as in src/world/growth/coarse.js.
const REEDS: u32 = 0u;
const STAGE_SEED: u32 = 0u;
const STAGE_FLOWERING: u32 = 4u;
const STAGE_DORMANT: u32 = 5u;
const PER_STEM: u32 = 21u;   // 15 stem corners and 6 head corners

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var<uniform> fd: FloraDraw;
// Two vec4f per plant: (x, z, size, stage), (species, hash, age, ground height).
@group(2) @binding(1) var<storage, read> plants: array<vec4f>;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,    // facing the camera, square to the stem
  @location(2) side: vec3f,      // across the stem
  @location(3) across: f32,      // -1..1 across the stem or head
  @location(4) albedo: vec3f,
  @location(5) ao: f32,          // sky fill share: the base of the clump is in its own shade
};

struct FsOut {
  @location(0) color: vec4f,
  @location(1) normalId: vec4f,
};

fn octEncode(n: vec3f) -> vec2f {
  var p = n.xz / (abs(n.x) + abs(n.y) + abs(n.z));
  if (n.y < 0.0) { p = (1.0 - abs(p.yx)) * select(vec2f(-1.0), vec2f(1.0), p >= vec2f(0.0)); }
  return p * 0.5 + 0.5;
}

// The fifteen corners of a stem: (side -1..1, level 0..1) for two segments and a tip; then the six
// corners of a seed head (side, bottom 0 to top 1).
var<private> STEM: array<vec2f, 15> = array<vec2f, 15>(
  vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(-1.0, 0.55),
  vec2f(1.0, 0.0), vec2f(1.0, 0.55), vec2f(-1.0, 0.55),
  vec2f(-1.0, 0.55), vec2f(1.0, 0.55), vec2f(-1.0, 0.9),
  vec2f(1.0, 0.55), vec2f(1.0, 0.9), vec2f(-1.0, 0.9),
  vec2f(-1.0, 0.9), vec2f(1.0, 0.9), vec2f(0.0, 1.0));
var<private> HEAD: array<vec2f, 6> = array<vec2f, 6>(
  vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(-1.0, 1.0),
  vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

fn nothing() -> VsOut {
  var o: VsOut;
  o.pos = vec4f(0.0, 0.0, -2.0, 1.0);   // outside the clip volume: the triangle is dropped
  o.world = vec3f(0.0); o.normal = vec3f(0.0, 1.0, 0.0); o.side = vec3f(1.0, 0.0, 0.0);
  o.across = 0.0; o.albedo = vec3f(0.0); o.ao = 1.0;
  return o;
}

// A point on a stem at level t: the leaning axis plus a wind bend that grows as t^k (stiff at the
// base), pulled back to the stem's length so a bent stem dips instead of stretching.
fn stemPoint(base: vec3f, axis: vec3f, bend: vec3f, height: f32, k: f32, t: f32) -> vec3f {
  let chord = axis * t + bend * pow(max(t, 1e-4), k);
  return base + chord * (height * t / max(length(chord), 1e-5));
}

// The stem's direction at level t (the derivative of the unpulled curve).
fn stemTangent(axis: vec3f, bend: vec3f, k: f32, t: f32) -> vec3f {
  return normalize(axis + bend * k * pow(max(t, 1e-3), k - 1.0));
}

@vertex
fn vsFlora(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VsOut {
  let a = plants[ii * 2u];
  let b = plants[ii * 2u + 1u];
  let species = u32(round(b.x));
  let stage = u32(round(a.w));
  let size = clamp(a.z, 0.0, 1.0);
  if (species != REEDS) { return nothing(); }
  // A seed shows as a few short shoots from the day it is planted, so the spot is easy to find.
  let seed = stage == STAGE_SEED;

  // More stems as the clump grows; stem i keeps its spot as new ones join.
  let stem = vi / PER_STEM;
  let slot = vi % PER_STEM;
  let stems = select(u32(round(mix(fd.shape.x, fd.shape.y, size))), u32(fd.look3.y), seed);
  if (stem >= stems) { return nothing(); }
  let plantU = u32(b.y * 16777216.0);
  let h0 = hash3(vec3u(plantU, stem, u32(fd.look2.z)));
  let h1 = pcg(h0);
  let h2 = pcg(h1);
  let h3 = pcg(h2);
  let h4 = pcg(h3);
  let v = vec4f(hashToFloat(h1), hashToFloat(h2), hashToFloat(h3), hashToFloat(h4));

  // Where the stem stands: radius r = R u (denser in the middle than an even spread).
  let radius = fd.shape.z * select(mix(fd.look2.w, 1.0, size), 0.25, seed);
  let ang = hashToFloat(h0) * 6.2831853;
  let rShare = v.x;
  let off = vec2f(cos(ang), sin(ang)) * radius * rShare;
  let center = a.xy;
  let xz = center + off;
  let base = vec3f(xz.x, b.w - fd.look2.x, xz.y);

  // Height: the clump's size (never under a sprout), varied per stem, outer stems a little shorter.
  let height = max(fd.shape.w * size, fd.look3.x) * (1.0 - fd.look.x * 0.5 + fd.look.x * v.y) * (1.0 - fd.look2.y * rShare);
  if (height < 0.01) { return nothing(); }

  // Rest lean in a hashed direction, fanned outward; dormant stalks lean further.
  let dormant = stage == STAGE_DORMANT;
  let yaw = v.z * 6.2831853;
  let leanDir = normalize(vec2f(cos(yaw), sin(yaw)) + vec2f(cos(ang), sin(ang)) * rShare * 1.5 + vec2f(1e-4));
  let lean = fd.shape2.y * (0.4 + 1.2 * v.w) * select(1.0, fd.dormant.w, dormant);
  let axis = vec3f(leanDir.x * sin(lean), cos(lean), leanDir.y * sin(lean));
  // Wind: passing gusts plus a little flutter per stem; the bend at the tip is a share of the height.
  let gustPhase = dot(center, fd.wind.xy) * fd.sway.z - fd.wind.z * fd.sway.w * fd.sway.z;
  let gust = 0.6 + 0.4 * sin(gustPhase * 6.2831853) + 0.25 * sin(fd.wind.z * 1.7 + v.y * 6.2831853);
  let bendShare = fd.wind.w * fd.sway.y * gust;
  let bend = vec3f(fd.wind.x, 0.0, fd.wind.y) * bendShare;
  let k = 1.0 + 3.0 * clamp(fd.sway.x, 0.0, 1.0);

  let tint = 0.85 + 0.3 * hashToFloat(pcg(h4));
  let toCamRoot = frame.cameraPos - base;
  let pixelM = length(toCamRoot) * 2.0 / (frame.proj[1][1] * frame.renderSize.y);

  var corner: vec2f;
  var t: f32;
  var width: f32;
  var albedo: vec3f;
  var ao: f32;
  var lift = 0.0;   // toward the camera (m): a head sits in front of its stem
  if (slot < 15u) {
    corner = STEM[slot];
    t = corner.y;
    width = max(fd.shape2.x * (0.8 + 0.4 * v.w), pixelM * fd.look.z) * (1.0 - 0.6 * t);
    albedo = select(fd.albedo.xyz, fd.dormant.xyz, dormant) * tint * (0.85 + 0.3 * t);
    ao = mix(fd.look.w, 1.0, t);
  } else {
    // Seed heads: flowering clumps only, on most stems, just below the stem's tip.
    if (stage != STAGE_FLOWERING || hashToFloat(pcg(h3 ^ 0x68e3u)) > fd.head.w) { return nothing(); }
    corner = HEAD[slot - 15u];
    let t1 = clamp(1.0 - fd.look.y / height, 0.5, 1.0);
    let t0 = max(t1 - fd.shape2.z / height, 0.3);
    t = mix(t0, t1, corner.y);
    width = max(fd.shape2.w, pixelM * fd.look.z * 1.5);
    lift = width * 0.5;
    albedo = fd.head.xyz * tint;
    ao = 1.0;
  }

  let p0 = stemPoint(base, axis, bend, height, k, t);
  let tangent = stemTangent(axis, bend, k, t);
  let toCam = frame.cameraPos - p0;
  var side = cross(tangent, toCam);
  side = select(vec3f(1.0, 0.0, 0.0), normalize(side), length(side) > 1e-5);
  let facing = normalize(cross(side, tangent));
  let p = p0 + side * corner.x * width * 0.5 + facing * lift;

  var o: VsOut;
  o.world = p;
  o.pos = frame.viewProj * vec4f(p, 1.0);
  o.normal = facing;
  o.side = side;
  o.across = corner.x;
  o.albedo = albedo;
  o.ao = ao;
  return o;
}

@fragment
fn fsFlora(in: VsOut) -> FsOut {
  // Round across the stem (and the head): the normal turns from facing to sideways at the edges.
  let n = normalize(normalize(in.normal) + normalize(in.side) * in.across * 0.9);
  let albedo = in.albedo * mix(1.0, fd.albedo.w, light.weather.w);
  let viewDist = distance(in.world, frame.cameraPos);
  let vis = shadowVisibility(in.world, n, viewDist, in.pos.xy);
  let casterIsSun = dot(light.shadowDir, frame.sunDir) > 0.999;
  let sunVis = select(1.0, vis, casterIsSun);
  let moonVis = select(vis, 1.0, casterIsSun);
  // A little wrap: thin stems pass some light through.
  let sunNl = clamp(dot(n, frame.sunDir) * 0.8 + 0.2, 0.0, 1.0);
  let moonNl = clamp(dot(n, frame.moonDir) * 0.8 + 0.2, 0.0, 1.0);
  let radiance = albedo * ((frame.sunIlluminance * sunNl * sunVis + frame.moonIlluminance * moonNl * moonVis + pointIllum(in.world, n, 0.2)) / PI
                           + skyAmbient(n) * in.ao);
  let color = applyAerial(radiance * frame.exposure, in.pos.xy * frame.invRenderSize, viewDist);
  // normalId: outline group 0 (no lines), with an upright normal so the ground beside a clump
  // sees no normal edge either.
  return FsOut(vec4f(color, 1.0), vec4f(octEncode(vec3f(0.0, 1.0, 0.0)), 0.0, 0.0));
}

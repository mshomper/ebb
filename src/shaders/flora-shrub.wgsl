// Shrubs (docs 10, 14): grey willow and gorse, the same shader with other recipe numbers (gorse is
// evergreen, its cards drawn closer to the crown's surface into a dense mound of fine needles, with
// yellow pea flowers among them by the season's share). A many-stemmed bush with no mesh, one instance per plant from the growth engine's
// instance buffer: a light, shader-only stand-in for doc 10's L-system. Stems rise from a stool,
// leaning out so the outer ones reach the crown's edge, arching and forking once or twice; every
// stem, fork and card is placed from the plant's hash, so no two shrubs match. Stems are tapering
// camera-facing ribbons, stiff in the wind. Along the outer part of each stem and fork sit cards
// facing the camera, each cut in the fragment shader into a spray: a twig, two twiglets, then
// leaves on a jittered grid or catkins along the twigs. The crown is lit as one mass with an
// ellipsoid's normal (as thrift's dome), darker toward its middle; its leaves flutter.
//
// Seasons come from the recipe's windows and the season position: leaves come out over the
// leaf-out window, turn with the season albedo and fall over the leaf-fall window; a flowering
// shrub carries catkins on its bare twigs, silver as they open, then yellow with pollen (male) or
// green (female); a dormant one stands bare, its young twigs red-brown. Physical albedo
// (recipes/flora/willow.json); the palette comes only at the tonemap.
//
// A second pair of entry points draws each shrub's soft contact shadow: a disc draped on the ground
// under the crown that darkens what is there (flora casts no shadows yet; trees in M4 will).

// #include common
// #include lib-hash
// #include lighting-bindings
// #include lib-sky
// #include lib-lighting
// #include lib-terrain
// #include lib-flora

struct ShrubDraw {
  c: FloraCommon,
  shape: vec4f,    // x stems on a new shrub, y on a full one, z full height (m), w full crown radius (m)
  stem: vec4f,     // x stool radius (m), y stem width at the base (m), z twig width (m), w share of the crown's reach the stems' lean gives
  fork: vec4f,     // x forks per stem on a new shrub, y on a full one, z fork angle (radians), w arch (share of height)
  forkAt: vec4f,   // x first fork, y last fork (share of the stem's length), z height variation, w crown middle (share of height)
  card: vec4f,     // x cards per branch, y card size (m), z leaf length (m), w leaf width (share of its length)
  spray: vec4f,    // x leaf grid (cells across a card), y catkins per card, z catkin length (m), w sprout height (m)
  leaves: vec4f,   // leaf-out from x to y, leaf fall from z to w (season positions); x < 0: evergreen
  bloom: vec4f,    // x, y flowering window (season positions), z share of shrubs that are male, w root shade
  bark: vec4f,     // xyz bark albedo (linear), w inner shade (the crown's middle)
  twig: vec4f,     // xyz young twig albedo (linear), w stiffness 0..1
  catkin: vec4f,   // xyz catkins as they open (linear), w stem sway per unit wind (share of height)
  pollen: vec4f,   // xyz male catkins ripe with pollen (linear), w leaf flutter per unit wind
  female: vec4f,   // xyz female catkins ripe (linear), w gust speed (m/s)
  shadow: vec4f,   // x 1 / gust size (1/m), y contact shadow strength, z its radius (share of the crown's), w its strength when bare (share)
  shadow2: vec4f,  // x shift away from the sun (share of height), y lift above the ground (m), z share of leaves showing their pale undersides, w spare
  shadow3: vec4f,  // x contact shadow layers, y height between layers (m), z phenology jitter (seasons, each way), w spare
  flower: vec4f,   // xyz flower albedo (linear), w flower size (m): gorse's pea flowers over its leafy crown
  mound: vec4f,    // x share of leaf cells in flower now (0: none, as willow), y how far cards are drawn to the crown's surface, zw spare
};

const TRUNK_VERTS: u32 = 24u;    // four segments
const FORK_VERTS: u32 = 18u;     // three segments
const STEM_VERTS: u32 = 60u;     // a stem and two forks
const CARD_VERTS: u32 = 6u;
const BRANCHES: u32 = 3u;        // a stem and its two forks each carry cards
const SHADOW_SEGS: u32 = 16u;    // a fan of 16 triangles, then a ring of 16 quads: 144 vertices a layer

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var<uniform> sd: ShrubDraw;
@group(2) @binding(2) var heightTex: texture_2d<f32>;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,     // a stem's, or the crown's at a card
  @location(2) albedo: vec3f,     // a stem's; a card's leaf albedo
  @location(3) uv: vec2f,         // across a card (-1..1)
  @location(4) look: vec4f,       // x ao, y card half size (m; 0 on a stem), z leaf cover, w leaf growth
  @location(5) @interpolate(flat) spray: vec4u,  // x card hash, y catkins (0 none, 1 male, 2 female), z catkin progress x 1000
};

struct FsOut {
  @location(0) color: vec4f,
  @location(1) normalId: vec4f,
};

// A ribbon segment's corners: (side -1..1, 0 at its start, 1 at its end).
var<private> QUAD: array<vec2f, 6> = array<vec2f, 6>(
  vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(-1.0, 1.0),
  vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
// A card's corners (-1..1).
var<private> CARD: array<vec2f, 6> = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
  vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
// Levels along a stem's four segments and a fork's three.
var<private> TRUNK_T: array<f32, 5> = array<f32, 5>(0.0, 0.3, 0.55, 0.78, 1.0);
var<private> FORK_T: array<f32, 4> = array<f32, 4>(0.0, 0.4, 0.72, 1.0);
// The contact shadow's rings: its middle, halfway out, its rim.
var<private> SHADOW_RHO: array<f32, 3> = array<f32, 3>(0.0, 0.5, 1.0);

fn salt() -> u32 { return u32(sd.c.misc.y); }

fn nothing() -> VsOut {
  var o: VsOut;
  o.pos = vec4f(0.0, 0.0, -2.0, 1.0);   // outside the clip volume: the triangle is dropped
  o.world = vec3f(0.0); o.normal = vec3f(0.0, 1.0, 0.0); o.albedo = vec3f(0.0);
  o.uv = vec2f(0.0); o.look = vec4f(1.0, 0.0, 0.0, 0.0); o.spray = vec4u(0u);
  return o;
}

fn emit(p: vec3f, n: vec3f, albedo: vec3f, ao: f32) -> VsOut {
  var o = nothing();
  o.world = p;
  o.pos = frame.viewProj * vec4f(p, 1.0);
  o.normal = n;
  o.albedo = albedo;
  o.look.x = ao;
  return o;
}

// Across a thin part at p running along dir, facing the camera.
fn facingSide(p: vec3f, dir: vec3f) -> vec3f {
  let s = cross(dir, frame.cameraPos - p);
  return select(vec3f(1.0, 0.0, 0.0), normalize(s), length(s) > 1e-6);
}

struct Shrub {
  center: vec3f,   // the stool's middle, on the ground
  size: f32,
  height: f32,     // m
  crownR: f32,     // m
  stems: u32,
  plantU: u32,
  windV: vec3f,    // the wind's push now: direction x strength x gust
  stage: u32,
  pos: f32,        // the season position on this plant's own calendar (world/growth/phenology.js)
};

fn shrubOf(ii: u32) -> Shrub {
  let a = plants[ii * 2u];
  let b = plants[ii * 2u + 1u];
  var s: Shrub;
  s.stage = u32(round(a.w));
  s.size = clamp(a.z, 0.0, 1.0);
  s.plantU = u32(b.y * 16777216.0);
  s.center = vec3f(a.x, b.w, a.y);
  let hv = hashToFloat(hash2(vec2u(s.plantU, 0x5ab1u)));
  let seed = s.stage == FLORA_SEED;
  // Size reveals the shrub: height and crown grow with it, never under a sprout's height.
  s.height = max(sd.shape.z * s.size * (1.0 - sd.forkAt.z * 0.5 + sd.forkAt.z * hv), sd.spray.w);
  s.crownR = max(sd.shape.w * s.size, s.height * 0.3);
  s.stems = select(u32(round(mix(sd.shape.x, sd.shape.y, s.size))), 2u, seed);
  let gust = floraGust(sd.c, s.center.xz, sd.shadow.x, sd.female.w, hv);
  s.windV = vec3f(sd.c.wind.x, 0.0, sd.c.wind.y) * (sd.c.wind.w * gust);
  // The plant's own calendar: the same offset the growth step reads its stage windows with, from the
  // same hash (b.y), so leaves fall before the plant goes dormant on every bush.
  let p = sd.c.misc.x - sd.shadow3.z * (2.0 * b.y - 1.0);
  s.pos = p - floor(p / 4.0) * 4.0;
  return s;
}

struct Branch {
  base: vec3f,
  axis: vec3f,
  bend: vec3f,
  length: f32,
  k: f32,          // stiffness exponent of the bend (floraCurve)
  w0: f32,         // width at its base (m)
  w1: f32,         // width at its tip (m)
  on: bool,
};

// Stem i of a shrub: where it rises on the stool, how far it leans out (the outer stems reach the
// crown's edge), its arch outward and its sway, all from the plant's hash.
fn stemOf(s: Shrub, i: u32) -> Branch {
  let h0 = hash3(vec3u(s.plantU, i, salt()));
  let h1 = pcg(h0);
  let h2 = pcg(h1);
  let h3 = pcg(h2);
  let v = vec4f(hashToFloat(h0), hashToFloat(h1), hashToFloat(h2), hashToFloat(h3));
  let turn = hashToFloat(hash2(vec2u(s.plantU, 0x77e1u))) * 6.2831853;
  let az = turn + (f32(i) + 0.6 * v.x) / f32(max(s.stems, 1u)) * 6.2831853;
  let out = vec3f(cos(az), 0.0, sin(az));
  // Most stems lean a little, a few far out: the crown fills from the middle to its rim.
  let reach = s.crownR * sd.stem.w * (0.1 + 0.9 * v.z * v.z);
  let lean = atan2(reach, s.height);
  var br: Branch;
  br.base = s.center + out * (sd.stem.x * mix(0.3, 1.0, s.size) * (0.25 + 0.75 * v.y)) - vec3f(0.0, 0.03, 0.0);
  br.axis = out * sin(lean) + vec3f(0.0, cos(lean), 0.0);
  br.length = s.height * (0.82 + 0.18 * v.w) / cos(lean);
  br.k = 1.0 + 3.0 * clamp(sd.twig.w, 0.0, 1.0);
  br.bend = out * sd.fork.w + s.windV * sd.catkin.w;
  br.w0 = sd.stem.y * mix(0.3, 1.0, s.size);
  br.w1 = sd.stem.z * 1.5;
  br.on = true;
  return br;
}

// Fork j of stem i: present on most grown stems (more forks as the shrub grows), leaving the stem
// at its own level on alternate sides, turned up as willow shoots do, swaying more than the stem.
fn forkOf(s: Shrub, i: u32, j: u32, stem: Branch) -> Branch {
  let h0 = hash3(vec3u(s.plantU, i * 4u + j, salt() ^ 0x3c1du));
  let h1 = pcg(h0);
  let h2 = pcg(h1);
  let v = vec3f(hashToFloat(h0), hashToFloat(h1), hashToFloat(h2));
  let hf = hashToFloat(hash3(vec3u(s.plantU, i, salt() ^ 0x0f0fu)));
  let forks = min(u32(floor(mix(sd.fork.x, sd.fork.y, s.size) + hf)), u32(sd.fork.y));
  var br = stem;
  br.on = j < forks;
  let tf = mix(sd.forkAt.x, sd.forkAt.y, (f32(j) + 0.3 + 0.4 * v.x) / f32(max(forks, 1u)));
  let p = floraCurve(stem.base, stem.axis, stem.bend, stem.length, stem.k, tf);
  let tn = floraTangent(stem.axis, stem.bend, stem.k, tf);
  let c = cross(tn, vec3f(0.0, 1.0, 0.0));
  let side0 = select(vec3f(1.0, 0.0, 0.0), normalize(c), length(c) > 1e-4);
  let ring = cross(side0, tn);
  let phi = select(0.0, 3.14159265, (j & 1u) == 1u) + v.y * 3.14159265;
  let perp = side0 * cos(phi) + ring * sin(phi);
  var axis = normalize(tn * cos(sd.fork.z) + perp * sin(sd.fork.z));
  axis = normalize(axis + vec3f(0.0, max(0.0, 0.35 - axis.y), 0.0));
  br.base = p;
  br.axis = axis;
  br.length = stem.length * (1.0 - tf) * (0.7 + 0.35 * v.z);
  br.bend = vec3f(axis.x, 0.0, axis.z) * (sd.fork.w * 1.5) + s.windV * (sd.catkin.w * 1.6);
  br.w0 = mix(stem.w0, stem.w1, tf) * 0.75;
  br.w1 = sd.stem.z;
  return br;
}

// How much of the crown is in leaf now: out over the leaf-out window, down over the leaf fall;
// always on an evergreen (leaves.x < 0), never while dormant.
fn leafCover(stage: u32, pos: f32) -> f32 {
  if (sd.leaves.x < 0.0) { return 1.0; }
  if (stage == FLORA_DORMANT) { return 0.0; }
  return smoothstep(sd.leaves.x, sd.leaves.y, pos) * (1.0 - smoothstep(sd.leaves.z, sd.leaves.w, pos));
}

// How far the leaves have grown: small as they come out, full a little after the leaf-out window.
fn leafGrowth(pos: f32) -> f32 {
  if (sd.leaves.x < 0.0) { return 1.0; }
  return mix(0.35, 1.0, smoothstep(sd.leaves.x, sd.leaves.y + 0.2, pos));
}

// How far through the flowering window the season is, 0..1 (the window may wrap past winter).
fn bloomProgress(pos: f32) -> f32 {
  var span = sd.bloom.y - sd.bloom.x;
  if (span <= 0.0) { span += 4.0; }
  var d = pos - sd.bloom.x;
  if (d < 0.0) { d += 4.0; }
  return clamp(d / span, 0.0, 1.0);
}

@vertex
fn vsShrub(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VsOut {
  let sh = shrubOf(ii);
  let up = vec3f(0.0, 1.0, 0.0);
  let stemsMax = u32(sd.shape.y);
  let stemPart = stemsMax * STEM_VERTS;

  if (vi < stemPart) {
    // ---- a stem or a fork: a tapering ribbon, bark at the base, red-brown young wood above ----
    let i = vi / STEM_VERTS;
    let k = vi % STEM_VERTS;
    if (i >= sh.stems) { return nothing(); }
    let stem = stemOf(sh, i);
    var br = stem;
    var t0 = 0.0;
    var t1 = 0.0;
    var slot = 0u;
    var young = 0.0;
    if (k < TRUNK_VERTS) {
      let seg = k / 6u;
      slot = k % 6u;
      t0 = TRUNK_T[seg];
      t1 = TRUNK_T[seg + 1u];
    } else {
      let f = (k - TRUNK_VERTS) / FORK_VERTS;
      let r = (k - TRUNK_VERTS) % FORK_VERTS;
      br = forkOf(sh, i, f, stem);
      if (!br.on) { return nothing(); }
      t0 = FORK_T[r / 6u];
      t1 = FORK_T[r / 6u + 1u];
      slot = r % 6u;
      young = 0.5;
    }
    let corner = QUAD[slot];
    let t = mix(t0, t1, corner.y);
    let p0 = floraCurve(br.base, br.axis, br.bend, br.length, br.k, t);
    let tangent = floraTangent(br.axis, br.bend, br.k, t);
    let side = facingSide(p0, tangent);
    let width = max(mix(br.w0, br.w1, t), floraPixelM(p0) * sd.c.misc.z);
    let albedo = mix(sd.bark.xyz, sd.twig.xyz, smoothstep(0.45, 1.0, max(t, young)));
    let ao = mix(sd.bloom.w, 1.0, smoothstep(0.0, 0.5, (p0.y - sh.center.y) / sh.height)) * (1.0 - 0.4 * sd.bark.w);
    return emit(p0 + side * corner.x * width * 0.5, normalize(cross(side, tangent)), albedo, ao);
  }

  // ---- a card: a spray of leaves or catkins on a twig toward the tip of a stem or fork ----
  let cardsPer = max(u32(sd.card.x), 1u);
  let kc = vi - stemPart;
  let ci = kc / CARD_VERTS;
  let slot = kc % CARD_VERTS;
  let i = ci / (BRANCHES * cardsPer);
  let rem = ci % (BRANCHES * cardsPer);
  let bi = rem / cardsPer;
  let cn = rem % cardsPer;
  if (i >= sh.stems) { return nothing(); }
  let stem = stemOf(sh, i);
  var br = stem;
  // Leafy nearly to the foot, as a willow bush is, the cards thickest toward the tips.
  var tLo = 0.22;
  var tHi = 1.0;
  if (bi > 0u) {
    let fb = forkOf(sh, i, bi - 1u, stem);
    // A fork that is not there gives its cards to the stem, between the stem's own.
    if (fb.on) { br = fb; tLo = 0.15; } else { tLo = 0.3; tHi = 0.94; }
  }
  let hc = hash3(vec3u(sh.plantU, ci, salt() ^ 0x9e37u));
  let v = vec4f(hashToFloat(hc), hashToFloat(pcg(hc)), hashToFloat(pcg(pcg(hc))), hashToFloat(pcg(pcg(pcg(hc)))));
  let t = mix(tLo, tHi, clamp((f32(cn) + 0.5 + (v.x - 0.5) * 0.8) / f32(cardsPer), 0.0, 1.0));
  let at = floraCurve(br.base, br.axis, br.bend, br.length, br.k, t);
  let tangent = floraTangent(br.axis, br.bend, br.k, t);
  let hs = sd.card.y * 0.5 * mix(0.4, 1.0, sh.size) * (0.85 + 0.3 * v.y);
  // Facing the camera, its twig carrying on the way the branch runs on screen (give or take), and
  // fluttering with the wind.
  let right = vec3f(frame.view[0][0], frame.view[1][0], frame.view[2][0]);
  let upv = vec3f(frame.view[0][1], frame.view[1][1], frame.view[2][1]);
  let onScreen = vec2f(dot(tangent, right), dot(tangent, upv));
  let windS = length(sh.windV);
  let flutter = sd.pollen.w * windS * sin(sd.c.wind.z * (5.0 + 4.0 * v.w) + v.w * 6.2831853);
  let ang = atan2(onScreen.x, max(onScreen.y, -0.2)) * 0.6 + (v.z - 0.5) * 1.3 + flutter * 0.5;
  let U = upv * cos(ang) + right * sin(ang);
  let R = right * cos(ang) - upv * sin(ang);
  let outward = vec3f(at.x - sh.center.x, 0.0, at.z - sh.center.z);
  let outN = select(vec3f(0.0), normalize(outward), length(outward) > 1e-4);
  // The crown: an ellipsoid around the upper stems. Each spray is drawn a little toward its
  // surface, so the bush reads as one rounded mass.
  let cc = sh.center + up * (sh.height * sd.forkAt.w);
  let radii = vec3f(sh.crownR * 1.05, sh.height * (1.0 - sd.forkAt.w) * 1.05, sh.crownR * 1.05);
  var mid = at + U * (hs * 0.85) + outN * (hs * 0.3);
  let e0 = (mid - cc) / radii;
  if (length(e0) > 1e-3) { mid = mix(mid, cc + normalize(e0) * radii * 0.92, sd.mound.y * smoothstep(0.3, 0.8, sh.size)); }
  mid += sh.windV * (sd.pollen.w * 0.04 * sin(sd.c.wind.z * 3.0 + v.y * 6.2831853));
  let corner = CARD[slot];
  let p = mid + (R * corner.x + U * corner.y) * hs;
  // Lit as one mass: the crown ellipsoid's normal at the card, a little toward the sky, darker
  // toward the crown's middle and its foot.
  let e = (mid - cc) / radii;
  let n = normalize(mix(normalize(e / radii), up, 0.2));
  let q = length(e);
  let ao = mix(1.0 - sd.bark.w, 1.0, smoothstep(0.25, 1.0, q)) * mix(sd.bloom.w, 1.0, smoothstep(0.0, 0.45, (mid.y - sh.center.y) / sh.height));
  var o = emit(p, n, sd.c.albedo.xyz * (0.88 + 0.24 * v.w), ao);
  o.uv = corner;
  o.look = vec4f(ao, hs, leafCover(sh.stage, sh.pos), leafGrowth(sh.pos));
  // Catkins while the shrub flowers, male or female by the plant's hash.
  var catkins = 0u;
  if (sh.stage == FLORA_FLOWERING) {
    catkins = select(2u, 1u, hashToFloat(hash2(vec2u(sh.plantU, 0x3a1eu))) < sd.bloom.z);
  }
  // Flowers among the leaves (gorse; none on willow): this season's share, on bushes past young.
  let flowers = u32(sd.mound.x * smoothstep(0.4, 0.8, sh.size) * 1000.0);
  o.spray = vec4u(hc, catkins, u32(bloomProgress(sh.pos) * 1000.0), flowers);
  return o;
}

// Distance from p to the segment a..b.
fn segDist(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let ab = b - a;
  let t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return length(p - a - ab * t);
}

// What a card shows at a point (w 0: nothing). Leaves first, one to a cell of a jittered grid,
// fewer toward the card's rim so it reads as a rounded spray, pointing out from the twig and up;
// then catkins along the twig and twiglets, alternate sides; then the twigs. px is a pixel in card
// units: thin parts stay at least about a pixel wide, so far shrubs keep their twigs.
fn sprayAt(in: VsOut, px: f32) -> vec4f {
  let uv = in.uv;
  let seed = in.spray.x;
  let hs = in.look.y;
  let j = vec3f(hashToFloat(pcg(seed ^ 0x11u)), hashToFloat(pcg(seed ^ 0x22u)), hashToFloat(pcg(seed ^ 0x33u)));
  // The twig up the middle and two twiglets off it, a little different on every card.
  let a0 = vec2f(0.0, -1.0);
  let b0 = vec2f(0.05 * (j.x - 0.5), 0.9);
  let a1 = vec2f(0.0, -0.4 + 0.2 * j.x);
  let b1 = vec2f(-0.55 - 0.2 * j.y, 0.35 + 0.3 * j.z);
  let a2 = vec2f(0.0, 0.05 + 0.2 * j.y);
  let b2 = vec2f(0.5 + 0.2 * j.z, 0.7 + 0.2 * j.x);

  let cover = in.look.z;
  if (cover > 0.0) {
    let g = max(sd.spray.x, 1.0);
    let cell = floor((uv * 0.5 + 0.5) * g);
    let len = min(sd.card.z / max(hs, 1e-3), 0.9) * in.look.w;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let cc = cell + vec2f(f32(dx), f32(dy));
        if (any(cc < vec2f(0.0)) || any(cc >= vec2f(g))) { continue; }
        let hl = hash3(vec3u(seed, u32(cc.x) + u32(cc.y) * 16u, 0x1eafu));
        let r0 = hashToFloat(hl);
        let r1 = hashToFloat(pcg(hl));
        let r2 = hashToFloat(pcg(pcg(hl)));
        let r3 = hashToFloat(pcg(pcg(pcg(hl))));
        let base = ((cc + 0.5 + (vec2f(r1, r2) - 0.5) * 0.7) / g) * 2.0 - 1.0;
        // The fallen (autumn) and not yet out (spring) ones are gone.
        let keep = cover * (1.0 - smoothstep(0.65, 1.05, length(base)));
        if (r0 >= keep) { continue; }
        // Some cells hold a small pea flower in place of a leaf (gorse): rounded, brighter at its
        // middle, a little out from the twig. Willow's share is 0, so it never gets here.
        let bloom = f32(in.spray.w) / 1000.0;
        if (bloom > 0.0 && hashToFloat(pcg(hl ^ 0xf10eu)) < bloom) {
          let fr = max(0.5 * sd.flower.w / max(hs, 1e-3) * (0.8 + 0.4 * r2), px * 0.9);
          let fd = normalize(vec2f(base.x, 1.0));
          let fq = uv - (base + fd * fr);
          let fe = (dot(fq, fq) + 0.3 * pow(dot(fq, vec2f(fd.y, -fd.x)), 2.0)) / (fr * fr);
          if (fe < 1.0) { return vec4f(sd.flower.xyz * (1.05 - 0.3 * fe) * (0.9 + 0.2 * r3), 1.0); }
          continue;
        }
        let dir = normalize(vec2f(select(-1.0, 1.0, base.x >= 0.0) * (0.55 + 0.5 * r3), 0.75 + 0.4 * r1 - 0.3 * r2));
        let l = len * (0.8 + 0.4 * r2);
        let qv = uv - base;
        let along = dot(qv, dir) / l;
        if (along <= 0.0 || along >= 1.0) { continue; }
        let across = abs(dir.x * qv.y - dir.y * qv.x);
        // Widest a little past the middle, as a willow leaf is.
        let hw = max(l * sd.card.w * (1.0 + 0.3 * (along - 0.5)) * sqrt(along * (1.0 - along)), px * 0.5);
        if (across < hw) {
          var albedo = in.albedo * (0.82 + 0.36 * r3);
          // A few show their paler, felted undersides.
          if (hashToFloat(pcg(hl ^ 0x55u)) < sd.shadow2.z) { albedo = mix(albedo, vec3f(dot(albedo, vec3f(0.333))), 0.35) * 1.3; }
          return vec4f(albedo, 1.0);
        }
      }
    }
  }

  let state = in.spray.y;
  if (state > 0u) {
    let prog = f32(in.spray.z) / 1000.0;
    let ripe = smoothstep(0.35, 0.7, prog);
    let col = mix(sd.catkin.xyz, select(sd.female.xyz, sd.pollen.xyz, state == 1u), ripe);
    let n = u32(sd.spray.y);
    let len = max(sd.spray.z / max(hs, 1e-3) * mix(0.6, 1.0, smoothstep(0.0, 0.3, prog)), px * 1.6);
    let wid = max(len * 0.45, px * 1.2);
    let perTwig = max((n + 2u) / 3u, 1u);
    for (var k = 0u; k < n; k++) {
      let r = hashToFloat(pcg(seed ^ (k * 0x9e3779b9u)));
      var a = a0;
      var b = b0;
      if (k % 3u == 1u) { a = a1; b = b1; }
      if (k % 3u == 2u) { a = a2; b = b2; }
      let f = mix(0.3, 0.97, (f32(k / 3u) + 0.3 + 0.4 * r) / f32(perTwig));
      let d = normalize(b - a);
      let sideS = select(-1.0, 1.0, ((k / 3u) & 1u) == 0u);
      let cd = normalize(d + vec2f(-d.y, d.x) * sideS * 0.45);
      let ctr = mix(a, b, f) + cd * len * 0.5;
      let qv = uv - ctr;
      let u = dot(qv, cd) / (len * 0.5);
      let w = (cd.x * qv.y - cd.y * qv.x) / (wid * 0.5);
      let ee = u * u + w * w;
      if (ee < 1.0) {
        // Silky: brighter across the middle, a little darker at the rim.
        return vec4f(col * (1.05 - 0.25 * ee) * (0.9 + 0.2 * r), 1.0);
      }
    }
  }

  // Twigs keep about a pixel's width when bare, so a far winter bush keeps its fine haze; in leaf
  // they stay their own width and mostly hide behind the leaves.
  let tw = max(sd.stem.z * 0.5 / max(hs, 1e-3), px * 0.5 * (1.0 - cover));
  let dMain = segDist(uv, a0, b0) / (tw * mix(1.3, 0.8, clamp(uv.y * 0.5 + 0.5, 0.0, 1.0)));
  let dSide = min(segDist(uv, a1, b1), segDist(uv, a2, b2)) / (tw * 0.8);
  if (min(dMain, dSide) < 1.0) { return vec4f(sd.twig.xyz, 1.0); }
  return vec4f(0.0);
}

@fragment
fn fsShrub(in: VsOut) -> FsOut {
  // Derivatives first, while every fragment of the quad still runs.
  let px = max(length(dpdx(in.uv)), length(dpdy(in.uv)));
  var albedo = in.albedo;
  var wrap = 0.3;
  if (in.look.y > 0.0) {
    let hit = sprayAt(in, px);
    if (hit.w < 0.5) { discard; }
    albedo = hit.xyz;
    // Thin leaves let light through, so the crown's shaded side is never black.
    wrap = 0.5;
  }
  let color = floraShade(sd.c, in.world, normalize(in.normal), albedo, in.look.x, in.pos.xy, wrap, 1.0, 0.0);
  return FsOut(vec4f(color, 1.0), floraNormalId());
}

// ---- the contact shadow ----

struct ShadowOut {
  @builtin(position) pos: vec4f,
  @location(0) rho: f32,                              // 0 under the stool .. 1 at the rim
  @location(1) @interpolate(flat) strength: f32,
};

// A disc draped on the ground (each corner at the terrain's height there), sized to the crown and
// growing with the shrub, its rim drawn out a little away from the sun while it is up; fainter
// while the shrub is bare. Drawn before the plants with a multiplying blend, so it only darkens.
// A few stacked layers, each a share of the darkening, so grass under the bush is shaded down its
// blades and not only the ground between them.
@vertex
fn vsShrubShadow(@builtin(vertex_index) vi0: u32, @builtin(instance_index) ii: u32) -> ShadowOut {
  let sh = shrubOf(ii);
  var o: ShadowOut;
  o.pos = vec4f(0.0, 0.0, -2.0, 1.0);
  o.rho = 1.0;
  o.strength = 0.0;
  if (sh.stage == FLORA_SEED) { return o; }
  let layers = max(sd.shadow3.x, 1.0);
  let layer = f32(vi0 / (SHADOW_SEGS * 9u));
  let vi = vi0 % (SHADOW_SEGS * 9u);
  let tri = vi / 3u;
  let c = vi % 3u;
  var ring = 0u;
  var seg = 0u;
  if (tri < SHADOW_SEGS) {
    // The middle fan: its center, then two corners on the first ring.
    ring = select(1u, 0u, c == 0u);
    seg = tri + select(0u, 1u, c == 2u);
  } else {
    let q = tri - SHADOW_SEGS;
    let corner = QUAD[(q % 2u) * 3u + c];
    ring = 1u + u32(corner.y);
    seg = q / 2u + select(0u, 1u, corner.x > 0.0);
  }
  let rho = SHADOW_RHO[ring];
  let ang = f32(seg % SHADOW_SEGS) / f32(SHADOW_SEGS) * 6.2831853;
  let r = sh.crownR * sd.shadow.z * (1.0 - 0.12 * layer);
  let sun = frame.sunDir;
  var shift = -vec2f(sun.x, sun.z) / max(sun.y, 0.3) * (sh.height * sd.shadow2.x) * smoothstep(0.0, 0.15, sun.y);
  let sl = length(shift);
  if (sl > r * 0.6) { shift *= r * 0.6 / sl; }
  let xz = sh.center.xz + vec2f(cos(ang), sin(ang)) * (r * rho) + shift * rho;
  var p = vec3f(xz.x, terrainHeight(heightTex, xz) + sd.shadow2.y + layer * sd.shadow3.y, xz.y);
  // Pulled a little toward the eye, so the ground never shows through it.
  p += normalize(frame.cameraPos - p) * 0.02;
  o.pos = frame.viewProj * vec4f(p, 1.0);
  o.rho = rho;
  let full = sd.shadow.y * mix(sd.shadow.w, 1.0, leafCover(sh.stage, sh.pos)) * smoothstep(0.0, 0.3, sh.size);
  // Each layer's share, so all of them together darken by `full`.
  o.strength = 1.0 - pow(1.0 - full, 1.0 / layers);
  return o;
}

@fragment
fn fsShrubShadow(in: ShadowOut) -> @location(0) vec4f {
  let k = 1.0 - smoothstep(0.0, 1.0, in.rho);
  return vec4f(vec3f(1.0 - in.strength * k * k), 1.0);
}

// Curled pondweed (M2, the minnows' gift; docs 10, 12): an underwater meadow, one instance per
// plant from the growth engine's instance buffer, no mesh. A plant is a few thin stems rooted in
// the bed within its spread, each rising toward the live water surface (bed plus depth, as the
// lilies read it) and stopping a little under it, swaying slowly in the still water. Each stem
// carries narrow leaves that alternate around it, tilted up, with a wavy crisp edge (the fragment
// shapes the leaf and ripples its normal). Thin leaves let light through (wrap) and pale toward the
// tips. Drawn before the water, so the water's scene copy shows them through its depth and color.
// Season albedo is physical (recipes/flora/pondweed.json).

// #include common
// #include lib-hash
// #include lighting-bindings
// #include lib-sky
// #include lib-lighting
// #include lib-terrain
// #include lib-water
// #include lib-flora

struct WeedDraw {
  c: FloraCommon,
  shape: vec4f,     // x stems on a new plant, y on a full one, z spread radius (m), w longest stem (m)
  stem: vec4f,      // x clearance under the surface (m), y stem width (m), z leaf gap (m), w leaf length (m)
  leaf: vec4f,      // x leaf width (m), y twist between leaves (radians), z edge waves, w leaves a stem may carry
  look: vec4f,      // x root shade, y sprout height (m), z stems on a seed, w stems while dormant
  look2: vec4f,     // x dormant length share, y new spread share, z sway at the top (m), w sway per second
  tone: vec4f,      // x stem shade, y tip light, z leaf roughness, w lean (share of the length)
};

const STEM_SEGS: u32 = 6u;
const STEM_VERTS: u32 = 36u;     // STEM_SEGS quads
const LEAF_VERTS: u32 = 6u;
const MAX_LEAVES: u32 = 18u;
const BLOCK: u32 = STEM_VERTS + LEAF_VERTS * MAX_LEAVES;

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var<uniform> wd: WeedDraw;
@group(2) @binding(2) var heightTex: texture_2d<f32>;
@group(2) @binding(3) var waterDepth: texture_2d<f32>;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) albedo: vec3f,
  @location(3) leafUv: vec3f,    // a leaf: x along 0..1, y across -1..1, z 1; a stem: z 0
  @location(4) across: vec3f,    // a leaf's across direction, for its wavy edge
  @location(5) ao: f32,
};

struct FsOut {
  @location(0) color: vec4f,
  @location(1) normalId: vec4f,
};

var<private> QUAD: array<vec2f, 6> = array<vec2f, 6>(
  vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(-1.0, 1.0),
  vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

fn nothing() -> VsOut {
  var o: VsOut;
  o.pos = vec4f(0.0, 0.0, -2.0, 1.0);   // outside the clip volume: the triangle is dropped
  o.world = vec3f(0.0); o.normal = vec3f(0.0, 1.0, 0.0); o.albedo = vec3f(0.0);
  o.leafUv = vec3f(0.0); o.across = vec3f(1.0, 0.0, 0.0); o.ao = 1.0;
  return o;
}

// The water surface at a world point, as the lilies read it (flora-lilies.wgsl): the four nearest
// wet water cells' bed plus depth, interpolated like the water mesh; the ground where none is wet.
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

fn facingSide(p: vec3f, dir: vec3f) -> vec3f {
  let s = cross(dir, frame.cameraPos - p);
  return select(vec3f(1.0, 0.0, 0.0), normalize(s), length(s) > 1e-6);
}

@vertex
fn vsWeed(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VsOut {
  let a = plants[ii * FLORA_STRIDE];
  let b = plants[ii * FLORA_STRIDE + 1u];
  let stage = u32(round(a.w));
  let size = clamp(a.z, 0.0, 1.0);
  let seed = stage == FLORA_SEED;
  let dormant = stage == FLORA_DORMANT;
  let plantU = u32(b.y * 16777216.0);
  let salt = u32(wd.c.misc.y);
  let stemI = vi / BLOCK;
  let slot = vi % BLOCK;
  var stems = u32(round(mix(wd.shape.x, wd.shape.y, size)));
  if (seed) { stems = u32(wd.look.z); }
  if (dormant) { stems = u32(wd.look.w); }
  if (stemI >= stems) { return nothing(); }

  let h0 = hash3(vec3u(plantU, stemI, salt));
  let h1 = pcg(h0);
  let h2 = pcg(h1);
  let h3 = pcg(h2);
  let v = vec4f(hashToFloat(h0), hashToFloat(h1), hashToFloat(h2), hashToFloat(h3));
  // Rooted within the spread (the young closer in), on the bed under the water.
  let spread = wd.shape.z * mix(wd.look2.y, 1.0, size);
  let az = v.x * 6.2831853;
  let rootXZ = a.xy + vec2f(cos(az), sin(az)) * spread * sqrt(v.y);
  let bed = terrainHeight(heightTex, rootXZ);
  let surface = surfaceAt(rootXZ);
  let room = surface - wd.stem.x - bed;
  var len = wd.shape.w * mix(0.35, 1.0, size) * (0.75 + 0.25 * v.z);
  if (seed) { len = wd.look.y; }
  if (dormant) { len *= wd.look2.x; }
  len = min(len, room);
  if (len < 0.02) { return nothing(); }
  let base = vec3f(rootXZ.x, bed, rootXZ.y);
  let up = vec3f(0.0, 1.0, 0.0);
  // A slow sway in the still water, each stem in its own phase and direction.
  let sw = sin(wd.c.wind.z * 6.2831853 * wd.look2.w + v.w * 6.2831853);
  let sdir = vec3f(cos(az + v.z * 3.0), 0.0, sin(az + v.z * 3.0));
  // Each stem leans out from the plant's middle (more for the outer ones), curving up.
  let out = vec3f(cos(az), 0.0, sin(az));
  let bend = sdir * (wd.look2.z * (0.5 + 0.5 * v.z) * sw / max(len, 0.05)) + out * wd.tone.w * (0.3 + 0.7 * v.y);
  let k = 2.0;

  if (slot < STEM_VERTS) {
    // ---- the stem: a thin strip facing the camera ----
    let seg = slot / 6u;
    let corner = QUAD[slot % 6u];
    let t = (f32(seg) + corner.y) / f32(STEM_SEGS);
    let p0 = floraCurve(base, up, bend, len, k, t);
    let tangent = floraTangent(up, bend, k, t);
    let side = facingSide(p0, tangent);
    let width = max(wd.stem.y, floraPixelM(p0) * wd.c.misc.z);
    var o = nothing();
    let p = p0 + side * corner.x * width * 0.5;
    o.world = p;
    o.pos = frame.viewProj * vec4f(p, 1.0);
    o.normal = normalize(cross(side, tangent));
    o.albedo = wd.c.albedo.xyz * wd.tone.x;
    o.ao = mix(wd.look.x, 1.0, t);
    return o;
  }

  // ---- a leaf: alternating around the stem, tilted up, wavy-edged in the fragment ----
  let li = (slot - STEM_VERTS) / LEAF_VERTS;
  let corner = QUAD[(slot - STEM_VERTS) % LEAF_VERTS];
  let leaves = min(u32(wd.leaf.w), u32(floor(len / wd.stem.z)));
  if (li >= leaves) { return nothing(); }
  let t = (f32(li) + 0.6) * wd.stem.z / len;
  let at = floraCurve(base, up, bend, len, k, t);
  let theta = az + f32(li) * wd.leaf.y + v.w;
  let tilt = 0.65 + 0.25 * hashToFloat(h3 ^ li);
  let dir = normalize(vec3f(cos(theta) * cos(tilt), sin(tilt), sin(theta) * cos(tilt)));
  let across = normalize(cross(dir, up) + vec3f(0.0, 1e-4, 0.0));
  // Smaller leaves near the top and on a young plant.
  let scale = mix(0.6, 1.0, size) * mix(1.0, 0.7, t);
  let L = wd.stem.w * scale;
  let W = wd.leaf.x * scale;
  // The leaf droops a little at its tip.
  let along = corner.y;
  let p = at + dir * L * along - up * (L * 0.18 * along * along) + across * corner.x * W * 0.5;
  var o = nothing();
  o.world = p;
  o.pos = frame.viewProj * vec4f(p, 1.0);
  o.normal = normalize(cross(across, dir));
  o.across = across;
  o.leafUv = vec3f(along, corner.x, 1.0);
  let tint = 0.85 + 0.3 * hashToFloat(h2 ^ (li * 7u));
  o.albedo = wd.c.albedo.xyz * tint;
  o.ao = mix(wd.look.x, 1.0, t);
  return o;
}

@fragment
fn fsWeed(in: VsOut, @builtin(front_facing) front: bool) -> FsOut {
  var n = normalize(in.normal);
  if (!front) { n = -n; }
  var albedo = in.albedo;
  var rough = wd.tone.z;
  if (in.leafUv.z > 0.5) {
    let u = in.leafUv.x;
    let w = abs(in.leafUv.y);
    // A narrow oblong leaf with a blunt tip, its edge rippled (the crisp waves).
    let waves = sin(u * wd.leaf.z * 6.2831853);
    let edge = pow(max(sin(3.1415927 * clamp(u * 0.92 + 0.04, 0.0, 1.0)), 0.0), 0.45) * (0.88 + 0.12 * waves);
    if (w > edge) { discard; }
    n = normalize(n + normalize(in.across) * waves * 0.45 * w);
    albedo *= mix(1.0, wd.tone.y, u);
  }
  let color = floraShade(wd.c, in.world, n, albedo, in.ao, in.pos.xy, 0.6, rough, 0.02);
  return FsOut(vec4f(color, 1.0), floraNormalId());
}

// Terrain and sea in the opaque pass (docs/04, 08).
// Land: one grid mesh per open chunk, LOD 128/64/32 quads a side, with skirts that hide cracks
// between LODs; heights come from the height texture in the vertex shader. Materials blend by
// weight with a little height-style sharpening; steep slopes turn to rock and the shore band to sand.
// Lighting is physical (lib-lighting: sun and moon with shadows, sky SH fill, aerial perspective);
// no palette colors here (docs/05). Water and the sea are drawn by the water pass (water-draw.wgsl);
// the bed under them gets its caustics here, where the live water depth is already read.

// #include common
// #include lib-hash
// #include lighting-bindings
// #include lib-sky
// #include lib-terrain
// #include lib-lighting
// #include lib-ground
// #include lib-water
// #include lib-caustics
// #include lib-probe
// #include lib-rain
// #include lib-shore
// #include lib-casts

struct TerrainDraw {
  albedoGrass: vec3f, variation: f32,
  albedoSand: vec3f, variationScale: f32,
  albedoRock: vec3f, blendSharpness: f32,
  albedoSoil: vec3f, wetDarkening: f32,
  albedoSea: vec3f, seaSpecular: f32,
  ringColor: vec3f, ringOpacity: f32,   // ring color is in exposed (display-referred) units: it is UI
  ringCenter: vec2f, ringRadius: f32, ringHardness: f32,
  ringVisible: f32, ringWidth: f32, steepCosLow: f32, steepCosHigh: f32,
  beachLow: f32, beachHigh: f32, skirtDepth: f32, seaExtent: f32,
  shallowDepth: f32, seed: u32, tide: f32, turf: f32,   // tide: sea level now (m); turf: how much grass lowers the puddle level
  albedoSilt: vec3f, siltCover: f32,    // the fine mud that settles on pond beds; most of the bed it covers
  bedDepth: vec2f, siltDepth: vec2f,    // water depths (m) over which grass gives way to a bare bed, and silt settles
  caustics: Caustics,                   // lib-caustics.wgsl
  wetLook: vec4f,                       // G3 damp: x roughness soaked dense ground (rock) reaches, y porous (soil), z albedo factor dense, w porous
  puddle: vec4f,                        // x, y mesh-normal y over which ground counts as flat; z 1 / undulation size (1/m); w undulation share
  puddle2: vec4f,                       // x puddle roughness, y puddle albedo factor, z most of the low spots a full level covers, w puddle F0
  rain: vec4f, rain2: vec4f,            // raindrop rings in puddles (lib-rain RainRings)
  marks: array<vec4f, 16>,              // UI rings (the Plant tool): x, z, radius (m), opacity; the first with opacity 0 ends the list
  weed: vec4f,                          // the drowned meadow: rgb albedo of drowned grass and weed (linear), w most of the bed it covers
  weed2: vec4f,                         // xy water depths (m) over which it gives way to bare silt, zw speeds (m/s) over which running water scours it
  lushDry: vec4f,                       // wet-to-dry grass (lush.js): rgb the dry rise's grass as a share of the season's, w the lushness of today's meadow
  lushWet: vec4f,                       // rgb the grass by the water as a share of the season's, w 1 when on
  // The shore (docs/future/10, shore.json `look`; cover from world/water/shore-live.js).
  shore0: vec4f,                        // rgb wrack albedo as a share of the moss scan's, w 1 / wrack patch size (m)
  shore1: vec4f,                        // x 1 / wrack clump size, yzw lichen albedo factor
  shore2: vec4f,                        // xy 1 / lichen patch and clump sizes, z mud wetness
  ripple: vec4f,                        // x 2 pi / wavelength, y crest slope, z 1 on, w wavelength (m)
  mud: vec4f,                           // rgb mud albedo factor, w 1 / ripple warp size (m)
  // The strandline (world/water/strandline.js): up to eight lines, newest first, and their litter.
  strandL0: vec4f, strandL1: vec4f,     // line levels (m about mean sea level)
  strandS0: vec4f, strandS1: vec4f,     // line strengths 0..1 (0 no line)
  strand0: vec4f,                       // x wave run-up above the level (m), y line half-width (m), z 1 strands drawn (else a tint), w most strands
  strand1: vec4f,                       // x strand grid cell (m), yz length range (m), w width (m)
  strandAlb: vec4f,                     // rgb dried litter albedo, w share of strands lying crossways
  kelp0: vec4f,                         // rgb kelp albedo, w blade width (m)
  kelp1: vec4f,                         // x, y grid cell across and along (m), zw length range (m)
  kelp2: vec4f,                         // x midrib relief, y kelp pieces in the strandline (share)
  // Wrack fronds (lib-shore wrackFronds): drawn close up over the wrack mat, which stays beneath.
  frond0: vec4f,                        // rgb frond albedo (linear), w strap half-width (m)
  frond1: vec4f,                        // x, y grid cell across and along (m), zw length range (m)
  frond2: vec4f,                        // x bladder radius (m), y midrib relief, zw view distances (m) over which fronds fade to the mat
  frond3: vec4f,                        // x 1 on (tier), y how much of the mat the fronds hide close up, z bladder lightening
  // Lugworm casts (lib-casts, world/finds/index.js): up to 16 near the view, x, z, size (0 ends), yaw.
  casts: array<vec4f, 16>,
  cast0: vec4f,                         // x coil radius (m), y tube radius (m), z turns, w inner rise (m)
  cast1: vec4f,                         // rgb cast albedo as a share of the sand's, w view distance (m) past which casts are not drawn
  cliffLine: vec4f,                     // Terrace and Cut (docs/15): x shelf level (m), y 1 shown, z line width (m)
  // The drying margin (A8, terrain.json wetness.dryingMargin): bed a lowering pond left.
  margin0: vec4f,                       // rgb dry pond silt albedo (linear), w most of the ground it hides
  margin1: vec4f,                       // xy margin shares elapsed over which the mud dries, zw over which cracks open
  margin2: vec4f,                       // x 1 / crack cell (1/m), y most crack width (m), z crack occlusion, w crack relief
  margin3: vec4f,                       // x margin share over which it fades back, y mud porosity, z 1 on
  // The keeper's camp pad (store slice campPad, docs/future/13 CP-01, CP-02). Its trodden look is
  // drawn from these numbers; the ground texture's a channel ("path wear", heightfield.js) is kept
  // for the desire paths (CP-10).
  camp0: vec4f,                         // xy pad center (m), z pad radius (m), w wear on the pad (0 no pad)
  camp1: vec4f,                         // x wear fade outside the pad (m), y packed earth albedo factor, z share of wetness shed, w share of moss kept
  campDash: vec4f,                      // the dashed edge (marks with a negative radius): x dash (m), y gap (m), z width (m)
};

// Cracks in drying mud: a jittered cellular network (F2 - F1 of the nearest plate centers), so the
// lines are polygonal, meeting in threes. Returns x distance to the nearest crack in cell units,
// yz the unit direction across it (from this plate toward the neighbor).
fn mudCracks(p: vec2f, seed: u32) -> vec3f {
  let base = floor(p);
  var c1 = vec2f(0.0); var c2 = vec2f(0.0);
  var d1 = 1e9; var d2 = 1e9;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let g = base + vec2f(f32(i), f32(j));
      let h = hash3(vec3u(vec2u(vec2i(g) + vec2i(1 << 20)), seed));
      let o = vec2f(hashToFloat(h), hashToFloat(pcg(h))) * 0.8 + 0.1;
      let cpt = g + o;
      let d = dot(cpt - p, cpt - p);
      if (d < d1) { d2 = d1; c2 = c1; d1 = d; c1 = cpt; }
      else if (d < d2) { d2 = d; c2 = cpt; }
    }
  }
  // Distance to the bisector between the two nearest centers (exact for a Voronoi edge).
  let across = normalize(c2 - c1);
  let dist = dot(0.5 * (c1 + c2) - p, across);
  return vec3f(dist, across);
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var<uniform> td: TerrainDraw;
@group(2) @binding(1) var<uniform> chunks: array<TerrainChunk, 36>;
@group(2) @binding(2) var heightTex: texture_2d<f32>;
@group(2) @binding(3) var materialTex: texture_2d<f32>;
@group(2) @binding(4) var linearSampler: sampler;
@group(2) @binding(5) var groundA: texture_2d_array<f32>;
@group(2) @binding(6) var groundB: texture_2d_array<f32>;
@group(2) @binding(7) var groundSampler: sampler;
@group(2) @binding(8) var<uniform> ground: GroundDetail;
@group(2) @binding(9) var waterDepth: texture_2d<f32>;   // live water depth (m), water-depth.wgsl
@group(2) @binding(10) var wetMap: texture_2d<f32>;      // visual wetness, r 0..1 (rgba8unorm, 0.25 m), terrain-wetness.wgsl
@group(2) @binding(11) var mossTex: texture_2d<f32>;     // moss cover 0..1 (r8unorm, 0.5 m), moss-live.js
@group(2) @binding(12) var waterVel: texture_2d<f32>;    // live water velocity (rg32float, m/s, x and z)
@group(2) @binding(13) var probeTex: texture_cube<f32>;  // sky probe (lib-probe.wgsl): wet ground reflects it
@group(2) @binding(14) var probeSampler: sampler;
@group(2) @binding(15) var coverTex: texture_2d<f32>;    // plant cover (world/growth): b how lush the grass looks, 1 m grid from -80 m
@group(2) @binding(16) var shoreTex: texture_2d<f32>;    // shore cover (rgba8unorm, 0.5 m): r wrack, g ripples, b lichen, a mud

// Live water depth (m) here, bilinear between the 0.5 m cells.
fn waterDepthAt(xz: vec2f) -> f32 {
  let g = waterCellCoord(xz);
  let c = vec2i(floor(g));
  let f = g - floor(g);
  let hi = vec2i(WATER_CELLS - 1);
  let d00 = textureLoad(waterDepth, clamp(c, vec2i(0), hi), 0).r;
  let d10 = textureLoad(waterDepth, clamp(c + vec2i(1, 0), vec2i(0), hi), 0).r;
  let d01 = textureLoad(waterDepth, clamp(c + vec2i(0, 1), vec2i(0), hi), 0).r;
  let d11 = textureLoad(waterDepth, clamp(c + vec2i(1, 1), vec2i(0), hi), 0).r;
  return mix(mix(d00, d10, f.x), mix(d01, d11, f.x), f.y);
}

// Live water velocity (m/s, x and z) here, bilinear between the 0.5 m cells.
fn waterVelAt(xz: vec2f) -> vec2f {
  let g = waterCellCoord(xz);
  let c = vec2i(floor(g));
  let f = g - floor(g);
  let hi = vec2i(WATER_CELLS - 1);
  let v00 = textureLoad(waterVel, clamp(c, vec2i(0), hi), 0).rg;
  let v10 = textureLoad(waterVel, clamp(c + vec2i(1, 0), vec2i(0), hi), 0).rg;
  let v01 = textureLoad(waterVel, clamp(c + vec2i(0, 1), vec2i(0), hi), 0).rg;
  let v11 = textureLoad(waterVel, clamp(c + vec2i(1, 1), vec2i(0), hi), 0).rg;
  return mix(mix(v00, v10, f.x), mix(v01, v11, f.x), f.y);
}

// Second target (normalId, rgb10a2unorm): octahedral world normal in RG, water flag in B,
// outline group in A (0 none, 1 terrain, 2 structures and foliage, 3 creatures; docs/04, 05).
struct FsOut {
  @location(0) color: vec4f,
  @location(1) normalId: vec4f,
};

fn octEncode(n: vec3f) -> vec2f {
  var p = n.xz / (abs(n.x) + abs(n.y) + abs(n.z));
  if (n.y < 0.0) { p = (1.0 - abs(p.yx)) * select(vec2f(-1.0), vec2f(1.0), p >= vec2f(0.0)); }
  return p * 0.5 + 0.5;
}

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
};

@vertex
fn vsLand(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VsOut {
  var out: VsOut;
  out.world = terrainMeshVertex(heightTex, chunks[ii], vi, td.skirtDepth);
  out.pos = frame.viewProj * vec4f(out.world, 1.0);
  return out;
}

// Soft brush ring: an outer ring at the radius and a faint inner one where the falloff starts.
fn ringAlpha(xz: vec2f) -> f32 {
  if (td.ringVisible < 0.5) { return 0.0; }
  let d = distance(xz, td.ringCenter);
  let w = td.ringWidth * td.ringRadius + 0.03;
  let outer = 1.0 - smoothstep(0.0, w, abs(d - td.ringRadius));
  let inner = 1.0 - smoothstep(0.0, w * 0.7, abs(d - td.ringRadius * td.ringHardness));
  return clamp(outer + 0.35 * inner, 0.0, 1.0) * td.ringOpacity;
}

// Terrace and Cut: a thin contour where the ground meets the shelf's level, inside and just around
// the ring, so the player sees how far a shelf will reach before they drag. `pixM` keeps it a pixel
// or two wide at any distance.
fn cliffLineAlpha(xz: vec2f, y: f32, pixM: f32) -> f32 {
  if (td.cliffLine.y < 0.5) { return 0.0; }
  let near = 1.0 - smoothstep(td.ringRadius, td.ringRadius * 1.6 + 0.5, distance(xz, td.ringCenter));
  let w = max(td.cliffLine.z, pixM * 1.5);
  return (1.0 - smoothstep(0.0, w, abs(y - td.cliffLine.x))) * near * td.ringOpacity;
}

// The dashed style (the camp pad's edge, CP-01): a soft band campDash.z wide, broken into dashes
// along the circle. The dash and gap are meters along the rim, stretched a little so a whole number
// of them goes round; when a pixel grows too big to hold them they fade to their average.
fn dashedRing(xz: vec2f, c: vec2f, r: f32, pixM: f32) -> f32 {
  let d = distance(xz, c);
  let hw = max(0.5 * td.campDash.z, pixM);
  let band = 1.0 - smoothstep(0.5 * hw, hw, abs(d - r));
  if (band <= 0.0) { return 0.0; }
  let period = max(td.campDash.x + td.campDash.y, 0.01);
  let n = max(1.0, round(6.2831853 * r / period));
  let p = 6.2831853 * r / n;                        // the period actually used (m)
  let dash = p * td.campDash.x / period;
  let s = fract(atan2(xz.y - c.y, xz.x - c.x) / 6.2831853 * n) * p;
  let soft = max(min(0.04, dash * 0.25), pixM);
  let on = 1.0 - smoothstep(0.5 * dash - soft, 0.5 * dash, abs(s - 0.5 * p));
  let resolved = 1.0 - smoothstep(0.15 * p, 0.4 * p, pixM);
  return band * mix(dash / p, on, resolved);
}

// Thin marker rings (a tap's bloom, young plantings), kept a couple of pixels wide at any distance.
// A negative radius is the dashed style.
fn marksAlpha(xz: vec2f, pixM: f32) -> f32 {
  var a = 0.0;
  let w = max(0.025, pixM * 1.5);
  for (var i = 0u; i < 16u; i++) {
    let m = td.marks[i];
    if (m.w <= 0.0) { break; }
    if (m.z < 0.0) { a = max(a, dashedRing(xz, m.xy, -m.z, pixM) * m.w); continue; }
    a = max(a, (1.0 - smoothstep(0.0, w, abs(distance(xz, m.xy) - m.z))) * m.w);
  }
  return a;
}

// The camp pad's trodden look (CP-02): the recipe's wear on the pad, fading out over camp1.x past
// its edge, the fade line broken up a little so it never reads as a drawn circle. Mirrors padWear in
// src/world/camp/edge.js.
fn campWear(xz: vec2f) -> f32 {
  if (td.camp0.w <= 0.0) { return 0.0; }
  let wob = (valueNoise2(xz * 0.9 + vec2f(5.7, 3.1), td.seed + 70u) - 0.5) * 0.6 * td.camp1.x;
  let t = clamp((distance(xz, td.camp0.xy) + wob - td.camp0.z) / max(td.camp1.x, 1e-3), 0.0, 1.0);
  let patchy = 0.85 + 0.3 * valueNoise2(xz * 1.7 + vec2f(1.3, 8.9), td.seed + 71u);
  return clamp(td.camp0.w * (1.0 - t * t * (3.0 - 2.0 * t)) * patchy, 0.0, 1.0);
}

@fragment
fn fsLand(in: VsOut) -> FsOut {
  let xz = in.world.xz;
  let y = in.world.y;
  let fw = fwidth(xz);   // world size of this pixel, for filtering the caustic lines
  let n = terrainNormal(heightTex, xz);
  var w = textureSampleLevel(materialTex, linearSampler, terrainUv(xz), 0.0); // grass, sand, rock, soil

  // Derived layers: steep slopes show rock, the shore band shows sand (painted rock stays rock).
  let steep = 1.0 - smoothstep(td.steepCosHigh, td.steepCosLow, n.y);
  w = mix(w, vec4f(0.0, 0.0, 1.0, 0.0), steep);
  // The shore cover (world/water/shore-live.js): r wrack, g ripples, b lichen, a mud. Tidal mud
  // keeps its soil, so the beach band does not turn it to sand.
  let shore = textureSampleLevel(shoreTex, linearSampler, terrainUv(xz), 0.0);
  let beach = (1.0 - smoothstep(td.beachHigh - 0.15, td.beachHigh + 0.15, y)) * (1.0 - shore.a);
  w = mix(w, vec4f(0.0, 1.0 - w.z, w.z, 0.0), beach);
  // Grass does not grow under water: past the first few centimeters of depth a grassy bed is bare
  // soil, so from above the waterline reads as grass giving way to the bed (sand and stone stay).
  let wdep = waterDepthAt(xz);
  let sub = smoothstep(td.bedDepth.x, td.bedDepth.y, wdep);
  // A grassy bed under any standing water (from the first few millimeters): the drowned meadow below.
  let drownedGrass = w.x * smoothstep(0.002, 0.012, wdep) / max(w.x + w.y + w.z + w.w, 1e-4);
  w = vec4f(w.x * (1.0 - sub), w.y, w.z, w.w + w.x * sub);
  // The camp pad is trodden ground (CP-02): wear turns its grass to the soil material, packed earth
  // with the worn grass showing through (the height blend below keeps tufts). Sand and stone stay.
  let trod = campWear(xz);
  w = vec4f(w.x * (1.0 - trod), w.y, w.z, w.w + w.x * trod);

  // Height-style blend: each layer gets its own noise "relief"; layers within blendSharpness
  // of the top score share the pixel, so edges break up softly instead of fading flat.
  let p = xz * td.variationScale;
  let relief = vec4f(
    valueNoise2(p, td.seed),
    valueNoise2(p * 1.7 + vec2f(13.1, 7.3), td.seed + 1u),
    valueNoise2(p * 0.9 + vec2f(3.7, 21.9), td.seed + 2u),
    valueNoise2(p * 1.3 + vec2f(29.3, 5.1), td.seed + 3u));
  let present = step(vec4f(0.004), w);
  let score = (w + (relief - 0.5) * td.blendSharpness) * present - (1.0 - present);
  let top = max(max(score.x, score.y), max(score.z, score.w));
  var wf = max(score - (top - td.blendSharpness), vec4f(0.0));
  wf /= max(wf.x + wf.y + wf.z + wf.w, 1e-4);

  var albedo = td.albedoGrass * wf.x + td.albedoSand * wf.y + td.albedoRock * wf.z + td.albedoSoil * wf.w;
  albedo *= 1.0 + td.variation * (valueNoise2(p * 3.1 + vec2f(41.0, 17.0), td.seed + 4u) - 0.5);
  // Moss (world/growth/moss-live.js) where the ground stays damp. It is a mosaic, not a carpet: a
  // soft partial cover in clumps at three scales (patches of a few meters, clumps of about a meter,
  // tufts of 20 to 30 cm), never a hard edge. More cover fills more of the clumps in.
  let mossCover = textureSampleLevel(mossTex, linearSampler, terrainUv(xz), 0.0).r;
  let clumps = valueNoise2(xz * 0.3 + vec2f(2.1, 7.7), td.seed + 11u) * 0.45
             + valueNoise2(xz * 1.0, td.seed + 9u) * 0.35
             + valueNoise2(xz * 3.6 + vec2f(5.3, 1.9), td.seed + 10u) * 0.2;
  let density = mossCover * smoothstep(0.3, 0.75, clumps + (mossCover - 0.5) * 0.35);
  // The ground caps how far moss can take over: grass competes and always shows through, damp soil
  // and stone hold the most, loose sand (painted, or the beach band) almost none. Below the cap the
  // height blend lets grass tufts and stone tops stand up through the moss.
  let cap = dot(w, ground.mossRules) / max(w.x + w.y + w.z + w.w, 1e-4);
  let moss = min(density, 1.0) * cap * (1.0 - sub) * mix(1.0, td.camp1.w, trod);   // feet wear moss away
  // Wrack grows in clumps over rock in the tide band, drawn with the moss scan at wrack's own
  // albedo (moss never grows in the band, so they never meet).
  let wclumps = valueNoise2(xz * td.shore0.w + vec2f(4.3, 9.1), td.seed + 31u) * 0.6
              + valueNoise2(xz * td.shore1.x + vec2f(1.7, 3.3), td.seed + 32u) * 0.4;
  let wrackMat = shore.r * smoothstep(0.25, 0.65, wclumps + (shore.r - 0.5) * 0.4);
  // Close up, drawn fronds lie over the mat and hide much of it; far off the mat is the look.
  let viewDist = distance(in.world, frame.cameraPos);
  let frondNear = td.frond3.x * (1.0 - smoothstep(td.frond2.z, td.frond2.w, viewDist));
  let wrack = wrackMat * (1.0 - td.frond3.y * frondNear);
  let layer4 = min(moss + wrack, 1.0);
  let tint4 = mix(vec3f(1.0), td.shore0.rgb, wrack / max(moss + wrack, 1e-4));
  albedo = mix(albedo, ground.mossTile.yzw * tint4, layer4);
  // Scanned detail (docs/22) takes over once loaded and near enough; the flat look stays the fallback.
  let gd = groundDetail(in.world, n, w, layer4, tint4, viewDist);
  albedo = mix(albedo, gd.albedo, gd.amount);
  // Black lichen crusts the splash-zone rock in small patches; tidal mud is soil gone dark and soft.
  let rockShare = mix(wf.z, gd.weights.z, gd.amount);
  let soilShare = mix(wf.w, gd.weights.w, gd.amount);
  // Packed, dry earth on the pad reflects a little more than loose soil (a material property, not
  // a painted color).
  albedo *= 1.0 + (td.camp1.y - 1.0) * trod * soilShare;
  let lclumps = valueNoise2(xz * td.shore2.x + vec2f(7.1, 2.9), td.seed + 33u) * 0.55
              + valueNoise2(xz * td.shore2.y + vec2f(3.9, 6.7), td.seed + 34u) * 0.45;
  // Lichen is a crust in patches with crisp edges, thick low in the splash zone and breaking up into
  // fewer, smaller patches as its cover tapers upward (shore-live.js), not a band or a soft stain.
  let lichen = smoothstep(0.5, 0.57, lclumps + (shore.b - 0.7) * 0.6) * min(1.0, shore.b * 1.5) * rockShare;
  let mud = shore.a * soilShare;
  albedo *= mix(vec3f(1.0), td.shore1.yzw, lichen) * mix(vec3f(1.0), td.mud.rgb, mud);
  // Kelp (lib-shore): broad blades lying downslope over rock at the lowest tides. It is the shore
  // cover's g channel on rock (on sand, g is the ripples).
  let pixM = max(fw.x, fw.y);
  let slopeLen = length(n.xz);
  let downDir = select(vec2f(0.0, 1.0), n.xz / max(slopeLen, 1e-4), slopeLen > 0.02);
  let alongDir = vec2f(-downDir.y, downDir.x);
  var shoreGrad = vec2f(0.0);
  var kelpCover = 0.0;
  // Wrack fronds (lib-shore): bladderwrack draped downslope over the mat, close up.
  var frondCover = 0.0;
  // The painted rock, not the detail's rock weight: the mat itself (the moss layer) hides that.
  let rockPaint = wf.z;
  // Fronds, kelp and litter are laid out on the ground from above, so on a steep face they smear
  // into long streaks down it: they fade out as the ground steepens past about 45 degrees.
  let flatEnough = smoothstep(0.55, 0.8, n.y);
  if (frondNear > 0.001 && rockPaint > 0.3 && shore.r > 0.01 && flatEnough > 0.0) {
    var fr = wrackFronds(xz, downDir, td.frond1.xy, td.frond1.zw, td.frond0.w, td.frond2.x, td.frond2.y,
      vec2f(td.shore0.w, td.shore1.x), td.seed, wrackMat, pixM);
    fr.cover *= smoothstep(0.3, 0.6, rockPaint) * frondNear * flatEnough;
    frondCover = fr.cover;
    let bladder = select(0.8 + 0.4 * fr.tone, td.frond3.z, fr.tone > 1.0);
    albedo = mix(albedo, td.frond0.rgb * bladder, fr.cover);
    shoreGrad += fr.grad * frondNear;
  }
  let kelpZone = shore.g * rockShare;
  // Near the kelp zone too (wrack borders it), so blades can lie across its edge.
  if (rockShare > 0.3 && (shore.g > 0.001 || shore.r > 0.01) && flatEnough > 0.0) {
    var kb = kelpBlades(xz, downDir, kelpZone, td.kelp1.xy, td.kelp1.zw, td.kelp0.w, td.kelp2.x, pixM, true);
    kb.cover *= smoothstep(0.3, 0.6, rockShare) * flatEnough;
    kelpCover = kb.cover;
    albedo = mix(albedo, td.kelp0.rgb * (0.8 + 0.4 * kb.tone), kb.cover);
    shoreGrad += kb.grad;
  }
  // The strandline (world/water/strandline.js): litter where each recent high tide reached, a
  // little above the water's level (the waves run up), widest on gentle slopes, broken into
  // clumps and gaps. Litter lies on sand and soil, hardly on grass, and never on rock or steep
  // ground (October 21, 2026), where it streaked and read as a fault.
  let slopeTan = slopeLen / max(n.y, 0.05);
  let lv = array<f32, 8>(td.strandL0.x, td.strandL0.y, td.strandL0.z, td.strandL0.w, td.strandL1.x, td.strandL1.y, td.strandL1.z, td.strandL1.w);
  let ls = array<f32, 8>(td.strandS0.x, td.strandS0.y, td.strandS0.z, td.strandS0.w, td.strandS1.x, td.strandS1.y, td.strandS1.z, td.strandS1.w);
  var strand = 0.0;
  for (var i = 0; i < 8; i++) {
    if (ls[i] <= 0.001) { continue; }
    let fi = f32(i);
    let dist = abs(y - lv[i] - td.strand0.x) / max(slopeTan, 0.03);
    let halfW = td.strand0.y * (0.5 + valueNoise2(xz * 0.35 + vec2f(fi * 7.1, 2.3), td.seed + 40u));
    let breakup = smoothstep(0.3, 0.55, valueNoise2(xz * 0.7 + vec2f(1.7, fi * 3.3), td.seed + 41u));
    strand = max(strand, ls[i] * exp(-(dist / halfW) * (dist / halfW)) * breakup);
  }
  strand *= 1.0 - 0.8 * mix(wf.x, gd.weights.x, gd.amount);
  strand *= (1.0 - smoothstep(0.1, 0.35, rockShare)) * flatEnough;
  // Litter floats off once water stands over it: none on the floor or walls of a filled pool, where
  // the lines would ring the bowl at every tide level and the water would bend them into streaks.
  strand *= 1.0 - smoothstep(0.004, 0.025, wdep);
  var strandCover = 0.0;
  if (strand > 0.01) {
    var st: Litter;
    if (td.strand0.z > 0.5) {
      st = strandLitter(xz, alongDir, strand * td.strand0.w, td.strand1.x, td.strand1.yz, td.strand1.w, td.strandAlb.w, pixM);
    } else {
      st.cover = strand * 0.5; st.grad = vec2f(0.0); st.tone = 0.5;   // low tier: the line as a tint
    }
    albedo = mix(albedo, td.strandAlb.rgb * (0.7 + 0.6 * st.tone), st.cover);
    strandCover = st.cover;
    shoreGrad += st.grad;
    // A few broken kelp blades lie along the line.
    if (td.kelp2.y > 0.0 && td.strand0.z > 0.5) {
      let kp = kelpBlades(xz + vec2f(31.7, 13.1), alongDir, strand * td.kelp2.y, td.kelp1.xy * vec2f(2.5, 1.5), td.kelp1.zw * 0.6, td.kelp0.w, td.kelp2.x, pixM, false);
      albedo = mix(albedo, td.kelp0.rgb * (0.9 + 0.3 * kp.tone), kp.cover);
      shoreGrad += kp.grad * kp.cover;
      kelpCover = max(kelpCover, kp.cover);
    }
  }
  // Lugworm casts: coils of worked sand on the wet flats, close up only.
  if (td.casts[0].z > 0.0 && viewDist < td.cast1.w) {
    let lug = lugCasts(xz, td.casts, CastShape(td.cast0.x, td.cast0.y, td.cast0.z, td.cast0.w), td.seed + 50u, pixM);
    let fade = 1.0 - smoothstep(td.cast1.w * 0.6, td.cast1.w, viewDist);
    albedo = mix(albedo, albedo * td.cast1.rgb * (0.6 + 0.45 * lug.tone), lug.cover * fade);
    shoreGrad += lug.grad * fade;
  }
  // Wet to dry (lush.js): the grass layer takes the blades' tint, deeper by the water, paler and
  // straw-cured on the dry rise, so the areas read past where blades end, with no ring there.
  if (td.lushWet.w > 0.5) {
    let lush = textureSampleLevel(coverTex, linearSampler, (xz + 80.0) / 192.0, 0.0).b;
    let m = td.lushDry.w;
    let tint = select(mix(td.lushDry.rgb, vec3f(1.0), clamp(lush / m, 0.0, 1.0)),
                      mix(vec3f(1.0), td.lushWet.rgb, clamp((lush - m) / (1.0 - m), 0.0, 1.0)), lush >= m);
    albedo *= mix(vec3f(1.0), tint, gd.weights.x * (1.0 - moss));
  }
  // Silt: in deeper, quieter water fine mud settles over the soft parts of the bed (not on sand or
  // stone), in soft drifts, so a pond floor is a dark, even brown with the bed showing through.
  let soft = w.w / max(w.x + w.y + w.z + w.w, 1e-4);
  let drift = 0.75 + 0.5 * valueNoise2(xz * 0.45 + vec2f(17.3, 4.1), td.seed + 12u);
  // The drowned meadow: under shallow, still water a grassy bed keeps its drowned grass, weed and
  // algae, a mottled olive rather than bare silt (a marsh floor, a pond's shallow margin). Deeper
  // water and running water leave the bare bed.
  let still = 1.0 - smoothstep(td.weed2.z, td.weed2.w, length(waterVelAt(xz)));
  let mottle = valueNoise2(xz * 0.8 + vec2f(3.1, 8.7), td.seed + 13u) * 0.6 + valueNoise2(xz * 2.9 + vec2f(1.3, 6.1), td.seed + 14u) * 0.4;
  let weed = drownedGrass * (1.0 - smoothstep(td.weed2.x, td.weed2.y, wdep)) * still * td.weed.w * smoothstep(0.2, 0.6, mottle);
  let silt = clamp(smoothstep(td.siltDepth.x, td.siltDepth.y, wdep) * td.siltCover * soft * drift, 0.0, 1.0) * (1.0 - weed);
  albedo = mix(albedo, td.albedoSilt, silt);
  albedo = mix(albedo, td.weed.rgb * (0.8 + 0.4 * mottle), weed);
  // The visual wetness map (world/terrain/wetness.js): r wetness, g puddle level, b drying margin.
  let wetTex = textureSampleLevel(wetMap, linearSampler, terrainUv(xz), 0.0);
  // The drying margin (A8): bed that fresh water covered in the last few game days and is now
  // exposed is pond silt, soaked at first (the wet look below darkens it), lightening as it dries
  // and opening into polygonal cracks, then blending back into the ground. Grass does not show on
  // it. The tide band never gets a margin (the wetness pass clears it there).
  var mudCover = 0.0;
  var mudDamp = 0.0;
  var crackOcc = 1.0;
  if (td.margin3.z > 0.5 && wetTex.b > 0.004) {
    let age = 1.0 - wetTex.b;
    let exposed = 1.0 - smoothstep(0.002, 0.012, wdep);
    let sandShare = mix(wf.y, gd.weights.y, gd.amount);
    mudCover = smoothstep(0.0, td.margin3.x, wetTex.b) * exposed * td.margin0.w
             * (1.0 - 0.9 * rockShare) * (1.0 - 0.5 * sandShare);
    if (mudCover > 0.001) {
      mudDamp = 1.0 - smoothstep(td.margin1.x, td.margin1.y, age);
      let opening = smoothstep(td.margin1.z, td.margin1.w, age);
      let cell = 1.0 / td.margin2.x;
      let halfW = 0.5 * td.margin2.y * opening;
      // Far off, the lines are their average share of the ground; close up, drawn.
      var crackShare = 2.0 * halfW / cell;
      let near = 1.0 - smoothstep(0.08 * cell, 0.25 * cell, pixM);
      if (near > 0.001 && opening > 0.001) {
        // A slight wobble so plate edges are not ruler-straight.
        let wob = vec2f(valueNoise2(xz * 9.0, td.seed + 60u), valueNoise2(xz * 9.0 + vec2f(3.1, 7.7), td.seed + 61u)) - 0.5;
        let cr = mudCracks(xz * td.margin2.x + wob * 0.3, td.seed + 62u);
        let dM = cr.x * cell;   // meters from the crack's center line
        let aa = max(pixM, 0.002);
        let inCrack = 1.0 - smoothstep(halfW - 0.5 * aa, halfW + 0.5 * aa, dM);
        // Plate edges slope down into the crack over a few times its width (height falls toward
        // the neighbor plate, so the gradient points back toward this plate's center).
        let edge = 1.0 - smoothstep(halfW, 4.0 * halfW + 0.01, dM);
        shoreGrad -= cr.yz * edge * td.margin2.w * opening * near * mudCover;
        crackShare = mix(crackShare, inCrack, near);
      }
      // A crack is a light trap: its floor sees little sky or sun.
      crackOcc = 1.0 - td.margin2.z * min(crackShare, 1.0) * mudCover;
    }
  }
  albedo = mix(albedo, td.margin0.rgb, mudCover) * crackOcc;
  // Macro variation (docs/22): a slow tone drift near and far, so no repeat survives at a distance.
  albedo *= groundMacro(xz, td.seed);
  // Wet ground (docs/22 G3, after Lagarde 2013). The visual wetness map (world/terrain/wetness.js)
  // remembers live water, the tide, rain and damp hollows, spreads into banks and dries over game
  // time; its g channel is how far rain has filled the puddles.
  let wet = wetTex.r * (1.0 - td.camp1.z * trod);   // trodden ground sheds water and dries first
  // Damp: porous ground (sand, soil) drinks the water and goes dark and satin; dense rock darkens
  // a little but turns shiny. Moss is already a damp surface and changes least.
  let por = mix(gd.porosity, td.margin3.y, mudCover);
  // Wrack and kelp glisten and mud stays soaked, whatever the wetness map says; dried litter on the
  // strandline lies above the damp sand. A fresh drying margin stays soaked longer than the map.
  let damp = max(max(wet * (1.0 - 0.6 * moss) * (1.0 - 0.7 * strandCover), max(max(max(wrack * 0.9, frondCover * 0.6), kelpCover), mud * td.shore2.z)), mudDamp * mudCover);
  albedo *= mix(1.0, mix(td.wetLook.z, td.wetLook.w, por), damp);
  let cavity = gd.cavity * crackOcc;
  // Grass blades stay rough when wet (they scatter the light), so the meadow never turns glossy.
  let grassy = gd.weights.x * (1.0 - moss) * (1.0 - mudCover);
  var roughness = mix(gd.roughness, mix(td.wetLook.x, td.wetLook.y, por), damp * (1.0 - sub) * (1.0 - 0.85 * grassy));
  // Puddles: on flat ground, rain fills the low spots first. Where water stands is set by the
  // ground's own relief (the detail height, so ruts and the gaps between stones fill first) plus a
  // slow undulation of a few meters, so puddles gather in real dips, not everywhere at once.
  let flatGround = smoothstep(td.puddle.x, td.puddle.y, n.y);
  let undulation = valueNoise2(xz * td.puddle.z, td.seed + 21u) * 0.6 + valueNoise2(xz * td.puddle.z * 2.7 + 5.3, td.seed + 22u) * 0.4;
  let standHeight = mix(gd.height, undulation, td.puddle.w);
  // Turf soaks rain up: on grass the level rises much less, so only the deepest meadow dips flood.
  let level = wetTex.g * td.puddle2.z * (1.0 - td.turf * grassy);
  let standing = (1.0 - smoothstep(level - 0.035, level, standHeight)) * step(0.01, level) * flatGround * (1.0 - sub);
  albedo *= mix(1.0, td.puddle2.y, standing);
  roughness = mix(roughness, td.puddle2.x, standing);
  // Puddle surface: flat water, rung by raindrops where a pixel can hold the rings.
  let viewDistG = distance(in.world, frame.cameraPos);
  let vG = (frame.cameraPos - in.world) / max(viewDistG, 1e-4);
  var nG = normalize(gd.normal - vec3f(shoreGrad.x, 0.0, shoreGrad.y));
  if (td.ripple.z > 0.5 && shore.g > 0.01 && kelpZone < 0.01) {
    // Wave ripples in the sand: crests run along the shore (across the slope), a few centimeters
    // apart and bent by slow noise, with a gentle stoss side and a steeper lee (two harmonics).
    // They fade before a pixel grows too large to hold them.
    let flat2 = length(n.xz);
    let dir = select(vec2f(1.0, 0.0), n.xz / max(flat2, 1e-4), flat2 > 0.02);
    let warp = valueNoise2(xz * td.mud.w, td.seed + 35u) * 6.2831853;
    let ph = dot(xz, dir) * td.ripple.x + warp;
    let fade = 1.0 - smoothstep(td.ripple.w * 0.07, td.ripple.w * 0.18, max(fw.x, fw.y));
    let k = shore.g * mix(wf.y, gd.weights.y, gd.amount) * fade * td.ripple.y;
    nG = normalize(nG - vec3f(dir.x, 0.0, dir.y) * (cos(ph) + 0.35 * cos(2.0 * ph)) * k);
  }
  var nShade = nG;
  if (standing > 0.001) {
    let rr = RainRings(td.rain, td.rain2);
    let pixM = viewDistG * 2.0 / (frame.proj[1][1] * frame.renderSize.y) / max(abs(vG.y), 0.15);
    let rs = rainRings(rr, xz, frame.animTime) * rainRingsVisible(rr, pixM);
    nShade = normalize(mix(nG, normalize(vec3f(-rs.x, 1.0, -rs.y)), standing));
  }
  // Wet ground and puddles reflect the sky (the probe, blurred to their roughness); dry ground
  // stays matte. Schlick Fresnel with the roughness-limited rim (Karis 2014), times the cavity
  // (crevices see little sky).
  let wetAll = max(smoothstep(0.0, 0.6, damp) * (1.0 - sub) * (1.0 - 0.85 * grassy), standing);
  var skySpec = vec3f(0.0);
  if (wetAll > 0.001) {
    let f0w = mix(ground.f0, td.puddle2.w, standing);
    let r = reflect(-vG, nShade);
    let levels = f32(textureNumLevels(probeTex));
    let skyL = textureSampleLevel(probeTex, probeSampler, r, probeLod(roughness, levels)).rgb * PROBE_INV_SCALE;
    let nv = max(dot(nShade, vG), 0.0);
    let fr = f0w + (max(1.0 - roughness, f0w) - f0w) * pow(1.0 - nv, 5.0);
    skySpec = skyL * fr * mix(cavity, 1.0, standing) * wetAll;
  }

  // Caustics (lib-caustics): focused sun on the bed under live water, or moon at night. They scale
  // only direct light, so they are gone in shadow and nearly so by moonlight.
  let toLight = select(frame.moonDir, frame.sunDir, frame.sunDir.y > 0.0);
  var caustic = 1.0;
  if (wdep > td.caustics.depthFade.x && toLight.y > 0.0 && td.caustics.look.y > 0.5) {
    let entry = causticEntry(xz, toLight, wdep, td.caustics.motion.w);
    caustic = causticLight(td.caustics, entry, waterVelAt(entry), wdep, max(fw.x, fw.y), frame.animTime, td.seed);
  }

  var color = shadeGround(albedo, in.world, n, nShade, roughness, cavity, in.pos, ground.terminator, mix(ground.f0, td.puddle2.w, standing), ground.specMode, caustic, skySpec);
  color = mix(color, td.ringColor, max(max(ringAlpha(xz), marksAlpha(xz, max(fw.x, fw.y)) * td.ringOpacity), cliffLineAlpha(xz, y, max(fw.x, fw.y))));
  // normalId keeps the mesh normal, so pebbles and cracks never get outlines (docs/22).
  return FsOut(vec4f(color, 1.0), vec4f(octEncode(n), 0.0, 1.0 / 3.0));
}

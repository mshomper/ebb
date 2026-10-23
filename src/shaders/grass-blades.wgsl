// Grass blades (docs 10, 04): the meadow as GPU blades with no mesh. Each blade is three
// triangles (two segments and a tip) built from vertex_index. Blades stand on a world-anchored
// jittered grid in two square rings around the view's focus: a dense near ring and a sparser far
// ring whose blades are wider to cover the same ground, blended across a soft round band. A blade exists where the painted grass
// weight says so (hash against weight), never in water; it bends at rest, sways with the wind and
// passing gusts, and shrinks away toward the far edge so the meadow meets the textured ground with
// no line. Lit like the ground (sun and moon with shadows, sky fill, aerial perspective) with a
// little wrap for light through the blades; no palette colors here (docs/05).
// The marsh's rushes are drawn by the same shader (kind.z >= 0): stiff blades in tussocks where the
// rush cover is, standing on the bed in shallow water with open water between the tussocks.

// #include common
// #include lib-hash
// #include lighting-bindings
// #include lib-sky
// #include lib-terrain
// #include lib-lighting
// #include lib-water

struct GrassDraw {
  focus: vec2f, time: f32, wind: f32,          // view focus (m); real seconds; wind strength 0..1
  windDir: vec2f, height: f32, width: f32,     // direction the wind blows toward; blade size now (m)
  albedo: vec3f, rootShade: f32,               // season albedo (linear); base darkening
  rings: array<vec4f, 2>,                      // x spacing (m), y blades per side, z where the near-to-far band starts (ring 0) and ends (ring 1) (m), w keep share
  shape: vec4f,                                // x height variation, y width variation, z rest lean, w sway per unit wind
  look: vec4f,                                 // x fade from (m), y fade to (m), z 1 / gust size (1/m), w gust speed (m/s)
  look2: vec4f,                                // x wet darkening, y seed, z pixel width floor (pixels), w far-ring widening
  shape2: vec4f,                               // x tuft size (m), y how much tufts thicken and thin, z how much they raise and lower
  derived: vec4f,                              // the terrain's derived layers: x beach band top (m), y, z cos of the steep-rock slope range; w how much the near-to-far band's edge wobbles
  kind: vec4f,                                 // x cover channel (0 grass, 1 rushes), y deepest water a blade stands in (m), z tussock threshold (< 0: grass tufts), w how much thin cover raises it
  kind2: vec4f,                                // rushes: x tussock edge softness, y how much shorter a tussock's rim stands than its core, z stem widening on thinner tiers; w (both) the sea's level now plus its waves (m): no blade stands below it
  lushDry: vec4f,                              // wet-to-dry (lush.js): rgb the dry rise's albedo this season, w the lushness that looks like today's meadow
  lushWet: vec4f,                              // rgb the albedo by the water, w 1 when the grass reads the lush field
  lushH: vec4f,                                // x height factor on the dry rise, y by the water
  clearN: vec4f,                               // x how many clears are set
  clears: array<vec4f, 32>,                    // ground no blade stands on: x, z, radius (m), under each placed piece (src/world/pieces)
  pushes: array<vec4f, 4>,                     // where the walker presses the grass (W6): x, z, radius (m), strength 0..1 (0 unused)
  pad: vec4f,                                  // the keeper's camp pad (CP-16): x, z, radius (m; 0 no pad), w grass height there (share of normal)
  padLook: vec4f,                              // x how far outside the pad the height eases back to full (m), y how much grass thins at its center (wear)
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var<uniform> gd: GrassDraw;
@group(2) @binding(1) var heightTex: texture_2d<f32>;
@group(2) @binding(2) var materialTex: texture_2d<f32>;
@group(2) @binding(3) var linearSampler: sampler;
@group(2) @binding(4) var waterDepth: texture_2d<f32>;
@group(2) @binding(5) var coverTex: texture_2d<f32>;   // cover 0..1 (r grass, g rushes, b lush: wet to dry), 1 m world grid from -80 m (world/growth)

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) up: f32,          // 0 at the root, 1 at the tip
  @location(3) tint: f32,        // per-blade albedo variation
  @location(4) groundN: vec3f,
  @location(5) albedo: vec3f,    // the blade's albedo: the season's, wet or dry by where it stands
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

// The nine corners of a blade: (side -1..1, level 0..1) for three triangles.
var<private> CORNERS_FAR: array<vec2f, 3> = array<vec2f, 3>(vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0));
var<private> CORNERS: array<vec2f, 9> = array<vec2f, 9>(
  vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(-1.0, 0.5),
  vec2f(1.0, 0.0), vec2f(1.0, 0.5), vec2f(-1.0, 0.5),
  vec2f(-1.0, 0.5), vec2f(1.0, 0.5), vec2f(0.0, 1.0));

fn waterAt(xz: vec2f) -> f32 {
  let c = clamp(vec2i(floor(waterCellCoord(xz) + 0.5)), vec2i(0), vec2i(WATER_CELLS - 1));
  return textureLoad(waterDepth, c, 0).r;
}

fn nothing() -> VsOut {
  var o: VsOut;
  o.pos = vec4f(0.0, 0.0, -2.0, 1.0);   // outside the clip volume: the triangle is dropped
  o.world = vec3f(0.0); o.normal = vec3f(0.0, 1.0, 0.0); o.up = 0.0; o.tint = 0.0; o.groundN = vec3f(0.0, 1.0, 0.0);
  o.albedo = vec3f(0.0);
  return o;
}

@vertex
fn vsBlade(@builtin(vertex_index) vi: u32, @builtin(instance_index) ring: u32) -> VsOut {
  let r = gd.rings[ring];
  let perSide = u32(r.y);
  // Near blades are three triangles (two segments and a tip); far blades, a few pixels tall, are one.
  let per = select(9u, 3u, ring == 1u);
  let blade = vi / per;
  let corner = select(CORNERS[vi % 9u], CORNERS_FAR[vi % 3u], ring == 1u);
  // World-anchored grid: the ring is centered on the focus snapped to the spacing, so a blade keeps
  // its world cell (and its hash) as the view moves.
  let s = r.x;
  let origin = floor(gd.focus / s) - f32(perSide / 2u);
  let cell = origin + vec2f(f32(blade % perSide), f32(blade / perSide));
  let ci = vec2u(vec2i(cell) + vec2i(1 << 20));
  let h0 = hash3(vec3u(ci, u32(gd.look2.y) + ring * 101u));
  let h1 = pcg(h0);
  let h2 = pcg(h1);
  let h3 = pcg(h2);
  let xz = (cell + vec2f(hashToFloat(h0), hashToFloat(h1))) * s;
  // Near and far rings meet in a soft round band (rings[0].z to rings[1].z, its edge wobbled by a
  // slow noise), never along the near square's edge: near blades thin out across it as the far
  // ring's fill in, so from far above no box shows where the dense meadow ends.
  let dist = length(xz - gd.focus);
  if (dist > gd.look.y) { return nothing(); }
  // Nothing grows through a stone: blades stand around it, not in it.
  for (var c = 0u; c < u32(gd.clearN.x); c++) {
    let cl = gd.clears[c];
    if (distance(xz, cl.xy) < cl.z) { return nothing(); }
  }
  let wob = (valueNoise2(xz / 9.0, u32(gd.look2.y) + 11u) - 0.5) * 2.0 * gd.derived.w;
  let band = smoothstep(gd.rings[0].z, gd.rings[1].z, dist * (1.0 + wob));
  let share = select(1.0 - band, band, ring == 1u);
  if (share <= 0.0) { return nothing(); }
  // The growth step's cover: grass, how well grass likes this ground (it drowns slowly in a new
  // pond, thins on salt, greens again when the ground recovers); rushes, where the marsh is. Rushes
  // grow on little of the island, so a blade with none here stops before reading the ground.
  let covers = textureSampleLevel(coverTex, linearSampler, (xz + 80.0) / 192.0, 0.0).rgb;
  if (gd.kind.z >= 0.0 && covers.g < 0.02) { return nothing(); }
  // Where grass is painted, at the ring's density; never in water.
  // Painted grass, less what the terrain shader turns to sand (the beach band) and rock (steep
  // slopes), with the same rules, so blades never stand on the beach or a cliff.
  let groundH = terrainHeight(heightTex, xz);
  // The sea is drawn at the tide's level, not held in the water depth: nothing stands under it.
  if (groundH < gd.kind2.w) { return nothing(); }
  let nGround = terrainNormal(heightTex, xz);
  let steepRock = 1.0 - smoothstep(gd.derived.z, gd.derived.y, nGround.y);
  let beachSand = 1.0 - smoothstep(gd.derived.x - 0.15, gd.derived.x + 0.15, groundH);
  // The material weights after the same derived layers the terrain applies, then the terrain's
  // own rule: the top layer wins the look. Blades stand only where grass is that layer, so they
  // stop where sand or rock shows, even where the paint blends a little grass in.
  var w = textureSampleLevel(materialTex, linearSampler, terrainUv(xz), 0.0);   // grass, sand, rock, soil
  w = mix(w, vec4f(0.0, 0.0, 1.0, 0.0), steepRock);
  w = mix(w, vec4f(0.0, 1.0 - w.z, w.z, 0.0), beachSand);
  let others = max(w.y, max(w.z, w.w));
  let seedU = u32(gd.look2.y);
  // Tufts: a meadow is clumpy, thicker and taller in patches of half a meter or so.
  let tuft = valueNoise2(xz / gd.shape2.x, seedU + 7u) * 0.65 + valueNoise2(xz / gd.shape2.x * 2.7 + 3.1, seedU + 8u) * 0.35;
  let water = waterAt(xz);
  var keep = 0.0;
  var tall = 1.0;
  var bladeAlbedo = gd.albedo;
  var outward = vec2f(0.0);   // rushes: away from the tussock's core, so stems splay out
  if (gd.kind.z < 0.0) {
    // Grass, where it is painted and the top layer.
    let grassW = w.x * smoothstep(-0.05, 0.15, w.x - others) * covers.r;
    keep = grassW * r.w * mix(1.0 - gd.shape2.y, 1.0 + gd.shape2.y, tuft);
    tall = mix(1.0 - gd.shape2.z, 1.0 + gd.shape2.z, tuft);
    // Wet to dry (lush.js): taller and deeper green by the water, shorter and paler (curing toward
    // straw through the summer) on the dry rise; at `mid` today's meadow.
    if (gd.lushWet.w > 0.5) {
      let lush = covers.b;
      let m = gd.lushDry.w;
      let toMid = clamp(lush / m, 0.0, 1.0);
      let toWet = clamp((lush - m) / (1.0 - m), 0.0, 1.0);
      bladeAlbedo = select(mix(gd.lushDry.rgb, gd.albedo, toMid), mix(gd.albedo, gd.lushWet.rgb, toWet), lush >= m);
      tall *= select(mix(gd.lushH.x, 1.0, toMid), mix(1.0, gd.lushH.y, toWet), lush >= m);
    }
    // The keeper's camp pad (CP-16, CP-02): short, worn grass. Height capped at pad.w on the pad,
    // easing back to full over padLook.x outside it (the trodden edge); a little thinner toward the
    // center, where the wear is most.
    if (gd.pad.z > 0.0) {
      let pd = distance(xz, gd.pad.xy);
      let onPad = 1.0 - smoothstep(gd.pad.z, gd.pad.z + gd.padLook.x, pd);
      tall *= mix(1.0, gd.pad.w, onPad);
      let core = 1.0 - smoothstep(0.0, gd.pad.z, pd);
      keep *= 1.0 - gd.padLook.y * onPad * core;
    }
  } else {
    // Rushes: tussocks with open water between them, wherever the rush cover is (not on sand or
    // stone). Thin cover leaves fewer, smaller tussocks; a slower noise opens lanes of water.
    let rushW = covers.g * (1.0 - smoothstep(0.3, 0.6, max(w.y, w.z)));
    let lanes = valueNoise2(xz / (gd.shape2.x * 6.0) + vec2f(9.7, 4.3), seedU + 9u);
    let tus = tuft * 0.7 + lanes * 0.3;
    let thr = gd.kind.z + (1.0 - rushW) * gd.kind.w;
    keep = select(0.0, r.w * smoothstep(thr, thr + gd.kind2.x, tus), rushW > 0.02);
    // A tussock's core stands taller than its rim; in deeper water stems grow longer, so they
    // still rise well clear of it.
    tall = mix(1.0 - gd.kind2.y, 1.0, smoothstep(thr, thr + 0.2, tus)) + water * 0.8 / max(gd.height, 0.05);
    if (keep > 0.0) {
      let e = gd.shape2.x * 0.15;
      let tx = valueNoise2((xz + vec2f(e, 0.0)) / gd.shape2.x, seedU + 7u) * 0.65 + valueNoise2((xz + vec2f(e, 0.0)) / gd.shape2.x * 2.7 + 3.1, seedU + 8u) * 0.35;
      let tz = valueNoise2((xz + vec2f(0.0, e)) / gd.shape2.x, seedU + 7u) * 0.65 + valueNoise2((xz + vec2f(0.0, e)) / gd.shape2.x * 2.7 + 3.1, seedU + 8u) * 0.35;
      let g = vec2f(tx - tuft, tz - tuft);
      outward = -g / max(length(g), 1e-4);
    }
  }
  if (hashToFloat(h2) > keep * share || water > gd.kind.y) { return nothing(); }

  let groundY = groundH;
  let nG = nGround;
  let v3 = vec4f(hashToFloat(h3), hashToFloat(pcg(h3)), hashToFloat(pcg(h3 ^ 0x5bd1u)), hashToFloat(pcg(h3 ^ 0x2c9fu)));
  let fade = 1.0 - smoothstep(gd.look.x, gd.look.y, dist);
  let height = gd.height * (1.0 - gd.shape.x * 0.5 + gd.shape.x * v3.x) * tall * fade;
  if (height < 0.004) { return nothing(); }
  // Blades in a sparse ring cover more ground each; never thinner than a pixel or so.
  let pixelM = distance(vec3f(xz.x, groundY, xz.y), frame.cameraPos) * 2.0 / (frame.proj[1][1] * frame.renderSize.y);
  let widen = select(1.0, gd.look2.w, ring == 1u) * max(gd.kind2.z, 1.0);
  let width = max(gd.width * (1.0 - gd.shape.y * 0.5 + gd.shape.y * v3.y) * widen, pixelM * gd.look2.z);

  // Facing: a random yaw, turned halfway toward the camera so blades rarely show edge-on.
  let yaw = v3.z * 6.2831853;
  let toCam = normalize(frame.cameraPos.xz - xz + vec2f(1e-4));
  let face = normalize(mix(vec2f(cos(yaw), sin(yaw)), toCam, 0.5) + vec2f(1e-4));
  let side = vec2f(-face.y, face.x);
  // Bend: a resting lean in the blade's own direction, plus wind sway with passing gusts.
  let restDir = vec2f(cos(yaw + 1.3), sin(yaw + 1.3));
  let leanDir = select(restDir, normalize(restDir + outward * 1.5 + vec2f(1e-4)), any(outward != vec2f(0.0)));
  let gustPhase = dot(xz, gd.windDir) * gd.look.z - gd.time * gd.look.w * gd.look.z;
  let gust = 0.6 + 0.4 * sin(gustPhase * 6.2831853) + 0.25 * sin(gd.time * 2.3 + v3.w * 6.2831853);
  let sway = gd.wind * gd.shape.w * gust;
  var bend = leanDir * gd.shape.z + gd.windDir * sway;
  // Underfoot (W6): blades near the walker's feet and body lean away and press a little flatter,
  // springing back as the pressure eases (the strength fades on the CPU).
  var press = 0.0;
  for (var i = 0; i < 4; i++) {
    let pu = gd.pushes[i];
    if (pu.w <= 0.0) { continue; }
    let off = xz - pu.xy;
    let d = length(off);
    if (d >= pu.z) { continue; }
    let k = pu.w * (1.0 - d / pu.z) * (1.0 - d / pu.z);
    bend += off / max(d, 1e-3) * k * 2.2;
    press = max(press, k);
  }
  let pressed = height * (1.0 - 0.55 * press);
  let t = corner.y;
  let along = vec3f(bend.x, 0.0, bend.y) * pressed * t * t;
  let taper = 1.0 - t * 0.85;
  let p = vec3f(xz.x, groundY, xz.y) + nG * pressed * t + along + vec3f(side.x, 0.0, side.y) * corner.x * width * 0.5 * taper;

  var o: VsOut;
  o.world = p;
  o.pos = frame.viewProj * vec4f(p, 1.0);
  // Normal: mostly the ground's (a sward lights like a soft surface), tilted a little by the blade.
  let bladeN = normalize(vec3f(face.x, 0.4, face.y));
  o.normal = normalize(mix(nG, bladeN, 0.35));
  o.up = t;
  o.tint = v3.w;
  o.groundN = nG;
  o.albedo = bladeAlbedo;
  return o;
}

@fragment
fn fsBlade(in: VsOut) -> FsOut {
  // Base of the sward is in its own shade; tips catch the light. Rain darkens the blades.
  let ao = mix(gd.rootShade, 1.0, in.up);
  // Tips are younger and thinner: a little lighter, as light comes through them.
  var albedo = in.albedo * (0.8 + 0.4 * in.tint) * (0.85 + 0.35 * in.up) * mix(1.0, gd.look2.x, light.weather.w);
  let n = normalize(in.normal);
  let viewDist = distance(in.world, frame.cameraPos);
  let vis = shadowVisibility(in.world, in.groundN, viewDist, in.pos.xy);
  let casterIsSun = dot(light.shadowDir, frame.sunDir) > 0.999;
  let sunVis = select(1.0, vis, casterIsSun);
  let moonVis = select(vis, 1.0, casterIsSun);
  // A little wrap: thin blades pass some light through.
  let sunNl = clamp(dot(n, frame.sunDir) * 0.75 + 0.25, 0.0, 1.0);
  let moonNl = clamp(dot(n, frame.moonDir) * 0.75 + 0.25, 0.0, 1.0);
  let radiance = albedo * ((frame.sunIlluminance * sunNl * sunVis + frame.moonIlluminance * moonNl * moonVis + pointIllum(in.world, n, 0.25)) / PI * mix(0.8, 1.0, in.up)
                           + skyAmbient(n) * ao);
  let color = applyAerial(radiance * frame.exposure, in.pos.xy * frame.invRenderSize, viewDist);
  // normalId: the ground's normal and the terrain's outline group, so blades never get outlines.
  return FsOut(vec4f(color, 1.0), vec4f(octEncode(normalize(in.groundN)), 0.0, 1.0 / 3.0));
}

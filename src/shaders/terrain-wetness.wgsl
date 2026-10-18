// Visual wetness (docs/08, Wetness: simulation vs. look): how wet the ground looks, on the 0.25 m
// terrain grid, ping-ponged every half real second by world/terrain/wetness.js. Sources hold it up:
// live water, the sea below the tide line and a splash band above it, damp hollows (a floor that
// never dries); rain soaks it toward 1. A wetter neighbor lends wetness into the banks (capillary
// spread, about 1.5 m). Where nothing holds it, it dries by the step the CPU worked out from game
// time, sun and wind. Look only: the simulation never reads it.

// #include lib-hash
// #include lib-terrain
// #include lib-water

struct WetStep {
  origin: vec2u,     // first texel of the updated rect (the water rect, in 0.25 m texels)
  size: vec2u,
  tide: f32,         // sea level now (m)
  tideBand: f32,     // ground up to this far above the tide is splashed wet (m)
  waterFrom: f32,    // live water depth (m) where wetting starts
  waterFull: f32,    // and where it soaks fully
  dryStep: f32,      // wetness lost this update where nothing holds it
  rainStep: f32,     // wetness gained this update from rain
  spreadPerM: f32,   // wetness lent by a neighbor drops this much per meter of bank
  riseWeight: f32,   // meters of bank each meter of climb counts as
  dampWet: f32,      // wetness of a damp hollow
  rainInit: f32,     // first build only: 1 while it rains
  salt: u32,         // per-update salt for the dithered store
  puddleFill: f32,   // puddle level gained this update from rain (G3)
  puddleDrain: f32,  // puddle level lost this update to drying
  _p0: f32, _p1: f32, _p2: f32,
};

@group(0) @binding(0) var<uniform> ws: WetStep;
@group(0) @binding(1) var heightTex: texture_2d<f32>;
@group(0) @binding(2) var waterDepth: texture_2d<f32>;   // live water depth (m), water-depth.wgsl
@group(0) @binding(3) var dampHollows: texture_2d<f32>;  // the water summary's damp hollows (r8unorm, 0.5 m)
@group(0) @binding(4) var wetPrev: texture_2d<f32>;
@group(0) @binding(5) var wetNext: texture_storage_2d<rgba8unorm, write>;

// Reach of one spread step in texels; more reach comes from repeating it each update.
const SPREAD_R: i32 = 2;

// Damp hollow share at a world point, bilinear between the 0.5 m cells for soft edges.
fn dampAt(xz: vec2f) -> f32 {
  let g = waterCellCoord(xz);
  let c = vec2i(floor(g));
  let t = g - floor(g);
  let hi = vec2i(WATER_CELLS - 1);
  let a = textureLoad(dampHollows, clamp(c, vec2i(0), hi), 0).r;
  let b = textureLoad(dampHollows, clamp(c + vec2i(1, 0), vec2i(0), hi), 0).r;
  let d = textureLoad(dampHollows, clamp(c + vec2i(0, 1), vec2i(0), hi), 0).r;
  let e = textureLoad(dampHollows, clamp(c + vec2i(1, 1), vec2i(0), hi), 0).r;
  return mix(mix(a, b, t.x), mix(d, e, t.x), t.y);
}

// Wetness the sources hold texel c (ground height h) at right now.
fn sourceWet(c: vec2i, h: f32) -> f32 {
  // Live water: a film of a few millimeters dampens, a centimeter or more soaks. A water cell spans
  // 2 x 2 texels; a texel standing above the cell's water surface is bank, not bed.
  let wc = clamp(c / 2, vec2i(0), vec2i(WATER_CELLS - 1));
  let d = textureLoad(waterDepth, wc, 0).r;
  let surface = waterBed(heightTex, wc) + d;
  let live = smoothstep(ws.waterFrom, ws.waterFull, d) * step(h, surface + 0.01);
  // The sea below the tide line, and the splash band just above it.
  let sea = 1.0 - smoothstep(ws.tide - 0.05, ws.tide + ws.tideBand, h);
  let xz = TERRAIN_ORIGIN + (vec2f(c) + 0.5) * TERRAIN_CELL;
  return max(max(live, sea), dampAt(xz) * ws.dampWet);
}

// Dithered rounding into the 8-bit store: a slow night-time drying step is smaller than one level,
// so plain rounding would hold the ground wet forever; this keeps the average exact.
// r wetness, g puddle level (G3: how far rain has filled the low spots; the terrain draw decides
// where on flat ground that much water stands).
fn storeWet(c: vec2i, w: f32, puddle: f32) {
  let r = hashToFloat(hash3(vec3u(vec2u(c), ws.salt)));
  let q = min(floor(clamp(w, 0.0, 1.0) * 255.0 + r), 255.0) / 255.0;
  let p = min(floor(clamp(puddle, 0.0, 1.0) * 255.0 + r), 255.0) / 255.0;
  textureStore(wetNext, c, vec4f(q, p, 0.0, 1.0));
}

// First build: sources only, no drying history (and soaked, with half-filled puddles, if it is
// raining now).
@compute @workgroup_size(8, 8)
fn csInit(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= ws.size)) { return; }
  let c = vec2i(ws.origin + id.xy);
  storeWet(c, max(sourceWet(c, terrainLoad(heightTex, c)), ws.rainInit), 0.5 * ws.rainInit);
}

@compute @workgroup_size(8, 8)
fn csStep(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= ws.size)) { return; }
  let c = vec2i(ws.origin + id.xy);
  let h = terrainLoad(heightTex, c);
  let hi = vec2i(TERRAIN_CELLS - 1);
  // Memory: the last update's wetness, soaked further by rain and dried by sun and wind.
  let prev = textureLoad(wetPrev, c, 0);
  var w = clamp(prev.r + ws.rainStep - ws.dryStep, 0.0, 1.0);
  // Puddles fill while it rains and drain as the ground dries (they shrink from their edges, since
  // the shallow rims are the first spots above the falling level).
  let puddle = clamp(prev.g + ws.puddleFill - ws.puddleDrain, 0.0, 1.0);
  // Capillary spread: a wetter neighbor lends its wetness less a share per meter between them, and
  // more per meter of climb, so a dug bank reads soaked by the water and fades out up the slope.
  for (var j = -SPREAD_R; j <= SPREAD_R; j++) {
    for (var i = -SPREAD_R; i <= SPREAD_R; i++) {
      if (i == 0 && j == 0) { continue; }
      let q = clamp(c + vec2i(i, j), vec2i(0), hi);
      let nw = textureLoad(wetPrev, q, 0).r;
      if (nw <= w) { continue; }
      let climb = max(h - terrainLoad(heightTex, q), 0.0);
      let run = length(vec2f(f32(i), f32(j))) * TERRAIN_CELL + climb * ws.riseWeight;
      w = max(w, nw - run * ws.spreadPerM);
    }
  }
  storeWet(c, max(w, sourceWet(c, h)), puddle);
}

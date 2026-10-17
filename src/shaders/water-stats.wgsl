// Water health numbers for tools/water-lab.html (docs/07, stability): total volume, wet cells,
// fastest speed and NaN count over the simulated rect. Integer atomics, so the totals are exact
// for the units chosen (volume in 0.1 liter steps, speed as float bits, which order like unsigned
// integers for non-negative floats).

// #include lib-terrain
// #include lib-water

struct Stats {
  volume: atomic<u32>,    // 1e-4 m^3 units
  wet: atomic<u32>,
  maxSpeedBits: atomic<u32>,
  nan: atomic<u32>,
};

@group(0) @binding(0) var<uniform> w: WaterSim;
@group(0) @binding(1) var depthTex: texture_2d<f32>;
@group(0) @binding(2) var velTex: texture_2d<f32>;
@group(0) @binding(3) var<storage, read_write> stats: Stats;

@compute @workgroup_size(8, 8)
fn csStats(@builtin(global_invocation_id) gid: vec3u) {
  if (any(gid.xy >= w.rectSize)) { return; }
  let c = vec2i(gid.xy + w.rectOrigin);
  if (onWaterBoundary(c, w)) { return; }
  let d = textureLoad(depthTex, c, 0).r;
  let v = textureLoad(velTex, c, 0).rg;
  if (d != d || any(v != v)) { atomicAdd(&stats.nan, 1u); return; }
  if (d > w.dry) {
    atomicAdd(&stats.wet, 1u);
    atomicAdd(&stats.volume, u32(round(d * WATER_CELL * WATER_CELL * 1e4)));
    atomicMax(&stats.maxSpeedBits, bitcast<u32>(length(v)));
  }
}

// Virtual pipe model, step 1 of 2: outflow through the four pipes of every cell (docs/07; O'Brien
// and Hodgins 1995, Mei, Decaudin and Hu 2007). Each cell owns its outflows, so there are no races.
//   f_i <- max(0, f_i (1 - c_f dt) + dt A g dh_i / l),   A = l^2
//   K   <- min(1, d l^2 / (sum f_i dt))                     never drain a cell below zero
// Pipes to cells outside the simulated rect are walls.

// #include lib-terrain
// #include lib-water

@group(0) @binding(0) var<uniform> w: WaterSim;
@group(0) @binding(1) var heightTex: texture_2d<f32>;
@group(0) @binding(2) var depthIn: texture_2d<f32>;
@group(0) @binding(3) var fluxIn: texture_2d<f32>;
@group(0) @binding(4) var fluxOut: texture_storage_2d<rgba32float, write>;

const G: f32 = 9.81;

fn depthAt(c: vec2i) -> f32 {
  return textureLoad(depthIn, c, 0).r;
}

@compute @workgroup_size(8, 8)
fn csFlux(@builtin(global_invocation_id) gid: vec3u) {
  if (any(gid.xy >= w.rectSize)) { return; }
  let c = vec2i(gid.xy + w.rectOrigin);
  let d = depthAt(c);
  let s = waterBed(heightTex, c) + d;
  // Thin sheets get extra drag so a film on a slope stops sliding instead of creeping forever.
  let cf = w.friction + w.thinFriction * clamp(1.0 - d / w.thinDepth, 0.0, 1.0);
  let damp = max(1.0 - cf * w.dt, 0.0);
  let k = w.dt * WATER_CELL * WATER_CELL * G / WATER_CELL;
  let f0 = textureLoad(fluxIn, c, 0);
  // Directions: x +X, y -X, z +Z, w -Z.
  let nb = array<vec2i, 4>(vec2i(1, 0), vec2i(-1, 0), vec2i(0, 1), vec2i(0, -1));
  var f = vec4f(0.0);
  for (var i = 0; i < 4; i++) {
    let q = c + nb[i];
    if (!inWaterRect(q, w)) { continue; }
    let sq = waterBed(heightTex, q) + depthAt(q);
    f[i] = max(0.0, f0[i] * damp + k * (s - sq));
    // Manning's law caps the speed through the pipe, v <= d^(2/3) sqrt(S) / n, so thin water on a
    // slope runs as a slow sheet a centimeter or two deep instead of racing off at many m/s.
    let slopeS = max(s - sq, 0.0) / WATER_CELL;
    let vcap = min(w.maxSpeed, pow(max(d, 1e-6), 2.0 / 3.0) * sqrt(slopeS) * w.manningInv);
    f[i] = min(f[i], vcap * d * WATER_CELL);
  }
  let out = (f.x + f.y + f.z + f.w) * w.dt;
  if (out > 0.0) {
    f *= min(1.0, d * WATER_CELL * WATER_CELL / out);
  }
  // A NaN anywhere resets the pipes (the depth pass resets the cell).
  if (any(f != f)) { f = vec4f(0.0); }
  textureStore(fluxOut, vec2u(c), f);
}

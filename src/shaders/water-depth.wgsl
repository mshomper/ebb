// Virtual pipe model, step 2 of 2: new depth from the pipe flows, the spring, and the sea ring,
// plus the velocity field the drawing uses for flow-mapped ripples (docs/07).
//   d <- d + dt (sum f_in - sum f_out) / l^2 + dt * source
//   u <- (f_left_in - f_left_out + f_right_out - f_right_in) / (2 l d_avg)   (same for v)
// The outer ring of the rect is open sea, held at the tide level every step.

// #include lib-terrain
// #include lib-water

@group(0) @binding(0) var<uniform> w: WaterSim;
@group(0) @binding(1) var heightTex: texture_2d<f32>;
@group(0) @binding(2) var depthIn: texture_2d<f32>;
@group(0) @binding(3) var fluxIn: texture_2d<f32>;      // this step's new flux
@group(0) @binding(4) var depthOut: texture_storage_2d<r32float, write>;
@group(0) @binding(5) var velOut: texture_storage_2d<rg32float, write>;

fn fluxAt(c: vec2i) -> vec4f {
  if (!inWaterRect(c, w)) { return vec4f(0.0); }
  return textureLoad(fluxIn, c, 0);
}

@compute @workgroup_size(8, 8)
fn csDepth(@builtin(global_invocation_id) gid: vec3u) {
  if (any(gid.xy >= w.rectSize)) { return; }
  let c = vec2i(gid.xy + w.rectOrigin);
  let bed = waterBed(heightTex, c);
  if (onWaterBoundary(c, w)) {
    textureStore(depthOut, vec2u(c), vec4f(max(w.tide - bed, 0.0), 0.0, 0.0, 0.0));
    textureStore(velOut, vec2u(c), vec4f(0.0));
    return;
  }
  let d0 = textureLoad(depthIn, c, 0).r;
  let f = fluxAt(c);
  let fl = fluxAt(c + vec2i(-1, 0));   // left neighbor
  let fr = fluxAt(c + vec2i(1, 0));
  let fb = fluxAt(c + vec2i(0, -1));   // neighbor at -Z
  let ft = fluxAt(c + vec2i(0, 1));
  let inflow = fl.x + fr.y + fb.z + ft.w;
  let outflow = f.x + f.y + f.z + f.w;
  var d = d0 + w.dt * (inflow - outflow) / (WATER_CELL * WATER_CELL);
  if (all(vec2u(c) == w.springCell)) { d += w.dt * w.springRate; }
  d = max(d, 0.0);
  if (d != d) { d = 0.0; }

  // Velocity from the net flow through the cell, over the mean depth during the step.
  let dAvg = 0.5 * (d0 + d);
  var v = vec2f(0.0);
  if (dAvg > w.dry) {
    let qx = 0.5 * (fl.x - f.y + f.x - fr.y);
    let qz = 0.5 * (fb.z - f.w + f.z - ft.w);
    v = vec2f(qx, qz) / (WATER_CELL * dAvg);
    let sp = length(v);
    if (sp > w.maxSpeed) { v *= w.maxSpeed / sp; }
    if (any(v != v)) { v = vec2f(0.0); }
  }
  textureStore(depthOut, vec2u(c), vec4f(d, 0.0, 0.0, 0.0));
  textureStore(velOut, vec2u(c), vec4f(v, 0.0, 0.0));
}

// Transmittance LUT (256x64): transmittance from height h toward the top of the atmosphere along
// zenith cosine mu (Hillaire 2020, Bruneton mapping). Rebuilt only when the atmosphere changes.
// The same two-segment integration runs on the CPU in src/render/sky/atmosphere-cpu.js.

// #include common
// #include lib-atmosphere

@group(0) @binding(0) var<uniform> atmo: AtmosphereParams;
@group(0) @binding(1) var outLut: texture_storage_2d<rgba16float, write>;

const LOCAL_STEPS: i32 = 24;
const MAIN_STEPS: i32 = 40;

fn opticalDepthSegment(h0: f32, mu: f32, t0: f32, t1: f32, steps: i32) -> vec3f {
  let len = t1 - t0;
  if (len <= 0.0) { return vec3f(0.0); }
  let n = f32(steps);
  var od = vec3f(0.0);
  for (var i = 0; i < steps; i++) {
    let a = f32(i) / n;
    let b = f32(i + 1) / n;
    let m = (a + b) * 0.5;
    let t = t0 + len * m * m;
    let dt = len * (b * b - a * a);
    od += sampleMedium(atmo, heightAlong(h0, mu, t)).extinction * dt;
  }
  return od;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= u32(TRANSMITTANCE_SIZE.x) || id.y >= u32(TRANSMITTANCE_SIZE.y)) { return; }
  let uv = (vec2f(id.xy) + 0.5) / TRANSMITTANCE_SIZE;
  let hm = transmittanceParams(uv);
  let tTop = distToTop(hm.x, hm.y);
  let tLocal = localSegmentKm(atmo, hm.x, hm.y, tTop);
  let od = opticalDepthSegment(hm.x, hm.y, 0.0, tLocal, LOCAL_STEPS)
         + opticalDepthSegment(hm.x, hm.y, tLocal, tTop, MAIN_STEPS);
  textureStore(outLut, id.xy, vec4f(exp(-od), 1.0));
}

// Multiple-scattering LUT (32x32), Hillaire 2020 section 5.5: isotropic approximation of all
// scattering orders above the first. One workgroup per texel, 64 directions on the sphere.
// Stored per unit illuminance: multiply by the light's lux. u = light zenith cosine, v = sqrt(h / 100 km).

// #include common
// #include lib-atmosphere

@group(0) @binding(0) var<uniform> atmo: AtmosphereParams;
@group(0) @binding(1) var transmittanceLut: texture_2d<f32>;
@group(0) @binding(2) var lutSampler: sampler;
@group(0) @binding(3) var outLut: texture_storage_2d<rgba16float, write>;

const SQRT_SAMPLES: u32 = 8u;
const LOCAL_STEPS: i32 = 8;
const MAIN_STEPS: i32 = 16;

var<workgroup> sharedL: array<vec3f, 64>;
var<workgroup> sharedF: array<vec3f, 64>;

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let uv = (vec2f(wg.xy) + 0.5) / MULTISCATTER_SIZE;
  let muS = clamp(atmoUnitFromSubUv(uv.x, MULTISCATTER_SIZE), 0.0, 1.0) * 2.0 - 1.0;
  let v = clamp(atmoUnitFromSubUv(uv.y, MULTISCATTER_SIZE), 0.0, 1.0);
  let h = max(v * v * ATMO_DEPTH, 0.0);

  var light: AtmoLight;
  light.dir = vec3f(0.0, muS, sqrt(max(1.0 - muS * muS, 0.0)));
  light.illuminance = vec3f(1.0);
  light.sinRadius = SUN_SIN_RADIUS;

  let i = f32(li / SQRT_SAMPLES) + 0.5;
  let j = f32(li % SQRT_SAMPLES) + 0.5;
  let theta = 2.0 * PI * i / f32(SQRT_SAMPLES);
  let phi = acos(1.0 - 2.0 * j / f32(SQRT_SAMPLES));
  let dir = vec3f(cos(theta) * sin(phi), cos(phi), sin(theta) * sin(phi));

  let hitsGround = rayHitsGround(h, dir.y);
  var tEnd = distToTop(h, dir.y);
  if (hitsGround) { tEnd = distToGround(h, dir.y); }
  let tLocal = localSegmentKm(atmo, h, dir.y, tEnd);

  var acc: AtmoScatter;
  acc.L = vec3f(0.0);
  acc.T = vec3f(1.0);
  acc.F = vec3f(0.0);
  acc = integrateSegment(atmo, transmittanceLut, transmittanceLut, lutSampler, h, dir, 0.0, tLocal, LOCAL_STEPS,
                         light, light, 1, true, false, acc);
  acc = integrateSegment(atmo, transmittanceLut, transmittanceLut, lutSampler, h, dir, tLocal, tEnd, MAIN_STEPS,
                         light, light, 1, true, false, acc);
  var L = acc.L;
  if (hitsGround) {
    L += acc.T * groundBounce(atmo, transmittanceLut, lutSampler, h, dir, tEnd, light, light, 1);
  }

  sharedL[li] = L;
  sharedF[li] = acc.F;
  workgroupBarrier();
  for (var stride = 32u; stride > 0u; stride >>= 1u) {
    if (li < stride) {
      sharedL[li] += sharedL[li + stride];
      sharedF[li] += sharedF[li + stride];
    }
    workgroupBarrier();
  }
  if (li == 0u) {
    // Mean over the sphere times the isotropic phase: (sum * 4pi / N) / (4pi).
    let l2 = sharedL[0] / 64.0;
    let fms = sharedF[0] / 64.0;
    let psi = l2 / max(vec3f(1.0) - fms, vec3f(1e-3));
    textureStore(outLut, wg.xy, vec4f(psi, 1.0));
  }
}

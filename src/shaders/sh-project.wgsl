// Sky irradiance SH9 (Ramamoorthi and Hanrahan 2001) from the sky-view LUT plus a ground hemisphere
// (probe albedo x ground illuminance). Cloud cover blends the upper hemisphere toward a gray CIE
// overcast dome whose horizontal illuminance is the clear sky plus a share of the direct light.
// Output coefficients are pre-convolved with the cosine lobe and divided by pi, so
//   skyAmbient(n) = sum_i sh[i] * Y_i(n)   is outgoing radiance (nits) of a white Lambert surface.
// One workgroup of 64 threads, 32 x 32 equal-area samples (the LUT is smooth; SH9 needs few).
//
// The upper and lower hemispheres are projected separately (sky SH and a constant ground term), then
// combined once the clear-sky irradiance is known, so a single reduction serves everything.

// #include common
// #include lib-atmosphere

@group(0) @binding(0) var<uniform> atmo: AtmosphereParams;
@group(0) @binding(1) var<uniform> sky: SkyUniforms;
@group(0) @binding(2) var transmittanceLut: texture_2d<f32>;
@group(0) @binding(3) var skyViewLut: texture_2d<f32>;
@group(0) @binding(4) var lutSampler: sampler;
@group(0) @binding(5) var skySampler: sampler;
@group(0) @binding(6) var<storage, read_write> shOut: array<vec4f, 9>;
@group(0) @binding(7) var<storage, read_write> state: SkyState;

const N: u32 = 32u;          // samples per axis
const THREADS: u32 = 64u;
const SLOTS: u32 = 10u;      // 9 sky SH, 1 clear irradiance

var<workgroup> red: array<vec3f, 640>;   // THREADS * SLOTS

fn shBasis(d: vec3f) -> array<f32, 9> {
  return array<f32, 9>(
    0.282095,
    0.488603 * d.y, 0.488603 * d.z, 0.488603 * d.x,
    1.092548 * d.x * d.y, 1.092548 * d.y * d.z, 0.315392 * (3.0 * d.z * d.z - 1.0),
    1.092548 * d.x * d.z, 0.546274 * (d.x * d.x - d.y * d.y));
}

@compute @workgroup_size(64)
fn main(@builtin(local_invocation_index) li: u32) {
  let dOmega = 4.0 * PI / f32(N * N);
  var acc: array<vec3f, 10>;
  for (var k = 0u; k < 10u; k++) { acc[k] = vec3f(0.0); }

  // Upper hemisphere only (rows with y > 0): clear sky, plus the cosine-weighted dome basis below.
  for (var s = li; s < N * N / 2u; s += THREADS) {
    let i = s / N;
    let j = s % N;
    let y = 1.0 - (f32(i) + 0.5) / f32(N / 2u);
    let phi = 2.0 * PI * (f32(j) + 0.5) / f32(N);
    let r = sqrt(max(1.0 - y * y, 0.0));
    let d = vec3f(cos(phi) * r, y, sin(phi) * r);
    let L = textureSampleLevel(skyViewLut, skySampler, skyViewUv(d, sky.cameraHeightKm, sky.sizes.xy), 0.0).rgb
          * SKY_LUT_INV_SCALE;
    var b = shBasis(d);
    for (var k = 0u; k < 9u; k++) { acc[k] += L * (b[k] * dOmega); }
    acc[9] += L * (y * dOmega);
  }
  for (var k = 0u; k < 10u; k++) { red[k * THREADS + li] = acc[k]; }
  workgroupBarrier();
  for (var stride = THREADS / 2u; stride > 0u; stride >>= 1u) {
    if (li < stride) {
      for (var k = 0u; k < 10u; k++) { red[k * THREADS + li] += red[k * THREADS + li + stride]; }
    }
    workgroupBarrier();
  }
  if (li != 0u) { return; }

  let cloud = sky.weather.x;
  let eClear = red[9u * THREADS];
  let sunT = lightTransmittance(transmittanceLut, lutSampler, 0.0, sky.sunDir.y, sky.sunSinRadius);
  let moonT = lightTransmittance(transmittanceLut, lutSampler, 0.0, sky.moonDir.y, sky.moonSinRadius);
  let eDirect = sky.sunIlluminance * sunT * max(sky.sunDir.y, 0.0)
              + sky.moonIlluminance * moonT * max(sky.moonDir.y, 0.0);
  let eDome = atmoLuminance(eClear) + sky.weather.y * atmoLuminance(eDirect);
  let lz = overcastZenith(eDome);
  let eSky = mix(eClear, vec3f(eDome), cloud);
  let eGround = eDirect * (1.0 - sky.weather.z * cloud) + eSky;
  let lGround = sky.probeAlbedo * eGround / PI;

  // Analytic SH of the dome and the ground. Both depend only on y, so only Y00, Y1(y) and the y^2 parts of
  // Y20 (3z^2 - 1) and Y22 (x^2 - y^2) are non-zero; around the y axis both of those reduce to (1 - 3y^2) / 2.
  // Upper-hemisphere moments: int y^n = 2pi / (n + 1).
  //   dome f = Lz (1 + 2y) / 3:  int f = 4pi/3 Lz,  int f y = 7pi/9 Lz,  int f (1 - 3y^2)/2 = -pi/6 Lz
  //   ground constant g below:   int g = 2pi g,     int g y = -pi g,     int g (1 - 3y^2)/2 = 0
  var sh: array<vec3f, 9>;
  for (var k = 0u; k < 9u; k++) { sh[k] = red[k * THREADS] * (1.0 - cloud); }
  let dl = lz * cloud;
  sh[0] += 0.282095 * (vec3f(dl * 4.0 * PI / 3.0) + lGround * (2.0 * PI));
  sh[1] += 0.488603 * (vec3f(dl * 7.0 * PI / 9.0) - lGround * PI);
  sh[6] += vec3f(0.315392 * dl * (-PI / 6.0));
  sh[8] += vec3f(0.546274 * dl * (-PI / 6.0));

  // Cosine-lobe convolution A_l (pi, 2pi/3, pi/4) divided by pi.
  var band = array<f32, 9>(1.0, 2.0 / 3.0, 2.0 / 3.0, 2.0 / 3.0, 0.25, 0.25, 0.25, 0.25, 0.25);
  for (var k = 0u; k < 9u; k++) { shOut[k] = vec4f(sh[k] * band[k], 0.0); }
  state.dome = vec4f(vec3f(lz), cloud);
  state.skyIrradiance = vec4f(eSky, 0.0);
  state.groundRadiance = vec4f(lGround, 0.0);
  state.sunGround = vec4f(sky.sunIlluminance * sunT, 0.0);
}

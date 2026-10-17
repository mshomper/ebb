// Shared atmosphere model (docs/06): Hillaire, "A Scalable and Production Ready Sky and Atmosphere
// Rendering Technique" (EGSR 2020), plus a local ground aerosol layer for the diorama haze.
// Include after `common`. Declares no bindings: functions take textures and samplers as arguments.
//
// Units: planet geometry in km, heights above sea level in km, coefficients per km.
// LUT conventions (mirrored at the top of src/render/sky/atmosphere.js):
//   transmittance LUT  unitless, Bruneton (h, mu) mapping, rays that do not hit the ground
//   multi-AtmoScatter LUT  per unit illuminance (multiply by the AtmoLight's lux), u = mu_light, v = sqrt(h / 100 km)
//   sky-view LUT       nits * SKY_LUT_SCALE (sun + moon + airglow, clear sky), world azimuth in u
//   aerial froxels     rgb in-AtmoScatter nits * SKY_LUT_SCALE, a = mean transmittance

const ATMO_BOTTOM: f32 = 6360.0;   // km
const ATMO_TOP: f32 = 6460.0;      // km
const ATMO_DEPTH: f32 = 100.0;     // km, top minus bottom
const ATMO_H: f32 = 1132.2544;     // km, sqrt(top^2 - bottom^2)
const SKY_LUT_SCALE: f32 = 0.03125;    // stored value = nits * SKY_LUT_SCALE (keeps fp16 in range)
const SKY_LUT_INV_SCALE: f32 = 32.0;
const TRANSMITTANCE_SIZE: vec2f = vec2f(256.0, 64.0);
const MULTISCATTER_SIZE: f32 = 32.0;
const SUN_SIN_RADIUS: f32 = 0.004625;  // sin(0.265 deg), softens the earth-shadow edge

// Mirrors writeAtmosphereParams in src/render/sky/atmosphere.js (112 bytes).
struct AtmosphereParams {
  rayleighScattering: vec3f, rayleighInvScale: f32,   // 1/km, 1/(scale height in km)
  mieScattering: vec3f, mieInvScale: f32,
  mieExtinction: vec3f, mieG: f32,
  ozoneAbsorption: vec3f, ozoneCenter: f32,           // 1/km, km
  aerosolScattering: vec3f, aerosolInvScale: f32,     // ground aerosol after weather and dawn scaling
  aerosolExtinction: vec3f, aerosolG: f32,
  groundAlbedo: vec3f, ozoneHalfWidth: f32,
};

// Mirrors writeSkyUniforms in src/render/sky/atmosphere.js (288 bytes).
struct SkyUniforms {
  invViewProj: mat4x4f,
  cameraPos: vec3f, cameraHeightKm: f32,
  sunDir: vec3f, sunSinRadius: f32,
  sunIlluminance: vec3f, sunCosRadius: f32,     // lux at the top of the atmosphere
  moonDir: vec3f, moonSinRadius: f32,
  moonIlluminance: vec3f, moonCosRadius: f32,   // lux at the top of the atmosphere (phase included)
  airglow: vec3f, airglowHeightKm: f32,         // nits at the zenith, before extinction
  weather: vec4f,       // x cloud, y overcast sunToDome, z overcast sunOcclusion, w disk occlusion
  probeAlbedo: vec3f, aerialMaxDist: f32,       // meters
  sunDisk: vec4f,       // xyz limb darkening u, w max pre-exposed value
  moonDisk: vec4f,      // x full-disk radiance (nits), y earthshine, z highlands, w maria
  stars: vec4f,         // x mag-0 peak radiance (nits), y twinkle, z twinkle Hz, w magnitude limit
  stars2: vec4f,        // x cell fill probability, y cells per face edge, z color amount, w fade nits
  milkyWay: vec4f,      // x peak radiance (nits), y half width (rad), z sidereal turns per game hour, w latitude (rad)
  sizes: vec4f,         // xy sky-view LUT size, z aerial slices, w light mask (1 sun, 2 moon, 3 both)
};

// Written each frame by sh-project.wgsl, read by sky-aerial and sky-draw (64 bytes).
struct SkyState {
  dome: vec4f,             // rgb overcast dome zenith radiance (nits), a cloud
  skyIrradiance: vec4f,    // horizontal sky irradiance after cloud blending (lux)
  groundRadiance: vec4f,   // radiance of the probe's ground hemisphere (nits)
  sunGround: vec4f,        // sun illuminance at sea level, normal incidence (lux), before clouds
};

// Medium at a height (km).
struct AtmoMedium {
  scatterR: vec3f,
  scatterM: vec3f,
  scatterA: vec3f,
  extinction: vec3f,
};

fn sampleMedium(p: AtmosphereParams, height: f32) -> AtmoMedium {
  let h = max(height, 0.0);
  let dR = exp(-h * p.rayleighInvScale);
  let dM = exp(-h * p.mieInvScale);
  let dA = exp(-h * p.aerosolInvScale);
  let dO = max(0.0, 1.0 - abs(h - p.ozoneCenter) / p.ozoneHalfWidth);
  var m: AtmoMedium;
  m.scatterR = p.rayleighScattering * dR;
  m.scatterM = p.mieScattering * dM;
  m.scatterA = p.aerosolScattering * dA;
  m.extinction = m.scatterR + p.mieExtinction * dM + p.aerosolExtinction * dA + p.ozoneAbsorption * dO;
  return m;
}

fn rayleighPhase(c: f32) -> f32 {
  return 3.0 / (16.0 * PI) * (1.0 + c * c);
}

// Cornette-Shanks, as in Hillaire 2020.
fn miePhase(g: f32, c: f32) -> f32 {
  let g2 = g * g;
  let k = 3.0 / (8.0 * PI) * (1.0 - g2) / (2.0 + g2);
  return k * (1.0 + c * c) / pow(max(1.0 + g2 - 2.0 * g * c, 1e-5), 1.5);
}

// ---- Geometry, written in terms of the height h (km) for precision near the ground ----

fn atmoRho2(h: f32) -> f32 { return max(h * (2.0 * ATMO_BOTTOM + h), 0.0); }   // r^2 - bottom^2

// Height (km) after travelling t km along a ray that starts at height h0 with zenith cosine mu.
fn heightAlong(h0: f32, mu: f32, t: f32) -> f32 {
  let r0 = ATMO_BOTTOM + h0;
  let num = atmoRho2(h0) + t * (2.0 * r0 * mu + t);
  let r = sqrt(max(num + ATMO_BOTTOM * ATMO_BOTTOM, 0.0));
  return num / (r + ATMO_BOTTOM);
}

// Cosine of the zenith of direction L at the point t km along the ray (dir, cosZenith mu) from height h0.
fn zenithCosAlong(h0: f32, dirDotL: f32, lightY: f32, t: f32, h: f32) -> f32 {
  let r0 = ATMO_BOTTOM + h0;
  return clamp((t * dirDotL + r0 * lightY) / (ATMO_BOTTOM + h), -1.0, 1.0);
}

fn horizonMu(h: f32) -> f32 {
  return -sqrt(atmoRho2(h)) / (ATMO_BOTTOM + h);
}

fn rayHitsGround(h: f32, mu: f32) -> bool {
  let r = ATMO_BOTTOM + h;
  return mu < 0.0 && r * r * mu * mu - atmoRho2(h) >= 0.0;
}

// Distance to the ground along (h, mu); only valid when rayHitsGround.
fn distToGround(h: f32, mu: f32) -> f32 {
  let r = ATMO_BOTTOM + h;
  let disc = max(r * r * mu * mu - atmoRho2(h), 0.0);
  return atmoRho2(h) / max(-r * mu + sqrt(disc), 1e-6);
}

// Distance from inside to the sphere at height hT >= h along (h, mu).
fn distToAltitude(h: f32, mu: f32, hT: f32) -> f32 {
  let r = ATMO_BOTTOM + h;
  let gap = max(hT - h, 0.0) * (2.0 * ATMO_BOTTOM + hT + h);   // (bottom+hT)^2 - r^2
  let disc = r * r * mu * mu + gap;
  let s = sqrt(max(disc, 0.0));
  if (mu > 0.0) { return gap / max(r * mu + s, 1e-6); }
  return -r * mu + s;
}

fn distToTop(h: f32, mu: f32) -> f32 {
  return distToAltitude(h, mu, ATMO_DEPTH);
}

// ---- LUT parameterizations ----

fn atmoSubUv(x: f32, n: f32) -> f32 { return 0.5 / n + x * (1.0 - 1.0 / n); }
fn atmoUnitFromSubUv(u: f32, n: f32) -> f32 { return (u - 0.5 / n) / (1.0 - 1.0 / n); }

// Bruneton 2017 transmittance mapping, as used by Hillaire.
fn transmittanceUv(h: f32, mu: f32) -> vec2f {
  let r = ATMO_BOTTOM + h;
  let rho = sqrt(atmoRho2(h));
  let d = distToTop(h, mu);
  let dMin = ATMO_TOP - r;
  let dMax = rho + ATMO_H;
  let xMu = clamp((d - dMin) / max(dMax - dMin, 1e-6), 0.0, 1.0);
  let xR = clamp(rho / ATMO_H, 0.0, 1.0);
  return vec2f(atmoSubUv(xMu, TRANSMITTANCE_SIZE.x), atmoSubUv(xR, TRANSMITTANCE_SIZE.y));
}

// Returns (h km, mu) for a texel uv of the transmittance LUT.
fn transmittanceParams(uv: vec2f) -> vec2f {
  let xMu = atmoUnitFromSubUv(uv.x, TRANSMITTANCE_SIZE.x);
  let xR = atmoUnitFromSubUv(uv.y, TRANSMITTANCE_SIZE.y);
  let rho = ATMO_H * xR;
  let r = sqrt(rho * rho + ATMO_BOTTOM * ATMO_BOTTOM);
  let h = rho * rho / (r + ATMO_BOTTOM);
  let dMin = ATMO_TOP - r;
  let dMax = rho + ATMO_H;
  let d = dMin + xMu * (dMax - dMin);
  var mu = 1.0;
  if (d > 0.0) { mu = (ATMO_H * ATMO_H - rho * rho - d * d) / (2.0 * r * d); }
  return vec2f(h, clamp(mu, -1.0, 1.0));
}

// Transmittance from height h (km) toward a AtmoLight at zenith cosine mu, with a soft earth shadow
// across the AtmoLight's angular radius (sinRadius) at the horizon.
fn lightTransmittance(lut: texture_2d<f32>, smp: sampler, h: f32, mu: f32, sinRadius: f32) -> vec3f {
  let muH = horizonMu(h);
  let t = textureSampleLevel(lut, smp, transmittanceUv(h, max(mu, muH)), 0.0).rgb;
  let w = max(sinRadius, 1e-4);
  return t * smoothstep(-w, w, mu - muH);
}

fn multiScatterUv(h: f32, muLight: f32) -> vec2f {
  let u = clamp(muLight * 0.5 + 0.5, 0.0, 1.0);
  let v = sqrt(clamp(h / ATMO_DEPTH, 0.0, 1.0));
  return vec2f(atmoSubUv(u, MULTISCATTER_SIZE), atmoSubUv(v, MULTISCATTER_SIZE));
}

// Hillaire's non-linear latitude mapping (horizon at v = 0.5), world azimuth in u (repeat).
fn skyViewUv(dir: vec3f, h: f32, size: vec2f) -> vec2f {
  let r = ATMO_BOTTOM + h;
  let beta = acos(clamp(sqrt(atmoRho2(h)) / r, -1.0, 1.0));
  let zenithHorizon = PI - beta;
  let viewZenith = acos(clamp(dir.y, -1.0, 1.0));
  var v: f32;
  if (viewZenith < zenithHorizon) {
    let c = 1.0 - sqrt(max(1.0 - viewZenith / zenithHorizon, 0.0));
    v = c * 0.5;
  } else {
    let c = sqrt(clamp((viewZenith - zenithHorizon) / max(beta, 1e-6), 0.0, 1.0));
    v = c * 0.5 + 0.5;
  }
  let u = atan2(dir.z, dir.x) / (2.0 * PI) + 0.5;
  return vec2f(u, atmoSubUv(v, size.y));
}

fn skyViewDir(uv: vec2f, h: f32, size: vec2f) -> vec3f {
  let r = ATMO_BOTTOM + h;
  let beta = acos(clamp(sqrt(atmoRho2(h)) / r, -1.0, 1.0));
  let zenithHorizon = PI - beta;
  let v = clamp(atmoUnitFromSubUv(uv.y, size.y), 0.0, 1.0);
  var viewZenith: f32;
  if (v < 0.5) {
    var c = 1.0 - 2.0 * v;
    c = 1.0 - c * c;
    viewZenith = zenithHorizon * c;
  } else {
    let c = v * 2.0 - 1.0;
    viewZenith = zenithHorizon + beta * c * c;
  }
  let az = (uv.x - 0.5) * 2.0 * PI;
  let s = sin(viewZenith);
  return vec3f(cos(az) * s, cos(viewZenith), sin(az) * s);
}

// ---- Scattering along a ray ----

struct AtmoLight {
  dir: vec3f,
  illuminance: vec3f,   // lux, top of atmosphere
  sinRadius: f32,
};

struct AtmoScatter {
  L: vec3f,          // radiance (nits, or per unit illuminance when the AtmoLight is 1 lux)
  T: vec3f,          // throughput at the end of the segment
  F: vec3f,          // multi-AtmoScatter transfer (integral of throughput * scattering), for the MS LUT
};

// In-scattered AtmoLight from one point for one AtmoLight, given the AtmoMedium there.
fn lightAt(p: AtmosphereParams, m: AtmoMedium, tLut: texture_2d<f32>, msLut: texture_2d<f32>, smp: sampler,
           AtmoLight: AtmoLight, h: f32, muL: f32, cosTheta: f32, uniformPhase: bool, useMs: bool) -> vec3f {
  let tl = lightTransmittance(tLut, smp, h, muL, AtmoLight.sinRadius);
  var phased: vec3f;
  if (uniformPhase) {
    phased = (m.scatterR + m.scatterM + m.scatterA) * (1.0 / (4.0 * PI));
  } else {
    phased = m.scatterR * rayleighPhase(cosTheta) + m.scatterM * miePhase(p.mieG, cosTheta)
           + m.scatterA * miePhase(p.aerosolG, cosTheta);
  }
  var s = phased * tl;
  if (useMs) {
    let ms = textureSampleLevel(msLut, smp, multiScatterUv(h, muL), 0.0).rgb;
    s += (m.scatterR + m.scatterM + m.scatterA) * ms;
  }
  return s * AtmoLight.illuminance;
}

// Integrates [t0, t1] km along dir from height h0 with `steps` samples spaced quadratically from t0.
// Up to two lights (count 1 or 2). acc carries radiance and throughput in and out.
fn integrateSegment(p: AtmosphereParams, tLut: texture_2d<f32>, msLut: texture_2d<f32>, smp: sampler,
                    h0: f32, dir: vec3f, t0: f32, t1: f32, steps: i32,
                    l0: AtmoLight, l1: AtmoLight, lightCount: i32, uniformPhase: bool, useMs: bool,
                    accIn: AtmoScatter) -> AtmoScatter {
  var acc = accIn;
  let len = t1 - t0;
  if (len <= 0.0) { return acc; }
  let n = f32(steps);
  let c0 = dot(dir, l0.dir);
  let c1 = dot(dir, l1.dir);
  for (var i = 0; i < steps; i++) {
    let a = f32(i) / n;
    let b = f32(i + 1) / n;
    let tm = t0 + len * ((a + b) * 0.5) * ((a + b) * 0.5);
    let dt = len * (b * b - a * a);
    let h = heightAlong(h0, dir.y, tm);
    let m = sampleMedium(p, h);
    var s = lightAt(p, m, tLut, msLut, smp, l0, h, zenithCosAlong(h0, c0, l0.dir.y, tm, h), c0, uniformPhase, useMs);
    if (lightCount > 1) {
      s += lightAt(p, m, tLut, msLut, smp, l1, h, zenithCosAlong(h0, c1, l1.dir.y, tm, h), c1, uniformPhase, useMs);
    }
    let ext = max(m.extinction, vec3f(1e-7));
    let stepT = exp(-ext * dt);
    let sint = (s - s * stepT) / ext;
    let scat = m.scatterR + m.scatterM + m.scatterA;
    acc.L += acc.T * sint;
    acc.F += acc.T * (scat - scat * stepT) / ext;
    acc.T *= stepT;
  }
  return acc;
}

// The lights that matter this frame (sky.sizes.w bit 0 sun, bit 1 moon; the CPU drops a light whose
// contribution is negligible next to the other, e.g. the moon by day). scale dims both (cloud cover).
struct AtmoLights {
  l0: AtmoLight,
  l1: AtmoLight,
  count: i32,
};

fn skyLights(s: SkyUniforms, scale: f32) -> AtmoLights {
  var sun: AtmoLight;
  sun.dir = s.sunDir;
  sun.illuminance = s.sunIlluminance * scale;
  sun.sinRadius = s.sunSinRadius;
  var moon: AtmoLight;
  moon.dir = s.moonDir;
  moon.illuminance = s.moonIlluminance * scale;
  moon.sinRadius = s.moonSinRadius;
  let mask = u32(s.sizes.w);
  var out: AtmoLights;
  out.l0 = sun;
  out.l1 = moon;
  out.count = 2;
  if (mask == 1u) { out.count = 1; }
  if (mask == 2u) { out.l0 = moon; out.count = 1; }
  return out;
}

// Length of the near-ground segment that resolves the thin aerosol layer.
fn localSegmentKm(p: AtmosphereParams, h0: f32, mu: f32, tEnd: f32) -> f32 {
  let depth = 12.0 / max(p.aerosolInvScale, 1e-3);
  return min(tEnd, distToAltitude(h0, mu, max(h0, 0.0) + depth));
}

// AtmoLight reflected by the ground at the end of a ray (Lambert, planet albedo).
fn groundBounce(p: AtmosphereParams, tLut: texture_2d<f32>, smp: sampler, h0: f32, dir: vec3f, tG: f32,
                l0: AtmoLight, l1: AtmoLight, lightCount: i32) -> vec3f {
  let r0 = ATMO_BOTTOM + h0;
  let up = (vec3f(0.0, r0, 0.0) + dir * tG) / ATMO_BOTTOM;
  let mu0 = clamp(dot(up, l0.dir), -1.0, 1.0);
  var e = lightTransmittance(tLut, smp, 0.0, mu0, l0.sinRadius) * max(mu0, 0.0) * l0.illuminance;
  if (lightCount > 1) {
    let mu1 = clamp(dot(up, l1.dir), -1.0, 1.0);
    e += lightTransmittance(tLut, smp, 0.0, mu1, l1.sinRadius) * max(mu1, 0.0) * l1.illuminance;
  }
  return e * p.groundAlbedo / PI;
}

fn atmoLuminance(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

// CIE standard overcast sky, horizontal illuminance e: L(theta) = Lz (1 + 2 cos theta) / 3, Lz = 9 e / (7 pi).
fn overcastZenith(e: f32) -> f32 {
  return 9.0 * e / (7.0 * PI);
}

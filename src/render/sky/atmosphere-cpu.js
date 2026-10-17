// @ts-check
// CPU twin of the atmosphere model in src/shaders/lib-atmosphere.wgsl and sky-transmittance.wgsl (docs/06).
// Pure functions, no GPU: the app uses transmittanceToLight to turn top-of-atmosphere sun and moon
// illuminance into ground illuminance for FrameUniforms, matching the GPU transmittance LUT.
// Units: planet geometry in km, coefficients per km, the ground aerosol scale height in meters (recipe).

export const BOTTOM_KM = 6360;
export const TOP_KM = 6460;
const DEPTH_KM = TOP_KM - BOTTOM_KM;
const LOCAL_STEPS = 24;   // must match sky-transmittance.wgsl
const MAIN_STEPS = 40;
/** sin(0.265 deg): half the sun's angular diameter, the default soft earth-shadow width. */
export const SUN_SIN_RADIUS = 0.004625;

/**
 * @typedef {Object} AtmosphereCoefficients   all per km, heights in km
 * @property {number[]} rayleighScattering @property {number} rayleighScaleKm
 * @property {number[]} mieScattering @property {number[]} mieExtinction @property {number} mieScaleKm @property {number} mieG
 * @property {number[]} ozoneAbsorption @property {number} ozoneCenterKm @property {number} ozoneHalfWidthKm
 * @property {number[]} aerosolScattering @property {number[]} aerosolExtinction @property {number} aerosolScaleKm @property {number} aerosolG
 * @property {number[]} groundAlbedo
 */

const smoothstep = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Ground aerosol multiplier for the current weather and sun (docs/06 weather table): mist x3 at full
 * mist, rain x2, and a dawn boost that builds through the night and burns off as the morning sun climbs
 * (+X is east). The GPU side uses the same value through createAtmosphere.
 * @param {any} skyRecipe   parsed recipes/world/sky.json
 * @param {{ mist?: number, rain?: number }} weather   0..1 each
 * @param {ArrayLike<number>} sunDir   unit vector toward the sun
 */
export function aerosolScaleFor(skyRecipe, weather, sunDir) {
  const g = skyRecipe.groundAerosol;
  const mist = Math.min(1, Math.max(0, weather.mist ?? 0));
  const rain = Math.min(1, Math.max(0, weather.rain ?? 0));
  const morning = smoothstep(-0.2, 0.3, sunDir[0]);
  const low = 1 - smoothstep(-0.05, 0.5, sunDir[1]);
  const dawn = 1 + (g.dawnBoost - 1) * morning * low;
  return g.density * dawn * (1 + (g.mistBoost - 1) * mist) * (1 + (g.rainBoost - 1) * rain);
}

/**
 * Flatten the recipe into the coefficients both CPU and GPU integrate.
 * @param {any} skyRecipe
 * @param {number} [aerosolScale]   from aerosolScaleFor (1 = recipe density only)
 * @returns {AtmosphereCoefficients}
 */
export function atmosphereCoefficients(skyRecipe, aerosolScale = 1) {
  const a = skyRecipe.atmosphere;
  const g = skyRecipe.groundAerosol;
  const add = (/** @type {number[]} */ x, /** @type {number[]} */ y) => x.map((v, i) => v + y[i]);
  const mul = (/** @type {number[]} */ x, /** @type {number} */ k) => x.map((v) => v * k);
  return {
    rayleighScattering: a.rayleigh.scatteringPerKm, rayleighScaleKm: a.rayleigh.scaleHeightKm,
    mieScattering: a.mie.scatteringPerKm, mieExtinction: add(a.mie.scatteringPerKm, a.mie.absorptionPerKm),
    mieScaleKm: a.mie.scaleHeightKm, mieG: a.mie.g,
    ozoneAbsorption: a.ozone.absorptionPerKm, ozoneCenterKm: a.ozone.centerKm, ozoneHalfWidthKm: a.ozone.halfWidthKm,
    aerosolScattering: mul(g.scatteringPerKm, aerosolScale),
    aerosolExtinction: mul(add(g.scatteringPerKm, g.absorptionPerKm), aerosolScale),
    aerosolScaleKm: g.scaleHeight / 1000, aerosolG: g.g,
    groundAlbedo: a.groundAlbedo,
  };
}

/** @param {number} h km */
const rho2 = (h) => Math.max(h * (2 * BOTTOM_KM + h), 0);

/** @param {number} h0 @param {number} mu @param {number} t */
function heightAlong(h0, mu, t) {
  const r0 = BOTTOM_KM + h0;
  const num = rho2(h0) + t * (2 * r0 * mu + t);
  const r = Math.sqrt(Math.max(num + BOTTOM_KM * BOTTOM_KM, 0));
  return num / (r + BOTTOM_KM);
}

/** @param {number} h @param {number} mu @param {number} hT */
function distToAltitude(h, mu, hT) {
  const r = BOTTOM_KM + h;
  const gap = Math.max(hT - h, 0) * (2 * BOTTOM_KM + hT + h);
  const s = Math.sqrt(Math.max(r * r * mu * mu + gap, 0));
  return mu > 0 ? gap / Math.max(r * mu + s, 1e-6) : -r * mu + s;
}

/** @param {number} h */
const horizonMu = (h) => -Math.sqrt(rho2(h)) / (BOTTOM_KM + h);

/**
 * @param {AtmosphereCoefficients} c @param {number} h km
 * @param {number[]} out  rgb extinction per km
 */
function extinctionAt(c, h, out) {
  h = Math.max(h, 0);
  const dR = Math.exp(-h / c.rayleighScaleKm);
  const dM = Math.exp(-h / c.mieScaleKm);
  const dA = Math.exp(-h / c.aerosolScaleKm);
  const dO = Math.max(0, 1 - Math.abs(h - c.ozoneCenterKm) / c.ozoneHalfWidthKm);
  for (let i = 0; i < 3; i++) {
    out[i] = c.rayleighScattering[i] * dR + c.mieExtinction[i] * dM + c.aerosolExtinction[i] * dA + c.ozoneAbsorption[i] * dO;
  }
}

/**
 * @param {AtmosphereCoefficients} c @param {number} h0 @param {number} mu
 * @param {number} t0 @param {number} t1 @param {number} steps @param {number[]} od accumulates
 */
function opticalDepthSegment(c, h0, mu, t0, t1, steps, od) {
  const len = t1 - t0;
  if (len <= 0) return;
  const e = [0, 0, 0];
  for (let i = 0; i < steps; i++) {
    const a = i / steps;
    const b = (i + 1) / steps;
    const m = (a + b) * 0.5;
    extinctionAt(c, heightAlong(h0, mu, t0 + len * m * m), e);
    const dt = len * (b * b - a * a);
    od[0] += e[0] * dt; od[1] += e[1] * dt; od[2] += e[2] * dt;
  }
}

/**
 * Transmittance through the atmosphere toward a light, by the same numerical integration as the GPU
 * transmittance LUT. Below the horizon it returns 0, with a smooth earth-shadow falloff across the
 * light's angular radius around the horizon.
 * @param {any} skyRecipe   parsed recipes/world/sky.json (uses .atmosphere and .groundAerosol)
 * @param {number} cosZenith   cosine of the light's zenith angle (= light direction y)
 * @param {{ heightM?: number, aerosolScale?: number, sinRadius?: number, coefficients?: AtmosphereCoefficients }} [opts]
 *   heightM: observer height above sea level in meters (default 0).
 *   aerosolScale: ground aerosol multiplier, pass atmosphere.aerosolScale (or aerosolScaleFor) so the
 *     ground light matches the GPU LUT (default 1).
 *   sinRadius: sine of the light's angular radius for the earth-shadow edge (default the sun's).
 *   coefficients: precomputed atmosphereCoefficients, to skip rebuilding them every call.
 * @returns {[number, number, number]} unitless rgb transmittance
 */
export function transmittanceToLight(skyRecipe, cosZenith, opts = {}) {
  const c = opts.coefficients ?? atmosphereCoefficients(skyRecipe, opts.aerosolScale ?? 1);
  const h = Math.max(opts.heightM ?? 0, 0) / 1000;
  const sinRadius = Math.max(opts.sinRadius ?? SUN_SIN_RADIUS, 1e-4);
  const muH = horizonMu(h);
  const vis = smoothstep(-sinRadius, sinRadius, cosZenith - muH);
  if (vis <= 0) return [0, 0, 0];
  const mu = Math.min(1, Math.max(cosZenith, muH));
  const tTop = distToAltitude(h, mu, DEPTH_KM);
  const depth = 12 * c.aerosolScaleKm;
  const tLocal = Math.min(tTop, distToAltitude(h, mu, h + depth));
  const od = [0, 0, 0];
  opticalDepthSegment(c, h, mu, 0, tLocal, LOCAL_STEPS, od);
  opticalDepthSegment(c, h, mu, tLocal, tTop, MAIN_STEPS, od);
  return [Math.exp(-od[0]) * vis, Math.exp(-od[1]) * vis, Math.exp(-od[2]) * vis];
}

/**
 * Convenience: illuminance on a surface facing the light (lux rgb) = TOA illuminance x transmittance.
 * @param {any} skyRecipe @param {ArrayLike<number>} lightDir unit vector toward the light
 * @param {ArrayLike<number>} illuminanceTOA lux rgb @param {Parameters<typeof transmittanceToLight>[2]} [opts]
 * @returns {[number, number, number]}
 */
export function groundIlluminance(skyRecipe, lightDir, illuminanceTOA, opts) {
  const t = transmittanceToLight(skyRecipe, lightDir[1], opts);
  return [illuminanceTOA[0] * t[0], illuminanceTOA[1] * t[1], illuminanceTOA[2] * t[2]];
}

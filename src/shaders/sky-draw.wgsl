// Sky pass (docs/06): every pixel left at the far plane (reverse-Z, depth 0) gets the sky-view LUT,
// the overcast blend, the sun disk, the moon impostor, and the starfield with a faint Milky Way.
// Output is pre-exposed radiance.

// #include common
// #include lighting-bindings
// #include lib-atmosphere
// #include lib-hash

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var skyViewLut: texture_2d<f32>;
@group(2) @binding(1) var skySampler: sampler;
@group(2) @binding(2) var<uniform> sky: SkyUniforms;
@group(2) @binding(3) var<storage, read> state: SkyState;

// Night exposure floor (docs/05): EV100 -1. Art-directed terms are set relative to the radiance that
// lands on mid-gray (0.18) at that floor: 0.18 * 1.2 * 2^-1 = 0.108 nits. Stars and the Milky Way are
// the only art-directed sky terms; their recipe brightness is in EV above this floor.
const NIGHT_FLOOR_MID_NITS: f32 = 0.108;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> FullscreenOut {
  return fullscreenTriangle(vi);
}

fn sunDisk(dir: vec3f, px: f32) -> vec3f {
  let c = dot(dir, sky.sunDir);
  let sinA = sqrt(max(1.0 - c * c, 0.0));
  let rho = sinA / sky.sunSinRadius;
  if (rho > 1.0 + px / sky.sunSinRadius || c < 0.0) { return vec3f(0.0); }
  let edge = 1.0 - smoothstep(1.0 - px / sky.sunSinRadius, 1.0, rho);
  let mu = sqrt(max(1.0 - min(rho, 1.0) * min(rho, 1.0), 0.0));
  let u = sky.sunDisk.xyz;
  // Linear limb darkening I(mu) = I0 (1 - u (1 - mu)), normalized so the disk integrates to the illuminance.
  let omega = PI * sky.sunSinRadius * sky.sunSinRadius;
  let i0 = sky.sunIlluminance / (omega * (vec3f(1.0) - u / 3.0));
  return i0 * (vec3f(1.0) - u * (1.0 - mu)) * edge;
}

// Moon impostor: a sphere lit by the true sun direction (Lommel-Seeliger), so the crescent points at the sun.
// Returns radiance in rgb and disk coverage in a (occludes stars and the sun behind it).
fn moonDisk(dir: vec3f, px: f32) -> vec4f {
  let m = sky.moonDir;
  let c = dot(dir, m);
  if (c < 0.0) { return vec4f(0.0); }
  let q = (dir - m * c) / sky.moonSinRadius;
  let rho = length(q);
  let soft = px / sky.moonSinRadius;
  if (rho > 1.0 + soft) { return vec4f(0.0); }
  let cover = 1.0 - smoothstep(1.0 - soft, 1.0, rho);
  let rc = min(rho, 0.999);
  let mu = sqrt(1.0 - rc * rc);
  let n = q * (rc / max(rho, 1e-6)) - m * mu;      // sphere normal facing the viewer
  let mu0 = dot(n, sky.sunDir);
  // Face texture in a frame tied to the moon direction and world up (the same face always shows).
  var right = cross(vec3f(0.0, 1.0, 0.0), m);
  right = select(normalize(right), vec3f(1.0, 0.0, 0.0), dot(right, right) < 1e-6);
  let up = cross(m, right);
  let p = vec2f(dot(n, right), dot(n, up));
  let maria = smoothstep(0.42, 0.58, valueNoise2(p * 2.3 + vec2f(3.1, 1.7), 71u) * 0.75
                                     + valueNoise2(p * 6.0, 72u) * 0.25);
  let craters = 0.92 + 0.16 * valueNoise2(p * 17.0, 73u);
  let albedo = mix(sky.moonDisk.z, sky.moonDisk.w, maria) * craters;
  let lit = select(0.0, 2.0 * mu0 / (mu0 + mu), mu0 > 0.0);
  // Earthshine: the dark limb lit by a near-full Earth around new moon.
  let earthPhase = 0.5 * (1.0 + dot(sky.sunDir, m));
  let radiance = sky.moonDisk.x * albedo * (lit + sky.moonDisk.y * earthPhase);
  return vec4f(vec3f(radiance) * cover, cover);
}

// World direction to the star-fixed frame: celestial pole at the latitude toward -Z (north).
fn toStarFrame(d: vec3f) -> vec3f {
  let sl = sin(sky.milkyWay.w);
  let cl = cos(sky.milkyWay.w);
  let pole = vec3f(0.0, sl, -cl);
  let meridian = vec3f(0.0, cl, sl);   // celestial equator on the meridian, toward the south
  let west = vec3f(-1.0, 0.0, 0.0);
  let lst = 2.0 * PI * (fract(frame.displayHours * sky.milkyWay.z) - 0.5);
  let m = dot(d, meridian);
  let w = dot(d, west);
  let c = cos(lst);
  let s = sin(lst);
  return vec3f(c * m + s * w, s * m - c * w, dot(d, pole));
}

fn starTint(t: f32) -> vec3f {
  let warm = vec3f(1.0, 0.72, 0.5);
  let cool = vec3f(0.72, 0.84, 1.0);
  var c = select(mix(vec3f(1.0), cool, (t - 0.5) * 2.0), mix(warm, vec3f(1.0), t * 2.0), t < 0.5);
  c = mix(vec3f(1.0), c, sky.stars2.z);
  return c / atmoLuminance(c);
}

fn stars(s: vec3f, px: f32) -> vec3f {
  let a = abs(s);
  var face = 0u;
  var uvF = vec2f(0.0);
  if (a.x >= a.y && a.x >= a.z) { face = select(1u, 0u, s.x > 0.0); uvF = s.yz / a.x; }
  else if (a.y >= a.z) { face = select(3u, 2u, s.y > 0.0); uvF = s.xz / a.y; }
  else { face = select(5u, 4u, s.z > 0.0); uvF = s.xy / a.z; }
  // Tangent warp evens out cell solid angle across the face.
  let wv = atan(uvF) * (4.0 / PI);
  let cells = sky.stars2.y;
  let g = (wv * 0.5 + 0.5) * cells;
  let cell = vec2u(clamp(floor(g), vec2f(0.0), vec2f(cells - 1.0)));
  let h0 = hash3(vec3u(cell, face * 7919u + 17u));
  if (hashToFloat(h0) > sky.stars2.x) { return vec3f(0.0); }
  let h1 = pcg(h0);
  let h2 = pcg(h1);
  let h3 = pcg(h2);
  let off = vec2f(hashToFloat(h1), hashToFloat(h2)) * 0.7 + 0.15;
  let sw = ((vec2f(cell) + off) / cells) * 2.0 - 1.0;
  let su = tan(sw * (PI / 4.0));
  var sd: vec3f;
  let sgn = select(-1.0, 1.0, face % 2u == 0u);
  if (face < 2u) { sd = vec3f(sgn, su.x, su.y); }
  else if (face < 4u) { sd = vec3f(su.x, sgn, su.y); }
  else { sd = vec3f(su.x, su.y, sgn); }
  sd = normalize(sd);
  let ang = length(cross(s, sd));
  let sigma = px * 0.75;
  let shape = exp(-0.5 * (ang * ang) / (sigma * sigma));
  if (shape < 1e-3) { return vec3f(0.0); }
  // Magnitude distribution N(<m) ~ 10^(0.46 m), up to the magnitude limit.
  let mag = max(sky.stars.w + starLog10(max(hashToFloat(h3), 1e-6)) / 0.46, -1.5);
  let tw = valueNoise2(vec2f(frame.animTime * sky.stars.z, f32(h1 & 1023u)), 9u) * 2.0 - 1.0;
  let twinkle = max(1.0 + sky.stars.y * tw, 0.0);
  let peak = sky.stars.x * pow(10.0, -0.4 * mag) * twinkle;
  return starTint(hashToFloat(pcg(h3))) * (peak * shape);
}

fn starLog10(x: f32) -> f32 { return log2(x) * 0.30103; }

fn milkyWay(s: vec3f) -> f32 {
  let northGal = vec3f(-0.8677, -0.1981, 0.4560);
  let center = vec3f(-0.0549, -0.8734, -0.4839);
  let b = asin(clamp(dot(s, northGal), -1.0, 1.0));
  let width = sky.milkyWay.y;
  let lon = normalize(s - northGal * dot(s, northGal));
  let toCenter = acos(clamp(dot(lon, center), -1.0, 1.0));
  let core = 0.35 + 0.65 * exp(-toCenter * toCenter / (2.0 * 1.1 * 1.1));
  let wobble = b + (valueNoise2(lon.xz * 3.0 + lon.y, 31u) - 0.5) * width * 0.6;
  let band = exp(-(wobble * wobble) / (width * width));
  let clumps = 0.55 + 0.9 * valueNoise2(vec2f(atan2(lon.z, lon.x) * 6.0, b * 9.0), 32u);
  let dust = 1.0 - 0.6 * exp(-(b * b) / (0.06 * width * width * 4.0)) * valueNoise2(vec2f(atan2(lon.z, lon.x) * 4.0, 0.5), 33u);
  return sky.milkyWay.x * band * core * clumps * dust;
}

@fragment
fn fs(in: FullscreenOut) -> @location(0) vec4f {
  let ndc = vec2f(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0);
  let far = frame.invViewProj * vec4f(ndc, 1e-7, 1.0);
  let dir = normalize(far.xyz / far.w - frame.cameraPos);
  let h = sky.cameraHeightKm;
  let cloud = sky.weather.x;
  // Angular size of one pixel, from the projection's vertical focal length.
  let px = 2.0 / (frame.proj[1][1] * frame.renderSize.y);

  var L = textureSampleLevel(skyViewLut, skySampler, skyViewUv(dir, h, sky.sizes.xy), 0.0).rgb * SKY_LUT_INV_SCALE;
  let lz = state.dome.rgb;
  let domeL = lz * (1.0 + 2.0 * max(dir.y, 0.0)) / 3.0;
  L = mix(L, domeL, cloud);

  let t = lightTransmittance(transmittanceLut, lutSampler, h, dir.y, 0.0);
  let clearView = 1.0 - sky.weather.w * cloud;
  let moon = moonDisk(dir, px);
  let skyLum = atmoLuminance(L);
  let fade = sky.stars2.w / (sky.stars2.w + skyLum);

  var bodies = sunDisk(dir, px) * (1.0 - moon.a) + moon.rgb;
  let sf = toStarFrame(dir);
  // Stars are set relative to the old EV100 -1 floor; below it the eye adapts further (the night
  // key, docs/05), so scale them back to keep their brightness on screen.
  let starKey = exp2(min(frame.ev100 + 1.0, 0.0));
  let night = (stars(sf, px) + vec3f(milkyWay(sf))) * fade * (1.0 - moon.a) * starKey;
  bodies += night;
  L += bodies * t * clearView;

  let pre = min(L * frame.exposure, vec3f(sky.sunDisk.w));
  return vec4f(pre, 1.0);
}

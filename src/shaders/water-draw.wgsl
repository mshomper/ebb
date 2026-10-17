// Water drawing (docs/07, Shading), after the opaque pass and before the sky. Physically based:
//   reflection   the clear-sky view LUT (with the overcast dome) in the reflected direction,
//                plus GGX sun and moon glints; Schlick Fresnel with F0 0.02 (n = 1.333)
//   refraction   the opaque scene copy, offset by the surface normal and rejected where the
//                offset sample lies in front of the water
//   absorption   Beer-Lambert along the view ray under water plus the light's way down to the
//                bed; single scattering lights the water body itself (teal, then blue with depth)
//   surface      the simulated surface slope, gentle sea swell faded out in the shallows, and three
//                scrolling ripple layers flow-mapped by the simulated velocity (Vlachos 2010)
// Two meshes share the fragment shader: the simulated grid over the opened chunks and the open sea
// plane around it. Output is pre-exposed radiance; the palette applies at the tonemap (docs/05).

// #include common
// #include lib-hash
// #include lighting-bindings
// #include lib-sky
// #include lib-terrain
// #include lib-lighting
// #include lib-water

struct WaterDraw {
  rectOrigin: vec2u,          // simulated rect (water cells); the mesh covers its interior
  rectSize: vec2u,
  tide: f32,
  time: f32,                  // real seconds
  refraction: f32,            // screen offset per unit normal tilt
  edgeFade: f32,              // m of water over which the shoreline fades in
  absorbSea: vec4f,           // rgb sigma_a per meter, w f0
  absorbPond: vec4f,          // rgb sigma_a per meter, w base roughness
  scatter: vec4f,             // rgb single-scatter albedo, w swell fade depth (m)
  waveA: array<vec4f, 3>,     // ripple layers: xy direction, z 1 / wavelength, w slope strength
  waveB: vec4f,               // ripple layer speeds (m/s) in xyz, w flow-map scale
  sea: array<vec4f, 4>,       // swell: xy direction, z wavenumber 2 pi / wavelength, w amplitude (m)
  seaExtent: f32,
  dry: f32,
  floorY: f32,                // the island's sea floor height at the edge of the opened area (m)
  floorSlope: f32,            // how fast the open sea floor deepens beyond it (m per m)
  seabed: vec4f,              // rgb wet sand albedo for the sea floor beyond the terrain, w wet darkening
  filmDepth: vec4f,            // xy depth range (m) over which a broken film becomes a coherent surface
  debugView: f32,             // ?waterdbg=1 sea or grid, 2 reflection, 3 transmitted, 4 Fresnel/path/depth
  _q0: f32, _q1: f32, _q2: f32,
  riffle: vec4f,              // white water: x, y speed range (m/s) it fades in over, z depth (m) it is gone by, w coverage
  riffle2: vec4f,             // x streak size (m), y white-water albedo
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var<uniform> wd: WaterDraw;
@group(2) @binding(1) var heightTex: texture_2d<f32>;
@group(2) @binding(2) var depthTex: texture_2d<f32>;
@group(2) @binding(3) var velTex: texture_2d<f32>;
@group(2) @binding(4) var sceneColor: texture_2d<f32>;
@group(2) @binding(5) var sceneDepth: texture_depth_2d;
@group(2) @binding(6) var clampSampler: sampler;
@group(2) @binding(7) var skyViewLut: texture_2d<f32>;
@group(2) @binding(8) var skySampler: sampler;
@group(2) @binding(9) var<uniform> sky: SkyUniforms;
@group(2) @binding(10) var<storage, read> skyState: SkyState;

const G: f32 = 9.81;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) depth: f32,        // water depth (m); large on the open sea
  @location(2) vel: vec2f,
  @location(3) slope: vec2f,      // d(surface)/dx, d(surface)/dz from the simulation
  @location(4) bed: f32,
  @location(5) cover: f32,        // 1 at wet vertices, 0 at the dry bank: fades the last cell out
};

struct FsOut {
  @location(0) color: vec4f,
  @location(1) normalId: vec4f,
};

fn octEncode(n: vec3f) -> vec2f {
  var p = n.xz / (abs(n.x) + abs(n.y) + abs(n.z));
  if (n.y < 0.0) { p = (1.0 - abs(p.yx)) * select(vec2f(-1.0), vec2f(1.0), p >= vec2f(0.0)); }
  return p * 0.5 + 0.5;
}

fn simDepth(c: vec2i) -> f32 {
  return textureLoad(depthTex, clamp(c, vec2i(0), vec2i(WATER_CELLS - 1)), 0).r;
}

// Surface height a vertex should take at cell c: the water surface where wet; next to water, the
// neighbors' mean surface, so the water plane runs on into the bank and the depth test cuts a
// clean, curved shoreline; elsewhere just under the ground.
fn vertexSurface(c: vec2i) -> vec2f {   // x height, y depth
  let d = simDepth(c);
  let bed = waterBed(heightTex, c);
  if (d > wd.dry) {
    // The bed is the lowest of the cell's ground; on a slope the rest of the cell stands higher
    // than a thin stream's surface. Thin water is drawn on the actual ground (lifted a few mm so
    // the terrain never covers it); deep water keeps its flat level.
    let ground = terrainHeight(heightTex, waterCellCenter(c));
    let thin = 1.0 - smoothstep(0.03, 0.15, d);
    return vec2f(bed + d + (max(ground - bed, 0.0) + 0.006) * thin, d);
  }
  var sum = 0.0;
  var n = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let q = c + vec2i(i, j);
      let dq = simDepth(q);
      if (dq > wd.dry) { sum += waterBed(heightTex, q) + dq; n += 1.0; }
    }
  }
  // Never above the ground here: downhill of a pool the plane would otherwise hover over the grass.
  if (n > 0.0) { return vec2f(min(sum / n, terrainHeight(heightTex, waterCellCenter(c))), 0.0); }
  return vec2f(bed - 0.05, 0.0);
}

@vertex
fn vsSim(@builtin(vertex_index) vi: u32) -> VsOut {
  // Quads between the centers of the rect's interior cells, six vertices each.
  let quadsX = wd.rectSize.x - 3u;
  let quad = vi / 6u;
  let corner = array<vec2u, 6>(vec2u(0u, 0u), vec2u(1u, 0u), vec2u(0u, 1u), vec2u(1u, 0u), vec2u(1u, 1u), vec2u(0u, 1u))[vi % 6u];
  let c = vec2i(wd.rectOrigin + 1u + vec2u(quad % quadsX, quad / quadsX) + corner);
  let s = vertexSurface(c);
  let sx0 = vertexSurface(c - vec2i(1, 0)).x;
  let sx1 = vertexSurface(c + vec2i(1, 0)).x;
  let sz0 = vertexSurface(c - vec2i(0, 1)).x;
  let sz1 = vertexSurface(c + vec2i(0, 1)).x;
  // Slopes over wet neighbors only, so the bank never tilts the surface.
  let slope = vec2f(sx1 - sx0, sz1 - sz0) / (2.0 * WATER_CELL);
  let xz = waterCellCenter(c);
  var out: VsOut;
  out.world = vec3f(xz.x, s.x, xz.y);
  out.pos = frame.viewProj * vec4f(out.world, 1.0);
  out.depth = s.y;
  out.vel = textureLoad(velTex, c, 0).rg;
  out.slope = select(vec2f(0.0), clamp(slope, vec2f(-0.5), vec2f(0.5)), s.y > wd.dry);
  out.bed = waterBed(heightTex, c);
  out.cover = select(0.0, 1.0, s.y > wd.dry);
  return out;
}

// Open sea: rings around the camera, geometric in radius (dense nearby, sparse far out), so no
// triangle is so large that clipping it loses precision. SEA_RINGS x SEA_SEGMENTS quads.
const SEA_RINGS: u32 = 28u;
const SEA_SEGMENTS: u32 = 48u;

fn seaRingRadius(i: u32) -> f32 {
  if (i == 0u) { return 0.0; }
  // 2 m for the first ring, growing to seaExtent / 2 at the last.
  return 2.0 * pow(wd.seaExtent * 0.25, f32(i - 1u) / f32(SEA_RINGS - 1u));
}

@vertex
fn vsSea(@builtin(vertex_index) vi: u32) -> VsOut {
  let quad = vi / 6u;
  let corner = array<vec2u, 6>(vec2u(0u, 0u), vec2u(1u, 0u), vec2u(0u, 1u), vec2u(1u, 0u), vec2u(1u, 1u), vec2u(0u, 1u))[vi % 6u];
  let seg = quad % SEA_SEGMENTS + corner.x;
  let ring = quad / SEA_SEGMENTS + corner.y;
  let a = f32(seg) * (2.0 * PI / f32(SEA_SEGMENTS));
  let xz = frame.cameraPos.xz + vec2f(cos(a), sin(a)) * seaRingRadius(ring);
  var out: VsOut;
  out.world = vec3f(xz.x, wd.tide, xz.y);
  out.pos = frame.viewProj * vec4f(out.world, 1.0);
  out.depth = 50.0;
  out.vel = vec2f(0.0);
  out.slope = vec2f(0.0);
  out.bed = -50.0;
  out.cover = 1.0;
  return out;
}

// Value noise with its analytic gradient (quintic fade), for the ripple layers.
fn noiseGrad(p: vec2f, seed: u32) -> vec3f {
  let i = floor(p);
  let f = p - i;
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  let c = vec2u(vec2i(i) + vec2i(1 << 20));
  let a = hashToFloat(hash3(vec3u(c, seed)));
  let b = hashToFloat(hash3(vec3u(c + vec2u(1u, 0u), seed)));
  let d = hashToFloat(hash3(vec3u(c + vec2u(0u, 1u), seed)));
  let e = hashToFloat(hash3(vec3u(c + vec2u(1u, 1u), seed)));
  let v = a + (b - a) * u.x + (d - a) * u.y + (a - b - d + e) * u.x * u.y;
  let g = du * vec2f(b - a + (a - b - d + e) * u.y, d - a + (a - b - d + e) * u.x);
  return vec3f(v, g);
}

// Ripple slope (dh/dx, dh/dz) at xz for one time offset of the flow map.
fn ripples(xz: vec2f, t: f32) -> vec2f {
  var g = vec2f(0.0);
  for (var i = 0; i < 3; i++) {
    let w = wd.waveA[i];
    let dir = w.xy;
    let side = vec2f(-dir.y, dir.x);
    // Coordinates along and across the layer's direction, scrolled along it, stretched a little
    // along the wind so the pattern reads as wavelets rather than blobs.
    let q = vec2f(dot(xz, dir), dot(xz, side)) * w.z;
    let p = vec2f(q.x * 0.7 - wd.waveB[i] * t * w.z, q.y * 1.3);
    let n = noiseGrad(p, 401u + u32(i));
    let gq = vec2f(n.y * 0.7, n.z * 1.3);
    g += (dir * gq.x + side * gq.y) * w.w;
  }
  return g;
}

// White-water flecks: soft noise blobs (the caller advects them with the current), thresholded
// to the white-water coverage with a soft edge.
fn flecks(xz: vec2f) -> f32 {
  let q = xz / wd.riffle2.x;
  let n = noiseGrad(q, 911u).x * 0.6 + noiseGrad(q * 2.7 + vec2f(5.1, 2.7), 912u).x * 0.4;
  let c = wd.riffle.w;
  return smoothstep(1.0 - c, 1.0 - c + 0.3, n);
}

// Gentle open-water swell: a sum of sine waves with deep-water dispersion, slope only.
fn swell(xz: vec2f, t: f32) -> vec2f {
  var g = vec2f(0.0);
  for (var i = 0; i < 4; i++) {
    let s = wd.sea[i];
    let k = s.z;
    let omega = sqrt(G * k);
    let ph = k * dot(s.xy, xz) - omega * t;
    g += s.xy * (s.w * k * cos(ph));
  }
  return g;
}

fn skyRadiance(dir: vec3f) -> vec3f {
  let d = normalize(vec3f(dir.x, max(dir.y, 0.003), dir.z));
  var L = textureSampleLevel(skyViewLut, skySampler, skyViewUv(d, sky.cameraHeightKm, sky.sizes.xy), 0.0).rgb * SKY_LUT_INV_SCALE;
  let domeL = skyState.dome.rgb * (1.0 + 2.0 * d.y) / 3.0;
  return mix(L, domeL, sky.weather.x);
}

@fragment
fn fsWater(in: VsOut) -> FsOut {
  let P = in.world;
  // The sea plane gives way to the simulated grid inside the opened area.
  // They overlap by a quarter meter, so no hairline crack opens along the seam.
  let lo = waterCellCenter(vec2i(wd.rectOrigin) + 1) + 0.25;
  let hi = waterCellCenter(vec2i(wd.rectOrigin + wd.rectSize) - 2) - 0.25;
  if (in.bed < -40.0 && all(P.xz > lo) && all(P.xz < hi)) { discard; }

  let pixel = vec2i(in.pos.xy);
  let screenUv = in.pos.xy * frame.invRenderSize;
  let viewDist = distance(P, frame.cameraPos);
  let v = (frame.cameraPos - P) / max(viewDist, 1e-4);
  let t = wd.time;
  var d = max(in.depth, 0.0);

  // ---- surface normal ----
  // Ripples calm down in very thin water and with distance (their slope variance moves into
  // roughness instead, so far water never sparkles or crawls).
  let far = clamp(viewDist / 120.0, 0.0, 1.0);
  let shallow = smoothstep(0.0, 0.06, d);
  // Flow map: two phases half a cycle apart, each advected by the velocity, cross-faded.
  let period = 2.0;
  let ph0 = fract(t / period);
  let ph1 = fract(t / period + 0.5);
  let fv = in.vel * wd.waveB.w;
  let g0 = ripples(P.xz - fv * ph0 * period, t);
  let g1 = ripples(P.xz - fv * ph1 * period + vec2f(3.7, 1.3), t);
  let blend = abs(2.0 * ph0 - 1.0);
  // Faster water is choppier.
  let speed = length(in.vel);
  var grad = mix(g0, g1, blend) * shallow * (1.0 - 0.75 * far) * (1.0 + 1.5 * min(speed, 1.0));
  grad += swell(P.xz, t) * smoothstep(0.0, wd.scatter.w, d);
  grad += in.slope;
  let n = normalize(vec3f(-grad.x, 1.0, -grad.y));
  // Thin water is a broken film: stones and blades stand through it, so it reflects weakly and
  // scatters the sun broadly. Deeper water is a coherent surface.
  // Running water is glossy however thin: its rippled surface glints like a deep one.
  let cohere = max(smoothstep(wd.filmDepth.x, wd.filmDepth.y, d), 0.85 * smoothstep(0.05, 0.3, speed) * smoothstep(0.004, 0.015, d));
  let rough = mix(0.3, sqrt(wd.absorbPond.w * wd.absorbPond.w + 0.012 * far), cohere);

  // ---- light ----
  let vis = shadowVisibility(P, vec3f(0.0, 1.0, 0.0), viewDist, in.pos.xy);
  let casterIsSun = dot(light.shadowDir, frame.sunDir) > 0.999;
  let sunVis = select(1.0, vis, casterIsSun);
  let moonVis = select(vis, 1.0, casterIsSun);
  let f0 = wd.absorbSea.w;
  let nv = max(dot(n, v), 0.0);
  let F = (f0 + (1.0 - f0) * pow(1.0 - nv, 5.0)) * mix(0.3, 1.0, cohere);

  // Reflection of the sky; the sun and moon disks come in as GGX glints.
  let r = reflect(-v, n);
  let refl = skyRadiance(r) * frame.exposure;
  let glint = (frame.sunIlluminance * sunVis * ggxSpecular(n, v, frame.sunDir, rough, f0)
             + frame.moonIlluminance * moonVis * ggxSpecular(n, v, frame.moonDir, rough, f0)) * frame.exposure;

  // ---- refraction ----
  let thick = min(d, 1.0);
  var uvR = screenUv + n.xz * wd.refraction * thick * vec2f(1.0, -1.0);
  uvR = clamp(uvR, vec2f(0.0), vec2f(1.0) - frame.invRenderSize);
  var pixR = vec2i(uvR * frame.renderSize);
  var sd = textureLoad(sceneDepth, pixR, 0);
  // Reverse-Z: a larger depth is nearer. Reject samples of things in front of the water.
  if (sd > in.pos.z) { uvR = screenUv; pixR = pixel; sd = textureLoad(sceneDepth, pixR, 0); }
  let sceneR = textureSampleLevel(sceneColor, clampSampler, uvR, 0.0).rgb;

  // Path length under water along the view ray, to whatever the copy shows there.
  var L = 1e4;
  var scene = sceneR;
  var sceneHere = textureLoad(sceneColor, pixel, 0).rgb;
  let sunIn = frame.sunIlluminance * sunVis * max(frame.sunDir.y, 0.0) + frame.moonIlluminance * moonVis * max(frame.moonDir.y, 0.0);
  let lightIn = skyAmbient(vec3f(0.0, 1.0, 0.0)) + sunIn / PI;
  let lo2 = waterCellCenter(vec2i(wd.rectOrigin));
  let hi2 = waterCellCenter(vec2i(wd.rectOrigin + wd.rectSize) - 1);
  let out2 = max(max(lo2 - P.xz, P.xz - hi2), vec2f(0.0));
  var sceneP = vec3f(0.0);
  var useScene = sd > 0.0 && all(out2 == vec2f(0.0));
  if (useScene) {
    let ndc = vec2f(uvR.x * 2.0 - 1.0, 1.0 - uvR.y * 2.0);
    let wp = frame.invViewProj * vec4f(ndc, sd, 1.0);
    sceneP = wp.xyz / wp.w;
    // The terrain's edge skirts hang just past the opened area; seen through the water they
    // are a dark wall, so anything there counts as open sea floor instead.
    useScene = all(sceneP.xz > lo2) && all(sceneP.xz < hi2);
  }
  if (useScene) {
    L = distance(sceneP, P);
    // The open sea plane carries no depth of its own; over terrain it takes the real one.
    if (in.bed < -40.0) { d = max(P.y - sceneP.y, 0.0); }
  } else {
    // Beyond the terrain: the island's sea floor continues and slowly deepens into open sea.
    // (Out here the depth copy can only hold the terrain's edge skirts, never the floor itself.)
    let floorY = wd.floorY - wd.floorSlope * length(out2);
    L = (P.y - floorY) / max(v.y, 0.02);
    d = max(P.y - floorY, 0.0);
    scene = wd.seabed.rgb * lightIn * frame.exposure;
    sceneHere = scene;
  }

  // ---- the water body ----
  // Sea or pond by how deep the bed lies below the tide (ponds are peatier and greener).
  let seaness = smoothstep(0.3, 1.5, wd.tide - in.bed);
  let sigma = mix(wd.absorbPond.rgb, wd.absorbSea.rgb, seaness);
  // Light reaches the bed through the water above it, then comes back along the view ray.
  let sunDown = 1.0 / max(frame.sunDir.y, 0.25);
  let Tview = exp(-sigma * L);
  let Tbed = Tview * exp(-sigma * d * sunDown);
  // Single scattering: sky and sun light the water body, weighted by how much of the view ray
  // is water (1 - Tview), so a deep sea reads as its own color.
  let inScatter = wd.scatter.rgb * lightIn * (vec3f(1.0) - Tview) * frame.exposure;

  // The scene copy already carries its own aerial perspective; only the water's own light gets it here.
  let own = inScatter * (1.0 - F) + refl * F + glint;
  var surface = applyAerial(own, screenUv, viewDist) + scene * Tbed * (1.0 - F);

  // ---- riffles ----
  // Fast, shallow water churns over its bed and takes in air, which shows as white flecks
  // drifting with the current (docs/07 foam; the advected foam field arrives in S4c). Only real
  // running water (a centimeter or so), never a film. Lit like a rough white surface.
  let rifMask = smoothstep(wd.riffle.x, wd.riffle.y, speed) * smoothstep(0.006, 0.015, d)
              * (1.0 - smoothstep(wd.riffle.z * 0.5, wd.riffle.z, d));
  if (rifMask > 0.001) {
    // A short cycle of their own, so the flecks drift without smearing into long streaks.
    let fp = 0.7;
    let f0p = fract(t / fp);
    let f1p = fract(t / fp + 0.5);
    let a = flecks(P.xz - in.vel * f0p * fp);
    let b = flecks(P.xz - in.vel * f1p * fp + vec2f(3.7, 1.3));
    let white = mix(a, b, abs(2.0 * f0p - 1.0)) * rifMask;
    let foam = applyAerial(wd.riffle2.y * lightIn * frame.exposure, screenUv, viewDist);
    surface = mix(surface, foam, white);
  }

  // Shoreline: the water fades out over the last half cell toward a dry bank and where the plane
  // meets the ground (thickness under edgeFade), so banks never show a hard line. Thin streams
  // stay visible; their film look comes from `cohere` above.
  // A sheet only a few millimeters thick shows as damp ground (the terrain soaks it), not water.
  let sheet = select(smoothstep(0.002, 0.006, d), 1.0, in.bed < -40.0);
  let edge = smoothstep(0.0, 0.7, in.cover) * smoothstep(0.0, wd.edgeFade, L) * sheet;
  var color = mix(sceneHere, surface, edge);
  // Debug views for tuning (tools and ?waterdbg=N): one term of the shading at a time.
  let dv = u32(wd.debugView + 0.5);
  if (dv == 1u) { color = select(vec3f(0.0, 4.0, 0.0), vec3f(4.0, 0.0, 0.0), in.bed < -40.0); if (any(surface != surface)) { color = vec3f(0.0, 0.0, 4.0); } }
  if (dv == 2u) { color = refl * 4.0; }
  if (dv == 3u) { color = (scene * Tbed + inScatter) * 4.0; }
  if (dv == 4u) { color = vec3f(F * 10.0, min(L / 50.0, 1.0) * 4.0, d / 10.0 * 4.0); }
  // Water flag in B keeps outlines off the water (docs/05).
  return FsOut(vec4f(color, 1.0), vec4f(octEncode(vec3f(0.0, 1.0, 0.0)), 1.0, 0.0));
}

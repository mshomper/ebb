// Scanned ground detail (docs/22): sample each present material's detail maps, blend the
// materials by height so sand settles into the cracks between stones, and build the
// millimeter-scale detail normal by the surface gradient method (Mikkelsen 2020).
// Flat ground uses one projection from above; steep ground (past ground.steep) blends three
// projections by |n|^6 (triplanar), so cliffs show the scan without stretching. Each material
// has its own tile size. Repeats are hidden by hex tiling (Heitz and Neyret 2018, Mikkelsen 2022)
// on desktop tiers, by a two-scale mix on the low tier, and by a slow macro tone drift everywhere.
//
// The including shader includes lib-hash first and declares these bindings (terrain-draw.wgsl, group 2):
//   groundA: texture_2d_array<f32>  (rgba8unorm-srgb view) RGB albedo (linear after decode), A height
//   groundB: texture_2d_array<f32>  R,G normal X,Y (OpenGL, 0..1), B roughness, A cavity
//   groundSampler: sampler (anisotropic, repeat)
//   ground: GroundDetail (uniform)

struct GroundDetail {
  layers: array<vec4f, 4>,  // per material: heightAmplitudeM, normalStrength, roughMin, roughMax
  _unused: f32,
  heightInfluence: f32,
  blendDepth: f32,
  fade: f32,                // 0 until the maps load, then 1 over fadeInS
  terminator: vec2f,        // detail light fades in over this range of dot(meshNormal, L)
  f0: f32,                  // dielectric specular reflectance
  fadeMeters: f32,          // detail fades to the flat recipe look by this view distance
  specMode: f32,            // 0 none, 1 sun only, 2 sun and moon
  triplanar: f32,           // 1 on tiers with the cliff projection, 0 to stay planar
  steep: vec2f,             // cos of the slope angles where the cliff projection fades in (from, full)
  tileInv: vec4f,           // 1 / tile size in meters, per material
  tiling: vec4f,            // x mode (0 plain grid, 1 hex, 2 two-scale), y hex density, z hex sharpness, w two-scale size
  macroTone: vec4f,         // x, y 1 / macro scales in meters; z strength; w hue shift
  mixing: vec4f,            // x macro second-octave weight, y 1 / two-scale noise size in meters
  // Moss, the fifth layer (array layer 4): it grows over the painted layers where the ground
  // stays damp (world/growth/moss-live.js), so its weight comes from the moss mask, not paint.
  moss: vec4f,              // heightAmplitudeM, normalStrength, roughMin, roughMax
  mossTile: vec4f,          // x 1 / tile size (m); yzw flat moss albedo for the far look
  mossRules: vec4f,         // most moss each ground can carry: grass, sand, rock, soil (0..1)
  porosity: vec4f,          // how much water each ground soaks up (G3): grass, sand, rock, soil (0..1)
  porosity2: vec4f,         // x moss porosity
};

const GROUND_LAYERS: i32 = 5;

fn layerParams(i: i32) -> vec4f {
  if (i == 4) { return ground.moss; }
  return ground.layers[i];
}

fn layerTileInv(i: i32) -> f32 {
  if (i == 4) { return ground.mossTile.x; }
  return ground.tileInv[i];
}

struct GroundSample {
  albedo: vec3f,      // linear albedo of the textured blend
  normal: vec3f,      // detail normal (world)
  roughness: f32,
  cavity: f32,        // occlusion for sky light only (docs/06)
  weights: vec4f,     // height-blended material weights (grass, sand, rock, soil)
  amount: f32,        // how much detail applies here (load fade x distance fade)
  mossWeight: f32,    // height-blended moss weight
  height: f32,        // blended detail height 0..1 (0.5 where no detail applies), for puddles
  porosity: f32,      // blended porosity 0..1 (G3 wet look)
};

struct LayerSample {
  albedo: vec3f,
  height: f32,
  grad: vec3f,        // world-space height gradient from this projection
  rough: f32,
  cavity: f32,
};

// One read of one layer's maps at `uv`, with explicit UV gradients `gx`, `gy`.
fn groundFetch(i: i32, uv: vec2f, gx: vec2f, gy: vec2f, u: vec3f, v: vec3f) -> LayerSample {
  let a = textureSampleGrad(groundA, groundSampler, uv, i, gx, gy);
  let b = textureSampleGrad(groundB, groundSampler, uv, i, gx, gy);
  // OpenGL normal map: +X along +u; +Y is image-up, which is -v.
  let t = vec2f(b.r, b.g) * 2.0 - 1.0;
  let tz = sqrt(max(1.0 - dot(t, t), 1e-4));
  let lp = layerParams(i);
  var o: LayerSample;
  o.albedo = a.rgb;
  o.height = a.a;
  o.grad = (u * (-t.x / tz) + v * (t.y / tz)) * lp.y;
  o.rough = mix(lp.z, lp.w, b.b);
  o.cavity = b.a;
  return o;
}

fn mixLayer(a: LayerSample, b: LayerSample, k: f32) -> LayerSample {
  var o: LayerSample;
  o.albedo = a.albedo + b.albedo * k;
  o.height = a.height + b.height * k;
  o.grad = a.grad + b.grad * k;
  o.rough = a.rough + b.rough * k;
  o.cavity = a.cavity + b.cavity * k;
  return o;
}

fn zeroLayer() -> LayerSample {
  var o: LayerSample;
  o.albedo = vec3f(0.0); o.height = 0.0; o.grad = vec3f(0.0); o.rough = 0.0; o.cavity = 0.0;
  return o;
}

// Random image offset (in tiles) for one triangle-grid vertex of one layer.
fn hexOffset(vtx: vec2f, i: i32) -> vec2f {
  let h = hash3(vec3u(vec2u(vec2i(vtx) + vec2i(1 << 20)), u32(i) + 0x51edu));
  return vec2f(hashToFloat(h), hashToFloat(pcg(h)));
}

// One projection of one layer. `u` and `v` are the world axes the image runs along; gradients
// are the screen derivatives of the world position, so all three projections mip correctly.
fn groundProject(i: i32, p: vec3f, dpx: vec3f, dpy: vec3f, u: vec3f, v: vec3f) -> LayerSample {
  let k = layerTileInv(i);
  let uv = vec2f(dot(p, u), dot(p, v)) * k;
  let gx = vec2f(dot(dpx, u), dot(dpx, v)) * k;
  let gy = vec2f(dot(dpy, u), dot(dpy, v)) * k;
  let mode = ground.tiling.x;
  if (mode > 1.5) {
    // Two-scale mix (low tier): a second read at a larger size, mixed in by slow noise.
    let t = 1.0 / ground.tiling.w;
    let a = groundFetch(i, uv, gx, gy, u, v);
    let b = groundFetch(i, uv * t + vec2f(0.37, 0.71), gx * t, gy * t, u, v);
    let n = valueNoise2(vec2f(dot(p, u), dot(p, v)) * ground.mixing.y, 0x7a3u + u32(i));
    let m = smoothstep(0.3, 0.7, n);
    return mixLayer(mixLayer(zeroLayer(), a, 1.0 - m), b, m);
  }
  if (mode < 0.5) { return groundFetch(i, uv, gx, gy, u, v); }

  // Hex tiling (Mikkelsen 2022): the three vertices of the triangle-grid cell around this point
  // each read the image at their own random offset. Offsets are constant per vertex, so the
  // unoffset gradients stay right and mips never seam.
  let q = uv * ground.tiling.y;
  let g = vec2f(q.x - 0.57735027 * q.y, 1.15470054 * q.y);
  let base = floor(g);
  let f = g - base;
  let z = 1.0 - f.x - f.y;
  let s = select(0.0, 1.0, z < 0.0);
  let s2 = 2.0 * s - 1.0;
  let bw = max(vec3f(-z * s2, s - f.y * s2, s - f.x * s2), vec3f(0.0));
  let v1 = base + vec2f(s, s);
  let v2 = base + vec2f(s, 1.0 - s);
  let v3 = base + vec2f(1.0 - s, s);
  let a = groundFetch(i, uv + hexOffset(v1, i), gx, gy, u, v);
  let b = groundFetch(i, uv + hexOffset(v2, i), gx, gy, u, v);
  let c = groundFetch(i, uv + hexOffset(v3, i), gx, gy, u, v);
  // Weights sharpened by height (docs/22): the taller sample wins, so seams hide in the cracks.
  var hw = pow(bw, vec3f(ground.tiling.z)) * pow(vec3f(a.height, b.height, c.height) + 0.25, vec3f(4.0));
  hw /= max(hw.x + hw.y + hw.z, 1e-6);
  return mixLayer(mixLayer(mixLayer(zeroLayer(), a, hw.x), b, hw.y), c, hw.z);
}

// Slow brightness and hue drift over tens of meters (docs/22), for the textured and flat ground
// alike, so far views lose the last hint of repeats. Multiplies linear albedo around 1.
fn groundMacro(xz: vec2f, seed: u32) -> vec3f {
  let m1 = valueNoise2(xz * ground.macroTone.x, seed + 11u) - 0.5;
  let m2 = valueNoise2(xz * ground.macroTone.y + vec2f(17.3, 5.9), seed + 12u) - 0.5;
  let m = m1 + ground.mixing.x * m2;
  let hue = ground.macroTone.w * m;
  return (1.0 + ground.macroTone.z * m) * vec3f(1.0 + hue, 1.0, 1.0 - hue);
}

// Detail at a world point. `w4` are the material weights after the derived layers (steep rock,
// beach sand); `moss` the moss cover (0..1), which lies over them; `nMesh` the mesh normal. The
// scanned albedos are calibrated to the recipe means (tools/texture-lab.html), so the caller
// mixes `albedo` with its flat recipe blend by `amount`.
fn groundDetail(p: vec3f, nMesh: vec3f, w4: vec4f, moss: f32, viewDist: f32) -> GroundSample {
  // Screen derivatives once, here, so sampling inside branches needs no uniform control flow.
  let dpx = dpdx(p);
  let dpy = dpdy(p);
  // How much of the cliff projection this slope gets, and the triplanar weights.
  let steep = (1.0 - smoothstep(ground.steep.y, ground.steep.x, nMesh.y)) * ground.triplanar;
  var tw = pow(abs(nMesh), vec3f(6.0));
  tw /= max(tw.x + tw.y + tw.z, 1e-5);

  // Five weights: moss covers the painted layers in proportion to its cover.
  var w = array<f32, 5>(w4.x * (1.0 - moss), w4.y * (1.0 - moss), w4.z * (1.0 - moss), w4.w * (1.0 - moss), moss);
  var hs = array<f32, 5>(0.5, 0.5, 0.5, 0.5, 0.5);
  var albedo = array<vec3f, 5>(vec3f(0.0), vec3f(0.0), vec3f(0.0), vec3f(0.0), vec3f(0.0));
  var grad = array<vec3f, 5>(vec3f(0.0), vec3f(0.0), vec3f(0.0), vec3f(0.0), vec3f(0.0));
  var rough = array<f32, 5>(0.85, 0.85, 0.85, 0.85, 0.85);
  var cav = array<f32, 5>(1.0, 1.0, 1.0, 1.0, 1.0);
  for (var i = 0; i < GROUND_LAYERS; i++) {
    if (w[i] < 0.004) { continue; }
    // From above: image u along +x, v along +z.
    var s = groundProject(i, p, dpx, dpy, vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0));
    if (steep > 0.001) {
      // Side projections keep the image upright (v runs down the slope, -y).
      let sx = groundProject(i, p, dpx, dpy, vec3f(0.0, 0.0, 1.0), vec3f(0.0, -1.0, 0.0));
      let sz = groundProject(i, p, dpx, dpy, vec3f(1.0, 0.0, 0.0), vec3f(0.0, -1.0, 0.0));
      let tri = mixLayer(mixLayer(mixLayer(zeroLayer(), sx, tw.x), s, tw.y), sz, tw.z);
      s = mixLayer(mixLayer(zeroLayer(), s, 1.0 - steep), tri, steep);
    }
    albedo[i] = s.albedo;
    hs[i] = s.height;
    grad[i] = s.grad;
    rough[i] = s.rough;
    cav[i] = s.cavity;
  }

  // Height blend (docs/22): the taller surface wins, within blendDepth.
  var a = array<f32, 5>(-1.0, -1.0, -1.0, -1.0, -1.0);
  var top = -1.0;
  for (var i = 0; i < GROUND_LAYERS; i++) {
    if (w[i] >= 0.004) { a[i] = w[i] + hs[i] * ground.heightInfluence; }
    top = max(top, a[i]);
  }
  var b = array<f32, 5>(0.0, 0.0, 0.0, 0.0, 0.0);
  var sum = 0.0;
  for (var i = 0; i < GROUND_LAYERS; i++) { b[i] = max(a[i] - (top - ground.blendDepth), 0.0); sum += b[i]; }

  var out: GroundSample;
  out.albedo = vec3f(0.0);
  var g3 = vec3f(0.0);
  out.roughness = 0.0;
  out.cavity = 0.0;
  out.height = 0.0;
  out.porosity = 0.0;
  let por = array<f32, 5>(ground.porosity.x, ground.porosity.y, ground.porosity.z, ground.porosity.w, ground.porosity2.x);
  for (var i = 0; i < GROUND_LAYERS; i++) {
    let k = b[i] / max(sum, 1e-4);
    out.albedo += albedo[i] * k;
    g3 += grad[i] * k;
    out.roughness += rough[i] * k;
    out.cavity += cav[i] * k;
    out.height += hs[i] * k;
    out.porosity += por[i] * k;
  }
  let s4 = max(sum, 1e-4);
  out.weights = vec4f(b[0], b[1], b[2], b[3]) / s4;
  out.mossWeight = b[4] / s4;
  out.amount = ground.fade * (1.0 - smoothstep(ground.fadeMeters * 0.6, ground.fadeMeters, viewDist));

  // Surface gradient: keep only the part of the gradient that lies in the surface, then tilt.
  let g = g3 * out.amount;
  let gs = g - dot(g, nMesh) * nMesh;
  out.normal = normalize(nMesh - gs);
  out.roughness = mix(0.85, out.roughness, out.amount);
  out.cavity = mix(1.0, out.cavity, out.amount);
  out.height = mix(0.5, out.height, out.amount);
  return out;
}

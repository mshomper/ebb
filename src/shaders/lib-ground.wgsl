// Scanned ground detail (docs/22): sample each present material's detail maps, blend the
// materials by height so sand settles into the cracks between stones, and build the
// millimeter-scale detail normal by the surface gradient method (Mikkelsen 2020).
// Flat ground uses one projection from above; steep ground (past ground.steep) blends three
// projections by |n|^6 (triplanar), so cliffs show the scan without stretching. Each material
// has its own tile size. Hex tiling and macro variation arrive in G2.
//
// The including shader declares these bindings (terrain-draw.wgsl, group 2):
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
};

struct GroundSample {
  albedo: vec3f,      // linear albedo of the textured blend
  normal: vec3f,      // detail normal (world)
  roughness: f32,
  cavity: f32,        // occlusion for sky light only (docs/06)
  weights: vec4f,     // height-blended material weights
  amount: f32,        // how much detail applies here (load fade x distance fade)
};

struct LayerSample {
  albedo: vec3f,
  height: f32,
  grad: vec3f,        // world-space height gradient from this projection
  rough: f32,
  cavity: f32,
};

// One projection of one layer. `u` and `v` are the world axes the image runs along; gradients
// are the screen derivatives of the world position, so all three projections mip correctly.
fn groundProject(i: i32, p: vec3f, dpx: vec3f, dpy: vec3f, u: vec3f, v: vec3f) -> LayerSample {
  let k = ground.tileInv[i];
  let uv = vec2f(dot(p, u), dot(p, v)) * k;
  let gx = vec2f(dot(dpx, u), dot(dpx, v)) * k;
  let gy = vec2f(dot(dpy, u), dot(dpy, v)) * k;
  let a = textureSampleGrad(groundA, groundSampler, uv, i, gx, gy);
  let b = textureSampleGrad(groundB, groundSampler, uv, i, gx, gy);
  // OpenGL normal map: +X along +u; +Y is image-up, which is -v.
  let t = vec2f(b.r, b.g) * 2.0 - 1.0;
  let tz = sqrt(max(1.0 - dot(t, t), 1e-4));
  let s = ground.layers[i].y;
  var o: LayerSample;
  o.albedo = a.rgb;
  o.height = a.a;
  o.grad = (u * (-t.x / tz) + v * (t.y / tz)) * s;
  o.rough = mix(ground.layers[i].z, ground.layers[i].w, b.b);
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

// Detail at a world point. `w` are the material weights after the derived layers (steep rock,
// beach sand); `nMesh` the mesh normal. The scanned albedos are calibrated to the recipe means
// (tools/texture-lab.html), so the caller mixes `albedo` with its flat recipe blend by `amount`.
fn groundDetail(p: vec3f, nMesh: vec3f, w: vec4f, viewDist: f32) -> GroundSample {
  // Screen derivatives once, here, so sampling inside branches needs no uniform control flow.
  let dpx = dpdx(p);
  let dpy = dpdy(p);
  // How much of the cliff projection this slope gets, and the triplanar weights.
  let steep = (1.0 - smoothstep(ground.steep.y, ground.steep.x, nMesh.y)) * ground.triplanar;
  var tw = pow(abs(nMesh), vec3f(6.0));
  tw /= max(tw.x + tw.y + tw.z, 1e-5);

  var hs = vec4f(0.5);
  var albedo = array<vec3f, 4>(vec3f(0.0), vec3f(0.0), vec3f(0.0), vec3f(0.0));
  var grad = array<vec3f, 4>(vec3f(0.0), vec3f(0.0), vec3f(0.0), vec3f(0.0));
  var rough = vec4f(0.85);
  var cav = vec4f(1.0);
  for (var i = 0; i < 4; i++) {
    if (w[i] < 0.004) { continue; }
    // From above: image u along +x, v along +z.
    var s = groundProject(i, p, dpx, dpy, vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0));
    if (steep > 0.001) {
      // Side projections keep the image upright (v runs down the slope, -y).
      let sx = groundProject(i, p, dpx, dpy, vec3f(0.0, 0.0, 1.0), vec3f(0.0, -1.0, 0.0));
      let sz = groundProject(i, p, dpx, dpy, vec3f(1.0, 0.0, 0.0), vec3f(0.0, -1.0, 0.0));
      var tri: LayerSample;
      tri.albedo = vec3f(0.0); tri.height = 0.0; tri.grad = vec3f(0.0); tri.rough = 0.0; tri.cavity = 0.0;
      tri = mixLayer(tri, sx, tw.x);
      tri = mixLayer(tri, s, tw.y);
      tri = mixLayer(tri, sz, tw.z);
      var top: LayerSample;
      top.albedo = vec3f(0.0); top.height = 0.0; top.grad = vec3f(0.0); top.rough = 0.0; top.cavity = 0.0;
      s = mixLayer(mixLayer(top, s, 1.0 - steep), tri, steep);
    }
    albedo[i] = s.albedo;
    hs[i] = s.height;
    grad[i] = s.grad;
    rough[i] = s.rough;
    cav[i] = s.cavity;
  }

  // Height blend (docs/22): the taller surface wins, within blendDepth.
  let present = step(vec4f(0.004), w);
  let a4 = (w + hs * ground.heightInfluence) * present - (1.0 - present);
  let top4 = max(max(a4.x, a4.y), max(a4.z, a4.w));
  var b4 = max(a4 - (top4 - ground.blendDepth), vec4f(0.0));
  b4 /= max(b4.x + b4.y + b4.z + b4.w, 1e-4);

  var out: GroundSample;
  out.albedo = albedo[0] * b4.x + albedo[1] * b4.y + albedo[2] * b4.z + albedo[3] * b4.w;
  let g3 = grad[0] * b4.x + grad[1] * b4.y + grad[2] * b4.z + grad[3] * b4.w;
  out.roughness = dot(rough, b4);
  out.cavity = dot(cav, b4);
  out.weights = b4;
  out.amount = ground.fade * (1.0 - smoothstep(ground.fadeMeters * 0.6, ground.fadeMeters, viewDist));

  // Surface gradient: keep only the part of the gradient that lies in the surface, then tilt.
  let g = g3 * out.amount;
  let gs = g - dot(g, nMesh) * nMesh;
  out.normal = normalize(nMesh - gs);
  out.roughness = mix(0.85, out.roughness, out.amount);
  out.cavity = mix(1.0, out.cavity, out.amount);
  return out;
}

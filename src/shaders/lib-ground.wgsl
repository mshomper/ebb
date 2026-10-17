// Scanned ground detail (docs/22): sample each present material's detail maps, blend the
// materials by height so sand settles into the cracks between stones, and build the
// millimeter-scale detail normal by the surface gradient method (Mikkelsen 2020).
// G1: planar projection from above. Hex tiling, triplanar and macro variation arrive in G2.
//
// The including shader declares these bindings (terrain-draw.wgsl, group 2):
//   groundA: texture_2d_array<f32>  (rgba8unorm-srgb view) RGB albedo (linear after decode), A height
//   groundB: texture_2d_array<f32>  R,G normal X,Y (OpenGL, 0..1), B roughness, A cavity
//   groundSampler: sampler (anisotropic, repeat)
//   ground: GroundDetail (uniform)

struct GroundDetail {
  layers: array<vec4f, 4>,  // per material: heightAmplitudeM, normalStrength, roughMin, roughMax
  tileInv: f32,             // 1 / tile size in meters
  heightInfluence: f32,
  blendDepth: f32,
  fade: f32,                // 0 until the maps load, then 1 over fadeInS
  terminator: vec2f,        // detail light fades in over this range of dot(meshNormal, L)
  f0: f32,                  // dielectric specular reflectance
  fadeMeters: f32,          // detail fades to the flat recipe look by this view distance
  specMode: f32,            // 0 none, 1 sun only, 2 sun and moon
  _p0: f32, _p1: f32, _p2: f32,
};

struct GroundSample {
  albedo: vec3f,      // linear albedo of the textured blend
  normal: vec3f,      // detail normal (world)
  roughness: f32,
  cavity: f32,        // occlusion for sky light only (docs/06)
  weights: vec4f,     // height-blended material weights
  amount: f32,        // how much detail applies here (load fade x distance fade)
};

// Detail at a world point. `w` are the material weights after the derived layers (steep rock,
// beach sand); `nMesh` the mesh normal. The scanned albedos are calibrated to the recipe means
// (tools/texture-lab.html), so the caller mixes `albedo` with its flat recipe blend by `amount`.
fn groundDetail(xz: vec2f, nMesh: vec3f, w: vec4f, viewDist: f32) -> GroundSample {
  let uv = xz * ground.tileInv;
  // Explicit gradients: computed once here, so sampling inside the loop needs no uniform control flow.
  let ddx = dpdx(uv);
  let ddy = dpdy(uv);
  var hs = vec4f(0.5);
  var albedo = array<vec3f, 4>(vec3f(0.0), vec3f(0.0), vec3f(0.0), vec3f(0.0));
  var grad = array<vec2f, 4>(vec2f(0.0), vec2f(0.0), vec2f(0.0), vec2f(0.0));
  var rough = vec4f(0.85);
  var cav = vec4f(1.0);
  for (var i = 0; i < 4; i++) {
    if (w[i] < 0.004) { continue; }
    let a = textureSampleGrad(groundA, groundSampler, uv, i, ddx, ddy);
    let b = textureSampleGrad(groundB, groundSampler, uv, i, ddx, ddy);
    let p = ground.layers[i];
    albedo[i] = a.rgb;
    hs[i] = a.a;
    // OpenGL normal map: +X along +u (world +x); +Y is image-up, which is -v, i.e. world -z.
    let t = vec2f(b.r, b.g) * 2.0 - 1.0;
    let tz = sqrt(max(1.0 - dot(t, t), 1e-4));
    grad[i] = vec2f(-t.x, t.y) / tz * p.y;   // height gradient (dh/dx, dh/dz)
    rough[i] = mix(p.z, p.w, b.b);
    cav[i] = b.a;
  }

  // Height blend (docs/22): the taller surface wins, within blendDepth.
  let present = step(vec4f(0.004), w);
  let a4 = (w + hs * ground.heightInfluence) * present - (1.0 - present);
  let top = max(max(a4.x, a4.y), max(a4.z, a4.w));
  var b4 = max(a4 - (top - ground.blendDepth), vec4f(0.0));
  b4 /= max(b4.x + b4.y + b4.z + b4.w, 1e-4);

  var out: GroundSample;
  out.albedo = albedo[0] * b4.x + albedo[1] * b4.y + albedo[2] * b4.z + albedo[3] * b4.w;
  let g2 = grad[0] * b4.x + grad[1] * b4.y + grad[2] * b4.z + grad[3] * b4.w;
  out.roughness = dot(rough, b4);
  out.cavity = dot(cav, b4);
  out.weights = b4;
  out.amount = ground.fade * (1.0 - smoothstep(ground.fadeMeters * 0.6, ground.fadeMeters, viewDist));

  // Surface gradient: project the planar height gradient onto the surface, then tilt the normal.
  let g = vec3f(g2.x, 0.0, g2.y) * out.amount;
  let gs = g - dot(g, nMesh) * nMesh;
  out.normal = normalize(nMesh - gs);
  out.roughness = mix(0.85, out.roughness, out.amount);
  out.cavity = mix(1.0, out.cavity, out.amount);
  return out;
}

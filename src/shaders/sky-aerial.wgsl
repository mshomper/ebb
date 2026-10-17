// Aerial perspective froxels (32^3, 16^3 on low), Hillaire 2020 section 5.4, over the current camera
// frustum: x, y follow screen uv (0,0 top-left), z slices view distance quadratically, slice k holding
// the integral from the camera to d_k = maxDist * ((k + 0.5) / N)^2. rgb = in-scatter (nits *
// SKY_LUT_SCALE), a = mean transmittance.
// Each thread integrates one slice segment of one screen column; a prefix scan in workgroup memory then
// composites the segments front to back (L = L_a + T_a L_b, T = T_a T_b). 64 threads = 64 / N columns.
// Cloud cover dims the sun and moon terms and adds isotropic light from the overcast dome.

// #include common
// #include lib-atmosphere

@group(0) @binding(0) var<uniform> atmo: AtmosphereParams;
@group(0) @binding(1) var<uniform> sky: SkyUniforms;
@group(0) @binding(2) var transmittanceLut: texture_2d<f32>;
@group(0) @binding(3) var multiScatterLut: texture_2d<f32>;
@group(0) @binding(4) var lutSampler: sampler;
@group(0) @binding(5) var<storage, read> state: SkyState;
@group(0) @binding(6) var outLut: texture_storage_3d<rgba16float, write>;

const SUBSTEPS: i32 = 2;

var<workgroup> scanL: array<vec3f, 64>;
var<workgroup> scanT: array<vec3f, 64>;

fn sliceKm(k: f32, nf: f32) -> f32 {
  let w = (k + 0.5) / nf;
  return sky.aerialMaxDist * w * w * 0.001;
}

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let n = u32(sky.sizes.z);
  let nf = f32(n);
  let k = li % n;
  let col = wg.x * (64u / n) + li / n;
  let cell = vec2u(col % n, col / n);

  let uv = (vec2f(cell) + 0.5) / nf;
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let far = sky.invViewProj * vec4f(ndc, 1e-6, 1.0);
  let dir = normalize(far.xyz / far.w - sky.cameraPos);
  let h0 = sky.cameraHeightKm;

  let cloud = sky.weather.x;
  let lights = skyLights(sky, 1.0 - sky.weather.z * cloud);
  let dome = state.dome.rgb * (cloud / 3.0);   // isotropic phase times the dome's scalar fluence (4 pi Lz / 3)
  let c0 = dot(dir, lights.l0.dir);
  let c1 = dot(dir, lights.l1.dir);

  let t0 = select(0.0, sliceKm(f32(k) - 1.0, nf), k > 0u);
  let dt = (sliceKm(f32(k), nf) - t0) / f32(SUBSTEPS);
  var L = vec3f(0.0);
  var T = vec3f(1.0);
  for (var s = 0; s < SUBSTEPS; s++) {
    let t = t0 + (f32(s) + 0.5) * dt;
    let h = heightAlong(h0, dir.y, t);
    let m = sampleMedium(atmo, h);
    var src = lightAt(atmo, m, transmittanceLut, multiScatterLut, lutSampler, lights.l0, h,
                      zenithCosAlong(h0, c0, lights.l0.dir.y, t, h), c0, false, true);
    if (lights.count > 1) {
      src += lightAt(atmo, m, transmittanceLut, multiScatterLut, lutSampler, lights.l1, h,
                     zenithCosAlong(h0, c1, lights.l1.dir.y, t, h), c1, false, true);
    }
    src += (m.scatterR + m.scatterM + m.scatterA) * dome;
    let ext = max(m.extinction, vec3f(1e-7));
    let stepT = exp(-ext * dt);
    L += T * (src - src * stepT) / ext;
    T *= stepT;
  }

  // Inclusive prefix scan along the column (Hillis-Steele).
  scanL[li] = L;
  scanT[li] = T;
  workgroupBarrier();
  for (var off = 1u; off < n; off <<= 1u) {
    let has = k >= off;
    var pl = vec3f(0.0);
    var pt = vec3f(1.0);
    if (has) { pl = scanL[li - off]; pt = scanT[li - off]; }
    workgroupBarrier();
    if (has) {
      scanL[li] = pl + pt * scanL[li];
      scanT[li] = pt * scanT[li];
    }
    workgroupBarrier();
  }
  let outL = scanL[li];
  let outT = scanT[li];
  textureStore(outLut, vec3u(cell, k), vec4f(min(outL * SKY_LUT_SCALE, vec3f(60000.0)), dot(outT, vec3f(1.0 / 3.0))));
}

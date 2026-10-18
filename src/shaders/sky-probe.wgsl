// Sky probe cube (docs/06 "Ambient light"): the sky as reflections see it, with GGX-prefiltered mips
// for rough or rippled water and, later, wet ground (doc 22, G3). Sampling rules are in lib-probe.wgsl.
//
// probeBase writes mip 0 for all six faces (dispatch z = face): the clear sky from the sky-view LUT,
// blended toward the overcast dome as sky-draw.wgsl does, over the probe's ground hemisphere below the
// horizon. No sun or moon disk and no stars: the surfaces add those as analytic GGX glints.
// probePrefilter writes mip m from mip m - 1 (a cube view of that one mip, so no subresource is read and
// written by the same dispatch). Mip m stands for perceptual roughness r = m / (levels - 1); the JS
// passes the incremental GGX alpha sqrt(alpha_m^2 - alpha_(m-1)^2), since mip m - 1 is already blurred
// by alpha_(m-1) and GGX-like lobes add roughly in alpha^2. An approximation of a full prefilter from
// mip 0, close enough for a 64² sky. N = V = R (Karis 2013), a fixed Hammersley set, weights n.l.
// Values stay nits * SKY_LUT_SCALE, not pre-exposed.

// #include common
// #include lib-atmosphere
// #include lib-probe

struct ProbeParams {
  alpha: f32,        // prefilter: incremental GGX alpha for this mip; base: unused
  samples: u32,      // prefilter sample count
  faceSize: u32,     // texels per face edge at this mip
  horizonSin: f32,   // base: sine of the horizon blend width
};

@group(0) @binding(0) var<uniform> sky: SkyUniforms;
@group(0) @binding(1) var skyViewLut: texture_2d<f32>;
@group(0) @binding(2) var skySampler: sampler;
@group(0) @binding(3) var<storage, read> state: SkyState;
@group(0) @binding(4) var probeOut: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(5) var<uniform> params: ProbeParams;
@group(0) @binding(6) var srcCube: texture_cube<f32>;
@group(0) @binding(7) var srcSampler: sampler;

fn texelDir(gid: vec3u) -> vec3f {
  let uv = (vec2f(gid.xy) + 0.5) / f32(params.faceSize);
  return normalize(probeFaceDir(gid.z, uv));
}

fn storeProbe(gid: vec3u, c: vec3f) {
  textureStore(probeOut, gid.xy, gid.z, vec4f(clamp(c, vec3f(0.0), vec3f(PROBE_MAX_STORED)), 1.0));
}

@compute @workgroup_size(8, 8, 1)
fn probeBase(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= params.faceSize || gid.y >= params.faceSize) { return; }
  let d = texelDir(gid);
  var L = textureSampleLevel(skyViewLut, skySampler, skyViewUv(d, sky.cameraHeightKm, sky.sizes.xy), 0.0).rgb
        * SKY_LUT_INV_SCALE;
  let domeL = state.dome.rgb * (1.0 + 2.0 * max(d.y, 0.0)) / 3.0;
  L = mix(L, domeL, sky.weather.x);
  // Ground fades in from the horizon down to horizonSin below it, so the sky above is untouched.
  let skyW = smoothstep(-params.horizonSin, 0.0, d.y);
  L = mix(state.groundRadiance.rgb, L, skyW);
  storeProbe(gid, L * PROBE_SCALE);
}

fn hammersley(i: u32, n: u32) -> vec2f {
  return vec2f(f32(i) / f32(n), f32(reverseBits(i)) * 2.3283064365386963e-10);
}

@compute @workgroup_size(8, 8, 1)
fn probePrefilter(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= params.faceSize || gid.y >= params.faceSize) { return; }
  let n = texelDir(gid);
  let a2 = params.alpha * params.alpha;
  let up = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), abs(n.z) < 0.999);
  let tx = normalize(cross(up, n));
  let ty = cross(n, tx);
  let count = max(params.samples, 1u);
  var acc = vec3f(0.0);
  var wsum = 0.0;
  for (var i = 0u; i < count; i++) {
    let xi = hammersley(i, count);
    let phi = 2.0 * PI * xi.x;
    let cosT = sqrt((1.0 - xi.y) / (1.0 + (a2 - 1.0) * xi.y));
    let sinT = sqrt(max(1.0 - cosT * cosT, 0.0));
    let h = tx * (cos(phi) * sinT) + ty * (sin(phi) * sinT) + n * cosT;
    let l = 2.0 * dot(n, h) * h - n;
    let nl = dot(n, l);
    if (nl > 0.0) {
      acc += textureSampleLevel(srcCube, srcSampler, l, 0.0).rgb * nl;
      wsum += nl;
    }
  }
  // Sample 0 is h = n, so wsum >= 1.
  storeProbe(gid, acc / max(wsum, 1e-6));
}

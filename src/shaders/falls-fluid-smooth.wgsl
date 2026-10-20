// Smooths the waterfall's droplet depth into one surface (screen-space fluid; a separable bilateral
// filter, Green GDC 2010): each pixel takes a Gaussian average of its neighbors along one axis, near
// ones in depth only, so the surface between droplets fills in and silhouettes stay put. The filter
// spans about the same width in meters at any distance. Run twice per pass pair: across, then down.

struct Smooth {
  dir: vec2i,          // (1, 0) or (0, 1)
  size: vec2u,         // half-res target size
  pxPerM: f32,         // half-res pixels a meter spans at 1 m away
  widthM: f32,         // filter radius (m)
  depthSigma: f32,     // m: depth difference over which neighbors stop counting
  maxPx: f32,          // at most this many pixels either way
};

@group(0) @binding(0) var<uniform> sm: Smooth;
@group(0) @binding(1) var depthIn: texture_2d<f32>;
@group(0) @binding(2) var depthOut: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8)
fn csSmooth(@builtin(global_invocation_id) gid: vec3u) {
  if (any(gid.xy >= sm.size)) { return; }
  let c = vec2i(gid.xy);
  let z0 = textureLoad(depthIn, c, 0).r;
  if (z0 <= 0.0) { textureStore(depthOut, c, vec4f(0.0)); return; }
  let rpx = clamp(sm.widthM * sm.pxPerM / z0, 1.0, sm.maxPx);
  let steps = i32(ceil(rpx));
  let sigma = max(rpx * 0.5, 0.5);
  var sum = 0.0;
  var wsum = 0.0;
  let hi = vec2i(sm.size) - 1;
  for (var i = -steps; i <= steps; i++) {
    let z = textureLoad(depthIn, clamp(c + sm.dir * i, vec2i(0), hi), 0).r;
    if (z <= 0.0) { continue; }
    let fi = f32(i);
    let dz = (z - z0) / sm.depthSigma;
    let w = exp(-fi * fi / (2.0 * sigma * sigma) - dz * dz);
    sum += z * w;
    wsum += w;
  }
  textureStore(depthOut, c, vec4f(sum / max(wsum, 1e-6), 0.0, 0.0, 0.0));
}

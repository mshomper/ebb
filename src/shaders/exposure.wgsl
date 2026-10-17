// Auto-exposure measurement (docs/05, "Exposure"). Two compute entry points in one pass:
//   histogramMain: a downsampled grid of HDR texels -> 64-bin histogram of EV100, center weighted.
//   reduceMain:    one workgroup trims the darkest and brightest shares, averages the rest into a
//                  target EV100, and clears the histogram for the next frame.
// The HDR target is pre-exposed: luminance in nits = hdr luminance / frame.exposure.
// EV100 of a luminance L (nits) = log2(L * 100 / 12.5), the reflected-light meter with K = 12.5.

// #include common

const BINS: u32 = 64u;
// Integer weight units per pixel, so the center mask can use atomic integer bins.
const WEIGHT_SCALE: f32 = 16.0;

struct ExposureParams {
  grid: vec2u,          // sample grid (texels read per frame)
  srcSize: vec2u,       // HDR target size in texels
  histMinEV: f32,
  histMaxEV: f32,
  centerWeight: f32,    // weight at the screen center; edges weigh 1
  lowCut: f32,          // share of weight dropped from the dark end
  highCut: f32,         // share of weight dropped from the bright end
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
};

struct ExposureResult {
  targetEV: f32,
  totalWeight: f32,
  keptWeight: f32,
  valid: f32,           // 1 when targetEV is meaningful
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> params: ExposureParams;
@group(1) @binding(1) var hdrTex: texture_2d<f32>;
@group(1) @binding(2) var<storage, read_write> histogram: array<atomic<u32>, 64>;
@group(1) @binding(3) var<storage, read_write> result: ExposureResult;

var<workgroup> localBins: array<atomic<u32>, 64>;
var<workgroup> bins: array<u32, 64>;

@compute @workgroup_size(16, 8)
fn histogramMain(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) li: u32) {
  if (li < BINS) { atomicStore(&localBins[li], 0u); }
  workgroupBarrier();

  if (all(gid.xy < params.grid)) {
    let uv = (vec2f(gid.xy) + 0.5) / vec2f(params.grid);
    let texel = min(vec2u(uv * vec2f(params.srcSize)), params.srcSize - vec2u(1u));
    let rgb = textureLoad(hdrTex, texel, 0).rgb;
    let lum = dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
    let nits = max(lum, 0.0) / max(frame.exposure, 1e-20);
    let ev = log2(max(nits, 1e-8) * 8.0);
    let t = (ev - params.histMinEV) / (params.histMaxEV - params.histMinEV);
    let bin = min(u32(clamp(floor(t * f32(BINS)), 0.0, f32(BINS - 1u))), BINS - 1u);
    // Center-weighted mask: centerWeight at the middle, falling smoothly to 1 at the edge midpoints.
    let d = length((uv - 0.5) * 2.0);
    let w = mix(1.0, params.centerWeight, 1.0 - smoothstep(0.0, 1.0, d));
    atomicAdd(&localBins[bin], u32(round(max(w, 0.0) * WEIGHT_SCALE)));
  }
  workgroupBarrier();

  if (li < BINS) {
    let c = atomicLoad(&localBins[li]);
    if (c > 0u) { atomicAdd(&histogram[li], c); }
  }
}

@compute @workgroup_size(64)
fn reduceMain(@builtin(local_invocation_index) li: u32) {
  bins[li] = atomicLoad(&histogram[li]);
  atomicStore(&histogram[li], 0u);
  workgroupBarrier();
  if (li != 0u) { return; }

  var total = 0.0;
  for (var i = 0u; i < BINS; i++) { total += f32(bins[i]); }
  let lo = total * params.lowCut;
  let hi = total * (1.0 - params.highCut);
  let binWidth = (params.histMaxEV - params.histMinEV) / f32(BINS);

  // Average the bin centers over the kept weight band [lo, hi], counting partial bins.
  var cum = 0.0;
  var kept = 0.0;
  var sumEV = 0.0;
  for (var i = 0u; i < BINS; i++) {
    let c = f32(bins[i]);
    let a = max(cum, lo);
    let b = min(cum + c, hi);
    if (b > a) {
      sumEV += (b - a) * (params.histMinEV + (f32(i) + 0.5) * binWidth);
      kept += b - a;
    }
    cum += c;
  }

  var r: ExposureResult;
  r.totalWeight = total;
  r.keptWeight = kept;
  if (kept > 0.0) {
    r.targetEV = sumEV / kept;
    r.valid = 1.0;
  } else {
    r.targetEV = 0.0;
    r.valid = 0.0;
  }
  result = r;
}

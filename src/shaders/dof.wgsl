// Depth of field for photo mode (B2 P1): a thin lens on the linear HDR image, before exposure,
// bloom and the tonemap, so out-of-focus highlights spread as real light does.
//   focus: one thread reads the depth round the point you clicked and eases the focus distance
//     toward it (kept in a tiny storage buffer, so focus follows that point as things move).
//   blur:  a single-pass gather (after Dennis Gustafsson, "Bokeh depth of field in a single pass",
//     2017): samples on a golden-angle spiral out to the largest blur circle, each counted where its
//     own circle reaches the pixel; a sample behind the pixel may blur at most twice the pixel's own
//     circle, so a sharp subject never takes on the blurred background behind it.
// Circle of confusion (diameter on the sensor): A f |z - zf| / (z (zf - f)), with A = f / N.

// #include common

struct Dof {
  focusUv: vec2f,       // the point focus follows (0..1)
  focalM: f32,          // focal length (m), from the field of view and the sensor height
  apertureM: f32,       // aperture diameter (m): focal length / f-number
  pxPerSensorM: f32,    // image pixels per meter on the sensor (image height / sensor height)
  maxRadiusPx: f32,     // the largest blur radius (px)
  stepPx: f32,          // the spiral's spacing (px)
  dt: f32,              // seconds since the last frame
  halfLifeS: f32,       // focus easing
  snap: f32,            // 1: jump straight to the new focus
  _p: vec2f,
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> dof: Dof;
@group(1) @binding(1) var hdrTex: texture_2d<f32>;
@group(1) @binding(2) var depthTex: texture_depth_2d;
@group(1) @binding(3) var linearSampler: sampler;
@group(1) @binding(4) var<storage, read_write> focusM: array<f32, 4>;   // [0] focus distance (m)

const GOLDEN = 2.39996323;
const FAR_M = 2000.0;

/** View distance (m) of a reverse-Z, infinite-far depth. */
fn viewZ(d: f32) -> f32 {
  return select(FAR_M, min(frame.near / d, FAR_M), d > 0.0);
}

fn depthAt(p: vec2i) -> f32 {
  let size = vec2i(textureDimensions(depthTex));
  return textureLoad(depthTex, clamp(p, vec2i(0), size - 1), 0);
}

/** Blur circle radius (px) at view distance z, for the focus distance zf. */
fn cocRadius(z: f32, zf: f32) -> f32 {
  let f = dof.focalM;
  let c = dof.apertureM * f * abs(z - zf) / (z * max(zf - f, 1e-4));
  return min(0.5 * c * dof.pxPerSensorM, dof.maxRadiusPx);
}

@compute @workgroup_size(1)
fn focus() {
  let size = vec2f(textureDimensions(depthTex));
  let c = vec2i(dof.focusUv * size);
  // The nearest thing in a small cross round the click, so a thin stem or a frog's edge holds focus.
  var d = 0.0;
  let r = max(1, i32(size.y / 360.0));
  for (var i = -2; i <= 2; i++) {
    d = max(d, depthAt(c + vec2i(i * r, 0)));
    d = max(d, depthAt(c + vec2i(0, i * r)));
  }
  let goal = viewZ(d);
  let cur = focusM[0];
  var next = goal;
  if (dof.snap < 0.5 && cur > 0.0) {
    // Ease in log distance, so a far change and a near one take the same time.
    let k = 1.0 - exp2(-dof.dt / max(dof.halfLifeS, 1e-3));
    next = exp(mix(log(cur), log(goal), k));
  }
  focusM[0] = next;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> FullscreenOut {
  return fullscreenTriangle(vi);
}

@fragment
fn blur(in: FullscreenOut) -> @location(0) vec4f {
  let zf = focusM[0];
  let texel = 1.0 / vec2f(textureDimensions(hdrTex));
  let px = vec2i(in.pos.xy);
  let z0 = viewZ(depthAt(px));
  let size0 = cocRadius(z0, zf);
  var color = textureSampleLevel(hdrTex, linearSampler, in.uv, 0.0).rgb;
  var total = 1.0;
  var radius = dof.stepPx;
  var ang = 0.0;
  loop {
    if (radius >= dof.maxRadiusPx) { break; }
    let off = vec2f(cos(ang), sin(ang)) * radius;
    let uv = in.uv + off * texel;
    let s = textureSampleLevel(hdrTex, linearSampler, uv, 0.0).rgb;
    let z = viewZ(depthAt(vec2i(in.pos.xy + off)));
    var ss = cocRadius(z, zf);
    if (z > z0) { ss = min(ss, size0 * 2.0); }
    let m = smoothstep(radius - 0.5, radius + 0.5, ss);
    color += mix(color / total, s, m);
    total += 1.0;
    radius += dof.stepPx / radius;
    ang += GOLDEN;
  }
  // Alpha carries this pixel's blur radius, so the tonemap can let its ink go soft too.
  return vec4f(color / total, size0);
}

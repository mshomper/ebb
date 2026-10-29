// The camp fire's volume (Matt's fire study, October 29, 2026; camp-fire.js): the fire sim's smoke and
// heat marched along each view ray through the fire's box, against the scene's depth, so logs,
// stones and the walker hide the flame. Two passes:
//   fsVolume     at the tier's share of the render size (half on every tier today): the smoke, lit
//                like the camp's puffs (the sky, the sun and moon, the fire's own light) over its
//                transmittance, and the heat collected, with the distance it marched to
//   fsComposite  at the render size, a depth-aware upsample: the smoke blended over the HDR (never
//                added), a soft unbanded glow added for bloom, and the heat into fireHeat, which the
//                tonemap paints as the banded flame after the palette (lib-fire-bands.wgsl)
// Both draw a full-screen triangle scissored to the box on screen.

// #include common
// #include lib-hash
// #include lighting-bindings
// #include lib-sky
// #include lib-lighting

struct FireDraw {
  foot: vec4f,   // xyz the fire's foot (m), w samples along a ray
  box: vec4f,    // xyz the box's size (m), w the volume's share of the render size
  bmin: vec4f,   // xyz the box's corner from the foot (m), w smoke density
  detail: vec4f, // xyz heat detail (cycles a meter), w heat gain
  smoke: vec4f,  // rgb smoke albedo, w time (s)
  glow: vec4f,   // x glow nits (pre-exposure), y, z the volume's size (px), w frame
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var<uniform> fd: FireDraw;
@group(2) @binding(1) var dyeTex: texture_3d<f32>;
@group(2) @binding(2) var dyeSampler: sampler;
@group(2) @binding(3) var depthTex: texture_depth_2d;
@group(2) @binding(4) var volSmokeTex: texture_2d<f32>;
@group(2) @binding(5) var volHeatTex: texture_2d<f32>;

fn fhash(p: vec3f) -> f32 {
  var q = fract(p * 0.3183099 + vec3f(0.11, 0.17, 0.13));
  q = q * 17.0;
  return fract(q.x * q.y * q.z * (q.x + q.y + q.z));
}
fn fnoise(x: vec3f) -> f32 {
  let i = floor(x); let f = fract(x);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fhash(i), fhash(i + vec3f(1, 0, 0)), u.x), mix(fhash(i + vec3f(0, 1, 0)), fhash(i + vec3f(1, 1, 0)), u.x), u.y),
             mix(mix(fhash(i + vec3f(0, 0, 1)), fhash(i + vec3f(1, 0, 1)), u.x), mix(fhash(i + vec3f(0, 1, 1)), fhash(i + vec3f(1, 1, 1)), u.x), u.y), u.z);
}

/** The world point at a screen uv (0..1) and depth. */
fn worldAt(uv: vec2f, d: f32) -> vec3f {
  let h = frame.invViewProj * vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, d, 1.0);
  return h.xyz / h.w;
}
/** How far along the view ray the scene is at a full-size pixel (m); far for the sky. */
fn sceneDist(px: vec2i) -> f32 {
  let size = vec2i(textureDimensions(depthTex));
  let q = clamp(px, vec2i(0), size - 1);
  let d = textureLoad(depthTex, q, 0);
  if (d <= 0.0) { return 1e6; }
  return distance(worldAt((vec2f(q) + 0.5) / vec2f(size), d), frame.cameraPos);
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> FullscreenOut {
  return fullscreenTriangle(vi);
}

struct VolOut { @location(0) smoke: vec4f, @location(1) heat: vec2f };

@fragment
fn fsVolume(@builtin(position) pos: vec4f) -> VolOut {
  let t = fd.smoke.w;
  let uv = pos.xy / fd.glow.yz;
  let ro = frame.cameraPos;
  let rd = normalize(worldAt(uv, 0.5) - ro);
  // The nearest scene under this texel (a half-size texel covers 2 x 2 full pixels).
  let k = max(1, i32(round(1.0 / fd.box.w)));
  let base = vec2i(floor(pos.xy)) * k;
  var tHit = 1e6;
  for (var y = 0; y < k; y++) {
    for (var x = 0; x < k; x++) { tHit = min(tHit, sceneDist(base + vec2i(x, y))); }
  }
  let lo = fd.foot.xyz + fd.bmin.xyz;
  let inv = 1.0 / rd;
  let t0 = (lo - ro) * inv; let t1 = (lo + fd.box.xyz - ro) * inv;
  let tmin = min(t0, t1); let tmax = max(t0, t1);
  let tA = max(max(tmin.x, tmin.y), max(tmin.z, 0.0));
  let tB = min(min(min(tmax.x, tmax.y), tmax.z), tHit);
  var heatAcc = 0.0;
  var trans = 1.0;
  var smokeAcc = vec3f(0.0);
  if (tB > tA) {
    let steps = i32(fd.foot.w);
    let ds = (tB - tA) / f32(steps);
    let jit = fract(fhash(vec3f(pos.xy, fd.glow.w * 0.1)) + fd.glow.w * 0.618034);
    // The smoke's light: the sky all round and the sun and moon (once a ray), the fire's own from below.
    let sky = skyAmbient(vec3f(0.0, 1.0, 0.0));
    let direct = frame.sunIlluminance * (0.5 + 0.5 * max(frame.sunDir.y, 0.0)) + frame.moonIlluminance * 0.5;
    var tt = tA + ds * jit;
    for (var i = 0; i < steps; i++) {
      let p = ro + rd * tt;
      let d = textureSampleLevel(dyeTex, dyeSampler, (p - lo) / fd.box.xyz, 0.0);
      var smoke = d.r; var heat = d.g;
      if (heat > 0.02) {
        // sub-voxel detail, so the coarse grid does not read as blur
        heat *= 0.55 + 0.9 * fnoise(p * fd.detail.xyz - vec3f(0.0, t * 2.6, 0.0));
      }
      smoke *= 0.7 + 0.6 * fnoise(p * 7.0 - vec3f(0.0, t * 0.6, 0.0));
      heat = max(heat - 0.05, 0.0);
      heatAcc += heat * fd.detail.w * ds * trans;
      let sig = smoke * fd.bmin.w;
      if (sig > 0.001) {
        let fire = pointIllum(p, normalize(fd.foot.xyz - p + vec3f(0.0, 0.01, 0.0)), 1.0) * 0.5;
        // Single scattering in a thin medium, as the puffs (camp-fx.wgsl): 1 / (4 pi) of the light.
        let radiance = fd.smoke.rgb * (sky + (direct + fire) / (4.0 * PI));
        let a = 1.0 - exp(-sig * ds);
        smokeAcc += trans * a * radiance * frame.exposure;
        trans *= 1.0 - a;
      }
      tt += ds;
    }
  }
  var o: VolOut;
  o.smoke = vec4f(smokeAcc, trans);
  o.heat = vec2f(heatAcc, tHit);
  return o;
}

struct CompOut { @location(0) hdr: vec4f, @location(1) heat: f32 };

@fragment
fn fsComposite(@builtin(position) pos: vec4f) -> CompOut {
  var smoke = vec4f(0.0, 0.0, 0.0, 1.0);
  var heat = 0.0;
  let vmax = vec2i(fd.glow.yz) - 1;
  if (fd.box.w >= 0.999) {
    let q = clamp(vec2i(floor(pos.xy)), vec2i(0), vmax);
    smoke = textureLoad(volSmokeTex, q, 0);
    heat = textureLoad(volHeatTex, q, 0).x;
  } else {
    // Depth-aware upsample: the four nearest volume texels, each weighted by how near the distance it
    // marched to is to this pixel's own.
    let d0 = min(sceneDist(vec2i(floor(pos.xy))), 50.0);
    let hp = pos.xy * fd.box.w - 0.5;
    let b = vec2i(floor(hp));
    let fr = hp - floor(hp);
    var wsum = 0.0; var best = 1e9; var bestS = smoke; var bestH = 0.0;
    var acc = vec4f(0.0); var hacc = 0.0;
    for (var j = 0; j < 4; j++) {
      let o = vec2i(j & 1, j >> 1);
      let q = clamp(b + o, vec2i(0), vmax);
      let bil = select(1.0 - fr.x, fr.x, o.x == 1) * select(1.0 - fr.y, fr.y, o.y == 1);
      let s = textureLoad(volSmokeTex, q, 0);
      let h = textureLoad(volHeatTex, q, 0);
      let dd = abs(min(h.y, 50.0) - d0);
      let w = bil * exp(-dd / (0.02 + 0.03 * d0)) + 1e-5 * bil;
      acc += s * w; hacc += h.x * w; wsum += w;
      if (dd < best) { best = dd; bestS = s; bestH = h.x; }
    }
    if (wsum > 1e-4) { smoke = acc / wsum; heat = hacc / wsum; } else { smoke = bestS; heat = bestH; }
  }
  // A soft glow from the heat, unbanded, so bloom and exposure answer to the fire; the painted flame
  // covers it where the flame is.
  let glow = vec3f(1.0, 0.5, 0.2) * fd.glow.x * frame.exposure * smoothstep(0.04, 0.5, heat);
  var o: CompOut;
  o.hdr = vec4f(smoke.rgb + glow * smoke.a, 1.0 - smoke.a);
  o.heat = heat;
  return o;
}

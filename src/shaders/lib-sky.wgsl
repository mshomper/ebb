// Sky terms for lit surfaces (docs/06). Include after `common` and `lighting-bindings`; the including
// shader declares `@group(0) @binding(0) var<uniform> frame: FrameUniforms;`.
//
//   skyAmbient(n)                    -> nits, NOT pre-exposed: outgoing radiance of a white Lambert
//                                       surface facing n under sky + ground light (irradiance / pi).
//                                       Multiply by albedo and ambient occlusion, then by frame.exposure.
//   applyAerial(c, screenUv, dist)   -> takes a pre-exposed surface color, returns it with aerial
//                                       perspective: c * T + inScatter * frame.exposure.
//                                       screenUv = fragCoord.xy * frame.invRenderSize ((0,0) top-left);
//                                       dist = length(worldPos - frame.cameraPos) in meters.
//   transmittanceTo(dir)             -> unitless rgb, sea-level transmittance toward dir (0 below the
//                                       horizon, soft over the sun's radius). transmittanceAt adds height.

// #include lib-atmosphere

fn skyAmbient(n: vec3f) -> vec3f {
  let d = n;
  var c = skySH[0].rgb * 0.282095;
  c += skySH[1].rgb * (0.488603 * d.y);
  c += skySH[2].rgb * (0.488603 * d.z);
  c += skySH[3].rgb * (0.488603 * d.x);
  c += skySH[4].rgb * (1.092548 * d.x * d.y);
  c += skySH[5].rgb * (1.092548 * d.y * d.z);
  c += skySH[6].rgb * (0.315392 * (3.0 * d.z * d.z - 1.0));
  c += skySH[7].rgb * (1.092548 * d.x * d.z);
  c += skySH[8].rgb * (0.546274 * (d.x * d.x - d.y * d.y));
  return max(c, vec3f(0.0));
}

fn applyAerial(color: vec3f, screenUv: vec2f, viewDist: f32) -> vec3f {
  let maxDist = light.aerial.x;
  let slices = max(light.aerial.y, 1.0);
  let first = 0.5 / slices;
  let last = 1.0 - first;
  let dFirst = maxDist * first * first;
  let dLast = maxDist * last * last;
  let w = clamp(sqrt(max(viewDist, 0.0) / maxDist), first, last);
  let s = textureSampleLevel(aerialLut, lutSampler, vec3f(screenUv, w), 0.0);
  var inScatter = s.rgb * SKY_LUT_INV_SCALE;
  var t = s.a;
  if (viewDist < dFirst) {
    let f = max(viewDist, 0.0) / dFirst;
    inScatter *= f;
    t = mix(1.0, t, f);
  } else if (viewDist > dLast) {
    // Past the last slice: continue as a uniform medium (T^k, geometric sum of the in-scatter).
    let k = min(viewDist / dLast, 64.0);
    let tk = pow(max(t, 1e-6), k);
    let gain = select((1.0 - tk) / (1.0 - t), k, 1.0 - t < 1e-4);
    inScatter *= gain;
    t = tk;
  }
  return color * t + inScatter * frame.exposure;
}

fn transmittanceAt(heightM: f32, dir: vec3f) -> vec3f {
  return lightTransmittance(transmittanceLut, lutSampler, max(heightM, 0.0) * 0.001, dir.y, SUN_SIN_RADIUS);
}

fn transmittanceTo(dir: vec3f) -> vec3f {
  return transmittanceAt(0.0, dir);
}

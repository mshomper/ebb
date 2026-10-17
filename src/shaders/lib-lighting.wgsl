// Shared surface lighting (docs/06): sun and moon direct light with cascaded shadows, sky fill
// from SH9, then aerial perspective. Physical units throughout (lux in, nits out); the result is
// pre-exposed. Needs `common`, `lib-hash`, `lighting-bindings` and `lib-sky` included first, and
// the including shader to declare `frame` at group 0 binding 0.

// 16 Poisson-disk taps in the unit disk; tiers use the first 4, 9 or 16.
var<private> POISSON: array<vec2f, 16> = array<vec2f, 16>(
  vec2f(-0.94201624, -0.39906216), vec2f(0.94558609, -0.76890725), vec2f(-0.09418410, -0.92938870), vec2f(0.34495938, 0.29387760),
  vec2f(-0.91588581, 0.45771432), vec2f(-0.81544232, -0.87912464), vec2f(-0.38277543, 0.27676845), vec2f(0.97484398, 0.75648379),
  vec2f(0.44323325, -0.97511554), vec2f(0.53742981, -0.47373420), vec2f(-0.26496911, -0.41893023), vec2f(0.79197514, 0.19090188),
  vec2f(-0.24188840, 0.99706507), vec2f(-0.81409955, 0.91437590), vec2f(0.19984126, 0.78641367), vec2f(0.14383161, -0.14100790));

fn shadowCascade(viewDist: f32) -> i32 {
  let count = i32(light.cascadeSplits.w);
  if (viewDist < light.cascadeSplits.x || count == 1) { return 0; }
  if (viewDist < light.cascadeSplits.y || count == 2) { return 1; }
  return 2;
}

// Fraction of the shadow caster's light reaching this point (1 = fully lit).
// `pixel` seeds a fixed per-pixel rotation of the taps (no temporal noise, so nothing crawls).
fn shadowVisibility(worldPos: vec3f, n: vec3f, viewDist: f32, pixel: vec2f) -> f32 {
  if (light.shadowStrength <= 0.0) { return 1.0; }
  let farEdge = select(light.cascadeSplits.z, select(light.cascadeSplits.y, light.cascadeSplits.x, light.cascadeSplits.w < 1.5), light.cascadeSplits.w < 2.5);
  if (viewDist > farEdge) { return 1.0; }
  let c = shadowCascade(viewDist);
  let texel = light.shadowTexel[c];
  // Normal offset grows as the surface turns away from the light; a small constant bias covers the rest.
  let nl = clamp(dot(n, light.shadowDir), 0.0, 1.0);
  let p = worldPos + n * texel * (1.5 + 2.0 * (1.0 - nl));
  let lp = light.cascadeViewProj[c] * vec4f(p, 1.0);
  let uv = vec2f(lp.x * 0.5 + 0.5, 0.5 - lp.y * 0.5);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || lp.z > 1.0) { return 1.0; }
  let depth = lp.z - 0.0015;
  let taps = u32(light.shadowTexel.w);
  let a = hashToFloat(hash2(vec2u(pixel))) * 6.2831853;
  let rot = mat2x2f(cos(a), sin(a), -sin(a), cos(a));
  let radius = 1.5 / f32(textureDimensions(shadowMap).x);
  var sum = 0.0;
  for (var i = 0u; i < taps; i++) {
    let o = rot * POISSON[i] * radius;
    sum += textureSampleCompareLevel(shadowMap, shadowSampler, uv + o, c, depth);
  }
  let s = sum / f32(max(taps, 1u));
  return mix(1.0, s, light.shadowStrength);
}

// Lambert surface lit by sun, moon and sky, with shadows and aerial perspective. Pre-exposed.
// `ambientOcclusion` scales only the sky fill (doc 06: AO never touches sun or moon light).
fn shadeSurface(albedo: vec3f, worldPos: vec3f, n: vec3f, fragPos: vec4f, ambientOcclusion: f32) -> vec3f {
  let viewDist = distance(worldPos, frame.cameraPos);
  let vis = shadowVisibility(worldPos, n, viewDist, fragPos.xy);
  let casterIsSun = dot(light.shadowDir, frame.sunDir) > 0.999;
  let sunVis = select(1.0, vis, casterIsSun);
  let moonVis = select(vis, 1.0, casterIsSun);
  let direct = frame.sunIlluminance * max(dot(n, frame.sunDir), 0.0) * sunVis
             + frame.moonIlluminance * max(dot(n, frame.moonDir), 0.0) * moonVis;
  let radiance = albedo * (direct / PI + skyAmbient(n) * ambientOcclusion);
  let screenUv = fragPos.xy * frame.invRenderSize;
  return applyAerial(radiance * frame.exposure, screenUv, viewDist);
}

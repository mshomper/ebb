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

// GGX specular lobe for one light: D·G·F / (4 n·l n·v), times n·l (Walter et al. 2007, Smith-GGX
// height-correlated visibility, Schlick Fresnel). Roughness is perceptual (alpha = r²).
fn ggxSpecular(n: vec3f, v: vec3f, l: vec3f, roughness: f32, f0: f32) -> f32 {
  let h = normalize(v + l);
  let nl = max(dot(n, l), 0.0);
  let nv = max(dot(n, v), 1e-4);
  let nh = max(dot(n, h), 0.0);
  let a = max(roughness * roughness, 0.002);
  let a2 = a * a;
  let d = a2 / (PI * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0));
  let gv = nl * sqrt(nv * nv * (1.0 - a2) + a2);
  let gl = nv * sqrt(nl * nl * (1.0 - a2) + a2);
  let vis = 0.5 / max(gv + gl, 1e-5);
  let f = f0 + (1.0 - f0) * pow(1.0 - max(dot(v, h), 0.0), 5.0);
  return d * vis * f * nl;
}

// Textured ground (docs/22): direct light on the detail normal, faded across the mesh terminator
// so detail never lights the dark side of a hill; sky fill at the detail normal times cavity; GGX
// sun (and moon) specular by `specMode`. Shadows, outline and AO keep using the mesh normal.
// `direct` scales the sun and moon diffuse only (underwater caustics: focused direct light on the
// bed, lib-caustics); sky fill and specular keep 1.
fn shadeGround(albedo: vec3f, worldPos: vec3f, nMesh: vec3f, nDetail: vec3f, roughness: f32, cavity: f32,
               fragPos: vec4f, terminator: vec2f, f0: f32, specMode: f32, direct: f32) -> vec3f {
  let viewDist = distance(worldPos, frame.cameraPos);
  let v = (frame.cameraPos - worldPos) / max(viewDist, 1e-4);
  let vis = shadowVisibility(worldPos, nMesh, viewDist, fragPos.xy);
  let casterIsSun = dot(light.shadowDir, frame.sunDir) > 0.999;
  let sunVis = select(1.0, vis, casterIsSun) * smoothstep(terminator.x, terminator.y, dot(nMesh, frame.sunDir));
  let moonVis = select(vis, 1.0, casterIsSun) * smoothstep(terminator.x, terminator.y, dot(nMesh, frame.moonDir));
  let sunNl = max(dot(nDetail, frame.sunDir), 0.0);
  let moonNl = max(dot(nDetail, frame.moonDir), 0.0);
  var radiance = albedo * ((frame.sunIlluminance * sunNl * sunVis + frame.moonIlluminance * moonNl * moonVis) * (direct / PI)
                           + skyAmbient(nDetail) * cavity);
  if (specMode > 0.5) {
    radiance += frame.sunIlluminance * sunVis * ggxSpecular(nDetail, v, frame.sunDir, roughness, f0);
  }
  if (specMode > 1.5) {
    radiance += frame.moonIlluminance * moonVis * ggxSpecular(nDetail, v, frame.moonDir, roughness, f0);
  }
  let screenUv = fragPos.xy * frame.invRenderSize;
  return applyAerial(radiance * frame.exposure, screenUv, viewDist);
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

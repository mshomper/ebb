// Sky-view LUT (192x108, or 96x54 on low): clear-sky radiance around the camera, rebuilt every frame
// (Hillaire 2020 section 5.3). Both the sun and the moon light the same atmosphere, so blue hour and
// moonlit nights come out of the same physics; a faint airglow floor is added for moonless nights.
// u is world azimuth (repeat), v is Hillaire's horizon-packed latitude. Stored as nits * SKY_LUT_SCALE.

// #include common
// #include lib-atmosphere

@group(0) @binding(0) var<uniform> atmo: AtmosphereParams;
@group(0) @binding(1) var<uniform> sky: SkyUniforms;
@group(0) @binding(2) var transmittanceLut: texture_2d<f32>;
@group(0) @binding(3) var multiScatterLut: texture_2d<f32>;
@group(0) @binding(4) var lutSampler: sampler;
@group(0) @binding(5) var outLut: texture_storage_2d<rgba16float, write>;

const LOCAL_STEPS: i32 = 10;
const MAIN_STEPS: i32 = 22;

// Airglow: a thin emitting shell at airglowHeightKm, brighter toward the horizon (van Rhijn), dimmed by
// the air in front of it.
fn airglow(h: f32, dir: vec3f) -> vec3f {
  if (dir.y < horizonMu(h)) { return vec3f(0.0); }
  let r = ATMO_BOTTOM + h;
  let k = r / (ATMO_BOTTOM + sky.airglowHeightKm);
  let s2 = 1.0 - dir.y * dir.y;
  let vanRhijn = 1.0 / sqrt(max(1.0 - k * k * s2, 0.02));
  let t = lightTransmittance(transmittanceLut, lutSampler, h, dir.y, 0.0);
  return sky.airglow * vanRhijn * t;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = sky.sizes.xy;
  if (f32(id.x) >= size.x || f32(id.y) >= size.y) { return; }
  let uv = (vec2f(id.xy) + 0.5) / size;
  let h = sky.cameraHeightKm;
  let dir = skyViewDir(uv, h, size);

  let lights = skyLights(sky, 1.0);

  let hitsGround = rayHitsGround(h, dir.y);
  var tEnd = distToTop(h, dir.y);
  if (hitsGround) { tEnd = distToGround(h, dir.y); }
  let tLocal = localSegmentKm(atmo, h, dir.y, tEnd);

  var acc: AtmoScatter;
  acc.L = vec3f(0.0);
  acc.T = vec3f(1.0);
  acc.F = vec3f(0.0);
  acc = integrateSegment(atmo, transmittanceLut, multiScatterLut, lutSampler, h, dir, 0.0, tLocal, LOCAL_STEPS,
                         lights.l0, lights.l1, lights.count, false, true, acc);
  acc = integrateSegment(atmo, transmittanceLut, multiScatterLut, lutSampler, h, dir, tLocal, tEnd, MAIN_STEPS,
                         lights.l0, lights.l1, lights.count, false, true, acc);
  var L = acc.L + airglow(h, dir);
  if (hitsGround) {
    L += acc.T * groundBounce(atmo, transmittanceLut, lutSampler, h, dir, tEnd, lights.l0, lights.l1, lights.count);
  }
  textureStore(outLut, id.xy, vec4f(min(L * SKY_LUT_SCALE, vec3f(60000.0)), 1.0));
}

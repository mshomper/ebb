// The camp's fire and what rises from it (docs/future/13 sections 3.5, C-29 to C-32, C-38): the
// flame (crossed tongues of emissive flame), a soft glow round it and the lantern's lit glass, the
// fire steel's sparks, the smoke (soft puffs that rise, grow and lean with the wind) and a few
// moths circling the fire and the lantern after dark. Every particle is placed here from its seed
// and the time, so the CPU only says where the fire is and how it burns. Emission is in nits and
// pre-exposed into the HDR; the smoke and moths are lit like everything else (sun, moon, sky,
// the small lights). The palette paints at tonemap (docs/05).

// #include common
// #include lib-hash
// #include lighting-bindings
// #include lib-sky
// #include lib-lighting

struct CampFx {
  fire: vec4f,       // xyz the flame's foot (m), w flame size 0..1 (0: none)
  burn: vec4f,       // x smoke amount 0..2, y smoke opacity, z time (s), w ember glow 0..1
  wind: vec4f,       // xz the smoke's lean (m/s), y rise (m/s), w hang low (mist) 0..1
  lantern: vec4f,    // xyz the lantern's glass (m), w lit 0..1
  flameLook: vec4f,  // x height (m), y width (m), z nits, w flicker (Hz)
  glowLook: vec4f,   // x fire halo nits, y halo size (m), z lantern glass nits, w glass size (m)
  smokeLook: vec4f,  // x life (s), y first size (m), z last size (m), w spread (m)
  smokeAlb: vec4f,   // rgb albedo, w fade in from this far from the eye (m)
  smokeMore: vec4f,  // x fully there from this far (m), y count, z flame min size (px), w flame cards
  moths: vec4f,      // x count, y, z orbit radius (m), w wing (m)
  moths2: vec4f,     // x, y height over the light (m), z, w speed (m/s)
  mothAlb: vec4f,    // rgb albedo, w flap (Hz)
  sparks: vec4f,     // xyz the steel (m), w seconds since the strike (negative: none)
  sparkLook: vec4f,  // x count, y life (s), z nits, w moths on 0..1
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var<uniform> fx: CampFx;

var<private> QUAD: array<vec2f, 6> = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
  vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

fn rand(i: u32, k: u32) -> f32 { return hashToFloat(hash2(vec2u(i, k))); }

/** The camera's right and up, for billboards. */
fn camRight() -> vec3f { return vec3f(frame.view[0][0], frame.view[1][0], frame.view[2][0]); }
fn camUp() -> vec3f { return vec3f(frame.view[0][1], frame.view[1][1], frame.view[2][1]); }

/** How much bigger a billboard of `sizeM` at `p` must be to stay at least minPx on screen. */
fn minScale(p: vec3f, sizeM: f32, minPx: f32) -> f32 {
  let w = (frame.viewProj * vec4f(p, 1.0)).w;
  let px = sizeM * frame.proj[1][1] * frame.renderSize.y * 0.5 / max(w, 1e-3);
  return max(1.0, minPx / max(px, 1e-4));
}

struct GlowOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) kind: u32,   // 0 flame tongue, 1 halo, 2 glass, 3 spark
  @location(2) @interpolate(flat) seed: f32,
  @location(3) @interpolate(flat) bright: f32,
};

// ---- flame, halo, glass and sparks: emission, added ----

@vertex
fn vsGlow(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> GlowOut {
  var o: GlowOut;
  let q = QUAD[vi];
  let cards = u32(fx.smokeMore.w);
  let sparkN = u32(fx.sparkLook.x);
  let t = fx.burn.z;
  var p = vec3f(0.0);
  var size = vec2f(0.0);
  o.uv = q;
  o.bright = 0.0;
  if (ii < cards) {
    // A tongue of flame: standing on the fire's foot, a little off the middle, swaying.
    o.kind = 0u;
    let s = fx.fire.w;
    let a = rand(ii, 1u) * 6.2831853;
    let r = 0.06 * rand(ii, 2u);
    let h = fx.flameLook.x * s * (0.6 + 0.5 * rand(ii, 3u)) * (0.85 + 0.15 * sin(t * fx.flameLook.w * (1.0 + rand(ii, 4u)) + a));
    let w = fx.flameLook.y * s * (0.55 + 0.45 * rand(ii, 5u));
    let k = minScale(fx.fire.xyz, fx.flameLook.y, fx.smokeMore.z);
    size = vec2f(w, h * 0.5) * k;
    p = fx.fire.xyz + vec3f(cos(a) * r, h * 0.5 * k, sin(a) * r);
    // The tip leans with the wind.
    p += vec3f(fx.wind.x, 0.0, fx.wind.z) * 0.08 * (q.y * 0.5 + 0.5) * h;
    o.seed = rand(ii, 6u) * 10.0;
    o.bright = fx.flameLook.z * select(0.0, 1.0, s > 0.0);
  } else if (ii == cards) {
    o.kind = 1u;
    let s = max(fx.fire.w, fx.burn.w * 0.35);
    let k = minScale(fx.fire.xyz, fx.glowLook.y, fx.smokeMore.z * 2.0);
    size = vec2f(fx.glowLook.y) * k * (0.6 + 0.4 * s);
    p = fx.fire.xyz + vec3f(0.0, fx.flameLook.x * 0.3, 0.0);
    o.bright = fx.glowLook.x * s;
  } else if (ii == cards + 1u) {
    o.kind = 2u;
    let k = minScale(fx.lantern.xyz, fx.glowLook.w, fx.smokeMore.z * 0.7);
    size = vec2f(fx.glowLook.w * 2.2) * k;
    p = fx.lantern.xyz;
    o.bright = fx.glowLook.z * fx.lantern.w;
  } else {
    // A spark off the steel: out and down, falling, cooling.
    o.kind = 3u;
    let i = ii - cards - 2u;
    // sparks.w: seconds since this strike, plus 10 for each strike before it (a new spray each time).
    let strike = floor(max(fx.sparks.w, 0.0) / 10.0);
    let age = fx.sparks.w - strike * 10.0;
    let j = i + u32(strike) * 97u;
    let dir = normalize(vec3f(rand(j, 11u) - 0.5, rand(j, 12u) * 0.6 - 0.2, rand(j, 13u) - 0.5));
    let v = 1.2 + 1.6 * rand(j, 14u);
    p = fx.sparks.xyz + dir * v * age + vec3f(0.0, -4.9 * age * age, 0.0);
    size = vec2f(0.006, 0.006) * minScale(p, 0.006, 1.5);
    let life = 1.0 - age / fx.sparkLook.y;
    o.bright = select(0.0, fx.sparkLook.z * life * life, fx.sparks.w >= 0.0 && life > 0.0 && i < sparkN && rand(j, 15u) < 0.8);
    o.seed = 0.0;
  }
  let world = p + camRight() * q.x * size.x + camUp() * q.y * size.y;
  o.pos = frame.viewProj * vec4f(world, 1.0);
  if (o.bright <= 0.0) { o.pos = vec4f(0.0, 0.0, -1.0, 1.0); }
  return o;
}

@fragment
fn fsGlow(in: GlowOut) -> @location(0) vec4f {
  let u = in.uv;
  var e = vec3f(0.0);
  if (in.kind == 0u) {
    // A teardrop, wide at the foot and pointed at the tip, its edge eaten by moving noise.
    let y = u.y * 0.5 + 0.5;
    let half = mix(0.75, 0.04, pow(y, 0.8)) * (1.0 - 0.6 * (1.0 - y) * (1.0 - y));
    let t = fx.burn.z;
    let n = valueNoise2(vec2f(u.x * 3.0 + in.seed, y * 4.0 - t * 2.7), 151u) * 0.6 + valueNoise2(vec2f(u.x * 7.0 - in.seed, y * 9.0 - t * 4.3), 157u) * 0.4;
    let d = abs(u.x) / max(half, 1e-3);
    let body = 1.0 - smoothstep(0.55, 1.0, d + (n - 0.5) * 0.7 * y);
    let core = 1.0 - smoothstep(0.0, 0.6, d + y * 0.6);
    // Hot white-gold at the foot and the core, deep orange to red at the tips.
    let col = mix(mix(vec3f(1.0, 0.42, 0.08), vec3f(1.0, 0.72, 0.32), core), vec3f(0.85, 0.2, 0.03), smoothstep(0.45, 1.0, y));
    e = col * body * (1.0 - y * 0.35);
  } else if (in.kind == 1u) {
    let r = length(u);
    e = vec3f(1.0, 0.5, 0.18) * exp(-r * r * 5.0) * (1.0 - smoothstep(0.8, 1.0, r));
  } else if (in.kind == 2u) {
    let r = length(u);
    e = vec3f(1.0, 0.72, 0.4) * (exp(-r * r * 9.0) + 0.15 * exp(-r * r * 2.0)) * (1.0 - smoothstep(0.85, 1.0, r));
  } else {
    let r = length(u);
    e = vec3f(1.0, 0.65, 0.3) * (1.0 - smoothstep(0.2, 1.0, r));
  }
  return vec4f(e * in.bright * frame.exposure, 0.0);
}

// ---- smoke: soft puffs, lit, over what is behind ----

struct SmokeOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) world: vec3f,
  @location(2) @interpolate(flat) alpha: f32,
  @location(3) @interpolate(flat) seed: f32,
};

@vertex
fn vsSmoke(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SmokeOut {
  var o: SmokeOut;
  let q = QUAD[vi];
  let life = fx.smokeLook.x;
  let n = fx.smokeMore.y;
  // Puffs leave one after another; each lives `life` seconds from its own start.
  let t0 = fx.burn.z + f32(ii) * life / n;
  let cycle = floor(t0 / life);
  let age = (t0 - cycle * life) / life;
  let j = ii * 131u + u32(cycle) * 7u;
  let rise = fx.wind.y * (1.0 - 0.6 * fx.wind.w);
  // Up, leaning with the wind more as it climbs out of the shelter of the ring; wandering a little.
  let up = rise * age * life;
  let lean = vec3f(fx.wind.x, 0.0, fx.wind.z) * life * age * age * 0.9;
  let wander = vec3f(rand(j, 21u) - 0.5, 0.0, rand(j, 22u) - 0.5) * fx.smokeLook.w * (1.0 + 6.0 * age);
  // From just above the flame's tips.
  let p = fx.fire.xyz + vec3f(0.0, fx.flameLook.x * 0.8 + up, 0.0) + lean + wander;
  let size = mix(fx.smokeLook.y, fx.smokeLook.z, sqrt(age)) * (0.8 + 0.4 * rand(j, 23u));
  let spin = rand(j, 24u) * 6.2831853 + age * (rand(j, 25u) - 0.5) * 2.0;
  let cs = cos(spin);
  let sn = sin(spin);
  let r = vec2f(cs * q.x - sn * q.y, sn * q.x + cs * q.y);
  o.world = p + (camRight() * r.x + camUp() * r.y) * size;
  o.pos = frame.viewProj * vec4f(o.world, 1.0);
  o.uv = q;
  // In from nothing, thinning out as it spreads, fading near the eye so it never fills the screen.
  let near = smoothstep(fx.smokeAlb.w, fx.smokeMore.x, distance(p, frame.cameraPos));
  o.alpha = fx.burn.y * min(fx.burn.x, 2.0) * smoothstep(0.0, 0.08, age) * (1.0 - age) * (1.0 - age) * near;
  o.seed = rand(j, 26u) * 7.0;
  if (o.alpha <= 0.001) { o.pos = vec4f(0.0, 0.0, -1.0, 1.0); }
  return o;
}

@fragment
fn fsSmoke(in: SmokeOut) -> @location(0) vec4f {
  let r = length(in.uv);
  let n = valueNoise2(in.uv * 1.7 + vec2f(in.seed), 163u) * 0.65 + valueNoise2(in.uv * 4.1 - vec2f(in.seed), 167u) * 0.35;
  let a = in.alpha * (1.0 - smoothstep(0.2, 1.0, r + (n - 0.5) * 0.6));
  if (a <= 0.001) { discard; }
  // Lit as a thin, scattering medium: the sky all round, the sun and moon and the fire's light
  // from any side (a little brighter toward them), never painted.
  let up = vec3f(0.0, 1.0, 0.0);
  let sky = skyAmbient(up);
  let direct = frame.sunIlluminance * (0.5 + 0.5 * max(frame.sunDir.y, 0.0)) + frame.moonIlluminance * 0.5
             + pointIllum(in.world, normalize(fx.fire.xyz - in.world + vec3f(0.0, 0.01, 0.0)), 1.0);
  // Single scattering in a thin medium: isotropic, 1 / (4 pi) of the light reaching it.
  let radiance = fx.smokeAlb.rgb * (sky + direct / (4.0 * PI));
  let viewDist = distance(in.world, frame.cameraPos);
  let color = applyAerial(radiance * frame.exposure, in.pos.xy * frame.invRenderSize, viewDist);
  return vec4f(color * a, a);
}

// ---- moths: two pale wings each, circling the lights ----

struct MothOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) world: vec3f,
  @location(2) @interpolate(flat) on: f32,
};

@vertex
fn vsMoth(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> MothOut {
  var o: MothOut;
  let wing = vi / 6u;
  let q = QUAD[vi % 6u];
  let t = fx.burn.z;
  // Every other moth keeps to the lantern when it is lit.
  let atLantern = (ii % 2u == 1u) && fx.lantern.w > 0.5;
  let c = select(fx.fire.xyz + vec3f(0.0, 0.2, 0.0), fx.lantern.xyz, atLantern);
  let rad = mix(fx.moths.y, fx.moths.z, rand(ii, 31u)) * select(1.0, 0.55, atLantern);
  let speed = mix(fx.moths2.z, fx.moths2.w, rand(ii, 32u));
  let a = rand(ii, 33u) * 6.2831853 + t * speed / rad * select(1.0, -1.0, rand(ii, 34u) < 0.5);
  // A loose, wobbling orbit: not a ring.
  let wob = valueNoise2(vec2f(t * 0.7, f32(ii) * 3.1), 171u) - 0.5;
  let h = mix(fx.moths2.x, fx.moths2.y, rand(ii, 35u)) * select(1.0, 0.25, atLantern) + wob * 0.4 + 0.15 * sin(t * 1.9 + f32(ii));
  let body = c + vec3f(cos(a) * rad * (1.0 + wob * 0.5), h, sin(a) * rad * (1.0 - wob * 0.4));
  let fwd = normalize(vec3f(-sin(a), 0.0, cos(a)));
  let side = vec3f(fwd.z, 0.0, -fwd.x);
  // Each wing hinged at the body, flapping up and down.
  let flap = sin(t * fx.mothAlb.w * 6.2831853 + f32(ii) * 1.7) * 1.1;
  let s = select(1.0, -1.0, wing == 1u);
  let span = (q.x * 0.5 + 0.5) * fx.moths.w;
  let wdir = normalize(side * s * cos(flap) + vec3f(0.0, sin(flap), 0.0));
  o.world = body + wdir * span + fwd * q.y * fx.moths.w * 0.45;
  o.pos = frame.viewProj * vec4f(o.world, 1.0);
  o.uv = vec2f(q.x * 0.5 + 0.5, q.y);
  o.on = select(0.0, 1.0, f32(ii) < fx.moths.x && fx.sparkLook.w > 0.5);
  if (o.on < 0.5) { o.pos = vec4f(0.0, 0.0, -1.0, 1.0); }
  return o;
}

@fragment
fn fsMoth(in: MothOut) -> @location(0) vec4f {
  // A rounded wing: wide near the body, tapering out.
  let d = length(vec2f(in.uv.x, in.uv.y * (1.2 - 0.5 * in.uv.x)));
  if (d > 1.0) { discard; }
  let direct = pointIllum(in.world, normalize(fx.fire.xyz - in.world + vec3f(0.0, 0.01, 0.0)), 0.6) + frame.moonIlluminance * 0.5;
  let radiance = fx.mothAlb.rgb * (direct / PI + skyAmbient(vec3f(0.0, 1.0, 0.0)));
  let viewDist = distance(in.world, frame.cameraPos);
  let color = applyAerial(radiance * frame.exposure, in.pos.xy * frame.invRenderSize, viewDist);
  return vec4f(color, 1.0);
}

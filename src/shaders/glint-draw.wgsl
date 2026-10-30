// Beach glints (src/world/glints.js; recipes/world/glints.json): a brief twinkle now and then on the
// things worth finding on the shore. Each glint is one small screen-facing quad drawn additively into
// the HDR, depth tested but not written, so the object or the ground in front hides it. Its light is
// physical: in each flash a small facet, tilted at random from up, reflects the sun and the moon
// toward the eye or not (a Blinn lobe about the half vector), so a glint depends on where you look from, is strong
// in sunlight, faint by moonlight and gone at night without a moon. The flash's timing and facet
// mirror flashAt() and facetAt() in glints.js. Radiance in linear HDR, pre-exposed; bloom spreads it.

// #include common
// #include lib-hash

struct GlintDraw {
  timing: vec4f,  // x, y the gap between chances (s, each glint's own between them), z one flash (s), w the share of chances that flash
  look: vec4f,    // x facet tilt (radians), y lobe sharpness, z size (px), w strength (radiance per lux of light caught)
  far: vec4f,     // x, y fade between these distances from the eye (m), z the rays' share of the core, w real seconds now
  timing2: vec4f, // x how far toward the eye it is drawn (m); yzw spare
};

struct Glint {
  at: vec4f,      // x, y, z (m), w its boost (1; a bottle more)
  seed: vec4u,    // x its seed
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var<uniform> gd: GlintDraw;
@group(2) @binding(1) var<storage, read> glints: array<Glint>;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) light: vec3f,
};

var<private> QUAD: array<vec2f, 6> = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
  vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

/** The flash now (0..1) and its chance (glints.js flashAt). */
fn flash(seed: u32) -> vec2f {
  let period = gd.timing.x + (gd.timing.y - gd.timing.x) * hashToFloat(hash2(vec2u(seed, 0u)));
  let tt = gd.far.w + period * hashToFloat(hash2(vec2u(seed, 1u)));
  let cycle = floor(tt / period);
  let local = tt - cycle * period;
  let on = hashToFloat(hash2(vec2u(seed, u32(cycle) + 2u))) < gd.timing.w;
  let s = sin(PI * local / gd.timing.z);
  return vec2f(select(0.0, s * s, on && local < gd.timing.z), cycle);
}

/** The facet a flash tilts, within the recipe's tilt of up (glints.js facetAt). */
fn facet(seed: u32, cycle: f32) -> vec3f {
  let h = hash2(vec2u(seed, u32(cycle) + 2u));
  let tilt = gd.look.x * sqrt(hashToFloat(hash2(vec2u(h, 1u))));
  let az = 2.0 * PI * hashToFloat(hash2(vec2u(h, 2u)));
  return vec3f(sin(tilt) * cos(az), cos(tilt), sin(tilt) * sin(az));
}

/** Light a facet n sends toward the eye (v) from a light at l with illuminance e: how near the facet
 *  is to the half vector between them (a Blinn lobe of the recipe's sharpness), only while the light is up. */
fn caught(n: vec3f, v: vec3f, l: vec3f, e: vec3f) -> vec3f {
  let h = normalize(l + v);
  return e * smoothstep(0.0, 0.05, l.y) * pow(max(dot(n, h), 0.0), gd.look.y);
}

@vertex
fn vsGlint(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VsOut {
  let g = glints[ii];
  var o: VsOut;
  o.uv = QUAD[vi];
  let f = flash(g.seed.x);
  let dist = distance(g.at.xyz, frame.cameraPos);
  let fade = 1.0 - smoothstep(gd.far.x, gd.far.y, dist);
  let v = (frame.cameraPos - g.at.xyz) / max(dist, 1e-4);
  let n = facet(g.seed.x, f.y);
  let light = (caught(n, v, frame.sunDir, frame.sunIlluminance) + caught(n, v, frame.moonDir, frame.moonIlluminance))
            * gd.look.w * g.at.w * f.x * fade * frame.exposure;
  o.light = light;
  // Nothing to draw between flashes: the quad folds away.
  if (max(light.r, max(light.g, light.b)) < 1e-4) { o.pos = vec4f(0.0, 0.0, -1.0, 1.0); return o; }
  // Drawn a little toward the eye, so its own object's surface never hides it.
  let clip = frame.viewProj * vec4f(g.at.xyz + v * gd.timing2.x, 1.0);
  let px = gd.look.z * (0.6 + 0.4 * f.x);
  o.pos = vec4f(clip.xy + o.uv * px * 2.0 * frame.invRenderSize * clip.w, clip.z, clip.w);
  return o;
}

@fragment
fn fsGlint(in: VsOut) -> @location(0) vec4f {
  // A bright core and four thin rays, like a point of sun on glass.
  let a = abs(in.uv);
  let core = exp(-dot(in.uv, in.uv) * 6.0);
  let rays = (exp(-a.x * 30.0) * (1.0 - a.y) + exp(-a.y * 30.0) * (1.0 - a.x)) * gd.far.z;
  let k = max(core + rays, 0.0);
  return vec4f(in.light * k, 0.0);
}

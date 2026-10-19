// Midges (S6b-5, docs 11, 12): tiny specks looping around their swarms' centres, one camera-facing
// quad each, no vertex buffer. Each midge's path is worked out from the time and its number (fn
// orbit, the same as orbit() in src/world/ecology/midge-paths.js), so the main thread knows where
// any midge is. Real size (2 to 4 mm, not enlarged): a midge smaller than a pixel or so fades
// instead of shrinking. Lit physically: a dark body under the sky and sun, plus a bright
// forward-scatter glint (Henyey-Greenstein) when the low sun is behind it; the palette paints last.

// #include common
// #include lib-hash
// #include lighting-bindings
// #include lib-sky
// #include lib-lighting

struct MidgeDraw {
  shape: vec4f,   // x, y orbit radius range (m); z, w height range over the ground or water (m)
  speed: vec4f,   // x, y turns a second range; z, w body size range (m)
  look: vec4f,    // xyz body albedo (linear), w glint strength
  misc: vec4f,    // x glint g, y least width (px), z swarms, w time (s)
};

// A swarm: c = (centre x, ground or water height, centre z, bob), b = (dip phase 0..1 or -1, spare...),
// k = (seed, first midge, midges, the midge dipping).
struct Swarm {
  c: vec4f,
  b: vec4f,
  k: vec4u,
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var<uniform> md: MidgeDraw;
@group(2) @binding(1) var<storage, read> swarms: array<Swarm>;

/** A midge's offset from its swarm's centre at time t (the JS orbit() is the same). */
fn orbit(seed: u32, i: u32, t: f32) -> vec3f {
  let h0 = hash3(vec3u(seed, i, 0u));
  let h1 = hash3(vec3u(seed, i, 1u));
  let h2 = hash3(vec3u(seed, i, 2u));
  let h3 = hash3(vec3u(seed, i, 3u));
  let r = mix(md.shape.x, md.shape.y, sqrt(hashToFloat(h0)));
  let y = mix(md.shape.z, md.shape.w, hashToFloat(h1));
  let w = 6.2831853 * mix(md.speed.x, md.speed.y, hashToFloat(h2));
  let p = hashToFloat(h3) * 6.2831853;
  let dir = select(-1.0, 1.0, (h0 & 1u) == 1u);
  return vec3f(
    r * (cos(dir * w * t + p) + 0.35 * sin(w * 1.37 * t + 2.1 * p)),
    y + 0.06 * sin(w * 0.71 * t + 3.3 * p),
    r * (0.8 * sin(dir * w * t + p) + 0.35 * cos(w * 1.61 * t + 1.3 * p)));
}

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) world: vec3f,
  @location(2) fade: f32,
};

var<private> QUAD: array<vec2f, 6> = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
  vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

@vertex
fn vsMidge(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VsOut {
  var o: VsOut;
  o.pos = vec4f(0.0, 0.0, -2.0, 1.0);   // dropped unless a swarm owns this midge
  o.uv = vec2f(0.0); o.world = vec3f(0.0); o.fade = 0.0;
  let n = u32(md.misc.z);
  for (var s = 0u; s < n; s++) {
    let sw = swarms[s];
    if (ii < sw.k.y || ii >= sw.k.y + sw.k.z) { continue; }
    let i = ii - sw.k.y;
    let t = md.misc.w;
    let off = orbit(sw.k.x, i, t);
    var p = vec3f(sw.c.x + off.x, sw.c.y + sw.c.w + off.y, sw.c.z + off.z);
    // The one dipping down to touch the water, and back up.
    if (i == sw.k.w && sw.b.x >= 0.0) { p.y = mix(p.y, sw.c.y + 0.01, sin(3.14159265 * sw.b.x)); }
    let size = mix(md.speed.z, md.speed.w, hashToFloat(hash3(vec3u(sw.k.x, i, 4u))));
    let clip = frame.viewProj * vec4f(p, 1.0);
    if (clip.w <= 0.0) { return o; }
    // Half-size in NDC: the real size, but at least half the least width; the shortfall fades it.
    let realY = size * frame.proj[1][1] / clip.w;
    let realX = size * frame.proj[0][0] / clip.w;
    let minY = md.misc.y / frame.renderSize.y;
    let minX = md.misc.y / frame.renderSize.x;
    let hy = max(realY, minY);
    let hx = max(realX, minX);
    let q = QUAD[vi];
    o.pos = vec4f(clip.xy + q * vec2f(hx, hy) * clip.w, clip.z, clip.w);
    o.uv = q;
    o.world = p;
    o.fade = clamp((realY / hy) * (realY / hy), 0.0, 1.0);
    return o;
  }
  return o;
}

@fragment
fn fsMidge(in: VsOut) -> @location(0) vec4f {
  let r = length(in.uv);
  let alpha = (1.0 - smoothstep(0.45, 1.0, r)) * in.fade;
  if (alpha <= 0.002) { discard; }
  let viewDist = distance(in.world, frame.cameraPos);
  let toMidge = (in.world - frame.cameraPos) / max(viewDist, 1e-4);
  // The body: dark, lit by the sky and, roughly, by the sun.
  let body = md.look.xyz * (skyAmbient(vec3f(0.0, 1.0, 0.0)) + frame.sunIlluminance * max(frame.sunDir.y, 0.0) * 0.5 / PI);
  // The glint: sunlight scattered forward through the wings, strongest with the sun behind it.
  let g = md.misc.x;
  let cosT = dot(toMidge, frame.sunDir);
  let hg = (1.0 - g * g) / (4.0 * PI * pow(max(1.0 + g * g - 2.0 * g * cosT, 1e-4), 1.5));
  let glint = frame.sunIlluminance * hg * md.look.w * step(0.0, frame.sunDir.y);
  let color = applyAerial((body + glint) * frame.exposure, in.pos.xy * frame.invRenderSize, viewDist);
  let safe = select(vec3f(0.0), color, color == color);
  return vec4f(max(safe, vec3f(0.0)) * alpha, alpha);
}

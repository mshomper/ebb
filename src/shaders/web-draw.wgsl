// Dewy orb webs (autumn, doc 13; src/world/finds/autumn.js): each web is spun here from its seed, with
// no vertex buffer: spokes from the hub, a capture spiral round them, the frame round the rim, a few
// anchor threads out to the grass, a string of dew beads on each spiral thread and a garden spider at
// the hub. Threads are screen-space strips, beads and the spider small camera-facing quads; anything
// thinner than the least width (look.z, pixels) is drawn at that width and fainter instead, so a far
// web dims rather than shimmers. Lit physically into the HDR, the palette painting last: a thread
// throws the bright arc of a lit fibre (a glint on the cone round its length that mirrors the sun),
// a bead mirrors the sun to every side and, with the sun behind it, throws it forward strongly
// (Henyey-Greenstein), and both catch the sky. Dew is how wet the web is: no dew, nothing drawn.

// #include common
// #include lib-hash
// #include lighting-bindings
// #include lib-sky
// #include lib-lighting

struct WebDraw {
  shape: vec4f,   // x spokes, y spiral rounds, z hub share of the radius, w beads per spiral thread
  look: vec4f,    // x thread width (m), y bead radius at full dew (m), z least width (px), w anchor threads
  silk: vec4f,    // xyz silk albedo (linear), w glint strength
  bead: vec4f,    // x reflect, y forward, z forward g, w sky
  misc: vec4f,    // x webs, y time (s), z sway (m), w twinkle
  spider: vec4f,  // xyz spider albedo (linear), w spider size (m)
  more: vec4f,    // x glint exponent, yzw spare
};

// A web: at = (hub x, hub y, hub z, yaw), b = (radius, dew 0..1, spare, spare), k = (seed, ...).
struct Web {
  at: vec4f,
  b: vec4f,
  k: vec4u,
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var<uniform> wd: WebDraw;
@group(2) @binding(1) var<storage, read> webs: array<Web>;

const TAU: f32 = 6.2831853;

fn h01(seed: u32, a: u32, b: u32) -> f32 { return hashToFloat(hash3(vec3u(seed, a, b))); }

/** Spoke k's angle and its length as a share of the radius (irregular, as a real web's are). */
fn spoke(seed: u32, k: u32) -> vec2f {
  let K = u32(wd.shape.x);
  let kk = k % K;
  let turns = f32(k / K);
  let a = TAU * (f32(kk) + 0.35 * (h01(seed, kk, 1u) - 0.5)) / f32(K) + TAU * turns;
  // A real orb sits a little lower than wide: spokes pointing down reach further.
  return vec2f(a, (0.84 + 0.18 * h01(seed, kk, 2u)) * (1.0 - 0.1 * sin(a)));
}

/** A point in the web's plane (meters from the hub): share f out along spoke k. */
fn onSpoke(seed: u32, k: u32, f: f32, r: f32) -> vec2f {
  let s = spoke(seed, k);
  return vec2f(cos(s.x), sin(s.x)) * s.y * f * r;
}

/** How far out round i of the capture spiral is at spoke k (k may run to K: the next round's start). */
fn spiralF(i: u32, k: u32) -> f32 {
  let hub = wd.shape.z;
  return hub + (1.0 - hub) * 0.94 * (f32(i) + f32(k) / wd.shape.x) / wd.shape.y;
}

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) world: vec3f,
  @location(2) tangent: vec3f,
  @location(3) fade: f32,
  @location(4) @interpolate(flat) kind: u32,    // 0 thread, 1 bead, 2 spider
  @location(5) @interpolate(flat) glow: f32,    // a bead's twinkle now
};

var<private> STRIP: array<vec2f, 6> = array<vec2f, 6>(
  vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(0.0, 1.0),
  vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
var<private> QUAD: array<vec2f, 6> = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
  vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

/** The web's plane point in the world, billowing a little in the air. */
fn place(w: Web, q: vec2f) -> vec3f {
  let c = cos(w.at.w);
  let s = sin(w.at.w);
  let right = vec3f(c, 0.0, -s);
  let out = vec3f(s, 0.0, c);
  let r = w.b.x;
  let seedF = f32(w.k.x & 1023u) / 1023.0;
  let t = wd.misc.y;
  let billow = wd.misc.z * (sin(t * 0.9 + seedF * TAU) + 0.4 * sin(t * 2.3 + seedF * 17.0)) * (1.0 - 0.6 * min(1.0, dot(q, q) / (r * r)));
  return w.at.xyz + right * q.x + vec3f(0.0, q.y, 0.0) + out * billow;
}

/** A thread from a to b (web plane, meters) as a strip at least the least width across. */
fn threadVertex(w: Web, a: vec2f, b: vec2f, corner: u32) -> VsOut {
  var o: VsOut;
  o.pos = vec4f(0.0, 0.0, -2.0, 1.0);
  o.kind = 0u;
  o.glow = 0.0;
  let pa = place(w, a);
  let pb = place(w, b);
  let ca = frame.viewProj * vec4f(pa, 1.0);
  let cb = frame.viewProj * vec4f(pb, 1.0);
  if (ca.w <= 1e-3 || cb.w <= 1e-3) { o.fade = 0.0; return o; }
  let st = STRIP[corner];
  let c = mix(ca, cb, st.x);
  let sa = ca.xy / ca.w;
  let sb = cb.xy / cb.w;
  var dir = (sb - sa) * frame.renderSize;
  dir = dir / max(length(dir), 1e-5);
  let perp = vec2f(-dir.y, dir.x);
  // The thread's own width in pixels here, and the width it is drawn at.
  let realPx = wd.look.x * frame.proj[1][1] / c.w * frame.renderSize.y * 0.5;
  let drawn = max(realPx, wd.look.z);
  let off = perp * st.y * drawn / frame.renderSize;
  o.pos = vec4f(c.xy + off * c.w, c.z, c.w);
  o.uv = vec2f(st.x, st.y);
  o.world = mix(pa, pb, st.x);
  o.tangent = normalize(pb - pa + vec3f(0.0, 1e-7, 0.0));
  o.fade = clamp(realPx / drawn, 0.0, 1.0) * smoothstep(0.0, 0.2, w.b.y);
  return o;
}

/** A bead or the spider: a round quad at least the least width across. */
fn dotVertex(w: Web, q: vec2f, radius: f32, corner: u32, kind: u32) -> VsOut {
  var o: VsOut;
  o.pos = vec4f(0.0, 0.0, -2.0, 1.0);
  o.kind = kind;
  o.glow = 0.0;
  o.tangent = vec3f(0.0, 1.0, 0.0);
  let p = place(w, q);
  let clip = frame.viewProj * vec4f(p, 1.0);
  if (clip.w <= 1e-3 || radius <= 0.0) { o.fade = 0.0; return o; }
  let realY = radius * frame.proj[1][1] / clip.w;
  let realX = radius * frame.proj[0][0] / clip.w;
  let hy = max(realY, wd.look.z / frame.renderSize.y);
  let hx = max(realX, wd.look.z / frame.renderSize.x);
  let c = QUAD[corner];
  o.pos = vec4f(clip.xy + c * vec2f(hx, hy) * clip.w, clip.z, clip.w);
  o.uv = c;
  o.world = p;
  // Smaller than the least width: fainter in step with its area, not smaller.
  let k = clamp(realY / hy, 0.0, 1.0);
  o.fade = k * k;
  return o;
}

@vertex
fn vsWeb(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VsOut {
  let w = webs[ii];
  let seed = w.k.x;
  let r = w.b.x;
  let dew = w.b.y;
  let K = u32(wd.shape.x);
  let R = u32(wd.shape.y);
  let B = u32(wd.shape.w);
  let A = u32(wd.look.w);
  let q = vi / 6u;
  let corner = vi % 6u;
  // Spokes, then the spiral, then the frame, then the anchors; then the beads; then the spider.
  if (q < K) {
    return threadVertex(w, onSpoke(seed, q, wd.shape.z * 0.35, r), onSpoke(seed, q, 1.0, r), corner);
  }
  var n = q - K;
  if (n < R * K) {
    let i = n / K;
    let k = n % K;
    return threadVertex(w, onSpoke(seed, k, spiralF(i, k), r), onSpoke(seed, k + 1u, spiralF(i, k + 1u), r), corner);
  }
  n -= R * K;
  if (n < K) {
    return threadVertex(w, onSpoke(seed, n, 1.0, r), onSpoke(seed, n + 1u, 1.0, r), corner);
  }
  n -= K;
  if (n < A) {
    let k = hash3(vec3u(seed, n, 7u)) % K;
    let end = onSpoke(seed, k, 1.0, r);
    return threadVertex(w, end, end * (1.5 + 0.7 * h01(seed, n, 8u)) + vec2f(0.0, -0.3 * r), corner);
  }
  n -= A;
  if (n < R * K * B) {
    let j = n / B;
    let b = n % B;
    let i = j / K;
    let k = j % K;
    let hb = hash3(vec3u(seed, n, 11u));
    // More beads with more dew; each a little bigger as it gathers.
    if (hashToFloat(hb) > dew * 1.05) { var o: VsOut; o.pos = vec4f(0.0, 0.0, -2.0, 1.0); o.fade = 0.0; o.kind = 1u; return o; }
    let a = onSpoke(seed, k, spiralF(i, k), r);
    let c = onSpoke(seed, k + 1u, spiralF(i, k + 1u), r);
    let s = (f32(b) + 0.2 + 0.6 * hashToFloat(hash3(vec3u(seed, n, 12u)))) / f32(B);
    let size = wd.look.y * (0.55 + 0.9 * hashToFloat(hash3(vec3u(seed, n, 13u)))) * sqrt(max(dew, 0.0));
    var o = dotVertex(w, mix(a, c, s), size, corner, 1u);
    // Each bead flickers a little as the web stirs.
    o.glow = 1.0 + wd.misc.w * sin(wd.misc.y * (1.7 + 2.0 * hashToFloat(hb >> 3u)) + hashToFloat(hb >> 7u) * TAU);
    return o;
  }
  return dotVertex(w, vec2f(0.0, 0.0), wd.spider.w * 0.5, corner, 2u);
}

/** Henyey-Greenstein phase: how much light is scattered at cosine cosT from where it was going. */
fn phaseHG(cosT: f32, g: f32) -> f32 {
  return (1.0 - g * g) / (4.0 * PI * pow(max(1.0 + g * g - 2.0 * g * cosT, 1e-4), 1.5));
}

@fragment
fn fsWeb(in: VsOut) -> @location(0) vec4f {
  var alpha = in.fade;
  if (in.kind != 0u) { alpha *= 1.0 - smoothstep(0.55, 1.0, length(in.uv)); }
  else { alpha *= 1.0 - smoothstep(0.4, 1.0, abs(in.uv.y)); }
  if (alpha <= 0.001) { discard; }
  let viewDist = distance(in.world, frame.cameraPos);
  let v = (frame.cameraPos - in.world) / max(viewDist, 1e-4);
  let up = vec3f(0.0, 1.0, 0.0);
  let sunVis = shadowVisibility(in.world, up, viewDist, in.pos.xy) * step(0.0, frame.sunDir.y);
  let sun = frame.sunIlluminance * sunVis;
  let sky = skyAmbient(up);
  var radiance = vec3f(0.0);
  if (in.kind == 0u) {
    // A lit fibre: the glint lies on the cone round the thread that mirrors the sun into the eye.
    let tl = dot(in.tangent, frame.sunDir);
    let tv = dot(in.tangent, v);
    let cone = max(sqrt(max(1.0 - tl * tl, 0.0)) * sqrt(max(1.0 - tv * tv, 0.0)) - tl * tv, 0.0);
    radiance = wd.silk.xyz * (sky + sun * 0.5 / PI) + wd.silk.w * sun * pow(cone, wd.more.x);
  } else if (in.kind == 1u) {
    // A dew bead: the sun mirrored to every side, thrown forward strongly with the sun behind it, and the sky.
    // The scattering angle: from the sunlight's way (away from the sun) to the way toward the eye.
    let cosT = dot(-frame.sunDir, v);
    radiance = sun * (wd.bead.x / (4.0 * PI) + wd.bead.y * phaseHG(cosT, wd.bead.z)) * max(in.glow, 0.0) + sky * wd.bead.w;
  } else {
    radiance = wd.spider.xyz * (sky + sun * 0.4 / PI);
  }
  let color = applyAerial(radiance * frame.exposure, in.pos.xy * frame.invRenderSize, viewDist);
  let safe = select(vec3f(0.0), color, color == color);
  return vec4f(max(safe, vec3f(0.0)) * alpha, alpha);
}

// Footprints (doc 23, W6): the walker's boot prints in sand and mud, drawn after the land and before
// the water as soft darkenings multiplied into what the ground already shows (compressed, damp sand
// reads darker), like the creatures' contact shadow. Each print is a small quad following the ground
// under its four corners, shaped as a sole: a heel and a forefoot, with faint tread lines.

// #include common

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
// Three vec4f per print: (x, z, yaw, side), (strength, sole width, sole length, spare), (ground height at the four corners).
@group(1) @binding(0) var<storage, read> prints: array<vec4f>;

struct Out {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,       // metres across (x) and along (y) the sole
  @location(1) @interpolate(flat) look: vec3f,   // strength, side, sole length
};

var<private> CORNER: array<vec2f, 6> = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
  vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

@vertex
fn vsPrint(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> Out {
  let a = prints[ii * 3u];
  let b = prints[ii * 3u + 1u];
  let h = prints[ii * 3u + 2u];
  let q = CORNER[vi];
  let half = vec2f(b.y * 0.65, b.z * 0.6);
  let local = q * half;
  let fwd = vec2f(sin(a.z), cos(a.z));
  let right = vec2f(fwd.y, -fwd.x);
  // The sole sits a little ahead of the ankle.
  let centre = a.xy + fwd * b.z * 0.28;
  let xz = centre + right * local.x + fwd * local.y;
  // Corner heights: (-,-), (+,-), (-,+), (+,+) across and along.
  let k = select(0u, 1u, q.x > 0.0) + select(0u, 2u, q.y > 0.0);
  let y = h[k] + 0.012;
  var o: Out;
  o.pos = frame.viewProj * vec4f(xz.x, y, xz.y, 1.0);
  o.local = local;
  o.look = vec3f(b.x, a.w, b.z);
  return o;
}

/** A soft ellipse: 1 inside, 0 outside, with an edge of `soft` (in radii). */
fn blob(p: vec2f, c: vec2f, r: vec2f, soft: f32) -> f32 {
  let d = length((p - c) / r);
  return 1.0 - smoothstep(1.0 - soft, 1.0 + soft, d);
}

@fragment
fn fsPrint(in: Out) -> @location(0) vec4f {
  let L = in.look.z;
  let p = vec2f(in.local.x * in.look.y, in.local.y);   // mirrored for the right foot
  let heel = blob(p, vec2f(-0.004, -0.26 * L), vec2f(0.04, 0.22 * L), 0.25);
  let ball = blob(p, vec2f(0.006, 0.1 * L), vec2f(0.048, 0.32 * L), 0.22);
  // The waist between them, narrower, so heel and ball read as one sole.
  let waist = blob(p, vec2f(0.0, -0.08 * L), vec2f(0.032, 0.18 * L), 0.3) * 0.85;
  let sole = max(max(heel, ball), waist);
  // Tread: faint ridges across the sole; the pressed edge a touch darker than the middle.
  let tread = 0.8 + 0.2 * smoothstep(-0.2, 0.2, sin(p.y * 160.0));
  let rim = 1.0 + 0.35 * smoothstep(0.35, 0.9, sole) * (1.0 - smoothstep(0.9, 1.0, sole));
  let dark = clamp(in.look.x * sole * tread * rim, 0.0, 0.9);
  return vec4f(vec3f(1.0 - dark), 1.0);
}

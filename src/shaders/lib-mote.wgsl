// The soot mote (H2, doc 16; Matt's model, October 27, 2026): a swarm thing with no bones, so its
// motion is drawn here, per instance (CLAUDE.md, the creature rule: swarms may use shader motion).
// Each mote carries where it is and which way it faces, the way it is moving and how far that
// stretches it, how much it is squashed (bunching up for its tell, or the nip), its seeded phase,
// and its eyes' state; the shader adds a slow bob, a turn this way and that, a breathing swell out
// of step across its lumps, and a quiver while it winds up. The eyes are drawn from Matt's eye discs
// (placed in assets/models/hollow/mote.glb): pale ovals that blink, open wider when a light hits,
// and squint as it winds up to nip. Numbers: recipes/world/hollow.json foes.motes.mote. Shared by the
// arena's mote pass and, later, the game's.

struct Mote {
  at: vec4f,    // x, y, z (world m, its middle), yaw (its facing, +z turned by yaw)
  way: vec4f,   // xyz the way it moves (world, unit or zero), w how far that stretches it (0 none)
  shape: vec4f, // x squash (0 none), y its seeded phase (rad), z scale (model m to world m), w quiver (m)
  eye: vec4f,   // x lids (0 open, 1 shut), y widen (0..1), z squint (0..1), w glow (0..1)
};

struct MoteLook {
  drift: vec4f,  // x bobM, y bobHz, z turn (rad), w turnHz
  drift2: vec4f, // x breath (a share), y breathHz, z quiverHz, w the clock (s)
  albedo: vec4f, // rgb soot (linear), w fuzz
  eyeTint: vec4f, // rgb the eyes (linear), w glow (cd/m2)
  eyeL: vec4f,   // the left eye (+x): middle (model m), w radius (m)
  axisL: vec4f,  // its axis (model, unit), w widen (how much wider)
  eyeR: vec4f,
  axisR: vec4f,  // w squint (how far the lids close)
};

struct MoteVert { world: vec3f, n: vec3f };

const TAU = 6.2831853;

/** A vertex of a mote, placed and moved. p, n: the model's (m, unit). */
fn moteDeform(p0: vec3f, n0: vec3f, m: Mote, L: MoteLook) -> MoteVert {
  let t = L.drift2.w;
  let ph = m.shape.y;
  // Breathing: its lumps swell and settle a little, out of step across the body.
  let swell = 1.0 + L.drift2.x * sin(t * L.drift2.y * TAU + ph + dot(p0 / max(length(p0), 1e-5), vec3f(2.1, 1.3, 1.7)) * 1.5);
  var p = p0 * m.shape.z * swell;
  var n = n0;
  // Its facing, turning this way and that as it drifts.
  let yaw = m.at.w + L.drift.z * sin(t * L.drift.w * TAU + ph * 1.7);
  let c = cos(yaw); let s = sin(yaw);
  p = vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  n = vec3f(c * n.x + s * n.z, n.y, -s * n.x + c * n.z);
  // Squashed (bunching up, a nip): flatter and wider, keeping its volume.
  let sy = 1.0 - clamp(m.shape.x, 0.0, 0.8);
  let sxz = inverseSqrt(sy);
  p = p * vec3f(sxz, sy, sxz);
  n = n / vec3f(sxz, sy, sxz);
  // Stretched along the way it darts, thinner across.
  let v = m.way.xyz;
  let st = 1.0 + max(m.way.w, 0.0);
  let across = inverseSqrt(st);
  p = across * p + (st - across) * v * dot(v, p);
  n = n / across + (1.0 / st - 1.0 / across) * v * dot(v, n);
  // A slow bob, and a quiver while it winds up.
  let bob = L.drift.x * sin(t * L.drift.y * TAU + ph);
  let q = L.drift2.z * TAU * t;
  let quiver = m.shape.w * vec3f(sin(q + ph * 3.0), sin(q * 1.31 + ph), cos(q * 0.87 + ph * 2.0));
  var o: MoteVert;
  o.world = m.at.xyz + p + vec3f(0.0, bob, 0.0) + quiver;
  o.n = normalize(n + vec3f(0.0, 1e-6, 0.0));
  return o;
}

/** One eye's cover (0..1) at a model point p: an oval round its axis, lids from above, a squint from both. */
fn moteEye(p: vec3f, e: vec4f, axis: vec3f, m: Mote, widenBy: f32, squintBy: f32) -> f32 {
  let d = p - e.xyz;
  let h = dot(d, axis);
  let side = normalize(cross(vec3f(0.0, 1.0, 0.0), axis));
  let up = cross(axis, side);
  let widen = m.eye.y * widenBy;
  // Wider open: bigger and rounder.
  var q = vec2f(dot(d, side), dot(d, up)) / (e.w * vec2f(1.0 + widen * 1.15, 1.0 + widen));
  // The lids: a blink comes down from above; a squint closes from above and a little from below.
  let squint = m.eye.z * squintBy;
  let top = 1.0 - 2.0 * max(m.eye.x, squint);
  let bottom = -1.0 + squint * 0.6;
  let dist = max(length(q) - 1.0, max(q.y - top, bottom - q.y));
  let w = max(fwidth(dist), 1e-4);
  // Only on the face round the socket, never through to the back.
  return (1.0 - smoothstep(-w, w, dist)) * step(-e.w * 1.2, h) * step(h, e.w * 2.0);
}

/** Both eyes' cover at a model point. */
fn moteEyes(p: vec3f, m: Mote, L: MoteLook) -> f32 {
  // Worked out everywhere (fwidth needs every pixel to take part).
  let a = moteEye(p, L.eyeL, L.axisL.xyz, m, L.axisL.w, L.axisR.w);
  let b = moteEye(p, L.eyeR, L.axisR.xyz, m, L.axisL.w, L.axisR.w);
  return max(a, b);
}

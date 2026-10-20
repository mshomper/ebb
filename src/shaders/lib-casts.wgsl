// Lugworm casts (docs/future/11): a coil of worked sand the worm leaves on the wet flats, drawn into
// the ground itself as a height (its slope bends the normal) and a tone, with the small dip of the
// burrow's other end beside it. No mesh: a cast is part of the sand. Up to 16 casts near the view
// come from world/finds/index.js each frame, as (x, z, size, yaw).

struct CastShape {
  radius: f32,   // the coil's outer radius (m) at size 1
  tube: f32,     // the coil's tube radius (m)
  turns: f32,    // turns from the outside in
  rise: f32,     // how much higher the inner turns sit (m)
};

struct CastHit {
  h: f32,        // height above the sand (m), the dip below 0
  grad: vec2f,   // dh/dx, dh/dz
  cover: f32,    // 0..1, how much of this point is cast
  tone: f32,     // 0 deep in a groove, 1 on a crest (the grooves between turns hold shadow and wet)
};

// Height of one cast at a point in its own frame (m, unscaled), from the spiral's nearest turn. The
// tube is lumpy along its length, the way squeezed sand is.
fn castHeight(q: vec2f, S: CastShape, seed: u32) -> f32 {
  let rho = length(q);
  let th = atan2(q.y, q.x) + 3.14159265;
  var h = 0.0;
  let span = S.turns * 6.2831853;
  for (var k = 0; k < 4; k++) {
    let a = th + f32(k) * 6.2831853;
    if (a > span) { break; }
    let t = a / span;
    // The coil wanders: its radius swells and pinches along its length, so turns touch in places
    // and part in others, a heap of squeezed sand rather than neat rings.
    let wander = 1.0 + 0.35 * (valueNoise2(vec2f(a * 0.8, 3.1), seed + 7u) - 0.5) * 2.0;
    let r = S.radius * (1.0 - 0.7 * t) * wander;
    let lump = 0.7 + 0.6 * valueNoise2(vec2f(a * 2.3, 0.5), seed);
    let tube = S.tube * lump * (1.0 - 0.2 * t);
    let d = abs(rho - r);
    // Inner turns sit up on the outer ones: the pile is highest in the middle.
    if (d < tube) { h = max(h, sqrt(tube * tube - d * d) * 0.85 + S.rise * t); }
  }
  // The middle, where the last of the coil lies heaped: a rounded dome.
  let m = max(0.0, 1.0 - rho / (S.radius * 0.3));
  h = max(h, (S.tube * 0.9 + S.rise) * sqrt(m));
  // The burrow's mouth: a shallow dip a little way off.
  let dq = q - vec2f(S.radius * 3.2, 0.0);
  let dip = max(0.0, 1.0 - length(dq) / (S.radius * 0.5));
  return h - S.tube * 0.8 * dip * dip;
}

// The casts at a point: height, its gradient (for the normal), and cover. pixM: world size of a pixel.
fn lugCasts(xz: vec2f, casts: array<vec4f, 16>, S: CastShape, seed: u32, pixM: f32) -> CastHit {
  var hit: CastHit;
  hit.h = 0.0; hit.grad = vec2f(0.0); hit.cover = 0.0; hit.tone = 1.0;
  for (var i = 0u; i < 16u; i++) {
    let c = casts[i];
    if (c.z <= 0.0) { break; }
    let reach = S.radius * c.z * 4.0;
    let off = xz - c.xy;
    if (dot(off, off) > reach * reach) { continue; }
    // Into the cast's frame: turned by its yaw, shrunk by its size.
    let cs = cos(c.w); let sn = sin(c.w);
    let toLocal = mat2x2f(cs, -sn, sn, cs) * (1.0 / c.z);
    let e = max(pixM, 0.0006);
    let q = toLocal * off;
    let h0 = castHeight(q, S, seed + i) * c.z;
    let hx = castHeight(toLocal * (off + vec2f(e, 0.0)), S, seed + i) * c.z;
    let hz = castHeight(toLocal * (off + vec2f(0.0, e)), S, seed + i) * c.z;
    if (abs(h0) > abs(hit.h)) {
      hit.h = h0;
      hit.grad = vec2f(hx - h0, hz - h0) / e;
      hit.cover = smoothstep(0.0, S.tube * c.z * 0.3, h0);
      // Against the height of the pile here, low means a groove between turns.
      let rho = length(q) / S.radius;
      let crest = (S.tube * 0.85 + S.rise * clamp(1.0 - rho, 0.0, 1.0)) * c.z;
      hit.tone = smoothstep(0.35, 0.95, h0 / max(crest, 1e-5));
    }
  }
  return hit;
}

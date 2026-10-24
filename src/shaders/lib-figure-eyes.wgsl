// The walker's eyes (doc 23, W5): two cream ovals drawn on the front of the head from its rest-pose
// position, so they ride the head as it turns. Lids come down from the top (a blink, sleepy), the
// ovals morph into soft upturned arcs (happy), grow rounder (surprised), and one can be a touch taller
// (curious), and both shift a little ahead of a turn of the head (look.js). Shared by figure-draw.wgsl and the tools page. Numbers: recipes/world/figure.json eyes.

struct FigureEyes {
  geo: vec4f,     // x centre between the eyes, y height, z half spacing, w front (rest z past which the face is)
  size: vec4f,    // x, y radii (m), z glow after dark (cd/m2), w the head bone
  albedo: vec4f,  // rgb linear cream
  state: vec4f,   // x lid left, y lid right (0 open, 1 shut), z happy, w round
  state2: vec4f,  // x size left, y size right, z w the look's shift across the face (m: x left, y up)
};

/** One eye's coverage (0..1) at rest-pose point p (x, y). side 1: the walker's left (+x). */
fn figureEye(p: vec2f, e: FigureEyes, side: f32) -> f32 {
  // The eyes lead a turn of the head: both shift a little across the face toward where it is going.
  let c = vec2f(e.geo.x + side * e.geo.z, e.geo.y) + e.state2.zw;
  let grow = select(e.state2.y, e.state2.x, side > 0.0);
  let round = e.state.w;
  let r = e.size.xy * vec2f(1.0 + 0.3 * round, grow * (1.0 - 0.25 * round));
  let q = (p - c) / r;
  // The oval as a signed distance in radii, cut from the top by its lid.
  let lid = select(e.state.y, e.state.x, side > 0.0);
  let oval = max(length(q) - 1.0, q.y - (1.0 - 2.0 * lid));
  // The happy arc: a band on an upturned curve.
  let qa = q - vec2f(0.0, -0.55);
  let arc = max(abs(length(qa * vec2f(1.0, 1.2)) - 0.78) - 0.2, -(qa.y + 0.1));
  let d = mix(oval, arc, e.state.z);
  let w = max(fwidth(d), 1e-4);
  return 1.0 - smoothstep(-w, w, d);
}

/** Both eyes' coverage at a rest-pose point, only on the front of the head. */
fn figureEyes(rest: vec3f, headWeight: f32, e: FigureEyes) -> f32 {
  // Worked out everywhere (fwidth needs every pixel to take part), kept only on the face.
  let both = max(figureEye(rest.xy, e, 1.0), figureEye(rest.xy, e, -1.0));
  return both * step(e.geo.w, rest.z) * step(0.5, headWeight);
}

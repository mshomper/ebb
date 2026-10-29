// The hen-feather hat band (docs/future/15 slice 2b; figure.json hatBand): a band of barred brown
// tail feathers painted round the crown of the walker's hat, in the rest pose, so it rides the hat.
// Shared by the figure (figure-draw.wgsl) and the Walker page's portrait (portrait-draw.wgsl).

struct FigureHatBand {
  span: vec4f,     // x on (0 or 1), y the band's foot, z its top (rest m, y up), w painted only this far out from the crown's axis
  crown: vec4f,    // xy the crown's axis (rest x, z), z feathers round the crown, w how dark the bars are (a share of the colour)
  colour: vec4f,   // rgb linear albedo of the feathers, w how much lighter the quill is
};

/** The band's colour at rest-pose point p (rgb) and how much of it covers there (w, 0..1). */
fn figureHatBand(p: vec3f, b: FigureHatBand) -> vec4f {
  let rel = p.xz - b.crown.xy;
  let r = length(rel);
  // Soft top and foot, a pixel wide; no early return (fwidth needs every fragment of the quad).
  let w = max(fwidth(p.y), 1e-4);
  let inY = smoothstep(b.span.y - w, b.span.y + w, p.y) * (1.0 - smoothstep(b.span.z - w, b.span.z + w, p.y));
  let cover = select(0.0, 1.0, b.span.x > 0.5 && r > b.span.w) * inY;
  let v = clamp((p.y - b.span.y) / max(b.span.z - b.span.y, 1e-4), 0.0, 1.0);
  // Feathers laid round the crown, each slanting as it rises, their tips overlapping the next.
  let a = atan2(rel.x, rel.y) / 6.2831853 + 0.5;
  let s = fract(a * b.crown.z + v * 0.45);
  // Dark bars across each feather (a barred hen's tail), the quill a light line down its middle,
  // and each feather's edge a little darker where it tucks under the next.
  let bar = smoothstep(0.35, 0.5, fract(v * 2.6 + s * 0.35)) * (1.0 - smoothstep(0.85, 1.0, fract(v * 2.6 + s * 0.35)));
  let quill = 1.0 - smoothstep(0.02, 0.06, abs(s - 0.5));
  let edge = smoothstep(0.75, 1.0, s);
  var c = b.colour.rgb * mix(1.0, b.crown.w, bar) * mix(1.0, 0.7, edge);
  c = mix(c, b.colour.rgb * b.colour.w, quill * 0.8);
  return vec4f(c, cover);
}

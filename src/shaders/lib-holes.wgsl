// Holes the walker dug (docs/future/13 10.8.1, P2c; src/world/dig/draw.js holeMarks). The land's
// height never changes for a hole: its mouth is drawn into the ground itself, as the lugworm casts
// are (lib-casts.wgsl), a bowl that bends the normal inward with walls of the deepest layer's earth
// going dark toward the middle, and a ring of darker fresh-turned soil round it that fades after the
// hole has closed. A seep pool is a wall colour of wet dark water. Up to 16 holes near the view, two
// vec4s each: (x, z, radius, mouth darkness 0..1) and (wall rgb linear, fresh soil darkening 0..1).
// An ash patch spread on the ground (P2i; src/world/gather/ashes.js ashMarks) shares the list after
// the holes, its mouth darkness negative: a soft pale wash of wood ash (rgb) as strong as -w, with
// a ragged edge and no bowl.

struct HoleHit {
  albedo: vec3f,   // the ground's albedo with the hole drawn over it
  grad: vec2f,     // added slope (dh/dx, dh/dz): the bowl's walls
  cover: f32,      // 0..1, how much of this point is the hole's mouth
};

// The holes at a point over the ground's own albedo. ringM: how far the fresh soil reaches past the rim.
fn dugHoles(xz: vec2f, base: vec3f, holes: array<vec4f, 32>, ringM: f32) -> HoleHit {
  var hit: HoleHit;
  hit.albedo = base; hit.grad = vec2f(0.0); hit.cover = 0.0;
  for (var i = 0u; i < 16u; i++) {
    let a = holes[i * 2u];
    if (a.z <= 0.0) { break; }
    let b = holes[i * 2u + 1u];
    let off = xz - a.xy;
    let d = length(off);
    let reach = a.z + ringM;
    if (d > reach) { continue; }
    // A rim a little ragged, as cut turf is.
    let ang = atan2(off.y, off.x);
    let r = a.z * (1.0 + 0.08 * sin(ang * 5.0 + a.x * 7.0) + 0.05 * sin(ang * 11.0 + a.y * 3.0));
    // An ash patch: thickest in the middle, thinning out ragged toward its edge.
    if (a.w < 0.0) {
      let thin = 0.8 + 0.2 * sin(ang * 7.0 + d * 9.0 + a.y * 5.0);
      hit.albedo = mix(hit.albedo, b.rgb, -a.w * thin * (1.0 - smoothstep(r * 0.35, r, d)));
      continue;
    }
    // The fresh soil: darker turned earth from the rim out, fading with distance.
    let fresh = b.w * (1.0 - smoothstep(r * 0.9, r + ringM, d));
    hit.albedo = hit.albedo * (1.0 - fresh);
    if (a.w <= 0.0 || d >= r) { continue; }
    // The mouth: the walls' earth near the rim, going dark toward the middle by the mouth darkness.
    let t = d / r;
    let deep = a.w * (1.0 - smoothstep(0.15, 0.95, t));
    let wall = b.rgb * (0.55 + 0.45 * t);
    let m = smoothstep(1.0, 0.85, t);
    hit.albedo = mix(hit.albedo, wall * (1.0 - deep * 0.9), m);
    hit.cover = max(hit.cover, m);
    // The bowl's walls lean in: steepest near the rim, more so the darker (deeper) the mouth.
    if (d > 1e-4) { hit.grad += (off / d) * a.w * 1.6 * smoothstep(0.2, 0.9, t) * m; }
  }
  return hit;
}

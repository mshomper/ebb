// The hagstone watcher (H2, doc 16; the orchestrator's draft 2, approved by Matt on October 27, 2026):
// skinned by its 21 bones (the root and four wrack blades of five; src/world/hollow/watcher-motion.js),
// its surfaces and the hole's light drawn here. The stone carries its place in two baked maps in its
// colour slot (u, v, 2): the albedo and the fine field's normals in object space, rest pose (the stone is
// rigid, so the root's turn carries them). The weed carries its own linear albedo there. The hole's
// light is a light, not a paint: a soft glow along the hole's walls, deepest in the middle, and a light
// at the hole's middle that falls on the stone round it, so the polished rim catches it and the far
// face stays dark; and the light filling the hole itself, a soft glow at its middle that the stone
// hides everywhere but through the opening (the pass draws it). It is cooler at rest and warmer as the watcher notices the lantern. Colours are linear
// from recipes/world/hollow.json foes.watcher.stone.look (physical: the palette paints later). Shared by
// the arena's watcher pass and, later, the game's.

struct Watcher {
  at: vec4f,    // x, y, z (world m, the stone's middle at rest), yaw (+z turned by yaw)
  look: vec4f,  // x flash (a landed hit, 0..1), y the hole's light (cd/m2), z its first bone, w warmth (0 cool .. 1 warm)
  floor: vec4f, // x the call's ring radius (m), y its light (cd/m2), z the pool of light under it (cd/m2), w the ground's y
  hole: vec4f,  // xyz the hole's middle (world m), w its radius (m)
};

struct WatcherLook {
  warm: vec4f,  // rgb the light noticing (linear), w how far it reaches up the walls (m)
  cool: vec4f,  // rgb the light at rest, w how much it lights the rim round the hole
  hole: vec4f,  // x, y its middle (model m), z radius (m), w how it flares toward the faces
  misc: vec4f,  // x the hole's half depth (m), y stone roughness, z sheen, w flash
  floor: vec4f, // x the pool's reach (m), y the ring's width (m), z the light filling the hole: its size (radii), w its strength
};

struct WatcherVert { world: vec3f, n: vec3f };

/** A vertex skinned by its four bones, then turned by its yaw and placed. */
fn watcherPlace(p: vec3f, n: vec3f, m: mat4x4f, w: Watcher) -> WatcherVert {
  let q = (m * vec4f(p, 1.0)).xyz;
  let nn = (m * vec4f(n, 0.0)).xyz;
  var o: WatcherVert;
  o.world = watcherTurn(q, w.at.w) + w.at.xyz;
  o.n = normalize(watcherTurn(nn, w.at.w) + vec3f(0.0, 1e-6, 0.0));
  return o;
}

/** Model space turned by the yaw (as foes.js: +z faces along yaw). */
fn watcherTurn(v: vec3f, yaw: f32) -> vec3f {
  let c = cos(yaw); let s = sin(yaw);
  return vec3f(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

/** The hole's colour now: cool at rest, warm as it notices. */
fn watcherGlowColor(L: WatcherLook, warmth: f32) -> vec3f {
  return mix(L.cool.rgb, L.warm.rgb, clamp(warmth, 0.0, 1.0));
}

/**
 * The hole's light on a point of the stone (rest position and rest normal, model space), as light falling
 * on it (multiplies the albedo): along the walls a soft glow, deepest in the middle; on the stone round
 * it, a light at the hole's middle, so the polished rim catches it.
 */
fn watcherHoleLight(rest: vec3f, n: vec3f, L: WatcherLook, nits: f32, warmth: f32) -> vec3f {
  let H = L.hole;
  let half = max(L.misc.x, 1e-3);
  let zs = abs(rest.z) / half;
  let wall = length(rest.xy - H.xy) - H.z * (1.0 + H.w * zs * zs);
  let deep = 1.0 - 0.6 * smoothstep(0.2, 1.2, zs);
  let along = exp(-max(wall, 0.0) / max(L.warm.w, 1e-3)) * deep;
  // The light at the hole's middle: what faces it is lit, falling off past the radius.
  let to = vec3f(H.xy, 0.0) - rest;
  let d = length(to);
  let facing = max(dot(n, to / max(d, 1e-4)), 0.0);
  let fall = 1.0 / (1.0 + (d / H.z) * (d / H.z) * 2.0);
  return watcherGlowColor(L, warmth) * nits * (along * 0.8 + facing * fall * L.cool.w);
}

// The silt crawler (H2, doc 16; Matt's model, October 27, 2026): skinned by its 16 bones (the rig is in
// src/world/hollow/crawler-rig.js), and its surfaces drawn here. Matt's OBJs carry no UVs, so there are
// no textures to map: each point's rest position (model metres) and the zones the prep wrote into its
// colour slot (x the shell plate, y the soft pale underside, z the eye knobs) pick what it is made of,
// with Matt's modelled cobbles as the prep read them (how far down in a seam, each cobble's shade).
// Packed wet silt with a fine grain and a wet sheen everywhere; on the plate, his cobbles as shells,
// each its own shade, with wet silt packed down in the seams between them; the underside pale and soft; the knobs pale,
// with a faint light of their own in the dark. Colours are linear albedo from recipes/world/hollow.json
// foes.lunger.crawler.look (physical: the palette paints later). Shared by the arena's crawler pass and,
// later, the game's.

struct Crawler {
  at: vec4f,   // x, y, z (world m, the ground under it), yaw (+z turned by yaw)
  look: vec4f, // x flash (a landed hit, 0..1), y slump (breaking, 0..1), z its first bone, w glow (0..1)
};

struct CrawlerLook {
  silt: vec4f,  // rgb packed silt (linear), w grain (a share)
  grain: vec4f, // x grainM, y wet roughness, z wet sheen, w flash
  shell: vec4f, // rgb the shells, w spare
  shell2: vec4f, // x shade jitter, y seam share, zw spare
  belly: vec4f, // rgb the underside, w spare
  knob: vec4f,  // rgb the eye knobs, w glow (cd/m2)
};

struct CrawlerVert { world: vec3f, n: vec3f };

fn crawlerHash(p: vec3i) -> f32 {
  var n = u32(p.x) * 374761393u + u32(p.y) * 668265263u + u32(p.z) * 2147483647u;
  n = (n ^ (n >> 13u)) * 1274126177u;
  return f32(n ^ (n >> 16u)) / 4294967296.0;
}

fn crawlerNoise(p: vec3f) -> f32 {
  let i = vec3i(floor(p));
  let f = p - floor(p);
  let w = f * f * (3.0 - 2.0 * f);
  let x00 = mix(crawlerHash(i), crawlerHash(i + vec3i(1, 0, 0)), w.x);
  let x10 = mix(crawlerHash(i + vec3i(0, 1, 0)), crawlerHash(i + vec3i(1, 1, 0)), w.x);
  let x01 = mix(crawlerHash(i + vec3i(0, 0, 1)), crawlerHash(i + vec3i(1, 0, 1)), w.x);
  let x11 = mix(crawlerHash(i + vec3i(0, 1, 1)), crawlerHash(i + vec3i(1, 1, 1)), w.x);
  return mix(mix(x00, x10, w.y), mix(x01, x11, w.y), w.z);
}

/** A vertex skinned by its four bones, then slumped (breaking) and placed. */
fn crawlerPlace(p: vec3f, n: vec3f, m: mat4x4f, c: Crawler) -> CrawlerVert {
  var q = (m * vec4f(p, 1.0)).xyz;
  var nn = (m * vec4f(n, 0.0)).xyz;
  // Breaking: it slumps down and spreads into the silt.
  let s = c.look.y;
  q = vec3f(q.x * (1.0 + s * 0.6), q.y * (1.0 - s), q.z * (1.0 + s * 0.6));
  let cy = cos(c.at.w); let sy = sin(c.at.w);
  var o: CrawlerVert;
  o.world = vec3f(cy * q.x + sy * q.z, q.y, -sy * q.x + cy * q.z) + c.at.xyz;
  o.n = normalize(vec3f(cy * nn.x + sy * nn.z, nn.y, -sy * nn.x + cy * nn.z) + vec3f(0.0, 1e-6, 0.0));
  return o;
}

struct CrawlerSurface { albedo: vec3f, rough: f32, sheen: f32, glow: vec3f };

/** What the crawler is made of at a rest point with its zones. */
fn crawlerSurface(rest: vec3f, zones: vec3f, shell: vec2f, L: CrawlerLook) -> CrawlerSurface {
  var s: CrawlerSurface;
  // Packed silt: a fine grain, darker in its pits.
  let grain = crawlerNoise(rest / L.grain.x) * 0.65 + crawlerNoise(rest / (L.grain.x * 0.37)) * 0.35;
  var col = L.silt.rgb * (1.0 + (grain - 0.5) * 2.0 * L.silt.w);
  var rough = L.grain.y;
  var sheen = L.grain.z;
  // The soft pale underside.
  col = mix(col, L.belly.rgb * (0.9 + 0.2 * grain), zones.y);
  // The shell plate: Matt's modelled cobbles, each its own shade, wet silt packed down in the seams.
  let seam = clamp(shell.x * L.shell2.y * 1.6, 0.0, 1.0);
  let cobble = L.shell.rgb * (1.0 + (shell.y - 0.5) * 2.0 * L.shell2.x) * (0.92 + 0.16 * grain);
  let onShell = zones.x * (1.0 - seam);
  col = mix(col, cobble, onShell);
  col *= 1.0 - zones.x * seam * 0.35;
  rough = mix(rough, 0.6, onShell);
  sheen = mix(sheen, sheen * 0.4, onShell);
  // The eye knobs: pale and glossy, with a faint light of their own.
  col = mix(col, L.knob.rgb, zones.z);
  rough = mix(rough, 0.18, zones.z);
  s.albedo = col;
  s.rough = rough;
  s.sheen = sheen;
  s.glow = L.knob.rgb * L.knob.w * zones.z;
  return s;
}

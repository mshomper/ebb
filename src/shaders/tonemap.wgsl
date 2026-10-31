// Tonemap and present (docs/05): pre-exposed HDR + bloom -> Purkinje night shift -> AgX with the
// palette's look -> palette LUT (two LUTs, crossfaded) -> the camp fire's banded flame -> soft outline
// -> journal wash -> photo mode's filter -> dither -> screen. Everything before the LUT is physical or perceptual; the palette
// is the painted step, and the fire's flame (Matt's fire study, October 29, 2026) its one sanctioned
// exception: painted in display colour from the fire sim's heat, so AgX and the LUT never smear its bands.

// #include common
// #include lib-hash
// #include lib-oklab
// #include lib-fire-bands

struct Post {
  bloomMix: f32, lutFade: f32, lutFrom: u32, lutTo: u32,
  lookSlope: f32, lookPower: f32, lookSat: f32, purkinje: f32,
  outlineAmount: f32, terrainAmount: f32, outlineChroma: f32, outlineWidthPx: f32,
  fadeStart: f32, fadeEnd: f32, split: f32, ditherCode: f32,
  rodFull: f32, rodNone: f32, creatureBoost: f32, creatureFadeStart: f32,
  depthEdge: vec2f, normalEdge: vec2f,
  rodWeights: vec3f, creatureFadeEnd: f32,
  tint: vec3f, _p2: f32,
  // The journal's show-where wash (J2b), painted after the palette in one journal ink.
  wash: vec4f,          // map origin x, origin z (m), 1 / map size (m), amount 0..1 (fade)
  washInk: vec3f, washLive: f32,
  washPencil: vec3f, washWell: f32,
  washLine: vec4f,      // edge width (px), edge alpha, circle line width (px), circle alpha
  circles: array<vec4f, 3>, // pencil circles: x, z, radius (m), dashes per ring (0 = none)
  lens: vec4f,          // x: photo mode's depth of field is drawn (the HDR alpha holds each pixel's blur radius, px); yz: where ink fades (px)
  // The camp fire (camp-fire.js): x on, y halo strength; then its bands.
  fire: vec4f,
  bands: FireBands,
  // Photo mode's filter (B2 P1, recipes/world/photo.json filters), painted after the palette.
  photoSoft: vec4f,     // x filter (0 none, 1 Soft, 2 Pencil), y shadow lift, z saturation, w vignette
  photoPencil: vec4f,   // x colour kept, y hatch spacing (output px), z graphite strength, w paper grain
  paper: vec4f,         // paper (display sRGB), w Pencil's outline strength
  graphite: vec4f,      // graphite (display sRGB), w Soft's glow
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var hdrTex: texture_2d<f32>;
@group(2) @binding(1) var linearSampler: sampler;
@group(2) @binding(2) var bloomTex: texture_2d<f32>;
@group(2) @binding(3) var lutA: texture_3d<f32>;
@group(2) @binding(4) var lutB: texture_3d<f32>;
@group(2) @binding(5) var normalIdTex: texture_2d<f32>;
@group(2) @binding(6) var depthTex: texture_depth_2d;
@group(2) @binding(7) var<uniform> post: Post;
@group(2) @binding(8) var washTex: texture_2d<f32>;   // half a meter a texel: r where it lives, g where it would do well
@group(2) @binding(9) var fireHeatTex: texture_2d<f32>; // the camp fire's collected heat (camp-fire-draw.wgsl)

const LUM = vec3f(0.2126, 0.7152, 0.0722);

// AgX base, polynomial sigmoid fit (Benjamin Wrensch, "Minimal AgX implementation", 2023).
fn agxContrast(x: vec3f) -> vec3f {
  let x2 = x * x;
  let x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

fn agx(color: vec3f) -> vec3f {
  let inset = mat3x3f(
    vec3f(0.842479062253094, 0.0423282422610123, 0.0423756549057051),
    vec3f(0.0784335999999992, 0.878468636469772, 0.0784336),
    vec3f(0.0792237451477643, 0.0791661274605434, 0.879142973793104));
  let minEv = -12.47393;
  let maxEv = 4.026069;
  var c = inset * max(color, vec3f(1e-10));
  c = clamp(log2(c), vec3f(minEv), vec3f(maxEv));
  c = (c - minEv) / (maxEv - minEv);
  return agxContrast(c);
}

// The palette's AgX "look": ASC CDL slope and power, then saturation (as Blender's AgX looks).
fn agxLook(c: vec3f) -> vec3f {
  var v = pow(max(c * post.lookSlope, vec3f(0.0)), vec3f(post.lookPower));
  let luma = dot(v, LUM);
  return luma + post.lookSat * (v - luma);
}

fn agxEotf(c: vec3f) -> vec3f {
  let outset = mat3x3f(
    vec3f(1.19687900512017, -0.0528968517574562, -0.0529716355144438),
    vec3f(-0.0980208811401368, 1.15190312990417, -0.0980434501171241),
    vec3f(-0.0990297440797205, -0.0989611768448433, 1.15107367264116));
  return outset * c; // stays display-encoded (approximately sRGB), written to a non-sRGB swapchain
}

// Purkinje shift (after Patry, SIGGRAPH 2021): below a few hundredths of a nit the eye sees with
// rods, so color fades toward a blue-shifted rod response. Perception, so it precedes the palette.
fn nightShift(c: vec3f) -> vec3f {
  let nits = dot(c, LUM) / max(frame.exposure, 1e-12);
  let w = post.purkinje * (1.0 - smoothstep(post.rodFull, post.rodNone, nits));
  let rod = dot(c, post.rodWeights);
  let night = rod * post.tint / dot(post.tint, LUM);
  return mix(c, night, w);
}

fn octDecode(e: vec2f) -> vec3f {
  let f = e * 2.0 - 1.0;
  var n = vec3f(f.x, 1.0 - abs(f.x) - abs(f.y), f.y);
  let t = clamp(-n.y, 0.0, 1.0);
  n.x += select(t, -t, n.x >= 0.0);
  n.z += select(t, -t, n.z >= 0.0);
  return normalize(n);
}

// Soft outline strength at an internal-resolution pixel, and the line amount for its group.
// Lines sit on the nearer object; water and sky pixels never get lines (docs/05).
fn outlineAt(p: vec2f) -> f32 {
  let size = vec2i(textureDimensions(depthTex));
  let c = clamp(vec2i(p), vec2i(0), size - 1);
  let d0 = textureLoad(depthTex, c, 0);
  let nid0 = textureLoad(normalIdTex, c, 0);
  let group = i32(round(nid0.a * 3.0));
  if (d0 <= 0.0 || nid0.b > 0.5 || group == 0) { return 0.0; }
  let z0 = frame.near / d0;
  let n0 = octDecode(nid0.rg);
  let w = post.outlineWidthPx;
  var edge = 0.0;
  for (var i = 0; i < 4; i++) {
    let dir = array<vec2f, 4>(vec2f(1.0, 0.0), vec2f(-1.0, 0.0), vec2f(0.0, 1.0), vec2f(0.0, -1.0))[i];
    let q = clamp(vec2i(p + dir * w), vec2i(0), size - 1);
    let d = textureLoad(depthTex, q, 0);
    let nid = textureLoad(normalIdTex, q, 0);
    if (nid.b > 0.5) { continue; }
    if (d <= 0.0) { edge = max(edge, 1.0); continue; } // silhouette against the sky
    let g = i32(round(nid.a * 3.0));
    // Creatures keep only their silhouette: no lines inside the body (eyes, hips), which drew a
    // small animal on with ink.
    if (group == 3 && g == 3) { continue; }
    let z = frame.near / d;
    edge = max(edge, smoothstep(post.depthEdge.x, post.depthEdge.y, (z - z0) / z0));
    if (g != group && g != 0) { edge = max(edge, 1.0); }
    let nd = dot(octDecode(nid.rg), n0);
    edge = max(edge, 1.0 - smoothstep(post.normalEdge.y, post.normalEdge.x, nd));
  }
  var amount = post.outlineAmount;
  if (group == 1) { amount = post.terrainAmount; }
  var fade = 1.0 - smoothstep(post.fadeStart, post.fadeEnd, z0);
  if (group == 3) {
    // A creature's line helps up close and fades with distance: a far frog is a small natural
    // shape in the grass, never an inked dot (found by its call and its movement instead).
    amount = post.outlineAmount * post.creatureBoost;
    fade = 1.0 - smoothstep(post.creatureFadeStart, post.creatureFadeEnd, z0);
  }
  return clamp(edge * amount * fade, 0.0, 1.0);
}

// The show-where wash over the finished, paletted color. Only ground and water pixels take it
// (plants, creatures and the sky keep their own look), so the wash reads as ink on the land. The
// edge is where the "lives" field crosses one half, measured in pixels through its screen
// derivative; pencil circles are dashed rings at a fixed pixel width. Derivatives are taken before
// any branch, so the control flow stays uniform.
fn washOver(c: vec3f, uv: vec2f) -> vec3f {
  let size = vec2i(textureDimensions(depthTex));
  let px = clamp(vec2i(uv * frame.renderSize), vec2i(0), size - 1);
  let d = textureLoad(depthTex, px, 0);
  let nid = textureLoad(normalIdTex, px, 0);
  let onGround = d > 0.0 && (nid.b > 0.5 || i32(round(nid.a * 3.0)) == 1);
  let h = frame.invViewProj * vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, max(d, 1e-7), 1.0);
  let xz = h.xz / h.w;
  let m = textureSampleLevel(washTex, linearSampler, (xz - post.wash.xy) * post.wash.z, 0.0).rg;
  let fw = fwidth(m.r);
  let mpp = length(fwidth(xz));   // meters per pixel here
  if (!onGround || post.wash.w <= 0.0) { return c; }

  let amt = post.wash.w;
  let live = smoothstep(0.3, 0.7, m.r);
  let fill = max(live * post.washLive, (1.0 - live) * m.g * post.washWell);
  var out = mix(c, post.washInk, fill * amt);
  // Inked edge: within edge-width pixels of the half contour; skipped where the derivative jumps
  // (at a silhouette), so no stray lines.
  if (fw > 1e-5 && fw < 0.35) {
    let distPx = abs(m.r - 0.5) / fw;
    let edge = 1.0 - smoothstep(post.washLine.x * 0.5, post.washLine.x * 0.5 + 1.0, distPx);
    out = mix(out, post.washInk * 0.72, edge * post.washLine.y * amt);
  }
  // Pencil circles for a species not seen yet: dashed rings, a hint of where to look.
  if (mpp > 0.0 && mpp < 2.0) {
    for (var i = 0; i < 3; i++) {
      let k = post.circles[i];
      if (k.z <= 0.0) { continue; }
      let rel = xz - k.xy;
      let ringPx = abs(length(rel) - k.z) / mpp;
      let line = 1.0 - smoothstep(post.washLine.z * 0.5, post.washLine.z * 0.5 + 1.0, ringPx);
      let turn = atan2(rel.y, rel.x) / 6.2831853 + 0.5;
      let dash = step(0.38, fract(turn * k.w + f32(i) * 0.37));
      out = mix(out, post.washPencil, line * dash * post.washLine.w * amt);
    }
  }
  return out;
}

// Smooth value noise on a pixel grid, for the pencil's wobble and the paper's tooth.
fn valueNoise(p: vec2f, seed: u32) -> f32 {
  let i = vec2u(vec2i(floor(p)) + vec2i(4096));
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hashToFloat(hash3(vec3u(i, seed)));
  let b = hashToFloat(hash3(vec3u(i + vec2u(1u, 0u), seed)));
  let c = hashToFloat(hash3(vec3u(i + vec2u(0u, 1u), seed)));
  let d = hashToFloat(hash3(vec3u(i + vec2u(1u, 1u), seed)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// The palette's finished colour for an HDR value: the same steps as the image itself (Purkinje,
// AgX with the look, the LUT crossfade), for the Soft filter's glow.
fn paletted(hdr: vec3f) -> vec3f {
  let d = clamp(agxEotf(agxLook(agx(nightShift(hdr)))), vec3f(0.0), vec3f(1.0));
  let uvw = d * (31.0 / 32.0) + 0.5 / 32.0;
  let a = textureSampleLevel(lutA, linearSampler, uvw, 0.0).rgb;
  let b = textureSampleLevel(lutB, linearSampler, uvw, 0.0).rgb;
  return mix(select(a, b, post.lutFrom == 1u), select(a, b, post.lutTo == 1u), post.lutFade);
}

// Soft: a diffusion glow (the picture lightened toward the soft copy the bloom chain keeps, in the
// palette's own colours), the shadows lifted toward the paper, the saturation eased, and the edges
// fading toward the paper. Display colour in, display colour out: a painted step after the palette.
fn softFilter(c: vec3f, uv: vec2f, glow: vec3f) -> vec3f {
  var o = max(c, mix(c, glow, post.graphite.w));
  let luma = dot(o, LUM);
  o = mix(vec3f(luma), o, post.photoSoft.z);
  o = mix(o, post.paper.rgb, post.photoSoft.y * (1.0 - luma));
  let r = length((uv - 0.5) * vec2f(1.0, 0.8)) * 1.6;
  return mix(o, post.paper.rgb, post.photoSoft.w * smoothstep(0.45, 1.05, r));
}

// One layer of pencil strokes along a direction: lines `spacing` pixels apart, each covering
// `width` (0..1) of the gap, wobbling gently along their length and pressed harder in places.
fn hatchLayer(px: vec2f, dir: vec2f, spacing: f32, width: f32, seed: u32) -> f32 {
  if (width <= 0.0) { return 0.0; }
  let along = dot(px, vec2f(dir.y, -dir.x));
  let row = dot(px, dir) / spacing;
  let across = row + (valueNoise(vec2f(along / (spacing * 24.0), floor(row) * 0.37), seed) - 0.5) * 0.6;
  let d = abs(fract(across) - 0.5) * 2.0;            // 0 on the line, 1 half way between
  let aa = 2.0 / spacing;                             // about a pixel
  let w = min(width, 0.9);
  let press = mix(0.55, 1.0, valueNoise(vec2f(along / (spacing * 14.0), floor(across) * 1.7), seed + 7u));
  return (1.0 - smoothstep(w - aa, w + aa, d)) * press;
}

// Pencil: graphite hatching on paper from the image's lightness (OKLab): the light parts left as
// paper, one layer of strokes through the middle tones, crossing as it darkens; the soft outline
// drawn firmly, and a little of the palette's colour washed into the paper. The sky is left
// bare but for the wash, as a sketch leaves it.
fn pencilFilter(c: vec3f, px: vec2f, edge: f32, sky: bool) -> vec3f {
  let L = linearToOklab(srgbToLinear3(c)).x;
  let tone = clamp((0.76 - L) / 0.46, 0.0, 1.0) * select(1.0, 0.0, sky);
  let s = post.photoPencil.y;
  var g = hatchLayer(px, normalize(vec2f(1.0, 1.0)), s, tone * 0.75, 11u);
  g = max(g, hatchLayer(px, normalize(vec2f(1.0, -0.7)), s, (tone - 0.45) * 1.1, 23u));
  g = max(g, hatchLayer(px, normalize(vec2f(0.15, 1.0)), s * 0.8, (tone - 0.75) * 1.6, 37u));
  let grain = (valueNoise(px * 0.35, 51u) - 0.5) * post.photoPencil.w;
  let paper = post.paper.rgb * (1.0 + grain);
  let tint = c / max(dot(c, LUM), 0.05);
  let wash = mix(paper, paper * mix(vec3f(1.0), tint, 0.6), post.photoPencil.x * (0.3 + tone * 0.7));
  let ink = clamp(max(g * post.photoPencil.z, edge * post.paper.w), 0.0, 1.0);
  return mix(wash, post.graphite.rgb, ink);
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> FullscreenOut {
  return fullscreenTriangle(vi);
}

@fragment
fn fs(in: FullscreenOut) -> @location(0) vec4f {
  let hdrPx = textureSampleLevel(hdrTex, linearSampler, in.uv, 0.0);
  var hdr = hdrPx.rgb;
  let bloom = textureSampleLevel(bloomTex, linearSampler, in.uv, 0.0).rgb;
  hdr += bloom * post.bloomMix;
  hdr = nightShift(hdr);
  let display = clamp(agxEotf(agxLook(agx(hdr))), vec3f(0.0), vec3f(1.0));

  // Palette LUT, sampled at texel centers, crossfading between the two LUTs during a swap.
  let uvw = display * (31.0 / 32.0) + 0.5 / 32.0;
  let a = textureSampleLevel(lutA, linearSampler, uvw, 0.0).rgb;
  let b = textureSampleLevel(lutB, linearSampler, uvw, 0.0).rgb;
  let fromC = select(a, b, post.lutFrom == 1u);
  let toC = select(a, b, post.lutTo == 1u);
  var c = mix(fromC, toC, post.lutFade);
  // Palette lab before/after split: left of the divider shows the image without the palette.
  if (post.split >= 0.0 && in.uv.x < post.split) { c = display; }

  // The camp fire's flame, painted in its bands over the finished colour; no ink shows through it.
  var flame = 0.0;
  if (post.fire.x > 0.5) {
    let h = textureSampleLevel(fireHeatTex, linearSampler, in.uv, 0.0).r;
    if (h > 0.0) {
      flame = fireAlpha(post.bands, h);
      c = firePaint(post.bands, c, h, post.fire.y);
    }
  }

  // Soft outline: a darker shade of the pixel's own color in OKLab, never black. Under the Pencil
  // filter the same line is drawn in graphite instead.
  let look = i32(round(post.photoSoft.x));
  // Out of focus (photo mode's lens), the line goes soft with what it outlines.
  let unfocused = select(0.0, smoothstep(post.lens.y, post.lens.z, hdrPx.a), post.lens.x > 0.5);
  let line = outlineAt(in.uv * frame.renderSize) * (1.0 - flame) * (1.0 - unfocused);
  let ink = select(line, 0.0, look == 2);
  if (ink > 0.0) {
    var lab = linearToOklab(srgbToLinear3(c));
    lab.x *= 1.0 - ink;
    lab = vec3f(lab.x, lab.yz * mix(1.0, post.outlineChroma, ink));
    c = clamp(linearToSrgb3(oklabToLinear(lab)), vec3f(0.0), vec3f(1.0));
  }

  // The journal's show-where wash: the one painted mark on the island, after the palette.
  c = washOver(c, in.uv);

  // Photo mode's filter, the last painted step (recipes/world/photo.json filters).
  if (look == 1) { c = softFilter(c, in.uv, paletted(bloom)); }
  else if (look == 2) {
    let skyPx = textureLoad(depthTex, clamp(vec2i(in.uv * frame.renderSize), vec2i(0), vec2i(textureDimensions(depthTex)) - 1), 0) <= 0.0;
    c = pencilFilter(c, in.pos.xy, clamp(line / max(post.outlineAmount, 0.05), 0.0, 1.0), skyPx);
  }

  // Triangular dither of about one code value so pastel skies never band.
  let h = hash3(vec3u(vec2u(in.pos.xy), frame.frameIndex & 63u));
  let n = hashToFloat(h) + hashToFloat(pcg(h)) - 1.0;
  c += n * post.ditherCode / 255.0;
  return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), 1.0);
}

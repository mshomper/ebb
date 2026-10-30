// Props (docs/future/13 section 3.4): Matt's made models (the tent, the fire ring and its wood, the
// lantern; later the camp's piles), drawn with their own paint maps: base colour (sRGB, so it reads
// back linear), roughness from the green of the metallic-roughness map, and a tangent-space normal
// map, perturbed in a cotangent frame from screen derivatives (Schüler 2006), since the models carry
// no tangents. Lit like the creatures (sun and moon with shadows, sky fill, the small lights, GGX,
// aerial perspective). A fire's wood can char (darker, sunk lower as it burns down) and glow from its
// embers. Under each prop a soft contact shadow; into the sun's shadow map through prop-cast.wgsl. Physical
// albedo only: the palette paints at tonemap (docs/05). The tent's canvas weathers (C-35, weather() below):
// it pales and greys, gains stitched patches, and its poles silver, all as linear albedo.

// #include common
// #include lib-hash
// #include lighting-bindings
// #include lib-sky
// #include lib-lighting
// #include lib-lift

struct PropDraw {
  ember: vec4f,     // rgb ember glow (cd/m2 at full glow, linear), w flicker speed (Hz)
  charCol: vec4f,   // rgb charcoal albedo, w spare
  liftTint: vec4f,  // the lift (lib-lift.wgsl, F5): warm tint and its strength
  liftRim: vec4f,   // rim colour and its power
  dryTint: vec4f,   // a dried plant: rgb the tint its brightness takes, w how far it goes at dry 1
  raw: vec4f,       // unfired clay: rgb its pale albedo (linear), w how much of the fired paint's light and dark it keeps
  // Canvas weathering (C-35; recipes/world/camp.json canvas, poles):
  canvasA: vec4f,   // x pale (brightness at full fade), y grey share at full fade, z lining's sRGB lightness, w the lining's share of the fade
  greyTint: vec4f,  // rgb the grey the canvas fades toward (times its brightness), w a patch's share of the canvas's fade
  sortHue: vec4f,   // x, y the sRGB hue (degrees) below which the paint is wood, blended up to y; z stitch width (m), w stitch dash (m)
  stitch: vec4f,    // rgb the stitches' thread (linear), w silver gain (how much of the wood's own light and dark silvered wood keeps)
  silver: vec4f,    // rgb silvered wood's tint, w the poles' reach either side of the tent's end edges (m)
  frameA: vec4f,    // the tent's frame in its own space (m): x, y |z| where the end poles begin (blended), z the ridge's height, w the base's half width
  frameB: vec4f,    // x the inside's half width at the ground (narrowing to the ridge), y its height: kept as it is (the bedroll and groundsheet); z the faded canvas's added brightness; w silvered wood's base grey
  patchA: vec4f,    // rgb one patch cloth (times the fresh canvas), w spare
  patchB: vec4f,    // rgb the other
  patches: array<vec4f, 6>,  // 0..2: z, y (centre on its slope), half width, half height (m); 3..5: side (+1 / -1 x), turn, tone, spare
};

struct Prop {
  at: vec4f,        // x, y, z (ground under its origin), yaw (radians, 0: its +z faces +z)
  more: vec4f,      // x scale, y char 0..1, z ember glow 0..1, w squash of its height (1 as made)
  look: vec4f,      // x albedo scale, y roughness scale, z normal strength, w normal map's green sign
  shade: vec4f,     // contact shadow: x, y half sizes along its own x and z (m), z darkness 0..1, w the prop's lift 0..1 (F5: hovered or its card open)
  tilt: vec4f,      // x pitch about its own x (its +y toward its +z), y roll about its own z, both before the yaw (a held tool); z dry 0..1 (a herb bunch); w spare
  burn: vec4f,      // x its length along its own x (1 as made); y burnt from its -x end this far along it (0: char rises from the bottom instead); z the model's half length along x (m); w raw clay 0..1
  wear: vec4f,      // the tent's weathering (src/world/camp/canvas.js): x canvas fade 0..1, y poles' silver 0..1, z patches sewn on, w 1: the canvas check's sort view
  dye: vec4f,       // a dyed canvas (Phase 4's hook, section 9.3): rgb its tint on the cloth (linear, faded: canvas.js dyeTint), w 1 when dyed (0: undyed)
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var<uniform> pd: PropDraw;
@group(2) @binding(1) var<storage, read> props: array<Prop>;
@group(3) @binding(0) var baseMap: texture_2d<f32>;
@group(3) @binding(1) var roughMap: texture_2d<f32>;
@group(3) @binding(2) var normalMap: texture_2d<f32>;
@group(3) @binding(3) var mapSampler: sampler;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) localY: f32,
  @location(4) @interpolate(flat) ii: u32,
  @location(5) localX: f32,
  @location(6) paint: vec3f,
  @location(7) localZ: f32,
};

struct FsOut {
  @location(0) color: vec4f,
  @location(1) normalId: vec4f,
};

fn octEncode(n: vec3f) -> vec2f {
  var p = n.xz / (abs(n.x) + abs(n.y) + abs(n.z));
  if (n.y < 0.0) { p = (1.0 - abs(p.yx)) * select(vec2f(-1.0), vec2f(1.0), p >= vec2f(0.0)); }
  return p * 0.5 + 0.5;
}

/** A direction in the prop's frame turned by its yaw into the world (piece-draw.wgsl turn). */
fn turn(d: vec3f, yaw: f32) -> vec3f {
  let c = cos(yaw);
  let s = sin(yaw);
  return vec3f(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);
}

/** A direction in the prop's frame tipped by its roll (about z), then its pitch (about x). */
fn tip(d: vec3f, t: vec4f) -> vec3f {
  let cr = cos(t.y);
  let sr = sin(t.y);
  let r = vec3f(cr * d.x - sr * d.y, sr * d.x + cr * d.y, d.z);
  let cp = cos(t.x);
  let sp = sin(t.x);
  return vec3f(r.x, cp * r.y - sp * r.z, sp * r.y + cp * r.z);
}

fn placed(position: vec3f, pr: Prop) -> vec3f {
  let p = position * vec3f(pr.burn.x, pr.more.w, 1.0) * pr.more.x;
  return turn(tip(p, pr.tilt), pr.at.w) + pr.at.xyz;
}

@vertex
fn vsProp(@location(0) position: vec3f, @location(1) normal: vec3f, @location(2) uv: vec2f,
          @location(3) paint: vec3f, @builtin(instance_index) ii: u32) -> VsOut {
  let pr = props[ii];
  var o: VsOut;
  o.world = placed(position, pr);
  o.pos = frame.viewProj * vec4f(o.world, 1.0);
  // A squash in height (or a stretch in length) takes the inverse on the normal, so it stays true.
  o.normal = turn(tip(normalize(normal * vec3f(1.0 / max(pr.burn.x, 0.05), 1.0 / max(pr.more.w, 0.05), 1.0)), pr.tilt), pr.at.w);
  o.uv = uv;
  o.localY = position.y;
  o.localX = position.x;
  o.localZ = position.z;
  o.paint = paint;
  o.ii = ii;
  return o;
}

/** The normal map's normal in the frame of the surface (n, its position p and uv). */
fn perturb(n: vec3f, p: vec3f, uv: vec2f, tn: vec3f) -> vec3f {
  let dp1 = dpdx(p);
  let dp2 = dpdy(p);
  let duv1 = dpdx(uv);
  let duv2 = dpdy(uv);
  let dp2perp = cross(dp2, n);
  let dp1perp = cross(n, dp1);
  let t = dp2perp * duv1.x + dp1perp * duv2.x;
  let b = dp2perp * duv1.y + dp1perp * duv2.y;
  let m = max(dot(t, t), dot(b, b));
  if (m < 1e-20) { return n; }
  let inv = inverseSqrt(m);
  return normalize(t * inv * tn.x + b * inv * tn.y + n * tn.z);
}

/** The paint's hue in degrees (0..360) and its lightness, read in sRGB as the recipe's numbers are. */
fn hueOf(lin: vec3f) -> vec2f {
  let c = sqrt(max(lin, vec3f(0.0)));
  let hi = max(c.r, max(c.g, c.b));
  let lo = min(c.r, min(c.g, c.b));
  let d = max(hi - lo, 1e-5);
  var h = 0.0;
  if (hi == c.r) { h = (c.g - c.b) / d; } else if (hi == c.g) { h = 2.0 + (c.b - c.r) / d; } else { h = 4.0 + (c.r - c.g) / d; }
  return vec2f(fract(h / 6.0 + 1.0) * 360.0, (hi + lo) * 0.5);
}

/**
 * Canvas weathering (C-35): the tent's paint by what it is (sorted by hue, since the tent is one
 * painted model): wood (the poles, the seams' thread) silvers; canvas pales and greys, the inner lining
 * half as much; patches of a newer cloth sit on its slopes with a dashed stitch round them. Then the
 * hook for a dyed canvas (Phase 4): the dye times the cloth, sliding toward weathered canvas as it fades.
 * All linear albedo. p: the point in the tent's own frame (x across, y up, z along the ridge).
 */
fn weather(c: vec3f, pr: Prop, p: vec3f) -> vec3f {
  let hl = hueOf(c);
  // Wood: the A-frame poles at the two ends, along the slopes' end edges (their crossed tops too),
  // and warm-hued paint (the stakes, the seams' thread), but not the bedroll and groundsheet inside.
  let ends = smoothstep(pd.frameA.x, pd.frameA.y, abs(p.z));
  let edgeX = pd.frameA.w * max(0.0, 1.0 - p.y / pd.frameA.z);
  let onEdge = 1.0 - smoothstep(pd.silver.w * 0.6, pd.silver.w, abs(abs(p.x) - edgeX));
  let inside = step(abs(p.x), pd.frameB.x * max(0.0, 1.0 - p.y / pd.frameA.z)) * step(p.y, pd.frameB.y) * (1.0 - ends);
  let warm = (1.0 - smoothstep(pd.sortHue.x, pd.sortHue.y, hl.x)) * (1.0 - inside);
  let wood = max(ends * max(onEdge, step(pd.frameA.z - 0.08, p.y)), warm);
  let lining = smoothstep(pd.canvasA.z - 0.05, pd.canvasA.z + 0.05, hl.y);
  let lum = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  // Patches: on the slope facing its side, a newer cloth in its own frame on the slope (z, y).
  var patchK = 0.0;
  var patchTint = vec3f(1.0);
  var stitchK = 0.0;
  let n = i32(pr.wear.z);
  for (var i = 0; i < 3; i++) {
    if (i >= n) { break; }
    let q = pd.patches[i];
    let m = pd.patches[i + 3];
    if (p.x * m.x < 0.08) { continue; }
    let cs = cos(m.y);
    let sn = sin(m.y);
    let d = vec2f(p.z - q.x, p.y - q.y);
    let r = vec2f(cs * d.x + sn * d.y, -sn * d.x + cs * d.y);
    let e = abs(r) - q.zw;
    let box = max(e.x, e.y);
    if (box < 0.0) { patchK = 1.0; patchTint = mix(pd.patchA.rgb, pd.patchB.rgb, m.z); }
    // The stitch, just inside the edge: dashes along it.
    let inset = box + pd.sortHue.z * 1.5;
    let along = select(r.x, r.y, e.x > e.y);
    let dash = step(0.5, fract(along / max(pd.sortHue.w, 1e-3)));
    stitchK = max(stitchK, (1.0 - smoothstep(0.0, pd.sortHue.z * 0.5, abs(inset))) * dash);
  }
  // The canvas check's sort view (wear.w 1): wood red, lining blue, canvas green, the inside grey (kept), patches and stitches yellow.
  if (pr.wear.w > 0.5) { return mix(mix(mix(vec3f(0.05, 0.3, 0.05), vec3f(0.05, 0.05, 0.4), lining), vec3f(0.2), inside) * (1.0 - wood) + vec3f(0.4, 0.04, 0.03) * wood, vec3f(0.5, 0.45, 0.02), max(patchK * 0.6, stitchK)); }
  let canvasK = (1.0 - wood) * mix(1.0, pd.canvasA.w, lining) * (1.0 - inside);
  let fade = pr.wear.x * canvasK * mix(1.0, pd.greyTint.w, patchK);
  let cloth = mix(c, c * patchTint, patchK * (1.0 - wood));
  // Faded: brighter (times pale, plus a little), with greyShare of its colour gone to a tinted grey.
  let clothLum = max(dot(cloth, vec3f(0.2126, 0.7152, 0.0722)), 1e-4);
  let paler = clothLum * pd.canvasA.x + pd.frameB.z;
  let faded = mix(cloth * (paler / clothLum), vec3f(paler) * pd.greyTint.rgb, pd.canvasA.y);
  let greyed = mix(cloth, faded, fade);
  // Silvered wood: a pale grey with the grain's light and dark kept.
  let silvered = mix(greyed, (vec3f(pd.frameB.w) + lum * pd.stitch.w) * pd.silver.rgb, pr.wear.y * wood);
  let stitched = mix(silvered, pd.stitch.rgb, stitchK * (1.0 - wood));
  // The hook for a dyed canvas (Phase 4, section 9.3): the dye's tint, already faded on the CPU
  // (canvas.js dyeTint), on the cloth only; the poles and thread keep their own.
  return select(stitched, mix(stitched, stitched * pr.dye.rgb, 1.0 - wood), pr.dye.w > 0.0);
}

@fragment
fn fsProp(in: VsOut) -> FsOut {
  let pr = props[in.ii];
  var nMesh = normalize(in.normal);
  // Two-sided canvas: the side you see.
  if (dot(nMesh, frame.cameraPos - in.world) < 0.0) { nMesh = -nMesh; }
  let base = textureSample(baseMap, mapSampler, in.uv) * vec4f(in.paint, 1.0);
  let mr = textureSample(roughMap, mapSampler, in.uv);
  let nm = textureSample(normalMap, mapSampler, in.uv).xyz * 2.0 - 1.0;
  let tn = normalize(vec3f(nm.x * pr.look.z, nm.y * pr.look.z * pr.look.w, max(nm.z, 0.05)));
  let n = perturb(nMesh, in.world, in.uv, tn);
  // Char: the wood blackens from the bottom up as it burns, all of it at char 1. A star fire's log
  // (burn.y) is burnt from its end in the fire instead: black that far along it, then a scorched edge.
  let along = clamp(in.localX / max(pr.burn.z, 1e-3) * 0.5 + 0.5, 0.0, 1.0);
  let endMode = pr.burn.y > 0.0;
  let charred = select(smoothstep(-0.05, 0.15, pr.more.y * 1.2 - in.localY * 2.0 + 0.1),
                       1.0 - smoothstep(pr.burn.y - 0.1, pr.burn.y + 0.06, along), endMode);
  let charK = select(pr.more.y, 1.0, endMode);
  // Drying: a herb's green fades as it dries, its brightness kept, toward straw.
  let fresh = base.rgb * pr.look.x;
  let dried = mix(fresh, vec3f(dot(fresh, vec3f(0.2126, 0.7152, 0.0722))) * pd.dryTint.rgb, pd.dryTint.w * pr.tilt.z);
  // Raw clay (a shaped piece not yet fired): pale and dry, keeping a little of its light and dark.
  let lum = dot(dried, vec3f(0.2126, 0.7152, 0.0722));
  let raw = pd.raw.rgb * mix(1.0, clamp(lum / 0.12, 0.4, 1.8), pd.raw.w);
  var albedo = mix(mix(dried, raw, pr.burn.w), pd.charCol.rgb, charred * charK);
  if (pr.wear.x + pr.wear.y + pr.wear.z > 0.0) { albedo = weather(albedo, pr, vec3f(in.localX, in.localY, in.localZ)); }
  let rough = mix(clamp(mr.g * pr.look.y, 0.04, 1.0), 1.0, pr.burn.w);

  let viewDist = distance(in.world, frame.cameraPos);
  let v = (frame.cameraPos - in.world) / max(viewDist, 1e-4);
  let vis = shadowVisibility(in.world, nMesh, viewDist, in.pos.xy);
  let casterIsSun = dot(light.shadowDir, frame.sunDir) > 0.999;
  let sunVis = select(1.0, vis, casterIsSun);
  let moonVis = select(vis, 1.0, casterIsSun);
  let direct = frame.sunIlluminance * max(dot(n, frame.sunDir), 0.0) * sunVis
             + frame.moonIlluminance * max(dot(n, frame.moonDir), 0.0) * moonVis
             + pointIllum(in.world, n, 0.1);
  let ao = mix(0.6, 1.0, clamp(nMesh.y * 0.5 + 0.5, 0.0, 1.0));
  var radiance = albedo * (direct / PI + skyAmbient(n) * ao);
  radiance += frame.sunIlluminance * sunVis * ggxSpecular(n, v, frame.sunDir, rough, 0.04)
            + frame.moonIlluminance * moonVis * ggxSpecular(n, v, frame.moonDir, rough, 0.04);
  // Embers: the dark, low wood glows in slow patches that breathe.
  if (pr.more.z > 0.0) {
    let t = frame.animTime * pd.ember.w;
    // Patches over its paint map; a star fire's log (painted in vertex colours, no map) over its own length and height.
    let pq = select(in.uv, vec2f(in.localX, in.localY + in.localX * 0.3) * 1.2, endMode);
    let patchy = valueNoise2(pq * 18.0 + vec2f(t * 0.37, -t * 0.21), 131u) * 0.7 + valueNoise2(pq * 53.0 - vec2f(t * 0.6, t * 0.4), 137u) * 0.3;
    // Low in the wood; a star fire's log along its burnt end, brightest toward the tip.
    let low = select(1.0 - smoothstep(0.04, 0.2, in.localY * pr.more.w), 1.0 - smoothstep(pr.burn.y * 0.6, pr.burn.y + 0.04, along), endMode);
    let dark = 1.0 - smoothstep(0.05, 0.25, dot(base.rgb, vec3f(0.333)));
    // A log's embers run along its charred end in a deep orange, never blown out to white.
    let k = pr.more.z * select(smoothstep(0.42, 0.8, patchy) * max(low, dark * 0.6), smoothstep(0.3, 0.7, patchy) * low * charred * 0.6, endMode);
    radiance += pd.ember.rgb * k;
  }
  let color = applyAerial(radiance * frame.exposure, in.pos.xy * frame.invRenderSize, viewDist);
  let lifted = liftShade(color, nMesh, v, pr.shade.w, pd.liftTint, pd.liftRim);
  let safe = select(vec3f(0.0), lifted, lifted == lifted);
  // Outline group 2, as the placed pieces: a soft line against the ground.
  return FsOut(vec4f(max(safe, vec3f(0.0)), 1.0), vec4f(octEncode(nMesh), 0.0, 2.0 / 3.0));
}

// ---- the contact shadow: a soft darkening of the ground under the prop ----

struct ShadeOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) dark: f32,
};

var<private> QUAD: array<vec2f, 6> = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
  vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

@vertex
fn vsShade(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> ShadeOut {
  let pr = props[ii];
  let q = QUAD[vi];
  let local = vec3f(q.x * pr.shade.x, 0.004, q.y * pr.shade.y);
  var o: ShadeOut;
  o.pos = frame.viewProj * vec4f(turn(local, pr.at.w) + pr.at.xyz, 1.0);
  o.uv = q;
  o.dark = pr.shade.z;
  return o;
}

@fragment
fn fsShade(in: ShadeOut) -> @location(0) vec4f {
  let r = length(in.uv);
  let dark = in.dark * (1.0 - smoothstep(0.35, 1.0, r));
  return vec4f(vec3f(1.0 - dark), 1.0);
}

// Waterfall water surface, shaded (screen-space fluid, van der Laan et al. 2009; Green, GDC 2010).
// A full-screen pass over the smoothed droplet depth (falls-fluid-smooth.wgsl): rebuilds the
// surface's position and normal, then lights it as water, physically:
//   refraction    the scene behind, seen through the water, bent by the normal and the thickness
//   absorption    Beer-Lambert over the thickness (pond water's sigma), so thick water darkens
//   white water   where the water has taken in air it scatters light like a rough white surface,
//                 lit by sun, moon and sky with shadows (shadeSurface)
//   reflection    the sky probe and GGX sun glints, by Schlick Fresnel (water F0 0.02)
// Pre-exposed radiance, blended over the HDR; the palette applies at the tonemap (docs/05).

// #include common
// #include lib-hash
// #include lighting-bindings
// #include lib-sky
// #include lib-lighting
// #include lib-probe

struct FluidShade {
  absorb: vec4f,       // rgb sigma_a per m (pond water), w refraction (screen uv per m of thickness)
  look: vec4f,         // x white-water albedo, y thickness (m) over which aerated water turns white, z edge thickness (m), w roughness
  toHalf: vec2f,       // full-res pixel to half-res pixel
  halfSize: vec2f,
  flow: vec4f,         // surface ripples: x 1 / size (per m), y how fast they run down (m/s), z tilt strength
  sheen: vec4f,        // x reflection strength on glassy water, y sun glint roughness
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var<uniform> fs: FluidShade;
@group(2) @binding(1) var fluidDepth: texture_2d<f32>;   // smoothed linear depth (m), 0 = none
@group(2) @binding(2) var fluidThick: texture_2d<f32>;   // r thickness (m), g aerated thickness (m)
@group(2) @binding(3) var sceneColor: texture_2d<f32>;   // the HDR before the water was added
@group(2) @binding(4) var sceneDepth: texture_depth_2d;
@group(2) @binding(5) var linearSampler: sampler;
@group(2) @binding(6) var probeTex: texture_cube<f32>;
@group(2) @binding(7) var probeSampler: sampler;

@vertex
fn vsShade(@builtin(vertex_index) vi: u32) -> FullscreenOut {
  return fullscreenTriangle(vi);
}

fn loadZ(c: vec2i) -> f32 {
  return textureLoad(fluidDepth, clamp(c, vec2i(0), vec2i(fs.halfSize) - 1), 0).r;
}

// View-space position of half-res pixel c at linear depth z.
fn viewPos(c: vec2f, z: f32) -> vec3f {
  let uv = (c + 0.5) / fs.halfSize;
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  return vec3f(ndc.x / frame.proj[0][0] * z, ndc.y / frame.proj[1][1] * z, -z);
}

@fragment
fn fsShade(in: FullscreenOut) -> @location(0) vec4f {
  let hc = vec2i(in.pos.xy * fs.toHalf);
  let z = loadZ(hc);
  if (z <= 0.0) { discard; }
  // The scene in front of the water at full resolution (reverse-Z infinite: distance = near / depth).
  let sd = textureLoad(sceneDepth, vec2i(in.pos.xy), 0);
  if (sd > 0.0 && frame.near / sd < z - 0.02) { discard; }
  let hcf = vec2f(hc);
  let p = viewPos(hcf, z);
  // Normal from neighboring depths, taking the nearer neighbor each way so silhouettes stay crisp.
  let zl = loadZ(hc - vec2i(1, 0)); let zr = loadZ(hc + vec2i(1, 0));
  let zd = loadZ(hc - vec2i(0, 1)); let zu = loadZ(hc + vec2i(0, 1));
  var dx = viewPos(hcf + vec2f(1.0, 0.0), select(z, zr, zr > 0.0)) - p;
  let dxl = p - viewPos(hcf - vec2f(1.0, 0.0), select(z, zl, zl > 0.0));
  if (abs(dxl.z) < abs(dx.z)) { dx = dxl; }
  var dy = viewPos(hcf + vec2f(0.0, 1.0), select(z, zu, zu > 0.0)) - p;
  let dyd = p - viewPos(hcf - vec2f(0.0, 1.0), select(z, zd, zd > 0.0));
  if (abs(dyd.z) < abs(dy.z)) { dy = dyd; }
  var nv = normalize(cross(dy, dx));
  if (nv.z < 0.0) { nv = -nv; }
  // View is rigid: its transpose turns view-space vectors into world space.
  let toWorld = transpose(mat3x3f(frame.view[0].xyz, frame.view[1].xyz, frame.view[2].xyz));
  let world = frame.cameraPos + toWorld * p;
  // Falling water is never a smooth sheet: ripples and ropes running down it at the falling speed
  // break up its reflections. Noise across (along the view's right) and down, scrolling downward.
  // Long and thin: water falls in ropes, so the pattern is many times longer down than across.
  let right = toWorld * vec3f(1.0, 0.0, 0.0);
  let across = dot(world, right);
  let down = world.y + frame.animTime * fs.flow.y;
  let fc = vec2f(across * fs.flow.x, down * fs.flow.x * 0.12);
  let e = 0.05;
  let nA = valueNoise2(fc, 61u);
  let dU = valueNoise2(fc + vec2f(e, 0.0), 61u) - nA;
  let dV = valueNoise2(fc + vec2f(0.0, e), 61u) - nA;
  let n = normalize(toWorld * nv + (right * dU + vec3f(0.0, 1.0, 0.0) * dV * 0.3) * (fs.flow.z / e));
  // White ropes: thin streaks of aerated water among glassy ones, a finer set over a coarser one.
  // They meander a little as they fall, and break into beads and gaps further down.
  let wander = across + 0.035 * sin(down * 2.3 + across * 7.0) + 0.02 * sin(down * 5.1 - across * 3.0);
  let ropeA = valueNoise2(vec2f(wander * 14.0, down * 0.6), 67u);
  let ropeB = valueNoise2(vec2f(wander * 34.0, down * 1.4), 71u);
  let ropes = smoothstep(0.45, 0.85, ropeA * 0.65 + ropeB * 0.35);
  let gaps = smoothstep(0.25, 0.6, valueNoise2(vec2f(wander * 9.0, down * 2.2), 73u));
  let v = normalize(frame.cameraPos - world);

  // Thickness, softened over a few pixels (a 3 x 3 of filtered taps), so single droplets never show.
  let texel = 1.0 / fs.halfSize;
  let tuv = (vec2f(hc) + 0.5) * texel;
  var th = vec4f(0.0);
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let w = select(0.5, 1.0, i == 0) * select(0.5, 1.0, j == 0);
      th += textureSampleLevel(fluidThick, linearSampler, tuv + vec2f(f32(i), f32(j)) * texel * 1.5, 0.0) * w;
    }
  }
  th /= 4.0;
  let thick = th.r;
  // White water keeps some of the droplets' own detail (part one filtered tap, part the softened
  // sum): it froths, not fogs, and single droplets never show as beads.
  let aired = mix(th.g, textureSampleLevel(fluidThick, linearSampler, in.pos.xy * frame.invRenderSize, 0.0).g, 0.35);
  // Edge coverage from the four nearest half-res pixels, so the silhouette is smooth, not blocky.
  let hp = in.pos.xy * fs.toHalf - 0.5;
  let h0 = vec2i(floor(hp));
  let hf = hp - floor(hp);
  let cov = mix(mix(select(0.0, 1.0, loadZ(h0) > 0.0), select(0.0, 1.0, loadZ(h0 + vec2i(1, 0)) > 0.0), hf.x),
                mix(select(0.0, 1.0, loadZ(h0 + vec2i(0, 1)) > 0.0), select(0.0, 1.0, loadZ(h0 + vec2i(1, 1)) > 0.0), hf.x), hf.y);
  let screenUv = in.pos.xy * frame.invRenderSize;
  // Seen through: the scene behind, bent and dimmed by the water's body.
  let bent = screenUv + nv.xy * vec2f(1.0, -1.0) * fs.absorb.w * min(thick, 0.4);
  let behind = textureSampleLevel(sceneColor, linearSampler, bent, 0.0).rgb;
  let through = behind * exp(-fs.absorb.rgb * thick);
  // Aerated water scatters light: white where enough of it has taken in air.
  // Ropes break into beads and gaps where the water has taken in most air (lower down).
  let breaks = mix(1.0, gaps, smoothstep(0.2, 0.9, th.g / max(thick, 1e-4)));
  let flowWhite = mix(0.12, 1.5, ropes * breaks);
  let white = clamp((1.0 - exp(-aired / fs.look.y)) * flowWhite, 0.0, 1.0);
  let lit = shadeSurface(vec3f(fs.look.x), world, n, in.pos, 1.0);
  // Sheen: the glassy water mirrors the sky (sharply) and throws small sun glints off its ripples,
  // brightest at its rounded sides where Fresnel climbs; white water reflects only a soft, rough sky.
  let ndv = max(dot(n, v), 0.0);
  let fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  let levels = f32(textureNumLevels(probeTex));
  let r = reflect(-v, n);
  let skySharp = textureSampleLevel(probeTex, probeSampler, r, probeLod(fs.look.w, levels)).rgb * PROBE_INV_SCALE * frame.exposure;
  let skySoft = textureSampleLevel(probeTex, probeSampler, r, probeLod(0.6, levels)).rgb * PROBE_INV_SCALE * frame.exposure;
  let vis = shadowVisibility(world, n, distance(world, frame.cameraPos), in.pos.xy);
  let glint = frame.sunIlluminance * vis * ggxSpecular(n, v, frame.sunDir, fs.sheen.y, 0.02) * frame.exposure;
  let glassy = through + (skySharp * fres + glint) * fs.sheen.x;
  let frothy = lit + skySoft * fres * 0.3;
  let color = mix(glassy, frothy, white);
  // Thin edges fade into the scene rather than ending in a hard line.
  let alpha = smoothstep(0.0, fs.look.z, thick) * smoothstep(0.2, 0.8, cov);
  return vec4f(color * alpha, alpha);
}

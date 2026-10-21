// Stranded moon jellyfish (doc 13, summer; src/world/finds/jelly.js): a clear bell of jelly lying on
// the sand, drawn over what is behind it. Physically lit like the rest of the island: the wet top
// reflects the sky and makes a sharp sun glint (water-like Fresnel, F0 0.02); light through the bell
// is partly scattered by the jelly (its albedo) and partly passed on to the sand under it, by the
// optical depth each vertex carries along the view (thicker toward the middle, and the violet
// horseshoes denser still). Premultiplied: rgb is what the jelly adds, alpha how much of what lies
// behind it is hidden. Under each one the sand is darkened a little, wet where it lies.

// #include common
// #include lib-hash
// #include lighting-bindings
// #include lib-sky
// #include lib-lighting

struct JellyDraw {
  look: vec4f,   // x wet roughness, y specular strength, z wet sand under it (multiplier), w wet patch radius (widths)
  light: vec4f,  // x wrap (how far light reaches round the bell's side), y min n.v for the view path, zw spare
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var<uniform> jd: JellyDraw;
// Two vec4f per jellyfish: (x, y, z, yaw in radians), (size in meters, spare, spare, spare).
@group(2) @binding(1) var<storage, read> beings: array<vec4f>;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) albedo: vec3f,
  @location(3) tau: f32,
};

fn place(local: vec3f, at: vec4f, size: f32) -> vec3f {
  let c = cos(at.w);
  let s = sin(at.w);
  let p = local * size;
  return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z) + at.xyz;
}

@vertex
fn vsJelly(@location(0) position: vec3f, @location(1) normal: vec3f, @location(2) albedo: vec3f, @location(3) tau: f32,
           @builtin(instance_index) ii: u32) -> VsOut {
  let at = beings[ii * 2u];
  let size = beings[ii * 2u + 1u].x;
  let c = cos(at.w);
  let s = sin(at.w);
  var o: VsOut;
  o.world = place(position, at, size);
  o.pos = frame.viewProj * vec4f(o.world, 1.0);
  o.normal = vec3f(c * normal.x + s * normal.z, normal.y, -s * normal.x + c * normal.z);
  o.albedo = albedo;
  // The mesh is a meter wide; its optical depth is per meter of width.
  o.tau = tau * size;
  return o;
}

@fragment
fn fsJelly(in: VsOut) -> @location(0) vec4f {
  let n = normalize(in.normal);
  let viewDist = distance(in.world, frame.cameraPos);
  let v = (frame.cameraPos - in.world) / max(viewDist, 1e-4);
  let nv = max(dot(n, v), 0.0);
  let vis = shadowVisibility(in.world, n, viewDist, in.pos.xy);
  let casterIsSun = dot(light.shadowDir, frame.sunDir) > 0.999;
  let sunVis = select(1.0, vis, casterIsSun);
  let moonVis = select(vis, 1.0, casterIsSun);
  // Light scattered in the jelly: it lights the whole bell softly, round its side too (wrap).
  let w = jd.light.x;
  let sunIn = clamp((dot(n, frame.sunDir) + w) / (1.0 + w), 0.0, 1.0);
  let moonIn = clamp((dot(n, frame.moonDir) + w) / (1.0 + w), 0.0, 1.0);
  let scatter = in.albedo * ((frame.sunIlluminance * sunIn * sunVis + frame.moonIlluminance * moonIn * moonVis) / PI + skyAmbient(vec3f(0.0, 1.0, 0.0)));
  // How much of the light through it the jelly scatters on the way: longer paths at a glancing view.
  let a = 1.0 - exp(-in.tau / max(nv, jd.light.y));
  // The wet top: Fresnel reflection of the sky, and a sharp glint of sun and moon.
  let fres = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
  var radiance = (1.0 - fres) * a * scatter + fres * skyAmbient(reflect(-v, n)) / PI;
  radiance += jd.look.y * (frame.sunIlluminance * sunVis * ggxSpecular(n, v, frame.sunDir, jd.look.x, 0.02)
                         + frame.moonIlluminance * moonVis * ggxSpecular(n, v, frame.moonDir, jd.look.x, 0.02));
  let alpha = 1.0 - (1.0 - fres) * (1.0 - a);
  // Aerial perspective on what the jelly adds, weighted like an opaque surface of the same cover.
  let color = applyAerial(radiance * frame.exposure, in.pos.xy * frame.invRenderSize, viewDist);
  let safe = select(vec3f(0.0), color, color == color);
  return vec4f(max(safe, vec3f(0.0)), clamp(alpha, 0.0, 1.0));
}

// ---- wet sand: a soft darker patch under each one ----

struct WetOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

var<private> QUAD: array<vec2f, 6> = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
  vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

@vertex
fn vsWet(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> WetOut {
  let at = beings[ii * 2u];
  let size = beings[ii * 2u + 1u].x;
  let q = QUAD[vi];
  let local = vec3f(q.x * jd.look.w, 0.002 / size, q.y * jd.look.w);
  var o: WetOut;
  o.pos = frame.viewProj * vec4f(place(local, at, size), 1.0);
  o.uv = q;
  return o;
}

@fragment
fn fsWet(in: WetOut) -> @location(0) vec4f {
  let r = length(in.uv);
  let k = mix(jd.look.z, 1.0, smoothstep(0.55, 1.0, r));
  // Multiplied into the HDR color: 1 leaves it, less darkens it (wet sand is darker).
  return vec4f(vec3f(k), 1.0);
}

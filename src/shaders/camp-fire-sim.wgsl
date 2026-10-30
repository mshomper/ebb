// The camp fire's fluid (Matt's fire study, October 29, 2026; recipes/world/camp.json fireSim):
// smoke and heat on a small grid over a box standing on the ring. Each fixed step:
//   csAdvectVel   advect the velocity, add buoyancy, curl-noise turbulence, wind, damping, soft walls
//   csDivergence  the velocity's divergence
//   csJacobi      pressure passes (pressure 0 above the top, so smoke can leave)
//   csProject     subtract the pressure gradient
//   csAdvectDye   advect smoke and heat, cool and fade them, add the hot spots
// csCurl makes the 32^3 tiling curl-noise field once at setup. Visual only, never saved.
// The grid size comes from the textures, so the tiers can choose it.
// Bindings are unique across the file; each pipeline's 'auto' layout keeps the ones it uses.

struct FireSim {
  a: vec4f,   // dt, time, level, flare
  b: vec4f,   // wind xyz (m/s), smoke puff
  c: vec4f,   // buoyancy, smoke weight, cooling, smoke fade
  d: vec4f,   // turbulence, damping, emit heat, emit smoke
  box: vec4f, // box size xyz (m), spot count
  bmin: vec4f,// box min xyz (m, from the fire's foot), heat scale (rain)
  e: vec4f,   // smoke scale (rain), -, -, -
  spots: array<vec4f, 8>, // hot spots: xyz (m, from the fire's foot), share
};

@group(0) @binding(0) var<uniform> S: FireSim;
@group(0) @binding(1) var velIn: texture_3d<f32>;
@group(0) @binding(2) var dyeIn: texture_3d<f32>;
@group(0) @binding(3) var curlT: texture_3d<f32>;
@group(0) @binding(4) var sClamp: sampler;
@group(0) @binding(5) var sRep: sampler;
@group(0) @binding(6) var velOut: texture_storage_3d<rgba16float, write>;
@group(0) @binding(7) var divOut: texture_storage_3d<r32float, write>;
@group(0) @binding(8) var pIn: texture_3d<f32>;
@group(0) @binding(9) var divIn: texture_3d<f32>;
@group(0) @binding(10) var pOut: texture_storage_3d<r32float, write>;
@group(0) @binding(11) var dyeOut: texture_storage_3d<rgba16float, write>;
@group(0) @binding(12) var curlOut: texture_storage_3d<rgba16float, write>;

fn hash3(p: vec3f) -> f32 {
  var q = fract(p * 0.3183099 + vec3f(0.11, 0.17, 0.13));
  q = q * 17.0;
  return fract(q.x * q.y * q.z * (q.x + q.y + q.z));
}
fn vnoise(x: vec3f) -> f32 {
  let i = floor(x); let f = fract(x);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3f(1, 0, 0)), u.x), mix(hash3(i + vec3f(0, 1, 0)), hash3(i + vec3f(1, 1, 0)), u.x), u.y),
             mix(mix(hash3(i + vec3f(0, 0, 1)), hash3(i + vec3f(1, 0, 1)), u.x), mix(hash3(i + vec3f(0, 1, 1)), hash3(i + vec3f(1, 1, 1)), u.x), u.y), u.z);
}

fn uvwOf(id: vec3u, n: vec3u) -> vec3f { return (vec3f(id) + 0.5) / vec3f(n); }
fn cl(c: vec3<i32>, n: vec3<i32>) -> vec3<i32> { return clamp(c, vec3<i32>(0), n - 1); }

// ---- curl noise, once ----
const CURL_P = 4.0;   // lattice cells across the tile, so it tiles
fn hp(i: vec3f, s: f32) -> f32 {
  let w = i - CURL_P * floor(i / CURL_P);
  return fract(sin(dot(w + s, vec3f(127.1, 311.7, 74.7))) * 43758.5453);
}
fn pn(x: vec3f, s: f32) -> f32 {
  let i = floor(x); let f = fract(x); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hp(i, s), hp(i + vec3f(1, 0, 0), s), u.x), mix(hp(i + vec3f(0, 1, 0), s), hp(i + vec3f(1, 1, 0), s), u.x), u.y),
             mix(mix(hp(i + vec3f(0, 0, 1), s), hp(i + vec3f(1, 0, 1), s), u.x), mix(hp(i + vec3f(0, 1, 1), s), hp(i + vec3f(1, 1, 1), s), u.x), u.y), u.z);
}
fn pot(x: vec3f) -> vec3f { return vec3f(pn(x, 0.0), pn(x, 31.4), pn(x, 77.7)); }

@compute @workgroup_size(4, 4, 4)
fn csCurl(@builtin(global_invocation_id) id: vec3u) {
  let n = textureDimensions(curlOut);
  if (any(id >= n)) { return; }
  let x = (vec3f(id) + 0.5) / vec3f(n) * CURL_P;
  let e = 0.05;
  let dx = vec3f(e, 0, 0); let dy = vec3f(0, e, 0); let dz = vec3f(0, 0, e);
  let px0 = pot(x - dx); let px1 = pot(x + dx);
  let py0 = pot(x - dy); let py1 = pot(x + dy);
  let pz0 = pot(x - dz); let pz1 = pot(x + dz);
  let c = vec3f((py1.z - py0.z) - (pz1.y - pz0.y),
                (pz1.x - pz0.x) - (px1.z - px0.z),
                (px1.y - px0.y) - (py1.x - py0.x)) / (2.0 * e);
  textureStore(curlOut, vec3<i32>(id), vec4f(c * 0.35, 0.0));
}

// ---- 1. advect the velocity, add the forces ----
@compute @workgroup_size(4, 4, 4)
fn csAdvectVel(@builtin(global_invocation_id) id: vec3u) {
  let n = textureDimensions(velIn);
  if (any(id >= n)) { return; }
  let dt = S.a.x; let t = S.a.y; let box = S.box.xyz;
  let uvw = uvwOf(id, n);
  let v0 = textureSampleLevel(velIn, sClamp, uvw, 0.0).xyz;
  var v = textureSampleLevel(velIn, sClamp, uvw - v0 * dt / box, 0.0).xyz;
  let dye = textureSampleLevel(dyeIn, sClamp, uvw, 0.0);
  let smoke = dye.r; let heat = dye.g;
  // buoyancy: hot gas rises, smoke weighs a little
  v.y += (heat * S.c.x - smoke * S.c.y) * dt;
  // turbulence from a scrolling curl field: strong in the flame, gentle in the smoke
  let q1 = uvw * vec3f(1.4, 2.1, 1.4) - vec3f(0.0, t * 0.55, t * 0.07);
  let q2 = uvw * vec3f(0.6, 0.9, 0.6) - vec3f(t * 0.03, t * 0.16, 0.0);
  let c1 = textureSampleLevel(curlT, sRep, q1, 0.0).xyz;
  let c2 = textureSampleLevel(curlT, sRep, q2, 0.0).xyz;
  v += (c1 * S.d.x * min(heat, 1.5) + c2 * S.d.x * 0.35 * min(smoke, 1.0)) * dt;
  // the wind pulls the upper gas sideways
  let h = clamp(uvw.y * 1.6, 0.15, 1.0);
  v.x += (S.b.x - v.x) * 1.2 * h * dt;
  v.z += (S.b.z - v.z) * 1.2 * h * dt;
  v *= max(1.0 - S.d.y * dt, 0.0);
  // soft walls on the sides and floor, the top open
  let e2 = min(uvw.xz, 1.0 - uvw.xz);
  v *= smoothstep(0.0, 0.07, min(min(e2.x, e2.y), uvw.y * 2.0));
  textureStore(velOut, vec3<i32>(id), vec4f(v, 0.0));
}

// ---- 2. divergence ----
@compute @workgroup_size(4, 4, 4)
fn csDivergence(@builtin(global_invocation_id) id: vec3u) {
  let n = vec3<i32>(textureDimensions(velIn));
  if (any(vec3<i32>(id) >= n)) { return; }
  let c = vec3<i32>(id);
  let vr = textureLoad(velIn, cl(c + vec3<i32>(1, 0, 0), n), 0).x;
  let vl = textureLoad(velIn, cl(c - vec3<i32>(1, 0, 0), n), 0).x;
  let vu = textureLoad(velIn, cl(c + vec3<i32>(0, 1, 0), n), 0).y;
  let vd = textureLoad(velIn, cl(c - vec3<i32>(0, 1, 0), n), 0).y;
  let vf = textureLoad(velIn, cl(c + vec3<i32>(0, 0, 1), n), 0).z;
  let vb = textureLoad(velIn, cl(c - vec3<i32>(0, 0, 1), n), 0).z;
  textureStore(divOut, c, vec4f(0.5 * ((vr - vl) + (vu - vd) + (vf - vb)), 0, 0, 0));
}

// pressure, 0 above the top of the grid
fn pAt(c: vec3<i32>, n: vec3<i32>) -> f32 {
  if (c.y >= n.y) { return 0.0; }
  return textureLoad(pIn, cl(c, n), 0).x;
}

// ---- 3. a Jacobi pressure pass ----
@compute @workgroup_size(4, 4, 4)
fn csJacobi(@builtin(global_invocation_id) id: vec3u) {
  let n = vec3<i32>(textureDimensions(pIn));
  if (any(vec3<i32>(id) >= n)) { return; }
  let c = vec3<i32>(id);
  let s = pAt(c + vec3<i32>(1, 0, 0), n) + pAt(c - vec3<i32>(1, 0, 0), n) + pAt(c + vec3<i32>(0, 1, 0), n) +
          pAt(c - vec3<i32>(0, 1, 0), n) + pAt(c + vec3<i32>(0, 0, 1), n) + pAt(c - vec3<i32>(0, 0, 1), n);
  textureStore(pOut, c, vec4f((s - textureLoad(divIn, c, 0).x) / 6.0, 0, 0, 0));
}

// ---- 4. subtract the pressure gradient ----
@compute @workgroup_size(4, 4, 4)
fn csProject(@builtin(global_invocation_id) id: vec3u) {
  let n = vec3<i32>(textureDimensions(pIn));
  if (any(vec3<i32>(id) >= n)) { return; }
  let c = vec3<i32>(id);
  let g = 0.5 * vec3f(pAt(c + vec3<i32>(1, 0, 0), n) - pAt(c - vec3<i32>(1, 0, 0), n),
                      pAt(c + vec3<i32>(0, 1, 0), n) - pAt(c - vec3<i32>(0, 1, 0), n),
                      pAt(c + vec3<i32>(0, 0, 1), n) - pAt(c - vec3<i32>(0, 0, 1), n));
  textureStore(velOut, c, vec4f(textureLoad(velIn, c, 0).xyz - g, 0.0));
}

// ---- 5. advect smoke and heat, cool, fade, add the hot spots ----
@compute @workgroup_size(4, 4, 4)
fn csAdvectDye(@builtin(global_invocation_id) id: vec3u) {
  let n = textureDimensions(dyeIn);
  if (any(id >= n)) { return; }
  let dt = S.a.x; let t = S.a.y; let L = S.a.z; let box = S.box.xyz;
  let uvw = uvwOf(id, n);
  let v = textureSampleLevel(velIn, sClamp, uvw, 0.0).xyz;
  let d = textureSampleLevel(dyeIn, sClamp, uvw - v * dt / box, 0.0);
  var smoke = d.r * max(1.0 - S.c.w * dt, 0.0);
  var heat = d.g * max(1.0 - S.c.z * dt * (1.0 + 0.35 * d.g), 0.0);

  // the hot spots, each flickering, wider as the level rises
  let p = S.bmin.xyz + uvw * box;
  let sig = 0.03 + 0.035 * clamp(L, 0.0, 1.2);
  var src = 0.0;
  let count = i32(S.box.w);
  for (var i = 0; i < count; i++) {
    let fi = f32(i);
    let sp = S.spots[i];
    let fl = 0.45 + 0.55 * vnoise(vec3f(fi * 7.1, t * 2.6, 0.0));
    let dd = p - sp.xyz;
    src += exp(-dot(dd, dd) / (sig * sig)) * fl * sp.w;
  }
  let drive = clamp(L, 0.0, 1.3);
  heat += S.d.z * S.bmin.w * drive * src * dt;
  smoke += S.d.w * S.e.x * (0.25 + 0.6 * drive + S.b.w * 3.0) * src * dt;
  heat = min(heat, 3.0);
  smoke = min(smoke, 3.0);
  // fade at the top and sides so nothing piles up against the box
  let e2 = min(uvw.xz, 1.0 - uvw.xz);
  let fade = smoothstep(0.0, 0.1, min(e2.x, e2.y)) * (1.0 - smoothstep(0.82, 1.0, uvw.y));
  smoke *= mix(1.0, fade, 0.25);
  heat *= mix(1.0, fade, 0.5);
  textureStore(dyeOut, vec3<i32>(id), vec4f(smoke, heat, 0.0, 1.0));
}

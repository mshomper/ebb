// @ts-check
// tools/fire-lab.html's own WGSL: the study's raymarched camp scene (stones, logs, coal bed, ground,
// sky), copied as Matt judged it in tools/fire-study.html, then the fire volume marched in its own
// pass (at full or half resolution, as the tiers will draw it), then a composite that lays the smoke
// over the scene and paints the banded flame (src/shaders/lib-fire-bands.wgsl, as the game will).
// The game's own drawing (F3) marches against the scene depth and paints in the tonemap pass.

const COMMON = /* wgsl */ `
struct U {
  camPos: vec4f,   // xyz, time
  camFwd: vec4f,   // xyz, aspect
  camRight: vec4f, // xyz, tan(fov/2)
  camUp: vec4f,    // xyz, -
  fire: vec4f,     // level, flare, stylize, ember glow
  light: vec4f,    // light pos, intensity
  lightCol: vec4f, // rgb, flicker
  sky: vec4f,      // zenith rgb, ambient
  sky2: vec4f,     // horizon rgb, star amount
  sun: vec4f,      // dir, intensity
  sunCol: vec4f,   // rgb, exposure
  misc: vec4f,     // full width, full height, frame, smoke puff
  wind: vec4f,     // xyz
  smokeCol: vec4f, // rgb
  vol: vec4f,      // samples, scale, smoke density, heat gain
  detail: vec4f,   // heat detail cycles a meter xyz
  bmin: vec4f,     // box corner xyz (m)
  bsize: vec4f,    // box size xyz (m)
  volSize: vec4f,  // volume target width, height
};
@group(0) @binding(0) var<uniform> u: U;

struct VSOut { @builtin(position) pos: vec4f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
  var p = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  var o: VSOut; o.pos = vec4f(p[i], 0, 1); return o;
}
// The view ray through a pixel of a target this size.
fn rayDir(pix: vec2f, size: vec2f) -> vec3f {
  let uv = vec2f(pix.x / size.x * 2.0 - 1.0, 1.0 - pix.y / size.y * 2.0);
  return normalize(u.camFwd.xyz + u.camRight.xyz * uv.x * u.camFwd.w * u.camRight.w + u.camUp.xyz * uv.y * u.camRight.w);
}
fn hash3(p: vec3f) -> f32 {
  var q = fract(p * 0.3183099 + vec3f(0.11, 0.17, 0.13));
  q = q * 17.0;
  return fract(q.x * q.y * q.z * (q.x + q.y + q.z));
}
fn vnoise(x: vec3f) -> f32 {
  let i = floor(x); let f = fract(x);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash3(i);
  let b = hash3(i + vec3f(1,0,0));
  let c = hash3(i + vec3f(0,1,0));
  let d = hash3(i + vec3f(1,1,0));
  let e = hash3(i + vec3f(0,0,1));
  let g = hash3(i + vec3f(1,0,1));
  let h = hash3(i + vec3f(0,1,1));
  let k = hash3(i + vec3f(1,1,1));
  return mix(mix(mix(a,b,u.x), mix(c,d,u.x), u.y), mix(mix(e,g,u.x), mix(h,k,u.x), u.y), u.z);
}
fn fbm3(x: vec3f) -> f32 {
  var s = 0.0; var a = 0.5; var p = x;
  for (var i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.03 + vec3f(1.7, 9.2, 3.1); a *= 0.5; }
  return s / 0.875;
}
fn aces(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}
`;

/** Pass 1: the camp scene, its display colour and the distance along each ray to what it hit. */
export const SCENE = COMMON + /* wgsl */ `
// ---------- scene ----------
fn sdEllipsoid(p: vec3f, r: vec3f) -> f32 {
  let k0 = length(p / r); let k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-5);
}
fn sdCapsule(p: vec3f, a: vec3f, b: vec3f, r: f32) -> f32 {
  let pa = p - a; let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
fn rotY(p: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(c*p.x - s*p.z, p.y, s*p.x + c*p.z); }

const NSTONE = 11;
const NLOG = 5;
fn logEnds(i: i32) -> array<vec3f,2> {
  let a = f32(i) * 6.2831853 / f32(NLOG) + 0.4;
  let base = vec3f(cos(a) * 0.27, 0.035, sin(a) * 0.27);
  let top = vec3f(cos(a + 0.5) * 0.035, 0.30, sin(a + 0.5) * 0.035);
  return array<vec3f,2>(base, top);
}
// returns (distance, material): 1 stone, 2 log, 3 coal bed
fn map(p: vec3f) -> vec2f {
  var res = vec2f(1e9, 0.0);
  for (var i = 0; i < NSTONE; i++) {
    let fi = f32(i);
    let a = fi * 6.2831853 / f32(NSTONE) + 0.25 * (hash3(vec3f(fi, 1.0, 2.0)) - 0.5);
    let r = 0.43 + 0.03 * hash3(vec3f(fi, 3.0, 1.0));
    let c = vec3f(cos(a) * r, 0.02, sin(a) * r);
    let s = vec3f(0.085 + 0.03 * hash3(vec3f(fi, 5.0, 2.0)), 0.06 + 0.025 * hash3(vec3f(fi, 7.0, 3.0)), 0.07);
    let q = rotY(p - c, a + hash3(vec3f(fi, 9.0, 4.0)) * 0.6);
    let d = sdEllipsoid(q, s);
    if (d < res.x) { res = vec2f(d, 1.0); }
  }
  for (var i = 0; i < NLOG; i++) {
    let e = logEnds(i);
    let d = sdCapsule(p, e[0], e[1], 0.036 - 0.004 * f32(i % 2));
    if (d < res.x) { res = vec2f(d, 2.0); }
  }
  let dc = sdEllipsoid(p - vec3f(0.0, 0.0, 0.0), vec3f(0.2, 0.04, 0.2)) - 0.008 * vnoise(p * 30.0);
  if (dc < res.x) { res = vec2f(dc, 3.0); }
  return res;
}
fn calcNormal(p: vec3f) -> vec3f {
  let e = vec2f(0.0015, 0.0);
  return normalize(vec3f(map(p + e.xyy).x - map(p - e.xyy).x,
                         map(p + e.yxy).x - map(p - e.yxy).x,
                         map(p + e.yyx).x - map(p - e.yyx).x));
}
fn sphereHit(ro: vec3f, rd: vec3f, c: vec3f, r: f32) -> vec2f {
  let oc = ro - c; let b = dot(oc, rd); let h = b * b - dot(oc, oc) + r * r;
  if (h < 0.0) { return vec2f(-1.0); }
  let s = sqrt(h); return vec2f(-b - s, -b + s);
}
fn softShadow(ro: vec3f, rd: vec3f, maxt: f32) -> f32 {
  var res = 1.0; var t = 0.02;
  for (var i = 0; i < 24; i++) {
    if (t >= maxt) { break; }
    let h = map(ro + rd * t).x;
    res = min(res, 10.0 * h / t);
    if (res < 0.01) { break; }
    t += clamp(h, 0.01, 0.08);
  }
  return clamp(res, 0.0, 1.0);
}

fn skyColor(rd: vec3f) -> vec3f {
  let h = clamp(rd.y, -0.1, 1.0);
  var c = mix(u.sky2.rgb, u.sky.rgb, pow(max(h, 0.0), 0.55));
  // a hint of sun / moon disc glow
  let sd = max(dot(rd, u.sun.xyz), 0.0);
  c += u.sunCol.rgb * (pow(sd, 400.0) * 1.5 + pow(sd, 12.0) * 0.12) * min(u.sun.w, 1.0);
  // stars at night
  if (u.sky2.w > 0.0 && rd.y > 0.02) {
    let g = floor(rd * 220.0);
    let s = hash3(g);
    c += vec3f(1.0, 0.95, 0.85) * step(0.9965, s) * u.sky2.w * smoothstep(0.02, 0.3, rd.y);
  }
  return c;
}

fn fireFalloff(d: f32) -> f32 { return 1.0 / (d * d * 6.0 + 0.12); }

fn shade(p: vec3f, n: vec3f, mat: f32, rd: vec3f) -> vec3f {
  let t = u.camPos.w;
  let glow = u.fire.w; let L = u.fire.x;
  var alb = vec3f(0.5);
  var emis = vec3f(0.0);
  if (mat < 0.5) {
    // ground: ash near the ring → earth → soft moss
    let r = length(p.xz);
    let n1 = vnoise(vec3f(p.xz * 6.0, 0.0)); let n2 = vnoise(vec3f(p.xz * 1.3, 4.0));
    let ash = vec3f(0.24, 0.22, 0.22);
    let earth = vec3f(0.47, 0.40, 0.31) * (0.85 + 0.3 * n1);
    let moss = mix(vec3f(0.36, 0.47, 0.30), vec3f(0.44, 0.52, 0.32), n2) * (0.9 + 0.2 * n1);
    alb = mix(ash, earth, smoothstep(0.3, 0.55, r + 0.05 * n1));
    alb = mix(alb, moss, smoothstep(0.85, 1.6, r + 0.3 * n2));
  } else if (mat < 1.5) {
    let n1 = vnoise(p * 18.0);
    alb = mix(vec3f(0.52, 0.50, 0.49), vec3f(0.62, 0.59, 0.55), n1);
    // soot on the inside faces
    let inward = clamp(dot(n, -normalize(vec3f(p.x, 0.0, p.z))), 0.0, 1.0);
    alb *= 1.0 - 0.45 * inward * smoothstep(0.0, 0.08, p.y + 0.02);
  } else if (mat < 2.5) {
    let rr = length(p.xz);
    let charred = 1.0 - smoothstep(0.05, 0.22, rr);
    alb = mix(vec3f(0.36, 0.25, 0.18), vec3f(0.09, 0.075, 0.07), charred);
    // glowing cracks on the charred part
    let cr = vnoise(vec3f(p.x * 45.0, p.y * 18.0, p.z * 45.0));
    let crack = smoothstep(0.62, 0.8, cr) * charred;
    let pulse = 0.75 + 0.25 * vnoise(vec3f(p.xz * 8.0, t * 0.8));
    emis = mix(vec3f(0.9, 0.22, 0.08), vec3f(1.0, 0.55, 0.18), crack * glow) * crack * glow * pulse * 2.2;
  } else {
    // coal bed
    let c1 = vnoise(p * 34.0 + vec3f(0.0, t * 0.15, 0.0));
    alb = vec3f(0.08, 0.07, 0.07);
    let hot = smoothstep(0.35, 0.75, c1) * (1.0 - smoothstep(0.05, 0.2, length(p.xz)) * 0.0);
    let pulse = 0.7 + 0.3 * vnoise(vec3f(p.xz * 6.0, t * 0.7));
    emis = mix(vec3f(0.75, 0.12, 0.06), vec3f(1.0, 0.5, 0.15), hot) * (0.25 + hot) * glow * pulse * 2.0;
  }

  // light
  let amb = u.sky.w * (0.55 + 0.45 * n.y) * mix(u.sky2.rgb, u.sky.rgb, 0.6);
  var col = alb * amb;
  let sunD = max(dot(n, u.sun.xyz), 0.0);
  col += alb * u.sunCol.rgb * u.sun.w * sunD;
  // fire light — a vertical capsule rather than a point, with a projected flicker
  let lp = u.light.xyz;
  let segA = vec3f(lp.x, 0.12, lp.z);
  let segB = lp;
  let ba = segB - segA;
  let hh = clamp(dot(p - segA, ba) / dot(ba, ba), 0.0, 1.0);
  let cp = segA + ba * hh;
  let toL = cp - p; let dl = length(toL); let ldir = toL / dl;
  let nd = max(dot(n, ldir), 0.0);
  let sh = softShadow(p + n * 0.004, ldir, dl - 0.05);
  let proj = 0.82 + 0.36 * vnoise(vec3f(p.xz * 3.5, t * 2.2));
  col += alb * u.lightCol.rgb * u.light.w * fireFalloff(dl) * nd * mix(0.15, 1.0, sh) * proj;
  col += emis;
  return col;
}

struct SceneOut { @location(0) col: vec4f, @location(1) depth: f32 };
@fragment fn fs(in: VSOut) -> SceneOut {
  let ro = u.camPos.xyz;
  let rd = rayDir(in.pos.xy, u.misc.xy);
  var tHit = 1e9; var mat = -1.0;
  if (rd.y < 0.0) { tHit = -ro.y / rd.y; mat = 0.0; }
  let bs = sphereHit(ro, rd, vec3f(0.0, 0.12, 0.0), 0.62);
  if (bs.y > 0.0) {
    var tt = max(bs.x, 0.0);
    let tEnd = min(bs.y, tHit);
    for (var i = 0; i < 90; i++) {
      if (tt > tEnd) { break; }
      let h = map(ro + rd * tt);
      if (h.x < 0.0008 * tt + 0.0004) { tHit = tt; mat = h.y; break; }
      tt += h.x * 0.9;
    }
  }
  var col: vec3f;
  if (mat < -0.5) {
    col = skyColor(rd);
  } else {
    let p = ro + rd * tHit;
    var n = vec3f(0.0, 1.0, 0.0);
    if (mat > 0.5) { n = calcNormal(p); }
    col = shade(p, n, mat, rd);
    let fogT = 1.0 - exp(-max(tHit - 3.0, 0.0) * 0.18);
    col = mix(col, skyColor(normalize(vec3f(rd.x, 0.02, rd.z))), fogT);
  }
  var o: SceneOut;
  o.col = vec4f(aces(col * u.sunCol.w), 1.0);
  o.depth = min(tHit, 1e6);
  return o;
}
`;

/** Pass 2: the fire volume at the tier's share of the size: smoke over transmittance, and the heat collected. */
export const VOLUME = COMMON + /* wgsl */ `
@group(0) @binding(1) var dyeT: texture_3d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var depthT: texture_2d<f32>;

fn boxHit(ro: vec3f, rd: vec3f) -> vec2f {
  let inv = 1.0 / rd;
  let t0 = (u.bmin.xyz - ro) * inv; let t1 = (u.bmin.xyz + u.bsize.xyz - ro) * inv;
  let tmin = min(t0, t1); let tmax = max(t0, t1);
  return vec2f(max(max(tmin.x, tmin.y), max(tmin.z, 0.0)), min(min(tmax.x, tmax.y), tmax.z));
}

struct VolOut { @location(0) smoke: vec4f, @location(1) heat: vec2f };
@fragment fn fs(in: VSOut) -> VolOut {
  let t = u.camPos.w;
  let ro = u.camPos.xyz;
  let rd = rayDir(in.pos.xy, u.volSize.xy);
  // The nearest scene depth under this texel (a half-size texel covers 2 x 2 full pixels).
  let f = i32(round(1.0 / u.vol.y));
  let base = vec2<i32>(floor(in.pos.xy)) * f;
  let full = vec2<i32>(u.misc.xy) - 1;
  var tHit = 1e9;
  for (var y = 0; y < f; y++) {
    for (var x = 0; x < f; x++) {
      tHit = min(tHit, textureLoad(depthT, min(base + vec2<i32>(x, y), full), 0).x);
    }
  }
  let bh = boxHit(ro, rd);
  let tA = bh.x; let tB = min(bh.y, tHit);
  var heatAcc = 0.0;
  var trans = 1.0;
  var smokeAcc = vec3f(0.0);
  if (tB > tA) {
    let STEPS = i32(u.vol.x);
    let ds = (tB - tA) / f32(STEPS);
    let jit = fract(hash3(vec3f(in.pos.xy, u.misc.z * 0.1)) + u.misc.z * 0.618034);
    var tt = tA + ds * jit;
    for (var i = 0; i < STEPS; i++) {
      let p = ro + rd * tt;
      let uvw = (p - u.bmin.xyz) / u.bsize.xyz;
      let d = textureSampleLevel(dyeT, samp, uvw, 0.0);
      var smoke = d.r; var heat = d.g;
      if (heat > 0.02) {
        // sub-voxel detail so the coarse grid does not read as blur
        let dn = vnoise(p * u.detail.xyz - vec3f(0.0, t * 2.6, 0.0));
        heat *= 0.55 + 0.9 * dn;
      }
      smoke *= 0.7 + 0.6 * vnoise(p * 7.0 - vec3f(0.0, t * 0.6, 0.0));
      let sig = smoke * u.vol.z;
      heat = max(heat - 0.05, 0.0);
      heatAcc += heat * u.vol.w * ds * trans;
      if (sig > 0.001) {
        // smoke lit by the sky and the sun, and warmly from the fire beneath it; blended, never added
        let dl = length(p - u.light.xyz);
        let warm = u.lightCol.rgb * u.light.w * 0.06 / (dl * dl * 3.0 + 0.1);
        let lit = u.smokeCol.rgb * (u.sky.w * 0.9 + u.sun.w * 0.5) + warm;
        let a = 1.0 - exp(-sig * ds);
        smokeAcc += trans * a * aces(lit * u.sunCol.w);
        trans *= 1.0 - a;
      }
      tt += ds;
    }
  }
  var o: VolOut;
  o.smoke = vec4f(smokeAcc, trans);
  o.heat = vec2f(heatAcc, tHit);
  return o;
}
`;

/**
 * Pass 3: smoke over the scene, then the painted flame, to the screen.
 * @param {string} BANDS src/shaders/lib-fire-bands.wgsl
 */
export const composite = (BANDS) => COMMON + BANDS + /* wgsl */ `
@group(0) @binding(1) var sceneT: texture_2d<f32>;
@group(0) @binding(2) var depthT: texture_2d<f32>;
@group(0) @binding(3) var volSmokeT: texture_2d<f32>;
@group(0) @binding(4) var volHeatT: texture_2d<f32>;
@group(0) @binding(5) var<uniform> B: FireBands;

@fragment fn fs(in: VSOut) -> @location(0) vec4f {
  let pix = vec2<i32>(floor(in.pos.xy));
  let col = textureLoad(sceneT, pix, 0).rgb;
  var smoke = vec4f(0.0, 0.0, 0.0, 1.0);
  var heat = 0.0;
  if (u.vol.y >= 0.999) {
    smoke = textureLoad(volSmokeT, pix, 0);
    heat = textureLoad(volHeatT, pix, 0).x;
  } else {
    // depth-aware upsample: the four nearest volume texels, each weighted by how near the depth it
    // marched against is to this pixel's own
    let d0 = min(textureLoad(depthT, pix, 0).x, 50.0);
    let hp = in.pos.xy * u.vol.y - 0.5;
    let b = vec2<i32>(floor(hp));
    let fr = hp - floor(hp);
    let vmax = vec2<i32>(u.volSize.xy) - 1;
    var wsum = 0.0;
    var best = 1e9; var bestS = smoke; var bestH = 0.0;
    var acc = vec4f(0.0); var hacc = 0.0;
    for (var j = 0; j < 4; j++) {
      let o = vec2<i32>(j & 1, j >> 1);
      let q = clamp(b + o, vec2<i32>(0), vmax);
      let bil = select(1.0 - fr.x, fr.x, o.x == 1) * select(1.0 - fr.y, fr.y, o.y == 1);
      let s = textureLoad(volSmokeT, q, 0);
      let h = textureLoad(volHeatT, q, 0);
      let dd = abs(min(h.y, 50.0) - d0);
      let w = bil * exp(-dd / (0.02 + 0.03 * d0)) + 1e-5 * bil;
      acc += s * w; hacc += h.x * w; wsum += w;
      if (dd < best) { best = dd; bestS = s; bestH = h.x; }
    }
    if (wsum > 1e-4) { smoke = acc / wsum; heat = hacc / wsum; } else { smoke = bestS; heat = bestH; }
  }
  var c = col * smoke.a + smoke.rgb;
  c = firePaint(B, c, heat, min(u.fire.x * 2.0 + 0.2, 1.0));
  return vec4f(c, 1.0);
}
`;

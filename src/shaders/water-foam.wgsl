// Foam on the live water (docs/07 "Foam"): a coverage field on the 0.5 m water cells, carried by
// the current (semi-Lagrangian: each cell looks back along its velocity), fading over a few
// seconds, and made where water churns:
//   falls        the surface drops sharply into a downstream neighbor (little steps, the spring's run)
//   convergence  flows meet and pile up (−div u), where streams enter ponds
//   churn        fast, shallow water tumbling over its bed (the stream's riffles, beach swash)
// Visual only, real seconds; water-draw.wgsl draws it broken into lace with its own noise.

// #include lib-terrain
// #include lib-water

struct Foam {
  rectOrigin: vec2u, rectSize: vec2u,
  dt: f32, fadeMoving: f32,       // real step (s); fade time (s) on moving water
  fallFrom: f32, fallGain: f32,   // surface drop per cell (m) where falls start foaming; foam per m beyond it, per s
  convGain: f32, swashGain: f32,  // foam per unit convergence (1/s) per s; foam per s in full churn
  swashDepth: f32, swashSpeed: f32, // churn: shallower than this (m), fading in from this speed (m/s)
  dry: f32, maxFoam: f32,
  swashSpeedHi: f32, fadeStill: f32, // ... to full churn at this speed (m/s); fade time (s) on still water
  spread: f32, stillBelow: f32,     // spreading rate on still water (per s); water slower than this (m/s) counts as still
  plungeGain: f32, plungeFrom: f32, // waterfall foot: foam per s per m2/s falling in; bed drop (m) that counts as a fall
};

@group(0) @binding(0) var<uniform> fm: Foam;
@group(0) @binding(1) var heightTex: texture_2d<f32>;
@group(0) @binding(2) var depthTex: texture_2d<f32>;
@group(0) @binding(3) var velTex: texture_2d<f32>;
@group(0) @binding(4) var foamIn: texture_2d<f32>;
@group(0) @binding(5) var foamOut: texture_storage_2d<r32float, write>;

fn inRect(c: vec2i) -> bool {
  let o = vec2i(fm.rectOrigin);
  return all(c >= o) && all(c < o + vec2i(fm.rectSize));
}

fn foamAt(c: vec2i) -> f32 {
  if (!inRect(c)) { return 0.0; }
  return textureLoad(foamIn, c, 0).r;
}

fn velAt(c: vec2i) -> vec2f {
  if (!inRect(c)) { return vec2f(0.0); }
  return textureLoad(velTex, c, 0).rg;
}

// Foam at a fractional cell position, bilinear.
fn foamBilinear(p: vec2f) -> f32 {
  let c = vec2i(floor(p));
  let f = p - floor(p);
  return mix(mix(foamAt(c), foamAt(c + vec2i(1, 0)), f.x), mix(foamAt(c + vec2i(0, 1)), foamAt(c + vec2i(1, 1)), f.x), f.y);
}

@compute @workgroup_size(8, 8)
fn csFoam(@builtin(global_invocation_id) gid: vec3u) {
  if (any(gid.xy >= fm.rectSize)) { return; }
  let c = vec2i(gid.xy + fm.rectOrigin);
  let d = textureLoad(depthTex, c, 0).r;
  // Films of a few millimeters (spilling over a bank) hold no foam.
  if (d < 0.01) {
    textureStore(foamOut, vec2u(c), vec4f(0.0));
    return;
  }
  let v = velAt(c);
  let speed = length(v);
  // Carried by the current: what was upstream one step ago arrives here.
  var foam = foamBilinear(vec2f(c) - v * fm.dt / WATER_CELL);
  // On still water foam spreads out (it floats apart into a thin veil) and lingers; on moving
  // water it is carried and breaks up sooner.
  let still = 1.0 - smoothstep(fm.stillBelow * 0.5, fm.stillBelow, speed);
  let around = 0.25 * (foamAt(c + vec2i(1, 0)) + foamAt(c - vec2i(1, 0)) + foamAt(c + vec2i(0, 1)) + foamAt(c - vec2i(0, 1)));
  // Moving water mixes too, a little, so neighboring cells never differ sharply (no patchwork).
  foam = mix(foam, around, min(fm.spread * mix(0.3, 1.0, still) * fm.dt, 0.5));
  foam *= exp(-fm.dt / mix(fm.fadeMoving, fm.fadeStill, still));

  // Falls: the steepest surface drop into a neighbor the water is flowing toward.
  let s = waterBed(heightTex, c) + d;
  var drop = 0.0;
  let nb = array<vec2i, 4>(vec2i(1, 0), vec2i(-1, 0), vec2i(0, 1), vec2i(0, -1));
  for (var i = 0; i < 4; i++) {
    let q = c + nb[i];
    if (!inRect(q)) { continue; }
    let dq = textureLoad(depthTex, q, 0).r;
    if (dq < fm.dry * 3.0) { continue; }
    let toward = dot(v, vec2f(nb[i]));
    if (toward <= 0.0) { continue; }
    drop = max(drop, s - (waterBed(heightTex, q) + dq));
  }
  var make = fm.fallGain * max(drop - fm.fallFrom, 0.0) * min(speed / 0.3, 1.0);

  // Plunge (M2 waterfalls): water falling in from a neighbor whose bed stands well above this one
  // churns white where it lands.
  let bedC = waterBed(heightTex, c);
  for (var i = 0; i < 4; i++) {
    let q = c + nb[i];
    if (!inRect(q) || waterBed(heightTex, q) - bedC < fm.plungeFrom) { continue; }
    let inflow = textureLoad(depthTex, q, 0).r * max(dot(velAt(q), -vec2f(nb[i])), 0.0);
    make += fm.plungeGain * inflow;
  }

  // Convergence: flows meeting (negative divergence).
  let div = (velAt(c + vec2i(1, 0)).x - velAt(c - vec2i(1, 0)).x + velAt(c + vec2i(0, 1)).y - velAt(c - vec2i(0, 1)).y)
          / (2.0 * WATER_CELL);
  make += fm.convGain * max(-div, 0.0);

  // Churn: fast, shallow water tumbling over its bed takes in air (stream riffles, beach swash).
  // Real churn is a centimeter or more deep; films spilling over a bank never froth.
  make += fm.swashGain * smoothstep(0.012, 0.02, d) * (1.0 - smoothstep(fm.swashDepth * 0.5, fm.swashDepth, d))
        * smoothstep(fm.swashSpeed, fm.swashSpeedHi, speed);

  foam = clamp(foam + make * fm.dt, 0.0, fm.maxFoam);
  if (foam != foam) { foam = 0.0; }
  textureStore(foamOut, vec2u(c), vec4f(foam, 0.0, 0.0, 0.0));
}

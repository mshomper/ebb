// Waterfall drawing (M2 Cliff tool): the lips water-falls.wgsl found, one curtain strip each from the
// edge along a gravity arc, and a few soft spray puffs where strong falls land. Drawn after the
// water, blended into the HDR (premultiplied), depth tested, never written. Lit physically like a
// rough surface; the palette applies at the tonemap (docs/05).

// #include common
// #include lib-hash
// #include lighting-bindings
// #include lib-sky
// #include lib-lighting

struct Falls {
  rectOrigin: vec2u, rectSize: vec2u,
  minDrop: f32, minDepth: f32, minSpeed: f32, cap: u32,
  rows: u32, time: f32, offset: f32, widthScale: f32,
  qThreads: f32, qSheet: f32, streakM: f32, streakRate: f32,
  albedo: f32, opacity: f32, sprayFrom: f32, sprayM: f32,
  sprayOpacity: f32, lipStep: f32, lipReach: f32, sprayPuffs: u32,
  thickMin: f32, thickMax: f32, bulkM: f32, _p0: f32,  // the water's thickness at a thread and at a sheet (m); the drop it bulks out over (m)
};

struct Lip {
  a: vec4f,   // edge x, top height, edge z, foot height
  b: vec4f,   // direction x, z, speed off the lip (m/s), flow q (m2/s)
  c: vec4f,   // x 1 if a lip falls beside it on its +side end, y the same on its other end
};

const G_FALL: f32 = 9.81;
const WATER_HALF: f32 = 0.25;   // half a water cell: each lip is 0.5 m wide

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var<uniform> fl: Falls;
@group(2) @binding(1) var<storage, read> lips: array<Lip>;

struct CurtainOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) tau: f32,          // seconds since the water at this point left the lip
  @location(3) fallen: f32,       // meters it has dropped
  @location(4) across: f32,       // meters along the edge, continuous between neighboring lips
  @location(5) @interpolate(flat) q: f32,
  @location(6) @interpolate(flat) height: f32,
  @location(7) side: f32,         // 0..1 across this lip's strip
  @location(8) @interpolate(flat) ends: vec2f,  // 1 where another lip carries the fall on past this end (side 1, side 0)
  @location(9) @interpolate(flat) layer: f32,   // 0 back (against the rock), 1 middle, 2 front
};

// How full the curtain is for a flow: 0 at a thread, 1 at a full sheet.
fn fullness(q: f32) -> f32 {
  return smoothstep(fl.qThreads, fl.qSheet, q);
}

// Columns across each lip's strip, so a free end can round over.
const COLS: u32 = 4u;

@vertex
fn vsCurtain(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> CurtainOut {
  let lip = lips[ii];
  // Three layers through the water's thickness (back, middle, front), each rows x COLS quads.
  let perLayer = fl.rows * COLS * 6u;
  let layer = vi / perLayer;
  let lv = vi % perLayer;
  let quad = lv / 6u;
  let corner = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0))[lv % 6u];
  let row = f32(quad / COLS) + corner.y;
  let side = (f32(quad % COLS) + corner.x) / f32(COLS);
  let u = row / f32(fl.rows);
  let dir = lip.b.xy;
  let perp = vec2f(-dir.y, dir.x);
  let h = max(lip.a.y - lip.a.w, 0.05);
  // Time to fall the whole height from rest vertically; rows are spaced evenly in time, so they
  // crowd near the lip where the water is slow and the arc bends most.
  let tFall = sqrt(2.0 * h / G_FALL);
  let t = u * tFall;
  let throwM = fl.offset + lip.b.z * t;
  let drop = 0.5 * G_FALL * t * t;
  // An end another lip carries on meets it exactly; a free end reaches a little past the cell so
  // its feathering falls outside it.
  let carried = select(lip.c.y, lip.c.x, side > 0.5);
  let w = (side - 0.5) * 2.0 * WATER_HALF * mix(fl.widthScale, 1.0, carried);
  // Thickness: at the lip the water is as thick as it runs (flow / speed); falling, it takes in
  // air and bulks out toward the tier of a sheet or a thread (recipe thicknessM, over bulkM).
  let k = fullness(lip.b.w);
  let atLip = clamp(lip.b.w / max(lip.b.z, 0.1), 0.004, 0.08);
  let thick = mix(atLip, mix(fl.thickMin, fl.thickMax, k), smoothstep(0.0, fl.bulkM, drop));
  // A free end rounds over like a tongue of water: the layers close toward it.
  let toEnd = select(side, 1.0 - side, side > 0.5) * 2.0;
  let round = mix(sqrt(clamp(toEnd * 1.6, 0.0, 1.0)), 1.0, carried);
  // Normal: across the edge cross the arc's tangent, turned out from the rock.
  let tangent = normalize(vec3f(dir.x * max(lip.b.z, 0.05), -G_FALL * t - 0.05, dir.y * max(lip.b.z, 0.05)));
  var n = normalize(cross(vec3f(perp.x, 0.0, perp.y), tangent));
  if (dot(n.xz, dir) < 0.0) { n = -n; }
  let layerSign = f32(layer) - 1.0;
  // The top row starts a little back on the shelf, so the curtain meets the shelf water.
  let back = select(0.0, 0.06, row < 0.5);
  let xz = lip.a.xz + dir * (throwM - back) + perp * w;
  var out: CurtainOut;
  out.world = vec3f(xz.x, lip.a.y + 0.004 - drop, xz.y) + n * (layerSign * 0.5 * thick * round + 0.5 * thick);
  out.pos = frame.viewProj * vec4f(out.world, 1.0);
  // Round ends turn the normal out to the side, so the body is lit round, not like a card.
  let outSide = vec3f(perp.x, 0.0, perp.y) * select(-1.0, 1.0, side > 0.5) * (1.0 - round);
  out.normal = normalize(n + outSide * 1.5);
  out.layer = f32(layer);
  out.tau = t;
  out.fallen = drop;
  out.across = dot(xz, perp);
  out.q = lip.b.w;
  out.height = h;
  out.side = side;
  out.ends = lip.c.xy;
  return out;
}

@fragment
fn fsCurtain(in: CurtainOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  let k = fullness(in.q);
  // Streaks fixed in the moment the water left the lip: they fall at the true, quickening speed.
  // Threads wander a little across as they fall, and stretch long along it.
  let born = fl.time - in.tau;
  // Each layer has its own streaks, so looking through the water there is depth in it.
  let li = u32(in.layer + 0.5);
  let across = in.across + 0.025 * sin(in.fallen * 2.7 + in.across * 9.0 + in.layer * 1.9) * (1.0 - k) + in.layer * 0.173;
  let streak = valueNoise2(vec2f(across / fl.streakM, born * fl.streakRate), 11u + li * 7u);
  let fine = valueNoise2(vec2f(across / (fl.streakM * 0.35), born * fl.streakRate * 2.3), 29u + li * 7u);
  let lanes = valueNoise2(vec2f(across / (fl.streakM * 0.6), 0.37), 47u + li * 7u);
  let n = mix(mix(streak, lanes, 0.45 * (1.0 - k)), fine, mix(0.3, 0.45, k));
  // Water leaves the lip glassy and clear, and turns white as air gets into it on the way down.
  let aer = smoothstep(0.0, mix(0.6, 1.4, k), in.fallen);
  // Threads at a trickle, a ribbon at a brook, a sheet at a stream; a sheet keeps bands of thicker
  // and thinner white.
  let threshold = mix(0.62, 0.28, k);
  let white = smoothstep(threshold, threshold + mix(0.18, 0.35, k), n) * mix(0.55, 1.0, k) * mix(0.35, 1.0, aer);
  var a = white * mix(1.0, 0.7, smoothstep(0.0, 3.0, in.fallen) * (1.0 - k));
  // The clear water between the white: a thin glassy layer that mostly reflects the sky.
  var glass = mix(0.06, 0.32, k) * (1.0 - 0.6 * aer);
  // Soft into the shelf water at the top, and feathered at an end no neighboring lip carries on.
  let sideIn = select(in.side, 1.0 - in.side, in.side > 0.5);
  let carried = select(in.ends.y, in.ends.x, in.side > 0.5);
  let foot = 1.0 - smoothstep(in.height - 0.12, in.height, in.fallen) * 0.7;
  let edges = smoothstep(0.0, 0.05, in.fallen + 0.02) * mix(smoothstep(0.0, 0.45, sideIn), 1.0, carried) * foot;
  let flowing = smoothstep(0.0, fl.qThreads, in.q);
  // Three layers share the cover: together they reach the recipe's opacity.
  let share = 1.0 - pow(1.0 - fl.opacity, 1.0 / 3.0);
  a = clamp(a * edges * flowing * share * 1.4, 0.0, 1.0);
  glass *= edges * flowing * select(0.25, 1.0, li == 2u);
  // Behind the falling water the rock runs wet: a dark film on the back layer only (it darkens
  // what is behind it, adds no light), strongest where the most water falls.
  let film = edges * flowing * mix(0.22, 0.4, k) * select(0.0, 1.0, li == 0u);
  let cover = a + glass * (1.0 - a);
  let alpha = cover + film * (1.0 - cover);
  if (alpha < 0.003) { discard; }
  let nn = select(-in.normal, in.normal, front);
  // The inner layers sit in the water's own shade: light reaches them through the white in front.
  let lit = shadeSurface(vec3f(fl.albedo), in.world, nn, in.pos, 1.0) * select(select(0.82, 0.65, li == 0u), 1.0, li == 2u);
  // The glassy part reflects the sky (Schlick Fresnel, water F0 0.02).
  let v = normalize(frame.cameraPos - in.world);
  let fres = 0.02 + 0.98 * pow(1.0 - abs(dot(nn, v)), 5.0);
  let sky = skyAmbient(reflect(-v, nn)) * frame.exposure;
  let glassColor = sky * mix(0.35, 1.0, fres) + lit * 0.15;
  return vec4f(lit * a + glassColor * glass * (1.0 - a), alpha);
}

struct SprayOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) uv: vec2f,
  @location(2) @interpolate(flat) alpha: f32,
};

@vertex
fn vsSpray(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SprayOut {
  let lip = lips[ii];
  let puff = vi / 6u;
  let corner = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi % 6u];
  let h = max(lip.a.y - lip.a.w, 0.05);
  let tFall = sqrt(2.0 * h / G_FALL);
  let dir = lip.b.xy;
  let perp = vec2f(-dir.y, dir.x);
  let seed = hash3(vec3u(u32(abs(lip.a.x) * 64.0), u32(abs(lip.a.z) * 64.0), puff));
  let r0 = hashToFloat(seed);
  let r1 = hashToFloat(pcg(seed));
  // Each puff rises and fades on its own loop, so the spray never pulses as one.
  let phase = fract(fl.time * (0.35 + 0.25 * r0) + r1);
  let k = smoothstep(fl.sprayFrom, fl.qSheet, lip.b.w) * smoothstep(0.4, 1.2, h);
  let size = fl.sprayM * (0.5 + 0.5 * phase) * (0.6 + 0.4 * sqrt(min(h, 4.0)));
  let landXZ = lip.a.xz + dir * (fl.offset + lip.b.z * tFall + 0.15 + 0.2 * r1) + perp * (r0 - 0.5) * 0.4;
  let center = vec3f(landXZ.x, lip.a.w + size * (0.3 + 0.9 * phase), landXZ.y);
  let right = vec3f(frame.view[0][0], frame.view[1][0], frame.view[2][0]);
  let up = vec3f(frame.view[0][1], frame.view[1][1], frame.view[2][1]);
  var out: SprayOut;
  out.world = center + (right * corner.x + up * corner.y) * size;
  out.pos = frame.viewProj * vec4f(out.world, 1.0);
  out.uv = corner;
  out.alpha = k * fl.sprayOpacity * (1.0 - phase) * min(phase * 6.0, 1.0);
  return out;
}

@fragment
fn fsSpray(in: SprayOut) -> @location(0) vec4f {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 1.0 || in.alpha < 0.002) { discard; }
  let a = in.alpha * (1.0 - r2) * (1.0 - r2);
  // A cloud of droplets scatters light about evenly: lit as if facing up, mostly by the sky.
  let color = shadeSurface(vec3f(fl.albedo), in.world, vec3f(0.0, 1.0, 0.0), in.pos, 1.0);
  return vec4f(color * a, a);
}

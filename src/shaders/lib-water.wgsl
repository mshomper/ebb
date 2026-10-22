// Water grid lookups shared by the water simulation and drawing (docs/07). Needs `lib-terrain`
// included first. The water grid is 0.5 m: each water cell covers 2 x 2 terrain cells, and its bed
// is the lowest of the four, so a 0.25 m channel the player carved is never lost.
// Mirrors src/world/water/grid.js.

const WATER_ORIGIN: f32 = -80.0;   // world x and z of the grid's first cell edge (same as terrain)
const WATER_CELL: f32 = 0.5;       // meters per cell
const WATER_CELLS: i32 = 384;      // cells per window side

// Simulation step settings (water-flux, water-depth, water-stats). Mirrors src/world/water/sim.js.
struct WaterSim {
  rectOrigin: vec2u,   // simulated rect in water cells; its outer ring is held at the tide level
  rectSize: vec2u,
  dt: f32,             // real seconds per step
  friction: f32,       // c_f per second
  thinFriction: f32,   // extra drag per second on sheets thinner than thinDepth
  thinDepth: f32,
  maxSpeed: f32,       // m/s
  dry: f32,            // depth below which a cell counts as dry (m)
  tide: f32,           // sea level now (m), display time
  nudgeK: f32,         // 1 - exp(-dt / tau): share of the gap to the summary target closed per step
  sourceCount: u32,
  manningInv: f32,     // 1 / Manning's n: caps flow speed by depth and slope
  evaporateK: f32,     // share of the excess over a pond or stream target lost per step (slow, game time)
  // Sources (springs, the pour and drain brush): xy cell center, z volume rate (m^3/s, negative
  // drains), w radius in cells (0: the single cell).
  sources: array<vec4f, 6>,
};

const PI_W: f32 = 3.14159265;

// Depth change per second at cell c from all sources. A radius spreads the rate over a soft disk
// with profile (1 - t^2)^2, whose area is pi r^2 / 3, so the total volume rate is kept.
fn sourceRate(c: vec2i, s: WaterSim) -> f32 {
  var rate = 0.0;
  for (var i = 0u; i < s.sourceCount; i++) {
    let src = s.sources[i];
    if (src.w < 0.5) {
      if (all(vec2f(c) == src.xy)) { rate += src.z / (WATER_CELL * WATER_CELL); }
    } else {
      let t = distance(vec2f(c), src.xy) / src.w;
      if (t < 1.0) {
        let k = (1.0 - t * t) * (1.0 - t * t);
        let area = PI_W * src.w * src.w / 3.0 * WATER_CELL * WATER_CELL;
        rate += src.z * k / area;
      }
    }
  }
  return rate;
}

fn waterBed(heightTex: texture_2d<f32>, c: vec2i) -> f32 {
  let t = c * 2;
  return min(min(terrainLoad(heightTex, t), terrainLoad(heightTex, t + vec2i(1, 0))),
             min(terrainLoad(heightTex, t + vec2i(0, 1)), terrainLoad(heightTex, t + vec2i(1, 1))));
}

// World xz of a water cell's center.
fn waterCellCenter(c: vec2i) -> vec2f {
  return WATER_ORIGIN + (vec2f(c) + 0.5) * WATER_CELL;
}

// Continuous water-cell coordinate of a world point; cell centers sit on integers.
fn waterCellCoord(xz: vec2f) -> vec2f {
  return (xz - WATER_ORIGIN) / WATER_CELL - 0.5;
}

fn inWaterRect(c: vec2i, s: WaterSim) -> bool {
  let o = vec2i(s.rectOrigin);
  return all(c >= o) && all(c < o + vec2i(s.rectSize));
}

// The outer ring of the simulated rect: open sea, held at the tide level.
fn onWaterBoundary(c: vec2i, s: WaterSim) -> bool {
  let o = vec2i(s.rectOrigin);
  let e = o + vec2i(s.rectSize) - 1;
  return any(c == o) || any(c == e);
}

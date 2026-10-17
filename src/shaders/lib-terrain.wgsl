// Terrain lookups shared by every GPU system that reads the ground (docs/08, Reading the terrain).
// The height texture is r32float; it is read with textureLoad and filtered by hand, so this works
// with or without the float32-filterable feature. Mirrors src/world/terrain/grid.js.

const TERRAIN_ORIGIN: f32 = -80.0;   // world x and z of the window's first cell edge
const TERRAIN_CELL: f32 = 0.25;      // meters per cell
const TERRAIN_CELLS: i32 = 768;      // cells per window side

// Continuous cell coordinate of a world point; cell centers sit on integers.
fn terrainCellCoord(xz: vec2f) -> vec2f {
  return (xz - TERRAIN_ORIGIN) / TERRAIN_CELL - 0.5;
}

// Texture uv of a world point, for the filterable material and ground textures.
fn terrainUv(xz: vec2f) -> vec2f {
  return (xz - TERRAIN_ORIGIN) / (TERRAIN_CELL * f32(TERRAIN_CELLS));
}

fn terrainLoad(heightTex: texture_2d<f32>, c: vec2i) -> f32 {
  return textureLoad(heightTex, clamp(c, vec2i(0), vec2i(TERRAIN_CELLS - 1)), 0).r;
}

// Bilinear ground height in meters.
fn terrainHeight(heightTex: texture_2d<f32>, xz: vec2f) -> f32 {
  let u = terrainCellCoord(xz);
  let i = vec2i(floor(u));
  let f = u - floor(u);
  let a = terrainLoad(heightTex, i);
  let b = terrainLoad(heightTex, i + vec2i(1, 0));
  let c = terrainLoad(heightTex, i + vec2i(0, 1));
  let d = terrainLoad(heightTex, i + vec2i(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// One chunk of the terrain mesh, as drawn (terrain-draw) and as shadow caster (shadow).
struct TerrainChunk {
  originCell: vec2f,  // window cell of the chunk's first vertex
  step: f32,          // cells per quad
  quads: f32,         // quads per side
};

// World position of mesh vertex `vi` of a chunk. Grid vertices come first (row-major), then four
// edges of skirt vertices dropped `skirtDepth` below the ground to hide cracks between LODs.
fn terrainMeshVertex(heightTex: texture_2d<f32>, ch: TerrainChunk, vi: u32, skirtDepth: f32) -> vec3f {
  let n = u32(ch.quads);
  let row = n + 1u;
  var g: vec2u;
  var skirt = false;
  if (vi < row * row) {
    g = vec2u(vi % row, vi / row);
  } else {
    let k = vi - row * row;
    let e = k / row;
    let t = k % row;
    skirt = true;
    if (e == 0u) { g = vec2u(t, 0u); }
    else if (e == 1u) { g = vec2u(n, t); }
    else if (e == 2u) { g = vec2u(t, n); }
    else { g = vec2u(0u, t); }
  }
  let cell = min(vec2i(ch.originCell + vec2f(g) * ch.step), vec2i(TERRAIN_CELLS - 1));
  let xz = TERRAIN_ORIGIN + (vec2f(cell) + 0.5) * TERRAIN_CELL;
  var h = terrainLoad(heightTex, cell);
  if (skirt) { h -= skirtDepth; }
  return vec3f(xz.x, h, xz.y);
}

// Ground normal from central differences of the bilinear height.
fn terrainNormal(heightTex: texture_2d<f32>, xz: vec2f) -> vec3f {
  let e = TERRAIN_CELL;
  let dx = terrainHeight(heightTex, xz + vec2f(e, 0.0)) - terrainHeight(heightTex, xz - vec2f(e, 0.0));
  let dz = terrainHeight(heightTex, xz + vec2f(0.0, e)) - terrainHeight(heightTex, xz - vec2f(0.0, e));
  return normalize(vec3f(-dx, 2.0 * e, -dz));
}

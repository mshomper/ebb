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

// Ground normal from central differences of the bilinear height.
fn terrainNormal(heightTex: texture_2d<f32>, xz: vec2f) -> vec3f {
  let e = TERRAIN_CELL;
  let dx = terrainHeight(heightTex, xz + vec2f(e, 0.0)) - terrainHeight(heightTex, xz - vec2f(e, 0.0));
  let dz = terrainHeight(heightTex, xz + vec2f(0.0, e)) - terrainHeight(heightTex, xz - vec2f(0.0, e));
  return normalize(vec3f(-dx, 2.0 * e, -dz));
}

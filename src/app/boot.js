// @ts-check
// Start-up: the seed, the quality tier, the base recipes, the island and its save, the land, what the
// save brought back, device settings, the tool and unlock slices, and undo.
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import * as clock from '../core/clock.js';
import { get as getStore, update as updateStore } from '../core/store.js';
import { loadRecipe } from '../core/recipes.js';
import { pickTier } from '../render/quality.js';
import { islandLand } from '../world/terrain/chunks.js';
import { islandCenter, campOf } from '../world/terrain/landform.js';
import { padOf } from '../world/camp/layout.js';
import { sampleTrails } from '../world/trails.js';
import { sampleForager } from '../world/forager.js';
import { history } from '../input/actions.js';
import { beginSave, TEST_PARAMS } from '../save/autosave.js';
import { loadPrefs, keepPrefs } from '../save/prefs.js';
import { SECTIONS9, empty9 } from '../save/migrate-format9.js';
import { joinCarriers } from '../world/kit/model.js';
import { BASE_RECIPES, PALETTES } from './recipes.js';

/** @param {import('./context.js').AppContext} ctx */
export async function start(ctx) {
  const { hooks } = ctx;
  const params = new URLSearchParams(location.search);
  let seed = Number.parseInt(params.get('seed') ?? '1', 10) >>> 0;
  updateStore('meta', (m) => { m.seed = seed; });

  // `tier` and `tierSettings` (ctx.tier, ctx.tierSettings) may change once, if the startup probe steps
  // ultra down to high. The base recipes come from the list in src/app/recipes.js.
  const names = Object.keys(BASE_RECIPES);
  const [{ tier, settings: tierSettings, reasons, probe }, ...loaded] = await Promise.all([
    pickTier(ctx.gpu.adapter),
    ...names.map((n) => loadRecipe(BASE_RECIPES[n])),
    ...PALETTES.map((p) => loadRecipe(`palettes/${p.id}`)),
  ]);
  /** @type {Record<string, any>} */
  const base = Object.fromEntries(names.map((n, i) => [n, loaded[i]]));
  const paletteRecipes = loaded.slice(names.length);
  const { terrainRecipe } = base;
  let { camRecipe } = base;
  /** @type {Record<string, any>} */
  const palettes = Object.fromEntries(PALETTES.map((p, i) => [p.id, paletteRecipes[i]]));
  // `?island=<id>` starts another island from recipes/world/terrain.json's list (tests, comparisons).
  /** @type {{ id: string, name: string, land?: string }[]} */ const islands = terrainRecipe.islands?.list ?? [];
  const asked = params.get('island');
  const island = islands.find((i) => i.id === asked) ?? islands.find((i) => `land/${i.id}` === terrainRecipe.starter.land) ?? { id: terrainRecipe.starter.land.slice(5), name: 'Starter island' };
  updateStore('meta', (m) => { m.island = island.id; });
  updateStore('settings', (s) => { s.quality = tier; });
  const rb = terrainRecipe.brush;

  // Saving (doc 18, src/save): each island keeps its own save; a test link runs unsaved.
  const save = await beginSave({ enabled: !!hooks.save, islandId: island.id, test: TEST_PARAMS.some((k) => params.has(k)) });
  if (save.status === 'elsewhere') return { ok: false, reason: 'elsewhere', takeOver: save.takeOver };
  // No copy of the save reads at all: the recovery card (src/ui/damaged.js) offers a file or a new island.
  if (save.status === 'damaged') return { ok: false, reason: 'damaged', save, islands };
  // What came back from the save, applied once (a GPU rebuild finds it all in the store already).
  const back = save.restored;
  // The island's land (docs/future/13 section 3.11): a new island grows from the island's current
  // land recipe (`land` in terrain.json's list, the larger starter island); one already made keeps
  // the land its chunks record, so its shape never changes.
  const landName = islandLand(island, back?.chunks ?? Object.values(getStore('chunks') ?? {}));
  const landRecipe = await loadRecipe(`land/${landName}`);
  updateStore('meta', (m) => { m.land = landName; });
  // The camera starts over the island's center and keeps within its reach (cameraRadiusM).
  const isle = islandCenter(landRecipe);
  camRecipe = { ...camRecipe, worldRadius: landRecipe.cameraRadiusM ?? camRecipe.worldRadius, worldCenter: [isle.x, isle.z],
    start: { ...camRecipe.start, target: [camRecipe.start.target[0] + isle.x, camRecipe.start.target[1], camRecipe.start.target[2] + isle.z] } };
  if (back) {
    seed = back.meta.seed >>> 0;
    updateStore('meta', (m) => { m.seed = seed; m.carryMinutes = back.meta.carryMinutes ?? 0; m.keepGrowing = back.meta.keepGrowing ?? true; });
    clock.reset(back.meta.worldT);
    clock.setFlow(clock.FLOWS.includes(back.meta.flow) ? back.meta.flow : 1);
    updateStore('world', () => back.world);
    if (back.journal) updateStore('journal', () => back.journal);
    if (back.water) updateStore('water', () => back.water);
    // The pieces of music you hearted (src/audio/music/hearts.js).
    if (back.music) updateStore('music', () => back.music);
    // Placed loose stones (src/world/pieces).
    updateStore('pieces', () => back.pieces);
    // The shelf of keepsakes (src/world/keepsakes/shelf.js).
    updateStore('keepsakes', () => back.keepsakes);
    // The nets (src/world/nets/model.js).
    updateStore('nets', () => back.nets);
  }
  // The keeper's camp sections (format 9, src/save/migrate-format9.js): from the save, empty on a
  // new island, and as they were on a GPU rebuild.
  for (const id of SECTIONS9) updateStore(id, (v) => (back ? back[id] : v ?? empty9(id)));
  // The carriers live in the kit's section (the Walker page, K1); the pack keeps its own copy for its
  // pouch rules. A save from before the kit kept them in the pack: both come back agreeing.
  { const j = joinCarriers(getStore('kit'), getStore('pack')); updateStore('kit', () => j.kit); updateStore('pack', () => j.pack); }
  // The camp pad (src/world/camp/layout.js): in a new island's base from the start; on an older
  // island once it is stamped (camp.pad, src/world/camp/migrate-pad.js).
  {
    const inBase = campOf(landRecipe);
    // A new island's pad is where its land put it; the save's camp.pad says so for every reader.
    if (inBase?.inBase && !getStore('camp')?.pad) {
      updateStore('camp', (c) => ({ ...c, stamped: true, pad: { x: inBase.x, z: inBase.z, heightM: inBase.h,
        facingDeg: Math.atan2(inBase.fz, inBase.fx) * 180 / Math.PI, source: 'recipe' } }));
    }
    const at = getStore('camp')?.pad ?? null;
    updateStore('campPad', () => (inBase?.inBase || at ? padOf(landRecipe, at) : null));
  }
  // Device settings (src/save/prefs.js): kept on this device, never in the island.
  const prefs = loadPrefs();
  updateStore('settings', (s) => {
    for (const k of ['textSize', 'motion', 'audio', 'hudDim', 'reveal', 'qualityChoice', 'journalList', 'keeperTab']) if (prefs[k] !== undefined) s[k] = prefs[k];
  });
  keepPrefs();

  // Tool state for the tool bar (ui/tools.js reads it; actions below change it).
  updateStore('tools', (t) => t ?? {
    tool: null, sculptMode: 'raise', paintLayer: 'grass', waterMode: 'pour', springRate: 'brook', plantSpecies: 'reeds',
    size: rb.radiusDefault, strength: rb.strengthDefault, sizeRange: rb.radiusRange,
  });
  // Terrace and Cut's Height slider (docs/08), and its range for the card.
  updateStore('tools', (t) => {
    t.cliffHeight ??= terrainRecipe.cliff.heightDefault;
    t.cliffHeightRange = terrainRecipe.cliff.heightM;
    t.cliffHeightStep = terrainRecipe.cliff.snapM;
  });
  // Unlocks (docs 12, 13): placing springs is the dragonflies' gift and the Cliff tool (Terrace and
  // Cut) the frogs'; `?sandbox` opens both early for this visit only, and `?cliffs` the Cliff tool
  // (`earned` holds what was given, and is what the save keeps). Loose stones are the naturalist's
  // reward at six finds; `?sandbox` opens the Loose stone mode early, and `?stones` (a test link,
  // unsaved) that and the handful that comes with the reward (src/world/pieces). Driftwood is the
  // reward at ten finds, and carrying a stone or a log the turtles' gift (not given by anything
  // yet); `?sandbox` opens carrying, and `?driftwood` (unsaved) both.
  // `?sandbox` and `?plants=all` also
  // offer every plant in the Plant tool before it has come to the island (volunteers.js); sea
  // campion, for one, grows nowhere until there is rock by the sea.
  updateStore('unlocks', (u) => {
    // `?trails` (testing, unsaved): stops on the beachcomber's and shaper's trails already reached.
    // `?forager` (testing, unsaved): a year of gathering, so the herbarium, the knife and the almanac are reached.
    let earned = params.has('trails') ? sampleTrails(u?.earned ?? back?.unlocks ?? {}) : u?.earned ?? back?.unlocks ?? {};
    if (params.has('forager')) earned = sampleForager(earned);
    return { earned, ...earned, springs: !!earned.springs || params.has('sandbox'),
      cliffs: !!earned.cliffs || params.has('sandbox') || params.has('cliffs'),
      stones: !!earned.stones || params.has('sandbox') || params.has('stones'), stonesTest: params.has('stones'),
      driftwood: !!earned.driftwood || params.has('driftwood'),
      carry: !!earned.carry || !!earned.driftwood || params.has('sandbox') || params.has('driftwood'),
      // The general net (the beachcomber's trail, at four families kept); `?nets` (unsaved) gives it at once.
      nets: { ...(earned.nets ?? {}), ...(params.has('nets') ? { general: true } : {}) },
      allPlants: params.has('sandbox') || params.get('plants') === 'all' };
  });
  // `?weather=clear|cloud|rain|mist` previews a weather look (as the sky lab does); the world's
  // own weather record is untouched.
  const weatherPreview = params.get('weather');
  if (weatherPreview && ['clear', 'cloud', 'rain', 'mist'].includes(weatherPreview)) {
    updateStore('preview', (p) => ({ ...(p ?? {}), weather: weatherPreview }));
  }
  const syncHistory = () => updateStore('history', () => ({ canUndo: history.canUndo(), canRedo: history.canRedo() }));
  history.setBudget((terrainRecipe.undoBudgetMB[tier] ?? 12) * 1024 * 1024);
  const unHistory = history.onChange(syncHistory);
  syncHistory();
  Object.assign(ctx, base, { params, seed, palettes, islands, island, rb, save, back, landName, landRecipe, prefs, unHistory, tier, tierSettings, reasons, probe, camRecipe });
}

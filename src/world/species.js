// @ts-check
// The species list (docs 11, 12; docs/future/11 "A species list"): every species recipe the game
// loads, in tick order, and the key each is known by in the world, the journal and its events.
// A recipe's id is singular (frog); its key is what the world keeps it under (state.creatures.frogs,
// the journal page frogs, the flag frogs:happy), the recipe's `key`, else its id with an s.

/**
 * Recipe ids under recipes/species, in the order the hourly tick takes them. Frogspawn and the toad
 * have no needs: spring's markers, run by src/world/creatures/spring.js after the swarms. The slow
 * worm and the common lizard are finds worked out live (src/world/creatures/sun-finds.js).
 */
export const SPECIES = Object.freeze(['frog', 'midge', 'minnow', 'dragonfly', 'damselfly', 'turtle', 'frogspawn', 'toad', 'slowworm', 'lizard', 'turnstone', 'eel']);

/** The world's key for a species recipe. @param {{ id: string, key?: string }} rec */
export const keyOf = (rec) => rec.key ?? `${rec.id}s`;

/**
 * The recipes that live as schools and swarms with needs (minnows, dragonflies, damselflies): ecology.kind 'swarm'.
 * @param {Record<string, any> | undefined} species env.recipes.species
 * @returns {any[]}
 */
export const swarmSpecies = (species) => SPECIES.map((id) => species?.[id]).filter((r) => r?.ecology?.kind === 'swarm');

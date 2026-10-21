/**
 * Tile kind codes the engine refers to by name. The tile keeps the kind in a
 * 4-bit field, so codes run 1-15 (0 is "nothing here"). Since sub-kinds
 * (docs/sub-kinds.md) a code is a **family code**: the coarse class fast paths
 * and the building index use. A building's identity is its catalogue **kind id**
 * (0-255): the tile's sub byte, or the family's base kind when the sub byte is 0.
 * Every base kind's id equals its code, so these names are also the base kinds' ids:
 * `b.zone === Zone.Fire` asks "fire family", `b.id === Zone.Fire` asks "the fire station itself".
 */
export const Zone = {
  None: 0, Residential: 1, Commercial: 2, Industrial: 3, Office: 4,
  Police: 5, Fire: 6, Hospital: 7, Yard: 8, Parking: 9,
  /** the airport terminal (multi-tile), base kind of the transport-hub family; its runway is kind None with airfield aux bytes (shared/src/airport.ts) */
  Airport: 15,
  /** family code 15: transport hubs (the airport terminal is its base kind; the bus depot draft is a sub-kind) */
  Hub: 15,
} as const;
/** Highest kind code the tile's 4-bit field can hold, and the highest level its 3-bit field can hold. */
export const MAX_KIND_CODE = 15;
/** Highest catalogue kind id: the per-tile sub byte (docs/sub-kinds.md) holds one. Base kinds use ids 1-15 (= their code), sub-kinds 16-255. */
export const MAX_KIND_ID = 255;
/** Lowest id a sub-kind (a kind that is not its family's base) may take. */
export const FIRST_SUB_KIND_ID = 16;
export const MAX_LEVEL_CODE = 7;
/** Compiled tables are indexed by kind id * LEVEL_SLOTS + level. */
export const LEVEL_SLOTS = 8;
/** Largest footprint edge a multi-tile structure may have: part tiles store their offset to the anchor in 3 bits per axis. */
export const MAX_FOOTPRINT = 8;
/** Behaviour flag bits in the compiled KIND_FLAGS_TABLE. */
export const KIND_FLAG = { growable: 1, civic: 2, service: 4, workplace: 8, parking: 16, leisureReady: 32 } as const;
/** Kind ids reserved for draft landmarks (landmark-drafts.ts, docs/landmarks.md): inclusive range, viewer only until a landmark is accepted and takes a permanent id. */
export const LANDMARK_DRAFT_IDS: readonly [number, number] = [230, 249];

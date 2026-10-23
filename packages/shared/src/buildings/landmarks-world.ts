import type { KindDef } from './schema';
import { NEW_YORK_LANDMARKS } from './landmarks-new-york';
import { CAIRO_LANDMARKS } from './landmarks-cairo';
import { DUBAI_LANDMARKS } from './landmarks-dubai';
import { SHANGHAI_LANDMARKS } from './landmarks-shanghai';
import { PARIS_LANDMARKS } from './landmarks-paris';
import { ROME_LANDMARKS } from './landmarks-rome';
import { BEIJING_LANDMARKS } from './landmarks-beijing';
import { RIO_LANDMARKS } from './landmarks-rio';
import { SYDNEY_LANDMARKS } from './landmarks-sydney';
import { SAN_FRANCISCO_LANDMARKS } from './landmarks-san-francisco';
import { BARCELONA_LANDMARKS } from './landmarks-barcelona';
import { KUALA_LUMPUR_LANDMARKS } from './landmarks-kuala-lumpur';

/**
 * World landmarks (docs/buildings.md "Landmarks"): recognisable real buildings in cities around the world, each a placed
 * civic kind that works as an existing role, exactly like the London landmarks (landmarks-london.ts). Each city is one
 * `collection` group (groups.ts), so the tool bar shows one button per city whose picker lists that city's landmarks in
 * `tier` order, and every tool is unlocked only by the locked tech node 'wld1' (tech.ts): a live game cannot place them
 * until their unlock rule is decided; sandboxes, demos and ?dev clients can.
 *
 * Kind-id blocks (free ranges; landmarks-london took 91-100, 111-114, 116; 150-154 is remembrance, 160-166 power):
 *   121-128   New York        (landmarks-new-york.ts)
 *   133-140   Paris           (landmarks-paris.ts)
 *   141-146   Rome            (landmarks-rome.ts)
 *   147-149   (unused)
 *   155-159   Cairo           (landmarks-cairo.ts)
 *   167-171   Dubai           (landmarks-dubai.ts)
 *   172-176   Shanghai        (landmarks-shanghai.ts)
 *   177-182   Beijing         (landmarks-beijing.ts)
 *   183-187   Rio de Janeiro  (landmarks-rio.ts)
 *   188-191   Sydney          (landmarks-sydney.ts)
 *   192-196   San Francisco   (landmarks-san-francisco.ts)
 *   197-200   Barcelona       (landmarks-barcelona.ts)
 *   201-204   Kuala Lumpur    (landmarks-kuala-lumpur.ts)
 *   205-208   Toronto         (landmarks-toronto.ts)
 *   209-212   Seattle         (landmarks-seattle.ts)
 *   213-216   Agra            (landmarks-agra.ts)
 *
 * Scale: about 33 m to a tile, as for London. Every landmark has one design: it is one building, not a type; per-instance
 * variation comes from the window lighting as everywhere else. Each city file holds its own role bases (office towers,
 * theatre venues, library-family attractions) copied from the London files' pattern.
 */
export const WORLD_LANDMARKS: KindDef[] = [
  ...NEW_YORK_LANDMARKS,
  ...CAIRO_LANDMARKS,
  ...DUBAI_LANDMARKS,
  ...SHANGHAI_LANDMARKS,
  ...PARIS_LANDMARKS,
  ...ROME_LANDMARKS,
  ...BEIJING_LANDMARKS,
  ...RIO_LANDMARKS,
  ...SYDNEY_LANDMARKS,
  ...SAN_FRANCISCO_LANDMARKS,
  ...BARCELONA_LANDMARKS,
  ...KUALA_LUMPUR_LANDMARKS,
];

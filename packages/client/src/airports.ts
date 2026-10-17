import {
  CHUNK_SIZE, Zone, isAnchorAux, auxOrientation, zoneOf, isRoad, kindIdOf, placedFromAnchor, deriveAirports,
  type AirfieldEnv, type AirportLink, type Placed,
} from '@msimcity/shared';
import type { ClientWorld, ClientChunk } from './world';

/**
 * Airports as this client sees them: the same `deriveAirports()` the server runs (shared/src/airport.ts), fed
 * from the chunks we have loaded, so the planes drawn here fly exactly the server's timetable. No three.js here,
 * so scripts can run it (packages/shared/scripts/flights-check.ts compares it with the server's path).
 */
export const clientEnv = (world: ClientWorld): AirfieldEnv => ({ tile: (x, y) => world.getTile(x, y), aux: (x, y) => world.auxAt(x, y), sub: (x, y) => world.subAt(x, y) });

/** Airport terminals anchored in one chunk. */
export function chunkTerminals(c: ClientChunk): Placed[] {
  const out: Placed[] = [];
  for (let i = 0; i < c.aux.length; i++) {
    const a = c.aux[i];
    if (!a || !isAnchorAux(a)) continue;
    const t = c.tiles[i];
    if (isRoad(t) || kindIdOf(zoneOf(t), c.sub[i]) !== Zone.Airport) continue; // the airport kind, not every transport hub
    out.push(placedFromAnchor(Zone.Airport, c.cx * CHUNK_SIZE + (i % CHUNK_SIZE), c.cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE), auxOrientation(a)));
  }
  return out;
}
/** Same order as the server's list. */
export const sortTerminals = (list: Placed[]) => list.sort((a, b) => a.ax - b.ax || a.ay - b.ay);

/** Every terminal in the loaded chunks with its runway and, when operational and fully loaded, its descriptor. */
export function clientAirports(world: ClientWorld, terminals?: Placed[]): AirportLink[] {
  const list = terminals ?? sortTerminals([...world.chunks.values()].flatMap(chunkTerminals));
  return deriveAirports(list, clientEnv(world));
}

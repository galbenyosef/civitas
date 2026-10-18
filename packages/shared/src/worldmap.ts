import { CHUNK_SIZE } from './constants';
import { isRoad, zoneOf, levelOf, terrainOf, underConstruction, Terrain, Zone } from './tile';
import { isRailAux } from './rail';
import { isAirfieldAux } from './airport';
import { u8ToB64, b64ToU8 } from './codec';

/**
 * The world map's land-use summary (docs/world-map.md section 1): one byte per tile, bits 0-3 the class, bits 4-6 the
 * building level, bit 7 under construction. The server sends it per modified chunk, run-length coded; the client
 * builds the same bytes from the seed for chunks nobody has changed. Both call `mapByte`.
 */
export const MapClass = {
  Grass: 0, Sand: 1, Water: 2, Road: 3, Track: 4, Airfield: 5,
  Residential: 6, Commercial: 7, Industrial: 8, Office: 9, Civic: 10, Transport: 11, Leisure: 12,
} as const;
export const MAP_CLASS_COUNT = 13;

/** Chunks per sector edge: a sector is the unit the map asks for, caches and draws (256×256 tiles). */
export const SECTOR_CHUNKS = 8;
export const SECTOR_TILES = SECTOR_CHUNKS * CHUNK_SIZE;
export const sectorOf = (chunk: number) => Math.floor(chunk / SECTOR_CHUNKS);
/** Most sectors one 'map' request may name. */
export const MAP_MAX_SECTORS = 512;

/** The class of a terrain value (Terrain.*). */
export const terrainClass = (terrain: number) => (terrain === Terrain.Water ? MapClass.Water : terrain === Terrain.Sand ? MapClass.Sand : MapClass.Grass);

const ZONE_CLASS: number[] = [];
ZONE_CLASS[Zone.Residential] = MapClass.Residential;
ZONE_CLASS[Zone.Commercial] = MapClass.Commercial;
ZONE_CLASS[Zone.Industrial] = MapClass.Industrial;
ZONE_CLASS[Zone.Office] = MapClass.Office;
for (const z of [Zone.Police, Zone.Fire, Zone.Hospital, Zone.Yard]) ZONE_CLASS[z] = MapClass.Civic;
for (const z of [Zone.Parking, Zone.Hub]) ZONE_CLASS[z] = MapClass.Transport;
for (let z = 10; z <= 14; z++) ZONE_CLASS[z] = MapClass.Leisure; // the leisure families (buildings/leisure.ts)

/** The map byte of a tile word and its aux byte. */
export function mapByte(tile: number, aux: number): number {
  if (isRoad(tile)) return MapClass.Road;
  if (isRailAux(aux)) return MapClass.Track;
  if (isAirfieldAux(aux)) return MapClass.Airfield;
  const z = zoneOf(tile);
  if (z === 0) return terrainClass(terrainOf(tile));
  return (ZONE_CLASS[z] ?? MapClass.Civic) | (levelOf(tile) << 4) | (underConstruction(tile) ? 0x80 : 0);
}
export const mapClassOf = (b: number) => b & 15;
export const mapLevelOf = (b: number) => (b >> 4) & 7;
export const mapBuilding = (b: number) => (b & 0x80) !== 0;

/** Run-length code bytes as (run - 1, byte) pairs, runs up to 256, base64'd. */
export function rleEncode(a: Uint8Array): string {
  const out: number[] = [];
  for (let i = 0; i < a.length;) {
    const v = a[i];
    let n = 1;
    while (i + n < a.length && a[i + n] === v && n < 256) n++;
    out.push(n - 1, v);
    i += n;
  }
  return u8ToB64(new Uint8Array(out));
}
/** The inverse of rleEncode into `out` (its length is the expected size); false when the data does not fill it exactly. */
export function rleDecode(s: string, out: Uint8Array): boolean {
  const b = b64ToU8(s);
  let j = 0;
  for (let i = 0; i + 1 < b.length; i += 2) {
    const n = b[i] + 1, v = b[i + 1];
    if (j + n > out.length) return false;
    out.fill(v, j, j + n);
    j += n;
  }
  return j === out.length;
}

import { CHUNK_SIZE, SECTOR_CHUNKS, MAP_MAX_SECTORS, mapByte, rleEncode, sectorOf, chunkOf, type ServerMsg } from '@msimcity/shared';
import type { World } from './world';

const skey = (sx: number, sy: number) => (sx + 0x8000) * 65536 + (sy + 0x8000);

/**
 * The world map's ground on the server (docs/world-map.md section 1): a version per sector of 8×8 chunks, bumped
 * whenever a tile in it changes (Net.flush calls `touch` for every tile, aux and sub change it sends), and the encoded
 * 'mapSector' message per sector, built on the first request after a change. A request names the sectors in view and
 * the version it holds; only sectors whose version differs are answered, so the server keeps nothing per client.
 */
export class MapSummaries {
  private ver = new Map<number, number>();
  private cache = new Map<number, { v: number; json: string }>();
  /** encodes since start and their total time and bytes, for the readout in docs/world-map.md section 4 */
  stats = { encodes: 0, ms: 0, bytes: 0 };
  private scratch = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);

  constructor(private w: World) {}

  /** A tile changed. */
  touch(x: number, y: number) {
    const k = skey(sectorOf(chunkOf(x)), sectorOf(chunkOf(y)));
    this.ver.set(k, (this.ver.get(k) ?? 1) + 1);
  }
  version(sx: number, sy: number) { return this.ver.get(skey(sx, sy)) ?? 1; }

  /** The answers to a 'map' request (flat sx, sy, version held): JSON strings, one per sector that changed. */
  answer(flat: unknown): string[] {
    if (!Array.isArray(flat)) return [];
    const out: string[] = [];
    for (let i = 0; i + 2 < flat.length && i < MAP_MAX_SECTORS * 3; i += 3) {
      const sx = Number(flat[i]) | 0, sy = Number(flat[i + 1]) | 0, have = Number(flat[i + 2]) | 0;
      if (Math.abs(sx) > 4000 || Math.abs(sy) > 4000) continue;
      const v = this.version(sx, sy);
      if (v === have) continue;
      out.push(this.encoded(sx, sy, v));
    }
    return out;
  }

  private encoded(sx: number, sy: number, v: number): string {
    const k = skey(sx, sy);
    const hit = this.cache.get(k);
    if (hit && hit.v === v) return hit.json;
    const t0 = performance.now();
    const c: [number, number, string][] = [];
    const N = CHUNK_SIZE * CHUNK_SIZE, b = this.scratch;
    for (let cy = sy * SECTOR_CHUNKS; cy < (sy + 1) * SECTOR_CHUNKS; cy++) for (let cx = sx * SECTOR_CHUNKS; cx < (sx + 1) * SECTOR_CHUNKS; cx++) {
      const ch = this.w.getChunk(cx, cy, false);
      if (!ch?.modified) continue; // as the seed made it: the client samples the terrain itself
      for (let i = 0; i < N; i++) b[i] = mapByte(ch.tiles[i], ch.aux[i]);
      c.push([cx, cy, rleEncode(b)]);
    }
    const msg: ServerMsg = { t: 'mapSector', sx, sy, v, c };
    const json = JSON.stringify(msg);
    this.cache.set(k, { v, json });
    this.stats.encodes++; this.stats.ms += performance.now() - t0; this.stats.bytes += json.length;
    return json;
  }
}

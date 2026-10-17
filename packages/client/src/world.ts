import { CHUNK_SIZE, b64ToU16, b64ToI32, b64ToU8, chunkKey, chunkOf, localIndex, structureAt, kindIdOf, zoneOf, isRoad, type Placed, type ChunkDTO, type ParcelDTO, type PlayerDTO } from '@msimcity/shared';

export interface ClientChunk { cx: number; cy: number; tiles: Uint16Array; parcel: Int32Array; aux: Uint8Array; /** kind ids of sub-kinds (docs/sub-kinds.md) */ sub: Uint8Array; dirty: boolean }

/** Client-side mirror of the part of the world we are subscribed to. */
export class ClientWorld {
  chunks = new Map<string, ClientChunk>();
  parcels = new Map<number, ParcelDTO>();
  players = new Map<string, PlayerDTO>();
  me = '';
  /** a sandbox (test city or demo, from the welcome): anyone may edit any parcel and buy land anywhere */
  sandbox = false;
  parcelsDirty = false;
  /** per chunk: congestion on roads (0-255) and cars parked in lots */
  traffic = new Map<string, Uint8Array>();
  trafficDirty = new Set<string>();
  /** per chunk: cars parked at the kerb of each road tile (absent when none) */
  kerb = new Map<string, Uint8Array>();

  /** whether this player may edit land owned by `owner` (the server's rule: their own, or anyone's in a sandbox) */
  mayEdit(owner: string) { return owner === this.me || this.sandbox; }

  putChunk(dto: ChunkDTO) {
    const N = CHUNK_SIZE * CHUNK_SIZE;
    const aux = dto.aux ? b64ToU8(dto.aux) : null, sub = dto.sub ? b64ToU8(dto.sub) : null;
    const c: ClientChunk = {
      cx: dto.cx, cy: dto.cy, tiles: b64ToU16(dto.tiles), parcel: b64ToI32(dto.parcels),
      aux: aux && aux.length === N ? aux : new Uint8Array(N), sub: sub && sub.length === N ? sub : new Uint8Array(N), dirty: true,
    };
    this.chunks.set(chunkKey(dto.cx, dto.cy), c);
    // road tiling along our edges depends on neighbours, and theirs on us
    this.touch(dto.cx - 1, dto.cy); this.touch(dto.cx + 1, dto.cy); this.touch(dto.cx, dto.cy - 1); this.touch(dto.cx, dto.cy + 1);
    return c;
  }
  dropChunk(key: string) { this.chunks.delete(key); this.traffic.delete(key); this.kerb.delete(key); }
  applyTraffic(cx: number, cy: number, d: string, k?: string) {
    const key = chunkKey(cx, cy);
    if (!this.chunks.has(key)) return;
    const bytes = b64ToU8(d);
    if (bytes.length === CHUNK_SIZE * CHUNK_SIZE) this.traffic.set(key, bytes); else this.traffic.delete(key);
    const kerb = k ? b64ToU8(k) : null;
    if (kerb && kerb.length === CHUNK_SIZE * CHUNK_SIZE) this.kerb.set(key, kerb); else this.kerb.delete(key);
    this.trafficDirty.add(key);
  }
  trafficAt(x: number, y: number): number {
    const t = this.traffic.get(chunkKey(chunkOf(x), chunkOf(y)));
    return t ? t[localIndex(x, y)] : 0;
  }

  getTile(x: number, y: number): number | undefined {
    const c = this.chunks.get(chunkKey(chunkOf(x), chunkOf(y)));
    return c ? c.tiles[localIndex(x, y)] : undefined;
  }
  parcelIdAt(x: number, y: number): number {
    const c = this.chunks.get(chunkKey(chunkOf(x), chunkOf(y)));
    return c ? c.parcel[localIndex(x, y)] : 0;
  }
  parcelAt(x: number, y: number) { return this.parcels.get(this.parcelIdAt(x, y)); }
  auxAt(x: number, y: number): number {
    const c = this.chunks.get(chunkKey(chunkOf(x), chunkOf(y)));
    return c ? c.aux[localIndex(x, y)] : 0;
  }
  /** Sub byte at a tile (kind id of a sub-kind; 0 = the family's base kind or not loaded). */
  subAt(x: number, y: number): number {
    const c = this.chunks.get(chunkKey(chunkOf(x), chunkOf(y)));
    return c ? c.sub[localIndex(x, y)] : 0;
  }
  /** The catalogue kind id standing on a tile (0 for nothing or not loaded). */
  kindIdAt(x: number, y: number): number {
    const t = this.getTile(x, y);
    return t === undefined || isRoad(t) ? 0 : kindIdOf(zoneOf(t), this.subAt(x, y));
  }
  private auxFn = (x: number, y: number) => this.auxAt(x, y);
  private tileFn = (x: number, y: number) => this.getTile(x, y);
  private subFn = (x: number, y: number) => this.subAt(x, y);
  /** The multi-tile structure covering (x, y), if its anchor is loaded. */
  structureAt(x: number, y: number): Placed | null { return this.auxAt(x, y) ? structureAt(x, y, this.auxFn, this.tileFn, this.subFn) : null; }
  /** The tile the server knows a building by: a structure's door, else the tile itself. */
  doorOf(x: number, y: number): [number, number] {
    const s = this.structureAt(x, y);
    return s ? [s.doorX, s.doorY] : [x, y];
  }
  /** flat triples x, y, aux (the server sends them just before the matching tile words) */
  applyAux(u: number[]) {
    for (let i = 0; i < u.length; i += 3) {
      const c = this.chunks.get(chunkKey(chunkOf(u[i]), chunkOf(u[i + 1])));
      if (!c) continue;
      const li = localIndex(u[i], u[i + 1]);
      c.aux[li] = u[i + 2];
      c.dirty = true;
      // runway ends are drawn from the neighbours' bytes, so a change on a chunk edge redraws the chunk next door
      const lx = li % CHUNK_SIZE, ly = Math.floor(li / CHUNK_SIZE);
      if (lx === 0) this.touch(c.cx - 1, c.cy); else if (lx === CHUNK_SIZE - 1) this.touch(c.cx + 1, c.cy);
      if (ly === 0) this.touch(c.cx, c.cy - 1); else if (ly === CHUNK_SIZE - 1) this.touch(c.cx, c.cy + 1);
    }
  }

  /** flat triples x, y, sub (the server sends them after 'aux' and before the matching tile words) */
  applySub(u: number[]) {
    for (let i = 0; i < u.length; i += 3) {
      const c = this.chunks.get(chunkKey(chunkOf(u[i]), chunkOf(u[i + 1])));
      if (!c) continue;
      c.sub[localIndex(u[i], u[i + 1])] = u[i + 2];
      c.dirty = true;
    }
  }

  applyTiles(u: number[]) {
    for (let i = 0; i < u.length; i += 4) {
      const x = u[i], y = u[i + 1];
      const c = this.chunks.get(chunkKey(chunkOf(x), chunkOf(y)));
      if (!c) continue;
      const li = localIndex(x, y);
      c.tiles[li] = u[i + 2]; c.parcel[li] = u[i + 3]; c.dirty = true;
      const lx = li % CHUNK_SIZE, ly = Math.floor(li / CHUNK_SIZE);
      if (lx === 0) this.touch(c.cx - 1, c.cy); else if (lx === CHUNK_SIZE - 1) this.touch(c.cx + 1, c.cy);
      if (ly === 0) this.touch(c.cx, c.cy - 1); else if (ly === CHUNK_SIZE - 1) this.touch(c.cx, c.cy + 1);
    }
  }
  private touch(cx: number, cy: number) {
    const n = this.chunks.get(chunkKey(cx, cy));
    if (n) n.dirty = true;
  }
  applyParcels(parcels: ParcelDTO[], removed?: number[]) {
    for (const p of parcels) this.parcels.set(p.id, p);
    for (const id of removed ?? []) this.parcels.delete(id);
    this.parcelsDirty = true;
  }
  applyPlayers(players: PlayerDTO[]) {
    for (const p of players) this.players.set(p.id, p);
  }
  get myPlayer() { return this.players.get(this.me); }
  static chunkSize = CHUNK_SIZE;
}

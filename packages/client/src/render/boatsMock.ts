import {
  CHUNK_SIZE, isAnchorAux, auxOrientation, zoneOf, isRoad, kindIdOf, placedFromAnchor, isHarbourId, HARBOUR_OF, fairwayTiles, harbourBerths, deriveHarbourLanes,
  WaterGrid, openWater, waterReach, PASS_ALL, type Placed, type BoatHarbour, type SeaGate,
} from '@msimcity/shared';
import type { ClientChunk, ClientWorld } from '../world';

/**
 * DEV ONLY (?dev): stands in for the server's `harbours` message until B4's lands. It finds the harbours standing in the loaded
 * chunks, takes each one's fairway tile and derives its lanes on this client's own tiles with the same
 * `deriveHarbourLanes` the server will run. A body that is not open water (the offing rule needs 1,500 tiles) gets a made-up
 * sea gate at its farthest roomy tile, so ships have somewhere to come from. Nothing here runs without `?dev`, and it
 * stops as soon as the server's own list arrives (BoatsView.real).
 */
const hid = (x: number, y: number) => ((x + 0x8000) * 65536 + (y + 0x8000)) % 2000003 + 1;
const SIDE_OF_FRONT = [2, 1, 0, 3]; // FRONT index -> RAIL side (N, E, S, W) of the same direction

export class HarbourMock {
  private perChunk = new Map<string, Placed[]>();
  private sig = '';
  private cur = '';
  private since = 0;
  private at = 0;
  gates: SeaGate[] = [];
  notes: string[] = [];

  scanChunk(key: string, c: ClientChunk) {
    const out: Placed[] = [];
    for (let i = 0; i < c.aux.length; i++) {
      const a = c.aux[i];
      if (!a || !isAnchorAux(a)) continue;
      const t = c.tiles[i];
      if (isRoad(t)) continue;
      const kind = kindIdOf(zoneOf(t), c.sub[i]);
      if (!isHarbourId(kind)) continue;
      out.push(placedFromAnchor(kind, c.cx * CHUNK_SIZE + (i % CHUNK_SIZE), c.cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE), auxOrientation(a)));
    }
    if (out.length) this.perChunk.set(key, out); else this.perChunk.delete(key);
  }
  dropChunk(key: string) { this.perChunk.delete(key); }

  /** the harbours to run, or null while nothing has changed (or the loaded tiles are still changing: it waits for a quiet 2.5 s) */
  update(world: ClientWorld, now: number): BoatHarbour[] | null {
    if (now - this.at < 500) return null;
    this.at = now;
    const placed = [...this.perChunk.values()].flat().sort((a, b) => a.ax - b.ax || a.ay - b.ay);
    const sig = `${placed.map((p) => `${p.kind}@${p.ax},${p.ay}r${p.r}`).join(';')}|${world.chunks.size}`;
    if (sig !== this.cur) { this.cur = sig; this.since = now; return null; }
    if (sig === this.sig || now - this.since < 2500) return null;
    this.sig = sig;
    return this.derive(world, placed);
  }

  derive(world: ClientWorld, placed: Placed[]): BoatHarbour[] {
    const grid = new WaterGrid({ tile: (x, y) => world.getTile(x, y), aux: (x, y) => world.auxAt(x, y) });
    const gates: SeaGate[] = [];
    this.notes = [];
    const out: BoatHarbour[] = [];
    placed.forEach((p, n) => {
      const spec = HARBOUR_OF[p.kind];
      if (!spec || spec.role === 'pier') return;
      // the mock joins marina and jetty lanes two rows out, where there is room for the river-class boats (the real list decides this)
      const row = fairwayTiles(p, Math.max(spec.fairwayClearance - 1, spec.role === 'marina' || spec.role === 'jetty' ? 2 : 0)), fairway = row[row.length >> 1];
      let gate = gates.find((g) => waterReach(grid, fairway, 400, 'narrow', PASS_ALL, 3000).some((t) => t.x === g.x && t.y === g.y));
      if (!gate) {
        const ow = openWater(grid, fairway[0], fairway[1]);
        let at = ow.offing;
        if (!at) {
          let best = -1;
          for (const t of waterReach(grid, fairway, 150, 'river', PASS_ALL, 12000)) { const s = (grid.clearance(t.x, t.y) >= 3 ? 1000 : 0) + t.d; if (s > best) { best = s; at = [t.x, t.y]; } }
        }
        if (at) { gate = { x: at[0], y: at[1], name: ow.open ? 'the offing' : 'the far shore' }; gates.push(gate); }
      }
      const r = deriveHarbourLanes(grid, { kind: p.kind, fairway, entry: SIDE_OF_FRONT[p.r], seed: hid(p.ax, p.ay), gates });
      for (const f of r.refused) this.notes.push(`${HARBOUR_OF[p.kind]?.role} at (${p.ax}, ${p.ay}): ${f.reason}`);
      out.push({ id: hid(p.ax, p.ay), kind: p.kind, x: p.ax, y: p.ay, name: `${['Saltmere', 'Fishbourne', 'Kestrel Bay', 'Ravensport', 'Tolland', 'Swanmere'][n % 6]} ${spec.role}`, active: true, berths: harbourBerths(p), lanes: r.lanes });
    });
    this.gates = gates;
    return out.sort((a, b) => a.id - b.id);
  }
}

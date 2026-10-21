import {
  FRONT, Zone, isRoad, zoneOf, houseNumber, streetsThrough, streetRun, streetLine, streetLength, streetTile, streetName, streetBase, cleanStreetName,
  type StreetRun, type StreetCharacter,
} from '@msimcity/shared';
import type { World } from './world';

/**
 * The street book (docs/roads.md "Street names", shared/src/streets.ts): the name of every street anyone has looked
 * at, kept per owner as stretches of a line (not per tile). A street is named the first time it is asked for (a
 * hover, a building's address) from its character then and the names round it, and keeps that name as it grows: a
 * longer run on the same line overlapping a named stretch takes its name and widens it. The owner of a street is the
 * owner of most of its tiles ('' for public road on unclaimed land); they may rename it. Saved in the snapshot
 * (`streets`, optional): an older save has no book, and its streets are named as they are first asked for, the same
 * way on every server (the name is a pure function of the seed, the street and what is round it).
 */
interface Entry { owner: string; from: number; to: number; name: string }
/** how far to each side a running-alongside street counts as a neighbour for names */
const NEAR = 8;

export type StreetsSave = Record<string, [string, string][]>;

export class StreetBook {
  /** named stretches by line (streetLine: 'h12', 'v-3') */
  private lines = new Map<string, Entry[]>();
  constructor(private w: World) {}

  private isRoadAt = (x: number, y: number) => { const t = this.w.peekTile(x, y); return t !== undefined && isRoad(t); };

  /** The streets through a road tile, longer first (none for a tile that is not road). */
  streetsAt(x: number, y: number): StreetRun[] { return streetsThrough(x, y, this.isRoadAt); }

  /** The named stretch a street takes its name from: on its line, overlapping it most (the earlier on a tie). */
  private entryFor(r: StreetRun): Entry | undefined {
    let best: Entry | undefined, over = 0;
    for (const e of this.lines.get(streetLine(r)) ?? []) {
      const o = Math.min(e.to, r.to) - Math.max(e.from, r.from) + 1;
      if (o > over || (o === over && o > 0 && best && e.from < best.from)) { best = e; over = o; }
    }
    return best;
  }

  /** The name a street has, without naming it: the stored one, else what it would be called (its first choice). */
  peek(r: StreetRun): string { return this.entryFor(r)?.name ?? streetName(this.w.seed, r, this.character(r)); }

  /** The street's name, naming it now if nobody has asked before; a stretch that has grown along its line keeps its name. */
  nameOf(r: StreetRun): string {
    const e = this.entryFor(r);
    if (e) {
      if (r.from < e.from || r.to > e.to) {
        e.from = Math.min(e.from, r.from); e.to = Math.max(e.to, r.to);
        // stretches it now covers whole (two streets joined end to end) give way to it
        const list = this.lines.get(streetLine(r))!;
        this.lines.set(streetLine(r), list.filter((o) => o === e || o.from < e.from || o.to > e.to));
      }
      return e.name;
    }
    const name = streetName(this.w.seed, r, this.character(r), this.takenAround(r));
    this.add(r, this.ownerOf(r), name);
    return name;
  }

  private add(r: StreetRun, owner: string, name: string) {
    const k = streetLine(r);
    const list = this.lines.get(k) ?? [];
    list.push({ owner, from: r.from, to: r.to, name });
    this.lines.set(k, list);
  }

  /** The owner of most of a street's tiles, '' when most of it is public road on unclaimed land. */
  ownerOf(r: StreetRun): string {
    const n = new Map<string, number>();
    for (let i = 0; i < streetLength(r); i++) {
      const [x, y] = streetTile(r, i);
      const o = this.w.parcelAt(x, y)?.owner ?? '';
      n.set(o, (n.get(o) ?? 0) + 1);
    }
    let best = '', most = 0;
    for (const [o, c] of n) if (c > most) { best = o; most = c; }
    return best;
  }

  /**
   * Rename a street (its owner, or anyone in a sandbox: the caller checks). An empty name forgets the stored one, so
   * the street is named afresh. Returns the name it now has.
   */
  rename(r: StreetRun, name: string): string {
    const clean = cleanStreetName(name);
    const e = this.entryFor(r);
    if (!clean) {
      if (e) this.lines.set(streetLine(r), this.lines.get(streetLine(r))!.filter((o) => o !== e));
      return this.nameOf(r);
    }
    if (e) { e.name = clean; e.from = Math.min(e.from, r.from); e.to = Math.max(e.to, r.to); }
    else this.add(r, this.ownerOf(r), clean);
    return clean;
  }

  /** What a street is like now: its length, whether its ends meet other road, and what fronts it. */
  character(r: StreetRun): StreetCharacter {
    const c: StreetCharacter = { length: streetLength(r), joined: 0, homes: 0, shops: 0, works: 0, offices: 0 };
    const ax = r.ns ? 1 : 0, ay = r.ns ? 0 : 1; // across
    let joined = 0;
    for (let i = 0; i < c.length; i++) {
      const [x, y] = streetTile(r, i);
      for (const s of [1, -1]) {
        const t = this.w.peekTile(x + ax * s, y + ay * s);
        if (t === undefined) continue;
        if (isRoad(t)) { if (i === 0 || i === c.length - 1) joined |= i === 0 ? 1 : 2; continue; }
        const z = zoneOf(t);
        if (z === Zone.Residential) c.homes++;
        else if (z === Zone.Commercial) c.shops++;
        else if (z === Zone.Industrial) c.works++;
        else if (z === Zone.Office) c.offices++;
      }
    }
    if (c.length === 1) joined = joined ? 3 : 0;
    c.joined = (((joined & 1) ? 1 : 0) + ((joined & 2) ? 1 : 0)) as 0 | 1 | 2;
    return c;
  }

  /** The bases of the names round a street (those crossing it and those alongside within NEAR tiles), which it must not share. */
  private takenAround(r: StreetRun): Set<string> {
    const out = new Set<string>(), seen = new Set<string>();
    const note = (n: StreetRun) => {
      const k = `${streetLine(n)}:${n.from}`;
      if (seen.has(k) || (n.ns === r.ns && n.line === r.line)) return;
      seen.add(k);
      out.add(streetBase(this.peek(n)));
    };
    const ax = r.ns ? 1 : 0, ay = r.ns ? 0 : 1;
    for (let i = 0; i < streetLength(r); i++) {
      const [x, y] = streetTile(r, i);
      // a street crossing this one (or meeting it at a T or a bend)
      if (this.isRoadAt(x + ax, y + ay) || this.isRoadAt(x - ax, y - ay)) note(streetRun(x, y, !r.ns, this.isRoadAt));
      // streets alongside, on the lines either side
      for (let d = 1; d <= NEAR; d++) for (const s of [1, -1]) {
        const px = x + ax * s * d, py = y + ay * s * d;
        if (!this.isRoadAt(px, py)) continue;
        const along = r.ns ? this.isRoadAt(px, py - 1) || this.isRoadAt(px, py + 1) : this.isRoadAt(px - 1, py) || this.isRoadAt(px + 1, py);
        if (along) note(streetRun(px, py, r.ns, this.isRoadAt));
      }
    }
    return out;
  }

  /**
   * A building's address: the number on its door (shared houseNumber, as the door plates read) and the street its
   * front faces. A 1×1 building faces the road the way the renderer turns it (+y, +x, -x, -y first); a structure by
   * its placement. Undefined when no road is beside it.
   */
  address(x: number, y: number): string | undefined {
    const s = this.w.structureAt(x, y);
    let r = -1, ox = x, oy = y, nx = 0, ny = 0;
    if (s) {
      r = s.r & 3; [nx, ny] = [s.doorX + FRONT[r][0], s.doorY + FRONT[r][1]]; ox = s.ax; oy = s.ay;
      if (!this.isRoadAt(nx, ny)) return undefined;
    } else {
      for (const q of [0, 1, 3, 2]) if (this.isRoadAt(x + FRONT[q][0], y + FRONT[q][1])) { r = q; break; }
      if (r < 0) return undefined;
      [nx, ny] = [x + FRONT[r][0], y + FRONT[r][1]];
    }
    const along = (r & 1) === 1; // facing ±x: the street runs north-south
    const st = streetRun(nx, ny, along, this.isRoadAt);
    return `${houseNumber(ox, oy, r)} ${this.nameOf(st)}`;
  }

  // ---- the snapshot ---------------------------------------------------------------------------------------

  toSave(): StreetsSave | undefined {
    const out: StreetsSave = {};
    let any = false;
    for (const [line, list] of this.lines) for (const e of list) { (out[e.owner] ??= []).push([`${line}:${e.from}:${e.to}`, e.name]); any = true; }
    return any ? out : undefined;
  }

  load(save: unknown) {
    this.lines.clear();
    if (!save || typeof save !== 'object') return;
    for (const [owner, list] of Object.entries(save as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (!Array.isArray(item) || typeof item[0] !== 'string' || typeof item[1] !== 'string') continue;
        const m = /^([hv])(-?\d+):(-?\d+):(-?\d+)$/.exec(item[0]);
        const name = cleanStreetName(item[1]);
        if (!m || !name) continue;
        this.add({ ns: m[1] === 'v', line: Number(m[2]), from: Number(m[3]), to: Number(m[4]) }, owner, name);
      }
    }
  }

  /** how many stretches are named (probes) */
  get size() { let n = 0; for (const l of this.lines.values()) n += l.length; return n; }
}

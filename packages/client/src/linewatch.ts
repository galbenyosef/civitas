import { CHUNK_SIZE, STOP_KINDS, isRoad, zoneOf, kindIdOf, type StopRef, type TransitMode, type ParcelDTO } from '@msimcity/shared';

/**
 * The line editor's watch on the world (docs/transit.md "Stops you can see" and "Errors that heal"), kept free of the
 * DOM and three.js so client/scripts/lines-check.ts can run it on a fake clock.
 *
 *  - **PreviewGate** decides when the draft is routed again. A draft edit (a stop clicked or taken off) asks for the route
 *    in 120 ms, so quick clicks go out as one; a change under the draft (a road laid or lifted, a turn rule, a stop built
 *    or knocked down, land arriving) asks in 300 ms. Either way a request goes out at most once per 300 ms, and a stream of
 *    changes inside one window is one request, sent after the last of them has had its say.
 *  - **StopSet** remembers which stops the markers were built for, so a change that leaves the stops as they were (a road
 *    laid, a house growing) rebuilds nothing.
 *  - **collectStops** finds the stops of a mode on the land the player may use, in the chunks the client holds.
 */

/** the least time between two preview requests for one draft, and how long a change under the draft waits for company */
export const PREVIEW_GAP_MS = 300, PREVIEW_AFTER_WORLD_MS = 300, PREVIEW_AFTER_EDIT_MS = 120;

export class PreviewGate {
  private lastSent = -Infinity;
  private due = -1;
  constructor(readonly gap = PREVIEW_GAP_MS) {}
  /** Something changed at `now`: ask for a request in `delay` ms (never sooner than the gap after the last one). */
  poke(now: number, delay: number) {
    const t = Math.max(now + delay, this.lastSent + this.gap);
    this.due = this.due < 0 ? t : Math.min(this.due, t);
  }
  /** Once a frame: true when a request should go out now (and counts it as sent). */
  take(now: number): boolean {
    if (this.due < 0 || now < this.due) return false;
    this.due = -1; this.lastSent = now;
    return true;
  }
  /** The draft went away: nothing is owed (the gap since the last request still holds). */
  drop() { this.due = -1; }
  get pending() { return this.due >= 0; }
}

/** What the watcher reads of the world: three counters (ClientWorld.layoutVersion, rulesVersion, chunksVersion). */
export interface WorldVersions { layoutVersion: number; rulesVersion: number; chunksVersion: number }
/** What it is told about the panel each frame. */
export interface WatchContext {
  /** the panel is open */
  open: boolean;
  /** a line is being edited, and has the two stops it takes to be routed */
  drafting: boolean; routable: boolean;
  /** with no draft: some line of yours is not running (its status may be one the roads just fixed) */
  listStale: boolean;
}
/** What to do this frame. */
export interface WatchActions { preview: boolean; lines: boolean; stops: boolean }

/**
 * Watches the world's counters for the line editor and says, once a frame, what is owed: the draft routed again
 * (`preview`), the list of lines read again (`lines`, when there is no draft but a line is not running), the stops gathered
 * again (`stops`). A change in the roads (tiles, aux, sub or under bytes, the turn rules) owes the first or second; a change
 * in the stops (those, or chunks arriving) owes the third. A chunk arriving is the view moving, not the roads: it never owes a route.
 */
export class LineWatcher {
  readonly route = new PreviewGate();
  readonly look = new PreviewGate();
  private layout = -1; private rules = -1; private chunks = -1;
  constructor(private w: WorldVersions) {}
  /** a draft edit: route it shortly */
  edited(now: number) { this.route.poke(now, PREVIEW_AFTER_EDIT_MS); }
  /** the draft closed, or the panel did */
  drop() { this.route.drop(); this.look.drop(); }
  step(now: number, c: WatchContext): WatchActions {
    const w = this.w, lv = w.layoutVersion, rv = w.rulesVersion, cv = w.chunksVersion;
    if (lv !== this.layout || rv !== this.rules || cv !== this.chunks) {
      const roads = lv !== this.layout || rv !== this.rules, stops = lv !== this.layout || cv !== this.chunks;
      this.layout = lv; this.rules = rv; this.chunks = cv;
      if (c.open && c.drafting) {
        if (roads && c.routable) this.route.poke(now, PREVIEW_AFTER_WORLD_MS);
        if (stops) this.look.poke(now, PREVIEW_AFTER_WORLD_MS);
      } else if (c.open && roads && c.listStale) this.route.poke(now, PREVIEW_AFTER_WORLD_MS);
    }
    if (!c.open) return { preview: false, lines: false, stops: false };
    const go = this.route.take(now);
    return { preview: go && c.drafting, lines: go && !c.drafting, stops: c.drafting && this.look.take(now) };
  }
}

/** The stops the markers stand on, as a signature: `update` says whether it differs from the last set. */
export class StopSet {
  private sig = '';
  stops: StopFound[] = [];
  update(stops: StopFound[]): boolean {
    const sig = stops.map((s) => `${s.x},${s.y}`).join(';');
    if (sig === this.sig) return false;
    this.sig = sig; this.stops = stops;
    return true;
  }
  clear() { this.sig = ''; this.stops = []; }
}

/** What collectStops needs of the world (ClientWorld has all of it). */
export interface StopSource {
  chunks: Map<string, { cx: number; cy: number; tiles: Uint16Array; sub: Uint8Array }>;
  doorOf(x: number, y: number): [number, number];
  parcelAt(x: number, y: number): Pick<ParcelDTO, 'owner'> | undefined;
  mayEdit(owner: string): boolean;
}
export interface StopFound extends StopRef { mode: TransitMode }

/** zone codes whose base kind is a stop (the other stops are sub-kinds, which the sub byte names) */
const BASE_STOP: boolean[] = Array.from({ length: 16 }, (_, z) => STOP_KINDS[kindIdOf(z, 0)] !== undefined);

/**
 * The stops of the given modes on land the player may edit: a bus stop by its tile, a station or pier by its door tile
 * (the tile a line keeps it by). One pass over the loaded chunks' tile words, skipping roads and anything that cannot be
 * a stop before it asks the world a question.
 */
export function collectStops(w: StopSource, modes: readonly TransitMode[]): StopFound[] {
  const seen = new Set<string>(), out: StopFound[] = [];
  for (const c of w.chunks.values()) {
    const { tiles, sub } = c;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (isRoad(t)) continue;
      const s = sub[i], z = zoneOf(t);
      if (s === 0 ? !BASE_STOP[z] : STOP_KINDS[s] === undefined) continue;
      const mode = STOP_KINDS[kindIdOf(z, s)];
      if (!mode || !modes.includes(mode)) continue;
      let x = c.cx * CHUNK_SIZE + (i % CHUNK_SIZE), y = c.cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
      if (mode !== 'bus') [x, y] = w.doorOf(x, y);
      const key = `${x},${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const p = w.parcelAt(x, y);
      if (!p || !w.mayEdit(p.owner)) continue;
      out.push({ x, y, mode });
    }
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

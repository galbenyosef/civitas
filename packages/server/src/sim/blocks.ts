import { FRONT, KIND_ID, Zone, familyOf, hash2, isBuildable, isRoad, levelOf, placedFromAnchor, placedFromDoor, tileKey, underConstruction, withConstruction, withLevel, zoneOf, type Placed } from '@msimcity/shared';
import { tkey, type World } from '../world';

/**
 * Block interiors (docs/buildings.md "Block interiors"). A block between roads is typically 4×4 tiles: the twelve
 * edge tiles have frontage, the 2×2 middle has none, and lots grow only beside a road. Three rules use the middle:
 *
 * - **Deep plots.** A landlocked lot zoned like a frontage building beside it, with the same owner, is built on by
 *   that building growing back into it: the deep-plot merged kinds (1 wide, 2 deep, levels 2-4, ids 86-89) keep their door on the
 *   road (`deepBackOk`, read by Simulation.planMerge). Bigger merges (a perimeter block, a shopping centre, a works)
 *   take landlocked lots and a whole garden in as before.
 * - **Interior zoning.** Zoning round a block also zones the landlocked tiles it encloses when every zoned neighbour
 *   is the same zone (`interiorLots`, net.ts), so the middle is ready for a deep plot. Not where a garden belongs.
 * - **Communal gardens.** When the twelve tiles round a 2×2 middle are all homes, the residents plant it as a shared
 *   garden (`plantGardens`): a 2×2 park kind that only the homes round it count (leisure blockOnly). Land rule: the
 *   four middle tiles belong to one owner who also owns at least one of the homes round them; the garden stays theirs,
 *   costs them nothing and has no upkeep. The middle must be empty: bare land or empty residential lots.
 */
export const GARDEN_KIND = KIND_ID['block-garden'];
/** Chance per pass that a block ready for a garden gets it, so a district's gardens appear over days, not at once. */
const GARDEN_P = 0.35;

/** The twelve tiles round the 2×2 whose min corner is (ax, ay), as offsets. */
const RING: [number, number][] = [
  [-1, -1], [0, -1], [1, -1], [2, -1], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [-1, 2], [-1, 1], [-1, 0],
];
const SIDES: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** A tile no road reaches: not a road and no road on any side. */
export function landlocked(w: World, x: number, y: number): boolean {
  const t = w.peekTile(x, y);
  return t !== undefined && !isRoad(t) && !w.hasRoadAccess(x, y);
}

/** Empty land a block's middle can be: bare (no zone) or an empty lot of `zone`, not water, nothing on it. */
function emptyMiddle(w: World, x: number, y: number, zone: number): boolean {
  const t = w.peekTile(x, y);
  if (t === undefined || isRoad(t) || !isBuildable(t) || w.auxAt(x, y) || underConstruction(t)) return false;
  const z = zoneOf(t);
  return z === Zone.None || (z === zone && levelOf(t) === 0);
}

/**
 * Is (x, y) one of the four empty middle tiles of a block ringed by residential land (built or not)? There the middle
 * is left for a communal garden: no deep plot grows into it and zoning round the block does not zone it. Once a bigger
 * merge has built on part of the middle it is no garden block any more, and deep plots may take the rest.
 */
export function inGardenBlock(w: World, x: number, y: number): boolean {
  for (let oy = -1; oy <= 0; oy++) for (let ox = -1; ox <= 0; ox++) {
    const ax = x + ox, ay = y + oy;
    let ok = true;
    for (let i = 0; i < 4 && ok; i++) ok = emptyMiddle(w, ax + (i & 1), ay + (i >> 1), Zone.Residential);
    for (let i = 0; i < RING.length && ok; i++) { const t = w.peekTile(ax + RING[i][0], ay + RING[i][1]); ok = t !== undefined && !isRoad(t) && zoneOf(t) === Zone.Residential; }
    if (ok) return true;
  }
  return false;
}

/**
 * A deep plot (zones.ts GrowForm.deep) may stand here: every tile behind its front row is landlocked, so it grows
 * into the block's middle and never takes a lot with frontage of its own, and not into a garden block's middle.
 */
export function deepBackOk(w: World, p: Placed, zone: number): boolean {
  for (let y = p.ay; y < p.ay + p.h; y++) for (let x = p.ax; x < p.ax + p.w; x++) {
    if (x === p.doorX && y === p.doorY) continue;
    if (!landlocked(w, x, y)) return false;
    if (zone === Zone.Residential && inGardenBlock(w, x, y)) return false;
  }
  return true;
}

/**
 * Landlocked tiles next to a zoning stroke that the stroke should zone too: bare, owned by the player, every zoned
 * neighbour of the same zone and at least two of them (a block's middle, not a stray corner), and for homes not the
 * middle of a garden block. `zone` is the zone kind id; tiles come back in no particular order.
 */
export function interiorLots(w: World, zoned: readonly [number, number][], zone: number, owner: string): [number, number][] {
  const fam = familyOf(zone);
  const seen = new Set<number>(), out: [number, number][] = [];
  for (const [zx, zy] of zoned) for (const [dx, dy] of SIDES) {
    const x = zx + dx, y = zy + dy, k = tkey(x, y);
    if (seen.has(k)) continue;
    seen.add(k);
    const t = w.peekTile(x, y);
    if (t === undefined || zoneOf(t) !== Zone.None || !emptyMiddle(w, x, y, fam) || !landlocked(w, x, y)) continue;
    if (w.parcelAt(x, y)?.owner !== owner) continue;
    let same = 0, other = 0;
    for (const [ex, ey] of SIDES) {
      const z = zoneOf(w.peekTile(x + ex, y + ey) ?? 0);
      if (z === fam) same++; else if (z !== Zone.None) other++;
    }
    if (same < 2 || other > 0) continue;
    if (fam === Zone.Residential && inGardenBlock(w, x, y)) continue;
    out.push([x, y]);
  }
  return out;
}

/** Gardens planted so far this run (probes and the fill log). */
export const gardenStats = { planted: 0, checked: 0 };

/**
 * Plant communal gardens: for every built home, look at the landlocked tiles beside it; each 2×2 middle found there is
 * planted (GARDEN_P a pass, so they appear over time) when its twelve-tile ring is all built homes, the four tiles are
 * empty and one owner holds them and at least one of the homes. The garden's facing (and so its look) is hash-seeded
 * per block, as is its design (render/chunkView.ts picks by the anchor's hash).
 */
export function plantGardens(w: World) {
  const tried = new Set<number>();
  const visit = (x: number, y: number) => {
    for (const [dx, dy] of SIDES) {
      const nx = x + dx, ny = y + dy;
      if (!emptyMiddle(w, nx, ny, Zone.Residential) || !landlocked(w, nx, ny)) continue;
      for (let oy = -1; oy <= 0; oy++) for (let ox = -1; ox <= 0; ox++) {
        const ax = nx + ox, ay = ny + oy, k = tkey(ax, ay);
        if (tried.has(k)) continue;
        tried.add(k);
        gardenStats.checked++;
        if (gardenFits(w, ax, ay) && Math.random() < GARDEN_P) plant(w, ax, ay);
      }
    }
  };
  for (const b of w.builtOf(Zone.Residential)) {
    const s = w.auxAt(b.x, b.y) ? w.structureAt(b.x, b.y) : null;
    if (!s) { visit(b.x, b.y); continue; }
    for (let y = s.ay; y < s.ay + s.h; y++) for (let x = s.ax; x < s.ax + s.w; x++) visit(x, y);
  }
}

function gardenFits(w: World, ax: number, ay: number): boolean {
  const owner = w.parcelAt(ax, ay)?.owner;
  if (!owner) return false;
  for (let i = 0; i < 4; i++) {
    const x = ax + (i & 1), y = ay + (i >> 1);
    if (!emptyMiddle(w, x, y, Zone.Residential) || w.sites.has(tileKey(x, y)) || w.parcelAt(x, y)?.owner !== owner) return false;
  }
  let theirs = false;
  for (const [ox, oy] of RING) {
    const x = ax + ox, y = ay + oy, t = w.peekTile(x, y);
    if (t === undefined || isRoad(t) || zoneOf(t) !== Zone.Residential || levelOf(t) === 0) return false;
    if (!theirs && w.parcelAt(x, y)?.owner === owner) theirs = true;
  }
  return theirs;
}

/** Deep-plot kind id (block-interior.ts) per zone family code. */
const DEEP_KIND: Record<number, number> = { [Zone.Residential]: KIND_ID['res-deep'], [Zone.Commercial]: KIND_ID['com-deep'], [Zone.Office]: KIND_ID['off-deep'], [Zone.Industrial]: KIND_ID['ind-deep'] };

/**
 * Seeding (seedCommons, loadtest/cities.ts seedCity): a pre-built grid zones and builds every tile of a block, the
 * landlocked middle included, which would leave buildings no road reaches. Settle the middles in the rectangle by the
 * same rules growth uses instead: every landlocked zoned lot is emptied; a garden block's middle becomes its communal
 * garden when the homes round it stand; any other middle lot is taken into a deep plot with a frontage lot of its zone
 * and owner beside it, built at `level` (2-4; below 2 the lot stays empty for growth to extend). Deterministic (hashes,
 * no randomness), so a demo seeds the same town twice. Run before any citizen exists.
 */
export function settleInteriors(w: World, x0: number, y0: number, x1: number, y1: number, level: number) {
  const inner: [number, number][] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const t = w.peekTile(x, y);
    if (t === undefined || isRoad(t) || w.auxAt(x, y) || zoneOf(t) < Zone.Residential || zoneOf(t) > Zone.Office || !landlocked(w, x, y)) continue;
    w.sites.delete(tileKey(x, y));
    w.setTile(x, y, withConstruction(withLevel(t, 0), false));
    inner.push([x, y]);
  }
  for (const [x, y] of inner) for (let oy = -1; oy <= 0; oy++) for (let ox = -1; ox <= 0; ox++) if (gardenFits(w, x + ox, y + oy)) plant(w, x + ox, y + oy);
  const lv = Math.min(4, level);
  if (lv < 2) return;
  for (const [x, y] of inner) {
    if (w.auxAt(x, y)) continue; // a garden now, or already in a deep plot
    const fam = zoneOf(w.getTile(x, y)), owner = w.parcelAt(x, y)?.owner;
    const r0 = Math.floor(hash2(x * 3 + 17, y * 5 + 29) * 4);
    for (let i = 0; i < 4; i++) {
      const r = (r0 + i) & 3, [fx, fy] = FRONT[r], nx = x + fx, ny = y + fy, ft = w.peekTile(nx + fx, ny + fy), nt = w.peekTile(nx, ny);
      // the frontage lot is in front of the middle tile, with the road beyond it: the plot's door faces that road
      if (nt === undefined || ft === undefined || !isRoad(ft) || isRoad(nt) || zoneOf(nt) !== fam || w.auxAt(nx, ny) || w.parcelAt(nx, ny)?.owner !== owner) continue;
      w.placeStructure(placedFromDoor(DEEP_KIND[fam], nx, ny, r), { work: 0, priority: 0, built: true, target: lv });
      break;
    }
  }
}

function plant(w: World, ax: number, ay: number) {
  const r = Math.floor(hash2(ax * 5 + 1, ay * 7 + 3) * 4) & 3;
  w.placeStructure(placedFromAnchor(GARDEN_KIND, ax, ay, r), { work: 0, priority: 0, built: true, target: 1 });
  gardenStats.planted++;
}

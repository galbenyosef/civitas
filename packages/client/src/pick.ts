import { hash2, zoneOf, levelOf, isRoad, kindIdOf, underConstruction, progressOf, isPartAux, isAnchorAux, isMultiTile, partDx, partDy } from '@msimcity/shared';

/**
 * Picking a tile under the cursor by the column of its building, not only by the ground behind it.
 *
 * The camera's ray used to be cut with the ground plane alone, so a click on the upper floors or the roof of a tall
 * building landed on the tile *behind* it, farther from the camera. This walks the ray's ground projection tile by
 * tile, nearest the camera first, and returns the first tile whose building column (the tile's square, from the
 * ground up to the height the building is drawn at) the ray meets. When it meets none, the answer is the plane hit's
 * tile, which is what the pick was before.
 *
 * Pure numbers, no three.js: camera.ts hands in the ray, main.ts the heights.
 */

/** What picking needs of the city: the drawn height of the column on a tile (0 for none) and the tallest there can be */
export interface ColumnPick {
  /** height, in tiles, of the building drawn on (x, y), roof included; 0 for a tile with no building */
  heightAt(x: number, y: number): number;
  /** an upper bound of heightAt anywhere: the walk starts where the ray comes down to this height */
  maxH: number;
}

/** how far (pixels) above a column's top a ray may pass and still pick the building: the sky side of a roof edge */
export const PICK_SLACK_PX = 3;
/** longest walk, in tiles (a ray at a grazing angle could cross many) */
const MAX_STEPS = 160;

/**
 * The tile a ray picks: origin (ox, oy, oz) and unit direction (dx, dy, dz), y up and the ground at y = 0. `slack` is the
 * allowance above a column per unit of distance along the ray (PICK_SLACK_PX pixels at a distance of one unit).
 * Null when the ray does not come down to the ground (the sky).
 */
export function pickColumn(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, col: ColumnPick | null, slack = 0): [number, number] | null {
  if (!(dy < -1e-9) || !(oy > 0)) return null;
  const tg = -oy / dy;
  const gx = ox + dx * tg, gz = oz + dz * tg;
  const plane: [number, number] = [Math.floor(gx), Math.floor(gz)];
  if (!col || col.maxH <= 0) return plane;
  // start where the ray has come down to the tallest column (with its allowance), or at the eye when it is below that
  const top = col.maxH + slack * tg;
  const t0 = Math.max(0, (top - oy) / dy);
  if (t0 >= tg) return plane;
  let x = ox + dx * t0, z = oz + dz * t0;
  let ix = Math.floor(x), iz = Math.floor(z);
  const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const adx = Math.abs(dx), adz = Math.abs(dz);
  const ndx = adx > 1e-12 ? 1 / adx : Infinity, ndz = adz > 1e-12 ? 1 / adz : Infinity;
  let tx = adx > 1e-12 ? t0 + ((sx > 0 ? ix + 1 - x : x - ix)) * ndx : Infinity;
  let tz = adz > 1e-12 ? t0 + ((sz > 0 ? iz + 1 - z : z - iz)) * ndz : Infinity;
  for (let n = 0; n < MAX_STEPS; n++) {
    const te = Math.min(tx, tz, tg);
    const h = col.heightAt(ix, iz);
    // the ray only comes down: it meets the column if it is at or below the top where it leaves the tile
    if (h > 0 && oy + dy * te <= h + slack * te) return [ix, iz];
    if (te >= tg) break;
    if (tx <= tz) { ix += sx; tx += ndx; } else { iz += sz; tz += ndz; }
  }
  return plane;
}

/** The parts of the client's world the column height reads (world.ts ClientWorld) */
export interface ColumnWorld {
  getTile(x: number, y: number): number | undefined;
  auxAt(x: number, y: number): number;
  subAt(x: number, y: number): number;
}

/**
 * The drawn height of the building on a tile, from the same rules render/chunkView.ts draws it by: the design the
 * tile's hash picks (`variant`), scaled by the tile's own jitter for a single-tile building, unscaled for a multi-tile
 * structure (every tile of its footprint is the same column, read from the anchor), and the rising shell of a site
 * scaled by its progress. Roads, bare land and unloaded tiles are 0. Bridges, flyovers and rail decks are not columns
 * (docs/controls.md: they pick as the ground).
 */
export function columnHeights(world: ColumnWorld, variant: (kind: number, level: number, pick: number) => { height: number } | undefined): (x: number, y: number) => number {
  return (x, y) => {
    let t = world.getTile(x, y);
    if (t === undefined || zoneOf(t) === 0 || isRoad(t)) return 0;
    let sx = x, sy = y;
    const a = world.auxAt(x, y);
    const part = a !== 0 && isPartAux(a);
    if (part) { // a part tile of a structure: the anchor holds the level and the sub byte
      sx = x - partDx(a); sy = y - partDy(a);
      const at = world.getTile(sx, sy);
      if (at === undefined || zoneOf(at) === 0 || isRoad(at)) return 0;
      t = at;
    }
    const kind = kindIdOf(zoneOf(t), world.subAt(sx, sy));
    const multi = part || (a !== 0 && isAnchorAux(a) && isMultiTile(kind));
    const level = levelOf(t);
    const pick = hash2(sx * 13 + 5, sy * 17 + 11);
    const s = multi ? 1 : 0.95 + 0.1 * hash2(sy * 3 + 1, sx * 5 + 7);
    if (level > 0) return (variant(kind, level, pick)?.height ?? 0) * s;
    if (underConstruction(t)) return (variant(kind, 1, pick)?.height ?? 0) * s * (0.06 + 0.94 * ((progressOf(t) + 0.5) / 4));
    return 0;
  };
}

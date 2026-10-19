//! The map as the searches see it: chunks of tile words and aux bytes, and the shared tile rules the TypeScript
//! searches use (shared/src/tile.ts, junctions.ts, bridges.ts; server/src/world.ts hasRoadAccess).

pub const CHUNK: i32 = 32;
pub const CELLS: usize = (CHUNK * CHUNK) as usize;
/** a flyover's road beneath is its own search node: key + LAYER (pathfinding.ts) */
pub const LAYER: u64 = 1 << 32;
/** the four steps, in the order every search tries them (world.ts DIRS) */
pub const DIRS: [(i32, i32); 4] = [(1, 0), (-1, 0), (0, 1), (0, -1)];

const WATER: u16 = 1;
const BRIDGE_AUX: u8 = 0xd8;
const RING_AUX: u8 = 0xf0;
const FLYOVER_EW: u8 = 0xf9;
const FLYOVER_NS: u8 = 0xfa;
/** routers skip junction_step_ok below this (junctions.ts STEP_RULE_AUX = BRIDGE_AUX) */
pub const STEP_RULE_AUX: u8 = BRIDGE_AUX;
const RING_POS: [(i32, i32); 8] = [(1, 0), (1, -1), (0, -1), (-1, -1), (-1, 0), (-1, 1), (0, 1), (1, 1)];

#[inline] pub fn is_road(t: u16) -> bool { (t >> 2) & 1 == 1 }
#[inline] pub fn is_bridge_aux(a: u8) -> bool { a & 0xf8 == BRIDGE_AUX }
#[inline] fn bridge_ns(a: u8) -> bool { a & 1 == 1 }
#[inline] fn is_ring_aux(a: u8) -> bool { a & 0xf8 == RING_AUX }
#[inline] fn is_flyover_aux(a: u8) -> bool { a == FLYOVER_EW || a == FLYOVER_NS }
#[inline] fn ring_pos(a: u8) -> usize { (a & 7) as usize }
/** (x + 0x8000) * 65536 + (y + 0x8000) */
#[inline] pub fn tkey(x: i32, y: i32) -> u64 { ((x + 0x8000) as u64) * 65536 + (y + 0x8000) as u64 }
#[inline] pub fn untkey(k: u64) -> (i32, i32) { let b = k & 0xffff_ffff; ((b >> 16) as i32 - 0x8000, (b & 0xffff) as i32 - 0x8000) }
/** junctions.ts routeLayer: the deck of a flyover entered along y is layer 1 */
#[inline] pub fn route_layer(a: u8, dx: i32) -> u64 { if is_flyover_aux(a) && dx == 0 { 1 } else { 0 } }
/** pathfinding.ts sideways: onto a bridge deck from the side */
#[inline] pub fn sideways(a: u8, dx: i32) -> bool { is_bridge_aux(a) && bridge_ns(a) == (dx != 0) }

pub struct World {
    pub cx0: i32, pub cy0: i32, pub gw: i32, pub gh: i32,
    /** chunk slot by grid cell, -1 for none */
    pub grid: Vec<i32>,
    pub tiles: Vec<u16>,
    pub aux: Vec<u8>,
}

impl World {
    /** cell index (slot * 1024 + local index) of a tile, None where no chunk is loaded */
    #[inline]
    pub fn cell(&self, x: i32, y: i32) -> Option<usize> {
        let cx = x.div_euclid(CHUNK) - self.cx0;
        let cy = y.div_euclid(CHUNK) - self.cy0;
        if cx < 0 || cy < 0 || cx >= self.gw || cy >= self.gh { return None; }
        let s = self.grid[(cy * self.gw + cx) as usize];
        if s < 0 { return None; }
        Some(s as usize * CELLS + (y.rem_euclid(CHUNK) * CHUNK + x.rem_euclid(CHUNK)) as usize)
    }
    /** pathfinding.ts peek: the tile word and the aux byte (0 where the chunk is missing) */
    #[inline]
    pub fn peek(&self, x: i32, y: i32) -> (Option<u16>, u8) {
        match self.cell(x, y) { Some(c) => (Some(self.tiles[c]), self.aux[c]), None => (None, 0) }
    }
    #[inline] pub fn aux_at(&self, x: i32, y: i32) -> u8 { self.peek(x, y).1 }
    #[inline] pub fn peek_tile(&self, x: i32, y: i32) -> Option<u16> { self.peek(x, y).0 }
    /** world.ts hasRoadAccess: a road beside the lot that is not a bridge deck */
    pub fn has_road_access(&self, x: i32, y: i32) -> bool {
        DIRS.iter().any(|&(dx, dy)| matches!(self.peek_tile(x + dx, y + dy), Some(t) if is_road(t) && (t & 3) != WATER))
    }
    /** junctions.ts junctionStepOk */
    pub fn junction_step_ok(&self, ax: i32, ay: i32, bx: i32, by: i32, pdx: i32, pdy: i32) -> bool {
        let a = self.aux_at(ax, ay);
        if is_bridge_aux(a) { return if bridge_ns(a) { bx == ax } else { by == ay }; }
        if a < RING_AUX { return true; }
        if is_flyover_aux(a) { return (pdx == 0 && pdy == 0) || (bx - ax == pdx && by - ay == pdy); }
        if !is_ring_aux(a) { return true; }
        let b = self.aux_at(bx, by);
        if !is_ring_aux(b) { return true; }
        let (ix, iy) = (ax - RING_POS[ring_pos(a)].0, ay - RING_POS[ring_pos(a)].1);
        let (jx, jy) = (bx - RING_POS[ring_pos(b)].0, by - RING_POS[ring_pos(b)].1);
        ix != jx || iy != jy || ring_pos(b) == ((ring_pos(a) + 1) & 7)
    }
}

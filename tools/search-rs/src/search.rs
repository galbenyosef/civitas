//! Ports of server/src/pathfinding.ts findPath, pathBetween and findRoute: the same steps in the same order, the same
//! node keys, the same binary heap and the same float arithmetic, so they expand the same nodes and give the same paths.
//! The JS Maps and Sets become open-addressing tables in per-thread scratch that is reused from search to search.

use crate::world::*;

/** An open-addressing map from node key to a slot index, cleared in O(1) by bumping a stamp. */
pub struct KeyMap { keys: Vec<u64>, vals: Vec<u32>, stamp: Vec<u32>, now: u32, mask: usize }

impl KeyMap {
    pub fn new() -> Self { KeyMap { keys: vec![], vals: vec![], stamp: vec![], now: 1, mask: 0 } }
    /** empty it, with room for at least `n` keys at half load */
    pub fn reset(&mut self, n: usize) {
        let cap = (n * 2).next_power_of_two().max(1024);
        if cap > self.keys.len() { self.keys = vec![0; cap]; self.vals = vec![0; cap]; self.stamp = vec![0; cap]; self.now = 0; self.mask = cap - 1; }
        self.now = self.now.wrapping_add(1);
        if self.now == 0 { self.stamp.iter_mut().for_each(|s| *s = 0); self.now = 1; }
    }
    #[inline] fn slot(&self, k: u64) -> usize { (k.wrapping_mul(0x9E37_79B9_7F4A_7C15) >> 32) as usize & self.mask }
    #[inline]
    pub fn get(&self, k: u64) -> Option<u32> {
        let mut i = self.slot(k);
        loop {
            if self.stamp[i] != self.now { return None; }
            if self.keys[i] == k { return Some(self.vals[i]); }
            i = (i + 1) & self.mask;
        }
    }
    /** the value for k, inserting `v` when absent; (value, inserted) */
    #[inline]
    pub fn get_or_insert(&mut self, k: u64, v: u32) -> (u32, bool) {
        let mut i = self.slot(k);
        loop {
            if self.stamp[i] != self.now { self.stamp[i] = self.now; self.keys[i] = k; self.vals[i] = v; return (v, true); }
            if self.keys[i] == k { return (self.vals[i], false); }
            i = (i + 1) & self.mask;
        }
    }
}

struct BfsNode { x: i32, y: i32, parent: u32, a: u8 }
const NONE: u32 = u32::MAX;

pub struct Scratch {
    map: KeyMap,
    nodes: Vec<BfsNode>,
    // A*: per node slot
    g: Vec<f64>, parent: Vec<u64>, dir_in: Vec<i8>, closed: Vec<bool>, key: Vec<u64>,
    heap_k: Vec<u64>, heap_f: Vec<f64>,
}

impl Scratch {
    pub fn new() -> Self {
        Scratch { map: KeyMap::new(), nodes: vec![], g: vec![], parent: vec![], dir_in: vec![], closed: vec![], key: vec![], heap_k: vec![], heap_f: vec![] }
    }
}

pub struct PathResult { pub path: Vec<i32>, pub gx: i32, pub gy: i32 }

/** pathfinding.ts findPath: breadth-first over road tiles from (sx, sy), testing `is_goal` on every tile reached. */
pub fn find_path(w: &World, s: &mut Scratch, sx: i32, sy: i32, is_goal: &mut impl FnMut(i32, i32) -> bool, max_nodes: u32, expanded: &mut u32) -> Option<PathResult> {
    *expanded = 0;
    for &(dx, dy) in DIRS.iter() {
        if is_goal(sx + dx, sy + dy) { return Some(PathResult { path: vec![sx, sy, sx + dx, sy + dy], gx: sx + dx, gy: sy + dy }); }
    }
    s.map.reset(max_nodes as usize * 4 + 8);
    s.nodes.clear();
    let (start_tile, start_aux) = w.peek(sx, sy);
    s.nodes.push(BfsNode { x: sx, y: sy, parent: NONE, a: start_aux });
    s.map.get_or_insert(tkey(sx, sy), 0);
    let mut head = 0usize;
    if matches!(start_tile, Some(t) if is_road(t)) {
        // the root is the queue's first node
    } else {
        head = 1; // the root is not searched from: its road neighbours are
        for &(dx, dy) in DIRS.iter() {
            let (nx, ny) = (sx + dx, sy + dy);
            let (t, a) = w.peek(nx, ny);
            if matches!(t, Some(t) if is_road(t)) && !sideways(a, dx) {
                s.map.get_or_insert(tkey(nx, ny) + route_layer(a, dx) * LAYER, 0);
                s.nodes.push(BfsNode { x: nx, y: ny, parent: 0, a });
            }
        }
    }
    while head < s.nodes.len() && *expanded < max_nodes {
        let ni = head;
        head += 1;
        *expanded += 1;
        let (x, y, a_here) = (s.nodes[ni].x, s.nodes[ni].y, s.nodes[ni].a);
        let (pdx, pdy) = match s.nodes[ni].parent { NONE => (0, 0), p => (x - s.nodes[p as usize].x, y - s.nodes[p as usize].y) };
        for &(dx, dy) in DIRS.iter() {
            let (nx, ny) = (x + dx, y + dy);
            let (t, a) = w.peek(nx, ny);
            let key = tkey(nx, ny) + route_layer(a, dx) * LAYER;
            if s.map.get(key).is_some() { continue; }
            if a_here >= STEP_RULE_AUX && !w.junction_step_ok(x, y, nx, ny, pdx, pdy) { continue; }
            if sideways(a, dx) { continue; }
            if is_goal(nx, ny) {
                let mut path = vec![nx, ny];
                let mut p = ni as u32;
                while p != NONE { let n = &s.nodes[p as usize]; path.push(n.x); path.push(n.y); p = n.parent; }
                // pairs come out goal first: put them start first, each still x, y
                let n = path.len() / 2;
                let mut out = Vec::with_capacity(path.len());
                for i in (0..n).rev() { out.push(path[i * 2]); out.push(path[i * 2 + 1]); }
                return Some(PathResult { path: out, gx: nx, gy: ny });
            }
            if !matches!(t, Some(t) if is_road(t)) { continue; }
            s.map.get_or_insert(key, 0);
            s.nodes.push(BfsNode { x: nx, y: ny, parent: ni as u32, a });
        }
    }
    None
}

/** pathfinding.ts pathBetween */
pub fn path_between(w: &World, s: &mut Scratch, ax: i32, ay: i32, bx: i32, by: i32, expanded: &mut u32) -> Option<Vec<i32>> {
    *expanded = 0;
    if ax == bx && ay == by { return Some(vec![ax, ay]); }
    if (bx - ax).abs() + (by - ay).abs() > 1 && !w.has_road_access(bx, by) { return None; }
    find_path(w, s, ax, ay, &mut |x, y| x == bx && y == by, 2500, expanded).map(|r| r.path)
}

/** pathfinding.ts findRoute: A* over road tiles priced by `cost`, with a turn cost, from `start_dir` when known. */
#[allow(clippy::too_many_arguments)]
pub fn find_route(w: &World, s: &mut Scratch, sx: i32, sy: i32, gx: i32, gy: i32, cost: &impl Fn(i32, i32) -> f64, turn_cost: f64, max_nodes: u32, start_dir: i32, expanded: &mut u32) -> Option<(Vec<i32>, f64)> {
    *expanded = 0;
    if sx == gx && sy == gy { return Some((vec![sx, sy], 0.0)); }
    for &(dx, dy) in DIRS.iter() { if sx + dx == gx && sy + dy == gy { return Some((vec![sx, sy, gx, gy], 1.0)); } }
    if !w.has_road_access(gx, gy) { return None; }
    let goal_road = matches!(w.peek_tile(gx, gy), Some(t) if is_road(t));
    s.map.reset(max_nodes as usize * 4 + 8);
    s.g.clear(); s.parent.clear(); s.dir_in.clear(); s.closed.clear(); s.key.clear();
    s.heap_k.clear(); s.heap_f.clear();
    const NOP: u64 = u64::MAX;
    // node slots: g, parent key, dirIn, closed; a slot exists for every key g has been set for
    macro_rules! slot { ($k:expr) => {{
        let k = $k;
        let n = s.g.len() as u32;
        let (i, new) = s.map.get_or_insert(k, n);
        if new { s.g.push(f64::NAN); s.parent.push(NOP); s.dir_in.push(-1); s.closed.push(false); s.key.push(k); }
        i as usize
    }} }
    let push = |hk: &mut Vec<u64>, hf: &mut Vec<f64>, k: u64, f: f64| {
        hk.push(k); hf.push(f);
        let mut i = hk.len() - 1;
        while i > 0 { let p = (i - 1) >> 1; if hf[p] <= hf[i] { break; } hk.swap(p, i); hf.swap(p, i); i = p; }
    };
    let pop = |hk: &mut Vec<u64>, hf: &mut Vec<f64>| -> u64 {
        let k = hk[0];
        let lk = hk.pop().unwrap(); let lf = hf.pop().unwrap();
        if !hk.is_empty() {
            hk[0] = lk; hf[0] = lf;
            let mut i = 0;
            loop {
                let l = i * 2 + 1; let r = l + 1; let mut m = i;
                if l < hk.len() && hf[l] < hf[m] { m = l; }
                if r < hk.len() && hf[r] < hf[m] { m = r; }
                if m == i { break; }
                hk.swap(m, i); hf.swap(m, i); i = m;
            }
        }
        k
    };
    let h = |x: i32, y: i32| ((x - gx).abs() + (y - gy).abs()) as f64;
    let (start_tile, start_aux) = w.peek(sx, sy);
    let start = tkey(sx, sy) + if start_dir >= 0 { route_layer(start_aux, DIRS[start_dir as usize].0) * LAYER } else { 0 };
    let si = slot!(start);
    s.g[si] = 0.0; s.dir_in[si] = start_dir as i8;
    if matches!(start_tile, Some(t) if is_road(t)) { push(&mut s.heap_k, &mut s.heap_f, start, h(sx, sy)); }
    else {
        for d in 0..4 {
            let (nx, ny) = (sx + DIRS[d].0, sy + DIRS[d].1);
            let (t, a) = w.peek(nx, ny);
            if !matches!(t, Some(t) if is_road(t)) || sideways(a, DIRS[d].0) { continue; }
            let k = tkey(nx, ny) + route_layer(a, DIRS[d].0) * LAYER;
            let c = cost(nx, ny);
            let i = slot!(k);
            s.g[i] = c; s.parent[i] = start; s.dir_in[i] = d as i8;
            push(&mut s.heap_k, &mut s.heap_f, k, c + h(nx, ny));
        }
    }
    while !s.heap_k.is_empty() && *expanded < max_nodes {
        let k = pop(&mut s.heap_k, &mut s.heap_f);
        let ki = s.map.get(k).unwrap() as usize; // every key in the heap had its g set
        if s.closed[ki] { continue; }
        s.closed[ki] = true;
        *expanded += 1;
        let (x, y) = untkey(k);
        let gk = s.g[ki];
        let din = s.dir_in[ki] as i32;
        let here = w.peek(x, y).1;
        for d in 0..4 {
            let (nx, ny) = (x + DIRS[d].0, y + DIRS[d].1);
            if here >= STEP_RULE_AUX && !w.junction_step_ok(x, y, nx, ny, if din >= 0 { DIRS[din as usize].0 } else { 0 }, if din >= 0 { DIRS[din as usize].1 } else { 0 }) { continue; }
            let (t, a) = w.peek(nx, ny);
            let nk = tkey(nx, ny) + route_layer(a, DIRS[d].0) * LAYER;
            if nx == gx && ny == gy {
                let mut path = vec![nx, ny];
                let mut cur = k;
                loop {
                    let (px, py) = untkey(cur); path.push(px); path.push(py);
                    let ci = match s.map.get(cur) { Some(i) => i as usize, None => break };
                    cur = s.parent[ci];
                    if cur == NOP { break; }
                }
                let n = path.len() / 2;
                let mut out = Vec::with_capacity(path.len());
                for i in (0..n).rev() { out.push(path[i * 2]); out.push(path[i * 2 + 1]); }
                return Some((out, gk + if goal_road { cost(gx, gy) } else { 1.0 }));
            }
            if let Some(ni) = s.map.get(nk) { if s.closed[ni as usize] { continue; } }
            if !matches!(t, Some(t) if is_road(t)) || sideways(a, DIRS[d].0) { continue; }
            let ng = gk + cost(nx, ny) + if din >= 0 && din != d as i32 && k != start { turn_cost } else { 0.0 };
            if let Some(ni) = s.map.get(nk) { let old = s.g[ni as usize]; if !old.is_nan() && old <= ng { continue; } }
            let i = slot!(nk);
            s.g[i] = ng; s.parent[i] = k; s.dir_in[i] = d as i8;
            push(&mut s.heap_k, &mut s.heap_f, nk, ng + h(nx, ny));
        }
    }
    None
}

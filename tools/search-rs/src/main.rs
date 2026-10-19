//! search-rs: replay a Civitas search corpus (server/src/loadtest/search-corpus.ts, docs/search-perf.md) with Rust
//! ports of the route, walk, job and venue searches, check every answer against the game's, and time them on one
//! thread and on a rayon pool. A spike: not wired into the game.
//!
//!   cargo run --release -- CORPUS_DIR [--threads 1,2,4,8] [--repeat 3] [--min-par N] [--grain N] [--json FILE]
//!
//! The replay is the one search-replay.ts does: ticks in order; per tick the base events, the overlay, the tick's
//! searches as batches split at tile writes, then the overlay folded into the base.

mod search;
mod world;

use rayon::prelude::*;
use search::*;
use std::cell::RefCell;
use std::time::Instant;
use world::*;

const CHUNK_BYTES: usize = 8 + CELLS * 3;
const SEARCH_BYTES: usize = 112;
const KINDS: [&str; 4] = ["route", "walk", "job", "venue"];

fn u32_at(b: &[u8], o: usize) -> u32 { u32::from_le_bytes(b[o..o + 4].try_into().unwrap()) }
fn i32_at(b: &[u8], o: usize) -> i32 { i32::from_le_bytes(b[o..o + 4].try_into().unwrap()) }
fn f64_at(b: &[u8], o: usize) -> f64 { f64::from_le_bytes(b[o..o + 8].try_into().unwrap()) }

struct Search {
    seq: u32, tick: u32, sx: i32, sy: i32, gx: i32, gy: i32, turn_cost: f64, cost: f64, max_nodes: u32, expanded: u32,
    path_off: u32, path_len: u32, a1: u32, a2: u32, box_: [i32; 4], ov: [i32; 4], kind: u8, start_dir: i8, edu: u8, flags: u8,
}

struct Corpus {
    searches: Vec<Search>, paths: Vec<i32>, full: Vec<u32>, tiles_ev: Vec<(u32, i32, i32, u16, u8)>,
    cost_base: Vec<(u32, u64, f64)>, cost_over: Vec<(u32, u64, f64)>, job_base: Vec<(u32, u64, u8, i32)>, job_over: Vec<(u32, u64, u8, i32)>,
    avoid: f64,
}

fn load(dir: &str) -> (World, Corpus) {
    let rd = |n: &str| std::fs::read(format!("{dir}/{n}")).unwrap_or_else(|e| panic!("{dir}/{n}: {e}"));
    let manifest = String::from_utf8(rd("manifest.json")).unwrap();
    let num = |key: &str| -> f64 {
        let i = manifest.find(&format!("\"{key}\":")).unwrap_or_else(|| panic!("manifest has no {key}")) + key.len() + 3;
        manifest[i..].trim_start().split(|c: char| c == ',' || c == '\n' || c == '}').next().unwrap().trim().parse().unwrap()
    };
    assert!(manifest.contains("\"civitas-search-corpus\"") && num("version") == 1.0, "not a version 1 search corpus");
    let cb = rd("chunks.bin");
    let n = cb.len() / CHUNK_BYTES;
    let coords: Vec<(i32, i32)> = (0..n).map(|i| (i32_at(&cb, i * CHUNK_BYTES), i32_at(&cb, i * CHUNK_BYTES + 4))).collect();
    let (cx0, cy0) = (coords.iter().map(|c| c.0).min().unwrap(), coords.iter().map(|c| c.1).min().unwrap());
    let (cx1, cy1) = (coords.iter().map(|c| c.0).max().unwrap(), coords.iter().map(|c| c.1).max().unwrap());
    let (gw, gh) = (cx1 - cx0 + 1, cy1 - cy0 + 1);
    let mut w = World { cx0, cy0, gw, gh, grid: vec![-1; (gw * gh) as usize], tiles: vec![0; n * CELLS], aux: vec![0; n * CELLS] };
    for (i, &(cx, cy)) in coords.iter().enumerate() {
        w.grid[((cy - cy0) * gw + (cx - cx0)) as usize] = i as i32;
        let o = i * CHUNK_BYTES + 8;
        for j in 0..CELLS { w.tiles[i * CELLS + j] = u16::from_le_bytes([cb[o + j * 2], cb[o + j * 2 + 1]]); }
        w.aux[i * CELLS..(i + 1) * CELLS].copy_from_slice(&cb[o + CELLS * 2..o + CELLS * 3]);
    }
    let sb = rd("searches.bin");
    let searches = (0..sb.len() / SEARCH_BYTES).map(|i| {
        let o = i * SEARCH_BYTES;
        Search {
            seq: u32_at(&sb, o), tick: u32_at(&sb, o + 4), sx: i32_at(&sb, o + 8), sy: i32_at(&sb, o + 12), gx: i32_at(&sb, o + 16), gy: i32_at(&sb, o + 20),
            turn_cost: f64_at(&sb, o + 24), cost: f64_at(&sb, o + 32), max_nodes: u32_at(&sb, o + 40), expanded: u32_at(&sb, o + 44),
            path_off: u32_at(&sb, o + 48), path_len: u32_at(&sb, o + 52), a1: u32_at(&sb, o + 56), a2: u32_at(&sb, o + 60),
            box_: [i32_at(&sb, o + 64), i32_at(&sb, o + 68), i32_at(&sb, o + 72), i32_at(&sb, o + 76)],
            ov: [i32_at(&sb, o + 80), i32_at(&sb, o + 84), i32_at(&sb, o + 88), i32_at(&sb, o + 92)],
            kind: sb[o + 96], start_dir: sb[o + 97] as i8, edu: sb[o + 98], flags: sb[o + 99],
        }
    }).collect::<Vec<_>>();
    for (i, s) in searches.iter().enumerate() { assert_eq!(s.seq as usize, i, "searches.bin is not in seq order"); }
    let ints = |b: Vec<u8>| b.chunks_exact(4).map(|c| i32::from_le_bytes(c.try_into().unwrap())).collect::<Vec<i32>>();
    let te = rd("tiles.bin");
    let tiles_ev = te.chunks_exact(16).map(|r| (u32_at(r, 0), i32_at(r, 4), i32_at(r, 8), u16::from_le_bytes([r[12], r[13]]), r[14])).collect();
    let cost = |b: Vec<u8>| b.chunks_exact(16).map(|r| (u32_at(r, 0), u32_at(r, 4) as u64, f64_at(r, 8))).collect::<Vec<_>>();
    let job = |b: Vec<u8>| b.chunks_exact(16).map(|r| { let cls = r[9] as i32; (u32_at(r, 0), u32_at(r, 4) as u64, r[8], if cls != 0 { u32_at(r, 12) as i32 * 4 + cls } else { 0 }) }).collect::<Vec<_>>();
    let c = Corpus {
        searches, paths: ints(rd("paths.bin")), full: ints(rd("full.bin")).into_iter().map(|v| v as u32).collect(), tiles_ev,
        cost_base: cost(rd("costBase.bin")), cost_over: cost(rd("costOver.bin")), job_base: job(rd("jobBase.bin")), job_over: job(rd("jobOver.bin")),
        avoid: num("avoid"),
    };
    (w, c)
}

/** The two fields (search-corpus.ts THE FIELDS): a base value per cell and this tick's overlay. */
struct Fields {
    cost_base: Vec<f64>, cost_idx: Vec<i32>, cost_cnt: Vec<i32>, cost_ov_seq: Vec<u32>, cost_ov_val: Vec<f64>,
    job_base: Vec<i32>, job_idx: Vec<i32>, job_cnt: Vec<i32>, job_ov_seq: Vec<u32>, job_ov_val: Vec<i32>,
}

impl Fields {
    #[inline]
    fn cost_at(&self, w: &World, x: i32, y: i32, seq: u32) -> f64 {
        let Some(c) = w.cell(x, y) else { return f64::NAN };
        let mut v = self.cost_base[c];
        let st = self.cost_idx[c];
        if st != 0 { let j0 = (st - 1) as usize; for j in j0..j0 + self.cost_cnt[c] as usize { if self.cost_ov_seq[j] > seq { break; } v = self.cost_ov_val[j]; } }
        v
    }
    #[inline]
    fn job_at(&self, w: &World, x: i32, y: i32, edu: u8, seq: u32) -> i32 {
        let Some(t) = w.cell(x, y) else { return 0 };
        let c = t * 8 + edu as usize;
        let mut v = self.job_base[c];
        let st = self.job_idx[c];
        if st != 0 { let j0 = (st - 1) as usize; for j in j0..j0 + self.job_cnt[c] as usize { if self.job_ov_seq[j] > seq { break; } v = self.job_ov_val[j]; } }
        v
    }
}

/** Replay one search: 0 when it gives the game's answer, else the mismatch bits of search-replay.ts. */
fn run(w: &World, f: &Fields, c: &Corpus, s: &mut Scratch, q: &Search) -> u8 {
    let mut bad = 0u8;
    let mut exp = 0u32;
    let found = q.flags & 1 == 1;
    let path: Option<Vec<i32>> = match q.kind {
        0 => {
            let nov = (q.flags >> 1) & 3;
            let seq = q.seq;
            let r = if nov == 0 {
                find_route(w, s, q.sx, q.sy, q.gx, q.gy, &|x, y| f.cost_at(w, x, y, seq), q.turn_cost, q.max_nodes, q.start_dir as i32, &mut exp)
            } else {
                let (ov, avoid) = (q.ov, c.avoid);
                find_route(w, s, q.sx, q.sy, q.gx, q.gy, &|x, y| if (x == ov[0] && y == ov[1]) || (nov > 1 && x == ov[2] && y == ov[3]) { avoid } else { f.cost_at(w, x, y, seq) },
                    q.turn_cost, q.max_nodes, q.start_dir as i32, &mut exp)
            };
            if let Some((_, cost)) = &r { if cost.to_bits() != q.cost.to_bits() { bad |= 4; } }
            r.map(|r| r.0)
        }
        1 => path_between(w, s, q.sx, q.sy, q.gx, q.gy, &mut exp),
        2 => {
            let (mut x0, mut y0, mut x1, mut y1) = (q.sx, q.sy, q.sx, q.sy);
            let mut full: Vec<u32> = vec![];
            let r = find_path(w, s, q.sx, q.sy, &mut |x, y| {
                if x < x0 { x0 = x } else if x > x1 { x1 = x }
                if y < y0 { y0 = y } else if y > y1 { y1 = y }
                let v = f.job_at(w, x, y, q.edu, q.seq);
                match v & 3 { 2 => true, 1 => { let b = (v >> 2) as u32; if !full.contains(&b) { full.push(b); } false } _ => false }
            }, q.max_nodes, &mut exp);
            match &r {
                Some(r) => if r.gx != q.gx || r.gy != q.gy || (f.job_at(w, r.gx, r.gy, q.edu, q.seq) >> 2) as u32 != q.a1 { bad |= 16; },
                None => {
                    if [x0 - 2, y0 - 2, x1 + 2, y1 + 2] != q.box_ { bad |= 16; }
                    if full[..] != c.full[q.a1 as usize..(q.a1 + q.a2) as usize] { bad |= 16; }
                }
            }
            r.map(|r| r.path)
        }
        _ => {
            let mut tests = 0u32;
            let yes = q.a1;
            let r = find_path(w, s, q.sx, q.sy, &mut |_, _| { tests += 1; tests == yes }, q.max_nodes, &mut exp);
            if let Some(r) = &r { if r.gx != q.gx || r.gy != q.gy { bad |= 16; } }
            r.map(|r| r.path)
        }
    };
    if path.is_some() != found { return bad | 1; }
    if let Some(p) = &path { if p[..] != c.paths[q.path_off as usize..(q.path_off + q.path_len) as usize] { bad |= 2; } }
    if exp != q.expanded { bad |= 8; }
    bad
}

thread_local! { static SCRATCH: RefCell<Scratch> = RefCell::new(Scratch::new()); }

struct PassTime { search_ms: f64, book_ms: f64, batches: usize }

type Batch<'a> = dyn FnMut(&World, &Fields, usize, usize, &mut [u8]) + 'a;

/** One pass over the corpus, as search-replay.ts `pass`; `batch` replays searches [s0, s1) into its slice of results. */
fn pass(w: &mut World, pristine: &(Vec<u16>, Vec<u8>), f: &mut Fields, c: &Corpus, results: &mut [u8], batch: &mut Batch) -> PassTime {
    w.tiles.copy_from_slice(&pristine.0);
    w.aux.copy_from_slice(&pristine.1);
    f.cost_base.fill(f64::NAN); f.job_base.fill(0); f.cost_idx.fill(0); f.job_idx.fill(0);
    let n = c.searches.len();
    let (mut cb, mut co, mut jb, mut jo, mut te) = (0usize, 0usize, 0usize, 0usize, 0usize);
    let (mut search_ms, mut book_ms, mut batches) = (0.0, 0.0, 0usize);
    let mut touched_cost: Vec<usize> = vec![];
    let mut touched_job: Vec<usize> = vec![];
    let cell = |w: &World, k: u64| { let (x, y) = untkey(k); w.cell(x, y).expect("an event off the map") };
    let mut s = 0usize;
    while s < n {
        let mut t = Instant::now();
        let tick = c.searches[s].tick;
        let mut e = s;
        while e < n && c.searches[e].tick == tick { e += 1; }
        while cb < c.cost_base.len() && c.cost_base[cb].0 == tick { let (_, k, v) = c.cost_base[cb]; f.cost_base[cell(w, k)] = v; cb += 1; }
        while jb < c.job_base.len() && c.job_base[jb].0 == tick { let (_, k, edu, v) = c.job_base[jb]; f.job_base[cell(w, k) * 8 + edu as usize] = v; jb += 1; }
        let last = (e - 1) as u32;
        let co0 = co;
        while co < c.cost_over.len() && c.cost_over[co].0 <= last { co += 1; }
        let jo0 = jo;
        while jo < c.job_over.len() && c.job_over[jo].0 <= last { jo += 1; }
        let mut cells: Vec<(usize, usize)> = (co0..co).map(|j| (cell(w, c.cost_over[j].1), j)).collect();
        cells.sort();
        for (nn, &(cl, j)) in cells.iter().enumerate() {
            let p = co0 + nn;
            f.cost_ov_seq[p] = c.cost_over[j].0;
            f.cost_ov_val[p] = c.cost_over[j].2;
            if f.cost_idx[cl] == 0 { f.cost_idx[cl] = p as i32 + 1; f.cost_cnt[cl] = 0; touched_cost.push(cl); }
            f.cost_cnt[cl] += 1;
        }
        let mut cells: Vec<(usize, usize)> = (jo0..jo).map(|j| (cell(w, c.job_over[j].1) * 8 + c.job_over[j].2 as usize, j)).collect();
        cells.sort();
        for (nn, &(cl, j)) in cells.iter().enumerate() {
            let p = jo0 + nn;
            f.job_ov_seq[p] = c.job_over[j].0;
            f.job_ov_val[p] = c.job_over[j].3;
            if f.job_idx[cl] == 0 { f.job_idx[cl] = p as i32 + 1; f.job_cnt[cl] = 0; touched_job.push(cl); }
            f.job_cnt[cl] += 1;
        }
        book_ms += t.elapsed().as_secs_f64() * 1e3;
        let mut b = s;
        while b < e {
            t = Instant::now();
            while te < c.tiles_ev.len() && c.tiles_ev[te].0 as usize <= b {
                let (_, x, y, tile, aux) = c.tiles_ev[te];
                let ci = w.cell(x, y).expect("a tile write off the map");
                w.tiles[ci] = tile;
                w.aux[ci] = aux;
                te += 1;
            }
            let mut be = e;
            if te < c.tiles_ev.len() && (c.tiles_ev[te].0 as usize) < be { be = c.tiles_ev[te].0 as usize; }
            book_ms += t.elapsed().as_secs_f64() * 1e3;
            t = Instant::now();
            batch(w, f, b, be, &mut results[b..be]);
            search_ms += t.elapsed().as_secs_f64() * 1e3;
            batches += 1;
            b = be;
        }
        t = Instant::now();
        for &cl in &touched_cost { f.cost_base[cl] = f.cost_ov_val[(f.cost_idx[cl] - 1 + f.cost_cnt[cl] - 1) as usize]; f.cost_idx[cl] = 0; }
        for &cl in &touched_job { f.job_base[cl] = f.job_ov_val[(f.job_idx[cl] - 1 + f.job_cnt[cl] - 1) as usize]; f.job_idx[cl] = 0; }
        touched_cost.clear();
        touched_job.clear();
        book_ms += t.elapsed().as_secs_f64() * 1e3;
        s = e;
    }
    PassTime { search_ms, book_ms, batches }
}

fn report(label: &str, c: &Corpus, results: &[u8]) -> String {
    let mut all = [0usize; 4];
    let mut bad = [0usize; 4];
    let mut codes = std::collections::BTreeMap::new();
    for (q, &r) in c.searches.iter().zip(results) {
        all[q.kind as usize] += 1;
        if r != 0 { bad[q.kind as usize] += 1; *codes.entry(r).or_insert(0) += 1; }
    }
    let s = (0..4).map(|k| format!("{} {}/{}", KINDS[k], all[k] - bad[k], all[k])).collect::<Vec<_>>().join(", ");
    println!("  {label} matches: {s}{}", if codes.is_empty() { String::new() } else { format!("; mismatch codes {codes:?}") });
    format!("{{{}}}", (0..4).map(|k| format!("\"{}\": [{}, {}]", KINDS[k], all[k] - bad[k], all[k])).collect::<Vec<_>>().join(", "))
}

fn median(mut v: Vec<f64>) -> f64 { v.sort_by(|a, b| a.partial_cmp(b).unwrap()); v[v.len() / 2] }
fn runs_json(label: &str, times: &[PassTime], m: &str) -> String {
    format!("\"{label}\": {{\"searchMs\": {:.2}, \"bookMs\": {:.2}, \"all\": [{}], \"match\": {m}}}",
        median(times.iter().map(|t| t.search_ms).collect()), median(times.iter().map(|t| t.book_ms).collect()),
        times.iter().map(|t| format!("{:.2}", t.search_ms)).collect::<Vec<_>>().join(", "))
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let arg = |n: &str| args.iter().position(|a| a == &format!("--{n}")).map(|i| args[i + 1].clone());
    let dir = args.iter().find(|a| !a.starts_with("--") && !a.chars().all(|c| c.is_ascii_digit() || c == ','))
        .expect("usage: search-rs CORPUS_DIR [--threads 1,2,4,8] [--repeat 3] [--json FILE]").clone();
    let threads: Vec<usize> = arg("threads").unwrap_or("1,2,4,8".into()).split(',').map(|s| s.parse().unwrap()).collect();
    let repeat: usize = arg("repeat").unwrap_or("3".into()).parse().unwrap();
    // batches smaller than this run on the calling thread; the pool hands out up to `grain` searches at a time
    let min_par: usize = arg("min-par").unwrap_or("1".into()).parse().unwrap();
    let grain: usize = arg("grain").unwrap_or("1".into()).parse().unwrap();
    let t0 = Instant::now();
    let (mut w, c) = load(&dir);
    let n = c.searches.len();
    println!("{dir}: {n} searches, {} chunks, loaded in {:.1} s; {} {}", w.tiles.len() / CELLS, t0.elapsed().as_secs_f64(), std::env::consts::ARCH, std::env::consts::OS);
    let pristine = (w.tiles.clone(), w.aux.clone());
    let cells = w.tiles.len();
    let mut f = Fields {
        cost_base: vec![f64::NAN; cells], cost_idx: vec![0; cells], cost_cnt: vec![0; cells], cost_ov_seq: vec![0; c.cost_over.len()], cost_ov_val: vec![0.0; c.cost_over.len()],
        job_base: vec![0; cells * 8], job_idx: vec![0; cells * 8], job_cnt: vec![0; cells * 8], job_ov_seq: vec![0; c.job_over.len()], job_ov_val: vec![0; c.job_over.len()],
    };
    let mut results = vec![0u8; n];
    let mut json: Vec<String> = vec![];

    // ---- one thread, no pool ----
    let mut times = vec![];
    for r in 0..repeat {
        results.fill(0);
        let mut scratch = Scratch::new();
        let p = pass(&mut w, &pristine, &mut f, &c, &mut results, &mut |w, f, s0, s1, out| {
            for i in s0..s1 { out[i - s0] = run(w, f, &c, &mut scratch, &c.searches[i]); }
        });
        println!("one thread, run {}: searches {:.0} ms, bookkeeping {:.0} ms, {} batches", r + 1, p.search_ms, p.book_ms, p.batches);
        times.push(p);
    }
    let m = report("one thread", &c, &results);
    json.push(runs_json("1T", &times, &m));
    // by kind, each timed alone
    let mut by_kind = vec![];
    for k in 0..4u8 {
        let mut scratch = Scratch::new();
        let mut ms = 0.0;
        pass(&mut w, &pristine, &mut f, &c, &mut results, &mut |w, f, s0, s1, out| {
            let t = Instant::now();
            for i in s0..s1 { if c.searches[i].kind == k { out[i - s0] = run(w, f, &c, &mut scratch, &c.searches[i]); } }
            ms += t.elapsed().as_secs_f64() * 1e3;
        });
        by_kind.push(format!("\"{}\": {:.1}", KINDS[k as usize], ms));
    }
    println!("  by kind (ms): {}", by_kind.join(", "));
    json.push(format!("\"1T-byKind\": {{{}}}", by_kind.join(", ")));
    // the critical path: each batch's slowest search, summed (what any number of threads still has to wait for)
    let (mut crit, mut sum) = (0.0, 0.0);
    {
        let mut scratch = Scratch::new();
        pass(&mut w, &pristine, &mut f, &c, &mut results, &mut |w, f, s0, s1, out| {
            let mut worst: f64 = 0.0;
            for i in s0..s1 {
                let t = Instant::now();
                out[i - s0] = run(w, f, &c, &mut scratch, &c.searches[i]);
                let ms = t.elapsed().as_secs_f64() * 1e3;
                worst = worst.max(ms);
                sum += ms;
            }
            crit += worst;
        });
    }
    println!("  critical path {crit:.0} ms of {sum:.0} ms (each batch's slowest search)");
    json.push(format!("\"critical\": {{\"ms\": {crit:.2}, \"sumMs\": {sum:.2}}}"));

    // ---- rayon pools: each batch's searches spread over the pool one by one ----
    for &nt in &threads {
        let pool = rayon::ThreadPoolBuilder::new().num_threads(nt).build().unwrap();
        let mut times = vec![];
        for r in 0..repeat {
            results.fill(0);
            let p = pass(&mut w, &pristine, &mut f, &c, &mut results, &mut |w, f, s0, _s1, out| {
                let cr = &c;
                if out.len() < min_par { // too few to be worth waking the pool
                    SCRATCH.with(|s| for (j, o) in out.iter_mut().enumerate() { *o = run(w, f, cr, &mut s.borrow_mut(), &cr.searches[s0 + j]); });
                    return;
                }
                pool.install(|| out.par_iter_mut().enumerate().with_max_len(grain).for_each(|(j, o)| {
                    SCRATCH.with(|s| *o = run(w, f, cr, &mut s.borrow_mut(), &cr.searches[s0 + j]));
                }));
            });
            println!("rayon {nt} thread(s), run {}: searches {:.0} ms, bookkeeping {:.0} ms", r + 1, p.search_ms, p.book_ms);
            times.push(p);
        }
        let m = report(&format!("rayon {nt}"), &c, &results);
        json.push(runs_json(&format!("R{nt}"), &times, &m));
    }
    if let Some(file) = arg("json") {
        std::fs::write(&file, format!("{{\"dir\": \"{dir}\", \"arch\": \"{}\", \"searches\": {n}, {}}}\n", std::env::consts::ARCH, json.join(", "))).unwrap();
        println!("summary: {file}");
    }
}

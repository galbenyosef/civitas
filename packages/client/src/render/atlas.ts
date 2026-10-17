import { CanvasTexture, SRGBColorSpace, LinearMipmapLinearFilter, LinearFilter, RepeatWrapping } from 'three';
import { mulberry32 } from '@msimcity/shared';

/**
 * Procedural ground atlas: 8×8 cells of 128px. Terrain, pavement, zone-lot
 * marker, dirt, 16 road tiles (one per N/E/S/W connection mask) with
 * curbs, dashed centre lines and crosswalks at junctions, the airfield strip (shared/src/airport.ts), and 16 railway
 * track tiles (Cell.Rail + the track's connection mask, shared/src/rail.ts): ballast, sleepers and two rails.
 *
 * Airfield cells are drawn in the strip's own frame: canvas x runs along the runway (x = 0 is the outer end on
 * the *End cells), canvas y runs across it, away from the runway centre on shoulders and towards the terminal on
 * taxiway rows. chunkView turns and mirrors the UVs per tile.
 */
export const CELL = 128, COLS = 8, ROWS = 8;
export const Cell = {
  Grass: 0, Water: 1, Sand: 2, Pavement: 3, Lot: 4, Dirt: 5, Road: 8,
  Rwy: 32, RwyTdz: 33, RwyEnd: 34, Shoulder: 35, ShoulderEndFar: 36, ShoulderEndNear: 37,
  TaxiInner: 38, TaxiInnerEnd: 39, TaxiCentre: 40, TaxiCentreEnd: 41, TaxiOuter: 42,
  /** railway track: Rail + mask (N 1, E 2, S 4, W 8), cells 48-63 */
  Rail: 48,
  /**
   * roundabouts (shared/src/junctions.ts), drawn for the east side of the ring (the island to the west, an arm or
   * none to the east) and the north-east corner (the island's corner at the cell's bottom left); chunkView turns them
   */
  RingArm: 24, RingSide: 25, RingCorner: 26, Island: 27,
  /** a level crossing (shared/src/rail.ts): the east-west road with the track north-south over it; chunkView turns it */
  Crossing: 28,
} as const;
/** Roundabout geometry in tiles out from the island tile's edge (render/junctions.ts draws the island to RING_ISLAND). */
export const RING_ISLAND = 0.3, RING_APRON = 0.44, RING_OUTER = 0.92;
const N = 1, E = 2, S = 4, W = 8;

export function buildAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = CELL * COLS; canvas.height = CELL * ROWS;
  const ctx = canvas.getContext('2d')!;
  const rand = mulberry32(1234);

  const at = (i: number, draw: (g: CanvasRenderingContext2D) => void) => {
    ctx.save();
    ctx.translate((i % COLS) * CELL, Math.floor(i / COLS) * CELL);
    ctx.beginPath(); ctx.rect(0, 0, CELL, CELL); ctx.clip();
    draw(ctx);
    ctx.restore();
  };
  const speckle = (g: CanvasRenderingContext2D, colors: string[], n: number, r = 2) => {
    for (let i = 0; i < n; i++) {
      g.fillStyle = colors[Math.floor(rand() * colors.length)];
      const s = r * (0.6 + rand());
      g.fillRect(rand() * CELL, rand() * CELL, s, s);
    }
  };

  at(Cell.Grass, (g) => { g.fillStyle = '#5f9a4b'; g.fillRect(0, 0, CELL, CELL); speckle(g, ['#558f43', '#6aa655', '#4f8a3e', '#73ad5c'], 260, 3); });
  at(Cell.Water, (g) => {
    g.fillStyle = '#2e74c9'; g.fillRect(0, 0, CELL, CELL);
    g.strokeStyle = 'rgba(190,220,255,0.35)'; g.lineWidth = 2;
    for (let i = 0; i < 7; i++) { const y = 10 + i * 17 + rand() * 6; g.beginPath(); for (let x = -10; x <= CELL + 10; x += 8) g.lineTo(x, y + Math.sin((x / CELL) * Math.PI * 2 + i) * 3); g.stroke(); }
  });
  at(Cell.Sand, (g) => { g.fillStyle = '#d8c58f'; g.fillRect(0, 0, CELL, CELL); speckle(g, ['#cdb97f', '#e2d19c', '#c9b276'], 200, 2); });
  at(Cell.Pavement, (g) => {
    g.fillStyle = '#aeb2b8'; g.fillRect(0, 0, CELL, CELL);
    g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, CELL); g.moveTo(0, i * 32); g.lineTo(CELL, i * 32); g.stroke(); }
  });
  at(Cell.Lot, (g) => {
    // neutral base; the vertex colour tints it toward the zone colour, the dashed outline reads as "zoned"
    g.fillStyle = '#8fb07a'; g.fillRect(0, 0, CELL, CELL); speckle(g, ['#86a872', '#98b983'], 120, 3);
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 5; g.setLineDash([12, 8]); g.strokeRect(12, 12, CELL - 24, CELL - 24); g.setLineDash([]);
  });
  at(Cell.Dirt, (g) => { g.fillStyle = '#8a6b45'; g.fillRect(0, 0, CELL, CELL); speckle(g, ['#7d5f3c', '#9a7a52', '#6f5434'], 220, 3); });

  for (let mask = 0; mask < 16; mask++) at(Cell.Road + mask, (g) => {
    g.fillStyle = '#3d3f45'; g.fillRect(0, 0, CELL, CELL);
    speckle(g, ['#404248', '#393b41'], 80, 3);
    const open = (b: number) => (mask & b) !== 0;
    const arms = [N, E, S, W].filter(open).length;
    // sidewalks along closed edges
    const sw = 16;
    g.fillStyle = '#a3a7ae';
    if (!open(N)) g.fillRect(0, 0, CELL, sw);
    if (!open(S)) g.fillRect(0, CELL - sw, CELL, sw);
    if (!open(W)) g.fillRect(0, 0, sw, CELL);
    if (!open(E)) g.fillRect(CELL - sw, 0, sw, CELL);
    // where an arm is open, continue the sidewalk strips of the perpendicular closed edges... already handled by the strips above
    // curb line
    g.strokeStyle = '#7f838a'; g.lineWidth = 2;
    if (!open(N)) { g.beginPath(); g.moveTo(0, sw); g.lineTo(CELL, sw); g.stroke(); }
    if (!open(S)) { g.beginPath(); g.moveTo(0, CELL - sw); g.lineTo(CELL, CELL - sw); g.stroke(); }
    if (!open(W)) { g.beginPath(); g.moveTo(sw, 0); g.lineTo(sw, CELL); g.stroke(); }
    if (!open(E)) { g.beginPath(); g.moveTo(CELL - sw, 0); g.lineTo(CELL - sw, CELL); g.stroke(); }
    // dashed centre line on straights, crosswalks on junctions
    g.strokeStyle = '#e3c75a'; g.lineWidth = 4; g.setLineDash([18, 14]);
    if (mask === (N | S)) { g.beginPath(); g.moveTo(CELL / 2, 0); g.lineTo(CELL / 2, CELL); g.stroke(); }
    if (mask === (E | W)) { g.beginPath(); g.moveTo(0, CELL / 2); g.lineTo(CELL, CELL / 2); g.stroke(); }
    g.setLineDash([]);
    if (arms >= 3) {
      g.fillStyle = 'rgba(255,255,255,0.85)';
      const bars = (horizontal: boolean, pos: number) => {
        for (let i = 0; i < 6; i++) {
          const a = sw + 6 + i * 16;
          if (horizontal) g.fillRect(a, pos, 9, 12); else g.fillRect(pos, a, 12, 9);
        }
      };
      if (open(N)) bars(true, 4);
      if (open(S)) bars(true, CELL - 16);
      if (open(W)) bars(false, 4);
      if (open(E)) bars(false, CELL - 16);
    }
  });

  // ---- airfield strip
  const RWY = '#2b2e33', TAXI = '#3d4045', VERGE = '#5f9a4b', PAINT = '#f2f2ee', YEL = '#e8c53a';
  const asphalt = (g: CanvasRenderingContext2D, c: string, x: number, y: number, w: number, h: number) => {
    g.fillStyle = c; g.fillRect(x, y, w, h);
  };
  const grass = (g: CanvasRenderingContext2D) => { g.fillStyle = VERGE; g.fillRect(0, 0, CELL, CELL); speckle(g, ['#558f43', '#6aa655', '#4f8a3e'], 160, 3); };
  const runwayBase = (g: CanvasRenderingContext2D) => { asphalt(g, RWY, 0, 0, CELL, CELL); speckle(g, ['#303338', '#272a2e', '#34373c'], 90, 3); };
  /** shoulder: runway asphalt to the edge stripe (0.3 tile out), a lighter paved shoulder, then grass */
  const shoulder = (g: CanvasRenderingContext2D) => {
    grass(g);
    asphalt(g, RWY, 0, 0, CELL, 38);
    asphalt(g, '#55585d', 0, 38, CELL, 30);
    g.fillStyle = PAINT; g.fillRect(0, 31, CELL, 6);
  };
  const pianoKeys = (g: CanvasRenderingContext2D, y0: number, y1: number) => {
    g.fillStyle = PAINT;
    for (let y = y0; y + 8 <= y1; y += 16) g.fillRect(22, y, 76, 8);
  };
  const endBar = (g: CanvasRenderingContext2D, y0: number, y1: number) => { g.fillStyle = PAINT; g.fillRect(4, y0, 9, y1 - y0); };
  /** where planes cross between runway and taxiway on an end tile: x 64-128 paved, the lead line at x = 100 */
  const connector = (g: CanvasRenderingContext2D, y0: number) => {
    asphalt(g, TAXI, 64, y0, CELL - 64, CELL - y0);
    g.fillStyle = YEL; g.fillRect(98, y0, 4, CELL - y0);
  };
  at(Cell.Rwy, (g) => { runwayBase(g); g.fillStyle = PAINT; g.fillRect(16, 61, 64, 6); });
  at(Cell.RwyTdz, (g) => {
    runwayBase(g); g.fillStyle = PAINT; g.fillRect(16, 61, 64, 6);
    for (const y of [10, 22, 100, 112]) g.fillRect(24, y, 80, 7);
  });
  at(Cell.RwyEnd, (g) => { runwayBase(g); pianoKeys(g, 4, 124); endBar(g, 0, CELL); });
  at(Cell.Shoulder, (g) => shoulder(g));
  at(Cell.ShoulderEndFar, (g) => { shoulder(g); pianoKeys(g, 4, 30); endBar(g, 0, 38); });
  at(Cell.ShoulderEndNear, (g) => { shoulder(g); connector(g, 37); pianoKeys(g, 4, 30); endBar(g, 0, 38); });
  at(Cell.TaxiInner, (g) => grass(g));
  at(Cell.TaxiInnerEnd, (g) => { grass(g); connector(g, 0); });
  const taxiCentre = (g: CanvasRenderingContext2D) => {
    grass(g); asphalt(g, TAXI, 0, 38, CELL, CELL - 38); speckle(g, ['#41444a', '#393c41'], 40, 3);
    g.fillStyle = YEL; g.fillRect(0, 40, CELL, 2);
  };
  at(Cell.TaxiCentre, (g) => { taxiCentre(g); g.fillStyle = YEL; g.fillRect(0, 113, CELL, 4); });
  at(Cell.TaxiCentreEnd, (g) => {
    grass(g); asphalt(g, TAXI, 64, 0, CELL - 64, CELL);
    g.strokeStyle = YEL; g.lineWidth = 4;
    g.beginPath(); g.moveTo(CELL, 115); g.lineTo(118, 115); g.quadraticCurveTo(100, 115, 100, 97); g.lineTo(100, 0); g.stroke();
  });
  at(Cell.TaxiOuter, (g) => {
    asphalt(g, TAXI, 0, 0, CELL, CELL); speckle(g, ['#41444a', '#393c41'], 60, 3);
    g.fillStyle = 'rgba(255,255,255,0.7)'; for (let x = 4; x < CELL; x += 24) g.fillRect(x, 122, 12, 3);
  });

  // ---- railway track: one cell per connection mask, in world orientation (canvas top = north, -z)
  // Each pair of sides the track joins is a piece: a straight across the tile or a quarter curve of radius 1/2 round
  // the corner the two sides share. Two sides: that piece; three: the straight plus both curves into the branch (a
  // turnout each way); four: the two straights (a diamond crossing); one: a stub to a buffer stop; none: a short
  // length on its own. The pieces are what trains can run along (shared/src/rail.ts legSearch).
  const MIDS: [number, number][] = [[64, 0], [128, 64], [64, 128], [0, 64]];
  const CORNER = (a: number, b: number): [number, number] => [MIDS[a][0] === 64 ? MIDS[b][0] : MIDS[a][0], MIDS[a][1] === 64 ? MIDS[b][1] : MIDS[a][1]];
  type Piece = { kind: 'line'; x0: number; y0: number; x1: number; y1: number } | { kind: 'arc'; cx: number; cy: number; a0: number; a1: number };
  const piecesFor = (mask: number): Piece[] => {
    const sides = [0, 1, 2, 3].filter((s) => mask & (1 << s));
    const line = (a: number, b: number): Piece => ({ kind: 'line', x0: MIDS[a][0], y0: MIDS[a][1], x1: MIDS[b][0], y1: MIDS[b][1] });
    const arc = (a: number, b: number): Piece => {
      const [cx, cy] = CORNER(a, b);
      return { kind: 'arc', cx, cy, a0: Math.atan2(MIDS[a][1] - cy, MIDS[a][0] - cx), a1: Math.atan2(MIDS[b][1] - cy, MIDS[b][0] - cx) };
    };
    const pair = (a: number, b: number) => ((a + 2) & 3) === b ? line(a, b) : arc(a, b);
    if (sides.length === 0) return [{ kind: 'line', x0: 26, y0: 64, x1: 102, y1: 64 }];
    if (sides.length === 1) { const s = sides[0]; return [{ kind: 'line', x0: MIDS[s][0], y0: MIDS[s][1], x1: 64, y1: 64 }]; }
    if (sides.length === 2) return [pair(sides[0], sides[1])];
    if (sides.length === 4) return [line(0, 2), line(1, 3)];
    const branch = [0, 1, 2, 3].find((s) => !(mask & (1 << ((s + 2) & 3))) && (mask & (1 << s)))!; // the side whose opposite is open
    const others = sides.filter((s) => s !== branch);
    return [line(others[0], others[1]), arc(branch, others[0]), arc(branch, others[1])];
  };
  /** visit points along a piece every `step` px with the unit direction of travel */
  const along = (p: Piece, step: number, f: (x: number, y: number, dx: number, dy: number) => void) => {
    if (p.kind === 'line') {
      const L = Math.hypot(p.x1 - p.x0, p.y1 - p.y0), dx = (p.x1 - p.x0) / L, dy = (p.y1 - p.y0) / L;
      for (let d = step / 2; d < L; d += step) f(p.x0 + dx * d, p.y0 + dy * d, dx, dy);
      return;
    }
    let da = p.a1 - p.a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    const L = Math.abs(da) * 64;
    for (let d = step / 2; d < L; d += step) {
      const a = p.a0 + (da * d) / L, sg = Math.sign(da);
      f(p.cx + 64 * Math.cos(a), p.cy + 64 * Math.sin(a), -Math.sin(a) * sg, Math.cos(a) * sg);
    }
  };
  const stroke = (g: CanvasRenderingContext2D, p: Piece, offset: number, width: number, color: string) => {
    g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'butt';
    g.beginPath();
    if (p.kind === 'line') {
      const L = Math.hypot(p.x1 - p.x0, p.y1 - p.y0), nx = -(p.y1 - p.y0) / L, ny = (p.x1 - p.x0) / L;
      g.moveTo(p.x0 + nx * offset, p.y0 + ny * offset); g.lineTo(p.x1 + nx * offset, p.y1 + ny * offset);
    } else {
      let da = p.a1 - p.a0;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      g.arc(p.cx, p.cy, 64 + offset, p.a0, p.a0 + da, da < 0);
    }
    g.stroke();
  };
  const GAUGE = 11; // half the distance between the rails, px (0.086 tile)
  for (let mask = 0; mask < 16; mask++) at(Cell.Rail + mask, (g) => {
    grass(g);
    const ps = piecesFor(mask);
    // ballast bed: a grey shoulder, then the stone itself, speckled
    for (const p of ps) stroke(g, p, 0, 50, '#7d776c');
    for (const p of ps) stroke(g, p, 0, 40, '#958f84');
    for (const p of ps) along(p, 5, (x, y) => { for (let k = 0; k < 3; k++) { g.fillStyle = ['#a8a296', '#7f7a70', '#8b857a'][(rand() * 3) | 0]; g.fillRect(x + (rand() - 0.5) * 36, y + (rand() - 0.5) * 36, 2.5, 2.5); } });
    // sleepers across the track every 1/6 tile
    g.fillStyle = '#5b4632';
    for (const p of ps) along(p, 128 / 6, (x, y, dx, dy) => {
      g.save(); g.translate(x, y); g.rotate(Math.atan2(dy, dx)); g.fillRect(-3.5, -20, 7, 40); g.restore();
    });
    // the rails: a dark web under a bright head
    for (const p of ps) for (const o of [-GAUGE, GAUGE]) stroke(g, p, o, 5, '#3b3a38');
    for (const p of ps) for (const o of [-GAUGE, GAUGE]) stroke(g, p, o, 2.4, '#d9dcdf');
    const n = [0, 1, 2, 3].filter((s) => mask & (1 << s)).length;
    if (n === 1) { // a buffer stop at the end of a stub: red and white beam across the rails
      const s = [0, 1, 2, 3].find((q) => mask & (1 << q))!;
      g.save(); g.translate(64, 64); g.rotate(s * Math.PI / 2);
      g.fillStyle = '#c23b2b'; g.fillRect(-20, -5, 40, 10); g.fillStyle = '#f2f2ee'; g.fillRect(-6, -5, 12, 10);
      g.restore();
    }
  });

  // ---- level crossing: the road east-west, the track north-south laid in panels flush with the road
  at(Cell.Crossing, (g) => {
    const sw = 16, P = 30; // sidewalk width, half the panel band
    g.fillStyle = '#3d3f45'; g.fillRect(0, 0, CELL, CELL);
    speckle(g, ['#404248', '#393b41'], 80, 3);
    g.fillStyle = '#a3a7ae'; g.fillRect(0, 0, CELL, sw); g.fillRect(0, CELL - sw, CELL, sw);
    g.strokeStyle = '#7f838a'; g.lineWidth = 2;
    for (const y of [sw, CELL - sw]) { g.beginPath(); g.moveTo(0, y); g.lineTo(64 - P, y); g.moveTo(64 + P, y); g.lineTo(CELL, y); g.stroke(); }
    // the panels: concrete slabs across the road and the footways, joints every quarter
    g.fillStyle = '#8d8a83'; g.fillRect(64 - P, 0, 2 * P, CELL);
    g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 1.5;
    for (let y = 0; y <= CELL; y += 32) { g.beginPath(); g.moveTo(64 - P, y); g.lineTo(64 + P, y); g.stroke(); }
    g.beginPath(); g.moveTo(64 - P, 0); g.lineTo(64 - P, CELL); g.moveTo(64 + P, 0); g.lineTo(64 + P, CELL); g.stroke();
    // the rails in their flangeways
    for (const o of [-GAUGE, GAUGE]) { g.fillStyle = '#2b2a28'; g.fillRect(64 + o - 3.5, 0, 7, CELL); g.fillStyle = '#d9dcdf'; g.fillRect(64 + o - 1.2, 0, 2.4, CELL); }
    // centre line up to the panels, and a stop line across each approach lane at the tile's edge (traffic drives on the right)
    g.strokeStyle = '#e3c75a'; g.lineWidth = 4; g.setLineDash([12, 10]);
    g.beginPath(); g.moveTo(0, 64); g.lineTo(64 - P - 6, 64); g.moveTo(64 + P + 6, 64); g.lineTo(CELL, 64); g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fillRect(3, 64 + 2, 6, CELL - sw - 66); // eastbound, in the south half
    g.fillRect(CELL - 9, sw, 6, 64 - sw - 2); // westbound, in the north half
    // yellow box hatching on the approaches between stop line and panels: keep clear
    g.strokeStyle = 'rgba(232,197,58,0.55)'; g.lineWidth = 2.5;
    g.save(); g.beginPath(); g.rect(12, sw + 2, 64 - P - 18, CELL - 2 * sw - 4); g.rect(64 + P + 6, sw + 2, 64 - P - 18, CELL - 2 * sw - 4); g.clip();
    for (let k = -CELL; k < CELL; k += 14) { g.beginPath(); g.moveTo(k, sw); g.lineTo(k + CELL - 2 * sw, CELL - sw); g.stroke(); }
    g.restore();
  });

  // ---- roundabouts: the ring band runs RING_APRON..RING_OUTER out from the island, cars at 0.69 (LANE_OFFSET + 1/2)
  {
    const I = RING_ISLAND * CELL, A = RING_APRON * CELL, O = RING_OUTER * CELL, SW = 16;
    const ASPHALT = '#3d3f45', VERGE = '#a3a7ae', KERB = '#7f838a', APRON = '#8a8379', PAINT = 'rgba(255,255,255,0.86)';
    const tarmac = (g: CanvasRenderingContext2D) => { g.fillStyle = ASPHALT; g.fillRect(0, 0, CELL, CELL); speckle(g, ['#404248', '#393b41'], 80, 3); };
    /** setts on the overrun apron round the island: a grid of small stones, a little uneven */
    const setts = (g: CanvasRenderingContext2D) => {
      g.fillStyle = 'rgba(0,0,0,0.13)';
      for (let y = 0; y < CELL; y += 6) for (let x = (y / 6) % 2 ? 3 : 0; x < CELL; x += 6) g.fillRect(x + rand(), y + rand(), 1.2, 5);
    };
    // a side of the ring: island to the west, the band straight up the cell
    const side = (g: CanvasRenderingContext2D, arm: boolean) => {
      tarmac(g);
      g.fillStyle = APRON; g.fillRect(0, 0, A, CELL);
      g.save(); g.beginPath(); g.rect(0, 0, A, CELL); g.clip(); setts(g); g.restore();
      g.fillStyle = VERGE; g.fillRect(O, 0, CELL - O, CELL);
      g.strokeStyle = KERB; g.lineWidth = 2;
      if (arm) {
        // the arm's carriageway opens into the ring, kerbs rounded into it
        const r = 10;
        g.fillStyle = ASPHALT; g.fillRect(O, SW, CELL - O, CELL - 2 * SW);
        g.fillRect(O, SW - r, r, r); g.fillRect(O, CELL - SW, r, r);
        g.fillStyle = VERGE;
        g.beginPath(); g.arc(O + r, SW - r, r, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.arc(O + r, CELL - SW + r, r, 0, Math.PI * 2); g.fill();
        g.fillRect(O + r, 0, CELL - O - r, SW - r); g.fillRect(O + r, CELL - SW + r, CELL - O - r, SW - r);
        g.fillRect(O + r, SW - r, CELL - O - r, r); g.fillRect(O + r, CELL - SW, CELL - O - r, r);
        g.beginPath(); g.moveTo(O, 0); g.lineTo(O, SW - r); g.arc(O + r, SW - r, r, Math.PI, Math.PI / 2, true); g.lineTo(CELL, SW); g.stroke();
        g.beginPath(); g.moveTo(O, CELL); g.lineTo(O, CELL - SW + r); g.arc(O + r, CELL - SW + r, r, Math.PI, Math.PI * 1.5, false); g.lineTo(CELL, CELL - SW); g.stroke();
        // give way: a double dashed line across the way in (the north half: traffic drives on the right)
        g.fillStyle = PAINT;
        for (const x of [O + 2, O + 6]) for (let y = SW + 2; y < CELL / 2 - 3; y += 9) g.fillRect(x, y, 2.5, 5);
        // a painted splitter between the way in and the way out, hatched
        g.strokeStyle = PAINT; g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(CELL, CELL / 2 - 9); g.lineTo(O + 4, CELL / 2); g.lineTo(CELL, CELL / 2 + 9); g.stroke();
        g.save(); g.beginPath(); g.moveTo(CELL, CELL / 2 - 9); g.lineTo(O + 4, CELL / 2); g.lineTo(CELL, CELL / 2 + 9); g.closePath(); g.clip();
        for (let k = -20; k < 20; k += 4) { g.beginPath(); g.moveTo(O, CELL / 2 + k); g.lineTo(CELL, CELL / 2 + k + 10); g.stroke(); }
        g.restore();
      } else {
        g.beginPath(); g.moveTo(O, 0); g.lineTo(O, CELL); g.stroke();
      }
      g.strokeStyle = KERB; g.lineWidth = 2; g.beginPath(); g.moveTo(A, 0); g.lineTo(A, CELL); g.stroke();
      g.strokeStyle = PAINT; g.lineWidth = 2; g.beginPath(); g.moveTo(A + 4, 0); g.lineTo(A + 4, CELL); g.stroke();
    };
    at(Cell.RingArm, (g) => side(g, true));
    at(Cell.RingSide, (g) => side(g, false));
    // the north-east corner: everything is an arc round the island's corner at the cell's bottom left
    at(Cell.RingCorner, (g) => {
      g.fillStyle = VERGE; g.fillRect(0, 0, CELL, CELL);
      const disc = (r: number, c: string) => { g.fillStyle = c; g.beginPath(); g.moveTo(0, CELL); g.arc(0, CELL, r, -Math.PI / 2, 0); g.closePath(); g.fill(); };
      disc(O, ASPHALT);
      g.save(); g.beginPath(); g.moveTo(0, CELL); g.arc(0, CELL, O, -Math.PI / 2, 0); g.closePath(); g.clip(); speckle(g, ['#404248', '#393b41'], 60, 3); g.restore();
      disc(A, APRON);
      g.save(); g.beginPath(); g.moveTo(0, CELL); g.arc(0, CELL, A, -Math.PI / 2, 0); g.closePath(); g.clip(); setts(g); g.restore();
      g.strokeStyle = KERB; g.lineWidth = 2;
      for (const r of [A, O]) { g.beginPath(); g.arc(0, CELL, r, -Math.PI / 2, 0); g.stroke(); }
      g.strokeStyle = PAINT; g.beginPath(); g.arc(0, CELL, A + 4, -Math.PI / 2, 0); g.stroke();
      // an arrow round the ring, anticlockwise: in from the bottom edge, out by the left
      const R = 0.69 * CELL, a0 = 0.5, a1 = 1.02;
      g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 3;
      g.beginPath(); g.arc(0, CELL, R, -a0, -a1, true); g.stroke();
      const hx = R * Math.cos(a1), hy = CELL - R * Math.sin(a1), tx = -Math.sin(a1), ty = -Math.cos(a1);
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.beginPath(); g.moveTo(hx + tx * 9, hy + ty * 9); g.lineTo(hx - ty * 6, hy + tx * 6); g.lineTo(hx + ty * 6, hy - tx * 6); g.closePath(); g.fill();
    });
    at(Cell.Island, (g) => { g.fillStyle = APRON; g.fillRect(0, 0, CELL, CELL); setts(g); g.fillStyle = '#5f9a4b'; g.fillRect(I / 2, I / 2, CELL - I, CELL - I); });
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.generateMipmaps = true;
  return texture;
}

/** UV rectangle [u0, v0, u1, v1] of a cell, inset to avoid bleeding. */
export function cellUV(i: number): [number, number, number, number] {
  const cx = i % COLS, cy = Math.floor(i / COLS);
  const inset = 3 / (CELL * COLS), insetV = 3 / (CELL * ROWS);
  const u0 = cx / COLS + inset, u1 = (cx + 1) / COLS - inset;
  const v1 = 1 - cy / ROWS - insetV, v0 = 1 - (cy + 1) / ROWS + insetV;
  return [u0, v0, u1, v1];
}

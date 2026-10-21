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
export const CELL = 128, COLS = 8, ROWS = 14;
export const Cell = {
  Grass: 0, Water: 1, Sand: 2, Pavement: 3, Lot: 4, Dirt: 5, Road: 8,
  /** the road geometry's surfaces (render/roadGeo.ts): plain asphalt, flat white for paint and stone (tinted by vertex colour), tactile paving, setts */
  Asphalt: 6, Paint: 7, Tactile: 29, Setts: 30,
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
  /** pedestrian streets' paving near the camera (render/roadGeo.ts), light neutral to be tinted: brick basketweave, flagstones */
  Brick: 31, Flags: 43,
  /**
   * road classes from far off (shared/src/roadclass.ts): a country lane per connection mask (LaneRoad + mask); a one-way
   * street, an avenue's and a motorway's carriageway drawn flowing north (the twin to the west), chunkView turns them;
   * a pedestrian street's straight (north-south) and its other tiles
   */
  LaneRoad: 64, OneWay: 80, OneWayArrow: 81, Avenue: 82, Motorway: 83, PedStraight: 84, Ped: 85,
  /** a class road's crossroads (where avenues cross, or a street crosses one): pavement corners only where the diagonal is not road (NE 1, SE 2, SW 4, NW 8 set: road) */
  Cross: 96,
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

  // ---- roads. Near the camera roads are geometry (render/roads.ts); these cells are what a road looks like from far
  // off, drawn to the same plan so the change of detail does not jump: pavements 0.125 wide along closed sides, a
  // rounded pavement corner where two arms meet, an outer corner rounded about the tile centre, white centre dashes.
  const ASPHALT = '#3d3f45', PAVE = '#a3a7ae', KERBLINE = '#b9bcc1';
  const asphaltBase = (g: CanvasRenderingContext2D) => { g.fillStyle = ASPHALT; g.fillRect(0, 0, CELL, CELL); speckle(g, ['#404248', '#393b41'], 80, 3); };
  at(Cell.Asphalt, asphaltBase);
  at(Cell.Paint, (g) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, CELL, CELL); });
  at(Cell.Tactile, (g) => {
    g.fillStyle = '#f0f0ec'; g.fillRect(0, 0, CELL, CELL);
    g.fillStyle = 'rgba(0,0,0,0.16)';
    for (let y = 4; y < CELL; y += 8) for (let x = 4; x < CELL; x += 8) { g.beginPath(); g.arc(x, y, 2.2, 0, Math.PI * 2); g.fill(); }
  });
  at(Cell.Setts, (g) => {
    g.fillStyle = '#8a8379'; g.fillRect(0, 0, CELL, CELL);
    g.fillStyle = 'rgba(0,0,0,0.13)';
    for (let y = 0; y < CELL; y += 6) for (let x = (y / 6) % 2 ? 3 : 0; x < CELL; x += 6) g.fillRect(x + rand(), y + rand(), 1.2, 5);
  });
  const SW = 16, C = CELL / 2 - SW; // pavement width; half the carriageway (from the centre)
  for (let mask = 0; mask < 16; mask++) at(Cell.Road + mask, (g) => {
    asphaltBase(g);
    const open = (b: number) => (mask & b) !== 0;
    // each quarter as render/roadGeo.ts quarterShape: corners (x, y) of the cell, signs out from the centre
    g.fillStyle = PAVE; g.strokeStyle = KERBLINE; g.lineWidth = 2.5;
    for (const [sx, sy, hb, vb] of [[1, -1, E, N], [1, 1, E, S], [-1, 1, W, S], [-1, -1, W, N]]) {
      const h = open(hb), v = open(vb), X = (a: number) => CELL / 2 + sx * a, Y = (b: number) => CELL / 2 + sy * b;
      const half = CELL / 2;
      g.beginPath();
      if (h && v) { g.moveTo(X(half), Y(half)); g.arc(X(half), Y(half), SW, 0, Math.PI * 2); g.fill(); continue; }
      if (v) { g.fillRect(Math.min(X(C), X(half)), Math.min(Y(0), Y(half)), SW, half); continue; }
      if (h) { g.fillRect(Math.min(X(0), X(half)), Math.min(Y(C), Y(half)), half, SW); continue; }
      // outer corner: everything in the quarter beyond a circle of radius C about the centre
      g.save(); g.beginPath(); g.rect(Math.min(X(0), X(half)), Math.min(Y(0), Y(half)), half, half); g.clip();
      g.beginPath(); g.rect(0, 0, CELL, CELL); g.arc(CELL / 2, CELL / 2, C, 0, Math.PI * 2, true); g.fill('evenodd');
      g.restore();
    }
    // the kerb's edge, as a light line where pavement meets carriageway
    g.save(); g.beginPath(); g.rect(0, 0, CELL, CELL); g.clip();
    for (const [sx, sy, hb, vb] of [[1, -1, E, N], [1, 1, E, S], [-1, 1, W, S], [-1, -1, W, N]]) {
      const h = open(hb), v = open(vb), X = (a: number) => CELL / 2 + sx * a, Y = (b: number) => CELL / 2 + sy * b, half = CELL / 2;
      g.beginPath();
      if (h && v) g.arc(X(half), Y(half), SW, 0, Math.PI * 2);
      else if (v) { g.moveTo(X(C), Y(0)); g.lineTo(X(C), Y(half)); }
      else if (h) { g.moveTo(X(0), Y(C)); g.lineTo(X(half), Y(C)); }
      else { const mid = Math.atan2(sy, sx); g.arc(CELL / 2, CELL / 2, C, mid - Math.PI / 4, mid + Math.PI / 4); }
      g.stroke();
    }
    g.restore();
    // white centre dashes on straights and round bends
    g.fillStyle = 'rgba(242,242,238,0.95)';
    if (mask === (N | S)) for (const y of [32, 96]) g.fillRect(CELL / 2 - 1.5, y - 11, 3, 22);
    else if (mask === (E | W)) for (const x of [32, 96]) g.fillRect(x - 11, CELL / 2 - 1.5, 22, 3);
    else if ([N | E, E | S, S | W, W | N].includes(mask)) {
      const kx = mask & E ? CELL : 0, ky = mask & S ? CELL : 0;
      g.strokeStyle = 'rgba(242,242,238,0.95)'; g.lineWidth = 3; g.setLineDash([18, 22]); g.lineDashOffset = -8;
      g.beginPath(); g.arc(kx, ky, CELL / 2, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
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

  drawClassCells(at);

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

/**
 * The road classes' cells (R3), drawn last with their own random stream so every earlier cell is as it was. Far off a
 * class reads by its cross-section, to the plan the geometry near the camera uses (render/roadGeo.ts CLASS_PROFILES):
 * a lane's asphalt between verges, a one-way's lane line and arrows, an avenue's planted strip on its twin's side, a
 * motorway's shoulder line, barrier and verges, a pedestrian street's paving.
 */
function drawClassCells(at: (i: number, draw: (g: CanvasRenderingContext2D) => void) => void) {
  const rand = mulberry32(4321);
  const speckle = (g: CanvasRenderingContext2D, colors: string[], n: number, r = 2) => {
    for (let i = 0; i < n; i++) { g.fillStyle = colors[Math.floor(rand() * colors.length)]; const s = r * (0.6 + rand()); g.fillRect(rand() * CELL, rand() * CELL, s, s); }
  };
  const grass = (g: CanvasRenderingContext2D) => { g.fillStyle = '#5f9a4b'; g.fillRect(0, 0, CELL, CELL); speckle(g, ['#558f43', '#6aa655', '#4f8a3e', '#73ad5c'], 260, 3); };
  const tarmac = (g: CanvasRenderingContext2D, c = '#3d3f45') => { g.fillStyle = c; g.fillRect(0, 0, CELL, CELL); speckle(g, ['#404248', '#393b41', '#45464a'], 80, 3); };
  const PAVE = '#a3a7ae', KERBLINE = '#b9bcc1', PAINT = 'rgba(242,242,238,0.95)';

  // ---- near-camera paving, light and neutral (vertex colours tint it per precinct)
  at(Cell.Brick, (g) => {
    g.fillStyle = '#c4beb6'; g.fillRect(0, 0, CELL, CELL);
    // basketweave: 16 px blocks of two bricks, alternately lengthwise and across, each brick its own tone
    for (let by = 0; by < CELL; by += 16) for (let bx = 0; bx < CELL; bx += 16) {
      const across = ((bx + by) / 16) % 2 === 1;
      for (let k = 0; k < 2; k++) {
        const v = Math.floor(170 + rand() * 50);
        g.fillStyle = `rgb(${v},${v - 6},${v - 12})`;
        if (across) g.fillRect(bx + k * 8 + 1, by + 1, 6, 14); else g.fillRect(bx + 1, by + k * 8 + 1, 14, 6);
      }
    }
  });
  at(Cell.Flags, (g) => {
    g.fillStyle = '#9a968f'; g.fillRect(0, 0, CELL, CELL);
    // flagstones in courses of random length, offset row by row
    for (let y = 0; y < CELL; y += 22) {
      let x = -Math.floor(rand() * 30);
      while (x < CELL) {
        const w = 22 + Math.floor(rand() * 26), v = Math.floor(190 + rand() * 40);
        g.fillStyle = `rgb(${v},${v - 3},${v - 9})`; g.fillRect(x + 1, y + 1, w - 2, 20);
        x += w;
      }
    }
  });

  // ---- the country lane: verge right up to a narrower, warmer asphalt, no kerbs or lines (quarters as the road cells)
  const LC = Math.round(0.28 * CELL), LSW = CELL / 2 - LC;
  for (let mask = 0; mask < 16; mask++) at(Cell.LaneRoad + mask, (g) => {
    tarmac(g, '#45433f');
    speckle(g, ['#4c4944', '#3e3c38'], 60, 4);
    const open = (b: number) => (mask & b) !== 0, half = CELL / 2;
    // the verge: everything outside the carriageway, with grass of its own
    g.save(); g.beginPath();
    for (const [sx, sy, hb, vb] of [[1, -1, 2, 1], [1, 1, 2, 4], [-1, 1, 8, 4], [-1, -1, 8, 1]]) {
      const h = open(hb), v = open(vb), X = (a: number) => half + sx * a, Y = (b: number) => half + sy * b;
      if (h && v) { g.moveTo(X(half), Y(half)); g.arc(X(half), Y(half), LSW, 0, Math.PI * 2); continue; }
      if (v) { g.rect(Math.min(X(LC), X(half)), Math.min(Y(0), Y(half)), LSW, half); continue; }
      if (h) { g.rect(Math.min(X(0), X(half)), Math.min(Y(LC), Y(half)), half, LSW); continue; }
      // the outer corner: the quarter outside a circle of radius LC about the centre
      const x0 = Math.min(X(0), X(half)), y0 = Math.min(Y(0), Y(half));
      g.moveTo(x0, y0); g.rect(x0, y0, half, half);
    }
    g.clip('nonzero');
    grass(g);
    g.restore();
    // round the dead-end and bend corners back to asphalt where the quarter is open on neither side
    for (const [sx, sy, hb, vb] of [[1, -1, 2, 1], [1, 1, 2, 4], [-1, 1, 8, 4], [-1, -1, 8, 1]]) {
      if (open(hb) || open(vb)) continue;
      g.save(); g.beginPath(); g.rect(Math.min(half, half + sx * half), Math.min(half, half + sy * half), half, half); g.clip();
      g.fillStyle = '#45433f'; g.beginPath(); g.arc(half, half, LC, 0, Math.PI * 2); g.fill(); g.restore();
    }
    // ragged edges: grass creeping onto the asphalt here and there
    if (mask === 5 || mask === 10) {
      g.fillStyle = '#5a9447';
      for (let i = 0; i < 14; i++) {
        const a = rand() * CELL, e = rand() < 0.5 ? half - LC : half + LC, r = 1.5 + rand() * 3;
        g.beginPath(); g.arc(mask === 5 ? e : a, mask === 5 ? a : e, r, 0, Math.PI * 2); g.fill();
      }
    }
  });

  // ---- one-way, avenue and motorway carriageways, flowing north (up), the twin to the west (left)
  const lineDashes = (g: CanvasRenderingContext2D, x: number, len: number) => { g.fillStyle = PAINT; for (const y of [32, 96]) g.fillRect(x - 1, y - len / 2, 2, len); };
  const kerbSide = (g: CanvasRenderingContext2D, x0: number, x1: number, kx: number) => {
    g.fillStyle = PAVE; g.fillRect(x0, 0, x1 - x0, CELL);
    g.fillStyle = KERBLINE; g.fillRect(kx - 1, 0, 2.5, CELL);
  };
  const upArrow = (g: CanvasRenderingContext2D, x: number) => {
    g.fillStyle = PAINT; g.fillRect(x - 1.5, 52, 3, 28);
    g.beginPath(); g.moveTo(x, 40); g.lineTo(x - 6, 54); g.lineTo(x + 6, 54); g.closePath(); g.fill();
  };
  const SW = 16, LANE = Math.round(0.19 * CELL);
  const oneWay = (g: CanvasRenderingContext2D, arrow: boolean) => {
    tarmac(g); kerbSide(g, 0, SW, SW); kerbSide(g, CELL - SW, CELL, CELL - SW);
    lineDashes(g, CELL / 2, 26);
    if (arrow) for (const x of [CELL / 2 - LANE, CELL / 2 + LANE]) upArrow(g, x);
  };
  at(Cell.OneWay, (g) => oneWay(g, false));
  at(Cell.OneWayArrow, (g) => oneWay(g, true));
  at(Cell.Avenue, (g) => {
    tarmac(g);
    const M = Math.round(0.09 * CELL);
    g.fillStyle = '#5f9a4b'; g.fillRect(0, 0, M, CELL);
    g.save(); g.beginPath(); g.rect(0, 0, M, CELL); g.clip(); speckle(g, ['#558f43', '#4f8a3e'], 40, 3); g.restore();
    g.fillStyle = '#4f8a3e'; for (let y = 6; y < CELL; y += 32) { g.beginPath(); g.arc(1 + rand() * 3, y + rand() * 10, 5 + rand() * 3, 0, Math.PI * 2); g.fill(); } // tree crowns on the strip
    g.fillStyle = KERBLINE; g.fillRect(M - 1, 0, 2.5, CELL);
    kerbSide(g, CELL - SW, CELL, CELL - SW);
    lineDashes(g, CELL / 2, 26);
  });
  at(Cell.Motorway, (g) => {
    grass(g);
    const M = Math.round(0.06 * CELL), C = Math.round(0.4 * CELL);
    g.fillStyle = '#34363b'; g.fillRect(M, 0, CELL / 2 + C - M, CELL);
    speckle(g, ['#383a3f', '#303237'], 40, 3);
    g.fillStyle = '#9aa1a8'; g.fillRect(0, 0, 2, CELL); // the barrier on the shared edge
    g.fillStyle = PAINT; g.fillRect(M + 3, 0, 2, CELL); g.fillRect(CELL / 2 + Math.round(0.3 * CELL), 0, 3, CELL);
    lineDashes(g, CELL / 2, 36);
  });

  // ---- pedestrian streets: slabs to the building line, warm paving between the old kerb lines, a channel down the middle
  const pedBase = (g: CanvasRenderingContext2D) => {
    g.fillStyle = '#b9b2a6'; g.fillRect(0, 0, CELL, CELL);
    g.fillStyle = 'rgba(0,0,0,0.08)';
    for (let y = 0; y < CELL; y += 5) for (let x = (y / 5) % 2 ? 2 : 0; x < CELL; x += 5) g.fillRect(x + rand(), y + rand(), 1, 4);
  };
  at(Cell.PedStraight, (g) => {
    pedBase(g);
    g.fillStyle = '#c3c1bc'; g.fillRect(0, 0, SW, CELL); g.fillRect(CELL - SW, 0, SW, CELL);
    g.strokeStyle = 'rgba(0,0,0,0.1)'; g.lineWidth = 1;
    for (let y = 0; y <= CELL; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(SW, y); g.moveTo(CELL - SW, y); g.lineTo(CELL, y); g.stroke(); }
    g.fillStyle = '#8f8a82'; for (const x of [SW, CELL - SW - 3]) g.fillRect(x, 0, 3, CELL);
    g.fillStyle = '#9d968a'; g.fillRect(CELL / 2 - 3, 0, 6, CELL);
  });
  at(Cell.Ped, pedBase);

  // ---- crossroads of the class roads: asphalt, a rounded pavement corner where the diagonal tile is not road
  for (let dm = 0; dm < 16; dm++) at(Cell.Cross + dm, (g) => {
    tarmac(g);
    g.fillStyle = PAVE; g.strokeStyle = KERBLINE; g.lineWidth = 2.5;
    for (const [bit, cx, cy] of [[1, CELL, 0], [2, CELL, CELL], [4, 0, CELL], [8, 0, 0]]) {
      if (dm & bit) continue;
      g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, SW, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(cx, cy, SW, 0, Math.PI * 2); g.stroke();
    }
  });
}

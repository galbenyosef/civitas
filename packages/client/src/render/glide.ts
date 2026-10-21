/**
 * Drawing a driver between the server's positions, which come once a tick (5 a second): render/citizens.ts.
 * Pure, so the offline check (server/src/loadtest/render-smooth.ts) runs the same code.
 */
/**
 * A stretch is planned to take this many of the gaps between positions, so a position that comes a little late (the
 * server's timer, the network) finds the car still moving towards the last one rather than parked on it: it takes over
 * part way through, at the speed the car is drawn moving. Drawing runs that much further behind the server.
 */
export const STRETCH = 1.3;

export interface Glider {
  /** drawn position; the server position before the newest and the newest */
  x: number; y: number; px: number; py: number; tx: number; ty: number;
  /** where the current stretch starts, its start and end tangents (tiles over the stretch), the drawn velocity (tiles per ms) */
  gx: number; gy: number; m0x: number; m0y: number; m1x: number; m1y: number; vx: number; vy: number;
  /** when the stretch starts, ms: the frame the car was last drawn at, so the first frame after a position comes moves a whole frame */
  g0: number;
}

/**
 * Draw a driver between server positions (5 a second) without the jolt at each one. Each new position starts a stretch
 * from where the car is drawn now, leaving at the speed it is drawn moving, to the new position, arriving at the speed
 * of the server's last step (a cubic Hermite), so the drawn speed changes smoothly across ticks instead of jumping at
 * each. Both speeds are capped at twice the stretch, and dropped when they point back along it, so a car never
 * overshoots its position or rolls backwards; a car that stops arrives still. `u` is how far through the stretch
 * (0..1; past 1, while the next position is late, held at the end). Writes a.x, a.y and the drawn velocity.
 */
export function glide(a: Glider, u: number, ms: number) {
  const h = Math.min(1, Math.max(0, u)), h2 = h * h, h3 = h2 * h;
  const b0 = 2 * h3 - 3 * h2 + 1, b1 = h3 - 2 * h2 + h, b2 = -2 * h3 + 3 * h2, b3 = h3 - h2;
  a.x = b0 * a.gx + b1 * a.m0x + b2 * a.tx + b3 * a.m1x;
  a.y = b0 * a.gy + b1 * a.m0y + b2 * a.ty + b3 * a.m1y;
  // past the end (the next position is late) the car is held, but keeps its arriving speed for a moment, so it moves
  // off at that speed rather than from rest when the position comes; held longer, it has stopped
  if (u >= 1.5) { a.vx = 0; a.vy = 0; return; }
  const d0 = 6 * h2 - 6 * h, d1 = 3 * h2 - 4 * h + 1, d2 = 6 * h - 6 * h2, d3 = 3 * h2 - 2 * h;
  a.vx = (d0 * a.gx + d1 * a.m0x + d2 * a.tx + d3 * a.m1x) / ms;
  a.vy = (d0 * a.gy + d1 * a.m0y + d2 * a.ty + d3 * a.m1y) / ms;
}
/** glide: a new server position (a.tx, a.ty, the one before in a.px, a.py) starts a stretch of `ms` from the position and velocity the car was drawn with at `frameAt` */
export function glideFrom(a: Glider, ms: number, frameAt: number) {
  a.g0 = frameAt;
  const cx = a.tx - a.x, cy = a.ty - a.y, c = Math.hypot(cx, cy);
  a.gx = a.x; a.gy = a.y;
  if (c > 3) { a.gx = a.x = a.tx; a.gy = a.y = a.ty; a.m0x = a.m0y = a.m1x = a.m1y = 0; return; } // a jump (a new trip, a re-placement): no stretch
  const cap = (vx: number, vy: number, k: 0 | 1) => {
    const l = Math.hypot(vx, vy), along = vx * cx + vy * cy;
    const f = c < 1e-3 || along <= 0 ? 0 : Math.min(1, (2 * c) / l);
    if (k === 0) { a.m0x = vx * f; a.m0y = vy * f; } else { a.m1x = vx * f; a.m1y = vy * f; }
  };
  cap(a.vx * ms, a.vy * ms, 0);
  cap(a.tx - a.px, a.ty - a.py, 1);
}

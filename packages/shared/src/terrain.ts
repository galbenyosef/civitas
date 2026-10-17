import { SimplexNoise } from './noise';
import { Terrain } from './tile';

/**
 * Terrain is a pure function of (seed, x, y), so any chunk can be generated
 * on demand by the server, and the client could regenerate it too if needed.
 * A gentle bump around the origin guarantees the spawn area is dry land.
 */
export function makeTerrainSampler(seed: number) {
  const noise = new SimplexNoise(seed);
  return (x: number, y: number): number => {
    let h = noise.fbm(x * 0.018, y * 0.018, 4);
    h += 0.45 * Math.exp(-(x * x + y * y) / (60 * 60));
    if (h < -0.22) return Terrain.Water;
    if (h < -0.14) return Terrain.Sand;
    return Terrain.Grass;
  };
}

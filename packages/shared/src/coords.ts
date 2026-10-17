import { CHUNK_SIZE } from './constants';

export const floorDiv = (a: number, n: number) => Math.floor(a / n);
export const mod = (a: number, n: number) => ((a % n) + n) % n;
export const chunkKey = (cx: number, cy: number) => `${cx},${cy}`;
export const tileKey = (x: number, y: number) => `${x},${y}`;
export const chunkOf = (v: number) => Math.floor(v / CHUNK_SIZE);
/**
 * Index of a tile within its chunk: the same as mod(y, CHUNK_SIZE) * CHUNK_SIZE + mod(x, CHUNK_SIZE), written with floor
 * because `%` of a negative number by a non-literal divisor costs ~150 ns in Node 20's V8 (against ~5 ns this way),
 * and every tile read on the west or north half of the map went through it.
 */
export const localIndex = (x: number, y: number) =>
  (y - Math.floor(y / CHUNK_SIZE) * CHUNK_SIZE) * CHUNK_SIZE + (x - Math.floor(x / CHUNK_SIZE) * CHUNK_SIZE);
export const parseKey = (k: string): [number, number] => {
  const i = k.indexOf(',');
  return [Number(k.slice(0, i)), Number(k.slice(i + 1))];
};

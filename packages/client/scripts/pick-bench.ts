// Cost of the column pick on a dense city (pick.ts): run with npx tsx packages/client/scripts/pick-bench.ts
Object.assign(globalThis, { localStorage: { getItem: () => null, setItem() {} }, document: { getElementById: () => null } });
const { CameraRig } = await import('../src/camera');
const { ClientWorld } = await import('../src/world');
const { columnHeights } = await import('../src/pick');
const { buildModels, variant, allVariants } = await import('../src/render/models');
const { CHUNK_SIZE, chunkKey, packTile, hash2 } = await import('@msimcity/shared');
buildModels();
const world = new ClientWorld();
const N = CHUNK_SIZE * CHUNK_SIZE;
for (let cx = -2; cx < 3; cx++) for (let cy = -2; cy < 3; cy++) {
  const tiles = new Uint16Array(N);
  for (let i = 0; i < N; i++) {
    const x = cx * CHUNK_SIZE + (i % CHUNK_SIZE), y = cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
    tiles[i] = x % 4 === 0 || y % 4 === 0 ? packTile(0, true, 0, 0) : packTile(0, false, 1 + Math.floor(hash2(x, y) * 3), 1 + Math.floor(hash2(y, x) * 6)); // streets every 4, towers between
  }
  world.chunks.set(chunkKey(cx, cy), { cx, cy, tiles, parcel: new Int32Array(N), aux: new Uint8Array(N), sub: new Uint8Array(N), under: new Uint8Array(N), dirty: false, mask: 0 });
}
const col = { heightAt: columnHeights(world, variant), maxH: Math.max(0, ...allVariants().map((v) => v.height)) * 1.06 };
console.log('maxH', col.maxH.toFixed(2));
for (const [dist, pitch] of [[14, 0.95], [24, 0.6], [24, 0.3], [60, 0.95], [140, 0.5]] as const) {
  const rig = new CameraRig(1000 / 700);
  rig.target.set(3, 0, 3); rig.yaw = 0.7; rig.pitch = pitch; rig.dist = dist; rig.update(); rig.camera.updateMatrixWorld();
  for (const [what, c] of [['column', col], ['plane ', null]] as const) {
    for (let i = 0; i < 300; i++) rig.tileAt(100 + (i % 800), 100 + (i % 500), 1000, 700, c); // warm up
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) rig.tileAt(100 + ((i * 37) % 800), 80 + ((i * 53) % 560), 1000, 700, c);
    console.log(`dist ${dist} pitch ${pitch}  ${what} ${((performance.now() - t0) / 1000).toFixed(4)} ms per pick`);
  }
}

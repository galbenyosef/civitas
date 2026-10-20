import { readFileSync } from 'node:fs';
import { worldFromSnapshot, snapshotOf } from '../snapshot';
import { createGame } from '../game';
for (const f of process.argv.slice(2)) {
  const t0 = performance.now();
  const snap = JSON.parse(readFileSync(f, 'utf8'));
  const w = worldFromSnapshot(snap);
  if (!w) { console.log(f, 'UNREADABLE'); continue; }
  const g = createGame(w, { onConnection() {} }, { devTools: false, sandbox: false });
  for (let i = 0; i < 200; i++) g.step();
  const out = snapshotOf(w);
  console.log(`${f.split('/').pop()}: loaded v${snap.version}, ${w.citizens.size} citizens, ${w.buildings.size} buildings, adverts in save: ${'adverts' in snap}, campaigns ${g.adverts.campaignList().length}, rentals ${g.adverts.list().length}, re-save has adverts field: ${'adverts' in out}, ${(performance.now() - t0).toFixed(0)} ms`);
}

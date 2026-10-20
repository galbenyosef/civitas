import { readFileSync } from 'node:fs';
import { zoneOf, levelOf, kindIdOf, designKey, designPick, AD_SLOTS, underConstruction } from '@msimcity/shared';
import { worldFromSnapshot } from '../snapshot';
const w = worldFromSnapshot(JSON.parse(readFileSync(process.argv[2], 'utf8')))!;
for (const y of [-16, -14]) {
  const row: string[] = [];
  for (let x = -59; x <= -36; x++) {
    const t = w.getTile(x, y), k = kindIdOf(zoneOf(t), w.subAt(x, y)), l = levelOf(t);
    const key = l ? designKey(k, l, designPick(x, y)) : (underConstruction(t) ? 'site' : '-');
    row.push(`${x}:${k}/${l}${key && AD_SLOTS[key] ? '*' : ''}${w.auxAt(x, y) ? 'A' : ''}`);
  }
  console.log(y, row.join(' '));
}
console.log((JSON.parse(readFileSync(process.argv[2], 'utf8')).adverts?.rentals ?? []).map((r: any) => `${r.x},${r.y}#${r.i}`).join(' '));

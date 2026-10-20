import { AD_SLOTS, AD_SIZES, designKey, designPick } from '@msimcity/shared';
for (const [y, r] of [[-16, 0], [-14, 2]] as const) {
  const row: string[] = [];
  for (let x = -59; x <= -36; x++) {
    const k = designKey(2, 2, designPick(x, y))!, s = AD_SLOTS[k];
    // world direction of the slot: face 1 (+x model) -> r 0: +x, r 2: -x; face 3 the other way
    const dir = !s ? '' : s[0] === 0 ? 'F' : ((s[0] === 1) === (r === 0) ? '>' : '<');
    row.push(`${x}${dir}${s ? AD_SIZES[s[1]][0] : ''}`);
  }
  console.log(y, row.join(' '));
}
for (const x of [-59, -57, -55, -54, -51, -46, -44, -36, -40, -42]) for (const y of [-16, -14]) if (designKey(9, 1, designPick(x, y)) === '9:1:1') console.log('parking billboard ok at', x, y);

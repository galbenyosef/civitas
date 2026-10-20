import {
  HIGH_STREET, DEMO_OWNER, KIND_ID, AD_CLAIMS, AD_STRIDE, AD_SIZES, packLook, claimText, adHostAt, adSlotOpen, demoSections, tileKey,
  type AdEnv, type AdSize, type DemoId,
} from '@msimcity/shared';
import type { World } from '../world';
import type { Adverts } from '../sim/adverts';

/**
 * The showcase's high street (shared/src/demo/showcase.ts HIGH_STREET, docs/adverts.md): its building site behind a
 * hoarding, and three campaigns of the town's owner on every open frame along it, at three ages. The posters are kept at
 * their age (Adverts.seed `keep`), so a visitor always finds one fresh, one tagged and one wrecked side by side.
 * Runs after the fill (index.ts) and in demo:check; does nothing for a demo without a 'high-street' spot.
 */

/** wear ages (shared adWear) in street order: the two roof billboards and the poster west of the site are fresh, tagged and wrecked side by side; a mix along the rest */
const AGES = [0.02, 0.02, 1.0, 3.6, 0.3, 0.02, 0.02, 0.02, 0.6, 0.02, 0.02, 1.4, 0.15];

export function seedDemoAdverts(w: World, ads: Adverts, id: DemoId): string[] {
  const spot = demoSections(id).flatMap((s) => s.spots ?? []).find((sp) => sp.spot === 'high-street');
  if (!spot) return [];
  const problems: string[] = [];
  // the building site behind its hoarding: a shop that will take a very long time
  const [sx, sy] = HIGH_STREET.site;
  if (!w.buildings.has(tileKey(sx, sy)) && !w.sites.has(tileKey(sx, sy))) {
    if (!w.createSite(sx, sy, KIND_ID.commercial, 1, 1e7, -2)) problems.push(`high street: no site at (${sx}, ${sy})`);
  }
  const claim = (theme: number, text: string) => AD_CLAIMS.findIndex((c) => c.theme === theme && c.text === text);
  const camp = (theme: number, text: string, look: number, place?: string) => {
    const i = claim(theme, text);
    return ads.seedCampaign(DEMO_OWNER, theme, i, look, claimText(i, { place }) ?? text);
  };
  const campaigns = [
    camp(0, 'Low rents in {place}', packLook(0, 1, 0), 'Riverside'),
    camp(1, 'Safe streets, happy kids', packLook(2, 6, 2)),
    camp(5, 'Come and see {place}', packLook(1, 5, 1), 'High Street'),
  ];
  // every open frame in the street, west to east, north side first
  const env: AdEnv = { tile: (x, y) => w.peekTile(x, y), aux: (x, y) => w.auxAt(x, y), sub: (x, y) => w.subAt(x, y) };
  const [rx, ry, rw, rh] = spot.rect;
  const frames: { x: number; y: number; i: number; size: AdSize }[] = [];
  for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) {
    if (!w.buildings.has(tileKey(x, y)) && !w.sites.has(tileKey(x, y))) continue; // doors only: a merged parade once
    const h = adHostAt(env, x, y);
    if (!h) continue;
    for (let i = 0; i * AD_STRIDE < h.slots.length; i++) if (adSlotOpen(env, h, i, x, y)) frames.push({ x, y, i, size: AD_SIZES[h.slots[i * AD_STRIDE + 1]] });
  }
  let poster = 0;
  frames.forEach((f, k) => {
    // posters, banners and billboards take the ages in turn (fresh, tagged, wrecked first); hoardings get tagged, shelter panels are kept up
    const age = f.size === 'panel' ? 0.05 : f.size === 'hoarding' ? 1.4 : AGES[poster++ % AGES.length];
    if (!ads.seed(DEMO_OWNER, campaigns[k % campaigns.length], f.x, f.y, f.i, age, true)) problems.push(`high street: could not put a poster up at (${f.x}, ${f.y}) #${f.i}`);
  });
  if (poster < 3) problems.push(`high street: ${poster} poster or billboard frame(s) open, want at least 3 (fresh, tagged, wrecked)`);
  return problems;
}

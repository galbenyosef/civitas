import type { KindDef } from './schema';
import { EXTRA_DESIGNS } from './designs';
import { residential } from './residential';
import { commercial } from './commercial';
import { industrial } from './industrial';
import { office } from './office';
import { police, fire, hospital, yard } from './civic';
import { parking, busDepot, busStop } from './transport';
import { park, cinema, theatre, sports, library } from './leisure';
import { terminal } from './terminal';
import { railHalt, railStation, freightYard } from './rail';
import { motorwayStub } from './motorway';
import { CIVIC_TIERS } from './civic-tiers';
import { PARKING_TIERS } from './parking';
import { LEISURE_TIERS } from './leisure-tiers';
import { RESIDENTIAL_MERGED } from './residential-merged';
import { COMMERCIAL_MERGED } from './commercial-merged';
import { OFFICE_MERGED } from './office-merged';
import { INDUSTRIAL_MERGED } from './industrial-merged';
import { BLOCK_INTERIOR } from './block-interior';
import { LONDON_LANDMARKS } from './landmarks-london';

/**
 * Every building kind. This is source data: only the compile step
 * (`npm run buildings:compile`) reads it. The game reads the generated
 * compiled.ts and recipes.ts. Add a family file and list its kinds here.
 */
const BASE: KindDef[] = [residential, commercial, industrial, office, police, fire, hospital, yard, parking, park, cinema, theatre, sports, library, terminal, busDepot, busStop, railHalt, railStation, freightYard, motorwayStub,
  // size ladders (groups.ts): the smaller and bigger rungs around the kinds above
  ...CIVIC_TIERS, ...PARKING_TIERS, ...LEISURE_TIERS,
  // merged lots (zones.ts): bigger zone kinds that growth assembles from neighbouring lots
  ...RESIDENTIAL_MERGED, ...COMMERCIAL_MERGED, ...OFFICE_MERGED, ...INDUSTRIAL_MERGED,
  // block interiors: deep plots growing back into a block's landlocked middle, and the communal garden (block-interior.ts)
  ...BLOCK_INTERIOR,
  // landmarks (docs/buildings.md "Landmarks"): real buildings in a city's collection, placed only where their locked tech is given
  ...LONDON_LANDMARKS];

/** The catalogue with extra designs (designs/index.ts) appended to their kind+level; the family files stay untouched. */
export const CATALOGUE: KindDef[] = BASE.map((k) => {
  const extra = EXTRA_DESIGNS.filter((e) => e.kind === k.id);
  if (!extra.length) return k;
  return { ...k, levels: k.levels.map((l, i) => {
    const add = extra.filter((e) => e.level === (k.minLevel ?? 1) + i).map((e) => e.design); // merged zone kinds start above level 1
    return add.length ? { ...l, designs: [...l.designs, ...add] } : l;
  }) };
});
export { HELPER_MODELS } from './helpers';

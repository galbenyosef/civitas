import { POLICY_BY_ID, hasFeature, TECH_BY_ID, techFor, isPolicyId } from '@msimcity/shared';
import type { Player, World } from './world';

/**
 * The `setPolicy` intent (shared/src/policies.ts, docs/education.md section 16): flip an education policy for a player.
 * Validated on the server: a known policy, the technology that opens it, and (to enact it) the one-off fee in the
 * treasury. Turning one off is free. The running costs are charged where the effect is (sim/schools.ts, sim/schoolbus.ts).
 */
export function setPolicy(w: World, p: Player, id: string, on: boolean): { ok: boolean; msg: string } {
  const def = isPolicyId(id) ? POLICY_BY_ID.get(id) : undefined;
  if (!def) return { ok: false, msg: 'No such policy' };
  const has = p.policies?.includes(def.id) ?? false;
  if (has === on) return { ok: true, msg: `${def.name} is already ${on ? 'on' : 'off'}` };
  if (on) {
    if (!hasFeature(p.tech, def.feature)) return { ok: false, msg: `${def.name} needs ${techFor(def.feature)?.name ?? TECH_BY_ID.get(def.feature)?.name ?? 'more technology'} first` };
    if (w.spendable(p) < def.setup) return { ok: false, msg: w.shortOf(p, def.setup, `to enact ${def.name}`) };
    w.credit(p.id, -def.setup, 'other');
    p.policies = [...(p.policies ?? []), def.id];
  } else {
    p.policies = (p.policies ?? []).filter((x) => x !== def.id);
  }
  w.playersDirty = true;
  return { ok: true, msg: on ? `${def.name} enacted` : `${def.name} ended` };
}

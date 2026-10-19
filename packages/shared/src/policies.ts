/**
 * Education policies (docs/education.md sections 6 and 14): a short list of switches a player turns on for the schools
 * on their own parcels. Each is opened by a feature id of a tech node (`unlocks` in tech.ts), costs a one-off fee to
 * enact and then runs at a daily price, charged where the effect happens (sim/schools.ts for the school ones, the
 * school bus service in sim/schoolbus.ts). A player's switches are `Player.policies` (saved with players, optional,
 * so old saves load) and ride in `PlayerDTO.policies`; the `setPolicy` intent flips one, the server validates it.
 */
export type PolicyId = 'meals' | 'buses' | 'learning' | 'apprentice' | 'fees';

export interface PolicyDef {
  id: PolicyId;
  name: string;
  blurb: string;
  /** the feature id the policy needs, listed in the `unlocks` of one education tech node */
  feature: string;
  /** one-off cost to enact (turning it off is free) */
  setup: number;
  /** what it costs to run, and what it does, for the panel (the numbers are POLICY) */
  runs: string;
  effects: string[];
  /** which phase builds the effect, for the panel to be honest about a policy whose effect is not live yet */
  live: boolean;
}

/** Tunables of the policies, in one place (the pass bonus of free school meals is `EDU.mealsBonus`). Dollars per game day. */
export const POLICY = {
  /** free school meals: per pupil on a school day; the school's pass chance rises by EDU.mealsBonus, a pupil's health by mealsHealth a day, parents' mood by mealsMood */
  mealsPerPupil: 0.4, mealsHealth: 0.3, mealsMood: 2,
  /** school buses: per bus that runs, a round each school morning (sim/schoolbus.ts) */
  busPerDay: 15,
  /** adult learning (E5, server/src/sim/learning.ts): per learner on an FE course or evening class at the college's owner */
  learnerPerDay: 1,
  /** apprenticeships (E5, server/src/sim/learning.ts): the player pays this share of an apprentice's wage, up to apprenticeShare of a workplace's places train */
  apprenticeWageShare: 0.2, apprenticeShare: 0.1,
  /** tuition fees: income per student a day when on, the grant the player pays per student when off; on, this share of university places go unfilled, and graduates leave this much more readily (E4) */
  feePerStudent: 2, grantPerStudent: 1, feeDeter: 0.3, feeDrainMul: 1.5,
};

export const POLICIES: PolicyDef[] = [
  { id: 'meals', name: 'Free school meals', feature: 'policy-meals', setup: 120, live: true,
    blurb: 'Every pupil in your schools gets a hot lunch.',
    runs: `$${POLICY.mealsPerPupil.toFixed(2)} per pupil each school day`,
    effects: ['+5% chance of passing at your schools', 'pupils healthier (+0.3 a day)', "parents' mood +2"] },
  { id: 'buses', name: 'School buses', feature: 'policy-buses', setup: 150, live: true,
    blurb: 'A yellow bus from each of your secondary schools collects pupils who live over twelve tiles away.',
    runs: `$${POLICY.busPerDay} per bus that runs`,
    effects: ['one bus per secondary school, a morning round', 'driven by a member of the school staff', 'nothing to pay while it idles'] },
  { id: 'learning', name: 'Adult learning', feature: 'policy-learning', setup: 200, live: true,
    blurb: 'Further-education courses for the unemployed and evening classes for workers who want to move up.',
    runs: `$${POLICY.learnerPerDay} per learner a day`,
    effects: ['FE courses at your colleges for those out of work two days or more', 'evening classes for workers without GCSEs', 'an adult can rise one level, up to Level 3'] },
  { id: 'apprentice', name: 'Apprenticeships', feature: 'policy-apprentice', setup: 200, live: true,
    blurb: 'Factories, yards and workshops train young staff on the job, on a trades track.',
    runs: `${Math.round(POLICY.apprenticeWageShare * 100)}% of an apprentice's wage`,
    effects: [`up to ${Math.round(POLICY.apprenticeShare * 100)}% of a workplace's staff train`, 'workers under 25 reach Level 3 in the trades track after 8 shifts', 'for industrial and yard workplaces on your land'] },
  { id: 'fees', name: 'Tuition fees', feature: 'policy-fees', setup: 300, live: true,
    blurb: 'Students at your universities pay their way. Off, you pay them a grant instead.',
    runs: `earns $${POLICY.feePerStudent} per student a day; off, you pay a $${POLICY.grantPerStudent} grant`,
    effects: [`${Math.round(POLICY.feeDeter * 100)}% fewer university places taken`, 'more graduates leave town'] },
];
export const POLICY_BY_ID = new Map<string, PolicyDef>(POLICIES.map((p) => [p.id, p]));
export const isPolicyId = (s: unknown): s is PolicyId => typeof s === 'string' && POLICY_BY_ID.has(s);
/** Whether a player's switches (Player.policies, absent in old saves) have this policy on. */
export const hasPolicy = (policies: readonly string[] | undefined, id: PolicyId) => !!policies && policies.includes(id);

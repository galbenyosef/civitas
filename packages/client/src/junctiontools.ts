import {
  hasFeature, isRoad, isClassAux, isDividedAux, junctionGroup, planRoundabout, planFlyover, planMiniRoundabout, planBigRoundabout, planInterchange,
  junctionArmAt, pelicanProblem, armState, nextArmState, ARM_WORDS, TURN_RULE_COST, PELICAN_COST, FLYOVER_EW, FLYOVER_NS, techFor,
  type JunctionEnv, type JunctionPlan, type PlaceVerdict,
} from '@msimcity/shared';
import type { ClientWorld } from './world';

/** The tools that rebuild or sign a junction (shared/src/junctions.ts, roadrules.ts): one click, one junction. */
export type JunctionTool = 'roundabout' | 'flyover' | 'miniroundabout' | 'interchange' | 'turnrule' | 'pelican';
export const JUNCTION_TOOLS: readonly JunctionTool[] = ['roundabout', 'flyover', 'miniroundabout', 'interchange', 'turnrule', 'pelican'];
export const isJunctionTool = (t: string): t is JunctionTool => (JUNCTION_TOOLS as readonly string[]).includes(t);
const SIDES = ['east', 'west', 'south', 'north'];

/**
 * What the junction tools would do at a hovered tile, worked out on the loaded chunks with the planners the server
 * builds with (so the ghost, the cost and the red reason match what a click does): the outline to draw, its verdict and
 * the status line's words. The roundabout tool builds the 5×5 two-lane ring on an avenue's junction and the 3×3 on a
 * street's; the turn rules tool shows the sign the next click would put up on the arm under the cursor.
 */
export class JunctionTools {
  constructor(private world: ClientWorld) {}

  private env(): JunctionEnv {
    const me = this.world.myPlayer, pub = !!me && hasFeature(me.tech, 'publicRoads');
    return {
      tile: (tx, ty) => this.world.getTile(tx, ty),
      aux: (tx, ty) => this.world.auxAt(tx, ty),
      land: (tx, ty) => { const p = this.world.parcelAt(tx, ty); return p ? (this.world.mayEdit(p.owner) ? null : 'Not your land') : pub ? null : 'Buy this land first (or research Public works)'; },
    };
  }
  private road = (x: number, y: number) => { const t = this.world.getTile(x, y); return t !== undefined && isRoad(t); };
  private ruleEnv = { road: this.road, aux: (x: number, y: number) => this.world.auxAt(x, y) };
  /** Is (x, y) a junction where an avenue is crossed or joined (the roundabout tool then builds the big ring)? */
  avenueJunction(x: number, y: number): boolean {
    const g = junctionGroup(this.road, (tx, ty) => { const a = this.world.auxAt(tx, ty); return isClassAux(a) ? a : 0; }, x, y);
    if (!g) return false;
    for (let ty = g.y; ty < g.y + g.h; ty++) for (let tx = g.x; tx < g.x + g.w; tx++) if (isDividedAux(this.world.auxAt(tx, ty))) return true;
    return false;
  }
  private has(feature: string) { const me = this.world.myPlayer; return !me || hasFeature(me.tech, feature) || !!me.devUnlimited; }

  /** The planner's answer for a prefab tool at (x, y). */
  plan(tool: JunctionTool, x: number, y: number): (JunctionPlan & { rect?: { x: number; y: number; w: number; h: number } }) | null {
    const env = this.env();
    if (tool === 'miniroundabout') return { ...planMiniRoundabout(x, y, env), rect: { x, y, w: 1, h: 1 } };
    if (tool === 'interchange') {
      const v = planInterchange(x, y, env);
      if (v.ok && !this.has('motorways')) return { ok: false, reason: `${techFor('motorways')?.name ?? 'Motorways'} is needed before you can build an interchange` };
      return { ...v, rect: v.layout ? { x: v.layout.x, y: v.layout.y, w: v.layout.w, h: v.layout.h } : undefined };
    }
    if (tool === 'roundabout') {
      if (this.avenueJunction(x, y)) {
        const v = planBigRoundabout(x, y, env);
        if (v.ok && !this.has('avenues')) return { ok: false, reason: `${techFor('avenues')?.name ?? 'Avenues'} is needed before you can build a roundabout on an avenue` };
        const t = v.tiles;
        return { ...v, rect: t ? { x: Math.min(...t.filter((_, i) => i % 4 === 0)), y: Math.min(...t.filter((_, i) => i % 4 === 1)), w: 5, h: 5 } : undefined };
      }
      return { ...planRoundabout(x, y, env), rect: { x: x - 1, y: y - 1, w: 3, h: 3 } };
    }
    if (tool === 'flyover') {
      const v = planFlyover(x, y, env);
      const ew = v.tiles ? v.tiles[2] === FLYOVER_EW : this.world.auxAt(x, y) !== FLYOVER_NS;
      return { ...v, rect: ew ? { x: x - 1, y, w: 3, h: 1 } : { x, y: y - 1, w: 1, h: 3 } };
    }
    return null;
  }

  /** Status-line text for a junction tool over (x, y). */
  status(tool: JunctionTool, x: number, y: number): string {
    if (tool === 'turnrule') {
      const r = junctionArmAt(this.ruleEnv, x, y);
      if (typeof r === 'string') return ` · ${r}`;
      const next = nextArmState(armState(this.world.ruleAt(r.g.x, r.g.y), r.arm));
      return next === 'none' ? ` · click to take down the ${SIDES[r.arm]} arm's sign` : ` · click: ${ARM_WORDS[next]} on the ${SIDES[r.arm]} arm, $${TURN_RULE_COST}`;
    }
    if (tool === 'pelican') {
      if (this.world.ruleAt(x, y)?.pelican) return ' · click to take this signal crossing away';
      const why = pelicanProblem(this.ruleEnv, x, y);
      return why ? ` · ${why}` : ` · click to build a signal crossing, $${PELICAN_COST}`;
    }
    const v = this.plan(tool, x, y)!;
    if (!v.ok) return ` · ${v.reason}`;
    if (tool === 'flyover' && v.cost === 0) return ' · click to put the other road on the deck';
    const what = tool === 'miniroundabout' ? 'mini-roundabout' : tool === 'roundabout' && this.avenueJunction(x, y) ? 'two-lane roundabout (5×5)' : tool;
    return ` · click to build a${/^[aeiou]/.test(what) ? 'n' : ''} ${what}, $${v.cost}`;
  }

  /** The hover outline for a junction tool. */
  hoverArea(tool: JunctionTool, h: [number, number]): { x: number; y: number; w: number; h: number; verdict: PlaceVerdict } {
    if (tool === 'turnrule') {
      const r = junctionArmAt(this.ruleEnv, h[0], h[1]);
      return typeof r === 'string' ? { x: h[0], y: h[1], w: 1, h: 1, verdict: { ok: false, reason: r } as PlaceVerdict } : { x: r.g.x, y: r.g.y, w: r.g.w, h: r.g.h, verdict: { ok: true } as PlaceVerdict };
    }
    if (tool === 'pelican') {
      const why = this.world.ruleAt(h[0], h[1])?.pelican ? null : pelicanProblem(this.ruleEnv, h[0], h[1]);
      return { x: h[0], y: h[1], w: 1, h: 1, verdict: (why ? { ok: false, reason: why } : { ok: true }) as PlaceVerdict };
    }
    const v = this.plan(tool, h[0], h[1])!;
    const verdict = (v.ok ? { ok: true } : { ok: false, reason: v.reason ?? '' }) as PlaceVerdict;
    const r = v.rect ?? { x: h[0], y: h[1], w: 1, h: 1 };
    return { ...r, verdict };
  }
}

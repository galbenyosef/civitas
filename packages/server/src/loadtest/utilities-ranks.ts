// bot F on a frontier, seeds a..b, with the power gate on or off (GATE=0): rank-up minutes, low cash, residents, power stats
import { mulberry32 } from '@msimcity/shared';
import { World } from '../world';
import { seedFrontier } from '../seed';
import { createGame } from '../game';
import { playF } from './botf';
import type { Conn } from '../transport';
const [a, b] = (process.argv[2] ?? '1-3').split('-').map(Number);
const gate = process.env.GATE !== '0';
const mins = Number(process.env.MINS ?? 180);
(async () => {
  for (let seed = a; seed <= b; seed++) {
    Math.random = mulberry32(seed);
    const w = new World(424242);
    seedFrontier(w);
    let accept: ((c: Conn) => void) | null = null;
    const g = createGame(w, { onConnection: (fn) => { accept = fn; } }, { devTools: true, sandbox: false }, 10);
    if (!gate) g.sim.powerGate = null;
    const log: string[] = [];
    const r = await playF(g, accept!, mins, (m, what) => { if (/substation|rank|ut1|con1/.test(what)) log.push(`${m}:${what}`); }, { power: gate });
    const u = g.utilities.stats;
    console.log(JSON.stringify({ seed, gate, ups: r.ups, low: r.low, res: r.residents, subs: g.utilities.field.nodes.length, held: u.held, bills: Math.round(u.bills), fuel: Math.round(u.fuel), cut: u.cutHours, brown: u.brownHours, faults: u.faults, solveMs: +(u.solveMs / Math.max(1, u.solves)).toFixed(2), rebuilds: u.rebuilds }));
    if (process.env.LOG) console.log(log.join(' | '));
  }
})();

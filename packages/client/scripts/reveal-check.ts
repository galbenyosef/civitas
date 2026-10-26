// Progressive disclosure (client/src/reveal.ts): the stage a player is shown, pure.
import { stageFor, CHIPS_HIDDEN } from '../src/reveal';
let fails = 0;
const ok = (c: boolean, what: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${what}`); if (!c) fails++; };
const base = { sandbox: false, spectate: false, dev: false, everything: false };
ok(stageFor({ ...base, rank: null }) === 'camp', 'before the first rank message a new player is at Camp');
ok(stageFor({ ...base, rank: 0 }) === 'camp', 'Camp rank: camp stage');
ok(stageFor({ ...base, rank: 1 }) === 'hamlet', 'Hamlet rank: hamlet stage');
ok(stageFor({ ...base, rank: 2 }) === 'all', 'Village rank: everything');
ok(stageFor({ ...base, rank: 0, sandbox: true }) === 'all', 'a sandbox shows everything');
ok(stageFor({ ...base, rank: 0, spectate: true }) === 'all', 'a read-only showcase shows everything');
ok(stageFor({ ...base, rank: 0, dev: true }) === 'all', '?dev shows everything');
ok(stageFor({ ...base, rank: 0, everything: true }) === 'all', 'the player\'s own "show everything" wins');
ok(CHIPS_HIDDEN.camp.includes('mapBtn') && CHIPS_HIDDEN.camp.includes('perfBtn') && !CHIPS_HIDDEN.camp.includes('heat') && !CHIPS_HIDDEN.camp.includes('techBtn'), 'Camp hides the map and the readouts, never the overlays or the tech chip');
ok(CHIPS_HIDDEN.hamlet.every((id) => CHIPS_HIDDEN.camp.includes(id)) && CHIPS_HIDDEN.all.length === 0, 'each stage hides a subset of the one before');
console.log(fails ? `${fails} failed` : 'all ok'); process.exit(fails ? 1 : 0);

// The wind turbine's rotor (docs/utilities.md 4.5), offline, on a fake clock: the pure speed rules (shared/src/rotors.ts),
// the heading signal, the tower mounts the kit and the rotor pass share, and the pass itself (render/rotors.ts): a rotor
// advances while its plant generates, winds down to a stop over about ten seconds when it does not, keeps its phase across
// a chunk rebuild, never turns in step with its neighbour, and costs nothing when nothing is in range.
// Run: npx tsx packages/client/scripts/turbine-check.ts
import { Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { ROTOR_MOUNTS, ROTOR_SPEED, ROTOR_STOP_SECONDS, rotorStep, rotorTarget, windYaw, windAt, TICKS_PER_HOUR, KIND_ID } from '@msimcity/shared';
import { RECIPES } from '@msimcity/shared/src/buildings/recipes';
import { RotorsView } from '../src/render/rotors';

let fails = 0;
const ok = (cond: boolean, what: string) => { if (!cond) { fails++; console.log('FAIL', what); } else console.log('ok  ', what); };

// ---- the pure rules -----------------------------------------------------------------------------------------------
{
  let a = 0, s = 0;
  const run = (secs: number, target: number) => { for (let t = 0; t < secs; t += 0.05) { const n = rotorStep(a, s, target, 0.05); a = n.angle; s = n.speed; } };
  run(10, rotorTarget(true, 0.6, 1));
  const full = s, a0 = a;
  ok(full > ROTOR_SPEED.min && full <= ROTOR_SPEED.max * 1.1, `a generating rotor reaches a speed in range (${full.toFixed(2)} rad/s)`);
  run(1, rotorTarget(true, 0.6, 1));
  ok(a !== a0, 'its angle advances while generating');
  run(ROTOR_STOP_SECONDS / 2, 0);
  ok(s > 0 && s < full, 'half the stop time later it is slower but still turning');
  run(ROTOR_STOP_SECONDS / 2 + 0.2, 0);
  ok(s === 0, `after ${ROTOR_STOP_SECONDS} seconds from rest of full speed it has stopped`);
  const stopped = a; run(5, 0);
  ok(a === stopped, 'and a stopped rotor does not move');
  run(8, rotorTarget(true, 1, 1));
  ok(s > 0, 'it winds up again when the plant generates');
  ok(rotorTarget(true, 1, 1) > rotorTarget(true, 0.2, 1), 'more wind, faster');
  ok(rotorTarget(false, 1, 1) === 0, 'not generating: no target speed');
  let angleSteps = 0, prev = a; for (let i = 0; i < 100; i++) { const n = rotorStep(prev, s, rotorTarget(true, 0.7, 1), 1 / 60); if (Math.abs(((n.angle - prev + Math.PI * 3) % (Math.PI * 2)) - Math.PI) > 1.2 && n.angle > prev) angleSteps++; prev = n.angle; }
  ok(angleSteps === 0, 'the angle moves in small steps (no jumps) at 60 fps');
}
{
  let jump = 0, prev = windYaw(0, 7);
  for (let t = 1; t < TICKS_PER_HOUR * 96; t += 5) { const y = windYaw(t, 7); const d = Math.abs(Math.atan2(Math.sin(y - prev), Math.cos(y - prev))); jump = Math.max(jump, d); prev = y; }
  ok(jump < 0.02, `the wind's heading changes smoothly (largest step ${jump.toFixed(4)} rad per 5 ticks)`);
  ok(windYaw(0, 7) !== windYaw(0, 8), 'and differs by world seed');
  ok(windAt(1000, 7) >= 0.15 && windAt(1000, 7) <= 1, 'the wind signal stays in 0.15 to 1');
}

// ---- the mounts match the kit -----------------------------------------------------------------------------------
ok(Object.keys(ROTOR_MOUNTS).length === 2, 'two tower mounts, one per design');
for (const k of Object.keys(ROTOR_MOUNTS)) {
  const [id, , d] = k.split(':').map(Number);
  ok(id === KIND_ID['wind-turbine'] && RECIPES.some((r) => r.key === k), `the kit has a design for ${k} (kind ${id}, design ${d})`);
}

// ---- the pass -----------------------------------------------------------------------------------------------------
let now = 1000;
(globalThis.performance as { now: () => number }).now = () => now;
const placement = (x: number, z: number, key: string) => ({ key, matrix: new Matrix4().compose(new Vector3(x + 0.5, 0, z + 0.5), new Quaternion(), new Vector3(1, 1, 1)), sign: {} });
const cam = new PerspectiveCamera(); cam.position.set(5, 6, 5);
const view = new RotorsView();
view.seed = 7;
let out: number | undefined = 40;
view.output = () => out; view.told = () => true;
const items = [placement(3, 3, '165:1:0'), placement(5, 3, '165:1:1'), { key: '2:1:3', matrix: new Matrix4(), sign: {} }];
view.setChunk('0,0', items);
ok(view.count() === 2, 'the pass finds the two turbines among a chunk\'s buildings and ignores the rest');
const tick = 3 * TICKS_PER_HOUR;
const frame = (secs: number) => { for (let t = 0; t < secs; t += 1 / 60) { now += 1000 / 60; view.frame(tick, [cam]); } };
frame(2);
const s0 = view.stateAt(3, 3)!, s1 = view.stateAt(5, 3)!;
const a0 = s0.angle;
ok(view.inRange === 2 && view.group.visible, 'both are in range and drawn');
frame(1);
ok(s0.angle !== a0 && s0.speed > 0, 'a generating rotor turns on the fake clock');
ok(Math.abs(s0.angle - s1.angle) > 1e-3 && Math.abs(s0.speed - s1.speed) > 1e-3, 'two towers are never in step (own phase and speed)');
ok(s0.speed / s1.speed > 0.8 && s0.speed / s1.speed < 1.25, 'their speeds stay within about 10% of each other');
const before = s0.angle;
view.setChunk('0,0', items); // a rebuild re-places the same towers
frame(1 / 60);
ok(Math.abs(Math.atan2(Math.sin(view.stateAt(3, 3)!.angle - before), Math.cos(view.stateAt(3, 3)!.angle - before))) < 0.2, 'a chunk rebuild does not reset or jump the rotor');
out = 0;
frame(ROTOR_STOP_SECONDS + 1);
ok(view.stateAt(3, 3)!.speed === 0 && view.stateAt(5, 3)!.speed === 0, `with the plant off both stop within ${ROTOR_STOP_SECONDS + 1} s`);
const rest = view.stateAt(3, 3)!.angle; frame(2);
ok(view.stateAt(3, 3)!.angle === rest, 'and stay stopped');
out = 12; frame(3);
ok(view.stateAt(3, 3)!.speed > 0, 'and start again when it generates');
view.setChunk('0,0', [{ key: '165:1:0', matrix: items[0].matrix, sign: undefined }]);
ok(view.count() === 0, 'a site\'s shell (no sign yet) is not a turbine');
view.setChunk('0,0', items);
cam.position.set(900, 6, 900);
frame(0.1);
ok(view.inRange === 0 && !view.group.visible, 'out of range: nothing updated, nothing drawn');
view.output = () => undefined; view.told = () => false; cam.position.set(5, 6, 5); frame(1);
ok(view.inRange === 2 && view.stateAt(3, 3)!.speed > 0, 'before the server has said anything about plants, rotors turn on the wind alone');

console.log(fails ? `${fails} FAILED` : 'turbine-check: all ok');
process.exit(fails ? 1 : 0);

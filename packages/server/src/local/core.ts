/**
 * Everything a local-mode worker needs to run a game (docs/local-mode.md), and nothing that needs Node: the world and its
 * seeding, the game wiring and loop body, the MessagePort transport, the save format and the fast-fill. local/check.ts
 * bundles this file for the browser to keep it that way.
 */
export { World } from '../world';
export { seedCommons } from '../seed';
export { createGame, tuneEconomy, type Game, type GameConfig } from '../game';
export { PortSource, isControl, type Conn, type ConnSource, type Control, type PortLike } from '../transport';
export { snapshotOf, worldFromSnapshot, readableVersion, SNAPSHOT_VERSION, type Snapshot } from '../snapshot';
export { fillCity } from '../fill';
export { worldHash } from '../demo/seed';

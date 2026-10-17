import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { World } from './world';
import { snapshotOf, worldFromSnapshot, readableVersion, SNAPSHOT_VERSION, type Snapshot } from './snapshot';

export { snapshotOf, worldFromSnapshot, readableVersion, SNAPSHOT_VERSION, type Snapshot };

/** The server's world file: the snapshot (snapshot.ts) as JSON, written to a temp file and renamed so a crash never leaves half a world. */
export function saveWorld(w: World, path: string) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(snapshotOf(w)));
  renameSync(tmp, path);
}

export function loadWorld(path: string): World | null {
  if (!existsSync(path)) return null;
  const snap = JSON.parse(readFileSync(path, 'utf8')) as Snapshot;
  if (!readableVersion(snap.version)) {
    renameSync(path, path + '.v' + (snap.version ?? 0) + '.bak');
    console.warn(`world file is format v${snap.version}, this server needs v${SNAPSHOT_VERSION}; moved it aside and starting a new world`);
    return null;
  }
  return worldFromSnapshot(snap);
}


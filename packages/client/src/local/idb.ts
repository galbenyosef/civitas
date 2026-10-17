import type { SaveMeta, SaveStore } from './host';

/**
 * Local-mode saves in IndexedDB (docs/local-mode.md section 3), opened in the worker. Database `civitas`: `meta` holds each
 * save's SaveMeta (listing reads only these), `data` its gzipped world.json under the same slot key. A put writes both in one
 * transaction, so a save is all or nothing, like the server's tmp + rename.
 */
const DB = 'civitas', META = 'meta', DATA = 'data';

const done = <T>(req: IDBRequest<T>) => new Promise<T>((ok, fail) => { req.onsuccess = () => ok(req.result); req.onerror = () => fail(req.error); });
const finished = (tx: IDBTransaction) => new Promise<void>((ok, fail) => {
  tx.oncomplete = () => ok();
  tx.onerror = () => fail(tx.error);
  tx.onabort = () => fail(tx.error ?? new DOMException('aborted', 'AbortError'));
});

export async function openSaves(): Promise<SaveStore> {
  if (typeof indexedDB === 'undefined') throw new Error('no IndexedDB');
  const open = indexedDB.open(DB, 1);
  open.onupgradeneeded = () => {
    const db = open.result;
    if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'slot' });
    if (!db.objectStoreNames.contains(DATA)) db.createObjectStore(DATA);
  };
  const db = await done(open);
  return {
    async put(meta: SaveMeta, data: Uint8Array) {
      const tx = db.transaction([META, DATA], 'readwrite');
      tx.objectStore(META).put(meta);
      tx.objectStore(DATA).put(data, meta.slot);
      await finished(tx);
    },
    async get(slot: string) {
      const v = await done(db.transaction(DATA).objectStore(DATA).get(slot)) as Uint8Array | ArrayBuffer | undefined;
      return v ? (v instanceof Uint8Array ? v : new Uint8Array(v)) : null;
    },
    list: () => done(db.transaction(META).objectStore(META).getAll()) as Promise<SaveMeta[]>,
    async remove(slot: string) {
      const tx = db.transaction([META, DATA], 'readwrite');
      tx.objectStore(META).delete(slot);
      tx.objectStore(DATA).delete(slot);
      await finished(tx);
    },
  };
}

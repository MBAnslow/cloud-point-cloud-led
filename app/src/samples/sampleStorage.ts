/**
 * IndexedDB wrapper for storing raw sample blobs across sessions.
 * Snapshot JSON in localStorage holds only lightweight metadata
 * (id, name, durationSec); the actual audio files can be MB-sized
 * and belong in a real binary store.
 *
 * Single object store keyed by sample id.
 */

const DB_NAME = "cloudLeds.samples";
const STORE = "blobs";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function withStore<T>(
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        const req = op(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function putSampleBlob(id: string, blob: Blob): Promise<void> {
  await withStore("readwrite", (s) => s.put(blob, id));
}

export async function getSampleBlob(id: string): Promise<Blob | null> {
  const v = await withStore<Blob | undefined>("readonly", (s) => s.get(id));
  return v ?? null;
}

export async function deleteSampleBlob(id: string): Promise<void> {
  await withStore("readwrite", (s) => s.delete(id));
}

export async function listSampleIds(): Promise<string[]> {
  const keys = await withStore<IDBValidKey[]>("readonly", (s) => s.getAllKeys());
  return keys.map((k) => String(k));
}

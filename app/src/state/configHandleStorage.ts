/**
 * Tiny IndexedDB store for a single FileSystemFileHandle — the last
 * YAML config file the user picked. Handles survive across page reloads
 * (Chrome/Edge), so once the user has picked a file we can silently
 * re-save/re-load to it without another picker prompt, subject to a
 * one-time permission re-request per session.
 */

const DB_NAME = "cloudLeds.configHandle";
const STORE = "handles";
const DB_VERSION = 1;
const KEY = "lastConfig";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function withStore<T>(
  mode: IDBTransactionMode,
  op: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = op(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function putConfigHandle(handle: FileSystemFileHandle): Promise<void> {
  await withStore("readwrite", (s) => s.put(handle, KEY));
}

export async function getConfigHandle(): Promise<FileSystemFileHandle | null> {
  const v = await withStore<FileSystemFileHandle | undefined>("readonly", (s) =>
    s.get(KEY),
  );
  return v ?? null;
}

export async function clearConfigHandle(): Promise<void> {
  await withStore("readwrite", (s) => s.delete(KEY));
}

import { loadProject, saveProject, type ProjectBundle } from '@naqsh/core';

/**
 * Autosave (plan.md §4 "autosave"): the project is stored in IndexedDB as the
 * same validated .zip bytes as File › Save, a moment after each change, and
 * restored on the next visit. Browser storage can be unavailable (private
 * mode, blocked site data); every call fails quietly in that case.
 */

const DB = 'naqsh';
const STORE = 'autosave';
const KEY = 'current';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

export async function saveAutosave(bundle: ProjectBundle): Promise<boolean> {
  try {
    await run('readwrite', (s) => s.put(saveProject(bundle), KEY));
    return true;
  } catch {
    return false;
  }
}

export async function loadAutosave(): Promise<ProjectBundle | undefined> {
  try {
    const bytes = await run<Uint8Array | undefined>('readonly', (s) => s.get(KEY));
    return bytes ? loadProject(bytes) : undefined;
  } catch {
    return undefined;
  }
}

export async function clearAutosave(): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(KEY));
  } catch {
    // nothing to clear
  }
}

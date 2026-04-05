import type { GedcomData, SelfIdentityPublic } from '../types';

const AUTOSAVE_DB_NAME = 'g2-autosave-db';
const AUTOSAVE_STORE_NAME = 'snapshots';
const AUTOSAVE_RECORD_KEY = 'latest';

export type AutoSaveSnapshot = {
  savedAt: string;
  databaseName: string;
  originalGedcomData: GedcomData;
  documentsByIndividualId: Record<string, unknown>;
  selfIdentity: SelfIdentityPublic | null;
};

const openAutoSaveDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(AUTOSAVE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(AUTOSAVE_STORE_NAME)) {
        db.createObjectStore(AUTOSAVE_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export const saveAutoSaveSnapshot = async (snapshot: AutoSaveSnapshot): Promise<void> => {
  const db = await openAutoSaveDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(AUTOSAVE_STORE_NAME, 'readwrite');
    tx.objectStore(AUTOSAVE_STORE_NAME).put(snapshot, AUTOSAVE_RECORD_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
};

export const readAutoSaveSnapshot = async (): Promise<AutoSaveSnapshot | null> => {
  const db = await openAutoSaveDb();
  const result = await new Promise<AutoSaveSnapshot | null>((resolve, reject) => {
    const tx = db.transaction(AUTOSAVE_STORE_NAME, 'readonly');
    const req = tx.objectStore(AUTOSAVE_STORE_NAME).get(AUTOSAVE_RECORD_KEY);
    req.onsuccess = () => resolve((req.result as AutoSaveSnapshot | undefined) || null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
};

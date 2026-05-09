/**
 * Réinitialisation provisoire pour tests : efface la persistance locale G2 (localStorage + autosave IndexedDB).
 * Ne touche pas au cache Service Worker / PWA ; recharger la page après appel.
 */

const AUTOSAVE_DB_NAME = 'g2-autosave-db';

/** Supprime toutes les entrées localStorage dont la clé commence par `g2:` ou est `knownPeerIdentities.v1`. */
export function clearAllG2LocalStorage(): string[] {
  const removed: string[] = [];
  const toRemove: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith('g2:') || key === 'knownPeerIdentities.v1') {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) {
      localStorage.removeItem(key);
      removed.push(key);
    }
  } catch {
    // ignore
  }
  return removed;
}

export function deleteG2AutosaveIndexedDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.deleteDatabase(AUTOSAVE_DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error('IndexedDB delete failed'));
      req.onblocked = () => resolve();
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

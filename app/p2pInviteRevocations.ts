import { INVITE_REVOKED_IDS_STORAGE_KEY } from './storageKeys';

const MAX_IDS = 400;

function parseRevokedIds(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === 'string' && x.length > 0));
  } catch {
    return new Set();
  }
}

/** Invitations révoquées sur cet appareil (clé partagée avec le secret d’invite : invalide le lien même si la liste en mémoire a été perdue). */
export function loadRevokedInviteIds(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  return parseRevokedIds(localStorage.getItem(INVITE_REVOKED_IDS_STORAGE_KEY));
}

export function isInviteIdLocallyRevoked(inviteId: string): boolean {
  if (!inviteId) return false;
  return loadRevokedInviteIds().has(inviteId);
}

export function persistRevokedInviteId(inviteId: string): void {
  if (!inviteId || typeof localStorage === 'undefined') return;
  try {
    const set = loadRevokedInviteIds();
    set.add(inviteId);
    let arr = [...set];
    if (arr.length > MAX_IDS) {
      arr = arr.slice(-MAX_IDS);
    }
    localStorage.setItem(INVITE_REVOKED_IDS_STORAGE_KEY, JSON.stringify(arr));
  } catch {
    // ignore quota / private mode
  }
}

import type { Individual } from '../types';

/** Base Prénom_Nom pour titres auto des photos en ligne (comme un nom de fichier). */
export function displayNameSlugForOnlineDocTitle(
  individualId: string,
  individuals: Record<string, Individual> | null | undefined,
): string {
  const indi = individuals?.[individualId];
  if (!indi) return individualId.replace(/^@+|@+$/g, '') || 'unknown';
  const g = (indi.givenName || '').trim();
  const s = (indi.surname || '').trim();
  const combined = `${g} ${s}`.trim();
  if (combined) return combined.replace(/\s+/g, '_');
  const n = (indi.name || '').replace(/\//g, '').trim().replace(/\s+/g, '_');
  if (n) return n;
  return individualId.replace(/^@+|@+$/g, '') || 'unknown';
}

export function shouldReplaceOnlinePhotoTitle(title: string): boolean {
  const t = title.trim();
  if (!t || t === 'Untitled') return true;
  if (t.startsWith('Wikipedia (')) return true;
  return false;
}

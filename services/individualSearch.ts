import { Individual } from '../types';

/**
 * Recherche dans la liste : sous-chaîne complète, ou tous les « mots » (≥2 car.) présents
 * dans prénom + nom + nom affiché + identifiant GEDCOM sans @.
 * Permet de trouver « Sarah Ferguson » alors que le GEDCOM a « Sarah Margaret Ferguson ».
 */
export function individualMatchesSearchQuery(p: Individual, searchRaw: string): boolean {
  const q = searchRaw.trim().toLowerCase();
  if (!q) return true;
  const idPart = (p.id || '').replace(/^@+|@+$/g, '').toLowerCase();
  const hay = `${p.givenName || ''} ${p.surname || ''} ${p.name || ''} ${idPart}`
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (hay.includes(q)) return true;
  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length === 0) return false;
  if (tokens.length === 1) return hay.includes(tokens[0]);
  return tokens.every((t) => hay.includes(t));
}

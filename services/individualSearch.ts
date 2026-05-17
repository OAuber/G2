import { Individual } from '../types';
import { formatDateInfoDisplay } from './genealogyDate';

/**
 * Libellé principal pour listes / recherche : prénom + nom de famille si présents,
 * sinon `name` GEDCOM (souvent rempli seul côté import), sinon id.
 * Aligné sur l’usage des bandeaux comparaison (`individualDisplayLabel` côté App).
 */
export function individualPrimaryListLabel(indi: Individual): string {
  const fromParts = `${indi.givenName || ''} ${indi.surname || ''}`.trim();
  if (fromParts) return fromParts;
  return (indi.name || '').trim() || indi.id;
}

/** Liste de sélection (photo de groupe, enfants, etc.) : nom + naissance si connue. */
export function individualPickerListLabel(indi: Individual, lang: 'fr' | 'en' = 'fr'): string {
  const name = individualPrimaryListLabel(indi);
  const birth = formatDateInfoDisplay(indi.birthDate, lang);
  return birth ? `${name} (${birth})` : name;
}

/**
 * Recherche dans la liste : sous-chaîne complète, ou tous les « mots » (≥2 car.) présents
 * dans prénom + nom + nom affiché + identifiant GEDCOM sans @.
 * Permet de trouver « Sarah Ferguson » alors que le GEDCOM a « Sarah Margaret Ferguson ».
 */
export function individualMatchesSearchQuery(p: Individual, searchRaw: string): boolean {
  const q = searchRaw.trim().toLowerCase();
  if (!q) return true;
  const idPart = (p.id || '').replace(/^@+|@+$/g, '').toLowerCase();
  const birthHay = formatDateInfoDisplay(p.birthDate, 'fr');
  const hay = `${p.givenName || ''} ${p.surname || ''} ${p.name || ''} ${idPart} ${p.birthDate?.year ?? ''} ${birthHay}`
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (hay.includes(q)) return true;
  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length === 0) return false;
  if (tokens.length === 1) return hay.includes(tokens[0]);
  return tokens.every((t) => hay.includes(t));
}

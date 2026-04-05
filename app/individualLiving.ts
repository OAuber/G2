import type { GedcomData } from '../types';

/**
 * Individu considéré comme probablement vivant pour invitations et identité :
 * la date de décès est lue sur le GEDCOM **original** quand il est disponible, pour ne pas
 * exclure quelqu’un à cause d’une mort **calculée** par la normalisation.
 */
export function isProbablyLivingForUi(
  individualId: string,
  gedcomData: GedcomData,
  originalGedcomData: GedcomData | null
): boolean {
  const orig = originalGedcomData?.individuals[individualId];
  if (orig) {
    return !orig.deathDate?.year;
  }
  const cur = gedcomData.individuals[individualId];
  if (!cur) return false;
  const d = cur.deathDate;
  if (!d?.year) return true;
  // Sans copie « originale » séparée : une mort uniquement estimée ne retire pas la fiche des vivants probables
  return d.isCalculated === true;
}

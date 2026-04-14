import type { GedcomData, Individual } from '../types';

/**
 * Trouve une fiche dans un GEDCOM même si la clé varie légèrement (`@I1@` vs `I1`).
 */
export function findIndividualInGedcom(gedcom: GedcomData | null | undefined, rawId: string): Individual | null {
  if (!gedcom?.individuals || !rawId) return null;
  const id = rawId.trim();
  const ind = gedcom.individuals[id];
  if (ind) return ind;
  const bare = id.replace(/^@+/g, '').replace(/@+$/g, '');
  const variants = [bare, `@${bare}@`, `@${bare}`, `${bare}@`];
  for (const v of variants) {
    if (gedcom.individuals[v]) return gedcom.individuals[v];
  }
  for (const key of Object.keys(gedcom.individuals)) {
    const kb = key.replace(/^@+/g, '').replace(/@+$/g, '');
    if (kb === bare) return gedcom.individuals[key];
  }
  return null;
}

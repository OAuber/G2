import type { GedcomData, Individual } from '../types';

/** Démo « Rois et reines d’Europe » : Louis XIV dans le bundle enrichi (IDs GEDCOM usuels). */
const ROYALS_DEMO_LOUIS_IDS = ['I1341', '@I1341@'] as const;

export function findIndividualForRoyalsDemo(data: GedcomData): Individual | null {
  for (const id of ROYALS_DEMO_LOUIS_IDS) {
    const indi = data.individuals[id];
    if (indi) return indi;
  }
  return null;
}

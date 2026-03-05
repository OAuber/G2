import { Family, GedcomData, Individual } from '../types';
import { AccessProfile } from './p2pDomain';

type VisibleIndividual = Partial<Individual> & { id: string };
type VisibleFamily = Partial<Family> & { id: string };

export function buildSharedGedcomView(data: GedcomData, profile: AccessProfile): GedcomData {
  const filteredIndividuals: Record<string, VisibleIndividual> = {};
  const filteredFamilies: Record<string, VisibleFamily> = {};
  const allowedIndividualIds = new Set<string>();

  for (const [id, individual] of Object.entries(data.individuals)) {
    if (!isIndividualVisible(individual, profile)) continue;
    allowedIndividualIds.add(id);
    filteredIndividuals[id] = filterIndividualFields(individual, profile);
  }

  for (const [id, family] of Object.entries(data.families)) {
    const maybeVisible = filterFamilyIfVisible(family, allowedIndividualIds, profile);
    if (maybeVisible) filteredFamilies[id] = maybeVisible;
  }

  return {
    individuals: filteredIndividuals as Record<string, Individual>,
    families: filteredFamilies as Record<string, Family>,
  };
}

function isIndividualVisible(individual: Individual, profile: AccessProfile): boolean {
  if (profile.allowBranches.length === 0) return true;
  return profile.allowBranches.includes(individual.id);
}

function filterIndividualFields(individual: Individual, profile: AccessProfile): VisibleIndividual {
  const result: VisibleIndividual = { id: individual.id };
  for (const key of profile.allowFields) {
    if (key in individual) {
      (result as unknown as Record<string, unknown>)[key] = (individual as unknown as Record<string, unknown>)[key];
    }
  }
  if (!result.name && (result.givenName || result.surname)) {
    result.name = `${result.givenName || ''} /${result.surname || ''}/`.trim();
  }
  return result;
}

function filterFamilyIfVisible(
  family: Family,
  allowedIndividualIds: Set<string>,
  profile: AccessProfile
): VisibleFamily | null {
  const husbandVisible = family.husbandId ? allowedIndividualIds.has(family.husbandId) : false;
  const wifeVisible = family.wifeId ? allowedIndividualIds.has(family.wifeId) : false;
  const visibleChildren = family.childrenIds.filter((childId) => allowedIndividualIds.has(childId));
  if (!husbandVisible && !wifeVisible && visibleChildren.length === 0) return null;

  const result: VisibleFamily = { id: family.id, childrenIds: visibleChildren };
  if (profile.allowFields.includes('family.husbandId') && husbandVisible) result.husbandId = family.husbandId;
  if (profile.allowFields.includes('family.wifeId') && wifeVisible) result.wifeId = family.wifeId;
  if (profile.allowFields.includes('family.marriageDate') && family.marriageDate) result.marriageDate = family.marriageDate;
  return result;
}

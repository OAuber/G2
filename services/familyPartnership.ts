import type { Family, GedcomData } from '../types';

/**
 * Clé stable pour une union : (H,W) et (W,H) → même chaîne ; un seul parent connu → `single:id`.
 */
export function familyPartnershipKey(husbandId?: string, wifeId?: string): string | null {
  const h = husbandId?.trim();
  const w = wifeId?.trim();
  const hasH = !!h;
  const hasW = !!w;
  if (hasH && hasW) {
    return [h!, w!].sort((a, b) => a.localeCompare(b)).join('|');
  }
  if (hasH) return `single:${h}`;
  if (hasW) return `single:${w}`;
  return null;
}

export function findExistingFamilyIdByParentPair(
  data: GedcomData,
  parentAId: string | undefined,
  parentBId: string | undefined,
): string | undefined {
  const key = familyPartnershipKey(parentAId, parentBId);
  if (!key) return undefined;
  for (const [fid, fam] of Object.entries(data.families)) {
    if (familyPartnershipKey(fam.husbandId, fam.wifeId) === key) return fid;
  }
  return undefined;
}

function unionChildIds(a: string[], b: string[]): string[] {
  const out: string[] = [...a];
  const seen = new Set(out);
  for (const id of b) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Fusionne les FAM qui décrivent la même union (H/W ou W/H) ou le même parent seul.
 */
export function dedupeFamiliesBySymmetricPartnership(data: GedcomData): void {
  const groups = new Map<string, string[]>();
  for (const fid of Object.keys(data.families)) {
    const fam = data.families[fid];
    if (!fam) continue;
    const key = familyPartnershipKey(fam.husbandId, fam.wifeId);
    if (!key) continue;
    const arr = groups.get(key) ?? [];
    arr.push(fid);
    groups.set(key, arr);
  }
  for (const fids of groups.values()) {
    if (fids.length < 2) continue;
    fids.sort((a, b) => a.localeCompare(b));
    const keepId = fids[0]!;
    const survivor = data.families[keepId];
    if (!survivor) continue;
    let allChildren = [...(survivor.childrenIds ?? [])];
    for (let i = 1; i < fids.length; i++) {
      const dupId = fids[i]!;
      const dup = data.families[dupId];
      if (!dup) continue;
      allChildren = unionChildIds(allChildren, dup.childrenIds ?? []);
      if (!survivor.marriageDate && dup.marriageDate) survivor.marriageDate = dup.marriageDate;
      if (!survivor.husbandId && dup.husbandId) survivor.husbandId = dup.husbandId;
      if (!survivor.wifeId && dup.wifeId) survivor.wifeId = dup.wifeId;
      for (const ind of Object.values(data.individuals)) {
        if (ind.familyChildId === dupId) ind.familyChildId = keepId;
        if (ind.familySpouseIds?.length) {
          ind.familySpouseIds = [...new Set(ind.familySpouseIds.map((x) => (x === dupId ? keepId : x)))];
        }
      }
      delete data.families[dupId];
    }
    survivor.childrenIds = allChildren;
  }
}

/** Même couple (deux parents) que dans le formulaire, sans tenir compte de l’assignation H/W. */
export function familyMatchesSpousePairForUpdate(
  f: Family,
  husbandId: string | undefined,
  wifeId: string | undefined,
): boolean {
  if (husbandId && wifeId) {
    return familyPartnershipKey(f.husbandId, f.wifeId) === familyPartnershipKey(husbandId, wifeId);
  }
  return (f.husbandId || '') === (husbandId || '') && (f.wifeId || '') === (wifeId || '');
}

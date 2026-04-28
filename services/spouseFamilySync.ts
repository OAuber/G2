import { GedcomData, Family, Individual, Gender, DateInfo } from '../types';
import { parseDate } from './gedcomParser';
import { familyMatchesSpousePairForUpdate } from './familyPartnership';

/** Formulaire édition / création — évite une dépendance circulaire avec DetailsPanel. */
export interface SpouseChildrenForm {
  spouseId: string;
  childrenIds: string[];
  marriageDate: string;
}

export function uniqueSortedChildIds(ids: string[]): string[] {
  return [...new Set(ids)].sort();
}

export function sameChildSets(a: string[], b: string[]): boolean {
  return uniqueSortedChildIds(a).join('\0') === uniqueSortedChildIds(b).join('\0');
}

function removeFamilyRecord(data: GedcomData, famId: string): void {
  const fam = data.families[famId];
  if (!fam) return;
  for (const ind of Object.values(data.individuals)) {
    if (ind.familySpouseIds?.length) {
      ind.familySpouseIds = ind.familySpouseIds.filter((id) => id !== famId);
    }
  }
  delete data.families[famId];
}

function pruneStaleFamilySpouseRefs(data: GedcomData): void {
  for (const ind of Object.values(data.individuals)) {
    if (!ind.familySpouseIds?.length) continue;
    ind.familySpouseIds = ind.familySpouseIds.filter((fid) => !!data.families[fid]);
  }
}

/**
 * Fusion à la création : même ensemble d'enfants qu'une famille mono-parentale existante.
 */
export function findMergeableFamilyForNewIndividual(
  data: GedcomData,
  newIndi: Individual,
  formData: SpouseChildrenForm
): Family | undefined {
  const wantCh = uniqueSortedChildIds(formData.childrenIds);
  if (wantCh.length === 0 && !formData.spouseId?.trim()) return undefined;

  const spouseId = formData.spouseId?.trim() || undefined;

  for (const f of Object.values(data.families)) {
    if (!sameChildSets(f.childrenIds, wantCh)) continue;
    if (f.husbandId && f.wifeId) continue;

    if (newIndi.gender === Gender.Female) {
      if (f.wifeId) continue;
      if (f.husbandId && (!spouseId || f.husbandId === spouseId)) return f;
    } else if (newIndi.gender === Gender.Male) {
      if (f.husbandId) continue;
      if (f.wifeId && (!spouseId || f.wifeId === spouseId)) return f;
    } else {
      if (f.husbandId) continue;
      if (f.wifeId && (!spouseId || f.wifeId === spouseId)) return f;
    }
  }
  return undefined;
}

function linkParentToFamily(data: GedcomData, famId: string, parentId: string | undefined): void {
  if (!parentId) return;
  const p = data.individuals[parentId];
  if (!p) return;
  if (!p.familySpouseIds) p.familySpouseIds = [];
  if (!p.familySpouseIds.includes(famId)) p.familySpouseIds.push(famId);
}

function stripPersonFromSpouseSlot(data: GedcomData, personId: string, exceptFamId: string): void {
  for (const fam of Object.values(data.families)) {
    if (fam.id === exceptFamId) continue;
    if (fam.husbandId === personId) fam.husbandId = undefined;
    if (fam.wifeId === personId) fam.wifeId = undefined;
  }
}

/**
 * Applique conjoint + enfants lors de l'édition d'une fiche : fusionne les FAM partielles
 * (même enfants, un parent par famille) au lieu de laisser des doublons GEDCOM.
 */
export function applySpouseAndChildrenOnUpdate(
  data: GedcomData,
  indiId: string,
  form: SpouseChildrenForm,
  indiGender: Gender,
  getNextFamilyId: (d: GedcomData) => string
): void {
  const indi = data.individuals[indiId];
  if (!indi) return;

  const spouseId = form.spouseId?.trim() || undefined;
  const wantCh = uniqueSortedChildIds(form.childrenIds);
  const mDate: DateInfo | undefined = form.marriageDate?.trim() ? parseDate(form.marriageDate) : undefined;

  if (!spouseId && wantCh.length === 0) {
    const oldIds = [...(indi.familySpouseIds || [])];
    for (const fid of oldIds) {
      const fam = data.families[fid];
      if (!fam) continue;
      if (fam.husbandId === indiId) fam.husbandId = undefined;
      if (fam.wifeId === indiId) fam.wifeId = undefined;
      if (!fam.husbandId && !fam.wifeId && fam.childrenIds.length === 0) {
        removeFamilyRecord(data, fid);
      }
    }
    indi.familySpouseIds = [];
    pruneStaleFamilySpouseRefs(data);
    return;
  }

  let husbandId: string | undefined;
  let wifeId: string | undefined;
  if (indiGender === Gender.Female) {
    wifeId = indiId;
    husbandId = spouseId;
  } else {
    husbandId = indiId;
    wifeId = spouseId;
  }

  const sameChildFams = Object.values(data.families).filter((f) => sameChildSets(f.childrenIds, wantCh));

  let survivor: Family | undefined = sameChildFams.find((f) =>
    familyMatchesSpousePairForUpdate(f, husbandId, wifeId),
  );

  if (!survivor) {
    survivor = sameChildFams.find((f) => {
      if (f.husbandId && f.wifeId) return false;
      if (husbandId && wifeId) {
        return (
          (f.husbandId === husbandId && (!f.wifeId || f.wifeId === wifeId)) ||
          (f.wifeId === wifeId && (!f.husbandId || f.husbandId === husbandId))
        );
      }
      if (husbandId && !wifeId) return f.husbandId === husbandId && !f.wifeId;
      if (!husbandId && wifeId) return f.wifeId === wifeId && !f.husbandId;
      return false;
    });
  }

  if (!survivor && wantCh.length > 0) {
    const refChildId = wantCh[0];
    const refFamId = data.individuals[refChildId]?.familyChildId;
    if (refFamId && data.families[refFamId] && sameChildSets(data.families[refFamId].childrenIds, wantCh)) {
      survivor = data.families[refFamId];
    }
  }

  if (!survivor) {
    survivor = sameChildFams[0];
  }

  if (!survivor) {
    const fid = getNextFamilyId(data);
    data.families[fid] = {
      id: fid,
      husbandId,
      wifeId,
      childrenIds: [...wantCh],
      marriageDate: mDate,
    };
    linkParentToFamily(data, fid, husbandId);
    linkParentToFamily(data, fid, wifeId);
    stripPersonFromSpouseSlot(data, indiId, fid);
    if (spouseId) stripPersonFromSpouseSlot(data, spouseId, fid);
    const prevSp = indi.familySpouseIds || [];
    indi.familySpouseIds = [fid, ...prevSp.slice(1)].filter((id, i, arr) => arr.indexOf(id) === i);
    wantCh.forEach((cid) => {
      const c = data.individuals[cid];
      if (c) c.familyChildId = fid;
    });
    pruneStaleFamilySpouseRefs(data);
    return;
  }

  const fid = survivor.id;
  survivor.husbandId = husbandId;
  survivor.wifeId = wifeId;
  survivor.childrenIds = [...wantCh];
  if (mDate) survivor.marriageDate = mDate;

  const duplicateFamIds = new Set(sameChildFams.map((f) => f.id));

  for (const f of sameChildFams) {
    if (f.id === fid) continue;
    removeFamilyRecord(data, f.id);
  }

  stripPersonFromSpouseSlot(data, indiId, fid);
  if (spouseId) stripPersonFromSpouseSlot(data, spouseId, fid);

  linkParentToFamily(data, fid, husbandId);
  linkParentToFamily(data, fid, wifeId);

  const prevSp = indi.familySpouseIds || [];
  indi.familySpouseIds = [fid, ...prevSp.filter((id) => !duplicateFamIds.has(id))].filter(
    (id, i, arr) => arr.indexOf(id) === i
  );
  if (spouseId) {
    const sp = data.individuals[spouseId];
    if (sp) {
      if (!sp.familySpouseIds) sp.familySpouseIds = [];
      if (!sp.familySpouseIds.includes(fid)) sp.familySpouseIds.push(fid);
      sp.familySpouseIds = sp.familySpouseIds
        .filter((id) => data.families[id])
        .filter((id, i, arr) => arr.indexOf(id) === i);
    }
  }

  wantCh.forEach((cid) => {
    const c = data.individuals[cid];
    if (c) c.familyChildId = fid;
  });

  pruneStaleFamilySpouseRefs(data);
}

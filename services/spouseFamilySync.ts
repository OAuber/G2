import { GedcomData, Family, Individual, Gender, DateInfo } from '../types';
import { parseDate } from './gedcomParser';
import { dateInfoToFormString } from './genealogyDate';
import { familyMatchesSpousePairForUpdate } from './familyPartnership';

/** Une union (FAM) dans le formulaire fiche — ordre indépendant du conjoint. */
export interface UnionFormEntry {
  /** FAM existante (édition) ; absente pour une nouvelle union. */
  familyId?: string;
  spouseId: string;
  marriageDate: string;
  childrenIds: string[];
}

/** @deprecated Utiliser `UnionFormEntry` — conservé pour compatibilité interne. */
export interface SpouseChildrenForm {
  spouseId: string;
  childrenIds: string[];
  marriageDate: string;
}

export function emptyUnionFormEntry(): UnionFormEntry {
  return { spouseId: '', marriageDate: '', childrenIds: [] };
}

export function buildUnionsFromIndividual(data: GedcomData, individual: Individual): UnionFormEntry[] {
  const entries: UnionFormEntry[] = [];
  for (const famId of individual.familySpouseIds ?? []) {
    const fam = data.families[famId];
    if (!fam) continue;
    const spouseId = fam.husbandId === individual.id ? fam.wifeId ?? '' : fam.husbandId ?? '';
    entries.push({
      familyId: famId,
      spouseId,
      marriageDate: dateInfoToFormString(fam.marriageDate),
      childrenIds: [...(fam.childrenIds ?? [])],
    });
  }
  return entries.length > 0 ? entries : [emptyUnionFormEntry()];
}

export function unionFormEntryIsEmpty(u: UnionFormEntry): boolean {
  return !u.spouseId.trim() && u.childrenIds.length === 0 && !u.marriageDate.trim();
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
  formData: SpouseChildrenForm,
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

function resolveSpouseSlots(
  indiId: string,
  indiGender: Gender,
  spouseId: string | undefined,
): { husbandId?: string; wifeId?: string } {
  if (indiGender === Gender.Female) {
    return { wifeId: indiId, husbandId: spouseId };
  }
  return { husbandId: indiId, wifeId: spouseId };
}

/**
 * Crée ou met à jour une seule FAM ; ne retire pas les autres unions de l'individu.
 */
function applyOneUnionOnUpdate(
  data: GedcomData,
  indiId: string,
  form: UnionFormEntry,
  indiGender: Gender,
  getNextFamilyId: (d: GedcomData) => string,
): string | null {
  const indi = data.individuals[indiId];
  if (!indi) return null;

  const spouseId = form.spouseId?.trim() || undefined;
  const wantCh = uniqueSortedChildIds(form.childrenIds);
  const mDate: DateInfo | undefined = form.marriageDate?.trim() ? parseDate(form.marriageDate) : undefined;

  if (!spouseId && wantCh.length === 0 && !mDate) return null;

  const { husbandId, wifeId } = resolveSpouseSlots(indiId, indiGender, spouseId);

  let survivor: Family | undefined;
  if (form.familyId && data.families[form.familyId]) {
    survivor = data.families[form.familyId];
  }

  const sameChildFams = Object.values(data.families).filter((f) => sameChildSets(f.childrenIds, wantCh));

  if (!survivor) {
    survivor = sameChildFams.find((f) => familyMatchesSpousePairForUpdate(f, husbandId, wifeId));
  }

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
      const refFam = data.families[refFamId];
      if (familyMatchesSpousePairForUpdate(refFam, husbandId, wifeId)) {
        survivor = refFam;
      }
    }
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
    if (!indi.familySpouseIds) indi.familySpouseIds = [];
    if (!indi.familySpouseIds.includes(fid)) indi.familySpouseIds.push(fid);
    wantCh.forEach((cid) => {
      const c = data.individuals[cid];
      if (c) c.familyChildId = fid;
    });
    return fid;
  }

  const fid = survivor.id;
  survivor.husbandId = husbandId;
  survivor.wifeId = wifeId;
  survivor.childrenIds = [...wantCh];
  if (mDate) {
    survivor.marriageDate = mDate;
    delete survivor.marriageDateUserOmitted;
  } else {
    delete survivor.marriageDate;
    survivor.marriageDateUserOmitted = true;
  }

  const duplicateFamIds = new Set(
    sameChildFams
      .filter((f) => f.id !== fid && familyMatchesSpousePairForUpdate(f, husbandId, wifeId))
      .map((f) => f.id),
  );

  for (const dupId of duplicateFamIds) {
    removeFamilyRecord(data, dupId);
  }

  linkParentToFamily(data, fid, husbandId);
  linkParentToFamily(data, fid, wifeId);

  if (!indi.familySpouseIds) indi.familySpouseIds = [];
  if (!indi.familySpouseIds.includes(fid)) indi.familySpouseIds.push(fid);
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

  return fid;
}

/**
 * Applique toutes les unions du formulaire ; retire les FAM retirées du formulaire.
 */
export function applyUnionsOnUpdate(
  data: GedcomData,
  indiId: string,
  unions: UnionFormEntry[],
  indiGender: Gender,
  getNextFamilyId: (d: GedcomData) => string,
): void {
  const indi = data.individuals[indiId];
  if (!indi) return;

  const wanted = unions.filter((u) => !unionFormEntryIsEmpty(u));
  const keptFamIds: string[] = [];

  for (const u of wanted) {
    const fid = applyOneUnionOnUpdate(data, indiId, u, indiGender, getNextFamilyId);
    if (fid && !keptFamIds.includes(fid)) keptFamIds.push(fid);
  }

  const oldIds = [...(indi.familySpouseIds || [])];
  for (const fid of oldIds) {
    if (keptFamIds.includes(fid)) continue;
    const fam = data.families[fid];
    if (!fam) continue;
    if (fam.husbandId === indiId) fam.husbandId = undefined;
    if (fam.wifeId === indiId) fam.wifeId = undefined;
    indi.familySpouseIds = (indi.familySpouseIds || []).filter((id) => id !== fid);
    if (!fam.husbandId && !fam.wifeId && fam.childrenIds.length === 0) {
      removeFamilyRecord(data, fid);
    }
  }

  indi.familySpouseIds = keptFamIds.filter((id, i, arr) => arr.indexOf(id) === i);
  pruneStaleFamilySpouseRefs(data);
}

/**
 * Applique conjoint + enfants (une seule union) — préférer `applyUnionsOnUpdate`.
 */
export function applySpouseAndChildrenOnUpdate(
  data: GedcomData,
  indiId: string,
  form: SpouseChildrenForm,
  indiGender: Gender,
  getNextFamilyId: (d: GedcomData) => string,
): void {
  const union: UnionFormEntry = {
    spouseId: form.spouseId,
    marriageDate: form.marriageDate,
    childrenIds: form.childrenIds,
  };
  const indi = data.individuals[indiId];
  if (!indi) return;
  const firstFamId = indi.familySpouseIds?.[0];
  if (firstFamId && data.families[firstFamId]) {
    union.familyId = firstFamId;
  }
  applyUnionsOnUpdate(data, indiId, [union], indiGender, getNextFamilyId);
}

export function applyUnionsOnCreate(
  data: GedcomData,
  newId: string,
  newIndi: Individual,
  unions: UnionFormEntry[],
  getNextFamilyId: (d: GedcomData) => string,
): void {
  const wanted = unions.filter((u) => !unionFormEntryIsEmpty(u));
  for (const u of wanted) {
    const form: SpouseChildrenForm = {
      spouseId: u.spouseId,
      marriageDate: u.marriageDate,
      childrenIds: u.childrenIds,
    };
    const mergeFam = findMergeableFamilyForNewIndividual(data, newIndi, form);
    if (mergeFam) {
      const famRecord = data.families[mergeFam.id];
      if (newIndi.gender === Gender.Female) {
        famRecord.wifeId = newId;
      } else {
        famRecord.husbandId = newId;
      }
      if (form.spouseId) {
        const spouse = data.individuals[form.spouseId];
        if (spouse?.gender === Gender.Female) famRecord.wifeId = spouse.id;
        else famRecord.husbandId = spouse.id;
        linkParentToFamily(data, famRecord.id, spouse.id);
      }
      if (form.marriageDate) {
        famRecord.marriageDate = parseDate(form.marriageDate);
        delete famRecord.marriageDateUserOmitted;
      }
      form.childrenIds.forEach((childId) => {
        if (!famRecord.childrenIds.includes(childId)) famRecord.childrenIds.push(childId);
        const child = data.individuals[childId];
        if (child) child.familyChildId = famRecord.id;
      });
      linkParentToFamily(data, famRecord.id, newId);
    } else {
      applyOneUnionOnUpdate(data, newId, u, newIndi.gender, getNextFamilyId);
    }
  }
}

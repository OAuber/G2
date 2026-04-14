import type { Family, GedcomData, Individual } from '../types';

/**
 * Descendants sur au plus `maxGenerations` **niveaux** sous `rootId`
 * (0 = racine seule ; 1 = racine + enfants directs).
 */
export function collectDescendantIndividualIds(
  data: GedcomData,
  rootId: string,
  maxGenerations: number,
): Set<string> {
  const seen = new Set<string>();
  const queue: { id: string; gen: number }[] = [{ id: rootId, gen: 0 }];
  while (queue.length > 0) {
    const { id, gen } = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (gen >= maxGenerations) continue;
    const ind = data.individuals[id];
    if (!ind) continue;
    for (const fid of ind.familySpouseIds ?? []) {
      const fam = data.families[fid];
      if (!fam) continue;
      for (const cid of fam.childrenIds) {
        if (!data.individuals[cid] || seen.has(cid)) continue;
        queue.push({ id: cid, gen: gen + 1 });
      }
    }
  }
  return seen;
}

/**
 * Ascendants sur au plus `maxGenerations` **niveaux** au-dessus de `rootId`
 * (0 = racine seule ; 1 = racine + parents).
 */
export function collectAncestorIndividualIds(
  data: GedcomData,
  rootId: string,
  maxGenerations: number,
): Set<string> {
  const seen = new Set<string>();
  const queue: { id: string; gen: number }[] = [{ id: rootId, gen: 0 }];
  while (queue.length > 0) {
    const { id, gen } = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (gen >= maxGenerations) continue;
    const ind = data.individuals[id];
    if (!ind?.familyChildId) continue;
    const fam = data.families[ind.familyChildId];
    if (!fam) continue;
    for (const pid of [fam.husbandId, fam.wifeId]) {
      if (!pid || !data.individuals[pid] || seen.has(pid)) continue;
      queue.push({ id: pid, gen: gen + 1 });
    }
  }
  return seen;
}

/**
 * Ajoute les conjoints (autre parent des mêmes `FAMS`) pour chaque individu déjà dans le set.
 * Itère jusqu'à point fixe pour couvrir chaînes d'unions (mémo § 3.2).
 */
export function expandScopeWithSpouses(data: GedcomData, ids: Set<string>): Set<string> {
  const out = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...out]) {
      const ind = data.individuals[id];
      if (!ind) continue;
      for (const fid of ind.familySpouseIds ?? []) {
        const fam = data.families[fid];
        if (!fam) continue;
        const other =
          fam.husbandId === id ? fam.wifeId : fam.wifeId === id ? fam.husbandId : undefined;
        if (other && data.individuals[other] && !out.has(other)) {
          out.add(other);
          changed = true;
        }
      }
    }
  }
  return out;
}

/** Union descendance + ascendance selon plafonds, optionnellement élargie aux conjoints (manifeste § 5). */
export function collectManifestScopeIndividualIds(
  data: GedcomData,
  rootId: string,
  maxGenDown: number,
  maxGenUp: number,
  includeSpouses: boolean,
): Set<string> {
  const desc = collectDescendantIndividualIds(data, rootId, maxGenDown);
  const asc = collectAncestorIndividualIds(data, rootId, maxGenUp);
  const union = new Set<string>([...desc, ...asc]);
  if (!includeSpouses) return union;
  return expandScopeWithSpouses(data, union);
}

/**
 * Sous-graphe : fiches dans `ids` et familles dont tous les membres référencés sont dans `ids`.
 * Nettoie `FAMC` / `FAMS` si la famille est exclue.
 */
export function extractGedcomSubset(data: GedcomData, ids: Set<string>): GedcomData {
  const individuals: Record<string, Individual> = {};
  for (const id of ids) {
    const ind = data.individuals[id];
    if (ind) individuals[id] = { ...ind };
  }
  const families: Record<string, Family> = {};
  for (const [, fam] of Object.entries(data.families)) {
    const memberIds = [fam.husbandId, fam.wifeId, ...(fam.childrenIds ?? [])].filter(
      (x): x is string => typeof x === 'string' && x.length > 0,
    );
    if (memberIds.length === 0) continue;
    if (!memberIds.every((mid) => ids.has(mid))) continue;
    families[fam.id] = {
      ...fam,
      childrenIds: [...(fam.childrenIds ?? [])].filter((c) => ids.has(c)),
    };
  }
  for (const id of Object.keys(individuals)) {
    const ind = individuals[id];
    let next = ind;
    if (ind.familyChildId && !families[ind.familyChildId]) {
      next = { ...next, familyChildId: undefined };
    }
    if (ind.familySpouseIds?.length) {
      const fs = ind.familySpouseIds.filter((f) => families[f]);
      next = { ...next, familySpouseIds: fs.length ? fs : undefined };
    }
    individuals[id] = next;
  }
  return { individuals, families };
}

/** Plafonds par défaut pour l'aperçu UI (Phase E) — alignés sur le mémo jusqu'à spécification invitation. */
export const DEFAULT_PREVIEW_MAX_GEN_DOWN = 3;
export const DEFAULT_PREVIEW_MAX_GEN_UP = 2;

export type BranchImportPreview = {
  descendantCount: number;
  ancestorCount: number;
  maxGenDown: number;
  maxGenUp: number;
};

export function previewBranchImportOnLocalTree(
  data: GedcomData,
  rootLocalId: string,
  opts?: { maxGenDown?: number; maxGenUp?: number },
): BranchImportPreview | null {
  if (!data.individuals[rootLocalId]) return null;
  const maxGenDown = opts?.maxGenDown ?? DEFAULT_PREVIEW_MAX_GEN_DOWN;
  const maxGenUp = opts?.maxGenUp ?? DEFAULT_PREVIEW_MAX_GEN_UP;
  const desc = collectDescendantIndividualIds(data, rootLocalId, maxGenDown);
  const asc = collectAncestorIndividualIds(data, rootLocalId, maxGenUp);
  return {
    descendantCount: desc.size,
    ancestorCount: asc.size,
    maxGenDown,
    maxGenUp,
  };
}

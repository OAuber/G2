import type { Family, GedcomData, Individual } from '../types';
import { PEER_COMPARE_ID_PREFIX } from '../app/peerCompareIdNamespace';
import { dedupeFamiliesBySymmetricPartnership, findExistingFamilyIdByParentPair } from './familyPartnership';
import { collectIndividualIdsForManifest, type InviteExchangeManifest } from './inviteExchangeManifest';
import {
  collectAncestorIndividualIds,
  collectDescendantIndividualIds,
  expandScopeWithSpouses,
} from './lineageImportScope';
import { rankPeerMatchesForIndividual } from './compareIndividualSimilarity';

export type BranchImportDirection = 'descendants' | 'ancestors' | 'both';
export type BranchImportActionType = 'create' | 'merge' | 'conflict' | 'skip';

export type BranchImportPlanItem = {
  peerId: string;
  action: BranchImportActionType;
  localId?: string;
  matchScore?: number;
  candidateLocalIds?: string[];
  reason?: string;
};

export type BranchImportPlan = {
  direction: BranchImportDirection;
  scopePeerIds: string[];
  items: BranchImportPlanItem[];
  summary: {
    create: number;
    merge: number;
    conflict: number;
    skip: number;
  };
};

export type BranchImportBuildOptions = {
  direction?: BranchImportDirection;
  autoMergeScore?: number;
  suggestMatchScore?: number;
  candidateLimit?: number;
};

export type BranchImportApplyResult = {
  data: GedcomData;
  importedIndividualIds: string[];
  mergedIndividualIds: string[];
  importedFamilyIds: string[];
};

const DEFAULT_AUTO_MERGE_SCORE = 0.9;
const DEFAULT_SUGGEST_SCORE = 0.55;

function collectScopeIdsByDirection(
  peerData: GedcomData,
  manifest: InviteExchangeManifest,
  direction: BranchImportDirection,
): Set<string> {
  if (direction === 'both') {
    return collectIndividualIdsForManifest(peerData, manifest);
  }
  const out = new Set<string>();
  for (const rootId of manifest.rootIndividualIds) {
    if (!peerData.individuals[rootId]) continue;
    const part =
      direction === 'descendants'
        ? collectDescendantIndividualIds(peerData, rootId, manifest.maxGenDown)
        : collectAncestorIndividualIds(peerData, rootId, manifest.maxGenUp);
    for (const id of part) out.add(id);
  }
  /**
   * Sans conjoints : l’autre parent d’une union (souvent pas « descendant » de la racine) est absent du scope —
   * les familles FAMS ne passent pas `members.every(peerToLocal)` à l’application, les enfants importés restent
   * sans FAMC (individus isolés). Aligné sur `collectManifestScopeIndividualIds` / mémo § 3.2.
   */
  if (!manifest.includeSpouses) return out;
  return expandScopeWithSpouses(peerData, out);
}

function computeSummary(items: BranchImportPlanItem[]): BranchImportPlan['summary'] {
  const summary = { create: 0, merge: 0, conflict: 0, skip: 0 };
  for (const item of items) summary[item.action] += 1;
  return summary;
}

export function buildBranchImportPlan(
  localData: GedcomData,
  peerData: GedcomData,
  manifest: InviteExchangeManifest,
  options: BranchImportBuildOptions = {},
): BranchImportPlan {
  const direction = options.direction ?? 'both';
  const autoMergeScore = options.autoMergeScore ?? DEFAULT_AUTO_MERGE_SCORE;
  const suggestMatchScore = options.suggestMatchScore ?? DEFAULT_SUGGEST_SCORE;
  const candidateLimit = options.candidateLimit ?? 3;
  const scope = collectScopeIdsByDirection(peerData, manifest, direction);
  const locals = Object.values(localData.individuals);
  const items: BranchImportPlanItem[] = [];

  for (const peerId of scope) {
    const peer = peerData.individuals[peerId];
    if (!peer) continue;
    if (localData.individuals[peerId]) {
      items.push({ peerId, action: 'merge', localId: peerId, reason: 'same_id' });
      continue;
    }
    const ranked = rankPeerMatchesForIndividual(peer, locals, {
      minScore: suggestMatchScore,
      limit: candidateLimit,
      lineage: { gedcomSource: peerData, gedcomCandidate: localData },
    });
    if (ranked.length === 0) {
      items.push({ peerId, action: 'create', reason: 'no_match' });
      continue;
    }
    const [top] = ranked;
    if (top.score >= autoMergeScore) {
      items.push({
        peerId,
        action: 'merge',
        localId: top.individual.id,
        matchScore: top.score,
        reason: 'high_confidence_match',
      });
      continue;
    }
    items.push({
      peerId,
      action: 'conflict',
      matchScore: top.score,
      candidateLocalIds: ranked.map((r) => r.individual.id),
      reason: 'review_required',
    });
  }
  const sortedScope = [...scope].sort();
  const sortedItems = items.sort((a, b) => a.peerId.localeCompare(b.peerId));
  return {
    direction,
    scopePeerIds: sortedScope,
    items: sortedItems,
    summary: computeSummary(sortedItems),
  };
}

function cloneData(data: GedcomData): GedcomData {
  return JSON.parse(JSON.stringify(data)) as GedcomData;
}

function allocateXref(prefix: 'I' | 'F', used: Set<string>): string {
  let n = 1;
  while (used.has(`@${prefix}${n}@`)) n += 1;
  const id = `@${prefix}${n}@`;
  used.add(id);
  return id;
}

/** Retire le préfixe comparateur `pc:` pour obtenir un xref GEDCOM « fil » réutilisable en local. */
function stripPeerComparePrefix(id: string): string {
  return id.startsWith(PEER_COMPARE_ID_PREFIX) ? id.slice(PEER_COMPARE_ID_PREFIX.length) : id;
}

/**
 * Nouvelle fiche locale : jamais d’id `pc:` (sinon l’UI traite la personne comme arbre pair).
 * Réutilise `@In@` / `@Fn@` dérivé du pair si libre, sinon alloue un xref libre.
 */
function allocateLocalIndividualId(peerId: string, used: Set<string>): string {
  const candidate = stripPeerComparePrefix(peerId);
  if (candidate && !used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  return allocateXref('I', used);
}

function allocateLocalFamilyId(peerFamId: string, used: Set<string>): string {
  const candidate = stripPeerComparePrefix(peerFamId);
  if (candidate && !used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  return allocateXref('F', used);
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

function mergePeerIndividualIntoLocal(local: Individual, peer: Individual): Individual {
  const next: Individual = { ...local };
  if (!next.givenName && peer.givenName) next.givenName = peer.givenName;
  if (!next.surname && peer.surname) next.surname = peer.surname;
  if (!next.name && peer.name) next.name = peer.name;
  if (!next.birthDate && peer.birthDate) next.birthDate = peer.birthDate;
  if (!next.deathDate && peer.deathDate) next.deathDate = peer.deathDate;
  if (!next.birthPlace && peer.birthPlace) next.birthPlace = peer.birthPlace;
  if (!next.deathPlace && peer.deathPlace) next.deathPlace = peer.deathPlace;
  if (!next.notes && peer.notes) next.notes = peer.notes;
  return next;
}

export function applyBranchImportPlan(
  localData: GedcomData,
  peerData: GedcomData,
  plan: BranchImportPlan,
): BranchImportApplyResult {
  const next = cloneData(localData);
  dedupeFamiliesBySymmetricPartnership(next);
  const usedIndividuals = new Set(Object.keys(next.individuals));
  const usedFamilies = new Set(Object.keys(next.families));
  const peerToLocal = new Map<string, string>();
  const importedIndividualIds: string[] = [];
  const mergedIndividualIds: string[] = [];
  const importedFamilyIds: string[] = [];

  for (const item of plan.items) {
    if (item.action !== 'create' && item.action !== 'merge') continue;
    const peer = peerData.individuals[item.peerId];
    if (!peer) continue;
    if (item.action === 'merge') {
      const localId = item.localId;
      if (!localId || !next.individuals[localId]) continue;
      if (localId.startsWith(PEER_COMPARE_ID_PREFIX)) continue;
      next.individuals[localId] = mergePeerIndividualIntoLocal(next.individuals[localId], peer);
      peerToLocal.set(item.peerId, localId);
      mergedIndividualIds.push(localId);
      continue;
    }
    const localId = allocateLocalIndividualId(item.peerId, usedIndividuals);
    next.individuals[localId] = {
      ...peer,
      id: localId,
      source: 'imported',
      familyChildId: undefined,
      familySpouseIds: undefined,
    };
    peerToLocal.set(item.peerId, localId);
    importedIndividualIds.push(localId);
  }

  const famPeerToLocal = new Map<string, string>();
  for (const fam of Object.values(peerData.families)) {
    const members = [fam.husbandId, fam.wifeId, ...(fam.childrenIds ?? [])].filter(
      (x): x is string => !!x,
    );
    if (members.length === 0 || !members.every((id) => peerToLocal.has(id))) continue;
    const mappedH = fam.husbandId ? peerToLocal.get(fam.husbandId) : undefined;
    const mappedW = fam.wifeId ? peerToLocal.get(fam.wifeId) : undefined;
    const mappedChildren = fam.childrenIds
      .map((id) => peerToLocal.get(id))
      .filter((id): id is string => !!id);
    const existingFamId = findExistingFamilyIdByParentPair(next, mappedH, mappedW);
    if (existingFamId) {
      famPeerToLocal.set(fam.id, existingFamId);
      const ex = next.families[existingFamId];
      if (ex) {
        const mergedChildren = unionChildIds(ex.childrenIds ?? [], mappedChildren);
        next.families[existingFamId] = {
          ...ex,
          childrenIds: mergedChildren,
          marriageDate: ex.marriageDate ?? fam.marriageDate,
        };
      }
      continue;
    }
    const localFamId = allocateLocalFamilyId(fam.id, usedFamilies);
    famPeerToLocal.set(fam.id, localFamId);
    const mappedFamily: Family = {
      ...fam,
      id: localFamId,
      husbandId: mappedH,
      wifeId: mappedW,
      childrenIds: mappedChildren,
    };
    next.families[localFamId] = mappedFamily;
    importedFamilyIds.push(localFamId);
  }

  /** Liens FAMC / FAMS : toutes les fiches mappées (créées ou fusionnées), alignées sur le graphe pair importé. */
  for (const [peerId, localId] of peerToLocal) {
    const peer = peerData.individuals[peerId];
    if (!peer || !next.individuals[localId]) continue;
    const cur = next.individuals[localId];
    let familyChildId = cur.familyChildId;
    let familySpouseIds = cur.familySpouseIds;
    if (peer.familyChildId) {
      const mappedFc = famPeerToLocal.get(peer.familyChildId);
      if (mappedFc) familyChildId = mappedFc;
    }
    if (peer.familySpouseIds?.length) {
      const mappedFs = peer.familySpouseIds
        .map((fid) => famPeerToLocal.get(fid))
        .filter((x): x is string => typeof x === 'string');
      const prior = cur.familySpouseIds ?? [];
      if (mappedFs.length) {
        familySpouseIds = [...new Set([...prior, ...mappedFs])];
      }
    }
    next.individuals[localId] = {
      ...cur,
      familyChildId,
      familySpouseIds,
    };
  }

  dedupeFamiliesBySymmetricPartnership(next);

  return {
    data: next,
    importedIndividualIds,
    mergedIndividualIds,
    importedFamilyIds,
  };
}

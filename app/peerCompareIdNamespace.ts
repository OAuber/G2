import type { GedcomData, Family, Individual } from '../types';
import type { IndividualDocument } from './p2pAppTypes';
import { normalizeDocumentsByIndividual } from './normalizeDocuments';

/**
 * Préfixe stable pour éviter les collisions d'xref GEDCOM (@I1@, @F1@) entre l'arbre local
 * et l'arbre pair affiché en mode comparateur (sinon les médias indexés par id se mélangent).
 */
export const PEER_COMPARE_ID_PREFIX = 'pc:';

/** True si la chaîne ressemble à une xref GEDCOM standard (@I1@, @F12@, etc.). */
export function isLikelyGedcomXref(s: string): boolean {
  return /^@[^@]+@$/.test(s);
}

/** Mappe un id « fil » reçu du pair vers l'id interne utilisé dans peerCompareGedcom (idempotent). */
export function wireIndividualIdToPeerCompareId(wireId: string): string {
  if (wireId.startsWith(PEER_COMPARE_ID_PREFIX)) return wireId;
  return `${PEER_COMPARE_ID_PREFIX}${wireId}`;
}

/**
 * Recopie le GEDCOM entrant avec des ids préfixés et des références réécrites,
 * pour qu'il ne partage plus les mêmes clés que le gedcom local.
 */
export function namespacePeerCompareGedcom(data: GedcomData): GedcomData {
  const mapRef = (id?: string) => (id ? wireIndividualIdToPeerCompareId(id) : undefined);
  const individuals: Record<string, Individual> = {};
  for (const [oldId, ind] of Object.entries(data.individuals)) {
    const newId = wireIndividualIdToPeerCompareId(oldId);
    individuals[newId] = {
      ...ind,
      id: newId,
      familyChildId: mapRef(ind.familyChildId),
      familySpouseIds: ind.familySpouseIds?.map((fid) => wireIndividualIdToPeerCompareId(fid)),
    };
  }
  const families: Record<string, Family> = {};
  for (const [oldId, fam] of Object.entries(data.families)) {
    const newId = wireIndividualIdToPeerCompareId(oldId);
    families[newId] = {
      ...fam,
      id: newId,
      husbandId: mapRef(fam.husbandId),
      wifeId: mapRef(fam.wifeId),
      childrenIds: fam.childrenIds.map((cid) => wireIndividualIdToPeerCompareId(cid)),
    };
  }
  return { individuals, families };
}

/** Remappe les champs d'un doc média entrant (ids de groupe / xrefs) avant fusion dans peerCompareDocuments. */
export function remapWireMediaDocForPeerCompare(doc: unknown): unknown {
  if (!doc || typeof doc !== 'object') return doc;
  const r = { ...(doc as Record<string, unknown>) };
  if (typeof r.groupPhotoOriginIndividualId === 'string' && isLikelyGedcomXref(r.groupPhotoOriginIndividualId)) {
    r.groupPhotoOriginIndividualId = wireIndividualIdToPeerCompareId(r.groupPhotoOriginIndividualId);
  }
  if (typeof r.groupPhotoLinkId === 'string' && isLikelyGedcomXref(r.groupPhotoLinkId)) {
    r.groupPhotoLinkId = wireIndividualIdToPeerCompareId(r.groupPhotoLinkId);
  }
  if (Array.isArray(r.groupPhotoParticipantIds)) {
    r.groupPhotoParticipantIds = (r.groupPhotoParticipantIds as unknown[]).map((x) =>
      typeof x === 'string' && isLikelyGedcomXref(x) ? wireIndividualIdToPeerCompareId(x) : x,
    );
  }
  return r;
}

function remapWireDocumentsPayloadKeys(
  raw: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [wireKey, docs] of Object.entries(raw)) {
    out[wireIndividualIdToPeerCompareId(wireKey)] = docs;
  }
  return out;
}

/**
 * Normalise les documents reçus du pair : clés d'individus fil → ids internes `pc:`,
 * puis normalisation habituelle par rapport aux individus du gedcom pair namespacé.
 */
export function normalizePeerCompareDocumentsFromWire(
  wirePayload: Record<string, unknown> | undefined,
  namespacedPeerIndividuals: Record<string, Individual>,
): Record<string, IndividualDocument[]> {
  const keyRemapped = remapWireDocumentsPayloadKeys(wirePayload);
  const withDocRefs: Record<string, unknown> = {};
  for (const [peerKey, arr] of Object.entries(keyRemapped)) {
    if (!Array.isArray(arr)) continue;
    withDocRefs[peerKey] = arr.map((raw) => remapWireMediaDocForPeerCompare(raw));
  }
  return normalizeDocumentsByIndividual(withDocRefs, namespacedPeerIndividuals);
}

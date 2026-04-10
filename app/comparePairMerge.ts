import type { DateInfo, GedcomData, Individual } from '../types';
import { Gender } from '../types';
import type { IndividualDocument } from './p2pAppTypes';
import { PEER_COMPARE_ID_PREFIX } from './peerCompareIdNamespace';

/** Une fiche locale (sans préfixe) et une fiche pair (`pc:`). */
export function resolveComparePairLocalAndPeer(
  anchorId: string,
  pairId: string,
): { localId: string; peerPcId: string } | null {
  const aPeer = anchorId.startsWith(PEER_COMPARE_ID_PREFIX);
  const bPeer = pairId.startsWith(PEER_COMPARE_ID_PREFIX);
  if (aPeer === bPeer) return null;
  if (aPeer) return { localId: pairId, peerPcId: anchorId };
  return { localId: anchorId, peerPcId: pairId };
}

/** Prochain id `@I…@` disponible (même logique que la création manuelle dans l’app). */
export function getNextIndividualId(data: GedcomData): string {
  const keys = Object.keys(data.individuals);
  let maxId = 0;
  for (const k of keys) {
    const match = k.match(/\d+/);
    if (match) maxId = Math.max(maxId, parseInt(match[0], 10));
  }
  return `@I${maxId + 1}@`;
}

/** Coquille vide pour fusionner une fiche pair en **nouvel** individu local (sans doublon préexistant). */
export function emptyIndividualShellForPeerImport(id: string): Individual {
  return {
    id,
    name: ' /',
    givenName: '',
    surname: '',
    gender: Gender.Unknown,
    familySpouseIds: [],
    generation: 0,
  };
}

function strEmpty(s: string | undefined): boolean {
  return !s?.trim();
}

function dateEmpty(d: DateInfo | undefined): boolean {
  if (!d) return true;
  if (d.year != null) return false;
  return !d.raw?.trim();
}

function mergeNotes(a: string | undefined, b: string | undefined): string | undefined {
  const ta = a?.trim();
  const tb = b?.trim();
  if (!ta) return tb || undefined;
  if (!tb) return ta;
  if (ta.includes(tb) || tb.includes(ta)) return ta;
  return `${ta}\n\n— ${tb}`;
}

/**
 * Complète la fiche locale avec les champs encore vides à partir du pair (priorité au local).
 */
export function mergePeerIndividualIntoLocal(local: Individual, peer: Individual): Individual {
  const givenName = strEmpty(local.givenName) ? peer.givenName : local.givenName;
  const surname = strEmpty(local.surname) ? peer.surname : local.surname;
  return {
    ...local,
    givenName,
    surname,
    name: `${givenName} /${surname}/`,
    gender:
      local.gender === Gender.Unknown && peer.gender !== Gender.Unknown ? peer.gender : local.gender,
    birthDate: dateEmpty(local.birthDate) ? peer.birthDate : local.birthDate,
    deathDate: dateEmpty(local.deathDate) ? peer.deathDate : local.deathDate,
    birthPlace: strEmpty(local.birthPlace) ? peer.birthPlace : local.birthPlace,
    deathPlace: strEmpty(local.deathPlace) ? peer.deathPlace : local.deathPlace,
    notes: mergeNotes(local.notes, peer.notes),
  };
}

function newMergedDocId(originalId: string, index: number): string {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${index}`;
  return `${originalId}-merge-${suffix}`;
}

/** Copie les pièces du pair vers la fiche locale (nouveaux ids, références `pc:` → id local si besoin). */
export function clonePeerDocumentsForLocalMerge(
  peerDocs: IndividualDocument[],
  peerPcId: string,
  localId: string,
  existingLocalDocs: IndividualDocument[],
): IndividualDocument[] {
  const hadLocalPrimary = existingLocalDocs.some((d) => d.kind === 'photo' && d.isPrimaryPhoto);
  const copies = peerDocs.map((d, i) => {
    const id = newMergedDocId(d.id || 'doc', i);
    const next: IndividualDocument = {
      ...d,
      id,
      isPrimaryPhoto: false,
      groupPhotoOriginIndividualId:
        d.groupPhotoOriginIndividualId === peerPcId ? localId : d.groupPhotoOriginIndividualId,
      groupPhotoParticipantIds: d.groupPhotoParticipantIds?.map((pid) =>
        pid === peerPcId ? localId : pid,
      ),
    };
    return next;
  });
  if (!hadLocalPrimary) {
    const firstPhoto = copies.find(
      (d) => d.kind === 'photo' || /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(d.url),
    );
    if (firstPhoto) firstPhoto.isPrimaryPhoto = true;
  }
  return copies;
}

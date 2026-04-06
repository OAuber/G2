import type { GedcomData, P2PMode } from '../types';
import type { IndividualDocument, P2PVisibilitySettings } from './p2pAppTypes';
import { namespacePeerCompareGedcom, normalizePeerCompareDocumentsFromWire } from './peerCompareIdNamespace';

/** Politique d’import des médias pair (client lit la politique hôte distante, hôte lit ses réglages). */
export function peerCompareInboundAllowDocuments(
  p2pMode: P2PMode | null,
  remoteAccessPolicy: P2PVisibilitySettings | null,
  visibilitySettings: P2PVisibilitySettings,
): boolean {
  return p2pMode === 'client'
    ? (remoteAccessPolicy?.allowDocuments ?? true)
    : visibilitySettings.allowDocuments;
}

/**
 * GEDCOM fil + documents fil → snapshot pair namespacé (`pc:`) et map médias alignée.
 */
export function buildPeerCompareSnapshot(
  incomingWireGedcom: GedcomData,
  wireDocumentsByIndividualId: Record<string, unknown> | undefined,
  allowDocumentsInbound: boolean,
): {
  namespacedPeer: GedcomData;
  documents: Record<string, IndividualDocument[]>;
} {
  const namespacedPeer = namespacePeerCompareGedcom(incomingWireGedcom);
  if (
    !allowDocumentsInbound ||
    !wireDocumentsByIndividualId ||
    typeof wireDocumentsByIndividualId !== 'object' ||
    Object.keys(wireDocumentsByIndividualId).length === 0
  ) {
    return { namespacedPeer, documents: {} };
  }
  return {
    namespacedPeer,
    documents: normalizePeerCompareDocumentsFromWire(
      wireDocumentsByIndividualId,
      namespacedPeer.individuals,
    ),
  };
}

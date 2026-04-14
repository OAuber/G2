/**
 * Prévision WoT (mémo § 5.6) — emprunts signés et horodatés.
 * Choix : horodatage UTC ISO ; signature avec **clé publique** JWK + **nom d’affichage** pour la provenance humaine.
 */

export type WotBorrowRecordV1 = {
  version: 1;
  /** ISO 8601 UTC */
  issuedAt: string;
  borrowerDisplayName: string;
  borrowerPublicKeyJwk: JsonWebKey;
  /** Empreinte du contenu emprunté (ex. SHA-256 hex du fragment canonicalisé). */
  contentDigest: string;
  /** Référence optionnelle à l’invitation / manifeste source. */
  inviteId?: string;
};

/** Placeholder pour intégration crypto (WebCrypto, courbe à aligner sur l’identité appareil). */
export function createWotBorrowRecordStub(
  partial: Omit<WotBorrowRecordV1, 'version' | 'issuedAt'> & { issuedAt?: string },
): WotBorrowRecordV1 {
  return {
    version: 1,
    issuedAt: partial.issuedAt ?? new Date().toISOString(),
    borrowerDisplayName: partial.borrowerDisplayName,
    borrowerPublicKeyJwk: partial.borrowerPublicKeyJwk,
    contentDigest: partial.contentDigest,
    ...(partial.inviteId ? { inviteId: partial.inviteId } : {}),
  };
}

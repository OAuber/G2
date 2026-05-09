/**
 * Domaine identité / confiance / WoT node (v1).
 * Axes séparés : session P2P, identité utilisateur, confiance pair, vie individuelle, rôle node.
 */

import type { SelfIdentityPublic } from '../../types';

/** Lien social ou généalogique perçu avec un pair. */
export type PeerRelationStatus = 'kinKnown' | 'nonKinKnown' | 'kinUnknownYet';

/** Type de certification émise (v1 logique ; v2 signatures). */
export type CertificationKind = 'relationshipCertification' | 'personhoodCertification';

/** Cycle de vie du rôle WoT « node » (publication temporaire d’un périmètre ancêtres). */
export type WotNodeRuntimeStatus = 'inactive' | 'eligible' | 'active' | 'expired' | 'revoked';

/** Identité utilisateur côté appareil (hors session P2P). */
export type UserIdentityAxisStatus = 'anonymous' | 'claimed' | 'witnessed';

/** Confiance mutuelle avec un pair (vue agrégée locale). */
export type PeerTrustAxisStatus =
  | 'uncertified'
  | 'certifiedByMe'
  | 'certifiedByPeer'
  | 'mutualCertified';

/** Statut de vie d’une fiche (GEDCOM + attestations futures). */
export type IndividualLifeAxisStatus = 'deceasedConfirmed' | 'livingPossible' | 'livingCertified' | 'unknown';

export interface PeerTrustRecordV1 {
  peerId: string;
  label: string;
  claimedAt?: string;
  /** Certifications directionnelles (héritage booléen + kind v1). */
  certifiedByMe: boolean;
  certificationKindByMe?: CertificationKind;
  certifiedByPeer: boolean;
  certificationKindByPeer?: CertificationKind;
  certifiedAtByMe?: string;
  certifiedAtByPeer?: string;
}

export interface PeerRelationRecordV1 {
  peerId: string;
  relationStatus: PeerRelationStatus;
  /** Individu revendiqué côté pair si connu (pour heuristique parenté). */
  remoteClaimedIndividualId?: string;
  updatedAt?: string;
}

export interface WotNodeAnnouncementV1 {
  active: boolean;
  rootIndividualId: string;
  maxGenUp: number;
  issuedAt: string;
  expiresAt: string;
  revokedAt?: string;
}

export interface NodeEligibilityResult {
  eligible: boolean;
  requiredCount: number;
  effectivePersonhoodMajority: boolean;
  reasonKey:
    | 'ok'
    | 'not_claimed'
    | 'insufficient_certifications'
    | 'no_gedcom'
    | 'invalid_root'
    | 'deceased_root';
  personhoodCount: number;
  relationshipCount: number;
  totalDirectedCerts: number;
}

export interface ResolveUserIdentityAxisInput {
  selfIdentity: SelfIdentityPublic | null;
}

export interface ResolvePeerTrustAxisInput {
  certifiedByMe: boolean;
  certifiedByPeer: boolean;
}

export interface ResolveIndividualLifeAxisInput {
  hasExplicitDeathYear: boolean;
  livingCertified?: boolean;
}

export interface ResolveWotNodeStatusInput {
  announcement: WotNodeAnnouncementV1 | null;
  eligibility: NodeEligibilityResult;
  nowMs: number;
}

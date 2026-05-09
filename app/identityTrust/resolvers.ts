import type { GedcomData } from '../../types';
import { WOT_NODE_CONFIG_V1 } from './config';
import type {
  IndividualLifeAxisStatus,
  NodeEligibilityResult,
  PeerRelationStatus,
  PeerTrustAxisStatus,
  PeerTrustRecordV1,
  ResolveIndividualLifeAxisInput,
  ResolvePeerTrustAxisInput,
  ResolveUserIdentityAxisInput,
  ResolveWotNodeStatusInput,
  UserIdentityAxisStatus,
  WotNodeAnnouncementV1,
  WotNodeRuntimeStatus,
} from './types';
import { isProbablyLivingForUi } from '../individualLiving';

export function resolveUserIdentityAxisStatus(input: ResolveUserIdentityAxisInput): UserIdentityAxisStatus {
  const s = input.selfIdentity;
  if (!s || s.status === 'unidentified') return 'anonymous';
  if (s.status === 'witnessed') return 'witnessed';
  if (s.status === 'claimed') return 'claimed';
  return 'anonymous';
}

export function resolvePeerTrustAxisStatus(input: ResolvePeerTrustAxisInput): PeerTrustAxisStatus {
  const { certifiedByMe, certifiedByPeer } = input;
  if (certifiedByMe && certifiedByPeer) return 'mutualCertified';
  if (certifiedByMe) return 'certifiedByMe';
  if (certifiedByPeer) return 'certifiedByPeer';
  return 'uncertified';
}

export function resolveIndividualLifeAxisStatus(input: ResolveIndividualLifeAxisInput): IndividualLifeAxisStatus {
  if (input.livingCertified) return 'livingCertified';
  if (input.hasExplicitDeathYear) return 'deceasedConfirmed';
  return 'livingPossible';
}

/**
 * Heuristique : pair « non apparenté » si la fiche revendiquée n’a pas de lien parent
 * dans le GEDCOM courant (pas de familyChildId).
 */
export function inferPeerRelationFromGedcom(
  gedcom: GedcomData | null,
  remoteClaimedIndividualId: string | null | undefined,
): PeerRelationStatus {
  if (!gedcom || !remoteClaimedIndividualId) return 'kinUnknownYet';
  const indi = gedcom.individuals[remoteClaimedIndividualId];
  if (!indi) return 'kinUnknownYet';
  if (indi.familyChildId) return 'kinKnown';
  return 'nonKinKnown';
}

/**
 * Compte les certifications « dirigées » (chaque direction compte pour le seuil node).
 * Option B : si part personhood >= threshold parmi les certifications présentes, seuil = nodeMinCertificationsNonKin.
 */
export function computeNodeEligibility(input: {
  trustByPeer: Record<string, PeerTrustRecordV1>;
  selfIdentityClaimed: boolean;
  gedcom: GedcomData | null;
  selfIndividualId: string | null;
}): NodeEligibilityResult {
  const { trustByPeer, selfIdentityClaimed, gedcom, selfIndividualId } = input;
  if (!selfIdentityClaimed) {
    return {
      eligible: false,
      requiredCount: WOT_NODE_CONFIG_V1.nodeMinCertifications,
      effectivePersonhoodMajority: false,
      reasonKey: 'not_claimed',
      personhoodCount: 0,
      relationshipCount: 0,
      totalDirectedCerts: 0,
    };
  }
  if (!gedcom || !selfIndividualId || !gedcom.individuals[selfIndividualId]) {
    return {
      eligible: false,
      requiredCount: WOT_NODE_CONFIG_V1.nodeMinCertifications,
      effectivePersonhoodMajority: false,
      reasonKey: 'no_gedcom',
      personhoodCount: 0,
      relationshipCount: 0,
      totalDirectedCerts: 0,
    };
  }
  const rootLiving = isProbablyLivingForUi(selfIndividualId, gedcom, null);
  const explicitDeath = (() => {
    const indi = gedcom.individuals[selfIndividualId];
    const d = indi?.deathDate;
    return !!(d?.year && d.isCalculated !== true);
  })();
  if (!rootLiving || explicitDeath) {
    return {
      eligible: false,
      requiredCount: WOT_NODE_CONFIG_V1.nodeMinCertifications,
      effectivePersonhoodMajority: false,
      reasonKey: 'deceased_root',
      personhoodCount: 0,
      relationshipCount: 0,
      totalDirectedCerts: 0,
    };
  }

  let personhood = 0;
  let relationship = 0;
  let total = 0;
  for (const rec of Object.values(trustByPeer)) {
    if (rec.certifiedByMe) {
      total += 1;
      const k = rec.certificationKindByMe ?? 'personhoodCertification';
      if (k === 'personhoodCertification') personhood += 1;
      else relationship += 1;
    }
    if (rec.certifiedByPeer) {
      total += 1;
      const k = rec.certificationKindByPeer ?? 'personhoodCertification';
      if (k === 'personhoodCertification') personhood += 1;
      else relationship += 1;
    }
  }

  const withKind = personhood + relationship;
  const personhoodShare = withKind > 0 ? personhood / withKind : 0;
  const effectivePersonhoodMajority =
    withKind > 0 && personhoodShare >= WOT_NODE_CONFIG_V1.nonKinMajorityThreshold;
  const requiredCount = effectivePersonhoodMajority
    ? WOT_NODE_CONFIG_V1.nodeMinCertificationsNonKin
    : WOT_NODE_CONFIG_V1.nodeMinCertifications;

  if (total < requiredCount) {
    return {
      eligible: false,
      requiredCount,
      effectivePersonhoodMajority,
      reasonKey: 'insufficient_certifications',
      personhoodCount: personhood,
      relationshipCount: relationship,
      totalDirectedCerts: total,
    };
  }

  return {
    eligible: true,
    requiredCount,
    effectivePersonhoodMajority,
    reasonKey: 'ok',
    personhoodCount: personhood,
    relationshipCount: relationship,
    totalDirectedCerts: total,
  };
}

export function resolveWotNodeRuntimeStatus(input: ResolveWotNodeStatusInput): WotNodeRuntimeStatus {
  const { announcement, eligibility, nowMs } = input;
  if (!announcement || !announcement.active) {
    if (eligibility.eligible) return 'eligible';
    return 'inactive';
  }
  if (announcement.revokedAt) return 'revoked';
  if (Date.parse(announcement.expiresAt) <= nowMs) return 'expired';
  return 'active';
}

export function validateNodeRoot(
  gedcom: GedcomData | null,
  rootIndividualId: string,
): { ok: true } | { ok: false; reasonKey: 'no_gedcom' | 'invalid_root' | 'deceased_root' } {
  if (!gedcom?.individuals[rootIndividualId]) return { ok: false, reasonKey: 'invalid_root' };
  const explicitDeath = (() => {
    const indi = gedcom.individuals[rootIndividualId];
    const d = indi?.deathDate;
    return !!(d?.year && d.isCalculated !== true);
  })();
  if (explicitDeath) return { ok: false, reasonKey: 'deceased_root' };
  if (!isProbablyLivingForUi(rootIndividualId, gedcom, null)) return { ok: false, reasonKey: 'deceased_root' };
  return { ok: true };
}

export function buildNodeAnnouncement(params: {
  rootIndividualId: string;
  maxGenUp: number;
  ttlMs: number;
  nowMs: number;
}): WotNodeAnnouncementV1 {
  const issuedAt = new Date(params.nowMs).toISOString();
  const expiresAt = new Date(params.nowMs + params.ttlMs).toISOString();
  return {
    active: true,
    rootIndividualId: params.rootIndividualId,
    maxGenUp: params.maxGenUp,
    issuedAt,
    expiresAt,
  };
}

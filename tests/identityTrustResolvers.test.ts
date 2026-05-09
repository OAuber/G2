import { describe, expect, it } from 'vitest';
import type { GedcomData } from '../types';
import { Gender } from '../types';
import {
  computeNodeEligibility,
  inferPeerRelationFromGedcom,
  resolvePeerTrustAxisStatus,
  resolveUserIdentityAxisStatus,
  resolveWotNodeRuntimeStatus,
} from '../app/identityTrust/resolvers';
import type { PeerTrustRecordV1, WotNodeAnnouncementV1 } from '../app/identityTrust/types';

describe('resolveUserIdentityAxisStatus', () => {
  it('anonymous sans identité', () => {
    expect(resolveUserIdentityAxisStatus({ selfIdentity: null })).toBe('anonymous');
  });
  it('anonymous si unidentified', () => {
    expect(
      resolveUserIdentityAxisStatus({
        selfIdentity: {
          individualId: '@I1@',
          status: 'unidentified',
          claimedAt: '',
          deviceKeyId: 'k',
          devicePublicKeyJwk: { kty: 'EC' } as JsonWebKey,
        },
      }),
    ).toBe('anonymous');
  });
});

describe('resolvePeerTrustAxisStatus', () => {
  it('mutual', () => {
    expect(resolvePeerTrustAxisStatus({ certifiedByMe: true, certifiedByPeer: true })).toBe('mutualCertified');
  });
  it('uncertified', () => {
    expect(resolvePeerTrustAxisStatus({ certifiedByMe: false, certifiedByPeer: false })).toBe('uncertified');
  });
});

describe('inferPeerRelationFromGedcom', () => {
  it('kinKnown si FAMC', () => {
    const g: GedcomData = {
      individuals: {
        '@I1@': {
          id: '@I1@',
          name: 'A',
          surname: '',
          givenName: '',
          gender: Gender.Unknown,
          familyChildId: '@F1@',
        },
      },
      families: { '@F1@': { id: '@F1@', childrenIds: ['@I1@'] } },
    };
    expect(inferPeerRelationFromGedcom(g, '@I1@')).toBe('kinKnown');
  });
  it('nonKinKnown sans FAMC', () => {
    const g: GedcomData = {
      individuals: {
        '@I1@': { id: '@I1@', name: 'A', surname: '', givenName: '', gender: Gender.Unknown },
      },
      families: {},
    };
    expect(inferPeerRelationFromGedcom(g, '@I1@')).toBe('nonKinKnown');
  });
});

describe('computeNodeEligibility (Option B)', () => {
  const livingRoot = '@IROOT@';
  const gedcom: GedcomData = {
    individuals: {
      [livingRoot]: {
        id: livingRoot,
        name: 'Me',
        surname: 'X',
        givenName: 'Y',
        gender: Gender.Male,
        birthDate: { raw: '1990', year: 1990 },
      },
    },
    families: {},
  };

  /** Deux directions en « parenté » → pas de majorité personhood, seuil global = 1. */
  const oneRelationshipCert = (peer: string): Record<string, PeerTrustRecordV1> => ({
    [peer]: {
      peerId: peer,
      label: peer,
      certifiedByMe: true,
      certificationKindByMe: 'relationshipCertification',
      certifiedByPeer: true,
      certificationKindByPeer: 'relationshipCertification',
    },
  });

  it('refuse si non revendiqué', () => {
    const r = computeNodeEligibility({
      trustByPeer: oneRelationshipCert('p'),
      selfIdentityClaimed: false,
      gedcom,
      selfIndividualId: livingRoot,
    });
    expect(r.eligible).toBe(false);
    expect(r.reasonKey).toBe('not_claimed');
  });

  it('ok avec certifications parenté des deux côtés (seuil 1)', () => {
    const r = computeNodeEligibility({
      trustByPeer: oneRelationshipCert('p'),
      selfIdentityClaimed: true,
      gedcom,
      selfIndividualId: livingRoot,
    });
    expect(r.eligible).toBe(true);
    expect(r.requiredCount).toBe(1);
  });

  it('majorité personhood → seuil 2', () => {
    const trust: Record<string, PeerTrustRecordV1> = {
      a: {
        peerId: 'a',
        label: 'a',
        certifiedByMe: true,
        certificationKindByMe: 'personhoodCertification',
        certifiedByPeer: false,
      },
      b: {
        peerId: 'b',
        label: 'b',
        certifiedByMe: true,
        certificationKindByMe: 'personhoodCertification',
        certifiedByPeer: false,
      },
    };
    const r = computeNodeEligibility({
      trustByPeer: trust,
      selfIdentityClaimed: true,
      gedcom,
      selfIndividualId: livingRoot,
    });
    expect(r.effectivePersonhoodMajority).toBe(true);
    expect(r.requiredCount).toBe(2);
    expect(r.eligible).toBe(true);
    expect(r.totalDirectedCerts).toBe(2);
  });

  it('insuffisant si majorité personhood mais une seule certif', () => {
    const trust: Record<string, PeerTrustRecordV1> = {
      a: {
        peerId: 'a',
        label: 'a',
        certifiedByMe: true,
        certificationKindByMe: 'personhoodCertification',
        certifiedByPeer: false,
      },
    };
    const r = computeNodeEligibility({
      trustByPeer: trust,
      selfIdentityClaimed: true,
      gedcom,
      selfIndividualId: livingRoot,
    });
    expect(r.requiredCount).toBe(2);
    expect(r.eligible).toBe(false);
    expect(r.reasonKey).toBe('insufficient_certifications');
  });
});

describe('resolveWotNodeRuntimeStatus', () => {
  const eligOk = computeNodeEligibility({
    trustByPeer: {
      p: {
        peerId: 'p',
        label: 'p',
        certifiedByMe: true,
        certificationKindByMe: 'personhoodCertification',
        certifiedByPeer: true,
        certificationKindByPeer: 'personhoodCertification',
      },
    },
    selfIdentityClaimed: true,
    gedcom: {
      individuals: {
        '@R@': {
          id: '@R@',
          name: '',
          surname: '',
          givenName: '',
          gender: Gender.Male,
          birthDate: { raw: '1980', year: 1980 },
        },
      },
      families: {},
    },
    selfIndividualId: '@R@',
  });

  it('eligible sans annonce', () => {
    expect(
      resolveWotNodeRuntimeStatus({
        announcement: null,
        eligibility: eligOk,
        nowMs: Date.now(),
      }),
    ).toBe('eligible');
  });

  it('active', () => {
    const ann: WotNodeAnnouncementV1 = {
      active: true,
      rootIndividualId: '@R@',
      maxGenUp: 3,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    expect(
      resolveWotNodeRuntimeStatus({
        announcement: ann,
        eligibility: eligOk,
        nowMs: Date.now(),
      }),
    ).toBe('active');
  });

  it('expired', () => {
    const ann: WotNodeAnnouncementV1 = {
      active: true,
      rootIndividualId: '@R@',
      maxGenUp: 3,
      issuedAt: new Date(Date.now() - 120_000).toISOString(),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    };
    expect(
      resolveWotNodeRuntimeStatus({
        announcement: ann,
        eligibility: eligOk,
        nowMs: Date.now(),
      }),
    ).toBe('expired');
  });
});

import {
  PEER_RELATIONS_STORAGE_KEY,
  PEER_TRUST_STORAGE_KEY,
  WOT_NODE_ANNOUNCEMENT_STORAGE_KEY,
} from '../storageKeys';
import type { PeerRelationRecordV1, PeerTrustRecordV1, WotNodeAnnouncementV1 } from './types';

type LegacyPeerIdentityV1 = {
  label?: string;
  claimedAt?: string;
  certifiedByMe?: boolean;
  certifiedByPeer?: boolean;
};

export interface IdentityTrustBootstrap {
  peerTrust: Record<string, PeerTrustRecordV1>;
  peerRelations: Record<string, PeerRelationRecordV1>;
  wotNode: WotNodeAnnouncementV1 | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function normalizePeerTrustRecord(peerId: string, raw: unknown): PeerTrustRecordV1 | null {
  if (!isRecord(raw)) return null;
  const label = typeof raw.label === 'string' ? raw.label : peerId;
  const certifiedByMe = raw.certifiedByMe === true;
  const certifiedByPeer = raw.certifiedByPeer === true;
  const kindMe =
    raw.certificationKindByMe === 'relationshipCertification'
      ? 'relationshipCertification'
      : certifiedByMe
        ? 'personhoodCertification'
        : undefined;
  const kindPeer =
    raw.certificationKindByPeer === 'relationshipCertification'
      ? 'relationshipCertification'
      : certifiedByPeer
        ? 'personhoodCertification'
        : undefined;
  return {
    peerId,
    label,
    claimedAt: typeof raw.claimedAt === 'string' ? raw.claimedAt : undefined,
    certifiedByMe,
    certifiedByPeer,
    certificationKindByMe: kindMe,
    certificationKindByPeer: kindPeer,
    certifiedAtByMe: typeof raw.certifiedAtByMe === 'string' ? raw.certifiedAtByMe : undefined,
    certifiedAtByPeer: typeof raw.certifiedAtByPeer === 'string' ? raw.certifiedAtByPeer : undefined,
  };
}

function migrateFromLegacyKnownPeers(): Record<string, PeerTrustRecordV1> {
  try {
    const raw = localStorage.getItem('knownPeerIdentities.v1');
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, LegacyPeerIdentityV1>;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, PeerTrustRecordV1> = {};
    for (const [peerId, info] of Object.entries(parsed)) {
      if (!info || typeof info !== 'object') continue;
      out[peerId] = {
        peerId,
        label: typeof info.label === 'string' ? info.label : peerId,
        claimedAt: typeof info.claimedAt === 'string' ? info.claimedAt : undefined,
        certifiedByMe: info.certifiedByMe === true,
        certifiedByPeer: info.certifiedByPeer === true,
        certificationKindByMe: 'personhoodCertification',
        certificationKindByPeer: 'personhoodCertification',
      };
    }
    return out;
  } catch {
    return {};
  }
}

function parsePeerTrustMap(raw: string): Record<string, PeerTrustRecordV1> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    const out: Record<string, PeerTrustRecordV1> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const rec = normalizePeerTrustRecord(k, v);
      if (rec) out[k] = rec;
    }
    return out;
  } catch {
    return null;
  }
}

function parsePeerRelationsMap(raw: string): Record<string, PeerRelationRecordV1> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    const out: Record<string, PeerRelationRecordV1> = {};
    for (const [peerId, v] of Object.entries(parsed)) {
      if (!isRecord(v)) continue;
      const rs = v.relationStatus;
      if (rs !== 'kinKnown' && rs !== 'nonKinKnown' && rs !== 'kinUnknownYet') continue;
      out[peerId] = {
        peerId,
        relationStatus: rs,
        remoteClaimedIndividualId:
          typeof v.remoteClaimedIndividualId === 'string' ? v.remoteClaimedIndividualId : undefined,
        updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : undefined,
      };
    }
    return out;
  } catch {
    return null;
  }
}

function parseWotNode(raw: string): WotNodeAnnouncementV1 | null {
  try {
    const v = JSON.parse(raw) as unknown;
    if (!isRecord(v)) return null;
    if (v.active !== true && v.active !== false) return null;
    if (typeof v.rootIndividualId !== 'string' || typeof v.expiresAt !== 'string') return null;
    if (typeof v.issuedAt !== 'string') return null;
    if (typeof v.maxGenUp !== 'number' || Number.isNaN(v.maxGenUp)) return null;
    return {
      active: v.active === true,
      rootIndividualId: v.rootIndividualId,
      maxGenUp: v.maxGenUp,
      issuedAt: v.issuedAt,
      expiresAt: v.expiresAt,
      revokedAt: typeof v.revokedAt === 'string' ? v.revokedAt : undefined,
    };
  } catch {
    return null;
  }
}

export function loadIdentityTrustBootstrap(): IdentityTrustBootstrap {
  let peerTrust: Record<string, PeerTrustRecordV1> = {};
  try {
    const v2 = localStorage.getItem(PEER_TRUST_STORAGE_KEY);
    if (v2) {
      const parsed = parsePeerTrustMap(v2);
      if (parsed && Object.keys(parsed).length > 0) peerTrust = parsed;
    }
  } catch {
    peerTrust = {};
  }
  if (Object.keys(peerTrust).length === 0) {
    peerTrust = migrateFromLegacyKnownPeers();
  }

  let peerRelations: Record<string, PeerRelationRecordV1> = {};
  try {
    const pr = localStorage.getItem(PEER_RELATIONS_STORAGE_KEY);
    if (pr) {
      const parsed = parsePeerRelationsMap(pr);
      if (parsed) peerRelations = parsed;
    }
  } catch {
    peerRelations = {};
  }

  let wotNode: WotNodeAnnouncementV1 | null = null;
  try {
    const w = localStorage.getItem(WOT_NODE_ANNOUNCEMENT_STORAGE_KEY);
    if (w) wotNode = parseWotNode(w);
  } catch {
    wotNode = null;
  }

  return { peerTrust, peerRelations, wotNode };
}

export function persistPeerTrust(peerTrust: Record<string, PeerTrustRecordV1>) {
  try {
    localStorage.setItem(PEER_TRUST_STORAGE_KEY, JSON.stringify(peerTrust));
    const legacy: Record<string, LegacyPeerIdentityV1> = {};
    for (const [pid, rec] of Object.entries(peerTrust)) {
      legacy[pid] = {
        label: rec.label,
        claimedAt: rec.claimedAt,
        certifiedByMe: rec.certifiedByMe,
        certifiedByPeer: rec.certifiedByPeer,
      };
    }
    localStorage.setItem('knownPeerIdentities.v1', JSON.stringify(legacy));
  } catch {
    // ignore
  }
}

export function persistPeerRelations(peerRelations: Record<string, PeerRelationRecordV1>) {
  try {
    localStorage.setItem(PEER_RELATIONS_STORAGE_KEY, JSON.stringify(peerRelations));
  } catch {
    // ignore
  }
}

export function persistWotNode(announcement: WotNodeAnnouncementV1 | null) {
  try {
    if (!announcement) {
      localStorage.removeItem(WOT_NODE_ANNOUNCEMENT_STORAGE_KEY);
      return;
    }
    localStorage.setItem(WOT_NODE_ANNOUNCEMENT_STORAGE_KEY, JSON.stringify(announcement));
  } catch {
    // ignore
  }
}

import { Family, Individual, SelfIdentityPublic } from '../types';

export type P2PRole = 'viewer' | 'contributor' | 'editor';
export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'merged';
export type InviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked';
export type RevisionSource = 'local' | 'p2p';

export interface ShareSession {
  shareSessionId: string;
  ownerPeerId: string;
  protocolVersion: string;
  appSchemaVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface AccessProfile {
  accessProfileId: string;
  name: string;
  allowFields: string[];
  allowBranches: string[];
  allowMedia: boolean;
  allowDownload: boolean;
  allowProposal: boolean;
  allowDirectEdit: boolean;
}

export interface InviteRecord {
  inviteId: string;
  sessionId: string;
  recipientHint?: string;
  role: P2PRole;
  accessProfileId: string;
  tokenHash: string;
  issuedAt: string;
  expiresAt?: string;
  revokedAt?: string;
  status: InviteStatus;
}

export interface IndividualRevision {
  individualId: string;
  revisionId: string;
  parentRevisionIds: string[];
  authorPeerId: string;
  timestamp: string;
  source: RevisionSource;
  changeSet: Partial<Individual>;
  qualityScore?: number;
}

export interface ContributionProposal {
  proposalId: string;
  individualId: string;
  baseRevisionId: string;
  proposedRevisionId: string;
  authorPeerId: string;
  status: ProposalStatus;
  decisionBy?: string;
  decisionAt?: string;
}

export interface ActivityLogEvent {
  eventId: string;
  sessionId: string;
  actorPeerId: string;
  eventType: string;
  targetType: 'individual' | 'family' | 'session' | 'invite' | 'proposal';
  targetId: string;
  timestamp: string;
  payloadDigest?: string;
  prevHash?: string;
  hash?: string;
}

export interface PublicIndividualRecord {
  publicRecordId: string;
  individualId: string;
  publicProfileId: string;
  publishedAt: string;
  unpublishedAt?: string;
  fingerprint: string;
  version: number;
}

export interface AppMetadataStore {
  session: ShareSession | null;
  selfIdentity?: SelfIdentityPublic | null;
  accessProfiles: Record<string, AccessProfile>;
  invites: Record<string, InviteRecord>;
  revisionsByIndividualId: Record<string, IndividualRevision[]>;
  proposals: Record<string, ContributionProposal>;
  activityLog: ActivityLogEvent[];
  publicRecords: Record<string, PublicIndividualRecord>;
}

export interface HybridGenealogyState {
  individuals: Record<string, Individual>;
  families: Record<string, Family>;
  metadata: AppMetadataStore;
}

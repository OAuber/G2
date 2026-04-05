import type { Individual, Family } from '../types';
import type { IndividualDiffPotentialMatch } from '../services/p2pProtocol';

export type P2PSessionUseCase = 'share' | 'compare' | null;

export type P2PRole = 'viewer' | 'contributor' | 'editor';

export type P2PVisibilitySettings = {
  exposeIdentity: boolean;
  exposeDates: boolean;
  exposePlaces: boolean;
  exposeNotes: boolean;
  allowDocuments: boolean;
  allowDownload: boolean;
  allowProposal: boolean;
  allowDirectEdit: boolean;
};

export type P2PInviteItem = {
  inviteId: string;
  individualId: string;
  individualName: string;
  role: P2PRole;
  expiresAt?: string;
  status: 'active' | 'accepted' | 'revoked' | 'expired';
  personalizedDefault: boolean;
  createdAt: string;
  token?: string;
  inviteLink?: string;
  accessProfile: P2PVisibilitySettings;
  inviteIntent?: 'standard' | 'own_device';
};

export type P2PProposalItem = {
  proposalId: string;
  individualId: string;
  individualLabel: string;
  authorPeerId: string;
  proposedAt: string;
  operation: 'update_individual' | 'create_individual' | 'delete_individual';
  proposedIndividual?: Individual;
  proposedFamilies?: Record<string, Family>;
  relatedIndividuals?: Record<string, Individual>;
  changeSet: Partial<Individual>;
  status: 'pending' | 'accepted' | 'rejected';
  decidedAt?: string;
  source?: 'live' | 'initial_compare';
  initialSyncBatchId?: string;
  matchConfidence?: 'high' | 'medium' | 'low';
  matchScore?: number;
  remoteIndividualId?: string;
  remoteFingerprint?: string;
  retryAfterReject?: boolean;
  proposalKind?: 'records' | 'documents';
  scopeIndividualId?: string;
  documentItemsDelta?: number;
  photoItemsDelta?: number;
};

/** Document média attaché à un individu (UI app / sync P2P). */
export type IndividualDocument = {
  id: string;
  title: string;
  url: string;
  source: 'local' | 'online';
  kind: 'photo' | 'document';
  date?: string;
  sourceAttribution?: string;
  isPrimaryPhoto?: boolean;
  groupPhotoLinkId?: string;
  groupPhotoOriginIndividualId?: string;
  groupPhotoIsMirror?: boolean;
  groupPhotoParticipantIds?: string[];
  hiddenFromRibbonSlideshow?: boolean;
};

export type InitialDiffContext = {
  requestToken: string;
  batchId: string;
  retryCount: number;
  pendingRequestIds: string[];
  potentialMatchesBySenderId: Record<string, IndividualDiffPotentialMatch>;
  startedAt: number;
};

export type RejectedInitialMatchMap = Record<string, Set<string>>;

export type P2PTransferMode = 'progressive' | 'bundle';

export type P2PBundleContentMode = 'gedcom-only' | 'gedcom-and-documents';

import { GedcomData } from '../types';

export const P2P_PROTOCOL_VERSION = '1.0.0';

export type P2PMessageType =
  | 'SYNC_GEDCOM'
  | 'DOCUMENTS_SYNC'
  | 'INVITE_CREATE'
  | 'INVITE_REVOKE'
  | 'INVITE_ACCEPT'
  | 'ACCESS_PROFILE_SET'
  | 'ACTIVITY_EVENT'
  | 'PROPOSAL_SUBMIT'
  | 'PROPOSAL_DECIDE'
  | 'INDIVIDUAL_DIFF_REQUEST'
  | 'INDIVIDUAL_DIFF_RESPONSE'
  | 'MERGE_APPLY'
  | 'PUBLIC_RECORD_PUBLISH'
  | 'PUBLIC_RECORD_UNPUBLISH'
  | 'MATCH_FOUND'
  | 'CONTACT_REQUEST'
  | 'CONTACT_RESPONSE'
  | 'ACK';

export type P2PErrorCode =
  | 'BAD_PROTOCOL_VERSION'
  | 'MALFORMED_MESSAGE'
  | 'UNAUTHORIZED_ACTION'
  | 'INVITE_EXPIRED'
  | 'INVITE_REVOKED'
  | 'NONCE_REPLAYED'
  | 'MESSAGE_EXPIRED'
  | 'RESOURCE_NOT_FOUND'
  | 'CONFLICT_DETECTED'
  | 'RATE_LIMITED'
  | 'PEER_UNREACHABLE';

export interface P2PEnvelope<TPayload = unknown> {
  protocolVersion: string;
  messageId: string;
  type: P2PMessageType;
  sessionId?: string;
  senderPeerId?: string;
  sentAt: string;
  nonce: string;
  ttlMs: number;
  payload: TPayload;
}

export interface AckPayload {
  ackMessageId: string;
  status: 'ok' | 'error';
  errorCode?: P2PErrorCode;
  errorMessage?: string;
}

export interface SyncGedcomPayload {
  gedcom: GedcomData;
  databaseName?: string;
}

export const DEFAULT_MESSAGE_TTL_MS = 120000;

export function createEnvelope<TPayload>(
  type: P2PMessageType,
  payload: TPayload,
  options?: {
    sessionId?: string;
    senderPeerId?: string;
    ttlMs?: number;
    messageId?: string;
    nonce?: string;
    sentAt?: string;
  }
): P2PEnvelope<TPayload> {
  return {
    protocolVersion: P2P_PROTOCOL_VERSION,
    messageId: options?.messageId ?? generateRandomId(),
    type,
    sessionId: options?.sessionId,
    senderPeerId: options?.senderPeerId,
    sentAt: options?.sentAt ?? new Date().toISOString(),
    nonce: options?.nonce ?? generateRandomId(),
    ttlMs: options?.ttlMs ?? DEFAULT_MESSAGE_TTL_MS,
    payload,
  };
}

export function isEnvelope(value: unknown): value is P2PEnvelope {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.protocolVersion === 'string' &&
    typeof v.messageId === 'string' &&
    typeof v.type === 'string' &&
    typeof v.sentAt === 'string' &&
    typeof v.nonce === 'string' &&
    typeof v.ttlMs === 'number' &&
    'payload' in v
  );
}

export function validateEnvelope(envelope: P2PEnvelope): { ok: true } | { ok: false; errorCode: P2PErrorCode } {
  if (envelope.protocolVersion !== P2P_PROTOCOL_VERSION) {
    return { ok: false, errorCode: 'BAD_PROTOCOL_VERSION' };
  }
  const sentAtMs = Date.parse(envelope.sentAt);
  if (Number.isNaN(sentAtMs)) {
    return { ok: false, errorCode: 'MALFORMED_MESSAGE' };
  }
  if (Date.now() - sentAtMs > envelope.ttlMs) {
    return { ok: false, errorCode: 'MESSAGE_EXPIRED' };
  }
  return { ok: true };
}

export class NonceReplayGuard {
  private readonly seen = new Map<string, number>();

  constructor(private readonly maxEntries = 5000) {}

  public registerOrReject(senderKey: string, nonce: string, ttlMs: number): boolean {
    this.prune();
    const now = Date.now();
    const k = `${senderKey}:${nonce}`;
    const existing = this.seen.get(k);
    if (existing && existing > now) return false;
    this.seen.set(k, now + ttlMs);
    if (this.seen.size > this.maxEntries) {
      this.prune(true);
    }
    return true;
  }

  private prune(force = false) {
    const now = Date.now();
    for (const [k, expiresAt] of this.seen.entries()) {
      if (expiresAt <= now) this.seen.delete(k);
    }
    if (force && this.seen.size > this.maxEntries) {
      const entries = [...this.seen.entries()].sort((a, b) => a[1] - b[1]);
      const excess = this.seen.size - this.maxEntries;
      for (let i = 0; i < excess; i++) {
        this.seen.delete(entries[i][0]);
      }
    }
  }
}

function generateRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

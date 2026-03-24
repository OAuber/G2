import { ActivityLogEvent } from './p2pDomain';

export interface InviteTokenClaims {
  inviteId: string;
  sessionId: string;
  role: 'viewer' | 'contributor' | 'editor';
  accessProfileId: string;
  targetIndividualId?: string;
  targetIndividualName?: string;
  issuedAt: string;
  expiresAt?: string;
  nonce: string;
}

export async function signInviteClaims(claims: InviteTokenClaims, secret: string): Promise<string> {
  const encodedClaims = base64UrlEncode(JSON.stringify(claims));
  const signature = await hmacSha256Base64Url(secret, encodedClaims);
  return `${encodedClaims}.${signature}`;
}

export async function verifyInviteToken(token: string, secret: string): Promise<InviteTokenClaims | null> {
  const [encodedClaims, signature] = token.split('.');
  if (!encodedClaims || !signature) return null;
  const expected = await hmacSha256Base64Url(secret, encodedClaims);
  if (expected !== signature) return null;
  const parsed = JSON.parse(base64UrlDecode(encodedClaims)) as InviteTokenClaims;
  if (parsed.expiresAt && Date.now() > Date.parse(parsed.expiresAt)) return null;
  return parsed;
}

export async function appendHashedEvent(
  existing: ActivityLogEvent[],
  nextEvent: Omit<ActivityLogEvent, 'prevHash' | 'hash'>
): Promise<ActivityLogEvent> {
  const prevHash = existing.length ? existing[existing.length - 1].hash : undefined;
  const event: ActivityLogEvent = {
    ...nextEvent,
    prevHash,
    hash: '',
  };
  const canonical = JSON.stringify({
    eventId: event.eventId,
    sessionId: event.sessionId,
    actorPeerId: event.actorPeerId,
    eventType: event.eventType,
    targetType: event.targetType,
    targetId: event.targetId,
    timestamp: event.timestamp,
    payloadDigest: event.payloadDigest || '',
    prevHash: prevHash || '',
  });
  event.hash = await sha256Hex(canonical);
  return event;
}

export async function verifyLogIntegrity(events: ActivityLogEvent[]): Promise<boolean> {
  let previousHash = '';
  for (const event of events) {
    const canonical = JSON.stringify({
      eventId: event.eventId,
      sessionId: event.sessionId,
      actorPeerId: event.actorPeerId,
      eventType: event.eventType,
      targetType: event.targetType,
      targetId: event.targetId,
      timestamp: event.timestamp,
      payloadDigest: event.payloadDigest || '',
      prevHash: event.prevHash || '',
    });
    const expectedHash = await sha256Hex(canonical);
    if (event.hash !== expectedHash) return false;
    if ((event.prevHash || '') !== previousHash) return false;
    previousHash = event.hash || '';
  }
  return true;
}

async function hmacSha256Base64Url(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return base64UrlFromBytes(new Uint8Array(signature));
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return bytesToHex(new Uint8Array(digest));
}

function base64UrlEncode(value: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(value));
}

function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

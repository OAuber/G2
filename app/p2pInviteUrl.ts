import type { P2PInviteItem, P2PRole } from './p2pAppTypes';
import type { InviteTokenClaims } from '../services/p2pSecurity';
import {
  buildAccessProfileFromRole,
  buildEphemeralAccessProfile,
  resolveLinkKind,
} from './inviteLinkKind';

/** Lit le jeton d’invitation P2P depuis l’URL (query ou hash). */
export function readInviteTokenFromLocation(): string | null {
  const search = new URLSearchParams(window.location.search);
  const fromQuery = search.get('g2invite');
  if (fromQuery) return fromQuery;
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
  if (!hash) return null;
  const hashParams = new URLSearchParams(hash);
  return hashParams.get('g2invite');
}

/** Décode le payload du jeton (sans vérif HMAC) — aligné sur l’usage App / onboarding. */
export function parseInviteClaimsUnsafe(token: string): InviteTokenClaims | null {
  const encodedClaims = token.split('.')[0];
  if (!encodedClaims) return null;
  try {
    const padded = encodedClaims.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encodedClaims.length / 4) * 4, '=');
    const decoded = atob(padded);
    return JSON.parse(decoded) as InviteTokenClaims;
  } catch {
    return null;
  }
}

export function buildP2PInviteItemFromInviteToken(inviteToken: string): P2PInviteItem | null {
  const claims = parseInviteClaimsUnsafe(inviteToken);
  if (!claims) return null;
  const urlLinkKind = resolveLinkKind(claims);
  const ephemeral = urlLinkKind === 'ephemeral_free';
  const labelTo = ephemeral
    ? claims.targetIndividualName || 'ephemeral'
    : claims.targetIndividualName || 'invite';
  return {
    inviteId: claims.inviteId,
    individualId: claims.targetIndividualId || '',
    individualName: ephemeral
      ? claims.targetIndividualName || ''
      : claims.targetIndividualName || `invité (${claims.role})`,
    role: ephemeral ? 'viewer' : claims.role,
    status: 'active',
    personalizedDefault: false,
    createdAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
    token: inviteToken,
    inviteLink: `${window.location.origin}${window.location.pathname}?invite_from=${encodeURIComponent(claims.inviterName || 'invitant')}&invite_to=${encodeURIComponent(labelTo)}&invite_role=${encodeURIComponent(claims.role)}${claims.intent === 'own_device' ? '&invite_intent=own_device' : ''}${ephemeral ? '&invite_kind=ephemeral' : ''}#g2invite=${encodeURIComponent(inviteToken)}`,
    accessProfile: ephemeral ? buildEphemeralAccessProfile() : buildAccessProfileFromRole(claims.role),
    inviteIntent: claims.intent === 'own_device' ? 'own_device' : 'standard',
    linkKind: urlLinkKind,
  };
}

export type InitialInviteBootstrap = {
  token: string | null;
  claims: InviteTokenClaims | null;
  initialInvites: P2PInviteItem[];
  hostPeerId: string | null;
  targetIndividualId: string | null;
  inviterName: string | null;
  intent: 'standard' | 'own_device';
  role: P2PRole | null;
};

/** État dérivé du jeton dans l’URL au premier chargement (avant tout useEffect). */
export function readInitialInviteBootstrap(): InitialInviteBootstrap {
  if (typeof window === 'undefined') {
    return {
      token: null,
      claims: null,
      initialInvites: [],
      hostPeerId: null,
      targetIndividualId: null,
      inviterName: null,
      intent: 'standard',
      role: null,
    };
  }
  const token = readInviteTokenFromLocation();
  if (!token) {
    return {
      token: null,
      claims: null,
      initialInvites: [],
      hostPeerId: null,
      targetIndividualId: null,
      inviterName: null,
      intent: 'standard',
      role: null,
    };
  }
  const claims = parseInviteClaimsUnsafe(token);
  if (!claims) {
    return {
      token,
      claims: null,
      initialInvites: [],
      hostPeerId: null,
      targetIndividualId: null,
      inviterName: null,
      intent: 'standard',
      role: null,
    };
  }
  const item = buildP2PInviteItemFromInviteToken(token);
  const hostPeerId =
    claims.sessionId && claims.sessionId !== 'local-session' ? claims.sessionId : null;
  const urlLinkKind = resolveLinkKind(claims);
  let targetIndividualId: string | null = claims.targetIndividualId ?? null;
  if (!claims.targetIndividualId && urlLinkKind === 'ephemeral_free') {
    targetIndividualId = null;
  }
  return {
    token,
    claims,
    initialInvites: item ? [item] : [],
    hostPeerId,
    targetIndividualId,
    inviterName: claims.inviterName ?? null,
    intent: claims.intent === 'own_device' ? 'own_device' : 'standard',
    role: claims.role,
  };
}

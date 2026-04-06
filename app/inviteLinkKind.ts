import type { P2PRole, P2PVisibilitySettings } from './p2pAppTypes';
import type { InviteTokenClaims } from '../services/p2pSecurity';

/** Liens d’invitation : visite anonyme (1.2) vs nominatif + revendication (2). */
export type InviteLinkKind = 'ephemeral_free' | 'named_claim';

export function resolveLinkKind(claims: Partial<InviteTokenClaims> | null | undefined): InviteLinkKind {
  if (claims?.linkKind === 'ephemeral_free') return 'ephemeral_free';
  return 'named_claim';
}

/** Profil strict lecture seule pour invités 1.2 (visite libre). */
export function buildEphemeralAccessProfile(): P2PVisibilitySettings {
  return {
    exposeIdentity: true,
    exposeDates: true,
    exposePlaces: true,
    exposeNotes: true,
    allowDocuments: false,
    allowDownload: false,
    allowProposal: false,
    allowDirectEdit: false,
  };
}

/** Profil de visibilité P2P dérivé du rôle d’invitation (hôte / jeton). */
export function buildAccessProfileFromRole(role: P2PRole): P2PVisibilitySettings {
  if (role === 'viewer') {
    return {
      exposeIdentity: true,
      exposeDates: true,
      exposePlaces: false,
      exposeNotes: false,
      allowDocuments: true,
      allowDownload: false,
      allowProposal: false,
      allowDirectEdit: false,
    };
  }
  if (role === 'contributor') {
    return {
      exposeIdentity: true,
      exposeDates: true,
      exposePlaces: true,
      exposeNotes: false,
      allowDocuments: true,
      allowDownload: false,
      allowProposal: true,
      allowDirectEdit: false,
    };
  }
  if (role === 'comparator') {
    return {
      exposeIdentity: true,
      exposeDates: true,
      exposePlaces: true,
      exposeNotes: true,
      allowDocuments: true,
      allowDownload: false,
      allowProposal: true,
      allowDirectEdit: false,
    };
  }
  return {
    exposeIdentity: true,
    exposeDates: true,
    exposePlaces: true,
    exposeNotes: true,
    allowDocuments: true,
    allowDownload: true,
    allowProposal: true,
    allowDirectEdit: true,
  };
}

/** Partage / comparaison : réservés aux sessions nominatives (type 2), pas à la visite 1.2. */
export function sessionAllowsShareCompare(linkKind: InviteLinkKind | null | undefined): boolean {
  return linkKind === 'named_claim';
}

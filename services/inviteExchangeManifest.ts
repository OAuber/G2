import type { InviteExchangeScope, P2PVisibilitySettings } from '../app/p2pAppTypes';
import type { GedcomData } from '../types';
import {
  collectManifestScopeIndividualIds,
  DEFAULT_PREVIEW_MAX_GEN_DOWN,
  DEFAULT_PREVIEW_MAX_GEN_UP,
} from './lineageImportScope';

/** Version du schéma manifeste (évolution indépendante du bundle .g2). */
export const INVITE_EXCHANGE_MANIFEST_SCHEMA_VERSION = 1;

/** Plafonds par défaut (alignés sur l’aperçu import branche — mémo § 5.3). */
export const DEFAULT_INVITE_EXCHANGE_MAX_GEN_DOWN = DEFAULT_PREVIEW_MAX_GEN_DOWN;
export const DEFAULT_INVITE_EXCHANGE_MAX_GEN_UP = DEFAULT_PREVIEW_MAX_GEN_UP;

/**
 * Décision produit (mémo § 7) : génération de l’archive invitant **à l’acceptation** de l’invitation,
 * pas à la création du lien — évite un export périmé si l’arbre change entre-temps.
 */
export type InviteExchangeGenerationMoment = 'on_acceptance';

export type InviteDataFlags = {
  vital: boolean;
  relations: boolean;
  media: boolean;
  notes: boolean;
};

/** Défauts UI / stockage `exchangeScope` sur l’invite (mémo § 5.3). */
export function defaultInviteExchangeScope(): InviteExchangeScope {
  return {
    maxGenDown: DEFAULT_INVITE_EXCHANGE_MAX_GEN_DOWN,
    maxGenUp: DEFAULT_INVITE_EXCHANGE_MAX_GEN_UP,
    includeSpouses: true,
    data: {
      vital: true,
      relations: true,
      media: true,
      notes: true,
    },
  };
}

/** Manifeste d’échange borné pour une session d’invitation (sortie invitant ou réponse invité). */
export type InviteExchangeManifest = {
  schemaVersion: number;
  inviteId: string;
  /** ISO 8601 — moment de génération du bundle (choix : acceptation). */
  generatedAt: string;
  rootIndividualIds: string[];
  maxGenDown: number;
  maxGenUp: number;
  includeSpouses: boolean;
  data: InviteDataFlags;
};

/**
 * Politique effective : **minimum** des plafonds invitant / invité (mémo § 5.4, point ouvert tranché).
 * Les drapeaux données : conjonction (les deux doivent autoriser).
 */
export function effectiveExchangePolicy(
  inviter: InviteExchangeManifest,
  invitee: {
    maxGenDown: number;
    maxGenUp: number;
    includeSpouses: boolean;
    data: InviteDataFlags;
    /** Racines dans le GEDCOM de l’invité (IDs locaux — pas ceux du manifeste hôte). */
    rootIndividualIds: string[];
  },
): InviteExchangeManifest {
  return {
    schemaVersion: inviter.schemaVersion,
    inviteId: inviter.inviteId,
    generatedAt: inviter.generatedAt,
    rootIndividualIds: [...invitee.rootIndividualIds],
    maxGenDown: Math.min(inviter.maxGenDown, invitee.maxGenDown),
    maxGenUp: Math.min(inviter.maxGenUp, invitee.maxGenUp),
    includeSpouses: inviter.includeSpouses && invitee.includeSpouses,
    data: {
      vital: inviter.data.vital && invitee.data.vital,
      relations: inviter.data.relations && invitee.data.relations,
      media: inviter.data.media && invitee.data.media,
      notes: inviter.data.notes && invitee.data.notes,
    },
  };
}

/** Racine d’échange : préfère `scope.rootIndividualId` si présent dans le GEDCOM, sinon `fallbackIndividualId`. */
export function resolveExchangeRootIndividualId(
  gedcom: GedcomData,
  scope: { rootIndividualId?: string } | undefined,
  fallbackIndividualId: string | null,
): string | null {
  const fromScope = scope?.rootIndividualId;
  if (fromScope && gedcom.individuals[fromScope]) return fromScope;
  if (fallbackIndividualId && gedcom.individuals[fallbackIndividualId]) return fallbackIndividualId;
  return null;
}

export function validateManifestRootsAgainstGedcom(
  manifest: InviteExchangeManifest,
  gedcom: GedcomData,
): { ok: boolean; missingRootIds: string[] } {
  const missingRootIds = manifest.rootIndividualIds.filter((id) => !gedcom.individuals[id]);
  return { ok: missingRootIds.length === 0, missingRootIds };
}

/** Union des périmètres (desc/asc/conjoints) pour chaque racine du manifeste — phases C/D mémo. */
export function collectIndividualIdsForManifest(
  data: GedcomData,
  manifest: InviteExchangeManifest,
): Set<string> {
  const out = new Set<string>();
  for (const rootId of manifest.rootIndividualIds) {
    if (!data.individuals[rootId]) continue;
    const part = collectManifestScopeIndividualIds(
      data,
      rootId,
      manifest.maxGenDown,
      manifest.maxGenUp,
      manifest.includeSpouses,
    );
    for (const id of part) out.add(id);
  }
  return out;
}

/** Carte profil P2P → drapeaux données du manifeste (granularité mémo § 5). */
export function inviteDataFlagsFromP2PVisibility(v: P2PVisibilitySettings): InviteDataFlags {
  return {
    vital: v.exposeDates || v.exposePlaces,
    relations: true,
    media: v.allowDocuments,
    notes: v.exposeNotes,
  };
}

export type CreateInviteExchangeManifestInput = {
  inviteId: string;
  rootIndividualIds: string[];
  generatedAt?: string;
  maxGenDown?: number;
  maxGenUp?: number;
  includeSpouses?: boolean;
  data?: InviteDataFlags;
};

/**
 * Manifeste invitant ou invité (même schéma) — généré **à l’acceptation** / envoi bundle (mémo § 5.2).
 * Le bundle P2P peut n’embarquer qu’un **sous-GEDCOM** aligné sur ce périmètre (voir `extractGedcomSubset`).
 */
export function createInviteExchangeManifest(input: CreateInviteExchangeManifestInput): InviteExchangeManifest {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  return {
    schemaVersion: INVITE_EXCHANGE_MANIFEST_SCHEMA_VERSION,
    inviteId: input.inviteId,
    generatedAt,
    rootIndividualIds: [...input.rootIndividualIds],
    maxGenDown: input.maxGenDown ?? DEFAULT_INVITE_EXCHANGE_MAX_GEN_DOWN,
    maxGenUp: input.maxGenUp ?? DEFAULT_INVITE_EXCHANGE_MAX_GEN_UP,
    includeSpouses: input.includeSpouses ?? true,
    data: input.data ?? {
      vital: true,
      relations: true,
      media: true,
      notes: true,
    },
  };
}

function isInviteDataFlags(v: unknown): v is InviteDataFlags {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.vital === 'boolean' &&
    typeof o.relations === 'boolean' &&
    typeof o.media === 'boolean' &&
    typeof o.notes === 'boolean'
  );
}

export function parseInviteExchangeManifestJson(json: string): InviteExchangeManifest | null {
  try {
    const v = JSON.parse(json) as unknown;
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    if (o.schemaVersion !== INVITE_EXCHANGE_MANIFEST_SCHEMA_VERSION) return null;
    if (typeof o.inviteId !== 'string' || !o.inviteId) return null;
    if (typeof o.generatedAt !== 'string' || !o.generatedAt) return null;
    if (!Array.isArray(o.rootIndividualIds) || o.rootIndividualIds.length === 0) return null;
    if (!o.rootIndividualIds.every((id): id is string => typeof id === 'string' && id.length > 0)) return null;
    if (typeof o.maxGenDown !== 'number' || typeof o.maxGenUp !== 'number') return null;
    if (typeof o.includeSpouses !== 'boolean') return null;
    if (!isInviteDataFlags(o.data)) return null;
    return o as unknown as InviteExchangeManifest;
  } catch {
    return null;
  }
}

import { SelfIdentityPublic } from '../types';

/** Champs persistés pour chaque média dans l’archive G2 `.g2.zip` (export, import, bundle P2P). */
export type BundleIndividualDocument = {
  id: string;
  title: string;
  url: string;
  source: 'local' | 'online';
  kind: 'photo' | 'document';
  date?: string;
  /** Crédit / provenance (texte ou URL), même modèle que dans l’app. */
  sourceAttribution?: string;
  isPrimaryPhoto?: boolean;
  groupPhotoLinkId?: string;
  groupPhotoOriginIndividualId?: string;
  groupPhotoIsMirror?: boolean;
  groupPhotoParticipantIds?: string[];
  hiddenFromRibbonSlideshow?: boolean;
};

/**
 * Copie uniquement les champs prévus pour le bundle, dont `sourceAttribution`,
 * afin qu’ils ne soient pas perdus lors d’un futur refactor des objets en mémoire.
 */
export function serializeDocumentsByIndividualIdForBundle(
  input: Record<string, unknown> | null | undefined
): Record<string, BundleIndividualDocument[]> {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, BundleIndividualDocument[]> = {};
  for (const [individualId, rawList] of Object.entries(input)) {
    if (!Array.isArray(rawList)) continue;
    const docs: BundleIndividualDocument[] = [];
    for (const raw of rawList) {
      if (!raw || typeof raw !== 'object') continue;
      const d = raw as Record<string, unknown>;
      const url = typeof d.url === 'string' ? d.url : '';
      if (!url) continue;
      const id =
        typeof d.id === 'string' && d.id
          ? d.id
          : `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const title = typeof d.title === 'string' ? d.title : 'Untitled';
      const source: 'local' | 'online' =
        d.source === 'local' || d.source === 'online' ? d.source : 'online';
      const kind: 'photo' | 'document' =
        d.kind === 'photo' || d.kind === 'document' ? d.kind : 'document';
      const date = typeof d.date === 'string' && d.date ? d.date : undefined;
      const sa = d.sourceAttribution;
      const sourceAttribution =
        typeof sa === 'string' && sa.trim() !== '' ? sa.trim() : undefined;
      const isPrimaryPhoto = d.isPrimaryPhoto === true;
      const groupPhotoLinkId = typeof d.groupPhotoLinkId === 'string' ? d.groupPhotoLinkId : undefined;
      const groupPhotoOriginIndividualId =
        typeof d.groupPhotoOriginIndividualId === 'string' ? d.groupPhotoOriginIndividualId : undefined;
      const groupPhotoIsMirror = d.groupPhotoIsMirror === true;
      const groupPhotoParticipantIds = Array.isArray(d.groupPhotoParticipantIds)
        ? (d.groupPhotoParticipantIds as unknown[]).filter((x): x is string => typeof x === 'string')
        : undefined;
      const hiddenFromRibbonSlideshow =
        typeof d.hiddenFromRibbonSlideshow === 'boolean' ? d.hiddenFromRibbonSlideshow : undefined;
      docs.push({
        id,
        title,
        url,
        source,
        kind,
        ...(date ? { date } : {}),
        ...(sourceAttribution ? { sourceAttribution } : {}),
        ...(isPrimaryPhoto ? { isPrimaryPhoto: true } : {}),
        ...(groupPhotoLinkId ? { groupPhotoLinkId } : {}),
        ...(groupPhotoOriginIndividualId ? { groupPhotoOriginIndividualId } : {}),
        ...(groupPhotoIsMirror ? { groupPhotoIsMirror: true } : {}),
        ...(groupPhotoParticipantIds && groupPhotoParticipantIds.length > 0
          ? { groupPhotoParticipantIds }
          : {}),
        ...(hiddenFromRibbonSlideshow === true || hiddenFromRibbonSlideshow === false
          ? { hiddenFromRibbonSlideshow }
          : {}),
      });
    }
    out[individualId] = docs;
  }
  return out;
}

export interface G2BundleMetadata {
  version?: string;
  databaseName?: string;
  exportedAt?: string;
  /** Tableaux de {@link BundleIndividualDocument} après sérialisation dans {@link createG2Bundle}. */
  documentsByIndividualId?: Record<string, unknown>;
  includesDocuments?: boolean;
  normalizedGedcomContent?: string;
  normalizationAlgoVersion?: string;
  selfIdentity?: SelfIdentityPublic | null;
  /** JSON stringifié de {@link InviteExchangeManifest} (session invitation / comparaison — mémo § 5.2). */
  inviteExchangeManifestJson?: string;
  /** True si le `gedcomContent` est un sous-graphe extrait selon le manifeste (phases C/D). */
  inviteExchangeGedcomSubset?: boolean;
  [key: string]: unknown;
}

interface G2BundlePayload {
  g2Bundle: true;
  gedcomContent: string;
  metadata: G2BundleMetadata;
}

function isG2BundlePayload(value: unknown): value is G2BundlePayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const legacy = v.lifethreadBundle === true;
  const current = v.g2Bundle === true;
  if ((!current && !legacy) || typeof v.gedcomContent !== 'string') return false;
  if (v.metadata === undefined) return true;
  return typeof v.metadata === 'object';
}

async function createG2Bundle(gedcomContent: string, metadata: G2BundleMetadata): Promise<Blob> {
  const meta: G2BundleMetadata = { ...(metadata || {}) };
  if (meta.documentsByIndividualId != null && typeof meta.documentsByIndividualId === 'object') {
    meta.documentsByIndividualId = serializeDocumentsByIndividualIdForBundle(
      meta.documentsByIndividualId as Record<string, unknown>
    );
  }
  const payload: G2BundlePayload = {
    g2Bundle: true,
    gedcomContent,
    metadata: meta,
  };
  const content = JSON.stringify(payload);
  return new Blob([content], { type: 'application/json;charset=utf-8' });
}

async function parseG2Bundle(
  file: File
): Promise<{ gedcomContent: string; metadata: G2BundleMetadata }> {
  const text = await file.text();
  try {
    const parsed = JSON.parse(text) as unknown;
    if (isG2BundlePayload(parsed)) {
      const p = parsed as G2BundlePayload & { lifethreadBundle?: boolean };
      const meta = p.metadata;
      const metadata: G2BundleMetadata = meta && typeof meta === 'object' ? meta : {};
      return { gedcomContent: p.gedcomContent, metadata };
    }
    if (parsed && typeof parsed === 'object' && 'gedcomContent' in parsed) {
      const p = parsed as Record<string, unknown>;
      if (typeof p.gedcomContent === 'string') {
        const meta = p.metadata;
        const metadata: G2BundleMetadata =
          meta && typeof meta === 'object' ? (meta as G2BundleMetadata) : {};
        return { gedcomContent: p.gedcomContent, metadata };
      }
    }
    return { gedcomContent: '', metadata: normalizeMetadata(parsed) };
  } catch {
    return { gedcomContent: text, metadata: {} };
  }
}

function normalizeMetadata(value: unknown): G2BundleMetadata {
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (v.metadata && typeof v.metadata === 'object') {
      return v.metadata as G2BundleMetadata;
    }
    return v as G2BundleMetadata;
  }
  return {};
}

export { createG2Bundle, parseG2Bundle };

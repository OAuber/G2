import { SelfIdentityPublic } from '../types';

/** Champs persistés pour chaque média dans l’archive .lifethread (export, import, bundle P2P). */
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
      docs.push({
        id,
        title,
        url,
        source,
        kind,
        ...(date ? { date } : {}),
        ...(sourceAttribution ? { sourceAttribution } : {}),
        ...(isPrimaryPhoto ? { isPrimaryPhoto: true } : {}),
      });
    }
    out[individualId] = docs;
  }
  return out;
}

export interface LifeThreadBundleMetadata {
  version?: string;
  databaseName?: string;
  exportedAt?: string;
  /** Tableaux de {@link BundleIndividualDocument} après sérialisation dans {@link createLifeThreadBundle}. */
  documentsByIndividualId?: Record<string, unknown>;
  includesDocuments?: boolean;
  normalizedGedcomContent?: string;
  normalizationAlgoVersion?: string;
  selfIdentity?: SelfIdentityPublic | null;
  [key: string]: unknown;
}

interface LifeThreadBundlePayload {
  lifethreadBundle: true;
  gedcomContent: string;
  metadata: LifeThreadBundleMetadata;
}

function isBundlePayload(value: unknown): value is LifeThreadBundlePayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.lifethreadBundle !== true || typeof v.gedcomContent !== 'string') return false;
  // metadata peut être absent (certaines écritures JSON) ; null compte comme object en JS
  if (v.metadata === undefined) return true;
  return typeof v.metadata === 'object';
}

export async function createLifeThreadBundle(
  gedcomContent: string,
  metadata: LifeThreadBundleMetadata
): Promise<Blob> {
  const meta: LifeThreadBundleMetadata = { ...(metadata || {}) };
  if (meta.documentsByIndividualId != null && typeof meta.documentsByIndividualId === 'object') {
    meta.documentsByIndividualId = serializeDocumentsByIndividualIdForBundle(
      meta.documentsByIndividualId as Record<string, unknown>
    );
  }
  const payload: LifeThreadBundlePayload = {
    lifethreadBundle: true,
    gedcomContent,
    metadata: meta,
  };
  const content = JSON.stringify(payload);
  return new Blob([content], { type: 'application/json;charset=utf-8' });
}

export async function parseLifeThreadBundle(
  file: File
): Promise<{ gedcomContent: string; metadata: LifeThreadBundleMetadata }> {
  const text = await file.text();
  try {
    const parsed = JSON.parse(text) as unknown;
    if (isBundlePayload(parsed)) {
      const p = parsed as LifeThreadBundlePayload;
      const meta = p.metadata;
      const metadata: LifeThreadBundleMetadata =
        meta && typeof meta === 'object' ? meta : {};
      return { gedcomContent: p.gedcomContent, metadata };
    }
    if (parsed && typeof parsed === 'object' && 'gedcomContent' in parsed) {
      const p = parsed as Record<string, unknown>;
      if (typeof p.gedcomContent === 'string') {
        const meta = p.metadata;
        const metadata: LifeThreadBundleMetadata =
          meta && typeof meta === 'object' ? (meta as LifeThreadBundleMetadata) : {};
        return { gedcomContent: p.gedcomContent, metadata };
      }
    }
    return { gedcomContent: '', metadata: normalizeMetadata(parsed) };
  } catch {
    return { gedcomContent: text, metadata: {} };
  }
}

function normalizeMetadata(value: unknown): LifeThreadBundleMetadata {
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (v.metadata && typeof v.metadata === 'object') {
      return v.metadata as LifeThreadBundleMetadata;
    }
    return v as LifeThreadBundleMetadata;
  }
  return {};
}

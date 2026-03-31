import { SelfIdentityPublic } from '../types';

export interface LifeThreadBundleMetadata {
  version?: string;
  databaseName?: string;
  exportedAt?: string;
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
  const payload: LifeThreadBundlePayload = {
    lifethreadBundle: true,
    gedcomContent,
    metadata: metadata || {},
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

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Loader2, X, HelpCircle, Sun, Moon } from 'lucide-react';
import Sidebar from './components/Sidebar';
import DetailsPanel, { NewPersonData } from './components/DetailsPanel';
import Scene3D from './components/Scene3D';
import Scene2DIndividual from './components/Scene2DIndividual';
import Scene2DGrid, { WHEEL_ZOOM_IN_STEP_FACTOR } from './components/Scene2DGrid';
import BottomPanel from './components/BottomPanel';
import TopPanel from './components/TopPanel';
import { GedcomData, Individual, Family, DragMode, DisplayMode, ViewMode, SortMode, FilterTag, LayoutParams, DEFAULT_LAYOUT_PARAMS, RenderedPerson, CameraMode, P2PStatus, P2PMode, SelfIdentityPublic } from './types';
import { generateGedcom, logGedcomImportDiagnostics, parseDate, parseGedcom } from './services/gedcomParser';
import { p2pService } from './services/p2p';
import { normalizeGedcom } from './services/normalizationService';
import { ActivityLogEvent } from './services/p2pDomain';
import { createG2Bundle, parseG2Bundle } from './services/bundleService';
import {
  buildEncryptedIdentityBackup,
  decryptIdentityBackupPrivateKey,
  generateIdentityKeyMaterial,
  isIdentityBackupPayload,
} from './services/selfIdentityCrypto';
import { useI18n } from './i18n';
import {
  IndividualDiffIndexEntry,
  IndividualDiffPotentialMatch,
  IndividualDiffRequestPayload,
  IndividualDiffResponsePayload,
} from './services/p2pProtocol';
import { InviteTokenClaims, signInviteClaims, verifyInviteToken } from './services/p2pSecurity';

const SELF_IDENTITY_STORAGE_KEY = 'g2:selfIdentityPublic:v1';
const SELF_IDENTITY_PRIVATE_STORAGE_KEY = 'g2:selfIdentityPrivateJwk:v1';
const INVITE_SECRET_STORAGE_KEY = 'g2:p2pInviteSecret:v1';
const AUTOSAVE_SETTINGS_KEY = 'g2:autoSaveEnabled:v1';
const P2P_TRANSFER_MODE_KEY = 'g2:p2pTransferMode:v1';
const P2P_BUNDLE_CONTENT_MODE_KEY = 'g2:p2pBundleContentMode:v1';
const AUTOSAVE_DB_NAME = 'g2-autosave-db';
const AUTOSAVE_STORE_NAME = 'snapshots';
const AUTOSAVE_RECORD_KEY = 'latest';

/** Base Prénom_Nom pour titres auto des photos en ligne (comme un nom de fichier). */
function displayNameSlugForOnlineDocTitle(
  individualId: string,
  individuals: Record<string, Individual> | null | undefined,
): string {
  const indi = individuals?.[individualId];
  if (!indi) return individualId.replace(/^@+|@+$/g, '') || 'unknown';
  const g = (indi.givenName || '').trim();
  const s = (indi.surname || '').trim();
  const combined = `${g} ${s}`.trim();
  if (combined) return combined.replace(/\s+/g, '_');
  const n = (indi.name || '').replace(/\//g, '').trim().replace(/\s+/g, '_');
  if (n) return n;
  return individualId.replace(/^@+|@+$/g, '') || 'unknown';
}

function shouldReplaceOnlinePhotoTitle(title: string): boolean {
  const t = title.trim();
  if (!t || t === 'Untitled') return true;
  if (t.startsWith('Wikipedia (')) return true;
  return false;
}

/** Démo « Rois et reines d’Europe » : Louis XIV dans le bundle enrichi (IDs GEDCOM usuels). */
const ROYALS_DEMO_LOUIS_IDS = ['I1341', '@I1341@'] as const;

function findIndividualForRoyalsDemo(data: GedcomData): Individual | null {
  for (const id of ROYALS_DEMO_LOUIS_IDS) {
    const indi = data.individuals[id];
    if (indi) return indi;
  }
  return null;
}

type AutoSaveSnapshot = {
  savedAt: string;
  databaseName: string;
  originalGedcomData: GedcomData;
  documentsByIndividualId: Record<string, unknown>;
  selfIdentity: SelfIdentityPublic | null;
};

const openAutoSaveDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(AUTOSAVE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(AUTOSAVE_STORE_NAME)) {
        db.createObjectStore(AUTOSAVE_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const saveAutoSaveSnapshot = async (snapshot: AutoSaveSnapshot): Promise<void> => {
  const db = await openAutoSaveDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(AUTOSAVE_STORE_NAME, 'readwrite');
    tx.objectStore(AUTOSAVE_STORE_NAME).put(snapshot, AUTOSAVE_RECORD_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
};

const readAutoSaveSnapshot = async (): Promise<AutoSaveSnapshot | null> => {
  const db = await openAutoSaveDb();
  const result = await new Promise<AutoSaveSnapshot | null>((resolve, reject) => {
    const tx = db.transaction(AUTOSAVE_STORE_NAME, 'readonly');
    const req = tx.objectStore(AUTOSAVE_STORE_NAME).get(AUTOSAVE_RECORD_KEY);
    req.onsuccess = () => resolve((req.result as AutoSaveSnapshot | undefined) || null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
};

function App() {
  const { language, toggleLanguage, t } = useI18n();
  type P2PSessionUseCase = 'share' | 'compare' | null;
  type P2PRole = 'viewer' | 'contributor' | 'editor';
  type P2PVisibilitySettings = {
    exposeIdentity: boolean;
    exposeDates: boolean;
    exposePlaces: boolean;
    exposeNotes: boolean;
    allowDocuments: boolean;
    allowDownload: boolean;
    allowProposal: boolean;
    allowDirectEdit: boolean;
  };

  type P2PInviteItem = {
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
  };

  type P2PProposalItem = {
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

  type IndividualDocument = {
    id: string;
    title: string;
    url: string;
    source: 'local' | 'online';
    kind: 'photo' | 'document';
    date?: string;
    /** Texte libre ou URL (crédit / provenance, ex. « Wikipedia » ou lien). */
    sourceAttribution?: string;
    isPrimaryPhoto?: boolean;
  };

  const isImageLikeUrl = (url: string): boolean => {
    if (!url) return false;
    if (url.startsWith('data:image/')) return true;
    if (url.startsWith('blob:')) return true;
    const u = url.trim();
    if (u.startsWith('http://') || u.startsWith('https://')) {
      if (/upload\.wikimedia\.org/i.test(u)) return true;
      if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(u)) return true;
    }
    return /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(url);
  };

  const normalizeDocumentsByIndividual = (
    input: Record<string, unknown> | null | undefined,
    individuals?: Record<string, Individual> | null,
  ): Record<string, IndividualDocument[]> => {
    if (!input || typeof input !== 'object') return {};
    const normalized: Record<string, IndividualDocument[]> = {};

    for (const [individualId, rawDocs] of Object.entries(input)) {
      if (!Array.isArray(rawDocs)) continue;
      const baseSlug = displayNameSlugForOnlineDocTitle(individualId, individuals);
      let onlinePhotoAutoSeq = 0;
      const docs = rawDocs
        .map((raw) => {
          if (!raw || typeof raw !== 'object') return null;
          const doc = raw as Record<string, unknown>;
          const url = typeof doc.url === 'string' ? doc.url : '';
          if (!url) return null;
          const kind: 'photo' | 'document' =
            doc.kind === 'photo' || isImageLikeUrl(url) ? 'photo' : 'document';
          const source: 'local' | 'online' =
            doc.source === 'local' || doc.source === 'online' ? doc.source : 'online';
          const isPrimaryPhoto =
            (doc.isPrimaryPhoto === true || (doc as { isPrimary?: boolean }).isPrimary === true) && kind === 'photo';
          let title: string = typeof doc.title === 'string' ? doc.title : 'Untitled';
          const isOnlinePhoto =
            kind === 'photo' &&
            (source === 'online' || url.startsWith('http://') || url.startsWith('https://'));
          if (isOnlinePhoto && shouldReplaceOnlinePhotoTitle(title)) {
            onlinePhotoAutoSeq += 1;
            title = `${baseSlug}_${String(onlinePhotoAutoSeq).padStart(2, '0')}`;
          }
          const rawAttr = (doc as Record<string, unknown>).sourceAttribution;
          const sourceAttribution =
            typeof rawAttr === 'string' && rawAttr.trim() !== '' ? rawAttr.trim() : undefined;
          return {
            id: typeof doc.id === 'string' ? doc.id : `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            title,
            url,
            source,
            kind,
            date: typeof doc.date === 'string' ? doc.date : undefined,
            sourceAttribution,
            isPrimaryPhoto,
          } as IndividualDocument;
        })
        .filter((d): d is IndividualDocument => !!d);

      if (docs.length > 0 && !docs.some((d) => d.kind === 'photo' && d.isPrimaryPhoto)) {
        const firstPhoto = docs.find((d) => d.kind === 'photo');
        if (firstPhoto) firstPhoto.isPrimaryPhoto = true;
      }

      normalized[individualId] = docs;
    }
    return normalized;
  };

  // Conservative chunk size for mobile/browser DataChannel compatibility.
  const SYNC_CHUNK_SIZE = 12_000;
  const SYNC_CHUNK_SEND_DELAY_MS = 8;
  const SYNC_CHUNK_RECEIVE_TIMEOUT_MS = 45000;
  const DOCUMENT_SYNC_CHUNK_SIZE = 48_000;
  const BUNDLE_SYNC_CHUNK_SIZE = 56_000;
  const NORMALIZED_SNAPSHOT_CHUNK_SIZE = 20_000;
  const NORMALIZATION_ALGO_VERSION = 'g2norm-v1';
  const INITIAL_DIFF_BATCH_LIMIT = 300;
  const INITIAL_DIFF_MAX_RETRY = 1;
  const INITIAL_DIFF_REQUEST_TIMEOUT_MS = 12000;
  type InitialDiffContext = {
    requestToken: string;
    batchId: string;
    retryCount: number;
    pendingRequestIds: string[];
    potentialMatchesBySenderId: Record<string, IndividualDiffPotentialMatch>;
    startedAt: number;
  };
  type RejectedInitialMatchMap = Record<string, Set<string>>;
  type P2PTransferMode = 'progressive' | 'bundle';
  type P2PBundleContentMode = 'gedcom-only' | 'gedcom-and-documents';

  const sendBundleSnapshotToPeer = async (
    gedcom: GedcomData,
    documents: Record<string, IndividualDocument[]>
  ) => {
    if (p2pModeRef.current !== 'host') return;
    const includeDocuments = p2pBundleContentModeRef.current === 'gedcom-and-documents';
    const transferable = includeDocuments
      ? await toTransferableDocumentsForPeer(documents)
      : {};
    const gedcomText = generateGedcom(gedcom);
    const normalizedGedcomText = generateGedcom(normalizeGedcom(gedcom));
    const bundleBlob = await createG2Bundle(gedcomText, {
      version: '1.0',
      databaseName: databaseNameRef.current,
      exportedAt: new Date().toISOString(),
      documentsByIndividualId: transferable,
      includesDocuments: includeDocuments,
      normalizedGedcomContent: normalizedGedcomText,
      normalizationAlgoVersion: NORMALIZATION_ALGO_VERSION,
    });
    const serialized = await bundleBlob.text();
    if (serialized.length <= BUNDLE_SYNC_CHUNK_SIZE) {
      p2pService.sendMessage('BUNDLE_SYNC', {
        bundleContent: serialized,
      });
      return;
    }
    const transferId = `bundle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const totalChunks = Math.ceil(serialized.length / BUNDLE_SYNC_CHUNK_SIZE);
    for (let index = 0; index < totalChunks; index += 1) {
      const chunk = serialized.slice(index * BUNDLE_SYNC_CHUNK_SIZE, (index + 1) * BUNDLE_SYNC_CHUNK_SIZE);
      window.setTimeout(() => {
        p2pService.sendMessage('BUNDLE_SYNC_CHUNK', {
          transferId,
          index,
          totalChunks,
          chunk,
        });
      }, index * 4);
    }
  };

  const sendP2PSnapshot = (
    gedcom: GedcomData,
    documents: Record<string, IndividualDocument[]>,
    source: 'sync.sent' | 'sync.refresh',
    options?: { forceBundle?: boolean }
  ) => {
    if (p2pModeRef.current !== 'host') return;
    const transferMode: P2PTransferMode =
      options?.forceBundle || p2pTransferModeRef.current === 'bundle'
        ? 'bundle'
        : 'progressive';
    if (transferMode === 'bundle') {
      setP2PSyncStatusText('applying');
      void sendBundleSnapshotToPeer(gedcom, documents).finally(() => {
        window.setTimeout(() => setP2PSyncStatusText('done'), 300);
        window.setTimeout(() => setP2PSyncStatusText(null), 2500);
      });
      logP2PActivity(`${source}.bundle`, 'session', peerId || 'host');
      return;
    }
    const gedcomText = generateGedcom(gedcom);
    const transferId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const totalChunks = Math.ceil(gedcomText.length / SYNC_CHUNK_SIZE);
    setP2PSyncStatusText(`sending 0/${totalChunks}`);
    for (let index = 0; index < totalChunks; index += 1) {
      const start = index * SYNC_CHUNK_SIZE;
      const chunk = gedcomText.slice(start, start + SYNC_CHUNK_SIZE);
      window.setTimeout(() => {
        p2pService.sendMessage('SYNC_GEDCOM_CHUNK', {
          transferId,
          index,
          totalChunks,
          chunk,
          databaseName: databaseNameRef.current,
          sentAt: new Date().toISOString(),
        });
        const nextCount = index + 1;
        if (nextCount === 1 || nextCount === totalChunks || nextCount % 12 === 0) {
          setP2PSyncStatusText(`sending ${nextCount}/${totalChunks}`);
        }
        if (index + 1 === totalChunks) {
          window.setTimeout(() => setP2PSyncStatusText('waiting apply'), 250);
        }
      }, index * SYNC_CHUNK_SEND_DELAY_MS);
    }
    if (Object.keys(documents).length > 0) {
      const docsDelay = Math.max(500, totalChunks * SYNC_CHUNK_SEND_DELAY_MS + 650);
      if (snapshotDocumentsSendTimerRef.current !== null) {
        window.clearTimeout(snapshotDocumentsSendTimerRef.current);
      }
      snapshotDocumentsSendTimerRef.current = window.setTimeout(() => {
        void (async () => {
          const transferable = await toTransferableDocumentsForPeer(documents);
          sendDocumentsSnapshotInBatches(transferable);
        })();
        snapshotDocumentsSendTimerRef.current = null;
      }, docsDelay);
    }
    const normalizedDelay = Math.max(350, totalChunks * SYNC_CHUNK_SEND_DELAY_MS + 400);
    window.setTimeout(() => {
      sendNormalizedSnapshotToPeer(gedcom);
    }, normalizedDelay);
    logP2PActivity(source, 'session', peerId || 'host');
  };

  const sendNormalizedSnapshotToPeer = (gedcom: GedcomData) => {
    if (p2pModeRef.current !== 'host') return;
    const normalized = normalizeGedcom(gedcom);
    const serialized = JSON.stringify(normalized);
    if (serialized.length <= NORMALIZED_SNAPSHOT_CHUNK_SIZE) {
      p2pService.sendMessage('NORMALIZED_SNAPSHOT', {
        normalizedGedcom: normalized,
        algoVersion: NORMALIZATION_ALGO_VERSION,
      });
      return;
    }
    const transferId = `norm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const totalChunks = Math.ceil(serialized.length / NORMALIZED_SNAPSHOT_CHUNK_SIZE);
    for (let index = 0; index < totalChunks; index += 1) {
      const chunk = serialized.slice(index * NORMALIZED_SNAPSHOT_CHUNK_SIZE, (index + 1) * NORMALIZED_SNAPSHOT_CHUNK_SIZE);
      window.setTimeout(() => {
        p2pService.sendMessage('NORMALIZED_SNAPSHOT_CHUNK', {
          transferId,
          index,
          totalChunks,
          chunk,
          algoVersion: NORMALIZATION_ALGO_VERSION,
        });
      }, index * 4);
    }
  };

  const computeMediaStats = (documents: Record<string, IndividualDocument[]>) => {
    let documentItems = 0;
    let photoItems = 0;
    for (const docs of Object.values(documents)) {
      for (const doc of docs || []) {
        if (doc.kind === 'photo' || isImageLikeUrl(doc.url)) photoItems += 1;
        else documentItems += 1;
      }
    }
    return { documentItems, photoItems };
  };

  const blobToDataUrl = async (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });

  const blobImageUrlToDataUrlViaCanvas = async (blobUrl: string): Promise<string | null> =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width || 1;
          canvas.height = img.naturalHeight || img.height || 1;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/jpeg', 0.9));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = blobUrl;
    });

  const toTransferableDocumentsForPeer = async (
    documents: Record<string, IndividualDocument[]>
  ): Promise<Record<string, IndividualDocument[]>> => {
    const result: Record<string, IndividualDocument[]> = {};
    for (const [individualId, docs] of Object.entries(documents)) {
      result[individualId] = await Promise.all((docs || []).map(async (doc) => {
        if (!doc.url.startsWith('blob:')) return doc;
        try {
          const response = await fetch(doc.url);
          if (!response.ok) return doc;
          const blob = await response.blob();
          const dataUrl = await blobToDataUrl(blob);
          return { ...doc, url: dataUrl, source: 'local' as const };
        } catch {
          const fallbackDataUrl = await blobImageUrlToDataUrlViaCanvas(doc.url);
          if (fallbackDataUrl) {
            return { ...doc, url: fallbackDataUrl, source: 'local' as const };
          }
          return doc;
        }
      }));
    }
    return result;
  };

  const sendDocumentsToPeer = (
    documents: Record<string, IndividualDocument[]>,
    target: string = selectedIndividual?.id || 'documents',
    mode: 'full' | 'partial' = 'partial',
    options?: {
      batchIndex?: number;
      batchTotal?: number;
      totalDocumentItems?: number;
      totalPhotoItems?: number;
    }
  ) => {
    const allowDocuments =
      p2pModeRef.current === 'client'
        ? (remoteAccessPolicy?.allowDocuments ?? true)
        : visibilitySettingsRef.current.allowDocuments;
    if (!allowDocuments) return;
    const isPartial = mode === 'partial' && target !== 'documents' && !!target;
    const documentsPayload = isPartial ? { [target]: documents[target] || [] } : documents;
    const payloadStats = computeMediaStats(documentsPayload);
    const meta = {
      databaseName: databaseNameRef.current,
      authorPeerId: peerId || 'peer',
      updatedAt: new Date().toISOString(),
      partial: isPartial,
      scopeIndividualId: isPartial ? target : undefined,
      batchIndex: options?.batchIndex,
      batchTotal: options?.batchTotal,
      documentItemsInPayload: payloadStats.documentItems,
      photoItemsInPayload: payloadStats.photoItems,
      documentItemsTotal: options?.totalDocumentItems,
      photoItemsTotal: options?.totalPhotoItems,
    };
    const serialized = JSON.stringify(documentsPayload);
    if (serialized.length <= DOCUMENT_SYNC_CHUNK_SIZE) {
      p2pService.sendMessage('DOCUMENTS_SYNC', {
        ...meta,
        documentsByIndividualId: documentsPayload,
      });
    } else {
      const transferId = `docs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const totalChunks = Math.ceil(serialized.length / DOCUMENT_SYNC_CHUNK_SIZE);
      for (let index = 0; index < totalChunks; index += 1) {
        const chunk = serialized.slice(index * DOCUMENT_SYNC_CHUNK_SIZE, (index + 1) * DOCUMENT_SYNC_CHUNK_SIZE);
        window.setTimeout(() => {
          p2pService.sendMessage('DOCUMENTS_SYNC_CHUNK', {
            transferId,
            index,
            totalChunks,
            chunk,
            ...meta,
          });
        }, index * 4);
      }
    }
    logP2PActivity(isPartial ? 'documents.sync.sent.partial' : 'documents.sync.sent.full', 'individual', target, peerId || 'peer');
  };

  const sendDocumentPatchToPeer = (
    patch: {
      operation: 'add' | 'update' | 'remove' | 'set_primary';
      individualId: string;
      doc?: IndividualDocument;
      docId?: string;
      patch?: Partial<IndividualDocument>;
    }
  ) => {
    const allowDocuments =
      p2pModeRef.current === 'client'
        ? (remoteAccessPolicy?.allowDocuments ?? true)
        : visibilitySettingsRef.current.allowDocuments;
    if (!allowDocuments) return;
    const buildDocumentsSnapshotAfterPatch = (): Record<string, IndividualDocument[]> => {
      const snapshot = documentsRef.current;
      const current = snapshot[patch.individualId] || [];
      let next = current;
      if (patch.operation === 'add' && patch.doc) {
        const normalized =
          normalizeDocumentsByIndividual({ [patch.individualId]: [patch.doc] }, gedcomDataRef.current?.individuals)[
            patch.individualId
          ] || [];
        const incoming = normalized[0];
        if (incoming) {
          const deduped = current.filter((d) => d.id !== incoming.id);
          const shouldBecomePrimary = incoming.kind === 'photo' && !deduped.some((d) => d.kind === 'photo' && d.isPrimaryPhoto);
          next = [...deduped, shouldBecomePrimary ? { ...incoming, isPrimaryPhoto: true } : incoming];
        }
      } else if (patch.operation === 'update' && patch.docId) {
        next = current.map((doc) => {
          if (doc.id !== patch.docId) return doc;
          const nextUrl = typeof patch.patch?.url === 'string' ? patch.patch.url : doc.url;
          const nextKind: 'photo' | 'document' =
            patch.patch?.kind === 'photo' || patch.patch?.kind === 'document'
              ? patch.patch.kind
              : ((isImageLikeUrl(nextUrl) || doc.kind === 'photo') ? 'photo' : 'document');
          return {
            ...doc,
            ...patch.patch,
            kind: nextKind,
            date: patch.patch?.date === '' ? undefined : (patch.patch?.date ?? doc.date),
            sourceAttribution:
              patch.patch?.sourceAttribution === ''
                ? undefined
                : typeof patch.patch?.sourceAttribution === 'string'
                  ? patch.patch.sourceAttribution.trim() || undefined
                  : doc.sourceAttribution,
          };
        });
      } else if (patch.operation === 'remove' && patch.docId) {
        next = current.filter((doc) => doc.id !== patch.docId);
        if (!next.some((d) => d.kind === 'photo' && d.isPrimaryPhoto)) {
          const firstPhoto = next.find((d) => d.kind === 'photo');
          if (firstPhoto) {
            next = next.map((d) => (d.id === firstPhoto.id ? { ...d, isPrimaryPhoto: true } : d));
          }
        }
      } else if (patch.operation === 'set_primary' && patch.docId) {
        next = current.map((doc) =>
          (doc.kind === 'photo' || isImageLikeUrl(doc.url))
            ? { ...doc, kind: 'photo', isPrimaryPhoto: doc.id === patch.docId }
            : doc
        );
      }
      if (next === current) return snapshot;
      return { ...snapshot, [patch.individualId]: next };
    };
    window.setTimeout(() => {
      p2pService.sendMessage('DOCUMENT_PATCH', {
        ...patch,
        authorPeerId: peerId || 'peer',
        updatedAt: new Date().toISOString(),
      });
      // Reliability fallback: also send a scoped DOCUMENTS_SYNC snapshot
      // for peers that may miss patch notifications in some browser/runtime paths.
      if (p2pModeRef.current === 'client') {
        window.setTimeout(() => {
          sendDocumentsToPeer(buildDocumentsSnapshotAfterPatch(), patch.individualId, 'partial');
        }, 120);
      }
    }, 0);
    logP2PActivity('documents.patch.sent', 'individual', patch.individualId, peerId || 'peer');
  };

  const sendDocumentsSnapshotInBatches = (documents: Record<string, IndividualDocument[]>) => {
    const entries = Object.entries(documents);
    if (entries.length === 0) return;
    const stats = computeMediaStats(documents);
    const total = entries.length;
    entries.forEach(([individualId], index) => {
      window.setTimeout(() => {
        sendDocumentsToPeer(
          documents,
          individualId,
          'partial',
          {
            batchIndex: index + 1,
            batchTotal: total,
            totalDocumentItems: stats.documentItems,
            totalPhotoItems: stats.photoItems,
          }
        );
      }, index * 8);
    });
  };

  const [originalGedcomData, setOriginalGedcomData] = useState<GedcomData | null>(null);
  const [normalizedGedcomData, setNormalizedGedcomData] = useState<GedcomData | null>(null);
  const [isNormalized, setIsNormalized] = useState(false);
  
  // The active data used for visualization
  // FIXED: Always use original if normalized is not ready yet
  const gedcomData = isNormalized && normalizedGedcomData ? normalizedGedcomData : originalGedcomData;

  const [databaseName, setDatabaseName] = useState<string>("My Family Tree");
  
  const [rootIndividual, setRootIndividual] = useState<Individual | null>(null);
  const [selectedIndividual, setSelectedIndividual] = useState<Individual | null>(null);
  
  // Selection state for 2D View (Multiple individuals)
  const [selectedIdsFor2D, setSelectedIdsFor2D] = useState<Set<string>>(new Set());
  
  // State for 3D View (Expanded individuals)
  const [sceneExtras, setSceneExtras] = useState<RenderedPerson[]>([]);

  const [showBoxes, setShowBoxes] = useState(true);
  const [showAxes, setShowAxes] = useState(false);
  
  // Panels closed by default
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [topPanelOpen, setTopPanelOpen] = useState(false);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(false);
  const [documentsTabSignal, setDocumentsTabSignal] = useState(0);

  const [isCreating, setIsCreating] = useState(false);
  
  // Initialize Theme: Check system preference or default to Dark Mode (No more random)
  const [isDarkMode, setIsDarkMode] = useState(() => {
     if (typeof window !== 'undefined' && window.matchMedia) {
         return window.matchMedia('(prefers-color-scheme: dark)').matches;
     }
     return true; // Default to Dark
  });
  
  // New UI Controls State
  const [isLoading, setIsLoading] = useState(false);
  const [dragMode, setDragMode] = useState<DragMode>('descendants');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('2d-grid');
  const [flyTarget, setFlyTarget] = useState<CameraMode | null>(null);
  /** Transition de zoom ortho entre vue grille 2D et vue individu (évite le saut de taille du ruban). */
  const [twoDOrthoHandoff, setTwoDOrthoHandoff] = useState<
    { role: 'enteringIndividual' | 'enteringGrid'; zoom: number } | null
  >(null);
  /** Dernier zoom ortho connu en vue 2D individuelle (handoff vers intro 3D top). */
  const last2DOrthoZoomRef = useRef<number | null>(null);
  const [topViewEntryFrom2D, setTopViewEntryFrom2D] = useState<{ orthoZoom2d?: number } | null>(null);

  const viewMode: ViewMode = displayMode.startsWith('3d') ? '3D' : '2D';
  const cameraMode: CameraMode = displayMode === '3d-individual' ? 'individual'
    : displayMode === '3d-top' ? 'top' : displayMode === '3d-free' ? 'free' : 'top';
  const is2dIndividual = displayMode === '2d-individual';
  // CHANGED: Default sort to 'birth-asc' so Ancestors are Left (Oldest), Descendants Right (Newest)
  const [sortMode, setSortMode] = useState<SortMode>('birth-asc'); 
  const [centerRequest, setCenterRequest] = useState(0);
  const [activeFilters, setActiveFilters] = useState<Set<FilterTag>>(new Set());

  // Auto Layout State
  const [autoLayoutMode, setAutoLayoutMode] = useState<'none' | 'ancestors' | 'descendants' | 'all'>('all');
  const [treeDirection, setTreeDirection] = useState<'ancestors' | 'descendants' | null>(null);
  const [layoutParams, setLayoutParams] = useState<LayoutParams>({ ...DEFAULT_LAYOUT_PARAMS });
  
  // Info Pages State
  const [activeInfoPage, setActiveInfoPage] = useState<'about' | 'contribute' | 'contact' | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const buildLabel = `${import.meta.env.MODE}:${window.location.host}`;
  const [programUpdateState, setProgramUpdateState] = useState<'idle' | 'checking' | 'available' | 'updating' | 'error' | 'unsupported'>('idle');
  const [isShortcutModifierPressed, setIsShortcutModifierPressed] = useState(false);
  const [emulateRevealShortcut, setEmulateRevealShortcut] = useState(false);
  const [topViewLabelMaxZSpan, setTopViewLabelMaxZSpan] = useState(500);
  const [labelFontSize, setLabelFontSize] = useState(3);
  const relationshipRevealEnabled = isShortcutModifierPressed || emulateRevealShortcut;
  
  // Track if mouse is over UI to disable 3D controls
  const [isHoveringUI, setIsHoveringUI] = useState(false);

  // --- P2P State ---
  const [p2pStatus, setP2pStatus] = useState<P2PStatus>('disconnected');
  const [peerId, setPeerId] = useState<string | null>(null);
  const [p2pMode, setP2pMode] = useState<P2PMode>(null);
  const [p2pActivityEvents, setP2PActivityEvents] = useState<ActivityLogEvent[]>([]);
  const [p2pInvites, setP2PInvites] = useState<P2PInviteItem[]>([]);
  const [p2pProposals, setP2PProposals] = useState<P2PProposalItem[]>([]);
  const [activeReviewProposalId, setActiveReviewProposalId] = useState<string | null>(null);
  const [reviewFocusSignal, setReviewFocusSignal] = useState(0);
  const [webglRecoveryKey, setWebglRecoveryKey] = useState(0);
  const [documentsByIndividualId, setDocumentsByIndividualId] = useState<Record<string, IndividualDocument[]>>({});
  const [remoteIdentityClaimsByIndividualId, setRemoteIdentityClaimsByIndividualId] = useState<Record<string, { claimedAt: string; actorPeerId: string }>>({});
  const [selfIdentity, setSelfIdentity] = useState<SelfIdentityPublic | null>(() => {
    try {
      const raw = localStorage.getItem(SELF_IDENTITY_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as SelfIdentityPublic;
      if (!parsed?.individualId || !parsed?.deviceKeyId) return null;
      return parsed;
    } catch {
      return null;
    }
  });
  const [isIdentifyingSelf, setIsIdentifyingSelf] = useState(false);
  const [identityTabSignal, setIdentityTabSignal] = useState(0);
  const [bundleToast, setBundleToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(AUTOSAVE_SETTINGS_KEY);
      return raw === null ? true : raw === '1';
    } catch {
      return true;
    }
  });
  const [autoSaveState, setAutoSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [autoSaveLastAt, setAutoSaveLastAt] = useState<string | null>(null);
  const [hasAutoSaveDraft, setHasAutoSaveDraft] = useState(false);
  const [p2pSyncStatusText, setP2PSyncStatusText] = useState<string | null>(null);
  const [initialCompareStatusText, setInitialCompareStatusText] = useState<string | null>(null);
  const [p2pSessionUseCase, setP2PSessionUseCase] = useState<P2PSessionUseCase>(null);
  const [remotePeerHasData, setRemotePeerHasData] = useState<boolean | null>(null);
  const [p2pTransferMode, setP2PTransferMode] = useState<P2PTransferMode>(() => {
    const saved = localStorage.getItem(P2P_TRANSFER_MODE_KEY);
    return saved === 'progressive' ? 'progressive' : 'bundle';
  });
  const [p2pBundleContentMode, setP2PBundleContentMode] = useState<P2PBundleContentMode>(() => {
    const saved = localStorage.getItem(P2P_BUNDLE_CONTENT_MODE_KEY);
    return saved === 'gedcom-only' ? 'gedcom-only' : 'gedcom-and-documents';
  });
  const readInviteTokenFromLocation = (): string | null => {
    const search = new URLSearchParams(window.location.search);
    const fromQuery = search.get('g2invite');
    if (fromQuery) return fromQuery;
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
    if (!hash) return null;
    const hashParams = new URLSearchParams(hash);
    return hashParams.get('g2invite');
  };

  const [pendingInviteToken, setPendingInviteToken] = useState<string | null>(() => readInviteTokenFromLocation());
  const [pendingInviteHostPeerId, setPendingInviteHostPeerId] = useState<string | null>(null);
  const [pendingInviteTargetIndividualId, setPendingInviteTargetIndividualId] = useState<string | null>(null);
  const [pendingInviteInviterName, setPendingInviteInviterName] = useState<string | null>(null);
  const [pendingInviteRole, setPendingInviteRole] = useState<P2PRole | null>(null);
  const [inviteOnboardingStage, setInviteOnboardingStage] = useState<'idle' | 'connecting' | 'connected' | 'accepted' | 'syncing' | 'completed' | 'ready' | 'error'>('idle');
  const [inviteMediaProgress, setInviteMediaProgress] = useState<{
    receivedBatches: number;
    totalBatches: number;
    receivedDocs: number;
    totalDocs: number;
    receivedPhotos: number;
    totalPhotos: number;
  } | null>(null);
  const [inviteGedcomProgress, setInviteGedcomProgress] = useState<{
    receivedChunks: number;
    totalChunks: number;
    applied: boolean;
  } | null>(null);
  const [inviteNormalizedProgress, setInviteNormalizedProgress] = useState<{
    receivedChunks: number;
    totalChunks: number;
    applied: boolean;
    fallbackLocal: boolean;
  } | null>(null);
  const [inviteHasAccepted, setInviteHasAccepted] = useState(false);
  const [inviteRibbonFirstRenderDone, setInviteRibbonFirstRenderDone] = useState(false);
  const [inviteSceneDeferred, setInviteSceneDeferred] = useState(false);
  const [inviteMediaRecoveryInFlight, setInviteMediaRecoveryInFlight] = useState(false);
  const [p2pVisibilitySettings, setP2PVisibilitySettings] = useState<P2PVisibilitySettings>({
    exposeIdentity: true,
    exposeDates: true,
    exposePlaces: false,
    exposeNotes: false,
    allowDocuments: true,
    allowDownload: true,
    allowProposal: true,
    allowDirectEdit: false,
  });
  const [remoteAccessPolicy, setRemoteAccessPolicy] = useState<P2PVisibilitySettings | null>(null);
  const [activeSessionPeerPolicy, setActiveSessionPeerPolicy] = useState<P2PVisibilitySettings | null>(null);
  const isIdentified = !!selfIdentity && selfIdentity.status !== 'unidentified';

  // Keep ref to data for P2P sync (closure issue)
  const gedcomDataRef = useRef<GedcomData | null>(null);
  const p2pModeRef = useRef<P2PMode>(null);
  const p2pTransferModeRef = useRef<P2PTransferMode>(p2pTransferMode);
  const p2pBundleContentModeRef = useRef<P2PBundleContentMode>(p2pBundleContentMode);
  const p2pSessionUseCaseRef = useRef<P2PSessionUseCase>(null);
  const visibilitySettingsRef = useRef<P2PVisibilitySettings>(p2pVisibilitySettings);
  const documentsRef = useRef<Record<string, IndividualDocument[]>>({});
  const databaseNameRef = useRef<string>(databaseName);
  const webglRecoveryInFlightRef = useRef(false);
  const webglLastRecoveryAtRef = useRef(0);
  const webglRecoverySuppressedUntilRef = useRef(0);
  const webglRecoveryTimerRef = useRef<number | null>(null);
  const inviteWebglRecoveryQueuedRef = useRef(false);
  // Verrou synchrone anti double-tap : bloque handleSetDisplayMode jusqu'au prochain render
  const isSwitchingModeRef = useRef(false);
  // Anti-storm: track consecutive rapid recoveries to enforce a long backoff.
  const webglRecoveryCountRef = useRef(0);
  const webglRecoveryWindowStartRef = useRef(0);
  const bundleToastTimeoutRef = useRef<number | null>(null);
  const syncChunkReceiveTimeoutRef = useRef<number | null>(null);
  const snapshotDocumentsSendTimerRef = useRef<number | null>(null);
  const incomingSyncChunksRef = useRef<Record<string, {
    totalChunks: number;
    databaseName?: string;
    parts: string[];
    received: number;
  }>>({});
  const incomingDocumentChunksRef = useRef<Record<string, {
    totalChunks: number;
    parts: string[];
    received: number;
    meta: {
      authorPeerId?: string;
      partial?: boolean;
      scopeIndividualId?: string;
      batchIndex?: number;
      batchTotal?: number;
      documentItemsInPayload?: number;
      photoItemsInPayload?: number;
      documentItemsTotal?: number;
      photoItemsTotal?: number;
    };
  }>>({});
  const incomingNormalizedChunksRef = useRef<Record<string, {
    totalChunks: number;
    parts: string[];
    received: number;
    algoVersion?: string;
  }>>({});
  const incomingBundleChunksRef = useRef<Record<string, {
    totalChunks: number;
    parts: string[];
    received: number;
  }>>({});
  const syncReceivingInProgressRef = useRef(false);
  const pendingIncomingDocumentsRef = useRef<Record<string, IndividualDocument[]> | null>(null);
  const normalizedSnapshotAppliedRef = useRef(false);
  const pendingNormalizationFallbackTimerRef = useRef<number | null>(null);
  const initialDiffContextsRef = useRef<Record<string, InitialDiffContext>>({});
  const initialDiffTimeoutHandlesRef = useRef<Record<string, number>>({});
  const initialDiffSeenProposalKeysRef = useRef<Set<string>>(new Set());
  const rejectedInitialMatchesRef = useRef<RejectedInitialMatchMap>({});
  const serviceWorkerRegistrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const isRestoringAutoSaveRef = useRef(false);
  const inviteAutoConnectAttemptedRef = useRef(false);
  const p2pInvitesRef = useRef<P2PInviteItem[]>([]);
  const activeSessionPeerPolicyRef = useRef<P2PVisibilitySettings | null>(null);
  const originalGedcomDataRef = useRef<GedcomData | null>(null);
  const syncApplyingInProgressRef = useRef(false);
  const normalizeTimeoutRef = useRef<number | null>(null);
  const normalizeIdleHandleRef = useRef<number | null>(null);
  const inviteAcceptRequestedRef = useRef(false);
  const inviteOnboardingDismissTimerRef = useRef<number | null>(null);
  const inviteUiReadyTimerRef = useRef<number | null>(null);
  const inviteRibbonRenderRaf1Ref = useRef<number | null>(null);
  const inviteRibbonRenderRaf2Ref = useRef<number | null>(null);
  const pendingInviteTokenRef = useRef<string | null>(pendingInviteToken);
  const inviteReceivedDocumentScopesRef = useRef<Set<string>>(new Set());
  const inviteDocsFlushTimerRef = useRef<number | null>(null);
  const inviteSceneResumeTimerRef = useRef<number | null>(null);
  const inviteMediaRecoveryRequestedRef = useRef(false);
  const inviteMediaRecoveryTimerRef = useRef<number | null>(null);
  const inviteMediaRecoveryAttemptRef = useRef(0);
  const inviteOnboardingStageRef = useRef(inviteOnboardingStage);
  // Libère le verrou anti double-tap dès que le mode ou l'animation change
  useEffect(() => { isSwitchingModeRef.current = false; }, [displayMode, flyTarget, topViewEntryFrom2D]);

  // Sécurité : si l'animation de vol 3D ne se termine pas (app backgroundée, contexte perdu…)
  // forcer flyTarget à null après 6s pour éviter que les boutons restent disabled indéfiniment
  useEffect(() => {
    if (topViewEntryFrom2D === null) return;
    const id = window.setTimeout(() => setTopViewEntryFrom2D(null), 8000);
    return () => window.clearTimeout(id);
  }, [topViewEntryFrom2D]);

  useEffect(() => {
    if (flyTarget === null) return;
    const id = window.setTimeout(() => setFlyTarget(null), 6000);
    return () => window.clearTimeout(id);
  }, [flyTarget]);

  useEffect(() => { gedcomDataRef.current = gedcomData; }, [gedcomData]);
  useEffect(() => { visibilitySettingsRef.current = p2pVisibilitySettings; }, [p2pVisibilitySettings]);
  useEffect(() => { documentsRef.current = documentsByIndividualId; }, [documentsByIndividualId]);
  useEffect(() => { pendingInviteTokenRef.current = pendingInviteToken; }, [pendingInviteToken]);
  useEffect(() => { databaseNameRef.current = databaseName; }, [databaseName]);
  useEffect(() => { p2pSessionUseCaseRef.current = p2pSessionUseCase; }, [p2pSessionUseCase]);
  useEffect(() => {
    p2pTransferModeRef.current = p2pTransferMode;
    localStorage.setItem(P2P_TRANSFER_MODE_KEY, p2pTransferMode);
  }, [p2pTransferMode]);
  useEffect(() => {
    p2pBundleContentModeRef.current = p2pBundleContentMode;
    localStorage.setItem(P2P_BUNDLE_CONTENT_MODE_KEY, p2pBundleContentMode);
  }, [p2pBundleContentMode]);
  useEffect(() => { inviteOnboardingStageRef.current = inviteOnboardingStage; }, [inviteOnboardingStage]);
  useEffect(() => { p2pInvitesRef.current = p2pInvites; }, [p2pInvites]);
  useEffect(() => { activeSessionPeerPolicyRef.current = activeSessionPeerPolicy; }, [activeSessionPeerPolicy]);
  useEffect(() => { originalGedcomDataRef.current = originalGedcomData; }, [originalGedcomData]);
  useEffect(() => {
    try {
      if (selfIdentity) {
        localStorage.setItem(SELF_IDENTITY_STORAGE_KEY, JSON.stringify(selfIdentity));
      } else {
        localStorage.removeItem(SELF_IDENTITY_STORAGE_KEY);
      }
    } catch {
      // no-op
    }
  }, [selfIdentity]);
  useEffect(() => {
    try {
      localStorage.setItem(AUTOSAVE_SETTINGS_KEY, autoSaveEnabled ? '1' : '0');
    } catch {
      // no-op
    }
  }, [autoSaveEnabled]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snapshot = await readAutoSaveSnapshot();
        if (!cancelled && snapshot) {
          setHasAutoSaveDraft(true);
          setAutoSaveLastAt(snapshot.savedAt);
        }
      } catch {
        if (!cancelled) setHasAutoSaveDraft(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!autoSaveEnabled || !originalGedcomData || isRestoringAutoSaveRef.current) return;
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = window.setTimeout(async () => {
      try {
        setAutoSaveState('saving');
        const snapshot: AutoSaveSnapshot = {
          savedAt: new Date().toISOString(),
          databaseName,
          originalGedcomData,
          documentsByIndividualId,
          selfIdentity,
        };
        await saveAutoSaveSnapshot(snapshot);
        setAutoSaveLastAt(snapshot.savedAt);
        setAutoSaveState('saved');
        setHasAutoSaveDraft(true);
      } catch (error) {
        console.error('Auto-save failed', error);
        setAutoSaveState('error');
      }
    }, 2200);
    return () => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [autoSaveEnabled, originalGedcomData, documentsByIndividualId, selfIdentity, databaseName]);
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
      if (bundleToastTimeoutRef.current !== null) {
        window.clearTimeout(bundleToastTimeoutRef.current);
      }
      if (syncChunkReceiveTimeoutRef.current !== null) {
        window.clearTimeout(syncChunkReceiveTimeoutRef.current);
      }
      if (snapshotDocumentsSendTimerRef.current !== null) {
        window.clearTimeout(snapshotDocumentsSendTimerRef.current);
      }
      if (pendingNormalizationFallbackTimerRef.current !== null) {
        window.clearTimeout(pendingNormalizationFallbackTimerRef.current);
      }
      incomingDocumentChunksRef.current = {};
      incomingNormalizedChunksRef.current = {};
      if (inviteDocsFlushTimerRef.current !== null) {
        window.clearTimeout(inviteDocsFlushTimerRef.current);
      }
      if (inviteSceneResumeTimerRef.current !== null) {
        window.clearTimeout(inviteSceneResumeTimerRef.current);
      }
      if (inviteUiReadyTimerRef.current !== null) {
        window.clearTimeout(inviteUiReadyTimerRef.current);
      }
      if (inviteRibbonRenderRaf1Ref.current !== null) {
        window.cancelAnimationFrame(inviteRibbonRenderRaf1Ref.current);
      }
      if (inviteRibbonRenderRaf2Ref.current !== null) {
        window.cancelAnimationFrame(inviteRibbonRenderRaf2Ref.current);
      }
      Object.values(initialDiffTimeoutHandlesRef.current).forEach((handle) => {
        window.clearTimeout(handle);
      });
    };
  }, []);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      setProgramUpdateState('unsupported');
      return;
    }
    let cancelled = false;
    const onControllerChange = () => {
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    (async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        if (cancelled) return;
        if (!registration) {
          setProgramUpdateState('unsupported');
          return;
        }
        serviceWorkerRegistrationRef.current = registration;
        if (registration.waiting) {
          setProgramUpdateState('available');
        } else {
          setProgramUpdateState('idle');
        }
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          setProgramUpdateState('checking');
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed') {
              setProgramUpdateState(navigator.serviceWorker.controller ? 'available' : 'idle');
            } else if (installing.state === 'redundant') {
              setProgramUpdateState('error');
            }
          });
        });
      } catch {
        if (!cancelled) setProgramUpdateState('error');
      }
    })();
    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  const resetIncomingSyncTimeout = () => {
    if (syncChunkReceiveTimeoutRef.current !== null) {
      window.clearTimeout(syncChunkReceiveTimeoutRef.current);
    }
    syncChunkReceiveTimeoutRef.current = window.setTimeout(() => {
      incomingSyncChunksRef.current = {};
      syncReceivingInProgressRef.current = false;
      pendingIncomingDocumentsRef.current = null;
      if (p2pModeRef.current === 'client') {
        setP2PSyncStatusText('retry requested');
        p2pService.sendMessage('SYNC_GEDCOM_REQUEST', {
          reason: 'chunk_timeout',
          requesterPeerId: peerId || 'client',
          requestedAt: new Date().toISOString(),
        });
      }
      logP2PActivity('sync.chunk.timeout', 'session', peerId || 'client');
    }, SYNC_CHUNK_RECEIVE_TIMEOUT_MS);
  };

  const applyIncomingDocuments = (documentsRaw: Record<string, unknown>, merge: boolean = false) => {
    const docs = normalizeDocumentsByIndividual(documentsRaw, gedcomDataRef.current?.individuals);
    if (syncReceivingInProgressRef.current) {
      pendingIncomingDocumentsRef.current = merge && pendingIncomingDocumentsRef.current
        ? { ...pendingIncomingDocumentsRef.current, ...docs }
        : docs;
      return;
    }
    const shouldBufferForInvite =
      merge &&
      p2pModeRef.current === 'client' &&
      !!pendingInviteToken &&
      inviteOnboardingStageRef.current !== 'ready';
    if (shouldBufferForInvite) {
      pendingIncomingDocumentsRef.current = pendingIncomingDocumentsRef.current
        ? { ...pendingIncomingDocumentsRef.current, ...docs }
        : docs;
      if (inviteDocsFlushTimerRef.current !== null) {
        window.clearTimeout(inviteDocsFlushTimerRef.current);
      }
      inviteDocsFlushTimerRef.current = window.setTimeout(() => {
        inviteDocsFlushTimerRef.current = null;
        if (!pendingIncomingDocumentsRef.current) return;
        setDocumentsByIndividualId((prev) => ({ ...prev, ...pendingIncomingDocumentsRef.current! }));
        pendingIncomingDocumentsRef.current = null;
      }, 180);
      return;
    }
    if (merge) {
      setDocumentsByIndividualId((prev) => ({ ...prev, ...docs }));
      return;
    }
    setDocumentsByIndividualId(docs);
  };

  const applyIncomingDocumentPatch = (payload: {
    operation?: 'add' | 'update' | 'remove' | 'set_primary';
    individualId?: string;
    doc?: unknown;
    docId?: string;
    patch?: Record<string, unknown>;
  }) => {
    if (!payload.operation || !payload.individualId) return;
    setDocumentsByIndividualId((prev) => {
      const individualId = payload.individualId as string;
      const current = prev[individualId] || [];
      let next = current;
      if (payload.operation === 'add' && payload.doc) {
        const normalized =
          normalizeDocumentsByIndividual({ [individualId]: [payload.doc] }, gedcomDataRef.current?.individuals)[
            individualId
          ] || [];
        const incoming = normalized[0];
        if (!incoming) return prev;
        const deduped = current.filter((d) => d.id !== incoming.id);
        const shouldBecomePrimary = incoming.kind === 'photo' && !deduped.some((d) => d.kind === 'photo' && d.isPrimaryPhoto);
        next = [...deduped, shouldBecomePrimary ? { ...incoming, isPrimaryPhoto: true } : incoming];
      } else if (payload.operation === 'update' && payload.docId) {
        next = current.map((doc) => {
          if (doc.id !== payload.docId) return doc;
          const patch = payload.patch || {};
          const nextUrl = typeof patch.url === 'string' ? patch.url : doc.url;
          const nextKind: 'photo' | 'document' =
            patch.kind === 'photo' || patch.kind === 'document'
              ? patch.kind
              : ((isImageLikeUrl(nextUrl) || doc.kind === 'photo') ? 'photo' : 'document');
          return {
            ...doc,
            ...patch,
            kind: nextKind,
            date: patch.date === '' ? undefined : (typeof patch.date === 'string' ? patch.date : doc.date),
            sourceAttribution:
              patch.sourceAttribution === ''
                ? undefined
                : typeof patch.sourceAttribution === 'string'
                  ? patch.sourceAttribution.trim() || undefined
                  : doc.sourceAttribution,
          };
        });
      } else if (payload.operation === 'remove' && payload.docId) {
        next = current.filter((doc) => doc.id !== payload.docId);
        if (!next.some((d) => d.kind === 'photo' && d.isPrimaryPhoto)) {
          const firstPhoto = next.find((d) => d.kind === 'photo');
          if (firstPhoto) {
            next = next.map((d) => (d.id === firstPhoto.id ? { ...d, isPrimaryPhoto: true } : d));
          }
        }
      } else if (payload.operation === 'set_primary' && payload.docId) {
        next = current.map((doc) =>
          (doc.kind === 'photo' || isImageLikeUrl(doc.url))
            ? { ...doc, kind: 'photo', isPrimaryPhoto: doc.id === payload.docId }
            : doc
        );
      }
      if (next === current) return prev;
      return { ...prev, [individualId]: next };
    });
  };

  const applyIncomingNormalizedGedcom = (
    normalizedRaw: unknown,
    algoVersion?: string
  ) => {
    if (!normalizedRaw || typeof normalizedRaw !== 'object') return;
    if (algoVersion && algoVersion !== NORMALIZATION_ALGO_VERSION) return;
    const normalized = normalizedRaw as GedcomData;
    if (!normalized.individuals || !normalized.families) return;
    normalizedSnapshotAppliedRef.current = true;
    if (pendingNormalizationFallbackTimerRef.current !== null) {
      window.clearTimeout(pendingNormalizationFallbackTimerRef.current);
      pendingNormalizationFallbackTimerRef.current = null;
    }
    setNormalizedGedcomData(normalized);
    setInviteNormalizedProgress((prev) => ({
      receivedChunks: prev?.totalChunks || prev?.receivedChunks || 1,
      totalChunks: prev?.totalChunks || prev?.receivedChunks || 1,
      applied: true,
      fallbackLocal: false,
    }));
  };

  const applyIncomingBundleSnapshot = async (bundleContent: string) => {
    const file = new File([bundleContent], 'p2p-bundle.g2.zip', {
      type: 'application/json;charset=utf-8',
    });
    const { gedcomContent, metadata } = await parseG2Bundle(file);
    if (!gedcomContent) return;
    const incomingGedcom = parseGedcom(gedcomContent);
    if (!incomingGedcom?.individuals || !incomingGedcom?.families) return;
    const normalizedFromBundle = typeof metadata.normalizedGedcomContent === 'string'
      ? parseGedcom(metadata.normalizedGedcomContent)
      : null;
    const hasValidNormalized =
      !!normalizedFromBundle?.individuals &&
      !!normalizedFromBundle?.families &&
      (!metadata.normalizationAlgoVersion || metadata.normalizationAlgoVersion === NORMALIZATION_ALGO_VERSION);
    syncReceivingInProgressRef.current = false;
    setP2PSyncStatusText('applying');
    handleDataLoaded(
      incomingGedcom,
      metadata.databaseName || 'Remote P2P Database',
      {
        preserveDocuments: true,
        skipClientNormalizationFallback: hasValidNormalized,
        incomingNormalizedGedcom: hasValidNormalized ? normalizedFromBundle : null,
        incomingNormalizationAlgoVersion: metadata.normalizationAlgoVersion,
      }
    );
    const hasBundleDocumentsPayload =
      !!metadata.documentsByIndividualId &&
      typeof metadata.documentsByIndividualId === 'object' &&
      Object.keys(metadata.documentsByIndividualId as Record<string, unknown>).length > 0;
    if (hasBundleDocumentsPayload) {
      setDocumentsByIndividualId(
        normalizeDocumentsByIndividual(
          metadata.documentsByIndividualId as Record<string, unknown>,
          incomingGedcom.individuals,
        ),
      );
    }
    if (pendingInviteTokenRef.current && p2pModeRef.current === 'client') {
      setInviteGedcomProgress({
        receivedChunks: 1,
        totalChunks: 1,
        applied: true,
      });
      const docsStats = hasBundleDocumentsPayload
        ? computeMediaStats(
            normalizeDocumentsByIndividual(
              metadata.documentsByIndividualId as Record<string, unknown>,
              incomingGedcom.individuals,
            ),
          )
        : { documentItems: 0, photoItems: 0 };
      setInviteMediaProgress({
        receivedBatches: 1,
        totalBatches: 1,
        receivedDocs: docsStats.documentItems,
        totalDocs: docsStats.documentItems,
        receivedPhotos: docsStats.photoItems,
        totalPhotos: docsStats.photoItems,
      });
      setInviteNormalizedProgress({
        receivedChunks: hasValidNormalized ? 1 : 0,
        totalChunks: hasValidNormalized ? 1 : 0,
        applied: hasValidNormalized,
        fallbackLocal: false,
      });
    }
    setP2PSyncStatusText('done');
    window.setTimeout(() => setP2PSyncStatusText(null), 2500);
    logP2PActivity('sync.bundle.received', 'session', 'remote');
    completeInviteOnboarding();
  };

  const showTransientToast = (
    kind: 'success' | 'error',
    message: string,
    durationMs: number = 2500
  ) => {
    setBundleToast({ kind, message });
    if (bundleToastTimeoutRef.current !== null) {
      window.clearTimeout(bundleToastTimeoutRef.current);
    }
    bundleToastTimeoutRef.current = window.setTimeout(() => setBundleToast(null), durationMs);
  };

  const completeInviteOnboarding = () => {
    if (!pendingInviteTokenRef.current) return;
    if (inviteDocsFlushTimerRef.current !== null) {
      window.clearTimeout(inviteDocsFlushTimerRef.current);
      inviteDocsFlushTimerRef.current = null;
    }
    if (pendingIncomingDocumentsRef.current) {
      setDocumentsByIndividualId((prev) => ({ ...prev, ...pendingIncomingDocumentsRef.current! }));
      pendingIncomingDocumentsRef.current = null;
    }
    const targetId = pendingInviteTargetIndividualId;
    if (targetId && gedcomDataRef.current?.individuals[targetId]) {
      const target = gedcomDataRef.current.individuals[targetId];
      setRootIndividual(target);
      setSelectedIndividual(target);
      setDisplayMode('2d-individual');
      setCenterRequest((prev) => prev + 1);
    }
    setInviteOnboardingStage('completed');
    setInviteRibbonFirstRenderDone(false);
    setInviteGedcomProgress((prev) => prev ? { ...prev, applied: true } : { receivedChunks: 1, totalChunks: 1, applied: true });
    setLeftPanelOpen(true);
    setRightPanelOpen(true);
    setIsIdentifyingSelf(true);
    setIdentityTabSignal((prev) => prev + 1);
    if (inviteOnboardingDismissTimerRef.current !== null) {
      window.clearTimeout(inviteOnboardingDismissTimerRef.current);
    }
    inviteOnboardingDismissTimerRef.current = null;
  };

  const getOrCreateInviteSecret = (): string => {
    const existing = localStorage.getItem(INVITE_SECRET_STORAGE_KEY);
    if (existing) return existing;
    const created =
      (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `secret-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    localStorage.setItem(INVITE_SECRET_STORAGE_KEY, created);
    return created;
  };

  const buildAccessProfileFromRole = (role: P2PRole): P2PVisibilitySettings => {
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
  };

  const intersectAccessPolicy = (
    base: P2PVisibilitySettings,
    cap: P2PVisibilitySettings
  ): P2PVisibilitySettings => ({
    exposeIdentity: base.exposeIdentity && cap.exposeIdentity,
    exposeDates: base.exposeDates && cap.exposeDates,
    exposePlaces: base.exposePlaces && cap.exposePlaces,
    exposeNotes: base.exposeNotes && cap.exposeNotes,
    allowDocuments: base.allowDocuments && cap.allowDocuments,
    allowDownload: base.allowDownload && cap.allowDownload,
    allowProposal: base.allowProposal && cap.allowProposal,
    allowDirectEdit: base.allowDirectEdit && cap.allowDirectEdit,
  });

  const parseInviteClaimsUnsafe = (token: string): InviteTokenClaims | null => {
    const encodedClaims = token.split('.')[0];
    if (!encodedClaims) return null;
    try {
      const padded = encodedClaims.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encodedClaims.length / 4) * 4, '=');
      const decoded = atob(padded);
      return JSON.parse(decoded) as InviteTokenClaims;
    } catch {
      return null;
    }
  };

  const sendSessionState = (requestEcho: boolean = false) => {
    p2pService.sendMessage('SESSION_STATE', {
      hasGedcom: !!gedcomDataRef.current,
      individualCount: gedcomDataRef.current ? Object.keys(gedcomDataRef.current.individuals).length : 0,
      sentAt: new Date().toISOString(),
      mode: p2pModeRef.current,
      requestEcho,
    });
  };

  const createRequestToken = () =>
    (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `diff-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const allocateUniqueIndividualId = (candidateId: string, data: GedcomData): string => {
    if (!(candidateId in data.individuals)) return candidateId;
    const used = new Set(Object.keys(data.individuals));
    let next = 1;
    while (used.has(`@I${next}@`)) next += 1;
    return `@I${next}@`;
  };

  const normalizeWord = (value: string | undefined): string =>
    (value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .trim();

  const toInitials = (givenName: string, surname: string): string => {
    const g = normalizeWord(givenName);
    const s = normalizeWord(surname);
    return `${g.slice(0, 1)}${s.slice(0, 1)}`.toUpperCase();
  };

  const getEffectiveSharePolicy = (): P2PVisibilitySettings => {
    if (p2pModeRef.current === 'client' && remoteAccessPolicy) {
      return remoteAccessPolicy;
    }
    if (p2pModeRef.current === 'host' && activeSessionPeerPolicy) {
      return activeSessionPeerPolicy;
    }
    return visibilitySettingsRef.current;
  };

  const hashString = (value: string): string => {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `${hash >>> 0}`;
  };

  const buildDiffFingerprint = (individual: Individual, policy: P2PVisibilitySettings): string => {
    const base = {
      g: policy.exposeIdentity ? normalizeWord(individual.givenName) : '',
      s: policy.exposeIdentity ? normalizeWord(individual.surname) : '',
      x: policy.exposeIdentity ? individual.gender : '',
      b: policy.exposeDates ? individual.birthDate?.year ?? null : null,
      d: policy.exposeDates ? individual.deathDate?.year ?? null : null,
      bp: policy.exposePlaces ? normalizeWord(individual.birthPlace) : '',
      dp: policy.exposePlaces ? normalizeWord(individual.deathPlace) : '',
      n: policy.exposeNotes ? normalizeWord(individual.notes) : '',
    };
    return hashString(JSON.stringify(base));
  };

  const filterIndividualForSharing = (individual: Individual, policy: P2PVisibilitySettings): Individual => {
    return {
      ...individual,
      givenName: policy.exposeIdentity ? individual.givenName : '',
      surname: policy.exposeIdentity ? individual.surname : '',
      name: policy.exposeIdentity ? individual.name : individual.id,
      gender: policy.exposeIdentity ? individual.gender : individual.gender,
      birthDate: policy.exposeDates ? individual.birthDate : undefined,
      deathDate: policy.exposeDates ? individual.deathDate : undefined,
      birthPlace: policy.exposePlaces ? individual.birthPlace : undefined,
      deathPlace: policy.exposePlaces ? individual.deathPlace : undefined,
      notes: policy.exposeNotes ? individual.notes : undefined,
    };
  };

  const buildDiffIndex = (data: GedcomData, policy: P2PVisibilitySettings): IndividualDiffIndexEntry[] => {
    return Object.values(data.individuals).map((individual) => {
      const spouseCount = individual.familySpouseIds?.length || 0;
      const childCount = (individual.familySpouseIds || []).reduce((acc, famId) => {
        const fam = data.families[famId];
        return acc + (fam?.childrenIds?.length || 0);
      }, 0);
      const parentCount = individual.familyChildId ? 1 : 0;
      return {
        localId: individual.id,
        fingerprint: buildDiffFingerprint(individual, policy),
        lightweightSignature: {
          initials: policy.exposeIdentity ? toInitials(individual.givenName, individual.surname) : undefined,
          gender: policy.exposeIdentity ? individual.gender : undefined,
          birthYear: policy.exposeDates ? individual.birthDate?.year ?? null : null,
          deathYear: policy.exposeDates ? individual.deathDate?.year ?? null : null,
          parentCount,
          spouseCount,
          childCount,
        },
        givenName: policy.exposeIdentity ? individual.givenName : undefined,
        surname: policy.exposeIdentity ? individual.surname : undefined,
        birthYear: policy.exposeDates ? individual.birthDate?.year ?? null : null,
        deathYear: policy.exposeDates ? individual.deathDate?.year ?? null : null,
        gender: policy.exposeIdentity ? individual.gender : undefined,
      };
    });
  };

  const scoreIndexCandidate = (local: Individual, remote: IndividualDiffIndexEntry): number => {
    let score = 0;
    const localGiven = normalizeWord(local.givenName);
    const localSurname = normalizeWord(local.surname);
    const remoteGiven = normalizeWord(remote.givenName);
    const remoteSurname = normalizeWord(remote.surname);
    const localBirthYear = local.birthDate?.year ?? null;
    const remoteBirthYear = remote.birthYear ?? null;
    const localDeathYear = local.deathDate?.year ?? null;
    const remoteDeathYear = remote.deathYear ?? null;

    if (localGiven && remoteGiven && localGiven === remoteGiven) score += 0.35;
    if (localSurname && remoteSurname && localSurname === remoteSurname) score += 0.35;
    if (localBirthYear && remoteBirthYear && localBirthYear === remoteBirthYear) score += 0.2;
    if (localDeathYear && remoteDeathYear && localDeathYear === remoteDeathYear) score += 0.05;
    if (remote.gender && local.gender === remote.gender) score += 0.05;

    const localInitials = toInitials(local.givenName, local.surname);
    if (remote.lightweightSignature.initials && remote.lightweightSignature.initials === localInitials) {
      score += 0.05;
    }

    return Math.min(score, 1);
  };

  const isNameCoherentForUpdate = (local: Individual, remote: IndividualDiffIndexEntry): boolean => {
    const localGiven = normalizeWord(local.givenName);
    const localSurname = normalizeWord(local.surname);
    const remoteGiven = normalizeWord(remote.givenName);
    const remoteSurname = normalizeWord(remote.surname);

    if (!localSurname || !remoteSurname) return false;
    if (localSurname !== remoteSurname) return false;

    // Strict V1 rule: same surname AND same normalized given name.
    // This prevents unrelated individuals from being matched as updates.
    return !!localGiven && !!remoteGiven && localGiven === remoteGiven;
  };

  const isIdentityCoherentForUpdate = (local: Individual, remote: Individual): boolean => {
    const localGiven = normalizeWord(local.givenName);
    const localSurname = normalizeWord(local.surname);
    const remoteGiven = normalizeWord(remote.givenName);
    const remoteSurname = normalizeWord(remote.surname);

    if (!localSurname || !remoteSurname || localSurname !== remoteSurname) return false;
    if (!localGiven || !remoteGiven || localGiven !== remoteGiven) return false;

    if (local.gender && remote.gender && local.gender !== remote.gender) return false;

    const localBirthYear = local.birthDate?.year ?? null;
    const remoteBirthYear = remote.birthDate?.year ?? null;
    if (localBirthYear && remoteBirthYear && Math.abs(localBirthYear - remoteBirthYear) > 2) return false;

    return true;
  };

  const confidenceFromScore = (score: number): 'high' | 'medium' | 'low' => {
    if (score >= 0.9) return 'high';
    if (score >= 0.7) return 'medium';
    return 'low';
  };

  const getRejectedMatchKey = (
    authorPeerId: string,
    remoteFingerprint?: string,
    remoteIndividualId?: string
  ): string | null => {
    const identity = remoteIndividualId
      ? `${remoteIndividualId}::${remoteFingerprint || 'no-fingerprint'}`
      : remoteFingerprint;
    if (!authorPeerId || !identity) return null;
    return `${authorPeerId}::${identity}`;
  };

  const registerRejectedInitialMatch = (proposal: P2PProposalItem) => {
    if (
      proposal.source !== 'initial_compare' ||
      proposal.operation !== 'update_individual'
    ) {
      return;
    }
    const key = getRejectedMatchKey(
      proposal.authorPeerId,
      proposal.remoteFingerprint,
      proposal.remoteIndividualId
    );
    if (!key) return;
    const existing = rejectedInitialMatchesRef.current[key] || new Set<string>();
    existing.add(proposal.individualId);
    rejectedInitialMatchesRef.current[key] = existing;
  };

  const classifyRemoteIndexAgainstLocal = (
    remoteIndex: IndividualDiffIndexEntry[],
    senderPeerId: string
  ) => {
    if (!gedcomDataRef.current) {
      return { onlyOnSender: [] as string[], potentialMatches: [] as IndividualDiffPotentialMatch[], requestIdsForSenderDetails: [] as string[] };
    }
    const data = gedcomDataRef.current;
    const potentialMatches: IndividualDiffPotentialMatch[] = [];
    const onlyOnSender: string[] = [];

    for (const remote of remoteIndex) {
      const rejectedKey = getRejectedMatchKey(senderPeerId, remote.fingerprint, remote.localId);
      const rejectedReceiverIds = rejectedKey
        ? (rejectedInitialMatchesRef.current[rejectedKey] || new Set<string>())
        : new Set<string>();
      const exactById = data.individuals[remote.localId];
      if (exactById && !rejectedReceiverIds.has(exactById.id)) {
        const localPolicy = getEffectiveSharePolicy();
        const localFingerprint = buildDiffFingerprint(exactById, localPolicy);
        if (localFingerprint === remote.fingerprint) {
          continue;
        }
        // Same GEDCOM ID is not enough to assume same person across databases.
        // We only trust same-ID match when identity evidence is strong.
        const exactIdScore = scoreIndexCandidate(exactById, remote);
        if (exactIdScore >= 0.9 && isNameCoherentForUpdate(exactById, remote)) {
          potentialMatches.push({ senderId: remote.localId, receiverId: remote.localId, score: exactIdScore });
          continue;
        }
      }

      let bestScore = 0;
      let bestId: string | null = null;
      for (const localIndividual of Object.values(data.individuals)) {
        if (rejectedReceiverIds.has(localIndividual.id)) continue;
        const s = scoreIndexCandidate(localIndividual, remote);
        if (s > bestScore) {
          bestScore = s;
          bestId = localIndividual.id;
        }
      }

      const bestLocal = bestId ? data.individuals[bestId] : null;
      const allowAsUpdate = !!(bestLocal && isNameCoherentForUpdate(bestLocal, remote));
      // Keep update matching conservative to avoid unrelated merges.
      if (bestId && bestScore >= 0.95 && allowAsUpdate) {
        potentialMatches.push({ senderId: remote.localId, receiverId: bestId, score: bestScore });
      } else {
        onlyOnSender.push(remote.localId);
      }
    }

    const sortedMatches = potentialMatches
      .sort((a, b) => b.score - a.score)
      .slice(0, INITIAL_DIFF_BATCH_LIMIT);
    const cappedOnlyOnSender = onlyOnSender.slice(0, Math.max(0, INITIAL_DIFF_BATCH_LIMIT - sortedMatches.length));
    const requestIdsForSenderDetails = [...new Set([...cappedOnlyOnSender, ...sortedMatches.map((m) => m.senderId)])];

    return {
      onlyOnSender: cappedOnlyOnSender,
      potentialMatches: sortedMatches,
      requestIdsForSenderDetails,
    };
  };

  const collectRelatedPayload = (individualId: string, data: GedcomData) => {
    const individual = data.individuals[individualId];
    if (!individual) return null;
    const relatedFamilies: Record<string, Family> = {};
    const relatedIndividuals: Record<string, Individual> = {};

    if (individual.familyChildId && data.families[individual.familyChildId]) {
      const fam = data.families[individual.familyChildId];
      relatedFamilies[fam.id] = fam;
      if (fam.husbandId && data.individuals[fam.husbandId]) relatedIndividuals[fam.husbandId] = data.individuals[fam.husbandId];
      if (fam.wifeId && data.individuals[fam.wifeId]) relatedIndividuals[fam.wifeId] = data.individuals[fam.wifeId];
    }

    for (const famId of individual.familySpouseIds || []) {
      const fam = data.families[famId];
      if (!fam) continue;
      relatedFamilies[fam.id] = fam;
      if (fam.husbandId && data.individuals[fam.husbandId]) relatedIndividuals[fam.husbandId] = data.individuals[fam.husbandId];
      if (fam.wifeId && data.individuals[fam.wifeId]) relatedIndividuals[fam.wifeId] = data.individuals[fam.wifeId];
      for (const childId of fam.childrenIds || []) {
        if (data.individuals[childId]) relatedIndividuals[childId] = data.individuals[childId];
      }
    }

    return { individual, relatedFamilies, relatedIndividuals };
  };

  const upsertIncomingProposal = (nextProposal: P2PProposalItem) => {
    setP2PProposals((prev) => {
      if (prev.some((p) => p.proposalId === nextProposal.proposalId)) return prev;
      return [nextProposal, ...prev].slice(0, INITIAL_DIFF_BATCH_LIMIT);
    });
  };

  const clearInitialDiffTimeout = (requestToken: string) => {
    const handle = initialDiffTimeoutHandlesRef.current[requestToken];
    if (handle !== undefined) {
      window.clearTimeout(handle);
      delete initialDiffTimeoutHandlesRef.current[requestToken];
    }
  };

  const scheduleInitialDiffDetailsRetry = (requestToken: string) => {
    clearInitialDiffTimeout(requestToken);
    const ctx = initialDiffContextsRef.current[requestToken];
    if (!ctx || !ctx.pendingRequestIds.length) return;
    initialDiffTimeoutHandlesRef.current[requestToken] = window.setTimeout(() => {
      const latest = initialDiffContextsRef.current[requestToken];
      if (!latest || !latest.pendingRequestIds.length) return;
      if (latest.retryCount >= INITIAL_DIFF_MAX_RETRY) {
        setInitialCompareStatusText(`initial compare timed out (${latest.pendingRequestIds.length} missing)`);
        logP2PActivity('initial_compare.timeout', 'session', requestToken, peerId || 'peer');
        return;
      }
      const retryCount = latest.retryCount + 1;
      initialDiffContextsRef.current[requestToken] = {
        ...latest,
        retryCount,
      };
      p2pService.sendMessage('INDIVIDUAL_DIFF_REQUEST', {
        phase: 'details',
        requestToken,
        batchId: latest.batchId,
        requestIds: latest.pendingRequestIds,
        retryCount,
      } as IndividualDiffRequestPayload);
      setInitialCompareStatusText(`retrying details ${latest.pendingRequestIds.length}`);
      logP2PActivity('initial_compare.retry', 'session', requestToken, peerId || 'peer');
      scheduleInitialDiffDetailsRetry(requestToken);
    }, INITIAL_DIFF_REQUEST_TIMEOUT_MS);
  };

  const startInitialCompareExchange = () => {
    if (!gedcomDataRef.current) return false;
    setP2PProposals((prev) =>
      prev.filter((p) => !(p.source === 'initial_compare' && p.status === 'pending'))
    );
    const policy = getEffectiveSharePolicy();
    const index = buildDiffIndex(gedcomDataRef.current, policy).slice(0, INITIAL_DIFF_BATCH_LIMIT);
    const requestToken = createRequestToken();
    const batchId = `batch-${Date.now()}`;
    initialDiffContextsRef.current[requestToken] = {
      requestToken,
      batchId,
      retryCount: 0,
      pendingRequestIds: [],
      potentialMatchesBySenderId: {},
      startedAt: Date.now(),
    };
    p2pService.sendMessage('INDIVIDUAL_DIFF_REQUEST', {
      phase: 'index',
      requestToken,
      batchId,
      index,
      retryCount: 0,
    } as IndividualDiffRequestPayload);
    setInitialCompareStatusText(`index sent ${index.length}`);
    logP2PActivity('initial_compare.started', 'session', batchId, peerId || 'peer');
    return true;
  };

  const handleStartCompare = () => {
    if (!isIdentified) {
      alert(t('app.alerts.claimIdentityBeforeCompare'));
      return;
    }
    if (p2pStatus !== 'connected') {
      alert(t('app.alerts.connectBeforeCompare'));
      return;
    }
    if (!gedcomDataRef.current || remotePeerHasData === false) {
      alert(t('app.alerts.compareNeedsBothGedcom'));
      return;
    }
    setP2PSessionUseCase('compare');
    p2pSessionUseCaseRef.current = 'compare';
    if (!startInitialCompareExchange()) {
      alert(t('app.alerts.loadGedcomBeforeCompare'));
    }
  };

  const handleStartShare = () => {
    if (!isIdentified) {
      alert(t('app.alerts.claimIdentityBeforeShare'));
      return;
    }
    if (p2pStatus !== 'connected') {
      alert(t('app.alerts.connectBeforeShare'));
      return;
    }
    if (p2pModeRef.current !== 'host') {
      alert(t('app.alerts.shareHostOnly'));
      return;
    }
    if (!gedcomDataRef.current) {
      alert(t('app.alerts.loadGedcomBeforeShare'));
      return;
    }
    if (remotePeerHasData === true) {
      alert(t('app.alerts.shareRemoteMustBeEmpty'));
      return;
    }
    setP2PSessionUseCase('share');
    p2pSessionUseCaseRef.current = 'share';
    sendP2PSnapshot(gedcomDataRef.current, documentsByIndividualId, 'sync.sent');
    setP2PSyncStatusText('share started');
  };

  const livingCandidates = useMemo(() => {
    if (!gedcomData) return [];
    return Object.values(gedcomData.individuals)
      .filter((indi) => !indi.deathDate?.year)
      .map((indi) => ({
        id: indi.id,
        label: `${indi.givenName || ''} ${indi.surname || ''}`.trim() || indi.name || indi.id,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [gedcomData]);

  const pendingProposalsCount = useMemo(
    () => p2pProposals.filter((proposal) => proposal.status === 'pending').length,
    [p2pProposals]
  );
  const activeReviewProposal = useMemo(
    () => p2pProposals.find((proposal) => proposal.proposalId === activeReviewProposalId) || null,
    [p2pProposals, activeReviewProposalId]
  );
  const pendingInviteItem = useMemo(
    () => p2pInvites.find((invite) => invite.token === pendingInviteToken) || null,
    [p2pInvites, pendingInviteToken]
  );
  const pendingInviteRoleLabel = useMemo(() => {
    if (!pendingInviteRole) return '';
    if (pendingInviteRole === 'viewer') return t('topPanel.inviteActionView');
    if (pendingInviteRole === 'contributor') return t('topPanel.inviteActionContribute');
    return t('topPanel.inviteActionEdit');
  }, [pendingInviteRole, t]);
  const isInviteLandingActive = !!pendingInviteToken && inviteOnboardingStage !== 'ready';
  const inviteLandingDescription = useMemo(() => {
    const template = t('topPanel.inviteLandingText');
    const inviter = pendingInviteInviterName || t('topPanel.inviteLandingInviterFallback');
    const action = pendingInviteRoleLabel || t('topPanel.inviteActionView');
    return template.replace('{{inviter}}', inviter).replace('{{action}}', action);
  }, [pendingInviteInviterName, pendingInviteRoleLabel, t]);
  const inviteLandingStatusLabel = useMemo(() => {
    if (inviteOnboardingStage === 'connecting') return t('topPanel.inviteLandingConnecting');
    if (inviteOnboardingStage === 'connected') return t('topPanel.inviteLandingConnected');
    if (inviteOnboardingStage === 'accepted') return t('topPanel.inviteLandingAccepted');
    if (inviteOnboardingStage === 'syncing') return t('topPanel.inviteLandingSyncing');
    if (inviteOnboardingStage === 'error') return t('topPanel.inviteLandingError');
    if (inviteOnboardingStage === 'completed') return t('topPanel.inviteLandingCompleted');
    return t('topPanel.inviteLandingWaiting');
  }, [inviteOnboardingStage, t]);
  const inviteLandingSteps = useMemo(() => {
    const connected =
      p2pStatus === 'connected' ||
      inviteOnboardingStage === 'connected' ||
      inviteOnboardingStage === 'accepted' ||
      inviteOnboardingStage === 'syncing' ||
      inviteOnboardingStage === 'completed' ||
      inviteOnboardingStage === 'ready';
    const bundleReceived = (inviteGedcomProgress?.receivedChunks || 0) > 0;
    const gedcomApplied = !!inviteGedcomProgress?.applied;
    const mediaDone =
      !inviteMediaProgress ||
      inviteMediaProgress.totalBatches <= 0 ||
      inviteMediaProgress.receivedBatches >= inviteMediaProgress.totalBatches;
    const normalizedDone = !inviteNormalizedProgress || inviteNormalizedProgress.applied;
    const uiReadyLike =
      inviteOnboardingStage === 'ready' ||
      (inviteOnboardingStage === 'completed' && !!rootIndividual && !!selectedIndividual);

    return [
      { key: 'connection', label: t('topPanel.inviteLandingStepConnection'), status: connected ? 'done' : (inviteOnboardingStage === 'connecting' ? 'active' : 'pending') as 'done' | 'active' | 'pending' },
      { key: 'bundle', label: t('topPanel.inviteLandingStepBundle'), status: bundleReceived ? 'done' : (inviteOnboardingStage === 'syncing' ? 'active' : 'pending') as 'done' | 'active' | 'pending' },
      { key: 'gedcomApply', label: t('topPanel.inviteLandingStepGedcomApply'), status: gedcomApplied ? 'done' : ((bundleReceived || inviteOnboardingStage === 'syncing') ? 'active' : 'pending') as 'done' | 'active' | 'pending' },
      { key: 'mediaApply', label: t('topPanel.inviteLandingStepMediaApply'), status: mediaDone ? 'done' : (inviteOnboardingStage === 'syncing' || inviteOnboardingStage === 'completed' ? 'active' : 'pending') as 'done' | 'active' | 'pending' },
      { key: 'normalizeApply', label: t('topPanel.inviteLandingStepNormalizeApply'), status: normalizedDone ? 'done' : (inviteOnboardingStage === 'syncing' || inviteOnboardingStage === 'completed' ? 'active' : 'pending') as 'done' | 'active' | 'pending' },
      { key: 'uiReady', label: t('topPanel.inviteLandingStepUiReady'), status: uiReadyLike ? 'done' : (inviteOnboardingStage === 'completed' ? 'active' : 'pending') as 'done' | 'active' | 'pending' },
    ];
  }, [
    t,
    p2pStatus,
    inviteOnboardingStage,
    inviteGedcomProgress,
    inviteMediaProgress,
    inviteNormalizedProgress,
    rootIndividual,
    selectedIndividual,
  ]);
  const inviteLandingMediaLabel = useMemo(() => {
    if (!inviteMediaProgress) return null;
    const batchPart = inviteMediaProgress.totalBatches > 0
      ? `${inviteMediaProgress.receivedBatches}/${inviteMediaProgress.totalBatches}`
      : `${inviteMediaProgress.receivedBatches}`;
    const docsPart = inviteMediaProgress.totalDocs > 0
      ? `${inviteMediaProgress.receivedDocs}/${inviteMediaProgress.totalDocs}`
      : `${inviteMediaProgress.receivedDocs}`;
    const photosPart = inviteMediaProgress.totalPhotos > 0
      ? `${inviteMediaProgress.receivedPhotos}/${inviteMediaProgress.totalPhotos}`
      : `${inviteMediaProgress.receivedPhotos}`;
    return `${t('topPanel.inviteLandingMediaBatches')} ${batchPart} | ${t('topPanel.inviteLandingMediaDocuments')} ${docsPart} | ${t('topPanel.inviteLandingMediaPhotos')} ${photosPart}`;
  }, [inviteMediaProgress, t]);
  const inviteLandingNormalizedLabel = useMemo(() => {
    if (!inviteNormalizedProgress) return null;
    const progress = `${inviteNormalizedProgress.receivedChunks}/${Math.max(inviteNormalizedProgress.totalChunks, 1)}`;
    if (inviteNormalizedProgress.fallbackLocal) {
      return `${progress} (${t('topPanel.inviteLandingNormalizeFallback')})`;
    }
    if (inviteNormalizedProgress.applied) {
      return `${progress} (${t('topPanel.syncStatusDone')})`;
    }
    return progress;
  }, [inviteNormalizedProgress, t]);
  const formatSyncStatusLabel = useCallback((raw: string | null): string => {
    if (!raw) return '';
    const sendingMatch = raw.match(/^sending\s+(\d+)\/(\d+)$/i);
    if (sendingMatch) return `${t('topPanel.syncStatusSending')} ${sendingMatch[1]}/${sendingMatch[2]}`;
    const receivingMatch = raw.match(/^receiving\s+(\d+)\/(\d+)$/i);
    if (receivingMatch) return `${t('topPanel.syncStatusReceiving')} ${receivingMatch[1]}/${receivingMatch[2]}`;

    const normalized = raw.toLowerCase().trim();
    if (normalized === 'waiting apply') return t('topPanel.syncStatusWaitingApply');
    if (normalized === 'applying') return t('topPanel.syncStatusApplying');
    if (normalized === 'done') return t('topPanel.syncStatusDone');
    if (normalized === 'retry requested') return t('topPanel.syncStatusRetryRequested');
    if (normalized === 'peer requested retry') return t('topPanel.syncStatusPeerRequestedRetry');
    if (normalized === 'share started') return t('topPanel.syncStatusShareStarted');
    if (normalized === 'parse error') return t('topPanel.syncStatusParseError');
    return raw;
  }, [t]);
  const selectedIndividualDocuments = useMemo(
    () => (selectedIndividual ? (documentsByIndividualId[selectedIndividual.id] || []) : []),
    [documentsByIndividualId, selectedIndividual]
  );
  const primaryPhotoUrlById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [individualId, docs] of Object.entries(documentsByIndividualId)) {
      const primaryPhoto = docs.find((d) => d.kind === 'photo' && d.isPrimaryPhoto)
        ?? docs.find((d) => d.kind === 'photo');
      if (primaryPhoto?.url) {
        map[individualId] = primaryPhoto.url;
      }
    }
    return map;
  }, [documentsByIndividualId]);
  useEffect(() => {
    if (p2pMode !== 'client') return;
    const allDocs = Object.values(documentsByIndividualId).flat();
    const photoDocs = allDocs.filter((d) => d.kind === 'photo' || isImageLikeUrl(d.url));
    const firstPrefixes = photoDocs.slice(0, 3).map((d) => {
      if (d.url.startsWith('data:')) return 'data:';
      if (d.url.startsWith('blob:')) return 'blob:';
      if (d.url.startsWith('http://') || d.url.startsWith('https://')) return 'http(s):';
      return 'other';
    });
    console.info('[G2][INVITE_PHOTO_DEBUG]', {
      docsIndividuals: Object.keys(documentsByIndividualId).length,
      docsTotal: allDocs.length,
      photosDetected: photoDocs.length,
      primaryPhotoMapSize: Object.keys(primaryPhotoUrlById).length,
      firstPhotoUrlPrefixes: firstPrefixes,
    });
  }, [p2pMode, documentsByIndividualId, primaryPhotoUrlById]);
  const shouldDeferInviteMediaRendering =
    false;
  const shouldSuspendSceneForInvite =
    p2pMode === 'client' &&
    inviteSceneDeferred;
  const renderedPrimaryPhotoUrlById = shouldDeferInviteMediaRendering ? {} : primaryPhotoUrlById;
  const renderedDocumentsByIndividualId = shouldDeferInviteMediaRendering ? {} : documentsByIndividualId;

  const withPrimaryPhotosApplied = useCallback((data: GedcomData | null) => {
    if (!data) return data;
    const entries = Object.entries(primaryPhotoUrlById);
    if (entries.length === 0) return data;
    let changed = false;
    const nextIndividuals = { ...data.individuals };
    for (const [individualId, photoUrl] of entries) {
      const current = nextIndividuals[individualId];
      const currentPhotoUrl = (current as any)?.photoUrl as string | undefined;
      if (!current || currentPhotoUrl === photoUrl) continue;
      nextIndividuals[individualId] = { ...(current as any), photoUrl } as Individual;
      changed = true;
    }
    if (!changed) return data;
    return { ...data, individuals: nextIndividuals };
  }, [primaryPhotoUrlById]);

  useEffect(() => {
    if (Object.keys(primaryPhotoUrlById).length === 0) return;
    setOriginalGedcomData((prev) => withPrimaryPhotosApplied(prev));
    setNormalizedGedcomData((prev) => withPrimaryPhotosApplied(prev));
  }, [primaryPhotoUrlById, withPrimaryPhotosApplied]);

  useEffect(() => {
    if (!livingCandidates.length) return;
    setP2PInvites((prev) =>
      prev.map((invite) => {
        const candidate = livingCandidates.find((c) => c.id === invite.individualId);
        if (!candidate) return invite;
        return {
          ...invite,
          individualName: candidate.label,
        };
      })
    );
  }, [livingCandidates]);

  useEffect(() => {
    if (!pendingInviteTargetIndividualId || !gedcomData) return;
    const invitedIndividual = gedcomData.individuals[pendingInviteTargetIndividualId];
    if (!invitedIndividual) return;
    setRootIndividual(invitedIndividual);
    setSelectedIndividual(invitedIndividual);
    setDisplayMode('2d-individual');
    setRightPanelOpen(true);
  }, [pendingInviteTargetIndividualId, gedcomData]);

  useEffect(() => {
    if (!pendingInviteToken) return;
    if (inviteOnboardingStage === 'ready') return;
    if (p2pStatus === 'connected') {
      setInviteOnboardingStage((prev) =>
        (prev === 'idle' || prev === 'connecting' || prev === 'error') ? 'connected' : prev
      );
    } else if (p2pStatus === 'connecting') {
      setInviteOnboardingStage((prev) =>
        (prev === 'idle' || prev === 'error') ? 'connecting' : prev
      );
    } else if (p2pStatus === 'error') {
      setInviteOnboardingStage((prev) => {
        if (prev === 'ready' || prev === 'completed') return prev;
        return 'error';
      });
    }
  }, [pendingInviteToken, inviteOnboardingStage, p2pStatus]);

  useEffect(() => {
    if (!pendingInviteToken) return;
    if (!inviteAcceptRequestedRef.current) return;
    if (p2pStatus !== 'connected' || p2pModeRef.current !== 'client') return;
    if (!pendingInviteItem || pendingInviteItem.status !== 'active') return;
    handleAcceptInvite(pendingInviteItem.inviteId);
  }, [pendingInviteToken, p2pStatus, pendingInviteItem]);

  useEffect(() => {
    if (!pendingInviteToken) return;
    if (inviteOnboardingStage !== 'completed') return;
    if (p2pModeRef.current !== 'client' || p2pStatus !== 'connected') return;
    const media = inviteMediaProgress;
    if (!media) return;

    const hasAnyDocs = Object.keys(documentsByIndividualId).length > 0;
    if (hasAnyDocs) {
      if (inviteMediaRecoveryTimerRef.current !== null) {
        window.clearTimeout(inviteMediaRecoveryTimerRef.current);
        inviteMediaRecoveryTimerRef.current = null;
      }
      inviteMediaRecoveryRequestedRef.current = false;
      inviteMediaRecoveryAttemptRef.current = 0;
      if (inviteMediaRecoveryInFlight) setInviteMediaRecoveryInFlight(false);
      return;
    }

    const expectedPhotos = media.totalPhotos > 0 || media.receivedPhotos > 0;
    const mediaTransferCompleted = media.totalBatches > 0 && media.receivedBatches >= media.totalBatches;
    if (!expectedPhotos || !mediaTransferCompleted) return;
    if (inviteMediaRecoveryAttemptRef.current >= 3) return;
    if (inviteMediaRecoveryRequestedRef.current) return;

    inviteMediaRecoveryRequestedRef.current = true;
    inviteMediaRecoveryAttemptRef.current += 1;
    const attempt = inviteMediaRecoveryAttemptRef.current;
    setInviteMediaRecoveryInFlight(true);
    setP2PSyncStatusText('retry requested');
    p2pService.sendMessage('BUNDLE_SYNC_REQUEST', {
      reason: `invite_media_empty_retry_${attempt}`,
      requesterPeerId: peerId || 'client',
      requestedAt: new Date().toISOString(),
    });
    inviteMediaRecoveryTimerRef.current = window.setTimeout(() => {
      inviteMediaRecoveryTimerRef.current = null;
      inviteMediaRecoveryRequestedRef.current = false;
      setInviteMediaRecoveryInFlight(false);
    }, 4500);
  }, [
    pendingInviteToken,
    inviteOnboardingStage,
    p2pStatus,
    inviteMediaProgress,
    documentsByIndividualId,
    inviteMediaRecoveryInFlight,
    peerId,
  ]);

  useEffect(() => {
    if (!pendingInviteToken) return;
    if (inviteOnboardingStage !== 'completed') return;
    if (!inviteSceneDeferred) return;
    const gedcomApplied = !!inviteGedcomProgress?.applied;
    if (!gedcomApplied || isLoading || !rootIndividual || !selectedIndividual) return;
    setInviteSceneDeferred(false);
  }, [
    pendingInviteToken,
    inviteOnboardingStage,
    inviteSceneDeferred,
    inviteGedcomProgress,
    isLoading,
    rootIndividual,
    selectedIndividual,
  ]);

  useEffect(() => {
    if (!pendingInviteToken) return;
    if (inviteOnboardingStage !== 'completed') return;
    const gedcomApplied = !!inviteGedcomProgress?.applied;
    const uiStillPreparing =
      inviteSceneDeferred ||
      isLoading ||
      !gedcomApplied ||
      !rootIndividual ||
      !selectedIndividual;
    if (uiStillPreparing) {
      if (inviteUiReadyTimerRef.current !== null) {
        window.clearTimeout(inviteUiReadyTimerRef.current);
        inviteUiReadyTimerRef.current = null;
      }
      return;
    }
    if (inviteUiReadyTimerRef.current !== null) return;
    inviteUiReadyTimerRef.current = window.setTimeout(() => {
      if (inviteSceneResumeTimerRef.current !== null) {
        window.clearTimeout(inviteSceneResumeTimerRef.current);
        inviteSceneResumeTimerRef.current = null;
      }
      setInviteSceneDeferred(false);
      setInviteOnboardingStage('ready');
      setPendingInviteToken(null);
      inviteUiReadyTimerRef.current = null;
    }, 500);
  }, [
    pendingInviteToken,
    inviteOnboardingStage,
    inviteSceneDeferred,
    inviteGedcomProgress,
    isLoading,
    rootIndividual,
    selectedIndividual,
  ]);

  useEffect(() => {
    if (!pendingInviteToken) return;
    if (inviteOnboardingStage !== 'completed') return;
    const forceReadyTimer = window.setTimeout(() => {
      setInviteSceneDeferred(false);
      setInviteOnboardingStage('ready');
      setPendingInviteToken(null);
    }, 6000);
    return () => window.clearTimeout(forceReadyTimer);
  }, [pendingInviteToken, inviteOnboardingStage]);

  useEffect(() => {
    if (!pendingInviteToken) return;
    if (inviteOnboardingStage !== 'completed') return;
    if (shouldSuspendSceneForInvite) return;
    if (!rootIndividual || !selectedIndividual) return;
    if (inviteRibbonFirstRenderDone) return;
    if (inviteRibbonRenderRaf1Ref.current !== null) {
      window.cancelAnimationFrame(inviteRibbonRenderRaf1Ref.current);
      inviteRibbonRenderRaf1Ref.current = null;
    }
    if (inviteRibbonRenderRaf2Ref.current !== null) {
      window.cancelAnimationFrame(inviteRibbonRenderRaf2Ref.current);
      inviteRibbonRenderRaf2Ref.current = null;
    }
    inviteRibbonRenderRaf1Ref.current = window.requestAnimationFrame(() => {
      inviteRibbonRenderRaf1Ref.current = null;
      inviteRibbonRenderRaf2Ref.current = window.requestAnimationFrame(() => {
        inviteRibbonRenderRaf2Ref.current = null;
        setInviteRibbonFirstRenderDone(true);
      });
    });
  }, [
    pendingInviteToken,
    inviteOnboardingStage,
    shouldSuspendSceneForInvite,
    rootIndividual,
    selectedIndividual,
    inviteRibbonFirstRenderDone,
  ]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hashRaw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
    const hashParams = new URLSearchParams(hashRaw);
    const inviteToken = params.get('g2invite') || hashParams.get('g2invite');
    if (!inviteToken) return;
    setPendingInviteToken(inviteToken);
    setInviteHasAccepted(false);
    setInviteRibbonFirstRenderDone(false);
    setInviteNormalizedProgress(null);
    if (pendingNormalizationFallbackTimerRef.current !== null) {
      window.clearTimeout(pendingNormalizationFallbackTimerRef.current);
      pendingNormalizationFallbackTimerRef.current = null;
    }
    inviteAcceptRequestedRef.current = false;
    const claims = parseInviteClaimsUnsafe(inviteToken);
    if (!claims) return;
    if (claims.sessionId && claims.sessionId !== 'local-session') {
      setPendingInviteHostPeerId(claims.sessionId);
      inviteAutoConnectAttemptedRef.current = false;
    }
    setPendingInviteRole(claims.role);
    setPendingInviteInviterName(claims.inviterName || null);
    setInviteOnboardingStage('idle');
    if (claims.targetIndividualId) {
      setPendingInviteTargetIndividualId(claims.targetIndividualId);
    }
    setP2PInvites((prev) => {
      if (prev.some((invite) => invite.inviteId === claims.inviteId)) return prev;
      return [
        {
          inviteId: claims.inviteId,
          individualId: claims.targetIndividualId || '',
          individualName: claims.targetIndividualName || `invité (${claims.role})`,
          role: claims.role,
          status: 'active',
          personalizedDefault: false,
          createdAt: claims.issuedAt,
          expiresAt: claims.expiresAt,
          token: inviteToken,
          inviteLink: `${window.location.origin}${window.location.pathname}?invite_from=${encodeURIComponent(claims.inviterName || 'invitant')}&invite_to=${encodeURIComponent(claims.targetIndividualName || 'invite')}&invite_role=${encodeURIComponent(claims.role)}#g2invite=${encodeURIComponent(inviteToken)}`,
          accessProfile: buildAccessProfileFromRole(claims.role),
        },
        ...prev,
      ];
    });
    params.delete('g2invite');
    params.delete('invite_from');
    params.delete('invite_to');
    params.delete('invite_role');
    const nextQuery = params.toString();
    hashParams.delete('g2invite');
    const nextHash = hashParams.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${nextHash ? `#${nextHash}` : ''}`;
    window.history.replaceState(null, '', nextUrl);
  }, []);

  useEffect(() => {
    if (p2pStatus !== 'connected' || p2pModeRef.current !== 'host') return;
    const profileToSend = activeSessionPeerPolicy
      ? intersectAccessPolicy(activeSessionPeerPolicy, p2pVisibilitySettings)
      : p2pVisibilitySettings;
    setActiveSessionPeerPolicy(profileToSend);
    activeSessionPeerPolicyRef.current = profileToSend;
    p2pService.sendMessage('ACCESS_PROFILE_SET', {
      profile: profileToSend,
      fromPeerId: peerId || 'host',
    });
    logP2PActivity('policy.sent', 'session', peerId || 'host');
  }, [p2pVisibilitySettings, p2pStatus, peerId]);

  useEffect(() => {
    if (p2pStatus !== 'connected') return;
    sendSessionState();
  }, [p2pStatus, gedcomData]);

  useEffect(() => {
    if (p2pStatus !== 'connected' || remotePeerHasData !== null) return;
    let attempts = 0;
    const maxAttempts = 6;
    const handle = window.setInterval(() => {
      attempts += 1;
      sendSessionState(true);
      if (attempts >= maxAttempts || remotePeerHasData !== null) {
        window.clearInterval(handle);
      }
    }, 1000);
    return () => window.clearInterval(handle);
  }, [p2pStatus, remotePeerHasData]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const modifierPressed = e.ctrlKey || e.metaKey;
      setIsShortcutModifierPressed(modifierPressed);

      if (e.key === 'Escape' && isHelpOpen) {
        setIsHelpOpen(false);
        return;
      }

      if (modifierPressed && e.key.toLowerCase() === 'b' && !e.repeat) {
        e.preventDefault();
        setShowBoxes(prev => !prev);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      setIsShortcutModifierPressed(e.ctrlKey || e.metaKey);
    };
    const handleBlur = () => {
      setIsShortcutModifierPressed(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      p2pService.destroy();
    };
  }, [isHelpOpen]);

  const initP2PWithMode = (mode: 'host' | 'client', autoConnectHostId?: string) => {
      setP2pMode(mode);
      p2pModeRef.current = mode;
      setP2pStatus('connecting');
      p2pService.init(
          (status, id) => {
              setP2pStatus(status as P2PStatus);
              if (id) setPeerId(id);
              if (status !== 'connected') {
                setRemotePeerHasData(null);
                setP2PSessionUseCase(null);
                p2pSessionUseCaseRef.current = null;
                setActiveSessionPeerPolicy(null);
                activeSessionPeerPolicyRef.current = null;
              }
              logP2PActivity(`session.${status}`, 'session', id || 'local');
              if (
                status === 'ready' &&
                mode === 'client' &&
                autoConnectHostId &&
                !inviteAutoConnectAttemptedRef.current &&
                id !== autoConnectHostId
              ) {
                inviteAutoConnectAttemptedRef.current = true;
                p2pService.connect(autoConnectHostId);
                logP2PActivity('invite.autoconnect.requested', 'session', autoConnectHostId, id || 'local');
              }
              if (status === 'connected') {
                  setP2PSessionUseCase(null);
                  setRemotePeerHasData(null);
                  setActiveSessionPeerPolicy(visibilitySettingsRef.current);
                  activeSessionPeerPolicyRef.current = visibilitySettingsRef.current;
                  if (p2pModeRef.current === 'host') {
                    const profile = activeSessionPeerPolicyRef.current || visibilitySettingsRef.current;
                    p2pService.sendMessage('ACCESS_PROFILE_SET', {
                      profile,
                      fromPeerId: id || peerId || 'host',
                    });
                  }
                  sendSessionState(true);
                  window.setTimeout(() => sendSessionState(true), 600);
              }
          },
          (data) => {
              const processIncomingDocumentsPayload = (payload: {
                documentsByIndividualId?: Record<string, unknown>;
                authorPeerId?: string;
                partial?: boolean;
                scopeIndividualId?: string;
                batchIndex?: number;
                batchTotal?: number;
                documentItemsInPayload?: number;
                photoItemsInPayload?: number;
                documentItemsTotal?: number;
                photoItemsTotal?: number;
              }) => {
                const allowDocumentsInbound =
                  p2pModeRef.current === 'client'
                    ? (remoteAccessPolicy?.allowDocuments ?? true)
                    : visibilitySettingsRef.current.allowDocuments;
                if (!payload.documentsByIndividualId || !allowDocumentsInbound) return;
                applyIncomingDocuments(payload.documentsByIndividualId, payload.partial === true);
                logP2PActivity('documents.sync.received', 'session', payload.authorPeerId || 'remote', payload.authorPeerId || 'remote');
                const isInitialInviteBatch = p2pModeRef.current === 'client' && !!payload.batchTotal && payload.batchTotal > 1;
                if (!isInitialInviteBatch) {
                  showTransientToast('success', t('app.toasts.documentsUpdatedByPeer'), 1500);
                }
                if (pendingInviteTokenRef.current && p2pModeRef.current === 'client') {
                  const fallbackStats = computeMediaStats(
                    normalizeDocumentsByIndividual(payload.documentsByIndividualId, gedcomDataRef.current?.individuals),
                  );
                  const docsInPayload = payload.documentItemsInPayload ?? fallbackStats.documentItems;
                  const photosInPayload = payload.photoItemsInPayload ?? fallbackStats.photoItems;
                  const docsTotal = payload.documentItemsTotal ?? fallbackStats.documentItems;
                  const photosTotal = payload.photoItemsTotal ?? fallbackStats.photoItems;
                  if (payload.partial) {
                    const scope = payload.scopeIndividualId || `${payload.batchIndex || 0}`;
                    if (!inviteReceivedDocumentScopesRef.current.has(scope)) {
                      inviteReceivedDocumentScopesRef.current.add(scope);
                      setInviteMediaProgress((prev) => ({
                        receivedBatches: (prev?.receivedBatches || 0) + 1,
                        totalBatches: payload.batchTotal || prev?.totalBatches || 1,
                        receivedDocs: (prev?.receivedDocs || 0) + docsInPayload,
                        totalDocs: docsTotal || prev?.totalDocs || 0,
                        receivedPhotos: (prev?.receivedPhotos || 0) + photosInPayload,
                        totalPhotos: photosTotal || prev?.totalPhotos || 0,
                      }));
                    }
                  } else {
                    setInviteMediaProgress({
                      receivedBatches: payload.batchTotal || 1,
                      totalBatches: payload.batchTotal || 1,
                      receivedDocs: docsTotal,
                      totalDocs: docsTotal,
                      receivedPhotos: photosTotal,
                      totalPhotos: photosTotal,
                    });
                  }
                }
                if (p2pModeRef.current === 'host') {
                  const changedIndividualId = payload.scopeIndividualId
                    || Object.keys(payload.documentsByIndividualId)[0]
                    || 'unknown';
                  const changedIndividual = gedcomDataRef.current?.individuals?.[changedIndividualId];
                  const changedLabel = changedIndividual
                    ? (`${changedIndividual.givenName || ''} ${changedIndividual.surname || ''}`.trim() || changedIndividual.name || changedIndividual.id)
                    : changedIndividualId;
                  const proposalId = `proposal-doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                  setP2PProposals((prev) => [
                    {
                      proposalId,
                      individualId: changedIndividualId,
                      individualLabel: changedLabel,
                      authorPeerId: payload.authorPeerId || 'remote',
                      proposedAt: new Date().toISOString(),
                      operation: 'update_individual' as const,
                      changeSet: {},
                      status: 'pending' as const,
                      source: 'live' as const,
                      proposalKind: 'documents' as const,
                      scopeIndividualId: payload.scopeIndividualId,
                      documentItemsDelta: payload.documentItemsInPayload || 0,
                      photoItemsDelta: payload.photoItemsInPayload || 0,
                    },
                    ...prev,
                  ].slice(0, 300));
                  logP2PActivity('proposal.documents.received', 'individual', changedIndividualId, payload.authorPeerId || 'remote');
                }
              };
              if (data.type === 'SYNC_GEDCOM' && data.payload) {
                  if (p2pSessionUseCaseRef.current === 'compare') {
                    logP2PActivity('sync.ignored.compare_mode', 'session', 'remote');
                    return;
                  }
                  const payload = data.payload as {
                    gedcom?: GedcomData;
                    gedcomText?: string;
                    databaseName?: string;
                    documentsByIndividualId?: Record<string, unknown>;
                  };
                  const incomingGedcom =
                    payload.gedcomText
                      ? parseGedcom(payload.gedcomText)
                      : (payload.gedcom || (data.payload as GedcomData));
                  if (!incomingGedcom?.individuals || !incomingGedcom?.families) return;
                  syncReceivingInProgressRef.current = false;
                  setP2PSyncStatusText('applying');
                  if (syncChunkReceiveTimeoutRef.current !== null) {
                    window.clearTimeout(syncChunkReceiveTimeoutRef.current);
                    syncChunkReceiveTimeoutRef.current = null;
                  }
                  handleDataLoaded(
                    incomingGedcom,
                    payload.databaseName || "Remote P2P Database",
                    { preserveDocuments: true }
                  );
                  if (pendingInviteTokenRef.current && p2pModeRef.current === 'client') {
                    setInviteGedcomProgress({
                      receivedChunks: 1,
                      totalChunks: 1,
                      applied: true,
                    });
                  }
                  const allowDocumentsInbound =
                    p2pModeRef.current === 'client'
                      ? (remoteAccessPolicy?.allowDocuments ?? true)
                      : visibilitySettingsRef.current.allowDocuments;
                  if (payload.documentsByIndividualId && allowDocumentsInbound) {
                    applyIncomingDocuments(payload.documentsByIndividualId);
                  }
                  if (pendingIncomingDocumentsRef.current) {
                    const allowDocumentsInbound =
                      p2pModeRef.current === 'client'
                        ? (remoteAccessPolicy?.allowDocuments ?? true)
                        : visibilitySettingsRef.current.allowDocuments;
                    if (allowDocumentsInbound) {
                      setDocumentsByIndividualId((prev) => ({ ...prev, ...pendingIncomingDocumentsRef.current! }));
                    }
                    pendingIncomingDocumentsRef.current = null;
                  }
                  setP2PSyncStatusText('done');
                  window.setTimeout(() => setP2PSyncStatusText(null), 2500);
                  logP2PActivity('sync.received', 'session', 'remote');
                  completeInviteOnboarding();
                  if (!pendingInviteTokenRef.current) {
                    showTransientToast('success', t('app.alerts.synchronizedWithPeer'), 1600);
                  }
              }
              if (data.type === 'SYNC_GEDCOM_CHUNK' && data.payload) {
                  if (p2pSessionUseCaseRef.current === 'compare') {
                    return;
                  }
                  const payload = data.payload as {
                    transferId?: string;
                    index?: number;
                    totalChunks?: number;
                    chunk?: string;
                    databaseName?: string;
                  };
                  if (
                    !payload.transferId ||
                    typeof payload.index !== 'number' ||
                    typeof payload.totalChunks !== 'number' ||
                    typeof payload.chunk !== 'string' ||
                    payload.totalChunks <= 0 ||
                    payload.index < 0
                  ) return;

                  syncReceivingInProgressRef.current = true;
                  if (pendingInviteTokenRef.current && inviteOnboardingStageRef.current !== 'ready') {
                    setInviteOnboardingStage('syncing');
                  }
                  resetIncomingSyncTimeout();
                  const key = payload.transferId;
                  const existing = incomingSyncChunksRef.current[key];
                  if (!existing) {
                    incomingSyncChunksRef.current[key] = {
                      totalChunks: payload.totalChunks,
                      databaseName: payload.databaseName,
                      parts: new Array(payload.totalChunks).fill(''),
                      received: 0,
                    };
                  }
                  const acc = incomingSyncChunksRef.current[key];
                  if (payload.index >= acc.totalChunks) return;
                  if (!acc.parts[payload.index]) {
                    acc.parts[payload.index] = payload.chunk;
                    acc.received += 1;
                    if (pendingInviteTokenRef.current && p2pModeRef.current === 'client') {
                      setInviteGedcomProgress({
                        receivedChunks: acc.received,
                        totalChunks: acc.totalChunks,
                        applied: false,
                      });
                    }
                    if (acc.received === 1 || acc.received === acc.totalChunks || acc.received % 12 === 0) {
                      setP2PSyncStatusText(`receiving ${acc.received}/${acc.totalChunks}`);
                    }
                  }

                  if (acc.received >= acc.totalChunks) {
                    const fullGedcomText = acc.parts.join('');
                    delete incomingSyncChunksRef.current[key];
                    syncReceivingInProgressRef.current = false;
                    if (syncChunkReceiveTimeoutRef.current !== null) {
                      window.clearTimeout(syncChunkReceiveTimeoutRef.current);
                      syncChunkReceiveTimeoutRef.current = null;
                    }
                    try {
                      syncApplyingInProgressRef.current = true;
                      setP2PSyncStatusText('applying');
                      const incomingGedcom = parseGedcom(fullGedcomText);
                      handleDataLoaded(
                        incomingGedcom,
                        acc.databaseName || "Remote P2P Database",
                        { preserveDocuments: true }
                      );
                      if (pendingInviteTokenRef.current && p2pModeRef.current === 'client') {
                        setInviteGedcomProgress({
                          receivedChunks: acc.totalChunks,
                          totalChunks: acc.totalChunks,
                          applied: true,
                        });
                      }
                      if (pendingIncomingDocumentsRef.current) {
                        const allowDocumentsInbound =
                          p2pModeRef.current === 'client'
                            ? (remoteAccessPolicy?.allowDocuments ?? true)
                            : visibilitySettingsRef.current.allowDocuments;
                        if (allowDocumentsInbound) {
                          setDocumentsByIndividualId((prev) => ({ ...prev, ...pendingIncomingDocumentsRef.current! }));
                        }
                        pendingIncomingDocumentsRef.current = null;
                      }
                      setP2PSyncStatusText('done');
                      window.setTimeout(() => setP2PSyncStatusText(null), 2500);
                      window.setTimeout(() => {
                        syncApplyingInProgressRef.current = false;
                      }, 2000);
                      logP2PActivity('sync.received', 'session', 'remote');
                      completeInviteOnboarding();
                      if (!pendingInviteTokenRef.current) {
                        showTransientToast('success', t('app.alerts.synchronizedWithPeer'), 1600);
                      }
                    } catch (error) {
                      console.error('Failed to parse chunked GEDCOM sync', error);
                      logP2PActivity('sync.parse.error', 'session', 'remote');
                      setP2PSyncStatusText('parse error');
                      syncApplyingInProgressRef.current = false;
                      if (pendingInviteToken) {
                        setInviteOnboardingStage('error');
                      } else {
                        showTransientToast('error', t('app.alerts.syncFailedLargeGedcom'), 2200);
                      }
                    }
                  }
              }
              if (data.type === 'NORMALIZED_SNAPSHOT' && data.payload) {
                  const payload = data.payload as {
                    normalizedGedcom?: GedcomData;
                    algoVersion?: string;
                  };
                  if (payload.normalizedGedcom) {
                    setInviteNormalizedProgress((prev) => ({
                      receivedChunks: prev?.totalChunks || prev?.receivedChunks || 1,
                      totalChunks: prev?.totalChunks || prev?.receivedChunks || 1,
                      applied: false,
                      fallbackLocal: false,
                    }));
                    applyIncomingNormalizedGedcom(payload.normalizedGedcom, payload.algoVersion);
                  }
              }
              if (data.type === 'NORMALIZED_SNAPSHOT_CHUNK' && data.payload) {
                  const payload = data.payload as {
                    transferId?: string;
                    index?: number;
                    totalChunks?: number;
                    chunk?: string;
                    algoVersion?: string;
                  };
                  if (
                    !payload.transferId ||
                    typeof payload.index !== 'number' ||
                    typeof payload.totalChunks !== 'number' ||
                    typeof payload.chunk !== 'string' ||
                    payload.totalChunks <= 0 ||
                    payload.index < 0
                  ) return;
                  const key = payload.transferId;
                  if (!incomingNormalizedChunksRef.current[key]) {
                    incomingNormalizedChunksRef.current[key] = {
                      totalChunks: payload.totalChunks,
                      parts: new Array(payload.totalChunks).fill(''),
                      received: 0,
                      algoVersion: payload.algoVersion,
                    };
                  }
                  const acc = incomingNormalizedChunksRef.current[key];
                  if (payload.index >= acc.totalChunks) return;
                  if (!acc.parts[payload.index]) {
                    acc.parts[payload.index] = payload.chunk;
                    acc.received += 1;
                    setInviteNormalizedProgress({
                      receivedChunks: acc.received,
                      totalChunks: acc.totalChunks,
                      applied: false,
                      fallbackLocal: false,
                    });
                  }
                  if (acc.received >= acc.totalChunks) {
                    const full = acc.parts.join('');
                    const algoVersion = acc.algoVersion;
                    delete incomingNormalizedChunksRef.current[key];
                    try {
                      const parsed = JSON.parse(full) as GedcomData;
                      applyIncomingNormalizedGedcom(parsed, algoVersion);
                    } catch (error) {
                      console.error('Failed to parse NORMALIZED_SNAPSHOT_CHUNK payload', error);
                    }
                  }
              }
              if (data.type === 'SYNC_GEDCOM_REQUEST' && p2pModeRef.current === 'host' && gedcomDataRef.current) {
                  if (p2pSessionUseCaseRef.current !== 'share') return;
                  setP2PSyncStatusText('peer requested retry');
                  sendP2PSnapshot(gedcomDataRef.current, documentsRef.current, 'sync.refresh');
                  logP2PActivity('sync.request.received', 'session', peerId || 'host');
              }
              if (data.type === 'BUNDLE_SYNC_REQUEST' && p2pModeRef.current === 'host' && gedcomDataRef.current) {
                  if (p2pSessionUseCaseRef.current !== 'share') return;
                  setP2PSyncStatusText('peer requested retry');
                  sendP2PSnapshot(gedcomDataRef.current, documentsRef.current, 'sync.refresh', { forceBundle: true });
                  logP2PActivity('sync.bundle.request.received', 'session', peerId || 'host');
              }
              if (data.type === 'BUNDLE_SYNC' && data.payload) {
                  const payload = data.payload as { bundleContent?: string };
                  if (!payload.bundleContent || typeof payload.bundleContent !== 'string') return;
                  void applyIncomingBundleSnapshot(payload.bundleContent);
              }
              if (data.type === 'BUNDLE_SYNC_CHUNK' && data.payload) {
                  const payload = data.payload as {
                    transferId?: string;
                    index?: number;
                    totalChunks?: number;
                    chunk?: string;
                  };
                  if (
                    !payload.transferId ||
                    typeof payload.index !== 'number' ||
                    typeof payload.totalChunks !== 'number' ||
                    typeof payload.chunk !== 'string' ||
                    payload.totalChunks <= 0 ||
                    payload.index < 0
                  ) return;
                  const key = payload.transferId;
                  if (!incomingBundleChunksRef.current[key]) {
                    incomingBundleChunksRef.current[key] = {
                      totalChunks: payload.totalChunks,
                      parts: new Array(payload.totalChunks).fill(''),
                      received: 0,
                    };
                  }
                  const acc = incomingBundleChunksRef.current[key];
                  if (payload.index >= acc.totalChunks) return;
                  if (!acc.parts[payload.index]) {
                    acc.parts[payload.index] = payload.chunk;
                    acc.received += 1;
                  }
                  if (acc.received >= acc.totalChunks) {
                    const full = acc.parts.join('');
                    delete incomingBundleChunksRef.current[key];
                    void applyIncomingBundleSnapshot(full);
                  }
              }
              if (data.type === 'DOCUMENTS_SYNC' && data.payload) {
                  const payload = data.payload as {
                    documentsByIndividualId?: Record<string, unknown>;
                    authorPeerId?: string;
                    partial?: boolean;
                    scopeIndividualId?: string;
                    batchIndex?: number;
                    batchTotal?: number;
                    documentItemsInPayload?: number;
                    photoItemsInPayload?: number;
                    documentItemsTotal?: number;
                    photoItemsTotal?: number;
                  };
                  processIncomingDocumentsPayload(payload);
              }
              if (data.type === 'DOCUMENTS_SYNC_CHUNK' && data.payload) {
                  const payload = data.payload as {
                    transferId?: string;
                    index?: number;
                    totalChunks?: number;
                    chunk?: string;
                    authorPeerId?: string;
                    partial?: boolean;
                    scopeIndividualId?: string;
                    batchIndex?: number;
                    batchTotal?: number;
                    documentItemsInPayload?: number;
                    photoItemsInPayload?: number;
                    documentItemsTotal?: number;
                    photoItemsTotal?: number;
                  };
                  if (
                    !payload.transferId ||
                    typeof payload.index !== 'number' ||
                    typeof payload.totalChunks !== 'number' ||
                    typeof payload.chunk !== 'string' ||
                    payload.totalChunks <= 0 ||
                    payload.index < 0
                  ) return;
                  const key = payload.transferId;
                  if (!incomingDocumentChunksRef.current[key]) {
                    incomingDocumentChunksRef.current[key] = {
                      totalChunks: payload.totalChunks,
                      parts: new Array(payload.totalChunks).fill(''),
                      received: 0,
                      meta: {
                        authorPeerId: payload.authorPeerId,
                        partial: payload.partial,
                        scopeIndividualId: payload.scopeIndividualId,
                        batchIndex: payload.batchIndex,
                        batchTotal: payload.batchTotal,
                        documentItemsInPayload: payload.documentItemsInPayload,
                        photoItemsInPayload: payload.photoItemsInPayload,
                        documentItemsTotal: payload.documentItemsTotal,
                        photoItemsTotal: payload.photoItemsTotal,
                      },
                    };
                  }
                  const acc = incomingDocumentChunksRef.current[key];
                  if (payload.index >= acc.totalChunks) return;
                  if (!acc.parts[payload.index]) {
                    acc.parts[payload.index] = payload.chunk;
                    acc.received += 1;
                  }
                  if (acc.received >= acc.totalChunks) {
                    const full = acc.parts.join('');
                    const meta = acc.meta;
                    delete incomingDocumentChunksRef.current[key];
                    try {
                      const parsedDocs = JSON.parse(full) as Record<string, unknown>;
                      processIncomingDocumentsPayload({
                        ...meta,
                        documentsByIndividualId: parsedDocs,
                      });
                    } catch (error) {
                      console.error('Failed to parse DOCUMENTS_SYNC_CHUNK payload', error);
                    }
                  }
              }
              if (data.type === 'DOCUMENT_PATCH' && data.payload) {
                  const payload = data.payload as {
                    operation?: 'add' | 'update' | 'remove' | 'set_primary';
                    individualId?: string;
                    doc?: unknown;
                    docId?: string;
                    patch?: Record<string, unknown>;
                    authorPeerId?: string;
                    updatedAt?: string;
                  };
                  const allowDocumentsInbound =
                    p2pModeRef.current === 'client'
                      ? (remoteAccessPolicy?.allowDocuments ?? true)
                      : visibilitySettingsRef.current.allowDocuments;
                  if (!allowDocumentsInbound) return;
                  applyIncomingDocumentPatch(payload);
                  const docsDelta =
                    payload.operation === 'add' || payload.operation === 'update'
                      ? 1
                      : 0;
                  const photoDelta =
                    payload.operation === 'add' && payload.doc && normalizeDocumentsByIndividual({ x: [payload.doc] }).x?.[0]?.kind === 'photo'
                      ? 1
                      : 0;
                  if (p2pModeRef.current === 'host' && payload.individualId) {
                    const changedIndividual = gedcomDataRef.current?.individuals?.[payload.individualId];
                    const changedLabel = changedIndividual
                      ? (`${changedIndividual.givenName || ''} ${changedIndividual.surname || ''}`.trim() || changedIndividual.name || changedIndividual.id)
                      : payload.individualId;
                    setP2PProposals((prev) => [
                      {
                        proposalId: `proposal-doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                        individualId: payload.individualId!,
                        individualLabel: changedLabel,
                        authorPeerId: payload.authorPeerId || 'remote',
                        proposedAt: payload.updatedAt || new Date().toISOString(),
                        operation: 'update_individual' as const,
                        changeSet: {},
                        status: 'pending' as const,
                        source: 'live' as const,
                        proposalKind: 'documents' as const,
                        scopeIndividualId: payload.individualId,
                        documentItemsDelta: docsDelta,
                        photoItemsDelta: photoDelta,
                      },
                      ...prev,
                    ].slice(0, 300));
                  }
                  showTransientToast('success', t('app.toasts.documentsUpdatedByPeer'), 1200);
              }
              if (data.type === 'SESSION_STATE' && data.payload) {
                  const payload = data.payload as {
                    hasGedcom?: boolean;
                    individualCount?: number;
                    sentAt?: string;
                    mode?: P2PMode;
                    requestEcho?: boolean;
                  };
                  setRemotePeerHasData(typeof payload.hasGedcom === 'boolean' ? payload.hasGedcom : null);
                  logP2PActivity(
                    'session.state.received',
                    'session',
                    `remote:${payload.hasGedcom ? 'loaded' : 'empty'}:${payload.individualCount ?? 0}`,
                    data.senderPeerId || 'remote'
                  );
                  if (payload.requestEcho) {
                    sendSessionState(false);
                  }
              }
              if (data.type === 'INVITE_CREATE' && data.payload) {
                  const payload = data.payload as {
                    invite?: P2PInviteItem;
                    token?: string;
                    inviteLink?: string;
                    fromPeerId?: string;
                  };
                  if (payload.invite) {
                    setP2PInvites((prev) => {
                      const existingIndex = prev.findIndex((invite) => invite.inviteId === payload.invite!.inviteId);
                      const normalized: P2PInviteItem = {
                        ...payload.invite!,
                        status: payload.invite!.status || 'active',
                        accessProfile: payload.invite!.accessProfile || buildAccessProfileFromRole(payload.invite!.role),
                        token: payload.token || payload.invite!.token,
                        inviteLink: payload.inviteLink || payload.invite!.inviteLink,
                      };
                      if (existingIndex >= 0) {
                        const next = [...prev];
                        next[existingIndex] = { ...next[existingIndex], ...normalized };
                        return next;
                      }
                      return [normalized, ...prev];
                    });
                    logP2PActivity('invite.received', 'invite', payload.invite.inviteId, payload.fromPeerId || 'remote');
                  }
              }
              if (data.type === 'INVITE_REVOKE' && data.payload) {
                  const payload = data.payload as { inviteId?: string; fromPeerId?: string };
                  if (payload.inviteId) {
                    setP2PInvites((prev) =>
                      prev.map((invite) =>
                        invite.inviteId === payload.inviteId ? { ...invite, status: 'revoked' } : invite
                      )
                    );
                    logP2PActivity('invite.revoked.remote', 'invite', payload.inviteId, payload.fromPeerId || 'remote');
                  }
              }
              if (data.type === 'INVITE_ACCEPT' && data.payload && p2pModeRef.current === 'host') {
                  const payload = data.payload as {
                    inviteId?: string;
                    token?: string;
                    acceptedAt?: string;
                    claimantPeerId?: string;
                  };
                  if (payload.inviteId && payload.token) {
                    const targetInvite = p2pInvitesRef.current.find((invite) => invite.inviteId === payload.inviteId);
                    if (!targetInvite || targetInvite.status === 'revoked') {
                      logP2PActivity('invite.accept.rejected', 'invite', payload.inviteId, payload.claimantPeerId || 'remote');
                      showTransientToast('error', 'Invitation invalide ou révoquée.', 2200);
                    } else {
                      const secret = getOrCreateInviteSecret();
                      verifyInviteToken(payload.token, secret).then((claims) => {
                        if (!claims || claims.inviteId !== payload.inviteId) {
                          logP2PActivity('invite.accept.rejected', 'invite', payload.inviteId!, payload.claimantPeerId || 'remote');
                          showTransientToast('error', 'Token d’invitation invalide.', 2200);
                          return;
                        }
                        const basePolicy = targetInvite.accessProfile || buildAccessProfileFromRole(targetInvite.role);
                        const sessionPolicy = intersectAccessPolicy(basePolicy, visibilitySettingsRef.current);
                        setActiveSessionPeerPolicy(sessionPolicy);
                        activeSessionPeerPolicyRef.current = sessionPolicy;
                        setP2PInvites((prev) =>
                          prev.map((invite) =>
                            invite.inviteId === payload.inviteId ? { ...invite, status: 'accepted' } : invite
                          )
                        );
                        p2pService.sendMessage('ACCESS_PROFILE_SET', {
                          profile: sessionPolicy,
                          fromPeerId: peerId || 'host',
                          inviteId: payload.inviteId,
                        });
                        if (gedcomDataRef.current) {
                          setP2PSessionUseCase('share');
                          p2pSessionUseCaseRef.current = 'share';
                          sendP2PSnapshot(gedcomDataRef.current, documentsByIndividualId, 'sync.refresh');
                        }
                        logP2PActivity('invite.accepted', 'invite', payload.inviteId, payload.claimantPeerId || 'remote');
                        showTransientToast('success', 'Invitation acceptée et profil appliqué.', 2200);
                      }).catch(() => {
                        showTransientToast('error', 'Validation du token échouée.', 2200);
                      });
                    }
                  }
              }
              if (data.type === 'ACCESS_PROFILE_SET' && data.payload) {
                  const payload = data.payload as { profile?: P2PVisibilitySettings; fromPeerId?: string };
                  if (payload.profile) {
                    setRemoteAccessPolicy({
                      ...payload.profile,
                      allowDocuments: payload.profile.allowDocuments ?? true,
                    });
                    logP2PActivity('policy.received', 'session', payload.fromPeerId || 'remote');
                  }
              }
              if (data.type === 'MERGE_APPLY' && data.payload && p2pModeRef.current === 'host') {
                  const payload = data.payload as {
                    operation?: 'update_individual' | 'create_individual' | 'delete_individual';
                    individualId?: string;
                    proposedIndividual?: Individual;
                    proposedFamilies?: Record<string, Family>;
                    relatedIndividuals?: Record<string, Individual>;
                    changeSet?: Partial<Individual>;
                    authorPeerId?: string;
                  };
                  const allowDirectEdit = activeSessionPeerPolicyRef.current?.allowDirectEdit ?? visibilitySettingsRef.current.allowDirectEdit;
                  if (!allowDirectEdit) {
                    logP2PActivity('merge_apply.rejected_policy', 'session', payload.individualId || 'unknown', payload.authorPeerId || 'remote');
                    showTransientToast('error', 'Édition directe refusée par la politique.', 1800);
                    return;
                  }
                  if (!payload.operation || !payload.individualId) return;
                  const mergedData = JSON.parse(
                    JSON.stringify(originalGedcomDataRef.current || { individuals: {}, families: {} })
                  ) as GedcomData;
                  if (payload.operation === 'create_individual' && payload.proposedIndividual) {
                    mergedData.individuals[payload.proposedIndividual.id] = payload.proposedIndividual;
                    if (payload.proposedFamilies) mergedData.families = { ...mergedData.families, ...payload.proposedFamilies };
                    if (payload.relatedIndividuals) mergedData.individuals = { ...mergedData.individuals, ...payload.relatedIndividuals };
                  } else if (payload.operation === 'delete_individual') {
                    delete mergedData.individuals[payload.individualId];
                    Object.values(mergedData.families).forEach((fam) => {
                      if (fam.husbandId === payload.individualId) fam.husbandId = undefined;
                      if (fam.wifeId === payload.individualId) fam.wifeId = undefined;
                      fam.childrenIds = fam.childrenIds.filter((childId) => childId !== payload.individualId);
                    });
                  } else if (payload.operation === 'update_individual' && mergedData.individuals[payload.individualId]) {
                    mergedData.individuals[payload.individualId] = {
                      ...mergedData.individuals[payload.individualId],
                      ...(payload.changeSet || {}),
                    };
                  }
                  setOriginalGedcomData(mergedData);
                  refreshFocusedIndividualsFromData(mergedData);
                  setTimeout(() => setNormalizedGedcomData(normalizeGedcom(mergedData)), 10);
                  logP2PActivity('merge_apply.applied', 'individual', payload.individualId, payload.authorPeerId || 'remote');
                  showTransientToast('success', 'Édition directe appliquée.', 1600);
              }
              if (data.type === 'INDIVIDUAL_DIFF_REQUEST' && data.payload) {
                  const payload = data.payload as IndividualDiffRequestPayload;
                  const currentData = gedcomDataRef.current;
                  if (!currentData || !payload.requestToken) return;
                  if (payload.phase === 'index' && Array.isArray(payload.index)) {
                    const classification = classifyRemoteIndexAgainstLocal(
                      payload.index,
                      data.senderPeerId || 'remote'
                    );
                    p2pService.sendMessage('INDIVIDUAL_DIFF_RESPONSE', {
                      phase: 'index',
                      requestToken: payload.requestToken,
                      batchId: payload.batchId,
                      indexResult: {
                        onlyOnSender: classification.onlyOnSender,
                        potentialMatches: classification.potentialMatches,
                      },
                      requestIds: classification.requestIdsForSenderDetails,
                    } as IndividualDiffResponsePayload);
                    logP2PActivity('initial_compare.index.received', 'session', payload.requestToken, peerId || 'peer');

                    if (classification.requestIdsForSenderDetails.length > 0) {
                      const potentialMatchesBySenderId = classification.potentialMatches.reduce<Record<string, IndividualDiffPotentialMatch>>((acc, match) => {
                        acc[match.senderId] = match;
                        return acc;
                      }, {});
                      initialDiffContextsRef.current[payload.requestToken] = {
                        requestToken: payload.requestToken,
                        batchId: payload.batchId || `batch-${Date.now()}`,
                        retryCount: 0,
                        pendingRequestIds: [...classification.requestIdsForSenderDetails],
                        potentialMatchesBySenderId,
                        startedAt: Date.now(),
                      };
                      p2pService.sendMessage('INDIVIDUAL_DIFF_REQUEST', {
                        phase: 'details',
                        requestToken: payload.requestToken,
                        batchId: payload.batchId,
                        requestIds: classification.requestIdsForSenderDetails,
                        retryCount: 0,
                      } as IndividualDiffRequestPayload);
                      setInitialCompareStatusText(`requesting details ${classification.requestIdsForSenderDetails.length}`);
                      scheduleInitialDiffDetailsRetry(payload.requestToken);
                    }
                  }
                  if (payload.phase === 'details' && Array.isArray(payload.requestIds)) {
                    const policy = getEffectiveSharePolicy();
                    const details = payload.requestIds
                      .slice(0, INITIAL_DIFF_BATCH_LIMIT)
                      .map((senderId) => {
                        const bundle = collectRelatedPayload(senderId, currentData);
                        if (!bundle) return null;
                        const sharedIndividual = filterIndividualForSharing(bundle.individual, policy);
                        const sharedRelatedIndividuals = Object.fromEntries(
                          Object.entries(bundle.relatedIndividuals).map(([id, indi]) => [id, filterIndividualForSharing(indi, policy)])
                        );
                        return {
                          senderId,
                          fingerprint: buildDiffFingerprint(sharedIndividual, policy),
                          individual: sharedIndividual,
                          relatedFamilies: bundle.relatedFamilies,
                          relatedIndividuals: sharedRelatedIndividuals,
                        };
                      })
                      .filter((entry): entry is NonNullable<typeof entry> => !!entry);
                    p2pService.sendMessage('INDIVIDUAL_DIFF_RESPONSE', {
                      phase: 'details',
                      requestToken: payload.requestToken,
                      batchId: payload.batchId,
                      details,
                    } as IndividualDiffResponsePayload);
                    logP2PActivity('initial_compare.details.sent', 'session', payload.requestToken, peerId || 'peer');
                  }
              }
              if (data.type === 'INDIVIDUAL_DIFF_RESPONSE' && data.payload) {
                  const payload = data.payload as IndividualDiffResponsePayload;
                  if (!payload.requestToken) return;
                  if (payload.phase === 'index' && payload.indexResult) {
                    const requestIds = Array.from(new Set(
                      (payload.requestIds && payload.requestIds.length > 0)
                        ? payload.requestIds
                        : [
                            ...payload.indexResult.onlyOnSender,
                            ...payload.indexResult.potentialMatches.map((m) => m.senderId),
                          ]
                    )).slice(0, INITIAL_DIFF_BATCH_LIMIT);
                    const potentialMatchesBySenderId = payload.indexResult.potentialMatches.reduce<Record<string, IndividualDiffPotentialMatch>>((acc, match) => {
                      acc[match.senderId] = match;
                      return acc;
                    }, {});
                    initialDiffContextsRef.current[payload.requestToken] = {
                      requestToken: payload.requestToken,
                      batchId: payload.batchId || `batch-${Date.now()}`,
                      retryCount: 0,
                      pendingRequestIds: requestIds,
                      potentialMatchesBySenderId,
                      startedAt: Date.now(),
                    };
                    if (requestIds.length > 0) {
                      p2pService.sendMessage('INDIVIDUAL_DIFF_REQUEST', {
                        phase: 'details',
                        requestToken: payload.requestToken,
                        batchId: payload.batchId,
                        requestIds,
                        retryCount: 0,
                      } as IndividualDiffRequestPayload);
                      setInitialCompareStatusText(`requesting details ${requestIds.length}`);
                      logP2PActivity('initial_compare.index.processed', 'session', payload.requestToken, peerId || 'peer');
                      scheduleInitialDiffDetailsRetry(payload.requestToken);
                    } else {
                      setInitialCompareStatusText('initial compare: no differences');
                    }
                  }
                  if (payload.phase === 'details' && Array.isArray(payload.details)) {
                    clearInitialDiffTimeout(payload.requestToken);
                    const currentData = gedcomDataRef.current;
                    if (!currentData) return;
                    const context = initialDiffContextsRef.current[payload.requestToken];
                    const unresolved = new Set(context?.pendingRequestIds || []);
                    let created = 0;
                    let updated = 0;
                    for (const detail of payload.details) {
                      if (!detail || typeof detail !== 'object') continue;
                      unresolved.delete(detail.senderId);
                      const remoteIndividual = detail.individual as Individual | undefined;
                      if (!remoteIndividual || !remoteIndividual.id) continue;
                      const match = context?.potentialMatchesBySenderId?.[detail.senderId];
                      const proposalKey = `${data.senderPeerId || 'remote'}:${detail.senderId}:${detail.fingerprint}:${context?.batchId || payload.batchId || 'batch'}`;
                      if (initialDiffSeenProposalKeysRef.current.has(proposalKey)) continue;
                      initialDiffSeenProposalKeysRef.current.add(proposalKey);
                      const confidence = confidenceFromScore(match?.score ?? 0);

                      const rejectedKey = getRejectedMatchKey(
                        data.senderPeerId || 'remote',
                        detail.fingerprint,
                        detail.senderId
                      );
                      const rejectedReceiverIds = rejectedKey
                        ? (rejectedInitialMatchesRef.current[rejectedKey] || new Set<string>())
                        : new Set<string>();
                      const retryAfterReject = rejectedReceiverIds.size > 0;

                      if (
                        match &&
                        match.score >= 0.95 &&
                        currentData.individuals[match.receiverId] &&
                        !rejectedReceiverIds.has(match.receiverId)
                      ) {
                        const before = currentData.individuals[match.receiverId];
                        const confidence = confidenceFromScore(match.score);
                        if (!isIdentityCoherentForUpdate(before, remoteIndividual) || confidence !== 'high') {
                          const newId = allocateUniqueIndividualId(remoteIndividual.id, currentData);
                          const proposedIndividual = { ...remoteIndividual, id: newId };
                          const proposalId = `proposal-initial-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                          upsertIncomingProposal({
                            proposalId,
                            individualId: newId,
                            individualLabel: `${proposedIndividual.givenName || ''} ${proposedIndividual.surname || ''}`.trim() || proposedIndividual.name || proposedIndividual.id,
                            authorPeerId: data.senderPeerId || 'remote',
                            proposedAt: new Date().toISOString(),
                            operation: 'create_individual',
                            proposedIndividual,
                            proposedFamilies: (detail.relatedFamilies as Record<string, Family>) || {},
                            relatedIndividuals: (detail.relatedIndividuals as Record<string, Individual>) || {},
                            changeSet: proposedIndividual,
                            status: 'pending',
                            source: 'initial_compare',
                            initialSyncBatchId: context?.batchId || payload.batchId,
                            matchConfidence: 'low',
                            matchScore: match.score,
                            remoteIndividualId: detail.senderId,
                            remoteFingerprint: detail.fingerprint,
                            retryAfterReject,
                          });
                          created += 1;
                          continue;
                        }
                        const changeSet = buildInitialCompareChangeSet(before, {
                          ...before,
                          ...remoteIndividual,
                          id: before.id,
                        });
                        if (Object.keys(changeSet).length === 0) continue;
                        const proposalId = `proposal-initial-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                        upsertIncomingProposal({
                          proposalId,
                          individualId: before.id,
                          individualLabel: `${before.givenName || ''} ${before.surname || ''}`.trim() || before.name || before.id,
                          authorPeerId: data.senderPeerId || 'remote',
                          proposedAt: new Date().toISOString(),
                          operation: 'update_individual',
                          proposedIndividual: { ...before, ...changeSet },
                          changeSet,
                          status: 'pending',
                          source: 'initial_compare',
                          initialSyncBatchId: context?.batchId || payload.batchId,
                          matchConfidence: confidence,
                          matchScore: match.score,
                          remoteIndividualId: detail.senderId,
                          remoteFingerprint: detail.fingerprint,
                          retryAfterReject,
                        });
                        updated += 1;
                      } else {
                        const newId = allocateUniqueIndividualId(remoteIndividual.id, currentData);
                        const proposedIndividual = { ...remoteIndividual, id: newId };
                        const proposalId = `proposal-initial-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                        upsertIncomingProposal({
                          proposalId,
                          individualId: newId,
                          individualLabel: `${proposedIndividual.givenName || ''} ${proposedIndividual.surname || ''}`.trim() || proposedIndividual.name || proposedIndividual.id,
                          authorPeerId: data.senderPeerId || 'remote',
                          proposedAt: new Date().toISOString(),
                          operation: 'create_individual',
                          proposedIndividual,
                          proposedFamilies: (detail.relatedFamilies as Record<string, Family>) || {},
                          relatedIndividuals: (detail.relatedIndividuals as Record<string, Individual>) || {},
                          changeSet: proposedIndividual,
                          status: 'pending',
                          source: 'initial_compare',
                          initialSyncBatchId: context?.batchId || payload.batchId,
                          matchConfidence: confidence,
                          matchScore: match?.score,
                          remoteIndividualId: detail.senderId,
                          remoteFingerprint: detail.fingerprint,
                          retryAfterReject,
                        });
                        created += 1;
                      }
                    }
                    if (context) {
                      initialDiffContextsRef.current[payload.requestToken] = {
                        ...context,
                        pendingRequestIds: [...unresolved],
                      };
                    }
                    if (unresolved.size === 0) {
                      delete initialDiffContextsRef.current[payload.requestToken];
                    } else {
                      scheduleInitialDiffDetailsRetry(payload.requestToken);
                    }
                    setInitialCompareStatusText(`initial compare done: +${created} new / ${updated} updates`);
                    logP2PActivity('initial_compare.details.received', 'session', payload.requestToken, data.senderPeerId || 'remote');
                  }
              }
              if (data.type === 'PROPOSAL_SUBMIT' && data.payload) {
                  const payload = data.payload as {
                    proposalId?: string;
                    individualId?: string;
                    authorPeerId?: string;
                    proposedAt?: string;
                    operation?: 'update_individual' | 'create_individual' | 'delete_individual';
                    proposedIndividual?: Individual;
                    proposedFamilies?: Record<string, Family>;
                    relatedIndividuals?: Record<string, Individual>;
                    changeSet?: Partial<Individual>;
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
                  const allowProposalInbound =
                    p2pModeRef.current === 'host'
                      ? (activeSessionPeerPolicyRef.current?.allowProposal ?? visibilitySettingsRef.current.allowProposal)
                      : true;
                  if (!allowProposalInbound) {
                    logP2PActivity('proposal.rejected.policy', 'individual', payload.individualId || 'unknown', payload.authorPeerId || 'remote');
                    showTransientToast('error', 'Proposition refusée par la politique active.', 1800);
                    return;
                  }
                  const individual = payload.individualId ? gedcomDataRef.current?.individuals[payload.individualId] : undefined;
                  const individualLabel = individual
                    ? (`${individual.givenName || ''} ${individual.surname || ''}`.trim() || individual.name || individual.id)
                    : (
                        payload.proposedIndividual
                          ? (`${payload.proposedIndividual.givenName || ''} ${payload.proposedIndividual.surname || ''}`.trim() || payload.proposedIndividual.name || payload.proposedIndividual.id)
                          : (payload.individualId || 'unknown')
                      );
                  setP2PProposals((prev) => [
                    {
                      proposalId: payload.proposalId || `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                      individualId: payload.individualId || 'unknown',
                      individualLabel,
                      authorPeerId: payload.authorPeerId || 'remote',
                      proposedAt: payload.proposedAt || new Date().toISOString(),
                      operation: payload.operation || 'update_individual',
                      proposedIndividual: payload.proposedIndividual,
                      proposedFamilies: payload.proposedFamilies,
                      relatedIndividuals: payload.relatedIndividuals,
                      changeSet: payload.changeSet || {},
                      status: 'pending' as const,
                      source: payload.source || 'live',
                      initialSyncBatchId: payload.initialSyncBatchId,
                      matchConfidence: payload.matchConfidence,
                      matchScore: payload.matchScore,
                      remoteIndividualId: payload.remoteIndividualId,
                      remoteFingerprint: payload.remoteFingerprint,
                      retryAfterReject: payload.retryAfterReject,
                      proposalKind: payload.proposalKind || 'records',
                      scopeIndividualId: payload.scopeIndividualId,
                      documentItemsDelta: payload.documentItemsDelta,
                      photoItemsDelta: payload.photoItemsDelta,
                    },
                    ...prev,
                  ].slice(0, 300));
                  logP2PActivity('proposal.received', 'individual', payload.individualId || 'unknown', payload.authorPeerId || 'remote');
                  showTransientToast('success', 'Nouvelle proposition recue.', 1800);
              }
              if (data.type === 'PROPOSAL_DECIDE' && data.payload) {
                  const payload = data.payload as {
                    proposalId?: string;
                    status?: 'accepted' | 'rejected';
                    decidedAt?: string;
                    hostPeerId?: string;
                  };
                  if (payload.proposalId && payload.status) {
                    const decidedStatus: 'accepted' | 'rejected' = payload.status;
                    setP2PProposals((prev) =>
                      prev.map((proposal) =>
                        proposal.proposalId === payload.proposalId
                          ? { ...proposal, status: decidedStatus, decidedAt: payload.decidedAt || new Date().toISOString() }
                          : proposal
                      )
                    );
                    logP2PActivity(`proposal.${decidedStatus}`, 'proposal', payload.proposalId, payload.hostPeerId || 'host');
                    showTransientToast(
                      decidedStatus === 'accepted' ? 'success' : 'error',
                      decidedStatus === 'accepted'
                        ? 'Votre proposition a ete validee.'
                        : 'Votre proposition a ete rejetee.',
                      1800
                    );
                  }
              }
              if (data.type === 'ACTIVITY_EVENT' && data.payload) {
                  const payload = data.payload as {
                    eventType?: string;
                    targetType?: ActivityLogEvent['targetType'];
                    targetId?: string;
                    actorPeerId?: string;
                    timestamp?: string;
                  };
                  if (payload.eventType && payload.targetType && payload.targetId) {
                    logP2PActivity(payload.eventType, payload.targetType, payload.targetId, payload.actorPeerId || 'remote');
                    if (payload.eventType === 'identity.claimed' && payload.targetType === 'individual') {
                      setRemoteIdentityClaimsByIndividualId((prev) => ({
                        ...prev,
                        [payload.targetId!]: {
                          claimedAt: payload.timestamp || new Date().toISOString(),
                          actorPeerId: payload.actorPeerId || 'remote',
                        },
                      }));
                    }
                  }
              }
          }
      );
  };

  const handleInitP2P = () => {
      const shouldJoinInviteAsClient =
        !!pendingInviteToken &&
        !!pendingInviteHostPeerId &&
        pendingInviteHostPeerId !== 'local-session';
      if (shouldJoinInviteAsClient) {
        initP2PWithMode('client', pendingInviteHostPeerId || undefined);
        return;
      }
      initP2PWithMode('host');
  };

  const handleConnectP2P = (hostId: string) => {
      const targetHostId = hostId.trim();
      if (!targetHostId) {
        alert(t('app.alerts.invalidPeerId'));
        return;
      }
      setP2pMode('client');
      p2pModeRef.current = 'client';
      p2pService.connect(targetHostId);
      logP2PActivity('peer.connect.requested', 'session', targetHostId);
  };

  // Called by CameraController when animation finishes
  const handleFlyComplete = () => {
      if (flyTarget) {
          const map: Record<CameraMode, DisplayMode> = { individual: '3d-individual', top: '3d-top', free: '3d-free' };
          setDisplayMode(map[flyTarget]);
          setFlyTarget(null);
      }
  };

  const handleTopViewEntryFrom2DComplete = useCallback(() => {
      setTopViewEntryFrom2D(null);
  }, []);

  const handle2DOrthoZoomSample = useCallback((z: number) => {
      last2DOrthoZoomRef.current = z;
  }, []);

  const handleSetDisplayMode = (target: DisplayMode) => {
      // Passage 3D → 2D : ne pas bloquer sur flyTarget / intro top (sinon « ruban → 2D » est ignoré
      // alors que setSelectedIndividual / root ont déjà tourné → même effet qu’un clic sur le nom).
      const from3dTo2d = target.startsWith('2d') && displayMode.startsWith('3d');
      if (!from3dTo2d && (flyTarget !== null || topViewEntryFrom2D !== null || isSwitchingModeRef.current)) return;
      // Si le mode cible est déjà actif, ne pas toucher au ref (évite un verrou permanent)
      if (target === displayMode) return;
      if (from3dTo2d) {
          if (flyTarget !== null) setFlyTarget(null);
          if (topViewEntryFrom2D !== null) setTopViewEntryFrom2D(null);
      }
      if (target !== '3d-top') {
          setTopViewEntryFrom2D(null);
      }
      if (!target.startsWith('2d')) {
        setTwoDOrthoHandoff(null);
      }
      isSwitchingModeRef.current = true;
      // During intentional view switches, old canvases can emit context-lost
      // while unmounting. Ignore recovery in that short window to prevent flicker.
      webglRecoverySuppressedUntilRef.current = Date.now() + 2500;

      const wasIn2D = viewMode === '2D';
      const goingTo3D = target.startsWith('3d');

      const targetCam: CameraMode = target === '3d-individual' ? 'individual'
          : target === '3d-top' ? 'top' : 'free';

      if (wasIn2D && goingTo3D) {
          if (selectedIndividual && selectedIndividual.id !== rootIndividual?.id) {
              setRootIndividual(selectedIndividual);
          }
          setAutoLayoutMode('all');
          setSceneExtras([]);
          setShowBoxes(false);
          setDisplayMode(target);
          if (target === '3d-top') {
              setTopViewEntryFrom2D({
                  orthoZoom2d: last2DOrthoZoomRef.current ?? undefined,
              });
              setFlyTarget(null);
          } else {
              setTopViewEntryFrom2D(null);
              setFlyTarget(targetCam);
          }
          return;
      }

      if (!wasIn2D && goingTo3D && target !== displayMode) {
          if (targetCam !== cameraMode) {
              setFlyTarget(targetCam);
              return;
          }
      }

      setDisplayMode(target);
  };

  const clearTwoDOrthoHandoff = useCallback(() => {
    setTwoDOrthoHandoff(null);
  }, []);

  const handle2DViewModeSwitch = (mode: '2d-grid' | '2d-individual', opts?: { orthoZoom?: number }) => {
    if (opts?.orthoZoom != null) {
      if (mode === '2d-individual') {
        setTwoDOrthoHandoff({ role: 'enteringIndividual', zoom: opts.orthoZoom });
      } else {
        setTwoDOrthoHandoff({ role: 'enteringGrid', zoom: opts.orthoZoom / WHEEL_ZOOM_IN_STEP_FACTOR });
      }
    } else {
      setTwoDOrthoHandoff(null);
    }
    handleSetDisplayMode(mode);
  };

  const handleWebGLContextLost = useCallback(() => {
    const now = Date.now();
    if (pendingInviteToken && inviteOnboardingStageRef.current !== 'ready') {
      inviteWebglRecoveryQueuedRef.current = true;
      return;
    }
    if (syncReceivingInProgressRef.current || syncApplyingInProgressRef.current) return;
    if (now < webglRecoverySuppressedUntilRef.current) return;
    if (webglRecoveryInFlightRef.current) return;
    // Minimum cooldown between recoveries — long enough to prevent GPU storm loops.
    if (now - webglLastRecoveryAtRef.current < 10000) return;

    // Anti-storm: count consecutive recoveries within a 10 s window.
    // If ≥ 3 occur, force a 15 s backoff to prevent endless remount cycles.
    if (now - webglRecoveryWindowStartRef.current > 10000) {
      webglRecoveryCountRef.current = 0;
      webglRecoveryWindowStartRef.current = now;
    }
    webglRecoveryCountRef.current += 1;
    if (webglRecoveryCountRef.current >= 3) {
      webglRecoverySuppressedUntilRef.current = now + 15000;
      webglRecoveryCountRef.current = 0;
      return;
    }

    webglRecoveryInFlightRef.current = true;
    webglLastRecoveryAtRef.current = now;
    if (webglRecoveryTimerRef.current !== null) {
      window.clearTimeout(webglRecoveryTimerRef.current);
      webglRecoveryTimerRef.current = null;
    }
    // 600 ms delay: give the GPU/driver time to stabilise before remounting.
    webglRecoveryTimerRef.current = window.setTimeout(() => {
      setWebglRecoveryKey((prev) => prev + 1);
      webglRecoveryInFlightRef.current = false;
      webglRecoveryTimerRef.current = null;
    }, 600);
  }, []);

  useEffect(() => {
    const inviteStillBlockingRecovery = !!pendingInviteToken && inviteOnboardingStage !== 'ready';
    if (inviteStillBlockingRecovery) return;
    if (!inviteWebglRecoveryQueuedRef.current) return;
    if (webglRecoveryInFlightRef.current || syncReceivingInProgressRef.current || syncApplyingInProgressRef.current) return;
    if (webglRecoveryTimerRef.current !== null) return;
    inviteWebglRecoveryQueuedRef.current = false;
    webglRecoveryInFlightRef.current = true;
    webglLastRecoveryAtRef.current = Date.now();
    webglRecoveryTimerRef.current = window.setTimeout(() => {
      setWebglRecoveryKey((prev) => prev + 1);
      webglRecoveryInFlightRef.current = false;
      webglRecoveryTimerRef.current = null;
    }, 220);
  }, [pendingInviteToken, inviteOnboardingStage]);

  useEffect(() => {
    return () => {
      if (webglRecoveryTimerRef.current !== null) {
        window.clearTimeout(webglRecoveryTimerRef.current);
      }
      if (normalizeTimeoutRef.current !== null) {
        window.clearTimeout(normalizeTimeoutRef.current);
      }
      if (normalizeIdleHandleRef.current !== null && 'cancelIdleCallback' in window) {
        (window as Window & { cancelIdleCallback?: (handle: number) => void }).cancelIdleCallback?.(normalizeIdleHandleRef.current);
      }
      if (inviteOnboardingDismissTimerRef.current !== null) {
        window.clearTimeout(inviteOnboardingDismissTimerRef.current);
      }
      if (inviteUiReadyTimerRef.current !== null) {
        window.clearTimeout(inviteUiReadyTimerRef.current);
      }
      if (inviteMediaRecoveryTimerRef.current !== null) {
        window.clearTimeout(inviteMediaRecoveryTimerRef.current);
      }
      if (pendingNormalizationFallbackTimerRef.current !== null) {
        window.clearTimeout(pendingNormalizationFallbackTimerRef.current);
      }
      if (inviteRibbonRenderRaf1Ref.current !== null) {
        window.cancelAnimationFrame(inviteRibbonRenderRaf1Ref.current);
      }
      if (inviteRibbonRenderRaf2Ref.current !== null) {
        window.cancelAnimationFrame(inviteRibbonRenderRaf2Ref.current);
      }
    };
  }, []);

  const scheduleNormalization = useCallback((data: GedcomData, defer: boolean) => {
    if (normalizeTimeoutRef.current !== null) {
      window.clearTimeout(normalizeTimeoutRef.current);
      normalizeTimeoutRef.current = null;
    }
    if (normalizeIdleHandleRef.current !== null && 'cancelIdleCallback' in window) {
      (window as Window & { cancelIdleCallback?: (handle: number) => void }).cancelIdleCallback?.(normalizeIdleHandleRef.current);
      normalizeIdleHandleRef.current = null;
    }

    const run = () => {
      const norm = normalizeGedcom(data);
      setNormalizedGedcomData(norm);
      normalizeIdleHandleRef.current = null;
      normalizeTimeoutRef.current = null;
    };

    if (!defer) {
      normalizeTimeoutRef.current = window.setTimeout(run, 50);
      return;
    }

    const w = window as Window & {
      requestIdleCallback?: (cb: IdleRequestCallback, opts?: IdleRequestOptions) => number;
    };
    if (typeof w.requestIdleCallback === 'function') {
      normalizeIdleHandleRef.current = w.requestIdleCallback(() => run(), { timeout: 2500 });
    } else {
      normalizeTimeoutRef.current = window.setTimeout(run, 1200);
    }
  }, []);

  const handleDataLoaded = (
    data: GedcomData,
    name: string = "Imported Database",
    options?: {
      preserveDocuments?: boolean;
      skipClientNormalizationFallback?: boolean;
      incomingNormalizedGedcom?: GedcomData | null;
      incomingNormalizationAlgoVersion?: string;
      /** Démo Rois d’Europe : arbre complet, Louis XIV, 3D libre, panneaux + onglet Documents. */
      royalsDemoPreset?: boolean;
    }
  ) => {
    setOriginalGedcomData(data);
    normalizedSnapshotAppliedRef.current = false;
    if (pendingNormalizationFallbackTimerRef.current !== null) {
      window.clearTimeout(pendingNormalizationFallbackTimerRef.current);
      pendingNormalizationFallbackTimerRef.current = null;
    }
    const shouldDeferNormalization =
      p2pModeRef.current === 'client' ||
      Object.keys(data.individuals).length > 15000;
    if (p2pModeRef.current === 'client') {
      const incomingNorm = options?.incomingNormalizedGedcom;
      const hasCompatibleIncomingNorm =
        !!incomingNorm?.individuals &&
        !!incomingNorm?.families &&
        (!options?.incomingNormalizationAlgoVersion || options.incomingNormalizationAlgoVersion === NORMALIZATION_ALGO_VERSION);
      if (hasCompatibleIncomingNorm && incomingNorm) {
        normalizedSnapshotAppliedRef.current = true;
        setNormalizedGedcomData(incomingNorm);
        setInviteNormalizedProgress({
          receivedChunks: 1,
          totalChunks: 1,
          applied: true,
          fallbackLocal: false,
        });
      } else {
        setNormalizedGedcomData(null);
        setInviteNormalizedProgress({
          receivedChunks: 0,
          totalChunks: 0,
          applied: false,
          fallbackLocal: false,
        });
        if (!options?.skipClientNormalizationFallback) {
          pendingNormalizationFallbackTimerRef.current = window.setTimeout(() => {
            if (normalizedSnapshotAppliedRef.current) return;
            scheduleNormalization(data, true);
            setInviteNormalizedProgress({
              receivedChunks: 0,
              totalChunks: 0,
              applied: true,
              fallbackLocal: true,
            });
          }, 7000);
        }
      }
    } else {
      scheduleNormalization(data, shouldDeferNormalization);
    }

    setDatabaseName(name);
    // P2P sync: do not wipe documents here — DOCUMENTS_SYNC may already have been applied
    // before the last GEDCOM chunk is applied; embedded docs are merged by the SYNC handler
    // immediately after this call when present.
    if (!options?.preserveDocuments) {
      setDocumentsByIndividualId({});
    }
    setActiveInfoPage(null); // Close info pages on data load
    
    // UI RESET: Ensure Panels are CLOSED so user sees the scene immediately
    setLeftPanelOpen(false); 
    setBottomPanelOpen(false); 
    setTopPanelOpen(false);
    
    // Default to Full Auto Layout for performance and complete view
    setAutoLayoutMode('all');

    // Improved selection logic:
    // 1) If we are in invite flow and target exists, focus invite target.
    // 2) Otherwise fallback to best candidate (youngest descendant heuristic).
    const individuals = Object.values(data.individuals);
    let bestCandidate = individuals[0];
    
    if (individuals.length > 0) {
        const sorted = [...individuals].sort((a, b) => {
            // 1. Generation Descending (We want the bottom of the tree)
            const genA = a.generation ?? 0;
            const genB = b.generation ?? 0;
            if (genA !== genB) return genB - genA;

            // 2. Date Descending (Youngest)
            const dateA = a.birthDate?.year ?? -9999;
            const dateB = b.birthDate?.year ?? -9999;
            if (dateA !== dateB) return dateB - dateA;

            return 0;
        });
        bestCandidate = sorted[0];
    }

    const inviteTarget =
      pendingInviteTargetIndividualId && data.individuals[pendingInviteTargetIndividualId]
        ? data.individuals[pendingInviteTargetIndividualId]
        : null;
    const royalsFocus = options?.royalsDemoPreset ? findIndividualForRoyalsDemo(data) : null;
    if (options?.royalsDemoPreset && !royalsFocus) {
      console.warn('[App] royalsDemoPreset: Louis XIV (I1341) introuvable dans les données — focus par défaut.');
    }
    const initialFocus = royalsFocus || inviteTarget || bestCandidate;

    if (initialFocus) {
      setRootIndividual(initialFocus);
      setSelectedIndividual(initialFocus);
      if (options?.royalsDemoPreset && royalsFocus) {
        // Comme le passage 2D → 3D libre (handleSetDisplayMode) : animation de vol vers
        // computeModePosition('free', …) + OrbitControls identiques (rotation off pendant le vol, puis min/max polar).
        setTopViewEntryFrom2D(null);
        setTwoDOrthoHandoff(null);
        setDisplayMode('3d-free');
        setFlyTarget('free');
        setShowBoxes(false);
        setLeftPanelOpen(true);
        setBottomPanelOpen(true);
        setRightPanelOpen(true);
        setDocumentsTabSignal((n) => n + 1);
      } else {
        setDisplayMode('2d-individual');
        setRightPanelOpen(true);
      }

      // Keep "show all" behavior to avoid apparent partial loads.
      setSelectedIdsFor2D(new Set());

      // Reset 3D extras
      setSceneExtras([]);
      // Force Scene2DIndividual centering to avoid stale focus after sync.
      setCenterRequest((prev) => prev + 1);
    }

    // Notify peer about local GEDCOM availability/state.
    if (p2pStatus === 'connected') {
      sendSessionState();
      if (p2pModeRef.current === 'host') {
        const profile = activeSessionPeerPolicy || visibilitySettingsRef.current;
        p2pService.sendMessage('ACCESS_PROFILE_SET', {
          profile,
          fromPeerId: peerId || 'host',
        });
      }
    }
  };

  // Sync selection between Original and Normalized data when toggling
  useEffect(() => {
      if (gedcomData && rootIndividual) {
          // Re-find the root individual in the current dataset (it might have new dates now)
          const newRoot = gedcomData.individuals[rootIndividual.id];
          if (newRoot) setRootIndividual(newRoot);
      }
      if (gedcomData && selectedIndividual) {
          const newSelected = gedcomData.individuals[selectedIndividual.id];
          if (newSelected) setSelectedIndividual(newSelected);
      }
  }, [isNormalized, gedcomData]);

  const handleNavigateToIndividual = (indi: Individual) => {
    if (isCreating) setIsCreating(false);
    // Ensure we use the instance from the CURRENT dataset to avoid date mismatch
    const currentIndi = gedcomData?.individuals[indi.id] || indi;
    setRootIndividual(currentIndi);
    setSelectedIndividual(currentIndi);
    // When changing root manually, we reset the exploration and auto layout
    setSceneExtras([]);
    // Signal Scene2D to center camera on this individual
    setCenterRequest(prev => prev + 1);
  };
  
  // Specialized handler for navigation from Details Panel
  // Ensures the previous person and new person are both visible in 2D
  const handleRelationNavigate = (indi: Individual) => {
      // Add current focused person to the persistent 2D set if exists
      if (selectedIndividual) {
          setSelectedIdsFor2D(prev => {
              const next = new Set(prev);
              next.add(selectedIndividual.id);
              // Also add the new target to ensure it's visible (and 'checked' in sidebar)
              next.add(indi.id);
              return next;
          });
      } else {
           setSelectedIdsFor2D(prev => new Set(prev).add(indi.id));
      }
      
      // Standard navigation
      handleNavigateToIndividual(indi);
  };

  const handleInspectIndividual = (indi: Individual) => {
    if (isCreating) setIsCreating(false);
    const currentIndi = gedcomData?.individuals[indi.id] || indi;
    setSelectedIndividual(currentIndi);

    if (viewMode === '3D') {
      setRootIndividual(currentIndi);
      setAutoLayoutMode('all');
      setSelectedIdsFor2D(prev => new Set(prev).add(currentIndi.id));
    } else if (selectedIdsFor2D.has('__NONE__')) {
      setSelectedIdsFor2D(new Set([currentIndi.id]));
    }
  };

  /** Vue 3D individuelle ou libre : clic sur le ruban → vue 2D ; clic sur le nom → sélection (close-up 3D). */
  const handle3DRibbonOpen2DIndividual = (id: string) => {
    if (isCreating) setIsCreating(false);
    const currentIndi = gedcomData?.individuals[id];
    if (!currentIndi) return;
    setSelectedIndividual(currentIndi);
    setRootIndividual(currentIndi);
    setAutoLayoutMode('all');
    setSelectedIdsFor2D((prev) => new Set(prev).add(id));
    handleSetDisplayMode('2d-individual');
  };

  const handleToggle2DSelection = (id: string) => {
    setSelectedIdsFor2D(prev => {
        const next = new Set(prev);
        
        // If "__NONE__" is active, clear it first
        if (next.has('__NONE__')) {
          next.delete('__NONE__');
        }
        
        // Simple toggle
        if (next.has(id)) {
          next.delete(id);
          
          // IMPORTANT: If Set becomes empty after removing, it means "show all"
          // But user wanted to HIDE this last one, so add "__NONE__" instead
          if (next.size === 0) {
            console.log('[App] Last individual unchecked, entering None mode');
            return new Set(['__NONE__']);
          }
        } else {
          next.add(id);
        }
        
        return next;
    });
  };

  const handleClear2DSelection = () => {
    // If currently showing filtered or none, clear to show ALL
    setSelectedIdsFor2D(new Set());
    // Don't clear selectedIndividual - keep focus on current person
  };

  // --- RECURSIVE EXPANSION LOGIC ---
  const handleExpandFamily = (startId: string, direction: 'ancestors' | 'descendants') => {
      if (!gedcomData) return;
      
      // IMPORTANT: Update selectedIndividual to match the clicked individual
      // So when switching to 3D, the correct person is centered
      const clickedIndi = gedcomData.individuals[startId];
      if (clickedIndi) {
          console.log('[App] handleExpandFamily: Setting selectedIndividual to', 
              `${clickedIndi.givenName} ${clickedIndi.surname}`);
          setSelectedIndividual(clickedIndi);
          setRootIndividual(clickedIndi); // Also sync rootIndividual
      }
      
      const newIds = new Set<string>();
      const queue = [startId];
      
      // Safety break to prevent infinite loops in malformed GEDCOMs
      let iterations = 0;
      const MAX_ITERATIONS = 5000;

      while(queue.length > 0 && iterations < MAX_ITERATIONS) {
          const currentId = queue.shift()!;
          iterations++;
          
          if (!newIds.has(currentId)) {
             newIds.add(currentId);
             
             const indi = gedcomData.individuals[currentId];
             if (!indi) continue;

             if (direction === 'ancestors') {
                 // Go UP: Find parents via familyChildId
                 if (indi.familyChildId) {
                     const fam = gedcomData.families[indi.familyChildId];
                     if (fam) {
                         if (fam.husbandId && !newIds.has(fam.husbandId)) queue.push(fam.husbandId);
                         if (fam.wifeId && !newIds.has(fam.wifeId)) queue.push(fam.wifeId);
                     }
                 }
             } else {
                 // Go DOWN: Find children via familySpouseIds
                 if (indi.familySpouseIds) {
                     indi.familySpouseIds.forEach(famId => {
                         const fam = gedcomData.families[famId];
                         if (fam && fam.childrenIds) {
                             fam.childrenIds.forEach(childId => {
                                 if (!newIds.has(childId)) queue.push(childId);
                             });
                         }
                     });
                 }
             }
          }
      }

      // REPLACE selection (not merge) - show ONLY ancestors or descendants
      setSelectedIdsFor2D(newIds);
  };

  const handleExpandAndSwitch3D = (direction: 'ancestors' | 'descendants', mode: 'top' | 'free' | 'individual') => {
    if (!selectedIndividual) return;
    handleExpandFamily(selectedIndividual.id, direction);
    const displayTarget = mode === 'top' ? '3d-top' : mode === 'individual' ? '3d-individual' : '3d-free';
    handleSetDisplayMode(displayTarget);
    // handleSetDisplayMode pose autoLayoutMode='all' ; on le corrige ici
    // (React 18 batchant les setState, ce dernier appel gagne)
    setAutoLayoutMode(direction);
    setTreeDirection(direction);
  };

  // Callback to sync 3D view visibility with 2D selection
  const handleVisibleIdsChange = (visibleIds: Set<string>) => {
    setSelectedIdsFor2D(prev => {
       // Optimization: only update if size or content differs to avoid needless renders
       if (prev.size === visibleIds.size && [...prev].every(x => visibleIds.has(x))) {
           return prev;
       }
       return new Set(visibleIds);
    });
  };

  const handleBackgroundClick = () => {
    setSelectedIndividual(null);
  };

  const handleUpdateIndividual = (updatedIndi: Individual, formData?: NewPersonData) => {
    if (!originalGedcomData) return;
    const previousIndi = originalGedcomData.individuals[updatedIndi.id];

    let newData = JSON.parse(JSON.stringify(originalGedcomData)) as GedcomData;
    newData.individuals[updatedIndi.id] = {
        ...newData.individuals[updatedIndi.id],
        givenName: updatedIndi.givenName,
        surname: updatedIndi.surname,
        name: `${updatedIndi.givenName} /${updatedIndi.surname}/`,
        gender: updatedIndi.gender,
        birthDate: updatedIndi.birthDate,
        deathDate: updatedIndi.deathDate,
        birthPlace: updatedIndi.birthPlace,
        deathPlace: updatedIndi.deathPlace,
        notes: updatedIndi.notes,
    };

    if (formData) {
      const indi = newData.individuals[updatedIndi.id];
      const wantedFatherId = formData.fatherId || undefined;
      const wantedMotherId = formData.motherId || undefined;

      const currentFamId = indi.familyChildId;
      const currentFam = currentFamId ? newData.families[currentFamId] : null;
      const currentFatherId = currentFam?.husbandId;
      const currentMotherId = currentFam?.wifeId;

      const parentsChanged = wantedFatherId !== currentFatherId || wantedMotherId !== currentMotherId;

      if (parentsChanged && (wantedFatherId || wantedMotherId)) {
        // Remove from old family if needed
        if (currentFam && currentFamId) {
          currentFam.childrenIds = currentFam.childrenIds.filter(id => id !== updatedIndi.id);
        }

        // Find or create the target family
        let targetFamId: string | null = null;
        const existingFam = Object.values(newData.families).find(f => {
          if (wantedFatherId && wantedMotherId) return f.husbandId === wantedFatherId && f.wifeId === wantedMotherId;
          if (wantedFatherId && !wantedMotherId) return f.husbandId === wantedFatherId && !f.wifeId;
          if (!wantedFatherId && wantedMotherId) return !f.husbandId && f.wifeId === wantedMotherId;
          return false;
        });

        if (existingFam) {
          targetFamId = existingFam.id;
        } else {
          targetFamId = getNextId('F', newData);
          newData.families[targetFamId] = {
            id: targetFamId,
            husbandId: wantedFatherId,
            wifeId: wantedMotherId,
            childrenIds: []
          };
          if (wantedFatherId) {
            const dad = newData.individuals[wantedFatherId];
            if (dad) {
              if (!dad.familySpouseIds) dad.familySpouseIds = [];
              if (!dad.familySpouseIds.includes(targetFamId)) dad.familySpouseIds.push(targetFamId);
            }
          }
          if (wantedMotherId) {
            const mom = newData.individuals[wantedMotherId];
            if (mom) {
              if (!mom.familySpouseIds) mom.familySpouseIds = [];
              if (!mom.familySpouseIds.includes(targetFamId)) mom.familySpouseIds.push(targetFamId);
            }
          }
        }

        if (!newData.families[targetFamId].childrenIds.includes(updatedIndi.id)) {
          newData.families[targetFamId].childrenIds.push(updatedIndi.id);
        }
        indi.familyChildId = targetFamId;
      } else if (parentsChanged && !wantedFatherId && !wantedMotherId && currentFam && currentFamId) {
        // Parents removed
        currentFam.childrenIds = currentFam.childrenIds.filter(id => id !== updatedIndi.id);
        indi.familyChildId = undefined;
      }
    }

    setOriginalGedcomData(newData);
    setTimeout(() => {
         setNormalizedGedcomData(normalizeGedcom(newData));
    }, 10);

    if (p2pStatus === 'connected') {
      const canDirectEdit =
        p2pModeRef.current === 'client'
          ? (remoteAccessPolicy?.allowDirectEdit ?? false)
          : false;
      const changeSet = buildIndividualChangeSet(previousIndi, newData.individuals[updatedIndi.id]);
      if (canDirectEdit) {
        p2pService.sendMessage('MERGE_APPLY', {
          individualId: updatedIndi.id,
          authorPeerId: peerId || 'client',
          proposedAt: new Date().toISOString(),
          operation: 'update_individual' as const,
          proposedIndividual: newData.individuals[updatedIndi.id],
          changeSet,
        });
        logP2PActivity('merge_apply.sent', 'individual', updatedIndi.id, peerId || 'client');
        return;
      }
      const allowProposal =
        p2pModeRef.current === 'client'
          ? (remoteAccessPolicy?.allowProposal ?? true)
          : true;
      if (!allowProposal) {
        alert(t('app.alerts.proposalsDisabledByPolicy'));
        return;
      }
      const proposalId = `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      p2pService.sendMessage('PROPOSAL_SUBMIT', {
        proposalId,
        individualId: updatedIndi.id,
        authorPeerId: peerId || 'client',
        proposedAt: new Date().toISOString(),
        operation: 'update_individual' as const,
        proposedIndividual: newData.individuals[updatedIndi.id],
        changeSet,
      });
      logP2PActivity('proposal.sent', 'individual', updatedIndi.id, peerId || 'client');
    }
  };

  const handleUpdateFamily = (updatedFam: Family) => {
     if (!originalGedcomData) return;
     const newOriginal = {
        ...originalGedcomData,
        families: { ...originalGedcomData.families, [updatedFam.id]: updatedFam }
     };
     setOriginalGedcomData(newOriginal);
     setTimeout(() => {
         setNormalizedGedcomData(normalizeGedcom(newOriginal));
    }, 10);
  };

  const handleDownloadGedcom = () => {
    if (!gedcomData) return;
    const effectiveAllowDownload =
      p2pModeRef.current === 'client'
        ? (remoteAccessPolicy?.allowDownload ?? true)
        : p2pVisibilitySettings.allowDownload;
    if (!effectiveAllowDownload) {
      alert(t('app.alerts.downloadDisabledByPolicy'));
      return;
    }
    const gedcomString = generateGedcom(gedcomData);
    const blob = new Blob([gedcomString], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    // Use the current database name for the file, sanitizing it a bit
    const safeName = databaseName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    link.download = `${safeName}_${new Date().toISOString().slice(0, 10)}.ged`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    logP2PActivity('tree.download', 'session', peerId || 'local');
    if (p2pStatus === 'connected' && p2pModeRef.current === 'client') {
      p2pService.sendMessage('ACTIVITY_EVENT', {
        eventType: 'tree.download.remote',
        targetType: 'session',
        targetId: peerId || 'client',
        actorPeerId: peerId || 'client',
        timestamp: new Date().toISOString(),
      });
    }
  };

  const triggerDownloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadBundle = async () => {
    if (!gedcomData) return;
    const effectiveAllowDownload =
      p2pModeRef.current === 'client'
        ? (remoteAccessPolicy?.allowDownload ?? true)
        : p2pVisibilitySettings.allowDownload;
    if (!effectiveAllowDownload) {
      alert(t('app.alerts.downloadDisabledByPolicy'));
      return;
    }
    try {
      const gedcomString = generateGedcom(gedcomData);
      const safeName = databaseName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const bundleBlob = await createG2Bundle(gedcomString, {
        version: '1.0',
        databaseName,
        exportedAt: new Date().toISOString(),
        documentsByIndividualId,
        selfIdentity,
      });
      triggerDownloadBlob(bundleBlob, `${safeName}_${new Date().toISOString().slice(0, 10)}.g2.zip`);
      logP2PActivity('tree.bundle.download', 'session', peerId || 'local');
      setBundleToast({ kind: 'success', message: t('app.toasts.archiveExported') });
      if (bundleToastTimeoutRef.current !== null) window.clearTimeout(bundleToastTimeoutRef.current);
      bundleToastTimeoutRef.current = window.setTimeout(() => setBundleToast(null), 2500);
    } catch (error) {
      console.error('Bundle export failed', error);
      setBundleToast({ kind: 'error', message: t('app.toasts.archiveExportFailed') });
      if (bundleToastTimeoutRef.current !== null) window.clearTimeout(bundleToastTimeoutRef.current);
      bundleToastTimeoutRef.current = window.setTimeout(() => setBundleToast(null), 3000);
    }
  };

  const handleImportBundle = async (
    file: File,
    importOptions?: { royalsDemo?: boolean },
  ) => {
    try {
      const { gedcomContent, metadata } = await parseG2Bundle(file);
      const parsedData = parseGedcom(gedcomContent);
      logGedcomImportDiagnostics(
        'import bundle',
        gedcomContent,
        Object.keys(parsedData.individuals).length,
      );
      const normalizedDocs = normalizeDocumentsByIndividual(
        metadata.documentsByIndividualId as Record<string, unknown>,
        parsedData.individuals,
      );
      handleDataLoaded(
        parsedData,
        metadata.databaseName || file.name.replace(/\.g2\.zip$/i, '').replace(/\.lifethread\.zip$/i, ''),
        { royalsDemoPreset: importOptions?.royalsDemo === true },
      );
      setDocumentsByIndividualId(normalizedDocs);
      if (metadata.selfIdentity && typeof metadata.selfIdentity === 'object') {
        const maybeIdentity = metadata.selfIdentity as SelfIdentityPublic;
        if (maybeIdentity.individualId && maybeIdentity.deviceKeyId) {
          setSelfIdentity(maybeIdentity);
        }
      }
      if (p2pStatus === 'connected') sendSessionState();
      logP2PActivity('tree.bundle.import', 'session', peerId || 'local');
      setBundleToast({ kind: 'success', message: t('app.toasts.archiveImported') });
      if (bundleToastTimeoutRef.current !== null) window.clearTimeout(bundleToastTimeoutRef.current);
      bundleToastTimeoutRef.current = window.setTimeout(() => setBundleToast(null), 2500);
    } catch (error) {
      console.error('Bundle import failed', error);
      setBundleToast({ kind: 'error', message: t('app.toasts.archiveImportFailed') });
      if (bundleToastTimeoutRef.current !== null) window.clearTimeout(bundleToastTimeoutRef.current);
      bundleToastTimeoutRef.current = window.setTimeout(() => setBundleToast(null), 3500);
    }
  };

  const handleRestoreAutoSave = async () => {
    try {
      isRestoringAutoSaveRef.current = true;
      setIsLoading(true);
      const snapshot = await readAutoSaveSnapshot();
      if (!snapshot) return;
      setDatabaseName(snapshot.databaseName || 'My Family Tree');
      setOriginalGedcomData(snapshot.originalGedcomData);
      setNormalizedGedcomData(normalizeGedcom(snapshot.originalGedcomData));
      setDocumentsByIndividualId(
        normalizeDocumentsByIndividual(snapshot.documentsByIndividualId, snapshot.originalGedcomData.individuals),
      );
      if (snapshot.selfIdentity?.individualId && snapshot.selfIdentity?.deviceKeyId) {
        setSelfIdentity(snapshot.selfIdentity);
      }
      setRootIndividual(null);
      setSelectedIndividual(null);
      setSelectedIdsFor2D(new Set());
      setHasAutoSaveDraft(true);
      setAutoSaveLastAt(snapshot.savedAt || new Date().toISOString());
      setAutoSaveState('saved');
      setLeftPanelOpen(true);
    } catch (error) {
      console.error('Auto-save restore failed', error);
      setAutoSaveState('error');
    } finally {
      setIsLoading(false);
      isRestoringAutoSaveRef.current = false;
    }
  };

  const logP2PActivity = (
    eventType: string,
    targetType: ActivityLogEvent['targetType'],
    targetId: string,
    actorPeerId?: string
  ) => {
    const event: ActivityLogEvent = {
      eventId: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      sessionId: peerId || 'local-session',
      actorPeerId: actorPeerId || peerId || 'local',
      eventType,
      targetType,
      targetId,
      timestamp: new Date().toISOString(),
    };
    setP2PActivityEvents((prev) => [...prev, event].slice(-500));
  };

  const buildIndividualChangeSet = (before: Individual | undefined, after: Individual): Partial<Individual> => {
    if (!before) return after;
    const changed: Partial<Individual> = {};
    const keys: Array<keyof Individual> = [
      'givenName',
      'surname',
      'name',
      'gender',
      'birthDate',
      'deathDate',
      'birthPlace',
      'deathPlace',
      'notes',
      'familyChildId',
      'familySpouseIds',
    ];
    for (const key of keys) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        changed[key] = after[key] as never;
      }
    }
    return changed;
  };

  const buildInitialCompareChangeSet = (before: Individual | undefined, after: Individual): Partial<Individual> => {
    if (!before) return after;
    const changed: Partial<Individual> = {};
    const keys: Array<keyof Individual> = [
      'givenName',
      'surname',
      'name',
      'gender',
      'birthDate',
      'deathDate',
      'birthPlace',
      'deathPlace',
      'notes',
    ];
    for (const key of keys) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        changed[key] = after[key] as never;
      }
    }
    return changed;
  };

  const handleCreateInvite = async (
    individualId: string,
    role: P2PRole,
    expiresAt?: string
  ) => {
    if (!isIdentified) {
      alert(t('app.alerts.claimIdentityBeforeInvites'));
      return;
    }
    if (!peerId) {
      showTransientToast('error', 'Activez le P2P et attendez votre Peer ID avant de créer une invitation.', 2600);
      return;
    }
    const candidate = livingCandidates.find((c) => c.id === individualId);
    if (!candidate) return;
    const inviteId = `inv-${individualId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const issuedAt = new Date().toISOString();
    const accessProfile = buildAccessProfileFromRole(role);
    const inviterIndividual =
      (selfIdentity?.individualId && gedcomData?.individuals?.[selfIdentity.individualId])
        ? gedcomData.individuals[selfIdentity.individualId]
        : null;
    const inviterName = inviterIndividual
      ? (`${inviterIndividual.givenName || ''} ${inviterIndividual.surname || ''}`.trim() || inviterIndividual.name || inviterIndividual.id)
      : undefined;
    const claims: InviteTokenClaims = {
      inviteId,
      sessionId: peerId,
      role,
      accessProfileId: `profile-${role}`,
      targetIndividualId: individualId,
      targetIndividualName: candidate.label,
      inviterName,
      issuedAt,
      expiresAt,
      nonce: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    };
    let token: string;
    try {
      token = await signInviteClaims(claims, getOrCreateInviteSecret());
    } catch (error) {
      console.error('Failed to sign invite token', error);
      showTransientToast('error', 'Impossible de signer l’invitation.', 2200);
      return;
    }
    const inviteLink = `${window.location.origin}${window.location.pathname}?invite_from=${encodeURIComponent(inviterName || 'invitant')}&invite_to=${encodeURIComponent(candidate.label)}&invite_role=${encodeURIComponent(role)}#g2invite=${encodeURIComponent(token)}`;
    const invite: P2PInviteItem = {
      inviteId,
      individualId,
      individualName: candidate.label,
      role,
      expiresAt,
      status: 'active',
      personalizedDefault: false,
      createdAt: issuedAt,
      token,
      inviteLink,
      accessProfile,
    };
    setP2PInvites((prev) => [invite, ...prev]);
    logP2PActivity('invite.created', 'invite', invite.inviteId);
    if (p2pStatus === 'connected' && p2pModeRef.current === 'host') {
      p2pService.sendMessage('INVITE_CREATE', {
        invite,
        token,
        inviteLink,
        fromPeerId: peerId || 'host',
      });
    }
    showTransientToast('success', 'Invitation personnalisée créée.', 1800);
  };

  const handleRevokeInvite = (inviteId: string) => {
    setP2PInvites((prev) =>
      prev.map((invite) =>
        invite.inviteId === inviteId ? { ...invite, status: 'revoked' as const } : invite
      )
    );
    logP2PActivity('invite.revoked', 'invite', inviteId);
    if (p2pStatus === 'connected' && p2pModeRef.current === 'host') {
      p2pService.sendMessage('INVITE_REVOKE', {
        inviteId,
        revokedAt: new Date().toISOString(),
        fromPeerId: peerId || 'host',
      });
    }
  };

  const handleAcceptInvite = (inviteId: string) => {
    const invite = p2pInvites.find((item) => item.inviteId === inviteId);
    if (!invite || invite.status !== 'active' || !invite.token) {
      showTransientToast('error', 'Invitation non disponible.', 1800);
      return;
    }
    if (p2pStatus !== 'connected' || p2pModeRef.current !== 'client') {
      showTransientToast('error', 'Connexion P2P requise pour accepter.', 1800);
      setInviteOnboardingStage('error');
      return;
    }
    if (invite.expiresAt && Date.now() > Date.parse(invite.expiresAt)) {
      setP2PInvites((prev) =>
        prev.map((item) => (item.inviteId === inviteId ? { ...item, status: 'expired' } : item))
      );
      showTransientToast('error', 'Invitation expirée.', 1800);
      return;
    }
    p2pService.sendMessage('INVITE_ACCEPT', {
      inviteId: invite.inviteId,
      token: invite.token,
      acceptedAt: new Date().toISOString(),
      claimantPeerId: peerId || 'client',
      claimantIndividualId: selfIdentity?.individualId,
      claimantDeviceKeyId: selfIdentity?.deviceKeyId,
    });
    setInviteOnboardingStage('accepted');
    setP2PInvites((prev) =>
      prev.map((item) =>
        item.inviteId === inviteId ? { ...item, status: 'accepted', personalizedDefault: false } : item
      )
    );
    if (invite.individualId) {
      setPendingInviteTargetIndividualId(invite.individualId);
    }
    setRemoteAccessPolicy(invite.accessProfile);
    setInviteOnboardingStage('syncing');
    logP2PActivity('invite.accept.sent', 'invite', inviteId, peerId || 'client');
    showTransientToast('success', 'Acceptation envoyée au généalogiste.', 1800);
  };

  const handleInviteLandingAccept = () => {
    if (!pendingInviteToken || !pendingInviteHostPeerId || !pendingInviteItem) {
      setInviteOnboardingStage('error');
      showTransientToast('error', 'Invitation incomplète ou invalide.', 2200);
      return;
    }
    inviteAcceptRequestedRef.current = true;
    setInviteRibbonFirstRenderDone(false);
    inviteReceivedDocumentScopesRef.current.clear();
    inviteMediaRecoveryRequestedRef.current = false;
    inviteMediaRecoveryAttemptRef.current = 0;
    if (inviteMediaRecoveryTimerRef.current !== null) {
      window.clearTimeout(inviteMediaRecoveryTimerRef.current);
      inviteMediaRecoveryTimerRef.current = null;
    }
    setInviteMediaRecoveryInFlight(false);
    incomingNormalizedChunksRef.current = {};
    incomingBundleChunksRef.current = {};
    normalizedSnapshotAppliedRef.current = false;
    setInviteSceneDeferred(true);
    setInviteGedcomProgress({
      receivedChunks: 0,
      totalChunks: 0,
      applied: false,
    });
    setInviteNormalizedProgress({
      receivedChunks: 0,
      totalChunks: 0,
      applied: false,
      fallbackLocal: false,
    });
    setInviteMediaProgress({
      receivedBatches: 0,
      totalBatches: 0,
      receivedDocs: 0,
      totalDocs: 0,
      receivedPhotos: 0,
      totalPhotos: 0,
    });
    if (p2pStatus === 'disconnected') {
      setInviteOnboardingStage('connecting');
      initP2PWithMode('client', pendingInviteHostPeerId);
      return;
    }
    if (p2pStatus === 'connected' && p2pModeRef.current === 'client') {
      handleAcceptInvite(pendingInviteItem.inviteId);
      return;
    }
    setInviteOnboardingStage('connecting');
  };

  const refreshFocusedIndividualsFromData = (data: GedcomData) => {
    if (selectedIndividual) {
      const nextSelected = data.individuals[selectedIndividual.id];
      if (nextSelected) setSelectedIndividual(nextSelected);
    }
    if (rootIndividual) {
      const nextRoot = data.individuals[rootIndividual.id];
      if (nextRoot) setRootIndividual(nextRoot);
    }
  };

  const handleDecideProposal = (proposalId: string, decision: 'accepted' | 'rejected') => {
    setP2PProposals((prev) => {
      const proposal = prev.find((p) => p.proposalId === proposalId);
      if (!proposal) return prev;
      if (decision === 'rejected') {
        registerRejectedInitialMatch(proposal);
      }

      if (decision === 'accepted') {
        const mergedData = JSON.parse(
          JSON.stringify(originalGedcomData || { individuals: {}, families: {} })
        ) as GedcomData;
        if (proposal.operation === 'create_individual' && proposal.proposedIndividual) {
          mergedData.individuals[proposal.proposedIndividual.id] = proposal.proposedIndividual;
          if (proposal.proposedFamilies) {
            mergedData.families = { ...mergedData.families, ...proposal.proposedFamilies };
          }
          if (proposal.relatedIndividuals) {
            mergedData.individuals = { ...mergedData.individuals, ...proposal.relatedIndividuals };
          }
        } else if (proposal.operation === 'delete_individual') {
          delete mergedData.individuals[proposal.individualId];
          Object.values(mergedData.families).forEach((fam) => {
            if (fam.husbandId === proposal.individualId) fam.husbandId = undefined;
            if (fam.wifeId === proposal.individualId) fam.wifeId = undefined;
            fam.childrenIds = fam.childrenIds.filter((id) => id !== proposal.individualId);
          });
          Object.values(mergedData.individuals).forEach((indi) => {
            if (indi.familyChildId && mergedData.families[indi.familyChildId]) {
              const fam = mergedData.families[indi.familyChildId];
              if (!fam.husbandId && !fam.wifeId && fam.childrenIds.length === 0) {
                delete mergedData.families[indi.familyChildId];
                indi.familyChildId = undefined;
              }
            }
            if (indi.familySpouseIds) {
              indi.familySpouseIds = indi.familySpouseIds.filter((famId) => {
                const fam = mergedData.families[famId];
                return !!fam;
              });
            }
          });
        } else if (proposal.individualId in mergedData.individuals) {
          mergedData.individuals[proposal.individualId] = {
            ...mergedData.individuals[proposal.individualId],
            ...proposal.changeSet,
          };
        }
        setOriginalGedcomData(mergedData);
        refreshFocusedIndividualsFromData(mergedData);
        setTimeout(() => setNormalizedGedcomData(normalizeGedcom(mergedData)), 10);
        showTransientToast('success', t('app.toasts.proposalApplied'));
      } else {
        showTransientToast('error', t('app.toasts.proposalRejected'), 1800);
      }

      logP2PActivity(`proposal.${decision}`, 'proposal', proposalId, peerId || 'host');
      if (p2pStatus === 'connected' && p2pModeRef.current === 'host') {
        p2pService.sendMessage('PROPOSAL_DECIDE', {
          proposalId,
          status: decision,
          decidedAt: new Date().toISOString(),
          hostPeerId: peerId || 'host',
        });
      }

      return prev.map((p) =>
        p.proposalId === proposalId ? { ...p, status: decision, decidedAt: new Date().toISOString() } : p
      );
    });
  };

  const handleReviewProposal = (proposalId: string) => {
    const proposal = p2pProposals.find((p) => p.proposalId === proposalId);
    if (!proposal) return;
    const individual = gedcomData?.individuals?.[proposal.individualId];
    if (individual) {
      setRootIndividual(individual);
      setSelectedIndividual(individual);
      setDisplayMode('2d-individual');
    } else if (proposal.operation === 'create_individual' && proposal.proposedIndividual) {
      setRootIndividual(proposal.proposedIndividual);
      setSelectedIndividual(proposal.proposedIndividual);
      setDisplayMode('2d-individual');
    } else {
      alert(t('app.alerts.reviewBaseMissing'));
      return;
    }
    setRightPanelOpen(true);
    setTopPanelOpen(false);
    setActiveReviewProposalId(proposalId);
    setReviewFocusSignal((prev) => prev + 1);
    logP2PActivity('proposal.review.opened', 'proposal', proposalId, peerId || 'host');
  };

  const handleReviewBulkDecision = (
    proposalId: string,
    fields: Array<keyof Individual>,
    decision: 'accept' | 'reject'
  ) => {
    const proposal = p2pProposals.find((p) => p.proposalId === proposalId);
    if (!proposal) return;
    if (!fields.length) return;
    if (decision === 'accept' && originalGedcomData && proposal.individualId in originalGedcomData.individuals) {
      const mergedData = JSON.parse(JSON.stringify(originalGedcomData)) as GedcomData;
      const target = mergedData.individuals[proposal.individualId] as unknown as Record<string, unknown>;
      const source = proposal.changeSet as unknown as Record<string, unknown>;
      for (const field of fields) {
        target[field as string] = source[field as string];
      }
      setOriginalGedcomData(mergedData);
      refreshFocusedIndividualsFromData(mergedData);
      setTimeout(() => setNormalizedGedcomData(normalizeGedcom(mergedData)), 10);
      showTransientToast('success', `${fields.length} champ(s) applique(s) dans Records.`);
    }

    let resolvedNow = false;
    let finalStatus: 'accepted' | 'rejected' | null = null;
    setP2PProposals((prev) =>
      prev.map((p) => {
        if (p.proposalId !== proposalId) return p;
        const nextChangeSet = { ...p.changeSet };
        for (const field of fields) {
          delete (nextChangeSet as Record<string, unknown>)[field as string];
        }
        const isEmpty = Object.keys(nextChangeSet).length === 0;
        if (isEmpty) {
          resolvedNow = true;
          finalStatus = decision === 'accept' ? 'accepted' : 'rejected';
        }
        return {
          ...p,
          changeSet: nextChangeSet,
          status: isEmpty ? (decision === 'accept' ? 'accepted' : 'rejected') : p.status,
          decidedAt: isEmpty ? new Date().toISOString() : p.decidedAt,
        };
      })
    );
    if (resolvedNow && finalStatus === 'rejected') {
      registerRejectedInitialMatch(proposal);
    }
    if (resolvedNow && finalStatus && p2pStatus === 'connected') {
      p2pService.sendMessage('PROPOSAL_DECIDE', {
        proposalId,
        status: finalStatus,
        decidedAt: new Date().toISOString(),
        hostPeerId: peerId || 'peer',
      });
    }
    logP2PActivity(`proposal.fields.${decision}`, 'proposal', `${proposalId}:${fields.join(',')}`, peerId || 'host');
  };

  const handleReviewGlobalDecision = (proposalId: string, decision: 'fuse' | 'reject') => {
    if (decision === 'fuse') {
      handleDecideProposal(proposalId, 'accepted');
    } else {
      handleDecideProposal(proposalId, 'rejected');
    }
    setActiveReviewProposalId(null);
  };

  const handleAddDocument = (
    individualId: string,
    doc: {
      title: string;
      url: string;
      source: 'local' | 'online';
      kind: 'photo' | 'document';
      date?: string;
      sourceAttribution?: string;
    }
  ) => {
    const inferredKind: 'photo' | 'document' =
      doc.kind === 'photo' || isImageLikeUrl(doc.url) ? 'photo' : 'document';
    const newDoc: IndividualDocument = {
      id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...doc,
      kind: inferredKind,
      isPrimaryPhoto: false,
      sourceAttribution: doc.sourceAttribution?.trim() || undefined,
    };
    let addedDoc: IndividualDocument | null = null;
    setDocumentsByIndividualId((prev) => {
      const current = prev[individualId] || [];
      const shouldBecomePrimary = newDoc.kind === 'photo' && !current.some((d) => d.kind === 'photo' && d.isPrimaryPhoto);
      const withPrimary = shouldBecomePrimary ? { ...newDoc, isPrimaryPhoto: true } : newDoc;
      addedDoc = withPrimary;
      return { ...prev, [individualId]: [...current, withPrimary] };
    });
    if (addedDoc) {
      sendDocumentPatchToPeer({
        operation: 'add',
        individualId,
        doc: addedDoc,
      });
    }
  };

  const handleRemoveDocument = (individualId: string, docId: string) => {
    setDocumentsByIndividualId((prev) => {
      const current = prev[individualId] || [];
      const next = current.filter((doc) => doc.id !== docId);
      return { ...prev, [individualId]: next };
    });
    sendDocumentPatchToPeer({
      operation: 'remove',
      individualId,
      docId,
    });
  };

  const handleSetPrimaryPhoto = (individualId: string, docId: string) => {
    setDocumentsByIndividualId((prev) => {
      const current = prev[individualId] || [];
      return {
        ...prev,
        [individualId]: current.map((doc) =>
          (doc.kind === 'photo' || isImageLikeUrl(doc.url))
            ? { ...doc, kind: 'photo', isPrimaryPhoto: doc.id === docId }
            : doc
        ),
      };
    });
    sendDocumentPatchToPeer({
      operation: 'set_primary',
      individualId,
      docId,
    });
  };

  const handleUpdateDocument = (
    individualId: string,
    docId: string,
    patch: {
      title?: string;
      url?: string;
      source?: 'local' | 'online';
      kind?: 'photo' | 'document';
      date?: string;
      sourceAttribution?: string;
    }
  ) => {
    let patchToSend: Partial<IndividualDocument> | null = null;
    setDocumentsByIndividualId((prev) => {
      const current = prev[individualId] || [];
      const next = {
        ...prev,
        [individualId]: current.map((doc) => {
          if (doc.id !== docId) return doc;
          const nextUrl = patch.url ?? doc.url;
          const nextKind: 'photo' | 'document' =
            patch.kind ?? ((isImageLikeUrl(nextUrl) || doc.kind === 'photo') ? 'photo' : 'document');
          const updated = {
            ...doc,
            ...patch,
            kind: nextKind,
            date: patch.date === '' ? undefined : (patch.date ?? doc.date),
            sourceAttribution:
              patch.sourceAttribution !== undefined
                ? (patch.sourceAttribution.trim() === '' ? undefined : patch.sourceAttribution.trim())
                : doc.sourceAttribution,
          };
          patchToSend = {
            title: updated.title,
            url: updated.url,
            source: updated.source,
            kind: updated.kind,
            date: updated.date,
            sourceAttribution: updated.sourceAttribution,
            isPrimaryPhoto: updated.isPrimaryPhoto,
          };
          return updated;
        }),
      };
      return next;
    });
    sendDocumentPatchToPeer({
      operation: 'update',
      individualId,
      docId,
      patch: patchToSend || patch,
    });
  };

  // --- Creation, Linking & Deletion Logic ---

  const handleInitIdentifySelf = () => {
    setIsIdentifyingSelf(true);
    setIsCreating(false);
    setRightPanelOpen(true);
    setIdentityTabSignal((prev) => prev + 1);
  };

  const handleClaimIdentity = async (individualId: string) => {
    if (!gedcomData?.individuals[individualId]) {
      alert(t('app.alerts.selectExistingIndividual'));
      return;
    }
    if (selfIdentity && selfIdentity.individualId !== individualId) {
      const ok = window.confirm(t('app.confirm.replaceIdentityClaim'));
      if (!ok) return;
    }

    try {
      const { devicePublicKeyJwk, devicePrivateKeyJwk, deviceKeyId } = await generateIdentityKeyMaterial();
      const claimed: SelfIdentityPublic = {
        individualId,
        status: 'claimed',
        claimedAt: new Date().toISOString(),
        deviceKeyId,
        devicePublicKeyJwk,
      };
      setSelfIdentity(claimed);
      localStorage.setItem(SELF_IDENTITY_PRIVATE_STORAGE_KEY, JSON.stringify(devicePrivateKeyJwk));
      const indi = gedcomData.individuals[individualId];
      setSelectedIndividual(indi);
      setRootIndividual(indi);
      setIsIdentifyingSelf(false);
      if (p2pStatus === 'connected' && p2pModeRef.current === 'client') {
        p2pService.sendMessage('ACTIVITY_EVENT', {
          eventType: 'identity.claimed',
          targetType: 'individual',
          targetId: individualId,
          actorPeerId: peerId || 'client',
          timestamp: new Date().toISOString(),
        });
      }
      showTransientToast('success', t('app.toasts.identityClaimed'));
    } catch (error) {
      console.error('Failed to claim identity', error);
      showTransientToast('error', t('app.toasts.identityClaimFailed'));
    }
  };

  const handleRenounceIdentity = () => {
    const ok = window.confirm(t('app.confirm.renounceIdentity'));
    if (!ok) return;
    setSelfIdentity(null);
    localStorage.removeItem(SELF_IDENTITY_PRIVATE_STORAGE_KEY);
    showTransientToast('success', t('app.toasts.identityRenounced'));
  };

  const handleExportIdentityBackup = async (password: string) => {
    if (!selfIdentity) {
      alert(t('app.alerts.noClaimedIdentity'));
      return;
    }
    if (!password || password.length < 8) {
      alert(t('app.alerts.backupPasswordMinLength'));
      return;
    }
    const privateRaw = localStorage.getItem(SELF_IDENTITY_PRIVATE_STORAGE_KEY);
    if (!privateRaw) {
      alert(t('app.alerts.missingPrivateKeyMaterial'));
      return;
    }
    try {
      const privateJwk = JSON.parse(privateRaw) as JsonWebKey;
      const backup = await buildEncryptedIdentityBackup(selfIdentity, privateJwk, password);
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
      const safe = (selfIdentity.deviceKeyId || 'identity').replace(/[^a-z0-9_-]/gi, '_');
      triggerDownloadBlob(blob, `g2-identity-backup-${safe}.json`);
      showTransientToast('success', t('app.toasts.identityBackupExported'));
    } catch (error) {
      console.error('Identity backup export failed', error);
      showTransientToast('error', t('app.toasts.identityBackupExportFailed'));
    }
  };

  const handleImportIdentityBackup = async (file: File, password: string) => {
    if (!password || password.length < 8) {
      alert(t('app.alerts.backupPasswordMinLength'));
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      if (!isIdentityBackupPayload(parsed)) {
        throw new Error(t('app.errors.invalidIdentityBackupFormat'));
      }
      const privateJwk = await decryptIdentityBackupPrivateKey(parsed, password);
      const importedIdentity = parsed.identity;
      setSelfIdentity(importedIdentity);
      localStorage.setItem(SELF_IDENTITY_PRIVATE_STORAGE_KEY, JSON.stringify(privateJwk));
      if (gedcomData?.individuals?.[importedIdentity.individualId]) {
        const indi = gedcomData.individuals[importedIdentity.individualId];
        setSelectedIndividual(indi);
        setRootIndividual(indi);
      }
      showTransientToast('success', t('app.toasts.identityBackupImported'));
      setIsIdentifyingSelf(false);
    } catch (error) {
      console.error('Identity backup import failed', error);
      showTransientToast('error', t('app.toasts.identityBackupImportFailed'));
    }
  };

  const handleInitCreation = () => {
    if (!originalGedcomData) {
      setOriginalGedcomData({ individuals: {}, families: {} });
    }
    setIsCreating(true);
    setSelectedIndividual(null);
    setRightPanelOpen(true); // Must open panel to show form
  };

  const getNextId = (prefix: 'I' | 'F', currentData: GedcomData): string => {
    const collection = prefix === 'I' ? currentData.individuals : currentData.families;
    const keys = Object.keys(collection);
    let maxId = 0;
    keys.forEach(k => {
      const match = k.match(/\d+/);
      if (match) {
        const val = parseInt(match[0], 10);
        if (val > maxId) maxId = val;
      }
    });
    return `@${prefix}${maxId + 1}@`;
  };

  const handleCreateIndividual = (formData: NewPersonData) => {
    // Only modify ORIGINAL data
    let currentData = originalGedcomData || { individuals: {}, families: {} };
    let newData = JSON.parse(JSON.stringify(currentData)) as GedcomData;

    // 1. Create New Individual
    const newId = getNextId('I', newData);
    
    const newIndi: Individual = {
      id: newId,
      name: `${formData.givenName} /${formData.surname}/`,
      givenName: formData.givenName,
      surname: formData.surname,
      gender: formData.gender,
      birthDate: formData.birthDate ? parseDate(formData.birthDate) : undefined,
      deathDate: formData.deathDate ? parseDate(formData.deathDate) : undefined,
      birthPlace: formData.birthPlace.trim() || undefined,
      deathPlace: formData.deathPlace.trim() || undefined,
      notes: formData.notes.trim() || undefined,
      familySpouseIds: [],
      generation: 0,
      source: 'manual'
    };
    newData.individuals[newId] = newIndi;

    // 2. Link Parents
    if (formData.fatherId || formData.motherId) {
       console.log('[App] Linking parents:', { fatherId: formData.fatherId, motherId: formData.motherId });
       
       let familyId = null;
       const existingFam = Object.values(newData.families).find(f => {
           if (formData.fatherId && formData.motherId) return f.husbandId === formData.fatherId && f.wifeId === formData.motherId;
           if (formData.fatherId && !formData.motherId) return f.husbandId === formData.fatherId && !f.wifeId;
           if (!formData.fatherId && formData.motherId) return !f.husbandId && f.wifeId === formData.motherId;
           return false; 
       });

       if (existingFam) {
         console.log('[App] ✓ Found existing family:', existingFam.id, 'children:', existingFam.childrenIds.length);
         familyId = existingFam.id;
       } else {
         familyId = getNextId('F', newData);
         console.log('[App] ✓ Creating new family:', familyId);
         
         newData.families[familyId] = {
           id: familyId,
           husbandId: formData.fatherId || undefined,
           wifeId: formData.motherId || undefined,
           childrenIds: []
         };
         
         if (formData.fatherId) {
            const dad = newData.individuals[formData.fatherId];
            if (!dad.familySpouseIds) dad.familySpouseIds = [];
            if (!dad.familySpouseIds.includes(familyId)) {
                dad.familySpouseIds.push(familyId);
            }
         }
         if (formData.motherId) {
            const mom = newData.individuals[formData.motherId];
            if (!mom.familySpouseIds) mom.familySpouseIds = [];
            if (!mom.familySpouseIds.includes(familyId)) {
                mom.familySpouseIds.push(familyId);
            }
         }
       }
       
       if (!newData.families[familyId].childrenIds.includes(newId)) {
           newData.families[familyId].childrenIds.push(newId);
       }
       newData.individuals[newId].familyChildId = familyId;
       
       console.log('[App] ✓ Family created/linked:', {
           familyId,
           childrenCount: newData.families[familyId].childrenIds.length,
           childAdded: newId
       });
    }

    // 3. Link Spouse & Children
    if (formData.spouseId || formData.childrenIds.length > 0) {
       let famsId: string | null = null;
       // ... (Simplified for brevity, same logic as before) ...
       // Create new family if needed
       famsId = getNextId('F', newData);
       newData.families[famsId] = { 
         id: famsId, 
         childrenIds: [],
         marriageDate: formData.marriageDate ? parseDate(formData.marriageDate) : undefined
       };
       
       const famRecord = newData.families[famsId];
       if (newIndi.gender === 'F') famRecord.wifeId = newId;
       else famRecord.husbandId = newId;

       if (formData.spouseId) {
          const spouse = newData.individuals[formData.spouseId];
          if (spouse.gender === 'F') famRecord.wifeId = spouse.id;
          else famRecord.husbandId = spouse.id;
          if (!spouse.familySpouseIds) spouse.familySpouseIds = [];
          spouse.familySpouseIds.push(famsId);
       }
       
       console.log('[App] ✓ Spouse family created with marriage date:', formData.marriageDate || 'none');

       formData.childrenIds.forEach(childId => {
          famRecord.childrenIds.push(childId);
          const child = newData.individuals[childId];
          child.familyChildId = famsId;
       });
       newData.individuals[newId].familySpouseIds = [famsId];
    }

    setOriginalGedcomData(newData);
    setTimeout(() => {
        setNormalizedGedcomData(normalizeGedcom(newData));
    }, 10);

    setIsCreating(false);
    setRootIndividual(newData.individuals[newId]);
    setSelectedIndividual(newData.individuals[newId]);
    
    setSelectedIdsFor2D(prev => new Set(prev).add(newId));
    setSceneExtras([]);
    setAutoLayoutMode('all');
    setDisplayMode('2d-individual');

    if (p2pStatus === 'connected') {
      const createdIndi = newData.individuals[newId];
      const currentSnapshot = currentData;
      const proposedFamilies = Object.fromEntries(
        Object.entries(newData.families).filter(([id, fam]) => {
          const before = currentSnapshot.families[id];
          return !before || JSON.stringify(before) !== JSON.stringify(fam);
        })
      ) as Record<string, Family>;
      const relatedIndividuals = Object.fromEntries(
        Object.entries(newData.individuals).filter(([id, indi]) => {
          if (id === newId) return false;
          const before = currentSnapshot.individuals[id];
          return !!before && JSON.stringify(before) !== JSON.stringify(indi);
        })
      ) as Record<string, Individual>;
      const canDirectEdit =
        p2pModeRef.current === 'client'
          ? (remoteAccessPolicy?.allowDirectEdit ?? false)
          : false;
      if (canDirectEdit) {
        p2pService.sendMessage('MERGE_APPLY', {
          operation: 'create_individual' as const,
          individualId: createdIndi.id,
          authorPeerId: peerId || 'peer',
          proposedAt: new Date().toISOString(),
          proposedIndividual: createdIndi,
          proposedFamilies,
          relatedIndividuals,
          changeSet: createdIndi,
        });
        logP2PActivity('merge_apply.create.sent', 'individual', createdIndi.id, peerId || 'peer');
        return;
      }
      const allowProposal =
        p2pModeRef.current === 'client'
          ? (remoteAccessPolicy?.allowProposal ?? true)
          : true;
      if (!allowProposal) {
        alert(t('app.alerts.proposalsDisabledByPolicy'));
        return;
      }
      const proposalId = `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      p2pService.sendMessage('PROPOSAL_SUBMIT', {
        proposalId,
        operation: 'create_individual' as const,
        individualId: createdIndi.id,
        authorPeerId: peerId || 'peer',
        proposedAt: new Date().toISOString(),
        proposedIndividual: createdIndi,
        proposedFamilies,
        relatedIndividuals,
        changeSet: createdIndi,
      });
      logP2PActivity('proposal.create.sent', 'individual', createdIndi.id, peerId || 'peer');
    }
  };

  const handleDeleteIndividual = (id: string) => {
    if (!originalGedcomData) return;
    const newData = JSON.parse(JSON.stringify(originalGedcomData)) as GedcomData;
    delete newData.individuals[id]; 
    Object.values(newData.families).forEach((fam) => {
      if (fam.husbandId === id) fam.husbandId = undefined;
      if (fam.wifeId === id) fam.wifeId = undefined;
      fam.childrenIds = fam.childrenIds.filter((childId) => childId !== id);
    });
    setOriginalGedcomData(newData);
    setTimeout(() => {
        setNormalizedGedcomData(normalizeGedcom(newData));
    }, 10);
    setSelectedIndividual(null);
    setDocumentsByIndividualId((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

    if (p2pStatus === 'connected') {
      const canDirectEdit =
        p2pModeRef.current === 'client'
          ? (remoteAccessPolicy?.allowDirectEdit ?? false)
          : false;
      if (canDirectEdit) {
        p2pService.sendMessage('MERGE_APPLY', {
          operation: 'delete_individual' as const,
          individualId: id,
          authorPeerId: peerId || 'peer',
          proposedAt: new Date().toISOString(),
          changeSet: {},
        });
        logP2PActivity('merge_apply.delete.sent', 'individual', id, peerId || 'peer');
        return;
      }
      const allowProposal =
        p2pModeRef.current === 'client'
          ? (remoteAccessPolicy?.allowProposal ?? true)
          : true;
      if (!allowProposal) {
        alert(t('app.alerts.proposalsDisabledByPolicy'));
        return;
      }
      const proposalId = `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      p2pService.sendMessage('PROPOSAL_SUBMIT', {
        proposalId,
        operation: 'delete_individual' as const,
        individualId: id,
        authorPeerId: peerId || 'peer',
        proposedAt: new Date().toISOString(),
        changeSet: {},
      });
      logP2PActivity('proposal.delete.sent', 'individual', id, peerId || 'peer');
    }
  };
  const handleLinkSpouse = () => {};
  const handleLinkChildToFamily = () => {};
  const handleCreateFamilyWithChild = () => {};

  // Only disable 3D controls on mouse hover — touch devices don't need this
  // (mouseenter fires on tap but mouseleave never fires, blocking controls)
  const handleToggleFilter = (tag: FilterTag) => {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const handleUIEnter = () => {
    if (matchMedia('(pointer: fine)').matches) setIsHoveringUI(true);
  };
  const handleUILeave = () => setIsHoveringUI(false);

  // Safe Close Handlers to reset hover state
  const closeLeftPanel = () => { setLeftPanelOpen(false); setIsHoveringUI(false); };
  const closeRightPanel = () => { setRightPanelOpen(false); setIsCreating(false); setIsHoveringUI(false); };
  const closeTopPanel = () => { setTopPanelOpen(false); setIsHoveringUI(false); };
  const closeBottomPanel = () => { setBottomPanelOpen(false); setIsHoveringUI(false); };
  const handleProgramCheckUpdates = async () => {
    if (!('serviceWorker' in navigator)) {
      setProgramUpdateState('unsupported');
      return;
    }
    try {
      setProgramUpdateState('checking');
      const registration = serviceWorkerRegistrationRef.current || await navigator.serviceWorker.getRegistration();
      if (!registration) {
        setProgramUpdateState('unsupported');
        return;
      }
      serviceWorkerRegistrationRef.current = registration;
      await registration.update();
      setProgramUpdateState(registration.waiting ? 'available' : 'idle');
    } catch {
      setProgramUpdateState('error');
    }
  };
  const handleProgramApplyUpdate = async () => {
    if (!('serviceWorker' in navigator)) {
      setProgramUpdateState('unsupported');
      return;
    }
    try {
      const registration = serviceWorkerRegistrationRef.current || await navigator.serviceWorker.getRegistration();
      if (!registration) {
        window.location.reload();
        return;
      }
      if (registration.waiting) {
        setProgramUpdateState('updating');
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      } else {
        window.location.reload();
      }
    } catch {
      setProgramUpdateState('error');
    }
  };
  const renderBrandMark = (compact = false) => (
    <span
      className={`inline-flex items-baseline font-black tracking-tight ${compact ? 'text-2xl md:text-3xl' : 'text-3xl md:text-4xl'} ${
        isDarkMode ? 'text-slate-200' : 'text-slate-800'
      }`}
    >
      G
      <span className="font-black text-slate-300">
        2
      </span>
    </span>
  );

  // Render content for About/Contribute/Contact pages
  const renderInfoPage = () => {
     if (!activeInfoPage) return null;
     const contentByPage: Record<'about' | 'contribute' | 'contact', { title: string; body: React.ReactNode }> = {
       about: {
        title: t('info.about.title'),
         body: (() => {
           const fr = language === 'fr';
           const lnk = 'underline hover:text-blue-500 transition-colors';
           return (
             <>
               <p>{fr
                 ? "G2 vous propose de construire et d'explorer un espace où mémoire personnelle et mémoire collective prennent formes et s'entremêlent de manière totalement nouvelle."
                 : "G2 invites you to build and explore a space where personal and collective memory take shape and intertwine in a completely new way."
               }</p>
               <p>{fr
                 ? "Vous pouvez créer, parcourir et partager des arbres généalogiques et relationnels en 2D et 3D — de quelques individus à des dizaines de milliers, enrichis de photos et de documents qui racontent votre histoire commune."
                 : "You can create, browse, and share family and relationship trees in 2D and 3D — from a handful of people to tens of thousands, enriched with photos and documents that tell your shared story."
               }</p>
               <p>{fr
                 ? "Vous pouvez aussi, si vous le désirez, entrer en relation avec d'autres qui, comme vous, explorent leur espace mémoriel, et ainsi construire de nouveaux liens et de nouvelles histoires."
                 : "You can also, if you wish, connect with others who, like you, are exploring their own memory space, and in doing so build new connections and new stories."
               }</p>
               <p>{fr
                 ? "Vos données vous appartiennent. Aucune plateforme centrale, aucun nuage fermé, aucun intermédiaire invisible. Pas de fausses identités. Pas d'Intelligence Artificielle pour vous piller."
                 : "Your data belongs to you. No central platform, no closed cloud, no invisible middlemen. No fake identities. No artificial intelligence to exploit you."
               }</p>
               <p>{fr
                 ? "Les échanges se font en pair à pair, avec un contrôle total sur ce que vous partagez, ce que vous validez et ce qui reste privé. Par exemple, certains ancêtres n'ont aucune racine connue. Grâce à G2, vous pouvez les publier et les exposer à des correspondances potentielles sur le réseau pair-à-pair — mais toute l'enquête et la validation relève de votre responsabilité."
                 : "Everything happens peer-to-peer, giving you complete control over what you share, what you approve, and what stays private. For example, some ancestors have no known roots. With G2, you can publish them and expose them to potential matches on the peer-to-peer network — but all investigation and validation remains your responsibility."
               }</p>
               <p className="tracking-[0.3em] text-center opacity-40 select-none">* * *</p>
               <p className="text-left">
                 {fr
                   ? <>G2 est développé par Olivier Auber, chercheur en art et sciences cognitives, auteur de <em>ANOPTIKON</em>, une exploration de l'internet invisible<sup className="text-blue-400 text-xs ml-px">1</sup>. Le projet s'inscrit dans une longue lignée artistique et technique :</>
                   : <>G2 is developed by Olivier Auber, researcher in art and cognitive sciences, author of <em>ANOPTIKON</em>, an exploration of the invisible internet<sup className="text-blue-400 text-xs ml-px">1</sup>. The project carries a long artistic and technical lineage:</>
                 }
                 <ul className="mt-2 space-y-1.5 ml-2">
                   <li>— {fr
                     ? <>le {'\u00AB'}centre de la disparition{'\u00BB'} et son Arbre 3D pair-à-pair<sup className="text-blue-400 text-xs ml-px">2</sup>, au début des années 2000 ;</>
                     : <>the "centre of disappearance" and its peer-to-peer 3D Tree<sup className="text-blue-400 text-xs ml-px">2</sup>, in the early 2000s;</>
                   }</li>
                   <li>— {fr
                     ? <>les principes de la toile de confiance de la monnaie libre Ğ1, mis en œuvre par le logiciel Duniter<sup className="text-blue-400 text-xs ml-px">3</sup>, initié dans les années 2010 ;</>
                     : <>the Web of Trust principles of the Ğ1 libre currency, implemented by the Duniter software<sup className="text-blue-400 text-xs ml-px">3</sup>, initiated in the early 2010s;</>
                   }</li>
                   <li>— {fr
                     ? <>une recherche en cours (2026) sur les transformations radicales de la monnaie à l'ère de l'Intelligence Artificielle Générale (IAG), dans le cadre du groupe BGI Nexus<sup className="text-blue-400 text-xs ml-px">4</sup>.</>
                     : <>an ongoing research (2026) on the radical transformations of money in the era of Artificial General Intelligence (AGI), within the BGI Nexus group<sup className="text-blue-400 text-xs ml-px">4</sup>.</>
                   }</li>
                 </ul>
               </p>
               <p>{fr
                 ? "G2 est un logiciel libre qui tente de porter ces idées doucement — à échelle humaine, génération par génération. C'est, à sa manière, une œuvre collective ouverte et en devenir."
                 : "G2 is free software that carries these ideas gently — at human scale, generation by generation. It is, in its own way, an open and ever-evolving collective artwork."
               }</p>
               <div className="mt-4 pt-3 border-t border-current/20 text-left text-xs opacity-60 space-y-1.5">
                 <p><sup>1</sup>{' '}{fr ? "ANOPTIKON, une exploration de l'internet invisible, Fyp 2019. " : "ANOPTIKON, an exploration of the invisible internet, Fyp 2019. "}<a className={lnk} href="https://anoptikon.com" target="_blank" rel="noopener noreferrer">anoptikon.com</a></p>
                 <p><sup>2</sup>{' '}{fr ? 'Petite histoire du "centre de la disparition" et du projet Arbre (Wayback Machine). ' : 'History of the "centre of disappearance" and the Arbre project (Wayback Machine). '}<a className={lnk} href="https://web.archive.org/web/20080212005110/http://arbre.km2.net/wakka.php?wiki=PetiteHistoire" target="_blank" rel="noopener noreferrer">arbre.km2.net</a></p>
                 <p><sup>3</sup>{' '}{fr ? "Duniter, logiciel de la monnaie libre Ğ1. " : "Duniter, software for the Ğ1 libre currency. "}<a className={lnk} href="https://duniter.org/" target="_blank" rel="noopener noreferrer">duniter.org</a></p>
                 <p><sup>4</sup>{' '}{fr ? '"Symmetrical Money for BGI", groupe BGI Nexus. ' : '"Symmetrical Money for BGI", BGI Nexus group. '}<a className={lnk} href="https://docs.google.com/presentation/d/178JpsLpbPO53oZAdDd2alGcQG-OCP5RBwMYFKacPz6k/edit?usp=sharing" target="_blank" rel="noopener noreferrer">Google Slides</a></p>
               </div>
             </>
           );
         })(),
       },
       contribute: {
        title: t('info.contribute.title'),
         body: (
           <>
            <p>{t('info.contribute.p1')}</p>
            <p>{t('info.contribute.p2')}</p>
            <p>{t('info.contribute.p3')}</p>
            <p>{t('info.contribute.p4')}</p>
           </>
         ),
       },
       contact: {
        title: t('info.contact.title'),
         body: (
           <>
            <p>{t('info.contact.intro')}</p>
             <p>
              {t('info.contact.technical')}{' '}
               <a className="underline hover:text-blue-500 transition-colors" href="mailto:contact@getou.app">
                 contact@getou.app
               </a>
             </p>
             <p>
              {t('info.contact.practical')}{' '}
               <a className="underline hover:text-blue-500 transition-colors" href="mailto:contact@getou.info">
                 contact@getou.info
               </a>
             </p>
             <p>
              {t('info.contact.governance')}{' '}
               <a className="underline hover:text-blue-500 transition-colors" href="mailto:contact@getou.org">
                 contact@getou.org
               </a>
             </p>
           </>
         ),
       },
     };
     const page = contentByPage[activeInfoPage];
     
     return (
       <div className={`absolute inset-0 flex flex-col items-center justify-center p-8 text-center z-[300] ${isDarkMode ? 'bg-black text-white' : 'bg-sky-50 text-black'} animate-in fade-in duration-300`}>
             <button 
                onClick={() => setActiveInfoPage(null)}
                className={`fixed top-4 right-4 p-2 rounded-full border shadow-lg backdrop-blur-sm z-[320] hover:bg-opacity-20 transition-colors ${
                  isDarkMode
                    ? 'border-slate-700 bg-black/80 hover:bg-white text-white'
                    : 'border-slate-300 bg-white/90 hover:bg-black text-black'
                }`}
                title={t('info.close')}
             >
                <X className="w-8 h-8" />
             </button>

             <button
                onClick={toggleLanguage}
                className={`fixed top-4 left-1/2 -translate-x-1/2 px-2 py-1 rounded-full border shadow-lg backdrop-blur-sm z-[320] text-xs font-bold tracking-wider transition-colors ${
                  isDarkMode
                    ? 'border-slate-700 bg-black/80 text-slate-200 hover:bg-neutral-900'
                    : 'border-slate-300 bg-white/90 text-slate-700 hover:bg-slate-100'
                }`}
                title={t('app.language.switchTo')}
                aria-label={t('app.language.switchTo')}
             >
                {language.toUpperCase()}
             </button>

             <button
                onClick={() => setIsDarkMode(!isDarkMode)}
                className={`fixed top-4 left-4 p-2 rounded-full border shadow-lg backdrop-blur-sm z-[320] transition-colors ${
                  isDarkMode
                    ? 'border-slate-700 bg-black/80 text-slate-200 hover:bg-neutral-900'
                    : 'border-slate-300 bg-white/90 text-slate-700 hover:bg-slate-100'
                }`}
                title={isDarkMode ? t('app.theme.switchToLight') : t('app.theme.switchToDark')}
                aria-label={isDarkMode ? t('app.theme.switchToLight') : t('app.theme.switchToDark')}
             >
                {isDarkMode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
             </button>

             <div className="mb-5 opacity-90">{renderBrandMark(true)}</div>
             <h2 className="text-3xl font-bold mb-6 tracking-tight uppercase">{page.title}</h2>
             <div className="max-w-2xl text-justify text-base font-light leading-relaxed opacity-80 space-y-4 overflow-y-auto max-h-[60vh] px-4 custom-scrollbar">
                {page.body}
             </div>
        </div>
     );
  };

  const renderHelpOverlay = () => {
    if (!isHelpOpen) return null;

    return (
      <div className={`fixed inset-0 z-[120] ${isDarkMode ? 'bg-black/90 text-white' : 'bg-sky-50/95 text-black'} backdrop-blur-sm`}>
        <button
          onClick={() => setIsHelpOpen(false)}
          className={`absolute top-6 right-6 p-2 rounded-full hover:bg-opacity-20 transition-colors ${isDarkMode ? 'hover:bg-white text-white' : 'hover:bg-black text-black'}`}
          title={t('help.close')}
        >
          <X className="w-7 h-7" />
        </button>

        <div className="h-full overflow-y-auto px-6 py-10 md:px-10">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-3xl font-bold tracking-tight uppercase flex items-center gap-2">
              <HelpCircle className="w-7 h-7" />
              {t('help.title')}
            </h2>
            <p className={`mt-3 text-sm ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
              {t('help.subtitle')}
            </p>

            <div className={`mt-6 rounded-xl border p-4 ${isDarkMode ? 'border-slate-700 bg-slate-900/40' : 'border-slate-300 bg-white'}`}>
              <h3 className="text-xs font-bold uppercase tracking-wider mb-3">{t('help.shortcuts')}</h3>
              <div className="space-y-3 text-sm">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={emulateRevealShortcut}
                    onChange={(e) => setEmulateRevealShortcut(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>{t('help.shortcutReveal')}</span>
                </label>

                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={showBoxes}
                    onChange={(e) => setShowBoxes(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>{t('help.shortcutBoxes')}</span>
                </label>
              </div>
            </div>

            <div className={`mt-4 rounded-xl border p-4 ${isDarkMode ? 'border-slate-700 bg-slate-900/40' : 'border-slate-300 bg-white'}`}>
              <h3 className="text-xs font-bold uppercase tracking-wider mb-3">{t('help.appearance')}</h3>
              <button
                onClick={() => setIsDarkMode(!isDarkMode)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-colors ${isDarkMode ? 'bg-black border-slate-700 text-slate-200 hover:bg-neutral-900' : 'bg-slate-200 border-slate-300 text-slate-800 hover:bg-slate-300'}`}
              >
                {isDarkMode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                <span className="text-sm font-semibold">{isDarkMode ? 'Dark' : 'Light'}</span>
              </button>

              <div className="mt-4 space-y-4 text-sm">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold">{t('help.topLabels')}</span>
                    <span className="font-mono">{topViewLabelMaxZSpan}</span>
                  </div>
                  <input
                    type="range"
                    min={100}
                    max={2000}
                    step={25}
                    value={topViewLabelMaxZSpan}
                    onChange={(e) => setTopViewLabelMaxZSpan(Number(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold">{t('help.labelFontSize')}</span>
                    <span className="font-mono">{labelFontSize.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min={1.5}
                    max={5}
                    step={0.1}
                    value={labelFontSize}
                    onChange={(e) => setLabelFontSize(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const isSyncLoadingOverlayVisible =
    !!p2pSyncStatusText &&
    (p2pMode === 'client' || isInviteLandingActive) &&
    /sending|receiving|waiting apply|applying|retry requested|share started/i.test(p2pSyncStatusText);
  const syncStatusLabel = formatSyncStatusLabel(p2pSyncStatusText);
  const loadingOverlayText = isSyncLoadingOverlayVisible
    ? `${t('help.processing')} (${syncStatusLabel})`
    : t('help.processing');

  return (
    <div className={`${isDarkMode ? 'dark [color-scheme:dark]' : '[color-scheme:light]'} flex h-screen h-dvh w-screen overflow-hidden relative transition-colors duration-500`}>
      <div className="absolute inset-0 bg-sky-50 dark:bg-black transition-colors duration-500 -z-10"></div>

      {/* --- Sidebar (Database) --- */}
      <Sidebar 
        data={gedcomData} 
        onDataLoaded={handleDataLoaded} 
        onImportBundle={handleImportBundle}
        onDownloadGedcom={handleDownloadGedcom}
        onDownloadBundle={handleDownloadBundle}
        onSelectIndividual={handleNavigateToIndividual}
        selectedId={selectedIndividual?.id || null}
        selectedIdsFor2D={selectedIdsFor2D}
        onToggle2DSelection={handleToggle2DSelection}
        onClear2DSelection={handleClear2DSelection}
        isOpen={leftPanelOpen}
        onToggle={() => setLeftPanelOpen(!leftPanelOpen)}
        isLoading={isLoading}
        onLoading={setIsLoading}
        onMouseEnter={handleUIEnter}
        onMouseLeave={handleUILeave}
        isDarkMode={isDarkMode}
        sortMode={sortMode}
        onSetSortMode={setSortMode}
        activeFilters={activeFilters}
        onToggleFilter={handleToggleFilter}
        
        // Normalization Props
        isNormalized={isNormalized}
        onToggleNormalization={() => setIsNormalized(!isNormalized)}
        autoSaveEnabled={autoSaveEnabled}
        onToggleAutoSave={() => setAutoSaveEnabled((prev) => !prev)}
        autoSaveState={autoSaveState}
        autoSaveLastAt={autoSaveLastAt}
        hasAutoSaveDraft={hasAutoSaveDraft}
        onRestoreAutoSave={handleRestoreAutoSave}
        programUpdateState={programUpdateState}
        programVersionLabel={buildLabel}
        onProgramCheckUpdates={handleProgramCheckUpdates}
        onProgramApplyUpdate={handleProgramApplyUpdate}
        documentsByIndividualId={renderedDocumentsByIndividualId}
      />
      
      <main className={`flex-1 relative h-full min-w-0 ${isDarkMode ? 'bg-black' : 'bg-[#f0f9ff]'}`}>
        
        {shouldSuspendSceneForInvite ? (
          <div className={`absolute inset-0 ${isDarkMode ? 'bg-black' : 'bg-sky-50'}`} />
        ) : viewMode === '3D' ? (
          <Scene3D 
            key={`scene3d-${webglRecoveryKey}`}
            rootIndividual={rootIndividual} 
            selectedId={selectedIndividual?.id}
            data={gedcomData} 
            primaryPhotoUrlById={renderedPrimaryPhotoUrlById}
            documentsByIndividualId={renderedDocumentsByIndividualId}
            showBoxes={showBoxes}
            showAxes={showAxes}
            onIndividualClick={handleInspectIndividual}
            onRibbonOpen2D={handle3DRibbonOpen2DIndividual}
            onBackgroundClick={handleBackgroundClick}
            onVisibleIdsChange={handleVisibleIdsChange}
            dragMode={dragMode}
            cameraMode={cameraMode}
            flyTarget={flyTarget}
            onFlyComplete={handleFlyComplete}
            topViewEntryFrom2D={topViewEntryFrom2D}
            onTopViewEntryFrom2DComplete={handleTopViewEntryFrom2DComplete}
            disableControls={isHoveringUI || !!activeInfoPage || isHelpOpen}
            isDarkMode={isDarkMode}
            relationshipRevealEnabled={relationshipRevealEnabled}
            extraIndividuals={sceneExtras}
            setExtraIndividuals={setSceneExtras}
            autoLayoutMode={autoLayoutMode}
            onSetAutoLayoutMode={setAutoLayoutMode}
            treeDirection={treeDirection}
            layoutParams={layoutParams}
            topViewLabelMaxZSpan={topViewLabelMaxZSpan}
            labelFontSize={labelFontSize}
            onWebGLContextLost={handleWebGLContextLost}
          />
        ) : is2dIndividual ? (
          <Scene2DIndividual
            key={`scene2d-individual-${webglRecoveryKey}`}
            data={gedcomData}
            selectedId={selectedIndividual?.id}
            selectedIds={selectedIdsFor2D}
            primaryPhotoUrlById={renderedPrimaryPhotoUrlById}
            documentsByIndividualId={renderedDocumentsByIndividualId}
            onIndividualClick={handleInspectIndividual}
            onExpandAndSwitch3D={handleExpandAndSwitch3D}
            onRequest2DModeSwitch={handle2DViewModeSwitch}
            onOrthoZoomSample={handle2DOrthoZoomSample}
            orthoZoomHandoff={twoDOrthoHandoff}
            onOrthoZoomHandoffConsumed={clearTwoDOrthoHandoff}
            isDarkMode={isDarkMode}
            relationshipRevealEnabled={relationshipRevealEnabled}
            sortMode={sortMode}
            activeFilters={activeFilters}
            leftPanelOpen={leftPanelOpen}
            rightPanelOpen={rightPanelOpen}
            onWebGLContextLost={handleWebGLContextLost}
          />
        ) : (
          <Scene2DGrid
            key={`scene2d-grid-${webglRecoveryKey}`}
            data={gedcomData}
            selectedId={selectedIndividual?.id}
            selectedIds={selectedIdsFor2D}
            primaryPhotoUrlById={renderedPrimaryPhotoUrlById}
            documentsByIndividualId={renderedDocumentsByIndividualId}
            onIndividualClick={handleInspectIndividual}
            onExpandAndSwitch3D={handleExpandAndSwitch3D}
            onRequest2DModeSwitch={handle2DViewModeSwitch}
            onOrthoZoomSample={handle2DOrthoZoomSample}
            orthoZoomHandoff={twoDOrthoHandoff}
            onOrthoZoomHandoffConsumed={clearTwoDOrthoHandoff}
            isDarkMode={isDarkMode}
            relationshipRevealEnabled={relationshipRevealEnabled}
            sortMode={sortMode}
            activeFilters={activeFilters}
            leftPanelOpen={leftPanelOpen}
            rightPanelOpen={rightPanelOpen}
            singleIndividual={is2dIndividual}
            onWebGLContextLost={handleWebGLContextLost}
          />
        )}
        
        {/* Invite Landing Overlay */}
        {isInviteLandingActive && (
          <div className={`absolute inset-0 z-[80] overflow-y-auto ${isDarkMode ? 'bg-black text-white' : 'bg-sky-50 text-black'}`}>
            <div className="min-h-full flex flex-col items-center justify-center p-6 md:p-10 text-center">
              <div className="mb-3 opacity-90">{renderBrandMark(true)}</div>
              <p className={`text-sm leading-relaxed max-w-2xl ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>
                {inviteLandingDescription}
              </p>
              <div className="mt-6 flex justify-center">
                {(inviteOnboardingStage === 'idle' || inviteOnboardingStage === 'connecting' || inviteOnboardingStage === 'connected' || inviteOnboardingStage === 'error') &&
                  !inviteHasAccepted &&
                  !inviteAcceptRequestedRef.current &&
                  pendingInviteItem?.status === 'active' && (
                  <button
                    type="button"
                    onClick={handleInviteLandingAccept}
                    disabled={!pendingInviteItem || inviteOnboardingStage === 'connecting'}
                    className={`px-5 py-2 rounded font-semibold disabled:opacity-50 ${isDarkMode ? 'bg-emerald-700 hover:bg-emerald-600' : 'bg-emerald-600 text-white hover:bg-emerald-500'}`}
                  >
                    {t('topPanel.inviteLandingAccept')}
                  </button>
                )}
              </div>
              <div className={`mt-6 text-xs max-w-2xl ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
                <div className="font-semibold">{inviteLandingStatusLabel}</div>
                {(inviteOnboardingStage !== 'idle' || p2pStatus !== 'disconnected') && (
                  <div className="mt-2 space-y-1">
                    {p2pSyncStatusText && (
                      <div>{t('topPanel.inviteLandingSyncDetail').replace('{{detail}}', syncStatusLabel)}</div>
                    )}
                    {inviteGedcomProgress && (
                      <div>
                        {t('topPanel.inviteLandingGedcom')}: {inviteGedcomProgress.receivedChunks}/{Math.max(inviteGedcomProgress.totalChunks, 1)}
                        {inviteGedcomProgress.applied ? ` (${t('topPanel.syncStatusDone')})` : ''}
                      </div>
                    )}
                    {!inviteGedcomProgress && remotePeerHasData !== null && <div>{t('topPanel.inviteLandingGedcom')}: {remotePeerHasData ? t('topPanel.loaded') : t('topPanel.empty')}</div>}
                    {inviteLandingMediaLabel && <div>{t('topPanel.inviteLandingMedia')}: {inviteLandingMediaLabel}</div>}
                    {inviteLandingNormalizedLabel && <div>{t('topPanel.inviteLandingNormalized')}: {inviteLandingNormalizedLabel}</div>}
                    {inviteOnboardingStage === 'completed' && !inviteRibbonFirstRenderDone && (
                      <div>{t('topPanel.inviteLandingUiPreparing')}</div>
                    )}
                    {inviteOnboardingStage === 'connected' && !inviteAcceptRequestedRef.current && (
                      <div>{t('topPanel.inviteLandingWaitingAcceptAction')}</div>
                    )}
                    <div className="mt-3 space-y-1 text-left">
                      {inviteLandingSteps.map((step) => {
                        const prefix =
                          step.status === 'done'
                            ? t('topPanel.inviteLandingStepDone')
                            : step.status === 'active'
                              ? t('topPanel.inviteLandingStepActive')
                              : t('topPanel.inviteLandingStepPending');
                        return (
                          <div key={step.key}>
                            {prefix} {step.label}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Loading Overlay */}
        {(isLoading || isSyncLoadingOverlayVisible) && (
          <div className={`absolute inset-0 flex items-center justify-center backdrop-blur-sm z-50 ${isDarkMode ? 'bg-black/80' : 'bg-sky-50/80'}`}>
             <div className={`p-8 rounded-xl border shadow-2xl flex flex-col items-center gap-4 ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-300'}`}>
                <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
                <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>{loadingOverlayText}</span>
             </div>
          </div>
        )}

        {/* Central Home Screen / Info Pages */}
        {!rootIndividual && !isLoading && !gedcomData && (
          <>
            {activeInfoPage ? renderInfoPage() : (
              <div className={`absolute inset-0 overflow-y-auto z-0 ${isDarkMode ? 'bg-black text-white' : 'bg-sky-50 text-black'}`}>
                <div className="min-h-full flex flex-col items-center justify-center gap-3 md:gap-4 p-6 md:p-10 text-center">

                  {/* G2 wordmark */}
                  <div className="mt-8 md:mt-0 flex flex-col items-center gap-1">
                    <h1 className={`inline-flex items-baseline font-black tracking-tight leading-none select-none text-7xl md:text-9xl ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>
                      G<span className="font-black text-slate-300">2</span>
                    </h1>
                    <p className={`text-[10px] md:text-xs font-light tracking-[0.25em] uppercase ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                      {t('landing.subtitle')}
                    </p>
                  </div>

                  {/* SVG Logo — entre le sous-titre et le tagline */}
                  <div className={`-my-1 ${isDarkMode ? 'drop-shadow-xl' : 'drop-shadow-md'}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" className="w-24 h-24 md:w-36 md:h-36" role="img" aria-label="G2">
                      {isDarkMode && <rect width="64" height="64" rx="12" fill="#000000"/>}
                      <line x1="16" y1="16" x2="48" y2="48" stroke="#f472b6" strokeWidth="7" strokeLinecap="round"/>
                      <line x1="48" y1="16" x2="16" y2="48" stroke="#60a5fa" strokeWidth="7" strokeLinecap="round"/>
                    </svg>
                  </div>

                  {/* Tagline */}
                  <p className={`text-[10px] md:text-xs tracking-[0.2em] uppercase font-light ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                    {t('landing.tagline')}
                  </p>

                  {/* Theme + Language toggles — icônes seules, bulles rondes */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setIsDarkMode(!isDarkMode)}
                      className={`w-8 h-8 rounded-full border flex items-center justify-center transition-colors ${
                        isDarkMode
                          ? 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                          : 'border-slate-300 bg-white text-slate-500 hover:bg-slate-100'
                      }`}
                      title={isDarkMode ? t('app.theme.switchToLight') : t('app.theme.switchToDark')}
                    >
                      {isDarkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={toggleLanguage}
                      className={`w-8 h-8 rounded-full border flex items-center justify-center text-xs font-semibold transition-colors ${
                        isDarkMode
                          ? 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                          : 'border-slate-300 bg-white text-slate-500 hover:bg-slate-100'
                      }`}
                      title={t('app.language.switchTo')}
                    >
                      {language}
                    </button>
                  </div>

                  {/* Action rows */}
                  <div className="flex flex-col items-center gap-3">
                    <div className={`flex items-center gap-2 md:gap-4 text-xs md:text-sm font-bold tracking-[0.2em] uppercase ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                      <button onClick={() => setLeftPanelOpen(true)} className="hover:text-pink-400 transition-colors cursor-pointer">
                        {t('landing.actions.import')}
                      </button>
                      <span className={`${isDarkMode ? 'text-slate-700' : 'text-slate-300'}`}>—</span>
                      <button onClick={handleInitCreation} className="hover:text-pink-400 transition-colors cursor-pointer">
                        {t('landing.actions.create')}
                      </button>
                      <span className={`${isDarkMode ? 'text-slate-700' : 'text-slate-300'}`}>—</span>
                      <button onClick={() => setBottomPanelOpen(true)} className="hover:text-pink-400 transition-colors cursor-pointer">
                        {t('landing.actions.visualize')}
                      </button>
                    </div>
                    <div className={`flex items-center gap-2 md:gap-4 text-xs md:text-sm font-bold tracking-[0.2em] uppercase ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                      <button onClick={handleInitIdentifySelf} className="hover:text-blue-400 transition-colors cursor-pointer">
                        {t('landing.actions.identify')}
                      </button>
                      <span className={`${isDarkMode ? 'text-slate-700' : 'text-slate-300'}`}>—</span>
                      <button onClick={() => setTopPanelOpen(true)} className="hover:text-blue-400 transition-colors cursor-pointer">
                        {t('landing.actions.certify')}
                      </button>
                      <span className={`${isDarkMode ? 'text-slate-700' : 'text-slate-300'}`}>—</span>
                      <button onClick={() => setTopPanelOpen(true)} className="hover:text-blue-400 transition-colors cursor-pointer">
                        {t('landing.actions.share')}
                      </button>
                    </div>
                  </div>

                  {/* Footer links */}
                  <div className={`flex items-center gap-2 text-xs tracking-widest uppercase pb-8 ${isDarkMode ? 'text-slate-600' : 'text-slate-400'}`}>
                    <button onClick={() => setActiveInfoPage('about')} className={`transition-colors ${isDarkMode ? 'hover:text-slate-300' : 'hover:text-slate-700'}`}>{t('landing.links.about')}</button>
                    <span>·</span>
                    <button onClick={() => setIsHelpOpen(true)} className={`transition-colors ${isDarkMode ? 'hover:text-slate-300' : 'hover:text-slate-700'}`}>{t('landing.links.help')}</button>
                    <span>·</span>
                    <button onClick={() => setActiveInfoPage('contribute')} className={`transition-colors ${isDarkMode ? 'hover:text-slate-300' : 'hover:text-slate-700'}`}>{t('landing.links.contribute')}</button>
                    <span>·</span>
                    <button onClick={() => setActiveInfoPage('contact')} className={`transition-colors ${isDarkMode ? 'hover:text-slate-300' : 'hover:text-slate-700'}`}>{t('landing.links.contact')}</button>
                  </div>

                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* --- Right Panel (Individuals) --- */}
      <DetailsPanel 
        individual={selectedIndividual}
        data={gedcomData}
        isOpen={rightPanelOpen}
        onToggle={() => setRightPanelOpen(!rightPanelOpen)}
        isCreating={isCreating}
        onClose={closeRightPanel}
        onSelectIndividual={handleRelationNavigate}
        onUpdateIndividual={handleUpdateIndividual}
        onUpdateFamily={handleUpdateFamily}
        onCreateIndividual={handleCreateIndividual}
        onDeleteIndividual={handleDeleteIndividual}
        onCreateNew={handleInitCreation}
        onCancelCreate={() => setIsCreating(false)}
        onLinkSpouse={handleLinkSpouse}
        onLinkChildToFamily={handleLinkChildToFamily}
        onCreateFamilyWithChild={handleCreateFamilyWithChild}
        onMouseEnter={handleUIEnter}
        onMouseLeave={handleUILeave}
        isDarkMode={isDarkMode}
        reviewProposal={activeReviewProposal}
        reviewProposals={p2pProposals}
        documents={selectedIndividualDocuments}
        onOpenReviewProposal={handleReviewProposal}
        onAddDocument={handleAddDocument}
        onUpdateDocument={handleUpdateDocument}
        onRemoveDocument={handleRemoveDocument}
        onSetPrimaryPhoto={handleSetPrimaryPhoto}
        onReviewBulkDecision={handleReviewBulkDecision}
        onReviewGlobalDecision={handleReviewGlobalDecision}
        reviewFocusSignal={reviewFocusSignal}
        documentsTabSignal={documentsTabSignal}
        selfIdentity={selfIdentity}
        isIdentifyingSelf={isIdentifyingSelf}
        identityTabSignal={identityTabSignal}
        preferredIdentityCandidateId={pendingInviteTargetIndividualId}
        remoteIdentityClaimsByIndividualId={remoteIdentityClaimsByIndividualId}
        livingCandidates={livingCandidates}
        onClaimIdentity={handleClaimIdentity}
        onExportIdentityBackup={handleExportIdentityBackup}
        onImportIdentityBackup={handleImportIdentityBackup}
        onRenounceIdentity={handleRenounceIdentity}
      />

      {/* --- Top Panel (Share) --- */}
      <TopPanel 
        isOpen={topPanelOpen}
        onToggle={() => {
            if(topPanelOpen) closeTopPanel();
            else setTopPanelOpen(true);
        }}
        isDarkMode={isDarkMode}
        onMouseEnter={handleUIEnter}
        onMouseLeave={handleUILeave}
        // P2P Props
        p2pStatus={p2pStatus}
        p2pMode={p2pMode}
        localHasData={!!gedcomData}
        remoteHasData={remotePeerHasData}
        peerId={peerId}
        onInitP2P={handleInitP2P}
        onConnectP2P={handleConnectP2P}
        onStartShare={handleStartShare}
        onStartCompare={handleStartCompare}
        transferMode={p2pTransferMode}
        onChangeTransferMode={setP2PTransferMode}
        bundleContentMode={p2pBundleContentMode}
        onChangeBundleContentMode={setP2PBundleContentMode}
        activityEvents={p2pActivityEvents}
        proposals={p2pProposals}
        visibilitySettings={p2pVisibilitySettings}
        livingCandidates={livingCandidates}
        invites={p2pInvites}
        pendingInviteToken={pendingInviteToken}
        pendingProposalsCount={pendingProposalsCount}
        syncStatusText={p2pSyncStatusText}
        initialCompareStatusText={initialCompareStatusText}
        buildLabel={buildLabel}
        onChangeVisibilitySettings={setP2PVisibilitySettings}
        onCreateInvite={handleCreateInvite}
        onRevokeInvite={handleRevokeInvite}
        onAcceptInvite={handleAcceptInvite}
        onReviewProposal={handleReviewProposal}
      />

      {/* --- Bottom Panel (Display) --- */}
      <BottomPanel 
        isOpen={bottomPanelOpen}
        onToggle={() => {
            if(bottomPanelOpen) closeBottomPanel();
            else setBottomPanelOpen(true);
        }}
        displayMode={displayMode}
        onSetDisplayMode={handleSetDisplayMode}
        isDarkMode={isDarkMode}
        onOpenHelp={() => setIsHelpOpen(true)}
        hasData={!!gedcomData}
        onMouseEnter={handleUIEnter}
        onMouseLeave={handleUILeave}
        autoLayoutMode={autoLayoutMode}
        onSetAutoLayoutMode={setAutoLayoutMode}
        layoutParams={layoutParams}
        onSetLayoutParams={setLayoutParams}
        isAnimating={flyTarget !== null || topViewEntryFrom2D !== null}
      />

      {bundleToast && (
        <div className="fixed bottom-4 right-4 z-[220] pointer-events-none">
          <div
            className={`px-3 py-2 rounded-lg border shadow-lg text-xs font-semibold ${
              bundleToast.kind === 'success'
                ? 'bg-emerald-600/95 border-emerald-500 text-white'
                : 'bg-rose-600/95 border-rose-500 text-white'
            }`}
          >
            {bundleToast.message}
          </div>
        </div>
      )}

      {renderHelpOverlay()}

    </div>
  );
}

export default App;
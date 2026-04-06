import type { MutableRefObject } from 'react';
import { generateGedcom } from '../services/gedcomParser';
import { p2pService } from '../services/p2p';
import type { ActivityLogEvent } from '../services/p2pDomain';
import { createG2Bundle } from '../services/bundleService';
import type { GedcomData, Individual, P2PMode } from '../types';
import type {
  IndividualDocument,
  P2PBundleContentMode,
  P2PSessionUseCase,
  P2PTransferMode,
  P2PVisibilitySettings,
} from './p2pAppTypes';
import {
  BUNDLE_SYNC_CHUNK_SIZE,
  DOCUMENT_SYNC_CHUNK_SIZE,
  SYNC_CHUNK_SEND_DELAY_MS,
  SYNC_CHUNK_SIZE,
} from './p2pSyncConstants';
import { isImageLikeUrl, normalizeDocumentsByIndividual } from './normalizeDocuments';

export type P2PSyncSendersLog = (
  eventType: string,
  targetType: ActivityLogEvent['targetType'],
  targetId: string,
  actorPeerId?: string
) => void;

export type P2PSyncSendersContext = {
  p2pModeRef: MutableRefObject<P2PMode>;
  p2pSessionUseCaseRef: MutableRefObject<P2PSessionUseCase>;
  p2pTransferModeRef: MutableRefObject<P2PTransferMode>;
  p2pBundleContentModeRef: MutableRefObject<P2PBundleContentMode>;
  databaseNameRef: MutableRefObject<string>;
  gedcomDataRef: MutableRefObject<GedcomData | null>;
  documentsRef: MutableRefObject<Record<string, IndividualDocument[]>>;
  visibilitySettingsRef: MutableRefObject<P2PVisibilitySettings>;
  snapshotDocumentsSendTimerRef: MutableRefObject<number | null>;
  logP2PActivityRef: MutableRefObject<P2PSyncSendersLog | null>;
  getPeerId: () => string | null;
  getRemoteAccessPolicy: () => P2PVisibilitySettings | null;
  getSelectedIndividual: () => Individual | null | undefined;
  setP2PSyncStatusText: (text: string | null) => void;
};

/**
 * Fabrique les envois P2P (GEDCOM progressif, bundle, normalisé, documents) avec lecture à jour via refs / getters.
 */
export function createP2PSyncSenders(ctx: P2PSyncSendersContext) {
  const log = (...args: Parameters<P2PSyncSendersLog>) => {
    ctx.logP2PActivityRef.current?.(...args);
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
          const c2 = canvas.getContext('2d');
          if (!c2) {
            resolve(null);
            return;
          }
          c2.drawImage(img, 0, 0);
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
      result[individualId] = await Promise.all(
        (docs || []).map(async (doc) => {
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
        })
      );
    }
    return result;
  };

  const sendDocumentsToPeer = (
    documents: Record<string, IndividualDocument[]>,
    target: string = ctx.getSelectedIndividual()?.id || 'documents',
    mode: 'full' | 'partial' = 'partial',
    options?: {
      batchIndex?: number;
      batchTotal?: number;
      totalDocumentItems?: number;
      totalPhotoItems?: number;
    }
  ) => {
    const peerId = ctx.getPeerId();
    const remoteAccessPolicy = ctx.getRemoteAccessPolicy();
    const allowDocuments =
      ctx.p2pModeRef.current === 'client'
        ? (remoteAccessPolicy?.allowDocuments ?? true)
        : ctx.visibilitySettingsRef.current.allowDocuments;
    if (!allowDocuments) return;
    const isPartial = mode === 'partial' && target !== 'documents' && !!target;
    const documentsPayload = isPartial ? { [target]: documents[target] || [] } : documents;
    const payloadStats = computeMediaStats(documentsPayload);
    const meta = {
      databaseName: ctx.databaseNameRef.current,
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
    log(isPartial ? 'documents.sync.sent.partial' : 'documents.sync.sent.full', 'individual', target, peerId || 'peer');
  };

  const sendBundleSnapshotToPeer = async (
    gedcom: GedcomData,
    documents: Record<string, IndividualDocument[]>
  ) => {
    /** Invité en session comparer : même chemin bundle que l’hôte (sinon envoi silencieux, l’hôte ne voit que SESSION_STATE). */
    const allowClientCompareBundle =
      ctx.p2pModeRef.current === 'client' && ctx.p2pSessionUseCaseRef.current === 'compare';
    if (ctx.p2pModeRef.current !== 'host' && !allowClientCompareBundle) return;
    /** Mode comparer : toujours embarquer médias / rubans (sinon invité sans photos sur la colonne distante). */
    const includeDocuments =
      ctx.p2pBundleContentModeRef.current === 'gedcom-and-documents' ||
      ctx.p2pSessionUseCaseRef.current === 'compare';
    const transferable = includeDocuments ? await toTransferableDocumentsForPeer(documents) : {};
    const gedcomText = generateGedcom(gedcom);
    const bundleBlob = await createG2Bundle(gedcomText, {
      version: '1.0',
      databaseName: ctx.databaseNameRef.current,
      exportedAt: new Date().toISOString(),
      documentsByIndividualId: transferable,
      includesDocuments: includeDocuments,
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
    const peerId = ctx.getPeerId();
    const allowClientCompareSnapshot =
      ctx.p2pModeRef.current === 'client' && ctx.p2pSessionUseCaseRef.current === 'compare';
    if (ctx.p2pModeRef.current !== 'host' && !allowClientCompareSnapshot) return;
    const transferMode: P2PTransferMode =
      options?.forceBundle || ctx.p2pTransferModeRef.current === 'bundle' ? 'bundle' : 'progressive';
    if (transferMode === 'bundle') {
      ctx.setP2PSyncStatusText('applying');
      void sendBundleSnapshotToPeer(gedcom, documents).finally(() => {
        window.setTimeout(() => ctx.setP2PSyncStatusText('done'), 300);
        window.setTimeout(() => ctx.setP2PSyncStatusText(null), 2500);
      });
      log(`${source}.bundle`, 'session', peerId || 'host');
      return;
    }
    const gedcomText = generateGedcom(gedcom);
    const transferId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const totalChunks = Math.ceil(gedcomText.length / SYNC_CHUNK_SIZE);
    ctx.setP2PSyncStatusText(`sending 0/${totalChunks}`);
    for (let index = 0; index < totalChunks; index += 1) {
      const start = index * SYNC_CHUNK_SIZE;
      const chunk = gedcomText.slice(start, start + SYNC_CHUNK_SIZE);
      window.setTimeout(() => {
        p2pService.sendMessage('SYNC_GEDCOM_CHUNK', {
          transferId,
          index,
          totalChunks,
          chunk,
          databaseName: ctx.databaseNameRef.current,
          sentAt: new Date().toISOString(),
        });
        const nextCount = index + 1;
        if (nextCount === 1 || nextCount === totalChunks || nextCount % 12 === 0) {
          ctx.setP2PSyncStatusText(`sending ${nextCount}/${totalChunks}`);
        }
        if (index + 1 === totalChunks) {
          window.setTimeout(() => ctx.setP2PSyncStatusText('waiting apply'), 250);
        }
      }, index * SYNC_CHUNK_SEND_DELAY_MS);
    }
    if (Object.keys(documents).length > 0) {
      const docsDelay = Math.max(500, totalChunks * SYNC_CHUNK_SEND_DELAY_MS + 650);
      if (ctx.snapshotDocumentsSendTimerRef.current !== null) {
        window.clearTimeout(ctx.snapshotDocumentsSendTimerRef.current);
      }
      ctx.snapshotDocumentsSendTimerRef.current = window.setTimeout(() => {
        void (async () => {
          const transferable = await toTransferableDocumentsForPeer(documents);
          sendDocumentsSnapshotInBatches(transferable);
        })();
        ctx.snapshotDocumentsSendTimerRef.current = null;
      }, docsDelay);
    }
    log(source, 'session', peerId || 'host');
  };

  const sendDocumentPatchToPeer = (patch: {
    operation: 'add' | 'update' | 'remove' | 'set_primary';
    individualId: string;
    doc?: IndividualDocument;
    docId?: string;
    patch?: Partial<IndividualDocument>;
  }) => {
    const peerId = ctx.getPeerId();
    const remoteAccessPolicy = ctx.getRemoteAccessPolicy();
    const allowDocuments =
      ctx.p2pModeRef.current === 'client'
        ? (remoteAccessPolicy?.allowDocuments ?? true)
        : ctx.visibilitySettingsRef.current.allowDocuments;
    if (!allowDocuments) return;
    const buildDocumentsSnapshotAfterPatch = (): Record<string, IndividualDocument[]> => {
      const snapshot = ctx.documentsRef.current;
      const current = snapshot[patch.individualId] || [];
      let next = current;
      if (patch.operation === 'add' && patch.doc) {
        const normalized =
          normalizeDocumentsByIndividual(
            { [patch.individualId]: [patch.doc] },
            ctx.gedcomDataRef.current?.individuals
          )[patch.individualId] || [];
        const incoming = normalized[0];
        if (incoming) {
          const deduped = current.filter((d) => d.id !== incoming.id);
          const shouldBecomePrimary =
            incoming.kind === 'photo' && !deduped.some((d) => d.kind === 'photo' && d.isPrimaryPhoto);
          next = [...deduped, shouldBecomePrimary ? { ...incoming, isPrimaryPhoto: true } : incoming];
        }
      } else if (patch.operation === 'update' && patch.docId) {
        next = current.map((doc) => {
          if (doc.id !== patch.docId) return doc;
          const nextUrl = typeof patch.patch?.url === 'string' ? patch.patch.url : doc.url;
          const nextKind: 'photo' | 'document' =
            patch.patch?.kind === 'photo' || patch.patch?.kind === 'document'
              ? patch.patch.kind
              : isImageLikeUrl(nextUrl) || doc.kind === 'photo'
                ? 'photo'
                : 'document';
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
          doc.kind === 'photo' || isImageLikeUrl(doc.url)
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
      if (ctx.p2pModeRef.current === 'client') {
        window.setTimeout(() => {
          sendDocumentsToPeer(buildDocumentsSnapshotAfterPatch(), patch.individualId, 'partial');
        }, 120);
      }
    }, 0);
    log('documents.patch.sent', 'individual', patch.individualId, peerId || 'peer');
  };

  const sendDocumentsSnapshotInBatches = (documents: Record<string, IndividualDocument[]>) => {
    const entries = Object.entries(documents);
    if (entries.length === 0) return;
    const stats = computeMediaStats(documents);
    const total = entries.length;
    entries.forEach(([individualId], index) => {
      window.setTimeout(() => {
        sendDocumentsToPeer(documents, individualId, 'partial', {
          batchIndex: index + 1,
          batchTotal: total,
          totalDocumentItems: stats.documentItems,
          totalPhotoItems: stats.photoItems,
        });
      }, index * 8);
    });
  };

  return {
    sendBundleSnapshotToPeer,
    sendP2PSnapshot,
    sendDocumentsToPeer,
    sendDocumentPatchToPeer,
    sendDocumentsSnapshotInBatches,
    computeMediaStats,
    toTransferableDocumentsForPeer,
  };
}

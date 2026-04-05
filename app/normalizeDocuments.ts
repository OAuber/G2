import type { Individual } from '../types';
import type { IndividualDocument } from './p2pAppTypes';
import { displayNameSlugForOnlineDocTitle, shouldReplaceOnlinePhotoTitle } from './onlineDocTitle';

export function isImageLikeUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('data:image/')) return true;
  if (url.startsWith('blob:')) return true;
  const u = url.trim();
  if (u.startsWith('http://') || u.startsWith('https://')) {
    if (/upload\.wikimedia\.org/i.test(u)) return true;
    if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(u)) return true;
  }
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(url);
}

export function normalizeDocumentsByIndividual(
  input: Record<string, unknown> | null | undefined,
  individuals?: Record<string, Individual> | null,
): Record<string, IndividualDocument[]> {
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
        const r = doc as Record<string, unknown>;
        const groupPhotoLinkId = typeof r.groupPhotoLinkId === 'string' ? r.groupPhotoLinkId : undefined;
        const groupPhotoOriginIndividualId =
          typeof r.groupPhotoOriginIndividualId === 'string' ? r.groupPhotoOriginIndividualId : undefined;
        const groupPhotoIsMirror = r.groupPhotoIsMirror === true;
        const groupPhotoParticipantIds = Array.isArray(r.groupPhotoParticipantIds)
          ? (r.groupPhotoParticipantIds as unknown[]).filter((x): x is string => typeof x === 'string')
          : undefined;
        const hiddenFromRibbonSlideshow =
          r.hiddenFromRibbonSlideshow === true
            ? true
            : r.hiddenFromRibbonSlideshow === false
              ? false
              : undefined;
        return {
          id: typeof doc.id === 'string' ? doc.id : `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          title,
          url,
          source,
          kind,
          date: typeof doc.date === 'string' ? doc.date : undefined,
          sourceAttribution,
          isPrimaryPhoto,
          ...(groupPhotoLinkId ? { groupPhotoLinkId } : {}),
          ...(groupPhotoOriginIndividualId ? { groupPhotoOriginIndividualId } : {}),
          ...(groupPhotoIsMirror ? { groupPhotoIsMirror: true } : {}),
          ...(groupPhotoParticipantIds && groupPhotoParticipantIds.length > 0
            ? { groupPhotoParticipantIds }
            : {}),
          ...(hiddenFromRibbonSlideshow === true || hiddenFromRibbonSlideshow === false
            ? { hiddenFromRibbonSlideshow }
            : {}),
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
}

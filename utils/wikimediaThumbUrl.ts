/**
 * Réécriture des URLs directes upload.wikimedia.org vers des vignettes /thumb/…/NNNpx-…
 * pour limiter bande passante, décodage CPU et allocation GPU (textures WebGL).
 *
 * Référence : structure des chemins fichiers sur les serveurs Wikimedia.
 * Ne pas appliquer aux SVG (souvent rendus en .png, suffixe non trivial).
 *
 * Important : beaucoup de largeurs arbitraires (ex. 384, 320, 220) provoquent HTTP 400
 * côté Varnish/thumbhandler. On ramène la demande au plus grand palier autorisé ≤ souhaité.
 */

const RASTER_PATH = /\.(jpe?g|png|gif|webp|bmp)(\?.*)?$/i;

/** Largeurs dont les vignettes répondent en pratique 200 sur upload.wikimedia.org (échantillons 2026). */
const THUMB_WIDTH_BUCKETS_DESC = [500, 330, 250, 120, 60, 40] as const;

function isRasterPathname(pathname: string): boolean {
  return RASTER_PATH.test(pathname);
}

/** Plus grand palier ≤ `desiredPx` ; sinon le plus petit palier (évite les URLs en 400). */
export function snapWikimediaThumbRequestWidth(desiredPx: number): number {
  const d = Math.max(1, Math.round(desiredPx));
  for (const b of THUMB_WIDTH_BUCKETS_DESC) {
    if (d >= b) return b;
  }
  return THUMB_WIDTH_BUCKETS_DESC[THUMB_WIDTH_BUCKETS_DESC.length - 1];
}

/**
 * @param url URL absolue (https://upload.wikimedia.org/…)
 * @param maxWidthPx largeur max souhaitée (sera mappée à un palier supporté, ex. 384 → 330)
 */
export function wikimediaUploadThumbUrl(url: string, maxWidthPx: number): string {
  if (!url || maxWidthPx < 1) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.hostname !== 'upload.wikimedia.org') return url;
  if (!isRasterPathname(parsed.pathname)) return url;

  const parts = parsed.pathname.split('/').filter(Boolean);
  // /wikipedia/commons/<h1>/<h2>/<file> ou /wikipedia/en/…
  if (parts[0] !== 'wikipedia' || parts.length < 5) return url;
  if (parts[2] === 'thumb') return url;

  const project = parts[1];
  const fileName = parts[parts.length - 1];
  const middle = parts.slice(2, -1);
  if (middle.length < 2) return url;

  const w = snapWikimediaThumbRequestWidth(maxWidthPx);
  const thumbSeg = `${w}px-${fileName}`;
  const newPath = ['', 'wikipedia', project, 'thumb', ...middle, fileName, thumbSeg].join('/');
  return `${parsed.origin}${newPath}${parsed.search}${parsed.hash}`;
}

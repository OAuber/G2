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

import { Individual } from '../types';

function normalizeWord(s?: string): string {
  return (s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Score 0–1 pour rapprocher deux fiches (hors identifiant GEDCOM). */
export function scoreIndividualPair(a: Individual, b: Individual): number {
  let score = 0;
  const ag = normalizeWord(a.givenName);
  const as = normalizeWord(a.surname);
  const bg = normalizeWord(b.givenName);
  const bs = normalizeWord(b.surname);
  if (ag && bg && ag === bg) score += 0.35;
  if (as && bs && as === bs) score += 0.35;
  const aby = a.birthDate?.year;
  const bby = b.birthDate?.year;
  if (aby != null && bby != null && aby === bby) score += 0.2;
  const ady = a.deathDate?.year;
  const bdy = b.deathDate?.year;
  if (ady != null && bdy != null && ady === bdy) score += 0.05;
  if (a.gender && b.gender && a.gender === b.gender) score += 0.05;
  return Math.min(score, 1);
}

export function rankPeerMatchesForIndividual(
  source: Individual,
  candidates: Individual[],
  opts?: { minScore?: number; limit?: number },
): { individual: Individual; score: number }[] {
  const minScore = opts?.minScore ?? 0.35;
  const limit = opts?.limit ?? 8;
  return candidates
    .map((individual) => ({ individual, score: scoreIndividualPair(source, individual) }))
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

import { Gender, Individual } from '../types';

function normalizeWord(s?: string): string {
  return (s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** GIVN/SURN absents mais NAME « Prénom /Nom/ » (GEDCOM). */
function parseNameLine(name?: string): { given: string; surname: string } {
  const raw = (name || '').trim();
  if (!raw) return { given: '', surname: '' };
  const m = raw.match(/^(.+?)\s*\/\s*([^/]*)\s*\/\s*$/);
  if (m) {
    return { given: (m[1] || '').trim(), surname: (m[2] || '').trim() };
  }
  return { given: raw, surname: '' };
}

function effectiveGiven(ind: Individual): string {
  const g = ind.givenName?.trim();
  if (g) return g;
  return parseNameLine(ind.name).given;
}

function effectiveSurname(ind: Individual): string {
  const s = ind.surname?.trim();
  if (s) return s;
  return parseNameLine(ind.name).surname;
}

/**
 * Prénom comparable entre bases : virgules / points-virgules → espaces
 * (ex. « Virginie, Héloise » vs « Virginie Héloïse »).
 */
function normalizeGivenForMatch(givenName?: string): string {
  const t = (givenName || '')
    .replace(/[,;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalizeWord(t);
}

/** Premier prénom (token), pour tolérer « Jean » vs « Jean-Baptiste » / « Jean Paul ». */
function firstGivenTokenFromRaw(rawGiven?: string): string {
  const n = normalizeGivenForMatch(rawGiven);
  if (!n) return '';
  const parts = n.split(/[\s\-'’\u2010\u2011\u2012\u2013\u2014]+/).filter(Boolean);
  return parts[0] ?? '';
}

function genderConflict(a: Individual, b: Individual): boolean {
  const ga = a.gender;
  const gb = b.gender;
  if (ga == null || gb == null) return false;
  if (ga === Gender.Unknown || gb === Gender.Unknown) return false;
  return ga !== gb;
}

/** 0–1 : prénom (exact > premier token > rien). */
function scoreGiven(a: Individual, b: Individual): number {
  const ag = normalizeGivenForMatch(effectiveGiven(a));
  const bg = normalizeGivenForMatch(effectiveGiven(b));
  if (!ag || !bg) return 0;
  if (ag === bg) return 1;
  const t1 = firstGivenTokenFromRaw(effectiveGiven(a));
  const t2 = firstGivenTokenFromRaw(effectiveGiven(b));
  if (t1 && t2 && t1 === t2) return 0.5;
  return 0;
}

/** 0–1 : nom strict (égalité normalisée uniquement). */
function scoreSurname(a: Individual, b: Individual): number {
  const as = normalizeWord(effectiveSurname(a));
  const bs = normalizeWord(effectiveSurname(b));
  if (!as || !bs) return 0;
  return as === bs ? 1 : 0;
}

function birthPlaceLikelySame(a: Individual, b: Individual): boolean {
  const pa = normalizeWord(a.birthPlace);
  const pb = normalizeWord(b.birthPlace);
  return !!pa && pa.length > 3 && pa === pb;
}

/**
 * 0–1 : année de naissance — resserré (écart > 2 ans → 0 sauf même lieu de naissance).
 * Si une seule année connue : signal faible (évite pistes « nom seul » trop hautes).
 */
function scoreBirthYear(a: Individual, b: Individual): { score: number; bothPresent: boolean } {
  const aby = a.birthDate?.year;
  const bby = b.birthDate?.year;
  if (aby != null && bby != null) {
    const d = Math.abs(aby - bby);
    if (d === 0) return { score: 1, bothPresent: true };
    if (d === 1) return { score: 0.35, bothPresent: true };
    if (d === 2) return { score: 0.12, bothPresent: true };
    if (d > 2 && birthPlaceLikelySame(a, b)) {
      return { score: 0.22, bothPresent: true };
    }
    return { score: 0, bothPresent: true };
  }
  return { score: 0.15, bothPresent: false };
}

function scoreDeathYearBonus(a: Individual, b: Individual): number {
  const ady = a.deathDate?.year;
  const bdy = b.deathDate?.year;
  if (ady == null || bdy == null) return 0;
  if (ady === bdy) return 0.04;
  const d = Math.abs(ady - bdy);
  if (d === 1) return 0.02;
  return 0;
}

/**
 * Score 0–1 pour rapprocher deux fiches (hors identifiant GEDCOM).
 * Sexe incompatible → 0 ; patronyme strict ; prénom entier ou premier token (token seul = signal faible si patronymes différents) ;
 * naissance : même année ou écart ≤ 2 ans avec forte décote.
 */
export function scoreIndividualPair(a: Individual, b: Individual): number {
  if (genderConflict(a, b)) return 0;

  const abyEarly = a.birthDate?.year;
  const bbyEarly = b.birthDate?.year;
  /**
   * Écart d’années > 2 : exclusion, sauf même lieu de naissance avec écart « plausible » (relevés divergents).
   * Ne pas utiliser le lieu pour sauver un écart de générations (ex. 1924 vs 2014 au Havre = homonymes).
   */
  if (abyEarly != null && bbyEarly != null) {
    const yd = Math.abs(abyEarly - bbyEarly);
    if (yd > 2) {
      const place = birthPlaceLikelySame(a, b);
      if (!place || yd > 35) {
        return 0;
      }
    }
  }

  const givenS = scoreGiven(a, b);
  const surS = scoreSurname(a, b);
  const { score: birthS, bothPresent: birthBothPresent } = scoreBirthYear(a, b);
  const deathBonus = scoreDeathYearBonus(a, b);

  // Pondération : patronyme + naissance portent l’identité ; prénom affiné.
  let score = 0.22 * givenS + 0.34 * surS + 0.42 * birthS + deathBonus;

  // Sans patronyme commun : ne pas traiter « premier token » (ex. Marie vs Marie-Laure) comme un prénom « fort ».
  // Seul le prénom entier normalisé (givenS === 1) mérite un léger rabattement avec même année de naissance.
  if (surS < 1) {
    if (birthS >= 1 && givenS >= 1) {
      score *= 0.55;
    } else if (birthS >= 1 && givenS >= 0.5) {
      score *= 0.28;
    } else {
      score *= 0.18;
    }
  }

  // Sans les deux années de naissance, plafonner (homonymes risqués).
  if (!birthBothPresent) {
    score = Math.min(score, 0.48);
  }

  // Nom de famille différent et naissance faible → quasi pas de piste.
  if (surS < 1 && birthS < 0.35) {
    score *= 0.15;
  }

  /** Même patronyme mais prénoms sans lien + générations différentes (ex. cousin / homonyme). */
  if (
    surS >= 1 &&
    givenS === 0 &&
    abyEarly != null &&
    bbyEarly != null &&
    Math.abs(abyEarly - bbyEarly) > 25
  ) {
    return 0;
  }

  /**
   * Même patronyme, prénoms sans lien, et au moins une naissance sans année : ne pas proposer une « piste »
   * sur le seul nom (ex. Auber + données incomplètes vs autre Auber).
   */
  if (surS >= 1 && givenS === 0 && !birthBothPresent) {
    return 0;
  }

  return Math.min(score, 1);
}

export function rankPeerMatchesForIndividual(
  source: Individual,
  candidates: Individual[],
  opts?: { minScore?: number; limit?: number },
): { individual: Individual; score: number }[] {
  const minScore = opts?.minScore ?? 0.48;
  const limit = opts?.limit ?? 8;
  const sy = source.birthDate?.year ?? null;
  return candidates
    .map((individual) => ({ individual, score: scoreIndividualPair(source, individual) }))
    .filter((x) => x.score >= minScore)
    .sort((a, b) => {
      if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
      const ay = a.individual.birthDate?.year;
      const by = b.individual.birthDate?.year;
      if (sy != null && ay != null && by != null) {
        return Math.abs(ay - sy) - Math.abs(by - sy);
      }
      return 0;
    })
    .slice(0, limit);
}

import { DateInfo, GedcomData, Gender, Individual } from '../types';

/** Seuil : au-dessus, on applique l’ajustement parents/enfants (mémo § 3.3). */
const LINEAGE_BASE_THRESHOLD = 0.25;
/** Bonus / malus parents+enfants, borné (mémo : ex. ±0,08–0,15 ; choix : ±0,08). */
const LINEAGE_DELTA_CAP = 0.08;

export function getParentsFromGedcom(ind: Individual, data: GedcomData): Individual[] {
  if (!ind.familyChildId) return [];
  const fam = data.families[ind.familyChildId];
  if (!fam) return [];
  const out: Individual[] = [];
  if (fam.husbandId) {
    const h = data.individuals[fam.husbandId];
    if (h) out.push(h);
  }
  if (fam.wifeId) {
    const w = data.individuals[fam.wifeId];
    if (w) out.push(w);
  }
  return out;
}

export function getChildrenFromGedcom(ind: Individual, data: GedcomData): Individual[] {
  const ids = new Set<string>();
  for (const fid of ind.familySpouseIds ?? []) {
    const fam = data.families[fid];
    if (!fam) continue;
    for (const cid of fam.childrenIds) {
      if (data.individuals[cid]) ids.add(cid);
    }
  }
  return [...ids].map((id) => data.individuals[id]);
}

/**
 * Ajustement borné à partir des parents et enfants dans chaque graphe.
 * Choix : malus si les deux côtés ont des parents (ou des enfants) mais aucune paire ne ressemble ;
 * bonus si au moins une paire parent ou enfant dépasse un seuil fort.
 */
function computeLineageDelta(a: Individual, b: Individual, gedcomA: GedcomData, gedcomB: GedcomData): number {
  let d = 0;
  const pa = getParentsFromGedcom(a, gedcomA);
  const pb = getParentsFromGedcom(b, gedcomB);
  if (pa.length > 0 && pb.length > 0) {
    let maxP = 0;
    for (const x of pa) {
      for (const y of pb) {
        maxP = Math.max(maxP, scoreIndividualPair(x, y));
      }
    }
    if (maxP < 0.35) d -= 0.05;
    else if (maxP >= 0.55) d += 0.04;
  }
  const ca = getChildrenFromGedcom(a, gedcomA);
  const cb = getChildrenFromGedcom(b, gedcomB);
  if (ca.length > 0 && cb.length > 0) {
    let maxC = 0;
    for (const x of ca) {
      for (const y of cb) {
        maxC = Math.max(maxC, scoreIndividualPair(x, y));
      }
    }
    if (maxC < 0.22) d -= 0.04;
    else if (maxC >= 0.5) d += 0.04;
  }
  return Math.max(-LINEAGE_DELTA_CAP, Math.min(LINEAGE_DELTA_CAP, d));
}

/**
 * Score direct + ajustement familial (parents/enfants) si les deux graphes sont fournis.
 * Les familles recomposées : on se limite aux liens GEDCOM (familyChildId / familySpouseIds) sans traitement spécial (mémo).
 */
export function scoreIndividualPairWithLineage(
  a: Individual,
  b: Individual,
  opts?: { gedcomA: GedcomData; gedcomB: GedcomData },
): number {
  const base = scoreIndividualPair(a, b);
  if (base < LINEAGE_BASE_THRESHOLD || !opts) return base;
  const delta = computeLineageDelta(a, b, opts.gedcomA, opts.gedcomB);
  return Math.min(1, Math.max(0, base + delta));
}

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

/** Égalité stricte après normalisation (identique à l’ancien comportement). */
function birthPlaceExactNormalized(a: Individual, b: Individual): boolean {
  const pa = normalizeWord(a.birthPlace);
  const pb = normalizeWord(b.birthPlace);
  return !!pa && pa.length > 3 && pa === pb;
}

/**
 * Même lieu de naissance « en pratique » : formats GEDCOM différents (code postal, région, ponctuation),
 * ou même commune en 1re partie avant virgule (ex. St-Eustache-la-Forêt vs … 76576 … Normandie).
 */
export function birthPlacesLooselyCompatible(a: Individual, b: Individual): boolean {
  if (birthPlaceExactNormalized(a, b)) return true;
  const pa = a.birthPlace?.trim();
  const pb = b.birthPlace?.trim();
  if (!pa || !pb) return false;
  const strip = (s: string) =>
    normalizeWord(
      s
        .replace(/\b\d{4,5}\b/g, ' ')
        .replace(/[,;]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    );
  const ca = strip(pa);
  const cb = strip(pb);
  if (ca.length < 6 || cb.length < 6) return false;
  if (ca === cb) return true;
  if (ca.includes(cb) || cb.includes(ca)) return true;
  const firstA = normalizeWord(pa.split(',')[0] || '');
  const firstB = normalizeWord(pb.split(',')[0] || '');
  if (firstA.length >= 6 && firstB.length >= 6) {
    if (firstA === firstB) return true;
    if (firstA.includes(firstB) || firstB.includes(firstA)) return true;
  }
  return false;
}

/**
 * Une seule naissance avec lieu : écart modéré toléré si patronyme + prénom (token) cohérents
 * (relevés complétés différemment d’un côté).
 */
function yearGapRescueOnePlaceMissing(
  a: Individual,
  b: Individual,
  yearDiff: number,
  givenS: number,
  surS: number,
): boolean {
  if (yearDiff > 12) return false;
  if (surS < 1 || givenS < 0.5) return false;
  const ha = !!a.birthPlace?.trim();
  const hb = !!b.birthPlace?.trim();
  return ha !== hb;
}

/** Année issue de la normalisation locale, ou qualificatif GEDCOM (ABT/EST/…) après import fil — pas une date « relevé ». */
export function birthYearIsUncertain(d?: DateInfo): boolean {
  if (!d) return false;
  if (d.isCalculated === true) return true;
  const raw = (d.raw || '').trim();
  return /^(ABT|EST|CAL|BEF|AFT|INT|VERS|ENV|CA|CIRCA)\b/i.test(raw);
}

/**
 * 0–1 : année de naissance — resserré (écart > 2 ans → 0 sauf même lieu de naissance).
 * Si une seule année connue : signal faible (évite pistes « nom seul » trop hautes).
 */
function scoreBirthYear(a: Individual, b: Individual): { score: number; bothPresent: boolean } {
  const aby = a.birthDate?.year;
  const bby = b.birthDate?.year;
  const eitherUncertain = birthYearIsUncertain(a.birthDate) || birthYearIsUncertain(b.birthDate);
  if (aby != null && bby != null) {
    const d = Math.abs(aby - bby);
    if (d === 0) return { score: 1, bothPresent: true };
    if (d === 1) return { score: eitherUncertain ? 0.4 : 0.35, bothPresent: true };
    if (d === 2) return { score: eitherUncertain ? 0.18 : 0.12, bothPresent: true };
    if (d > 2) {
      if (birthPlacesLooselyCompatible(a, b)) {
        return { score: 0.22, bothPresent: true };
      }
      if (
        d <= 12 &&
        scoreSurname(a, b) >= 1 &&
        scoreGiven(a, b) >= 0.5 &&
        !!a.birthPlace?.trim() !== !!b.birthPlace?.trim()
      ) {
        return { score: 0.2, bothPresent: true };
      }
      if (
        eitherUncertain &&
        d <= 15 &&
        scoreSurname(a, b) >= 1 &&
        scoreGiven(a, b) >= 0.5
      ) {
        return { score: 0.26, bothPresent: true };
      }
      return { score: 0, bothPresent: true };
    }
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

  const givenS = scoreGiven(a, b);
  const surS = scoreSurname(a, b);
  const abyEarly = a.birthDate?.year;
  const bbyEarly = b.birthDate?.year;
  /**
   * Écart d’années > 2 : exclusion, sauf lieu compatible (formats divergents) ou secours « un lieu manquant »
   * (relevés complétés différemment). Au-delà de 35 ans : homonymes probables, pas de secours par le lieu.
   */
  if (abyEarly != null && bbyEarly != null) {
    const yd = Math.abs(abyEarly - bbyEarly);
    if (yd > 2) {
      if (yd > 35) return 0;
      const eitherUncertain = birthYearIsUncertain(a.birthDate) || birthYearIsUncertain(b.birthDate);
      if (eitherUncertain) {
        if (surS < 1 || givenS < 0.5) return 0;
      } else {
        const placeOk = birthPlacesLooselyCompatible(a, b);
        const rescue = yearGapRescueOnePlaceMissing(a, b, yd, givenS, surS);
        if (!placeOk && !rescue) return 0;
      }
    }
  }
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
  opts?: {
    minScore?: number;
    limit?: number;
    /** Si fourni : score avec bonus/malus parents-enfants (graphe source vs graphe candidat). */
    lineage?: { gedcomSource: GedcomData; gedcomCandidate: GedcomData };
  },
): { individual: Individual; score: number }[] {
  const minScore = opts?.minScore ?? 0.48;
  const limit = opts?.limit ?? 8;
  const sy = source.birthDate?.year ?? null;
  const scoreFn = (a: Individual, b: Individual) =>
    opts?.lineage
      ? scoreIndividualPairWithLineage(a, b, { gedcomA: opts.lineage.gedcomSource, gedcomB: opts.lineage.gedcomCandidate })
      : scoreIndividualPair(a, b);
  return candidates
    .map((individual) => ({ individual, score: scoreFn(source, individual) }))
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

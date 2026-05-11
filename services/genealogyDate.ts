import type { DateInfo } from '../types';

/** Mois GEDCOM 3 lettres (aligné sur `parseDate` dans gedcomParser). */
export const GEDCOM_MONTHS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Décompose une chaîne saisie / stockée (GEDCOM, année seule, ISO yyyy ou yyyy-mm-dd).
 */
export function parseDateParts(dateStr: string): {
  year: number | null;
  month: number | null;
  day: number | null;
} {
  const clean = dateStr.trim();
  if (!clean) return { year: null, month: null, day: null };

  const isoFull = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoFull) {
    const y = parseInt(isoFull[1], 10);
    const m = parseInt(isoFull[2], 10);
    const d = parseInt(isoFull[3], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31)
      return { year: y, month: m, day: d };
  }

  const isoYm = clean.match(/^(\d{4})-(\d{2})$/);
  if (isoYm) {
    const y = parseInt(isoYm[1], 10);
    const m = parseInt(isoYm[2], 10);
    if (m >= 1 && m <= 12) return { year: y, month: m, day: null };
  }

  const months: Record<string, number> = {
    JAN: 1,
    FEB: 2,
    MAR: 3,
    APR: 4,
    MAY: 5,
    JUN: 6,
    JUL: 7,
    AUG: 8,
    SEP: 9,
    OCT: 10,
    NOV: 11,
    DEC: 12,
    FEV: 2,
    FÉV: 2,
    AVR: 4,
    MAI: 5,
    AOU: 8,
    AOÛ: 8,
    DÉC: 12,
  };

  const dayMonthYear = clean.match(/(\d{1,2})\s+([A-ZÀ-ÿ.]{3,})\s+(\d{3,4})/i);
  if (dayMonthYear) {
    let mStr = dayMonthYear[2].toUpperCase().substring(0, 3);
    const fullM = dayMonthYear[2].toUpperCase();
    if (fullM.startsWith('JUIL')) mStr = 'JUL';
    else if (fullM.startsWith('JUIN')) mStr = 'JUN';
    const mo = months[mStr];
    if (mo !== undefined) {
      return {
        year: parseInt(dayMonthYear[3], 10),
        month: mo,
        day: parseInt(dayMonthYear[1], 10),
      };
    }
  }

  const monthYear = clean.match(/([A-ZÀ-ÿ.]{3,})\s+(\d{3,4})/i);
  if (monthYear) {
    let mStr = monthYear[1].toUpperCase().substring(0, 3);
    const fullM = monthYear[1].toUpperCase();
    if (fullM.startsWith('JUIL')) mStr = 'JUL';
    else if (fullM.startsWith('JUIN')) mStr = 'JUN';
    const mo = months[mStr];
    if (mo !== undefined) {
      return { year: parseInt(monthYear[2], 10), month: mo, day: null };
    }
  }

  const yOnly = clean.match(/^(\d{3,4})$/);
  if (yOnly) {
    const y = parseInt(yOnly[1], 10);
    return Number.isFinite(y) ? { year: y, month: null, day: null } : { year: null, month: null, day: null };
  }

  const yInNoise = clean.match(/(\d{3,4})/);
  if (yInNoise) {
    const y = parseInt(yInNoise[1], 10);
    return Number.isFinite(y) ? { year: y, month: null, day: null } : { year: null, month: null, day: null };
  }

  return { year: null, month: null, day: null };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Chaîne GEDCOM courte lisible par `parseDate` (fiches individu / famille). */
export function partsToGedcomString(parts: {
  year: number | null;
  month: number | null;
  day: number | null;
}): string {
  const { year, month, day } = parts;
  if (year == null || !Number.isFinite(year)) return '';
  if (!month || month < 1 || month > 12) return String(year);
  const mon = GEDCOM_MONTHS[month - 1];
  if (!day || day < 1) return `${mon} ${year}`;
  const dim = daysInMonth(year, month);
  const d = Math.min(day, dim);
  return `${d} ${mon} ${year}`;
}

/** Stockage document : année seule, ou yyyy-mm, ou yyyy-mm-dd. */
export function partsToDocDateString(parts: {
  year: number | null;
  month: number | null;
  day: number | null;
}): string {
  const { year, month, day } = parts;
  if (year == null || !Number.isFinite(year)) return '';
  if (!month || month < 1 || month > 12) return String(year);
  if (!day || day < 1) return `${year}-${pad2(month)}`;
  const dim = daysInMonth(year, month);
  const d = Math.min(day, dim);
  return `${year}-${pad2(month)}-${pad2(d)}`;
}

/** Valeur initiale du champ à partir d’un `DateInfo` (préfère `raw` si exploitable). */
export function dateInfoToFormString(info?: DateInfo | null): string {
  if (!info) return '';
  const raw = info.raw?.trim();
  if (raw) {
    const p = parseDateParts(raw);
    if (p.year != null) return raw;
  }
  if (info.year != null && Number.isFinite(info.year)) return String(info.year);
  return '';
}

/** Affichage lisible (fiche lecture). */
export function formatDateInfoDisplay(info?: DateInfo | null, lang: 'fr' | 'en' = 'fr'): string {
  if (!info) return '';
  const raw = info.raw?.trim();
  if (raw) {
    const p = parseDateParts(raw);
    if (p.year != null && (p.month != null || p.day != null))
      return formatPartsForLocale(p, lang);
    if (p.year != null) return String(p.year);
  }
  if (info.year != null) {
    if (info.preciseDate != null && info.preciseDate !== info.year) {
      const approx = approximateYmdFromPrecise(info.year, info.preciseDate);
      if (approx.month) return formatPartsForLocale(approx, lang);
    }
    return String(info.year);
  }
  return '';
}

function approximateYmdFromPrecise(
  year: number,
  precise: number,
): { year: number; month: number | null; day: number | null } {
  const frac = precise - year;
  if (frac <= 1e-6) return { year, month: null, day: null };
  const dayOfYear = frac * 365.25;
  const d = new Date(year, 0, 1);
  d.setDate(d.getDate() + Math.round(dayOfYear) - 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

function formatPartsForLocale(
  parts: { year: number | null; month: number | null; day: number | null },
  lang: 'fr' | 'en',
): string {
  if (parts.year == null) return '';
  if (!parts.month) return String(parts.year);
  const loc = lang === 'fr' ? 'fr-FR' : 'en-GB';
  const d = new Date(parts.year, parts.month - 1, parts.day ?? 1);
  if (parts.day != null && parts.day >= 1) {
    return d.toLocaleDateString(loc, { day: 'numeric', month: 'long', year: 'numeric' });
  }
  return d.toLocaleDateString(loc, { month: 'long', year: 'numeric' });
}

import { GedcomData, Individual, Family, Gender, DateInfo } from '../types';

const decodeLegacyNameMojibake = (value: string): string => {
  // Some GED files carry ANSEL-like accent markers that appear as mojibake
  // (e.g., "Jâerâemy" instead of "Jérémy"). Normalize the most common cases.
  const acuteMap: Record<string, string> = {
    a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý',
    A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', Y: 'Ý',
  };
  const graveMap: Record<string, string> = {
    a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù', y: 'ỳ',
    A: 'À', E: 'È', I: 'Ì', O: 'Ò', U: 'Ù', Y: 'Ỳ',
  };

  return value
    // "âe" => "é", "Dâesirâe" => "Désiré", etc.
    .replace(/â([aeiouyAEIOUY])/g, (_m, v: string) => acuteMap[v] ?? v)
    // "áe" => "è" in many imported records.
    .replace(/á([aeiouyAEIOUY])/g, (_m, v: string) => graveMap[v] ?? v)
    // Observed legacy single-char substitutions in names.
    .replace(/•/g, 'ï')
    .replace(/‘/g, 'ë');
};

/**
 * Parses a GEDCOM date string into structured data.
 * Returns year (integer) and preciseDate (float).
 */
export const parseDate = (dateStr: string): DateInfo => {
  // 1. Clean up: Remove extra spaces
  let cleanStr = dateStr.trim();
  
  // 2. Remove common GEDCOM modifiers/prefixes to help parsing
  // Handles: ABT 1980, EST 1980, VERS 1980, CAL, BEF, AFT, INT, BET, FROM, TO, ENV, CA...
  cleanStr = cleanStr.replace(/^(ABT|EST|CAL|BEF|AFT|INT|BET|FROM|TO|VERS|ENV|CA|CIRCA)\.?\s+/i, '');

  // Maps standard GEDCOM months to index (0-11)
  const months: Record<string, number> = {
    // English Standard
    'JAN': 0, 'FEB': 1, 'MAR': 2, 'APR': 3, 'MAY': 4, 'JUN': 5,
    'JUL': 6, 'AUG': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DEC': 11,
    // Common French Variants (some overlap)
    'FEV': 1, 'FÉV': 1, 'AVR': 3, 'MAI': 4, 
    'AOU': 7, 'AOÛ': 7, 'DÉC': 11
  };

  let year: number | null = null;
  let preciseDate: number | undefined = undefined;

  // Strategy: Try specific formats first. 
  // We removed strict anchors (^ and $) to allow matching dates even if surrounded by noise.

  // 1. "15 APR 1980" (DD MMM YYYY)
  const dayMonthYear = cleanStr.match(/(\d{1,2})\s+([A-ZÀ-ÿ.]{3,})\s+(\d{3,4})/i);
  if (dayMonthYear) {
    const fullMonth = dayMonthYear[2].toUpperCase();
    let mStr = fullMonth.substring(0, 3);
    
    // Disambiguation for French JUIN/JUILLET (both start with JUI)
    if (fullMonth.startsWith('JUIL')) mStr = 'JUL';
    else if (fullMonth.startsWith('JUIN')) mStr = 'JUN';

    if (months[mStr] !== undefined) {
      const d = parseInt(dayMonthYear[1], 10);
      const y = parseInt(dayMonthYear[3], 10);
      year = y;
      // Approximation: Year + (Month * 30.4 + Day) / 365.25
      const dayOfYear = (months[mStr] * 30.44) + d;
      preciseDate = y + (dayOfYear / 365.25);
      return { raw: dateStr, year, preciseDate };
    }
  }

  // 2. "APR 1980" (MMM YYYY)
  const monthYear = cleanStr.match(/([A-ZÀ-ÿ.]{3,})\s+(\d{3,4})/i);
  if (monthYear) {
    const fullMonth = monthYear[1].toUpperCase();
    let mStr = fullMonth.substring(0, 3);

    // Disambiguation for French
    if (fullMonth.startsWith('JUIL')) mStr = 'JUL';
    else if (fullMonth.startsWith('JUIN')) mStr = 'JUN';

    if (months[mStr] !== undefined) {
      const y = parseInt(monthYear[2], 10);
      year = y;
      // Middle of the month approximation
      const dayOfYear = (months[mStr] * 30.44) + 15;
      preciseDate = y + (dayOfYear / 365.25);
      return { raw: dateStr, year, preciseDate };
    }
  }

  // 3. Fallback: "1980", "EST 1980", "ABT 1850" -> Find first sequence of 3-4 digits
  const yearMatch = cleanStr.match(/(\d{3,4})/);
  if (yearMatch) {
    year = parseInt(yearMatch[0], 10);
    preciseDate = year;
    return { raw: dateStr, year, preciseDate };
  }

  return {
    raw: dateStr, // Keep original string with ABT/etc for display
    year: null,
    preciseDate: undefined
  };
};

/**
 * A simplified GEDCOM parser.
 * It reads line by line and builds the object graph.
 */
export const parseGedcom = (content: string): GedcomData => {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  const individuals: Record<string, Individual> = {};
  const families: Record<string, Family> = {};

  let currentIndi: Partial<Individual> | null = null;
  let currentFam: Partial<Family> | null = null;
  let currentContext: 'INDI' | 'FAM' | 'NONE' = 'NONE';
  
  // Track the current event context (e.g., 'BIRT', 'DEAT', 'MARR') to correctly assign nested dates
  let currentEvent: 'BIRT' | 'DEAT' | 'MARR' | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // GEDCOM line format: Level [Optional XREF_ID] Tag [Line_Value]
    // Tag: \S+ (pas seulement \w) — balises perso avec tirets, etc.
    const match = trimmed.match(/^(\d+)\s+(@[^@]+@)?\s*(\S+)\s*(.*)$/);

    if (!match) continue;

    const level = parseInt(match[1], 10);
    const xrefId = match[2]; // e.g., @I1@
    const tag = match[3];
    const tagU = tag.toUpperCase();
    const value = match[4] || '';

    if (level === 0) {
      // New Record - Reset Contexts
      currentEvent = null;
      
      if (xrefId && tagU === 'INDI') {
        currentContext = 'INDI';
        currentIndi = {
          id: xrefId,
          name: 'Unknown',
          surname: '',
          givenName: '',
          gender: Gender.Unknown,
          familySpouseIds: [],
          generation: 0, // Default
          source: 'imported'
        };
        individuals[xrefId] = currentIndi as Individual;
        currentFam = null;
      } else if (xrefId && tagU === 'FAM') {
        currentContext = 'FAM';
        currentFam = {
          id: xrefId,
          childrenIds: []
        };
        families[xrefId] = currentFam as Family;
        currentIndi = null;
      } else {
        currentContext = 'NONE';
        currentIndi = null;
        currentFam = null;
      }
    } else if (currentContext === 'INDI' && currentIndi) {
      if (level === 1) {
        // Level 1 properties. Reset event context unless we are starting a new one.
        currentEvent = null;

        switch (tagU) {
          case 'NAME': {
            const decodedNameValue = decodeLegacyNameMojibake(value);
            currentIndi.name = decodedNameValue.replace(/\//g, '');
            const parts = decodedNameValue.split('/');
            if (parts.length > 0) currentIndi.givenName = parts[0].trim();
            if (parts.length > 1) currentIndi.surname = parts[1].trim();
            break;
          }
          case 'SEX':
            currentIndi.gender = value === 'M' ? Gender.Male : value === 'F' ? Gender.Female : Gender.Unknown;
            break;
          case 'BIRT':
          case 'DEAT':
            currentEvent = tagU as 'BIRT' | 'DEAT';
            break;
          case 'FAMC': // Child of family
            currentIndi.familyChildId = value;
            break;
          case 'FAMS': // Spouse in family
            currentIndi.familySpouseIds?.push(value);
            break;
          case 'NOTE':
            currentIndi.notes = currentIndi.notes
              ? `${currentIndi.notes}\n${value}`.trim()
              : value.trim();
            break;
        }
      } else if (level === 2) {
        // Level 2 properties (mostly nested under events)
        if (tagU === 'DATE' && currentEvent) {
          const dateInfo = parseDate(value);
          if (currentEvent === 'BIRT') currentIndi.birthDate = dateInfo;
          if (currentEvent === 'DEAT') currentIndi.deathDate = dateInfo;
        } else if (tagU === 'PLAC' && currentEvent) {
          if (currentEvent === 'BIRT') currentIndi.birthPlace = value.trim();
          if (currentEvent === 'DEAT') currentIndi.deathPlace = value.trim();
        } else if (tagU === 'NOTE') {
          currentIndi.notes = currentIndi.notes
            ? `${currentIndi.notes}\n${value}`.trim()
            : value.trim();
        }
      }

    } else if (currentContext === 'FAM' && currentFam) {
      if (level === 1) {
        // Reset event context at level 1 change
        currentEvent = null; 
        
        switch (tagU) {
          case 'HUSB':
            currentFam.husbandId = value;
            break;
          case 'WIFE':
            currentFam.wifeId = value;
            break;
          case 'CHIL':
            currentFam.childrenIds?.push(value);
            break;
          case 'MARR':
            currentEvent = 'MARR';
            break;
        }
      } else if (level === 2) {
         if (tagU === 'DATE' && currentEvent === 'MARR') {
            currentFam.marriageDate = parseDate(value);
         }
      }
    }
  }

  // --- Post-Processing: Calculate Generations ---
  const queue: string[] = [];
  
  // 1. Identify Roots
  Object.values(individuals).forEach(indi => {
    if (!indi.familyChildId || !families[indi.familyChildId]) {
      indi.generation = 0;
      queue.push(indi.id);
    }
  });

  // 2. BFS Traversal
  const visited = new Set<string>(queue);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const currentIndi = individuals[currentId];
    const currentGen = currentIndi.generation || 0;

    if (currentIndi.familySpouseIds) {
      for (const famId of currentIndi.familySpouseIds) {
        const family = families[famId];
        if (family && family.childrenIds) {
          for (const childId of family.childrenIds) {
            if (individuals[childId]) {
               const existingGen = individuals[childId].generation || 0;
               if (!visited.has(childId) || (currentGen + 1) > existingGen) {
                 individuals[childId].generation = currentGen + 1;
                 if (!visited.has(childId)) {
                   visited.add(childId);
                   queue.push(childId);
                 }
               }
            }
          }
        }
      }
    }
  }

  return { individuals, families };
};

/**
 * Statistiques sur les en-têtes `0 @xref@ INDI` (comptage brut, xrefs uniques, doublons).
 * Utile pour diagnostiquer un écart entre le nombre de lignes INDI et le nombre de fiches chargées :
 * chaque @xref@ ne peut exister qu'une fois — les doublons sont écrasés lors du parse.
 */
export function analyzeGedcomIndiHeaders(gedcom: string): {
  headerLineCount: number;
  uniqueIndiIds: number;
  duplicateHeaderLines: number;
  duplicateIdsSample: string[];
} {
  const text = gedcom.replace(/^\uFEFF/, '');
  const indiHeaderRe = new RegExp('^0\\s+(@[^@]+@)\\s+INDI\\s*$', 'gim');
  const matches = [...text.matchAll(indiHeaderRe)];
  const ids = matches.map((m) => m[1]);
  const freq = new Map<string, number>();
  for (const id of ids) {
    freq.set(id, (freq.get(id) || 0) + 1);
  }
  const duplicateIdsSample = [...freq.entries()]
    .filter(([, n]) => n > 1)
    .map(([id]) => id)
    .slice(0, 40);
  return {
    headerLineCount: ids.length,
    uniqueIndiIds: freq.size,
    duplicateHeaderLines: ids.length - freq.size,
    duplicateIdsSample,
  };
}

/** En dev (Vite), journalise l’écart lignes INDI / xrefs uniques / fiches parsées. */
export function logGedcomImportDiagnostics(
  sourceLabel: string,
  gedcom: string,
  parsedIndividualCount: number,
): void {
  if (!import.meta.env.DEV || !gedcom) return;
  const stats = analyzeGedcomIndiHeaders(gedcom);
  console.info(`[G2][${sourceLabel}]`, {
    lignesEntete0Indi: stats.headerLineCount,
    xrefsIndiUniques: stats.uniqueIndiIds,
    lignesPerduesParXrefDuplique: stats.duplicateHeaderLines,
    fichesApresParse: parsedIndividualCount,
    echantillonXrefsEnDoublon: stats.duplicateIdsSample,
  });
  if (stats.duplicateHeaderLines > 0) {
    console.warn(
      '[G2] Ce GEDCOM contient plusieurs blocs INDI avec le même @xref@. Une seule fiche est conservée par identifiant (la dernière dans le fichier). C’est souvent la cause d’un total inférieur au nombre de lignes « 0 … INDI ».',
    );
  }
  if (parsedIndividualCount !== stats.uniqueIndiIds) {
    console.warn('[G2] Écart entre fiches parsées et xrefs INDI uniques.', {
      fiches: parsedIndividualCount,
      xrefsUniques: stats.uniqueIndiIds,
    });
  }
}

/**
 * Reconstructs a GEDCOM string from the internal data model.
 */
export const generateGedcom = (data: GedcomData): string => {
  const lines: string[] = [];

  // Header
  lines.push('0 HEAD');
  lines.push('1 SOUR GENEAVERSE_3D');
  lines.push('1 GEDC');
  lines.push('2 VERS 5.5.1');
  lines.push('2 FORM LINEAGE-LINKED');
  lines.push('1 CHAR UTF-8');

  // Individuals
  Object.values(data.individuals).forEach(indi => {
    lines.push(`0 ${indi.id} INDI`);
    
    // Name
    const nameStr = `${indi.givenName || ''} /${indi.surname || ''}/`;
    lines.push(`1 NAME ${nameStr.trim()}`);
    if (indi.givenName) lines.push(`2 GIVN ${indi.givenName}`);
    if (indi.surname) lines.push(`2 SURN ${indi.surname}`);

    // Sex
    if (indi.gender !== Gender.Unknown) {
      lines.push(`1 SEX ${indi.gender}`);
    }

    // Birth
    if (indi.birthDate?.raw || indi.birthPlace) {
      lines.push('1 BIRT');
      if (indi.birthDate?.raw) lines.push(`2 DATE ${indi.birthDate.raw}`);
      if (indi.birthPlace) lines.push(`2 PLAC ${indi.birthPlace}`);
    }

    // Death
    if (indi.deathDate?.raw || indi.deathPlace) {
      lines.push('1 DEAT');
      if (indi.deathDate?.raw) lines.push(`2 DATE ${indi.deathDate.raw}`);
      if (indi.deathPlace) lines.push(`2 PLAC ${indi.deathPlace}`);
    }

    if (indi.notes) {
      indi.notes
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => lines.push(`1 NOTE ${line}`));
    }

    // Family Links
    if (indi.familyChildId) {
      lines.push(`1 FAMC ${indi.familyChildId}`);
    }
    if (indi.familySpouseIds) {
      indi.familySpouseIds.forEach(famId => {
        lines.push(`1 FAMS ${famId}`);
      });
    }
  });

  // Families
  Object.values(data.families).forEach(fam => {
    lines.push(`0 ${fam.id} FAM`);
    
    if (fam.husbandId) lines.push(`1 HUSB ${fam.husbandId}`);
    if (fam.wifeId) lines.push(`1 WIFE ${fam.wifeId}`);
    
    if (fam.childrenIds) {
      fam.childrenIds.forEach(childId => {
        lines.push(`1 CHIL ${childId}`);
      });
    }

    if (fam.marriageDate?.raw) {
      lines.push('1 MARR');
      lines.push(`2 DATE ${fam.marriageDate.raw}`);
    }
  });

  // Trailer
  lines.push('0 TRLR');

  return lines.join('\n');
};
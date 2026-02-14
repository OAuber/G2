import { GedcomData, Individual, Family, Gender, DateInfo } from '../types';

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
  const lines = content.split(/\r?\n/);
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
    const match = trimmed.match(/^(\d+)\s+(@\w+@)?\s*(\w+)\s*(.*)?$/);

    if (!match) continue;

    const level = parseInt(match[1], 10);
    const xrefId = match[2]; // e.g., @I1@
    const tag = match[3];
    const value = match[4] || '';

    if (level === 0) {
      // New Record - Reset Contexts
      currentEvent = null;
      
      if (xrefId && tag === 'INDI') {
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
      } else if (xrefId && tag === 'FAM') {
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

        switch (tag) {
          case 'NAME':
            currentIndi.name = value.replace(/\//g, '');
            const parts = value.split('/');
            if (parts.length > 0) currentIndi.givenName = parts[0].trim();
            if (parts.length > 1) currentIndi.surname = parts[1].trim();
            break;
          case 'SEX':
            currentIndi.gender = value === 'M' ? Gender.Male : value === 'F' ? Gender.Female : Gender.Unknown;
            break;
          case 'BIRT':
          case 'DEAT':
            currentEvent = tag; // Set context for Level 2 tags (DATE)
            break;
          case 'FAMC': // Child of family
            currentIndi.familyChildId = value;
            break;
          case 'FAMS': // Spouse in family
            currentIndi.familySpouseIds?.push(value);
            break;
        }
      } else if (level === 2) {
        // Level 2 properties (mostly nested under events)
        if (tag === 'DATE' && currentEvent) {
          const dateInfo = parseDate(value);
          if (currentEvent === 'BIRT') currentIndi.birthDate = dateInfo;
          if (currentEvent === 'DEAT') currentIndi.deathDate = dateInfo;
        }
      }

    } else if (currentContext === 'FAM' && currentFam) {
      if (level === 1) {
        // Reset event context at level 1 change
        currentEvent = null; 
        
        switch (tag) {
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
         if (tag === 'DATE' && currentEvent === 'MARR') {
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
    if (indi.birthDate?.raw) {
      lines.push('1 BIRT');
      lines.push(`2 DATE ${indi.birthDate.raw}`);
    }

    // Death
    if (indi.deathDate?.raw) {
      lines.push('1 DEAT');
      lines.push(`2 DATE ${indi.deathDate.raw}`);
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
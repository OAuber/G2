import { describe, it, expect } from 'vitest';
import { isProbablyLivingForUi } from '../app/individualLiving';
import type { GedcomData } from '../types';
import { Gender } from '../types';

function minimal(id: string, deathYear: number | null, isCalculated?: boolean): GedcomData {
  const deathDate =
    deathYear == null
      ? undefined
      : {
          raw: String(deathYear),
          year: deathYear,
          isCalculated: isCalculated ?? false,
        };
  return {
    individuals: {
      [id]: {
        id,
        name: id,
        surname: 'X',
        givenName: 'A',
        gender: Gender.Male,
        deathDate,
      },
    },
    families: {},
  };
}

describe('isProbablyLivingForUi', () => {
  it('utilise le GEDCOM original pour la mort (normalisé peut ajouter une mort calculée)', () => {
    const original = minimal('I1', null);
    const normalized = minimal('I1', 2090, true);
    expect(isProbablyLivingForUi('I1', normalized, original)).toBe(true);
  });

  it('exclut si le décès est présent dans l’original', () => {
    const original = minimal('I1', 2000, false);
    const normalized = minimal('I1', 2000, false);
    expect(isProbablyLivingForUi('I1', normalized, original)).toBe(false);
  });

  it('sans original, une mort calculée seule ne retire pas la fiche', () => {
    const only = minimal('I1', 2050, true);
    expect(isProbablyLivingForUi('I1', only, null)).toBe(true);
  });
});

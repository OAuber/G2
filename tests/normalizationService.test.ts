import { describe, it, expect } from 'vitest';
import { normalizeGedcom } from '../services/normalizationService';
import type { GedcomData } from '../types';
import { Gender } from '../types';

function minimalData(): GedcomData {
  return {
    individuals: {
      P: {
        id: 'P',
        name: 'P',
        surname: '',
        givenName: '',
        gender: Gender.Male,
        familySpouseIds: ['F1'],
      },
      C: {
        id: 'C',
        name: 'C',
        surname: '',
        givenName: '',
        gender: Gender.Female,
        familyChildId: 'F1',
        birthDate: { raw: '2000', year: 2000, preciseDate: 2000 },
      },
    },
    families: {
      F1: { id: 'F1', husbandId: 'P', wifeId: '', childrenIds: ['C'] },
    },
  };
}

describe('normalizeGedcom', () => {
  it('ne mute pas l’entrée et retourne une copie avec individuals', () => {
    const original = minimalData();
    const out = normalizeGedcom(original);
    expect(out).not.toBe(original);
    expect(out.individuals.P).toBeDefined();
    expect(out.individuals.C).toBeDefined();
  });

  it('peut inférer une date de naissance manquante à partir d’un enfant', () => {
    const data = minimalData();
    const out = normalizeGedcom(data);
    const p = out.individuals.P;
    expect(p.birthDate?.year).not.toBeNull();
  });
});

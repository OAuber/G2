import { describe, it, expect } from 'vitest';
import { findRelationshipPath } from '../services/relationshipPath';
import type { GedcomData } from '../types';
import { Gender } from '../types';

function twoPersonSpouseGraph(): GedcomData {
  return {
    individuals: {
      A: {
        id: 'A',
        name: 'A',
        surname: '',
        givenName: '',
        gender: Gender.Male,
        familySpouseIds: ['F1'],
      },
      B: {
        id: 'B',
        name: 'B',
        surname: '',
        givenName: '',
        gender: Gender.Female,
        familySpouseIds: ['F1'],
      },
    },
    families: {
      F1: { id: 'F1', husbandId: 'A', wifeId: 'B', childrenIds: [] },
    },
  };
}

describe('findRelationshipPath', () => {
  it('retourne uniquement la source si source === cible', () => {
    const data = twoPersonSpouseGraph();
    const path = findRelationshipPath(data, 'A', 'A');
    expect(path).toEqual(new Set(['A']));
  });

  it('trouve le conjoint en un pas', () => {
    const data = twoPersonSpouseGraph();
    const path = findRelationshipPath(data, 'A', 'B');
    expect(path.has('A')).toBe(true);
    expect(path.has('B')).toBe(true);
  });

  it('retourne un ensemble vide si un id est inconnu', () => {
    const data = twoPersonSpouseGraph();
    expect(findRelationshipPath(data, 'A', 'Z').size).toBe(0);
  });
});

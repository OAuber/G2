import { describe, expect, it } from 'vitest';
import { Gender, type GedcomData, type Individual } from '../types';
import {
  dedupeFamiliesBySymmetricPartnership,
  familyMatchesSpousePairForUpdate,
  findExistingFamilyIdByParentPair,
} from '../services/familyPartnership';

const indi = (id: string, o: Partial<Individual> = {}): Individual => ({
  id,
  name: id,
  givenName: '',
  surname: '',
  gender: Gender.Unknown,
  ...o,
});

describe('familyPartnership', () => {
  it('findExistingFamilyIdByParentPair ignores H/W swap', () => {
    const data: GedcomData = {
      individuals: {
        '@I1@': indi('@I1@'),
        '@I2@': indi('@I2@'),
      },
      families: {
        '@F1@': {
          id: '@F1@',
          husbandId: '@I2@',
          wifeId: '@I1@',
          childrenIds: [],
        },
      },
    };
    expect(findExistingFamilyIdByParentPair(data, '@I1@', '@I2@')).toBe('@F1@');
    expect(findExistingFamilyIdByParentPair(data, '@I2@', '@I1@')).toBe('@F1@');
  });

  it('familyMatchesSpousePairForUpdate is symmetric for full couples', () => {
    const f = { id: '@F@', husbandId: 'B', wifeId: 'A', childrenIds: [] as string[] };
    expect(familyMatchesSpousePairForUpdate(f, 'A', 'B')).toBe(true);
    expect(familyMatchesSpousePairForUpdate(f, 'B', 'A')).toBe(true);
    expect(familyMatchesSpousePairForUpdate(f, 'A', 'C')).toBe(false);
  });

  it('dedupeFamiliesBySymmetricPartnership merges mirror families', () => {
    const data: GedcomData = {
      individuals: {
        '@I1@': indi('@I1@', { familySpouseIds: ['@FA@', '@FB@'] }),
        '@I2@': indi('@I2@', { familySpouseIds: ['@FA@', '@FB@'] }),
        '@I3@': indi('@I3@', { familyChildId: '@FB@' }),
      },
      families: {
        '@FA@': { id: '@FA@', husbandId: '@I1@', wifeId: '@I2@', childrenIds: ['@I3@'] },
        '@FB@': { id: '@FB@', husbandId: '@I2@', wifeId: '@I1@', childrenIds: ['@I3@'] },
      },
    };
    dedupeFamiliesBySymmetricPartnership(data);
    expect(Object.keys(data.families).length).toBe(1);
    const only = data.families['@FA@'] ?? data.families['@FB@'];
    expect(only?.childrenIds).toContain('@I3@');
    expect(data.individuals['@I3@']?.familyChildId).toBe(only?.id);
  });
});

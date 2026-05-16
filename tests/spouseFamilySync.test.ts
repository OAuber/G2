import { describe, expect, it } from 'vitest';
import { Gender, type GedcomData, type Individual } from '../types';
import {
  applyUnionsOnCreate,
  applyUnionsOnUpdate,
  buildUnionsFromIndividual,
  emptyUnionFormEntry,
} from '../services/spouseFamilySync';

const indi = (id: string, o: Partial<Individual> = {}): Individual => ({
  id,
  name: id,
  givenName: '',
  surname: '',
  gender: Gender.Unknown,
  ...o,
});

describe('spouseFamilySync unions', () => {
  it('buildUnionsFromIndividual lists every FAMS', () => {
    const data: GedcomData = {
      individuals: {
        '@I1@': indi('@I1@', { familySpouseIds: ['@F1@', '@F2@'] }),
        '@I2@': indi('@I2@', { familySpouseIds: ['@F1@'] }),
        '@I3@': indi('@I3@', { familySpouseIds: ['@F2@'] }),
      },
      families: {
        '@F1@': { id: '@F1@', husbandId: '@I1@', wifeId: '@I2@', childrenIds: ['@C1@'] },
        '@F2@': { id: '@F2@', husbandId: '@I1@', wifeId: '@I3@', childrenIds: ['@C2@'] },
      },
    };
    const unions = buildUnionsFromIndividual(data, data.individuals['@I1@']!);
    expect(unions).toHaveLength(2);
    expect(unions.map((u) => u.spouseId).sort()).toEqual(['@I2@', '@I3@']);
  });

  it('applyUnionsOnUpdate preserves spouse slots on earlier unions when adding another', () => {
    const data: GedcomData = {
      individuals: {
        '@I1@': indi('@I1@', { gender: Gender.Male, familySpouseIds: ['@F1@'] }),
        '@I2@': indi('@I2@', { gender: Gender.Female, familySpouseIds: ['@F1@'] }),
        '@I3@': indi('@I3@', { gender: Gender.Female }),
      },
      families: {
        '@F1@': { id: '@F1@', husbandId: '@I1@', wifeId: '@I2@', childrenIds: [] },
      },
    };
    applyUnionsOnUpdate(
      data,
      '@I1@',
      [
        { familyId: '@F1@', spouseId: '@I2@', marriageDate: '', childrenIds: [] },
        { spouseId: '@I3@', marriageDate: '', childrenIds: [] },
      ],
      Gender.Male,
      (d) => `@F${Object.keys(d.families).length + 1}@`,
    );
    expect(data.families['@F1@']?.husbandId).toBe('@I1@');
    expect(data.families['@F1@']?.wifeId).toBe('@I2@');
    expect(data.individuals['@I1@']?.familySpouseIds).toHaveLength(2);
  });

  it('applyUnionsOnUpdate keeps two unions with different spouses and children', () => {
    const data: GedcomData = {
      individuals: {
        '@I1@': indi('@I1@', { gender: Gender.Male, familySpouseIds: ['@F1@'] }),
        '@I2@': indi('@I2@', { gender: Gender.Female, familySpouseIds: ['@F1@'] }),
        '@I3@': indi('@I3@', { gender: Gender.Female }),
        '@C1@': indi('@C1@', { familyChildId: '@F1@' }),
        '@C2@': indi('@C2@'),
      },
      families: {
        '@F1@': { id: '@F1@', husbandId: '@I1@', wifeId: '@I2@', childrenIds: ['@C1@'] },
      },
    };
    applyUnionsOnUpdate(
      data,
      '@I1@',
      [
        { familyId: '@F1@', spouseId: '@I2@', marriageDate: '', childrenIds: ['@C1@'] },
        { spouseId: '@I3@', marriageDate: '1965', childrenIds: ['@C2@'] },
      ],
      Gender.Male,
      (d) => `@F${Object.keys(d.families).length + 1}@`,
    );
    expect(data.individuals['@I1@']?.familySpouseIds).toHaveLength(2);
    const f2 = data.individuals['@I1@']!.familySpouseIds!.find((id) => id !== '@F1@');
    expect(f2).toBeTruthy();
    expect(data.families[f2!]?.wifeId).toBe('@I3@');
    expect(data.families[f2!]?.childrenIds).toEqual(['@C2@']);
    expect(data.individuals['@C2@']?.familyChildId).toBe(f2);
  });

  it('applyUnionsOnCreate adds multiple unions for a new person', () => {
    const data: GedcomData = {
      individuals: {
        '@I2@': indi('@I2@', { gender: Gender.Female }),
        '@I3@': indi('@I3@', { gender: Gender.Female }),
      },
      families: {},
    };
    const newIndi = indi('@I1@', { gender: Gender.Male, familySpouseIds: [] });
    data.individuals['@I1@'] = newIndi;
    applyUnionsOnCreate(
      data,
      '@I1@',
      newIndi,
      [
        { spouseId: '@I2@', marriageDate: '', childrenIds: [] },
        { spouseId: '@I3@', marriageDate: '', childrenIds: [] },
      ],
      (d) => `@F${Object.keys(d.families).length + 1}@`,
    );
    expect(data.individuals['@I1@']?.familySpouseIds?.length).toBe(2);
  });

  it('emptyUnionFormEntry is a blank row', () => {
    expect(emptyUnionFormEntry()).toEqual({ spouseId: '', marriageDate: '', childrenIds: [] });
  });
});

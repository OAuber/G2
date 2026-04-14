import { describe, expect, it } from 'vitest';
import {
  collectAncestorIndividualIds,
  collectDescendantIndividualIds,
  collectManifestScopeIndividualIds,
  extractGedcomSubset,
  expandScopeWithSpouses,
  previewBranchImportOnLocalTree,
} from '../services/lineageImportScope';
import type { GedcomData, Individual } from '../types';
import { Gender } from '../types';

const shell = (id: string, overrides: Partial<Individual> = {}): Individual => ({
  id,
  name: ' /',
  givenName: '',
  surname: '',
  gender: Gender.Unknown,
  ...overrides,
});

describe('lineageImportScope', () => {
  it('collectDescendantIndividualIds respects generation cap', () => {
    const data: GedcomData = {
      individuals: {
        '@I1@': shell('@I1@', { familySpouseIds: ['@F1@'] }),
        '@I2@': shell('@I2@', { familyChildId: '@F1@' }),
        '@I3@': shell('@I3@', { familyChildId: '@F2@' }),
      },
      families: {
        '@F1@': { id: '@F1@', childrenIds: ['@I2@'] },
        '@F2@': { id: '@F2@', childrenIds: ['@I3@'] },
      },
    };
    data.individuals['@I2@'] = { ...data.individuals['@I2@'], familySpouseIds: ['@F2@'] };

    const s0 = collectDescendantIndividualIds(data, '@I1@', 0);
    expect(s0.has('@I1@')).toBe(true);
    expect(s0.size).toBe(1);

    const s2 = collectDescendantIndividualIds(data, '@I1@', 2);
    expect(s2.size).toBe(3);
    expect(s2.has('@I3@')).toBe(true);
  });

  it('collectAncestorIndividualIds walks parents', () => {
    const data: GedcomData = {
      individuals: {
        '@I1@': shell('@I1@', { familyChildId: '@F1@' }),
        '@I10@': shell('@I10@'),
        '@I11@': shell('@I11@'),
      },
      families: {
        '@F1@': { id: '@F1@', husbandId: '@I10@', wifeId: '@I11@', childrenIds: ['@I1@'] },
      },
    };
    const s = collectAncestorIndividualIds(data, '@I1@', 2);
    expect(s.has('@I1@')).toBe(true);
    expect(s.has('@I10@')).toBe(true);
    expect(s.has('@I11@')).toBe(true);
  });

  it('previewBranchImportOnLocalTree returns counts', () => {
    const data: GedcomData = {
      individuals: {
        '@I1@': shell('@I1@', { familySpouseIds: ['@F1@'] }),
        '@I2@': shell('@I2@', { familyChildId: '@F1@' }),
      },
      families: {
        '@F1@': { id: '@F1@', childrenIds: ['@I2@'] },
      },
    };
    const p = previewBranchImportOnLocalTree(data, '@I1@', { maxGenDown: 3, maxGenUp: 2 });
    expect(p?.descendantCount).toBe(2);
    expect(p?.ancestorCount).toBe(1);
  });

  it('expandScopeWithSpouses adds the other parent', () => {
    const data: GedcomData = {
      individuals: {
        '@I1@': shell('@I1@', { familySpouseIds: ['@F1@'] }),
        '@I2@': shell('@I2@', { familySpouseIds: ['@F1@'] }),
      },
      families: {
        '@F1@': { id: '@F1@', husbandId: '@I1@', wifeId: '@I2@', childrenIds: [] },
      },
    };
    const s = expandScopeWithSpouses(data, new Set(['@I1@']));
    expect(s.has('@I2@')).toBe(true);
  });

  it('extractGedcomSubset keeps only complete families inside scope', () => {
    const data: GedcomData = {
      individuals: {
        '@I1@': shell('@I1@', { familySpouseIds: ['@F1@'] }),
        '@I2@': shell('@I2@', { familyChildId: '@F1@' }),
        '@I99@': shell('@I99@'),
      },
      families: {
        '@F1@': { id: '@F1@', childrenIds: ['@I2@'] },
      },
    };
    const sub = extractGedcomSubset(data, new Set(['@I1@', '@I2@']));
    expect(Object.keys(sub.individuals).sort()).toEqual(['@I1@', '@I2@'].sort());
    expect(sub.families['@F1@']).toBeDefined();
  });

  it('collectManifestScopeIndividualIds unions asc and desc', () => {
    const data: GedcomData = {
      individuals: {
        '@I1@': shell('@I1@', { familySpouseIds: ['@F1@'] }),
        '@I2@': shell('@I2@', { familyChildId: '@F1@', familySpouseIds: ['@F2@'] }),
        '@I3@': shell('@I3@', { familyChildId: '@F2@' }),
        '@I10@': shell('@I10@'),
        '@I11@': shell('@I11@'),
      },
      families: {
        '@F1@': { id: '@F1@', childrenIds: ['@I2@'] },
        '@F2@': { id: '@F2@', childrenIds: ['@I3@'] },
        '@F0@': { id: '@F0@', husbandId: '@I10@', wifeId: '@I11@', childrenIds: ['@I1@'] },
      },
    };
    data.individuals['@I1@'] = { ...data.individuals['@I1@'], familyChildId: '@F0@' };
    const scope = collectManifestScopeIndividualIds(data, '@I1@', 2, 2, false);
    expect(scope.has('@I1@')).toBe(true);
    expect(scope.has('@I2@')).toBe(true);
    expect(scope.has('@I10@')).toBe(true);
  });
});

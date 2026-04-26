import { describe, expect, it } from 'vitest';
import { Gender, type GedcomData, type Individual } from '../types';
import {
  applyBranchImportPlan,
  buildBranchImportPlan,
} from '../services/branchImportFromManifest';
import { createInviteExchangeManifest } from '../services/inviteExchangeManifest';
import { PEER_COMPARE_ID_PREFIX } from '../app/peerCompareIdNamespace';

const shell = (id: string, overrides: Partial<Individual> = {}): Individual => ({
  id,
  name: `Person ${id}`,
  givenName: '',
  surname: '',
  gender: Gender.Unknown,
  ...overrides,
});

describe('branchImportFromManifest', () => {
  it('builds create actions when no local match exists', () => {
    const localData: GedcomData = {
      individuals: {
        '@I1@': shell('@I1@', { givenName: 'Alice', surname: 'Martin' }),
      },
      families: {},
    };
    const peerData: GedcomData = {
      individuals: {
        '@I10@': shell('@I10@', { givenName: 'Bob', surname: 'Durand' }),
      },
      families: {},
    };
    const manifest = createInviteExchangeManifest({
      inviteId: 'inv-1',
      rootIndividualIds: ['@I10@'],
      maxGenDown: 0,
      maxGenUp: 0,
    });

    const plan = buildBranchImportPlan(localData, peerData, manifest);
    expect(plan.summary.create).toBe(1);
    expect(plan.items[0]).toMatchObject({ peerId: '@I10@', action: 'create' });
  });

  it('builds merge action on high-confidence match', () => {
    const localData: GedcomData = {
      individuals: {
        '@I1@': shell('@I1@', {
          givenName: 'Jean',
          surname: 'Auber',
          gender: Gender.Male,
          birthDate: { raw: '1900', year: 1900 },
        }),
      },
      families: {},
    };
    const peerData: GedcomData = {
      individuals: {
        '@I99@': shell('@I99@', {
          givenName: 'Jean',
          surname: 'Auber',
          gender: Gender.Male,
          birthDate: { raw: '1900', year: 1900 },
        }),
      },
      families: {},
    };
    const manifest = createInviteExchangeManifest({
      inviteId: 'inv-2',
      rootIndividualIds: ['@I99@'],
      maxGenDown: 0,
      maxGenUp: 0,
    });

    const plan = buildBranchImportPlan(localData, peerData, manifest, { autoMergeScore: 0.8 });
    expect(plan.summary.merge).toBe(1);
    expect(plan.items[0].action).toBe('merge');
    expect(plan.items[0].localId).toBe('@I1@');
  });

  it('applies create + family mapping to local data', () => {
    const localData: GedcomData = {
      individuals: {},
      families: {},
    };
    const peerData: GedcomData = {
      individuals: {
        '@I10@': shell('@I10@', { givenName: 'Root', surname: 'Peer', familySpouseIds: ['@F1@'] }),
        '@I11@': shell('@I11@', { givenName: 'Child', surname: 'Peer', familyChildId: '@F1@' }),
      },
      families: {
        '@F1@': { id: '@F1@', husbandId: '@I10@', childrenIds: ['@I11@'] },
      },
    };
    const manifest = createInviteExchangeManifest({
      inviteId: 'inv-3',
      rootIndividualIds: ['@I10@'],
      maxGenDown: 1,
      maxGenUp: 0,
    });
    const plan = buildBranchImportPlan(localData, peerData, manifest);
    const applied = applyBranchImportPlan(localData, peerData, plan);

    expect(Object.keys(applied.data.individuals).length).toBe(2);
    expect(Object.keys(applied.data.families).length).toBe(1);
    expect(applied.importedIndividualIds.length).toBe(2);
    expect(applied.importedFamilyIds.length).toBe(1);
  });

  it('strips pc: prefix so imported locals are real local xrefs', () => {
    const pc = (id: string) => `${PEER_COMPARE_ID_PREFIX}${id}`;
    const localData: GedcomData = { individuals: {}, families: {} };
    const peerData: GedcomData = {
      individuals: {
        [pc('@I10@')]: shell(pc('@I10@'), { givenName: 'Root', surname: 'Peer', familySpouseIds: [pc('@F1@')] }),
        [pc('@I11@')]: shell(pc('@I11@'), {
          givenName: 'Child',
          surname: 'Peer',
          familyChildId: pc('@F1@'),
        }),
      },
      families: {
        [pc('@F1@')]: { id: pc('@F1@'), husbandId: pc('@I10@'), childrenIds: [pc('@I11@')] },
      },
    };
    const manifest = createInviteExchangeManifest({
      inviteId: 'inv-4',
      rootIndividualIds: [pc('@I10@')],
      maxGenDown: 1,
      maxGenUp: 0,
    });
    const plan = buildBranchImportPlan(localData, peerData, manifest);
    const applied = applyBranchImportPlan(localData, peerData, plan);

    expect(Object.keys(applied.data.individuals).every((id) => !id.startsWith(PEER_COMPARE_ID_PREFIX))).toBe(true);
    expect(Object.keys(applied.data.families).every((id) => !id.startsWith(PEER_COMPARE_ID_PREFIX))).toBe(true);
    expect(applied.data.individuals['@I10@']).toBeDefined();
    expect(applied.data.families['@F1@']).toBeDefined();
  });

  it('merges peer union into existing local family by parents and unions children', () => {
    /** Mêmes xrefs côté pair et local (cas « même_id » / import réimport) pour que parents et enfants soient tous mappés. */
    const localData: GedcomData = {
      individuals: {
        '@I1@': shell('@I1@', { givenName: 'Parent', surname: 'X', familySpouseIds: ['@F1@'] }),
        '@I2@': shell('@I2@', { givenName: 'Spouse', surname: 'Y' }),
        '@I3@': shell('@I3@', { givenName: 'Kid', surname: 'A', familyChildId: '@F1@' }),
        '@I4@': shell('@I4@', { givenName: 'Kid', surname: 'B', familyChildId: '@F1@' }),
      },
      families: {
        '@F1@': { id: '@F1@', husbandId: '@I1@', wifeId: '@I2@', childrenIds: ['@I3@', '@I4@'] },
      },
    };
    const peerData: GedcomData = {
      individuals: {
        '@I1@': shell('@I1@', { givenName: 'Parent', surname: 'X', familySpouseIds: ['@F9@'] }),
        '@I2@': shell('@I2@', { givenName: 'Spouse', surname: 'Y' }),
        '@I3@': shell('@I3@', { givenName: 'Kid', surname: 'A', familyChildId: '@F9@' }),
        '@I4@': shell('@I4@', { givenName: 'Kid', surname: 'B', familyChildId: '@F9@' }),
        '@I5@': shell('@I5@', { givenName: 'Kid', surname: 'C', familyChildId: '@F9@' }),
        '@I6@': shell('@I6@', { givenName: 'Kid', surname: 'D', familyChildId: '@F9@' }),
      },
      families: {
        '@F9@': {
          id: '@F9@',
          husbandId: '@I1@',
          wifeId: '@I2@',
          childrenIds: ['@I3@', '@I4@', '@I5@', '@I6@'],
        },
      },
    };
    const manifest = createInviteExchangeManifest({
      inviteId: 'inv-merge-fam',
      rootIndividualIds: ['@I1@'],
      maxGenDown: 2,
      maxGenUp: 0,
    });
    const plan = buildBranchImportPlan(localData, peerData, manifest);
    const applied = applyBranchImportPlan(localData, peerData, plan);

    const fams = Object.keys(applied.data.families);
    expect(fams.length).toBe(1);
    const f = applied.data.families[fams[0]!];
    expect(f.childrenIds.length).toBe(4);
    expect(new Set(f.childrenIds).size).toBe(4);
  });

  it('merges duplicate peer unions when husband/wife order differs (no duplicate spouse families)', () => {
    const localData: GedcomData = { individuals: {}, families: {} };
    const peerData: GedcomData = {
      individuals: {
        '@I1@': shell('@I1@', { givenName: 'A', familySpouseIds: ['@F1@', '@F2@'] }),
        '@I2@': shell('@I2@', { givenName: 'B', familySpouseIds: ['@F1@', '@F2@'] }),
        '@I3@': shell('@I3@', { givenName: 'Child', familyChildId: '@F1@' }),
      },
      families: {
        '@F1@': { id: '@F1@', husbandId: '@I1@', wifeId: '@I2@', childrenIds: ['@I3@'] },
        '@F2@': { id: '@F2@', husbandId: '@I2@', wifeId: '@I1@', childrenIds: ['@I3@'] },
      },
    };
    const manifest = createInviteExchangeManifest({
      inviteId: 'inv-swap-dup',
      rootIndividualIds: ['@I1@'],
      maxGenDown: 2,
      maxGenUp: 0,
      includeSpouses: true,
    });
    const plan = buildBranchImportPlan(localData, peerData, manifest, { direction: 'descendants' });
    const applied = applyBranchImportPlan(localData, peerData, plan);
    const famKeys = Object.keys(applied.data.families);
    expect(famKeys.length).toBe(1);
    const only = applied.data.families[famKeys[0]!];
    expect(only.childrenIds.length).toBe(1);
    expect(only.childrenIds[0]).toBeDefined();
  });

  it('includes co-parents in descendant scope so imported children keep FAMC links', () => {
    /** Racine + enfants en descendance ; le conjoint n’est pas descendant de la racine — doit être ajouté si includeSpouses. */
    const localData: GedcomData = { individuals: {}, families: {} };
    const peerData: GedcomData = {
      individuals: {
        '@I1@': shell('@I1@', { givenName: 'Root', familySpouseIds: ['@F1@'] }),
        '@I2@': shell('@I2@', { givenName: 'Spouse' }),
        '@I3@': shell('@I3@', { givenName: 'Child', familyChildId: '@F1@' }),
      },
      families: {
        '@F1@': { id: '@F1@', husbandId: '@I1@', wifeId: '@I2@', childrenIds: ['@I3@'] },
      },
    };
    const manifest = createInviteExchangeManifest({
      inviteId: 'inv-spouse-scope',
      rootIndividualIds: ['@I1@'],
      maxGenDown: 1,
      maxGenUp: 0,
      includeSpouses: true,
    });
    const plan = buildBranchImportPlan(localData, peerData, manifest, {
      direction: 'descendants',
    });
    expect(plan.scopePeerIds).toContain('@I2@');
    const applied = applyBranchImportPlan(localData, peerData, plan);
    const child = Object.values(applied.data.individuals).find((i) => i.givenName === 'Child');
    expect(child?.familyChildId).toBeDefined();
  });
});

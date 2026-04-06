import { describe, expect, it } from 'vitest';
import { Gender } from '../types';
import {
  namespacePeerCompareGedcom,
  normalizePeerCompareDocumentsFromWire,
  PEER_COMPARE_ID_PREFIX,
  wireIndividualIdToPeerCompareId,
} from '../app/peerCompareIdNamespace';

describe('peerCompareIdNamespace', () => {
  it('préfixe les individus et familles et réécrit les références', () => {
    const input = {
      individuals: {
        '@I1@': {
          id: '@I1@',
          name: 'A',
          surname: 'A',
          givenName: 'A',
          gender: Gender.Male,
          familyChildId: '@F1@',
          familySpouseIds: ['@F2@'],
        },
        '@I2@': {
          id: '@I2@',
          name: 'B',
          surname: 'B',
          givenName: 'B',
          gender: Gender.Female,
        },
      },
      families: {
        '@F1@': {
          id: '@F1@',
          husbandId: '@I1@',
          wifeId: '@I2@',
          childrenIds: [],
        },
        '@F2@': {
          id: '@F2@',
          childrenIds: ['@I1@'],
        },
      },
    };
    const out = namespacePeerCompareGedcom(input);
    const p1 = `${PEER_COMPARE_ID_PREFIX}@I1@`;
    const p2 = `${PEER_COMPARE_ID_PREFIX}@I2@`;
    const f1 = `${PEER_COMPARE_ID_PREFIX}@F1@`;
    const f2 = `${PEER_COMPARE_ID_PREFIX}@F2@`;
    expect(Object.keys(out.individuals).sort()).toEqual([p1, p2].sort());
    expect(out.individuals[p1].familyChildId).toBe(f1);
    expect(out.individuals[p1].familySpouseIds).toEqual([f2]);
    expect(out.families[f1].husbandId).toBe(p1);
    expect(out.families[f1].wifeId).toBe(p2);
    expect(out.families[f2].childrenIds).toEqual([p1]);
  });

  it('wireIndividualIdToPeerCompareId est idempotent', () => {
    const once = wireIndividualIdToPeerCompareId('@I9@');
    expect(wireIndividualIdToPeerCompareId(once)).toBe(once);
  });

  it('remappe les clés documents fil vers les ids internes pair', () => {
    const namespaced = namespacePeerCompareGedcom({
      individuals: {
        '@I1@': {
          id: '@I1@',
          name: 'X',
          surname: 'X',
          givenName: 'X',
          gender: Gender.Unknown,
        },
      },
      families: {},
    });
    const docs = normalizePeerCompareDocumentsFromWire(
      {
        '@I1@': [
          {
            id: 'd1',
            title: 'p',
            url: 'https://example.com/a.jpg',
            source: 'online',
            kind: 'photo',
            isPrimaryPhoto: true,
          },
        ],
      },
      namespaced.individuals,
    );
    const pk = `${PEER_COMPARE_ID_PREFIX}@I1@`;
    expect(docs[pk]?.[0]?.url).toBe('https://example.com/a.jpg');
    expect(docs['@I1@']).toBeUndefined();
  });
});

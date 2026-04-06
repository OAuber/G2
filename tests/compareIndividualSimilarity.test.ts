import { describe, expect, it } from 'vitest';
import type { Individual } from '../types';
import { Gender } from '../types';
import { rankPeerMatchesForIndividual, scoreIndividualPair } from '../services/compareIndividualSimilarity';

describe('compareIndividualSimilarity', () => {
  it('scores identical names and birth year highly', () => {
    const a = {
      id: '@1@',
      name: 'Jean Dupont',
      givenName: 'Jean',
      surname: 'Dupont',
      gender: Gender.Male,
      birthDate: { year: 1900, month: 1, day: 1, raw: '' },
    } as unknown as Individual;
    const b = {
      id: '@2@',
      name: 'Jean Dupont',
      givenName: 'Jean',
      surname: 'Dupont',
      gender: Gender.Male,
      birthDate: { year: 1900, month: 2, day: 2, raw: '' },
    } as unknown as Individual;
    expect(scoreIndividualPair(a, b)).toBeGreaterThanOrEqual(0.9);
  });

  it('ranks best match first', () => {
    const source = {
      id: '@s@',
      name: 'Marie Curie',
      givenName: 'Marie',
      surname: 'Curie',
      gender: Gender.Female,
      birthDate: { year: 1867 },
    } as unknown as Individual;
    const candidates = [
      { id: 'x', name: 'Other Person', givenName: 'Other', surname: 'Person', gender: Gender.Female } as unknown as Individual,
      {
        id: 'y',
        name: 'Marie Curie',
        givenName: 'Marie',
        surname: 'Curie',
        gender: Gender.Female,
        birthDate: { year: 1867, raw: '' },
      } as unknown as Individual,
    ];
    const ranked = rankPeerMatchesForIndividual(source, candidates, { minScore: 0.2, limit: 5 });
    expect(ranked[0]?.individual.id).toBe('y');
  });
});

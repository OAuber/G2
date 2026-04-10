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
    expect(scoreIndividualPair(a, b)).toBeGreaterThanOrEqual(0.85);
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
    const ranked = rankPeerMatchesForIndividual(source, candidates, { minScore: 0.45, limit: 5 });
    expect(ranked[0]?.individual.id).toBe('y');
  });

  it('returns 0 when gender conflicts (both known)', () => {
    const a = {
      id: 'a',
      givenName: 'Jean',
      surname: 'Dupont',
      gender: Gender.Male,
      birthDate: { year: 1900 },
    } as unknown as Individual;
    const b = {
      id: 'b',
      givenName: 'Jean',
      surname: 'Dupont',
      gender: Gender.Female,
      birthDate: { year: 1900 },
    } as unknown as Individual;
    expect(scoreIndividualPair(a, b)).toBe(0);
  });

  it('does not treat Marie vs Marie-Laure as a strong given-name match when surnames differ', () => {
    const local = {
      id: '@I167@',
      name: 'Marie /Le Rouge/',
      givenName: 'Marie',
      surname: 'Le Rouge',
      gender: Gender.Female,
      birthDate: { year: 1980, raw: '1980' },
    } as unknown as Individual;
    const peer = {
      id: 'pc:@I235@',
      name: 'Marie-Laure /DUCHENNE/',
      givenName: 'Marie-Laure',
      surname: 'DUCHENNE',
      gender: Gender.Female,
      birthDate: { year: 1980, raw: '1980' },
      deathDate: { year: 2060, raw: '2060' },
    } as unknown as Individual;
    expect(scoreIndividualPair(local, peer)).toBeLessThan(0.45);
    const ranked = rankPeerMatchesForIndividual(local, [peer], { minScore: 0.45, limit: 5 });
    expect(ranked).toHaveLength(0);
  });

  it('uses NAME line when GIVN/SURN empty (Eliane /AUBER/ style)', () => {
    const guest = {
      id: '@I36@',
      name: 'Eliane, Madeleine /Auber/',
      givenName: 'Eliane, Madeleine',
      surname: 'Auber',
      gender: Gender.Female,
      birthDate: { year: 1928 },
      birthPlace: 'Le Havre',
    } as unknown as Individual;
    const host = {
      id: 'pc:@I310@',
      name: 'Eliane /AUBER/',
      givenName: '',
      surname: '',
      gender: Gender.Female,
    } as unknown as Individual;
    expect(scoreIndividualPair(guest, host)).toBeGreaterThanOrEqual(0.45);
    const ranked = rankPeerMatchesForIndividual(guest, [host], { minScore: 0.45, limit: 5 });
    expect(ranked).toHaveLength(1);
  });

  it('treats comma vs space in given names consistently (symmetric scores)', () => {
    const a = {
      id: 'a',
      givenName: 'Virginie Héloïse',
      surname: 'ANCEL',
      gender: Gender.Female,
      birthDate: { year: 1871 },
      birthPlace: 'St-Eustache-la-Forêt, Seine-Maritime, France',
    } as unknown as Individual;
    const b = {
      id: 'b',
      givenName: 'Virginie, Héloise',
      surname: 'Ancel',
      gender: Gender.Female,
      birthDate: { year: 1876 },
      birthPlace: 'St-Eustache-la-Forêt, Seine-Maritime, France',
    } as unknown as Individual;
    const s = scoreIndividualPair(a, b);
    const sRev = scoreIndividualPair(b, a);
    expect(s).toBe(sRev);
    expect(s).toBeGreaterThanOrEqual(0.45);
  });

  it('rejects same surname and unrelated given names when at least one birth year is missing', () => {
    const anchor = {
      id: 'a',
      givenName: 'Alpha',
      surname: 'SharedSurname',
      gender: Gender.Male,
      birthDate: { year: 1796 },
    } as unknown as Individual;
    const peerIncomplete = {
      id: 'pc:b',
      givenName: 'Beta',
      surname: 'SharedSurname',
      gender: Gender.Male,
      birthPlace: 'Some City',
    } as unknown as Individual;
    expect(scoreIndividualPair(anchor, peerIncomplete)).toBe(0);
  });

  it('rejects same birth place but huge year gap (homonyms / generations)', () => {
    const older = {
      id: 'a',
      givenName: 'Alpha',
      surname: 'SharedSurname',
      gender: Gender.Unknown,
      birthDate: { year: 1924 },
      birthPlace: 'Shared Birth Place',
    } as unknown as Individual;
    const younger = {
      id: 'b',
      givenName: 'Beta',
      surname: 'SharedSurname',
      gender: Gender.Unknown,
      birthDate: { year: 2014 },
      birthPlace: 'Shared Birth Place',
    } as unknown as Individual;
    expect(scoreIndividualPair(older, younger)).toBe(0);
  });

  it('does not score high when birth years differ by many years', () => {
    const a = {
      id: 'a',
      givenName: 'Jean',
      surname: 'Dupont',
      gender: Gender.Male,
      birthDate: { year: 1900 },
    } as unknown as Individual;
    const b = {
      id: 'b',
      givenName: 'Jean',
      surname: 'Dupont',
      gender: Gender.Male,
      birthDate: { year: 1920 },
    } as unknown as Individual;
    expect(scoreIndividualPair(a, b)).toBeLessThan(0.45);
  });
});

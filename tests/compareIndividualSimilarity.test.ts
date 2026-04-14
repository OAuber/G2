import { describe, expect, it } from 'vitest';
import type { Individual } from '../types';
import { Gender } from '../types';
import type { GedcomData } from '../types';
import {
  birthYearIsUncertain,
  rankPeerMatchesForIndividual,
  scoreIndividualPair,
  scoreIndividualPairWithLineage,
} from '../services/compareIndividualSimilarity';

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

  it('matches Virginie Ancel–like pair when only one side has birth place (5-year gap)', () => {
    const minimal = {
      id: '@I320@',
      givenName: 'Virginie Héloïse',
      surname: 'ANCEL',
      gender: Gender.Female,
      birthDate: { year: 1871 },
    } as unknown as Individual;
    const detailed = {
      id: '@I114@',
      givenName: 'Virginie, Héloise',
      surname: 'Ancel',
      gender: Gender.Female,
      birthDate: { year: 1876 },
      birthPlace: 'St-Eustache-la-Forêt, 76576, Seine-Maritime, Normandie, France',
    } as unknown as Individual;
    expect(scoreIndividualPair(minimal, detailed)).toBeGreaterThanOrEqual(0.45);
    expect(scoreIndividualPair(detailed, minimal)).toBeGreaterThanOrEqual(0.45);
  });

  it('treats divergent GEDCOM birth place strings as same commune (St-Eustache)', () => {
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
      birthPlace: 'St-Eustache-la-Forêt, 76576, Seine-Maritime, Normandie, France',
    } as unknown as Individual;
    expect(scoreIndividualPair(a, b)).toBeGreaterThanOrEqual(0.45);
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

  it('detects uncertain birth years (isCalculated or GEDCOM qualifier in raw)', () => {
    expect(birthYearIsUncertain({ raw: '1871', year: 1871, isCalculated: true })).toBe(true);
    expect(birthYearIsUncertain({ raw: 'ABT 1876', year: 1876 })).toBe(true);
    expect(birthYearIsUncertain({ raw: '1876', year: 1876 })).toBe(false);
  });

  it('softens year gap when at least one birth year is uncertain (normalized vs sourced)', () => {
    const sourced = {
      id: 'a',
      givenName: 'Virginie Héloïse',
      surname: 'ANCEL',
      gender: Gender.Female,
      birthDate: { raw: '1871', year: 1871 },
    } as unknown as Individual;
    const estimated = {
      id: 'b',
      givenName: 'Virginie, Héloise',
      surname: 'Ancel',
      gender: Gender.Female,
      birthDate: { raw: 'ABT 1876', year: 1876, isCalculated: true },
    } as unknown as Individual;
    expect(scoreIndividualPair(sourced, estimated)).toBeGreaterThanOrEqual(0.45);
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

  it('adds bounded lineage bonus when parents match across two gedcoms', () => {
    const makeGedcom = (): GedcomData => ({
      individuals: {
        '@I1@': {
          id: '@I1@',
          name: 'Jean /Dupont/',
          givenName: 'Jean',
          surname: 'Dupont',
          gender: Gender.Male,
          birthDate: { year: 1900, raw: '1900' },
          familyChildId: '@F1@',
        },
        '@I10@': {
          id: '@I10@',
          name: 'Pierre /Dupont/',
          givenName: 'Pierre',
          surname: 'Dupont',
          gender: Gender.Male,
          birthDate: { year: 1870, raw: '' },
        },
        '@I11@': {
          id: '@I11@',
          name: 'Marie /Martin/',
          givenName: 'Marie',
          surname: 'Martin',
          gender: Gender.Female,
          birthDate: { year: 1872, raw: '' },
        },
      },
      families: {
        '@F1@': {
          id: '@F1@',
          husbandId: '@I10@',
          wifeId: '@I11@',
          childrenIds: ['@I1@'],
        },
      },
    });
    const ga = makeGedcom();
    const gb = makeGedcom();
    const childA = ga.individuals['@I1@']!;
    const childB = gb.individuals['@I1@']!;
    const base = scoreIndividualPair(childA, childB);
    const withL = scoreIndividualPairWithLineage(childA, childB, { gedcomA: ga, gedcomB: gb });
    expect(base).toBeGreaterThanOrEqual(0.25);
    expect(withL).toBeGreaterThan(base);
    expect(withL - base).toBeLessThanOrEqual(0.09);
  });
});

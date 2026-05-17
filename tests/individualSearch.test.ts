import { describe, expect, it } from 'vitest';
import { Gender, type Individual } from '../types';
import { individualPickerListLabel, individualMatchesSearchQuery } from '../services/individualSearch';

const indi = (o: Partial<Individual> = {}): Individual => ({
  id: '@I1@',
  name: 'Jean /Dupont/',
  givenName: 'Jean',
  surname: 'Dupont',
  gender: Gender.Male,
  ...o,
});

describe('individualPickerListLabel', () => {
  it('affiche la date de naissance quand elle est connue', () => {
    const p = indi({ birthDate: { raw: '1920', year: 1920 } });
    expect(individualPickerListLabel(p, 'fr')).toBe('Jean Dupont (1920)');
  });

  it('n’ajoute pas de parenthèses sans naissance', () => {
    expect(individualPickerListLabel(indi(), 'fr')).toBe('Jean Dupont');
  });
});

describe('individualMatchesSearchQuery', () => {
  it('trouve par année de naissance', () => {
    const p = indi({ birthDate: { raw: '1850', year: 1850 } });
    expect(individualMatchesSearchQuery(p, '1850')).toBe(true);
  });
});

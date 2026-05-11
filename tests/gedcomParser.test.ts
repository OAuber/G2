import { describe, it, expect } from 'vitest';
import { parseDate, parseGedcom } from '../services/gedcomParser';

describe('parseDate', () => {
  it('extrait une année simple', () => {
    const d = parseDate('1980');
    expect(d.year).toBe(1980);
    expect(d.preciseDate).toBe(1980);
  });

  it('gère un préfixe GEDCOM courant', () => {
    const d = parseDate('ABT 1850');
    expect(d.year).toBe(1850);
  });

  it('parse une date ISO yyyy-mm-dd', () => {
    const d = parseDate('2000-03-15');
    expect(d.year).toBe(2000);
    expect(d.preciseDate).toBeDefined();
    expect(d.preciseDate!).toBeGreaterThan(2000);
    expect(d.preciseDate!).toBeLessThan(2001);
  });

  it('parse une date ISO yyyy-mm', () => {
    const d = parseDate('1999-12');
    expect(d.year).toBe(1999);
    expect(d.preciseDate).toBeDefined();
  });
});

describe('parseGedcom', () => {
  it('parse un enregistrement minimal INDI', () => {
    const gedcom = [
      '0 HEAD',
      '1 GEDC',
      '2 VERS 5.5',
      '0 @I1@ INDI',
      '1 NAME John /Doe/',
      '1 SEX M',
      '0 TRLR',
    ].join('\n');
    const data = parseGedcom(gedcom);
    expect(data.individuals['@I1@']).toBeDefined();
    expect(data.individuals['@I1@']?.givenName).toContain('John');
  });
});

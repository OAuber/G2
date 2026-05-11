import { describe, it, expect } from 'vitest';
import {
  dateInfoToFormString,
  formatDateInfoDisplay,
  parseDateParts,
  partsToDocDateString,
  partsToGedcomString,
} from '../services/genealogyDate';

describe('parseDateParts', () => {
  it('décompose yyyy-mm-dd', () => {
    expect(parseDateParts('2010-06-01')).toEqual({ year: 2010, month: 6, day: 1 });
  });

  it('décompose yyyy-mm', () => {
    expect(parseDateParts('2010-06')).toEqual({ year: 2010, month: 6, day: null });
  });

  it('décompose une année seule', () => {
    expect(parseDateParts('1888')).toEqual({ year: 1888, month: null, day: null });
  });
});

describe('partsToGedcomString / partsToDocDateString', () => {
  it('GEDCOM année seule ou jour complet', () => {
    expect(partsToGedcomString({ year: 1900, month: null, day: null })).toBe('1900');
    expect(partsToGedcomString({ year: 1900, month: 3, day: 5 })).toBe('5 MAR 1900');
  });

  it('document ISO par niveau', () => {
    expect(partsToDocDateString({ year: 2001, month: null, day: null })).toBe('2001');
    expect(partsToDocDateString({ year: 2001, month: 2, day: null })).toBe('2001-02');
    expect(partsToDocDateString({ year: 2001, month: 2, day: 3 })).toBe('2001-02-03');
  });
});

describe('dateInfoToFormString', () => {
  it('préfère raw si parsable', () => {
    expect(dateInfoToFormString({ raw: '10 JUN 1920', year: 1920 })).toBe('10 JUN 1920');
  });

  it('retombe sur l’année si pas de raw exploitable', () => {
    expect(dateInfoToFormString({ year: 1955, raw: '' })).toBe('1955');
  });
});

describe('formatDateInfoDisplay', () => {
  it('affiche une date complète en français', () => {
    const s = formatDateInfoDisplay({ raw: '2000-05-01', year: 2000 }, 'fr');
    expect(s).toMatch(/2000/);
    expect(s).toMatch(/mai/i);
  });
});

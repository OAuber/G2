import { describe, expect, it } from 'vitest';
import {
  collectIndividualIdsForManifest,
  createInviteExchangeManifest,
  effectiveExchangePolicy,
  inviteDataFlagsFromP2PVisibility,
  parseInviteExchangeManifestJson,
  resolveExchangeRootIndividualId,
  validateManifestRootsAgainstGedcom,
  type InviteExchangeManifest,
} from '../services/inviteExchangeManifest';
import type { GedcomData } from '../types';
import { Gender } from '../types';

describe('inviteExchangeManifest', () => {
  const baseManifest = (): InviteExchangeManifest => ({
    schemaVersion: 1,
    inviteId: 'inv-1',
    generatedAt: '2026-01-01T00:00:00.000Z',
    rootIndividualIds: ['@I1@'],
    maxGenDown: 5,
    maxGenUp: 4,
    includeSpouses: true,
    data: { vital: true, relations: true, media: true, notes: true },
  });

  it('effectiveExchangePolicy uses minimum generations and conjunction on data flags', () => {
    const inviter = baseManifest();
    const merged = effectiveExchangePolicy(inviter, {
      maxGenDown: 2,
      maxGenUp: 10,
      includeSpouses: true,
      data: { vital: true, relations: false, media: true, notes: true },
      rootIndividualIds: ['@I77@'],
    });
    expect(merged.maxGenDown).toBe(2);
    expect(merged.maxGenUp).toBe(4);
    expect(merged.rootIndividualIds).toEqual(['@I77@']);
    expect(merged.data.relations).toBe(false);
    expect(merged.data.vital).toBe(true);
  });

  it('effectiveExchangePolicy requires both sides to allow spouses', () => {
    const inviter = { ...baseManifest(), includeSpouses: true };
    const off = effectiveExchangePolicy(inviter, {
      maxGenDown: 5,
      maxGenUp: 4,
      includeSpouses: false,
      data: inviter.data,
      rootIndividualIds: ['@I1@'],
    });
    expect(off.includeSpouses).toBe(false);
    const on = effectiveExchangePolicy(inviter, {
      maxGenDown: 5,
      maxGenUp: 4,
      includeSpouses: true,
      data: inviter.data,
      rootIndividualIds: ['@I1@'],
    });
    expect(on.includeSpouses).toBe(true);
  });

  it('resolveExchangeRootIndividualId prefers explicit scope root then fallback', () => {
    const gedcom: GedcomData = {
      individuals: {
        '@I1@': { id: '@I1@', name: ' /', givenName: '', surname: '', gender: Gender.Unknown },
        '@I2@': { id: '@I2@', name: ' /', givenName: '', surname: '', gender: Gender.Unknown },
      },
      families: {},
    };
    expect(resolveExchangeRootIndividualId(gedcom, { rootIndividualId: '@I2@' }, '@I1@')).toBe('@I2@');
    expect(resolveExchangeRootIndividualId(gedcom, { rootIndividualId: '@I99@' }, '@I1@')).toBe('@I1@');
    expect(resolveExchangeRootIndividualId(gedcom, {}, null)).toBe(null);
  });

  it('validateManifestRootsAgainstGedcom detects missing roots', () => {
    const gedcom: GedcomData = {
      individuals: {
        '@I1@': { id: '@I1@', name: ' /', givenName: '', surname: '', gender: Gender.Unknown },
      },
      families: {},
    };
    const ok = validateManifestRootsAgainstGedcom(
      { ...baseManifest(), rootIndividualIds: ['@I1@', '@I99@'] },
      gedcom,
    );
    expect(ok.ok).toBe(false);
    expect(ok.missingRootIds).toContain('@I99@');
  });

  it('createInviteExchangeManifest + parseInviteExchangeManifestJson roundtrip', () => {
    const m = createInviteExchangeManifest({
      inviteId: 'inv-round',
      rootIndividualIds: ['@I1@'],
      generatedAt: '2026-04-05T12:00:00.000Z',
      maxGenDown: 3,
      maxGenUp: 2,
      data: { vital: true, relations: true, media: false, notes: true },
    });
    const json = JSON.stringify(m);
    const back = parseInviteExchangeManifestJson(json);
    expect(back).not.toBeNull();
    expect(back!.inviteId).toBe('inv-round');
    expect(back!.rootIndividualIds).toEqual(['@I1@']);
    expect(back!.data.media).toBe(false);
  });

  it('collectIndividualIdsForManifest unions scopes for multiple roots', () => {
    const gedcom: GedcomData = {
      individuals: {
        '@I1@': { id: '@I1@', name: ' /', givenName: '', surname: '', gender: Gender.Unknown },
        '@I2@': { id: '@I2@', name: ' /', givenName: '', surname: '', gender: Gender.Unknown },
      },
      families: {},
    };
    const m = createInviteExchangeManifest({
      inviteId: 'x',
      rootIndividualIds: ['@I1@', '@I2@'],
      maxGenDown: 0,
      maxGenUp: 0,
      includeSpouses: false,
    });
    const ids = collectIndividualIdsForManifest(gedcom, m);
    expect(ids.size).toBe(2);
    expect(ids.has('@I1@')).toBe(true);
    expect(ids.has('@I2@')).toBe(true);
  });

  it('inviteDataFlagsFromP2PVisibility maps visibility to manifest flags', () => {
    const f = inviteDataFlagsFromP2PVisibility({
      exposeIdentity: true,
      exposeDates: false,
      exposePlaces: true,
      exposeNotes: true,
      allowDocuments: false,
      allowDownload: true,
      allowProposal: true,
      allowDirectEdit: false,
    });
    expect(f.vital).toBe(true);
    expect(f.media).toBe(false);
    expect(f.relations).toBe(true);
  });
});

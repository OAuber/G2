import { describe, expect, it } from 'vitest';
import {
  buildEphemeralAccessProfile,
  resolveLinkKind,
  sessionAllowsShareCompare,
} from '../app/inviteLinkKind';
import type { InviteTokenClaims } from '../services/p2pSecurity';

describe('inviteLinkKind', () => {
  it('defaults missing linkKind to named_claim', () => {
    expect(resolveLinkKind({} as Partial<InviteTokenClaims>)).toBe('named_claim');
    expect(resolveLinkKind(null)).toBe('named_claim');
  });

  it('detects ephemeral_free', () => {
    expect(resolveLinkKind({ linkKind: 'ephemeral_free' })).toBe('ephemeral_free');
  });

  it('sessionAllowsShareCompare only for named_claim', () => {
    expect(sessionAllowsShareCompare('named_claim')).toBe(true);
    expect(sessionAllowsShareCompare('ephemeral_free')).toBe(false);
    expect(sessionAllowsShareCompare(null)).toBe(false);
    expect(sessionAllowsShareCompare(undefined)).toBe(false);
  });

  it('buildEphemeralAccessProfile is read-only', () => {
    const p = buildEphemeralAccessProfile();
    expect(p.allowDirectEdit).toBe(false);
    expect(p.allowProposal).toBe(false);
    expect(p.allowDownload).toBe(false);
  });
});

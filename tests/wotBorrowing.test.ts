import { describe, expect, it } from 'vitest';
import { createWotBorrowRecordStub } from '../services/wotBorrowing';

describe('wotBorrowing', () => {
  it('createWotBorrowRecordStub sets version and issuedAt', () => {
    const r = createWotBorrowRecordStub({
      borrowerDisplayName: 'Test',
      borrowerPublicKeyJwk: { kty: 'EC' },
      contentDigest: 'abc',
      issuedAt: '2026-04-11T12:00:00.000Z',
    });
    expect(r.version).toBe(1);
    expect(r.issuedAt).toBe('2026-04-11T12:00:00.000Z');
    expect(r.contentDigest).toBe('abc');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INVITE_REVOKED_IDS_STORAGE_KEY } from '../app/storageKeys';
import {
  isInviteIdLocallyRevoked,
  loadRevokedInviteIds,
  persistRevokedInviteId,
} from '../app/p2pInviteRevocations';

const memory: Record<string, string> = {};

describe('p2pInviteRevocations', () => {
  beforeEach(() => {
    for (const k of Object.keys(memory)) delete memory[k];
    vi.stubGlobal(
      'localStorage',
      {
        getItem: (k: string) => memory[k] ?? null,
        setItem: (k: string, v: string) => {
          memory[k] = v;
        },
        removeItem: (k: string) => {
          delete memory[k];
        },
        clear: () => {
          for (const k of Object.keys(memory)) delete memory[k];
        },
        key: (i: number) => Object.keys(memory)[i] ?? null,
        get length() {
          return Object.keys(memory).length;
        },
      } as Storage
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persist puis détection locale', () => {
    expect(isInviteIdLocallyRevoked('inv-x')).toBe(false);
    persistRevokedInviteId('inv-x');
    expect(isInviteIdLocallyRevoked('inv-x')).toBe(true);
    expect(loadRevokedInviteIds().has('inv-x')).toBe(true);
    expect(memory[INVITE_REVOKED_IDS_STORAGE_KEY]).toContain('inv-x');
  });

  it('ignore une chaîne vide', () => {
    persistRevokedInviteId('');
    expect(loadRevokedInviteIds().size).toBe(0);
  });
});

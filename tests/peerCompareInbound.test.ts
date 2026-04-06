import { describe, expect, it } from 'vitest';
import { Gender } from '../types';
import { buildPeerCompareSnapshot, peerCompareInboundAllowDocuments } from '../app/peerCompareInbound';
import { PEER_COMPARE_ID_PREFIX } from '../app/peerCompareIdNamespace';

describe('peerCompareInbound', () => {
  it('peerCompareInboundAllowDocuments suit hôte vs client', () => {
    const vis = {
      exposeIdentity: true,
      exposeDates: true,
      exposePlaces: false,
      exposeNotes: false,
      allowDocuments: false,
      allowDownload: true,
      allowProposal: true,
      allowDirectEdit: false,
    };
    expect(peerCompareInboundAllowDocuments('host', null, vis)).toBe(false);
    expect(peerCompareInboundAllowDocuments('client', { ...vis, allowDocuments: true }, vis)).toBe(true);
  });

  it('buildPeerCompareSnapshot sans charge doc renvoie documents vides', () => {
    const g = {
      individuals: {
        '@I1@': {
          id: '@I1@',
          name: 'X',
          surname: 'X',
          givenName: 'X',
          gender: Gender.Unknown,
        },
      },
      families: {},
    };
    const { namespacedPeer, documents } = buildPeerCompareSnapshot(g, undefined, true);
    expect(Object.keys(documents)).toHaveLength(0);
    expect(namespacedPeer.individuals[`${PEER_COMPARE_ID_PREFIX}@I1@`]).toBeDefined();
  });
});

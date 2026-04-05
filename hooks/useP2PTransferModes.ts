import { useState } from 'react';
import type { P2PBundleContentMode, P2PTransferMode } from '../app/p2pAppTypes';
import { P2P_TRANSFER_MODE_KEY, P2P_BUNDLE_CONTENT_MODE_KEY } from '../app/storageKeys';

export function useP2PTransferModes() {
  const [p2pTransferMode, setP2PTransferMode] = useState<P2PTransferMode>(() => {
    const saved = localStorage.getItem(P2P_TRANSFER_MODE_KEY);
    return saved === 'progressive' ? 'progressive' : 'bundle';
  });
  const [p2pBundleContentMode, setP2PBundleContentMode] = useState<P2PBundleContentMode>(() => {
    const saved = localStorage.getItem(P2P_BUNDLE_CONTENT_MODE_KEY);
    return saved === 'gedcom-only' ? 'gedcom-only' : 'gedcom-and-documents';
  });
  return {
    p2pTransferMode,
    setP2PTransferMode,
    p2pBundleContentMode,
    setP2PBundleContentMode,
  };
}

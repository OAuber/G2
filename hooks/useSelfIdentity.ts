import { useState, useEffect, useRef } from 'react';
import type { SelfIdentityPublic } from '../types';
import { SELF_IDENTITY_STORAGE_KEY } from '../app/storageKeys';

export function useSelfIdentity() {
  const [selfIdentity, setSelfIdentity] = useState<SelfIdentityPublic | null>(() => {
    try {
      const raw = localStorage.getItem(SELF_IDENTITY_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as SelfIdentityPublic;
      if (!parsed?.individualId || !parsed?.deviceKeyId) return null;
      return parsed;
    } catch {
      return null;
    }
  });
  const selfIdentityRef = useRef<SelfIdentityPublic | null>(selfIdentity);
  useEffect(() => {
    selfIdentityRef.current = selfIdentity;
  }, [selfIdentity]);
  const [isIdentifyingSelf, setIsIdentifyingSelf] = useState(false);
  const [identityTabSignal, setIdentityTabSignal] = useState(0);

  useEffect(() => {
    try {
      if (selfIdentity) {
        localStorage.setItem(SELF_IDENTITY_STORAGE_KEY, JSON.stringify(selfIdentity));
      } else {
        localStorage.removeItem(SELF_IDENTITY_STORAGE_KEY);
      }
    } catch {
      // no-op
    }
  }, [selfIdentity]);

  const isIdentified = !!selfIdentity && selfIdentity.status !== 'unidentified';

  return {
    selfIdentity,
    setSelfIdentity,
    selfIdentityRef,
    isIdentifyingSelf,
    setIsIdentifyingSelf,
    identityTabSignal,
    setIdentityTabSignal,
    isIdentified,
  };
}

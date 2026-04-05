import { useState, useEffect, useRef } from 'react';
import type { GedcomData, SelfIdentityPublic } from '../types';
import type { IndividualDocument } from '../app/p2pAppTypes';
import { AUTOSAVE_SETTINGS_KEY } from '../app/storageKeys';
import type { AutoSaveSnapshot } from '../app/autoSave';
import { readAutoSaveSnapshot, saveAutoSaveSnapshot } from '../app/autoSave';

export function useAutoSave(
  originalGedcomData: GedcomData | null,
  documentsByIndividualId: Record<string, IndividualDocument[]>,
  selfIdentity: SelfIdentityPublic | null,
  databaseName: string,
) {
  const [autoSaveEnabled, setAutoSaveEnabled] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(AUTOSAVE_SETTINGS_KEY);
      return raw === null ? true : raw === '1';
    } catch {
      return true;
    }
  });
  const [autoSaveState, setAutoSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [autoSaveLastAt, setAutoSaveLastAt] = useState<string | null>(null);
  const [hasAutoSaveDraft, setHasAutoSaveDraft] = useState(false);
  const autoSaveTimerRef = useRef<number | null>(null);
  const isRestoringAutoSaveRef = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(AUTOSAVE_SETTINGS_KEY, autoSaveEnabled ? '1' : '0');
    } catch {
      // no-op
    }
  }, [autoSaveEnabled]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const snapshot = await readAutoSaveSnapshot();
        if (!cancelled && snapshot) {
          setHasAutoSaveDraft(true);
          setAutoSaveLastAt(snapshot.savedAt);
        }
      } catch {
        if (!cancelled) setHasAutoSaveDraft(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!autoSaveEnabled || !originalGedcomData || isRestoringAutoSaveRef.current) return;
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = window.setTimeout(async () => {
      try {
        setAutoSaveState('saving');
        const snapshot: AutoSaveSnapshot = {
          savedAt: new Date().toISOString(),
          databaseName,
          originalGedcomData,
          documentsByIndividualId,
          selfIdentity,
        };
        await saveAutoSaveSnapshot(snapshot);
        setAutoSaveLastAt(snapshot.savedAt);
        setAutoSaveState('saved');
        setHasAutoSaveDraft(true);
      } catch (error) {
        console.error('Auto-save failed', error);
        setAutoSaveState('error');
      }
    }, 2200);
    return () => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [autoSaveEnabled, originalGedcomData, documentsByIndividualId, selfIdentity, databaseName]);

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  return {
    autoSaveEnabled,
    setAutoSaveEnabled,
    autoSaveState,
    setAutoSaveState,
    autoSaveLastAt,
    setAutoSaveLastAt,
    hasAutoSaveDraft,
    setHasAutoSaveDraft,
    isRestoringAutoSaveRef,
    autoSaveTimerRef,
  };
}

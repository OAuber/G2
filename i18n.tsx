import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import en from './locales/en';
import fr from './locales/fr';

type Language = 'en' | 'fr';
type Dictionary = { [key: string]: string | Dictionary };

type I18nContextValue = {
  language: Language;
  setLanguage: (next: Language) => void;
  toggleLanguage: () => void;
  t: (key: string) => string;
};

const LANGUAGE_STORAGE_KEY = 'g2:ui-language:v1';
const dictionaries: Record<Language, Dictionary> = { en: en as unknown as Dictionary, fr: fr as unknown as Dictionary };

const I18nContext = createContext<I18nContextValue | null>(null);

function resolveKey(dict: Record<string, unknown>, key: string): string | null {
  const parts = key.split('.');
  let current: unknown = dict;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || !(part in (current as Record<string, unknown>))) {
      return null;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : null;
}

function detectInitialLanguage(): Language {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === 'fr' || stored === 'en') return stored;
  } catch {
    // ignore localStorage failures
  }
  if (typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('fr')) return 'fr';
  return 'en';
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(detectInitialLanguage);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      // ignore localStorage failures
    }
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguage(language === 'en' ? 'fr' : 'en');
  }, [language, setLanguage]);

  const t = useCallback(
    (key: string): string => {
      const primary = resolveKey(dictionaries[language] as unknown as Record<string, unknown>, key);
      if (primary !== null) return primary;
      const fallback = resolveKey(dictionaries.en as unknown as Record<string, unknown>, key);
      return fallback ?? key;
    },
    [language]
  );

  const value = useMemo<I18nContextValue>(() => ({ language, setLanguage, toggleLanguage, t }), [language, setLanguage, toggleLanguage, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}

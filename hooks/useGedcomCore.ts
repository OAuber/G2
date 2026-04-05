import { useState, useMemo } from 'react';
import type { GedcomData, Individual } from '../types';

/**
 * État principal GEDCOM : données brutes / normalisées, nom de base, individu racine et sélection.
 */
export function useGedcomCore() {
  const [originalGedcomData, setOriginalGedcomData] = useState<GedcomData | null>(null);
  const [normalizedGedcomData, setNormalizedGedcomData] = useState<GedcomData | null>(null);
  const [isNormalized, setIsNormalized] = useState(false);

  const gedcomData = useMemo(
    () => (isNormalized && normalizedGedcomData ? normalizedGedcomData : originalGedcomData),
    [isNormalized, normalizedGedcomData, originalGedcomData],
  );

  const [databaseName, setDatabaseName] = useState<string>('My Family Tree');
  const [rootIndividual, setRootIndividual] = useState<Individual | null>(null);
  const [selectedIndividual, setSelectedIndividual] = useState<Individual | null>(null);
  const [selectedIdsFor2D, setSelectedIdsFor2D] = useState<Set<string>>(new Set());

  return {
    originalGedcomData,
    setOriginalGedcomData,
    normalizedGedcomData,
    setNormalizedGedcomData,
    isNormalized,
    setIsNormalized,
    gedcomData,
    databaseName,
    setDatabaseName,
    rootIndividual,
    setRootIndividual,
    selectedIndividual,
    setSelectedIndividual,
    selectedIdsFor2D,
    setSelectedIdsFor2D,
  };
}

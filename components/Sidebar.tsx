import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Upload, Search, Loader2, FileText, User as UserIcon, Globe, Eye, EyeOff, Sparkles, SlidersHorizontal, Check, Save } from 'lucide-react';
import { Individual, GedcomData, Gender, SortMode, FilterTag } from '../types';
import { logGedcomImportDiagnostics, parseGedcom } from '../services/gedcomParser';
import { individualMatchesSearchQuery, individualPrimaryListLabel } from '../services/individualSearch';
import { useI18n } from '../i18n';
import { PEER_COMPARE_ID_PREFIX } from '../app/peerCompareIdNamespace';

/* ------------------------------------------------------------------ */
/*  Sort & Filter definitions                                          */
/* ------------------------------------------------------------------ */
const SORT_OPTIONS: { value: SortMode; key: string }[] = [
  { value: 'name',       key: 'sidebar.sort.name' },
  { value: 'birth-desc', key: 'sidebar.sort.birthDesc' },
  { value: 'birth-asc',  key: 'sidebar.sort.birthAsc' },
  { value: 'death-desc', key: 'sidebar.sort.deathDesc' },
  { value: 'death-asc',  key: 'sidebar.sort.deathAsc' },
  { value: 'lifespan',   key: 'sidebar.sort.lifespan' },
];

const FILTER_OPTIONS: { value: FilterTag; key: string; color: string; requiresSelected?: boolean }[] = [
  { value: 'manual',          key: 'sidebar.filters.manual',          color: 'text-green-400' },
  { value: 'male',            key: 'sidebar.filters.male',            color: 'text-blue-400' },
  { value: 'female',          key: 'sidebar.filters.female',          color: 'text-pink-400' },
  { value: 'unknown-gender',  key: 'sidebar.filters.unknownGender',   color: 'text-slate-400' },
  { value: 'unknown-dates',   key: 'sidebar.filters.unknownDates',    color: 'text-amber-400' },
  { value: 'calculated-dates',key: 'sidebar.filters.calculatedDates', color: 'text-yellow-400' },
  { value: 'no-parents',      key: 'sidebar.filters.noParents',       color: 'text-orange-400' },
  { value: 'no-spouse',       key: 'sidebar.filters.noSpouse',        color: 'text-violet-400' },
  { value: 'doc-online',      key: 'sidebar.filters.docOnline',       color: 'text-sky-400' },
  { value: 'doc-offline',     key: 'sidebar.filters.docOffline',      color: 'text-teal-400' },
  { value: 'selected-ancestors',   key: 'sidebar.filters.selectedAncestors',   color: 'text-cyan-400', requiresSelected: true },
  { value: 'selected-descendants', key: 'sidebar.filters.selectedDescendants', color: 'text-lime-400', requiresSelected: true },
];

export function computeLineageFilterSets(
  data: GedcomData | null,
  selectedId: string | null | undefined,
): { ancestors: Set<string>; descendants: Set<string> } {
  const ancestors = new Set<string>();
  const descendants = new Set<string>();
  if (!data || !selectedId || !data.individuals[selectedId]) return { ancestors, descendants };

  const includeSelectedAndSpouses = () => {
    ancestors.add(selectedId);
    descendants.add(selectedId);
    const selected = data.individuals[selectedId];
    const spouseFamilies = selected.familySpouseIds ?? [];
    for (const familyId of spouseFamilies) {
      const family = data.families[familyId];
      if (!family) continue;
      const spouseId = family.husbandId === selectedId ? family.wifeId : family.husbandId;
      if (spouseId) {
        ancestors.add(spouseId);
        descendants.add(spouseId);
      }
    }
  };
  includeSelectedAndSpouses();

  const ancestorStack = [selectedId];
  const ancestorVisited = new Set<string>([selectedId]);
  while (ancestorStack.length > 0) {
    const currentId = ancestorStack.pop()!;
    const indi = data.individuals[currentId];
    if (!indi?.familyChildId) continue;
    const family = data.families[indi.familyChildId];
    if (!family) continue;
    const parents = [family.husbandId, family.wifeId].filter(Boolean) as string[];
    for (const parentId of parents) {
      if (ancestorVisited.has(parentId)) continue;
      ancestorVisited.add(parentId);
      ancestors.add(parentId);
      ancestorStack.push(parentId);
    }
  }

  const descendantStack = [selectedId];
  const descendantVisited = new Set<string>([selectedId]);
  while (descendantStack.length > 0) {
    const currentId = descendantStack.pop()!;
    const indi = data.individuals[currentId];
    const spouseFamilies = indi?.familySpouseIds ?? [];
    for (const familyId of spouseFamilies) {
      const family = data.families[familyId];
      if (!family?.childrenIds) continue;
      for (const childId of family.childrenIds) {
        if (descendantVisited.has(childId)) continue;
        descendantVisited.add(childId);
        descendants.add(childId);
        descendantStack.push(childId);
      }
    }
  }

  return { ancestors, descendants };
}

/** Document minimal pour les filtres / tri (pièces jointes G2). */
export type SortDocumentRef = { source?: string; url?: string };

export function matchesFilters(
  indi: Individual,
  filters: Set<FilterTag>,
  context?: {
    selectedId?: string | null;
    lineageSets?: { ancestors: Set<string>; descendants: Set<string> };
    documentsByIndividualId?: Record<string, SortDocumentRef[]>;
  },
): boolean {
  if (filters.size === 0) return true;
  for (const f of filters) {
    switch (f) {
      case 'manual':           if (indi.source === 'manual') return true; break;
      case 'male':             if (indi.gender === Gender.Male) return true; break;
      case 'female':           if (indi.gender === Gender.Female) return true; break;
      case 'unknown-gender':   if (indi.gender === Gender.Unknown) return true; break;
      case 'unknown-dates':    if (!indi.birthDate?.year || !indi.deathDate?.year) return true; break;
      case 'calculated-dates': if (indi.birthDate?.isCalculated || indi.deathDate?.isCalculated) return true; break;
      case 'no-parents':       if (!indi.familyChildId) return true; break;
      case 'no-spouse':        if (!indi.familySpouseIds?.length) return true; break;
      case 'doc-online':
        if (hasOnlineDocument(context?.documentsByIndividualId?.[indi.id])) return true;
        break;
      case 'doc-offline':
        if (hasOfflineDocument(context?.documentsByIndividualId?.[indi.id])) return true;
        break;
      case 'selected-ancestors':
        if (context?.selectedId && context.lineageSets?.ancestors.has(indi.id)) return true;
        break;
      case 'selected-descendants':
        if (context?.selectedId && context.lineageSets?.descendants.has(indi.id)) return true;
        break;
    }
  }
  return false;
}

function hasOnlineDocument(docs: SortDocumentRef[] | undefined): boolean {
  if (!docs?.length) return false;
  return docs.some((d) => {
    if (d.source === 'online') return true;
    const u = d.url?.trim() ?? '';
    return u.startsWith('http://') || u.startsWith('https://');
  });
}

function hasOfflineDocument(docs: SortDocumentRef[] | undefined): boolean {
  if (!docs?.length) return false;
  return docs.some((d) => {
    if (d.source === 'local') return true;
    const u = d.url?.trim() ?? '';
    return u.startsWith('blob:') || u.startsWith('data:') || u.startsWith('file:');
  });
}

function nameCompare(a: Individual, b: Individual): number {
  const s = (a.surname ?? '').localeCompare(b.surname ?? '', undefined, { sensitivity: 'base' });
  if (s !== 0) return s;
  return (a.givenName ?? '').localeCompare(b.givenName ?? '', undefined, { sensitivity: 'base' });
}

export function applySortMode(
  list: Individual[],
  mode: SortMode,
): Individual[] {
  const sorted = [...list];
  switch (mode) {
    case 'name':
      return sorted.sort((a, b) => nameCompare(a, b));
    case 'birth-asc':
      return sorted.sort((a, b) => (a.birthDate?.year ?? 9999) - (b.birthDate?.year ?? 9999));
    case 'birth-desc':
      return sorted.sort((a, b) => (b.birthDate?.year ?? 0) - (a.birthDate?.year ?? 0));
    case 'death-asc':
      return sorted.sort((a, b) => (a.deathDate?.year ?? 9999) - (b.deathDate?.year ?? 9999));
    case 'death-desc':
      return sorted.sort((a, b) => (b.deathDate?.year ?? 0) - (a.deathDate?.year ?? 0));
    case 'lifespan':
      return sorted.sort((a, b) => {
        const lA = (a.deathDate?.year ?? (a.birthDate?.year ?? 0) + 80) - (a.birthDate?.year ?? 0);
        const lB = (b.deathDate?.year ?? (b.birthDate?.year ?? 0) + 80) - (b.birthDate?.year ?? 0);
        return lB - lA;
      });
    default:
      return sorted;
  }
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */
interface SidebarProps {
  onDataLoaded: (data: GedcomData, name?: string) => void;
  onImportBundle: (file: File, options?: { royalsDemo?: boolean }) => Promise<void> | void;
  /** Nom affiché / exports — toujours visible dans l’onglet Données. */
  databaseName: string;
  onDatabaseNameChange: (name: string) => void;
  /** Ex. invité visite libre : pas de renommage. */
  disableProjectRename?: boolean;
  onDownloadGedcom: () => void;
  onDownloadBundle: () => void;
  onSelectIndividual: (indi: Individual) => void;
  data: GedcomData | null;
  selectedId: string | null;
  selectedIdsFor2D?: Set<string>;
  onToggle2DSelection?: (id: string) => void;
  onClear2DSelection?: () => void;
  isOpen: boolean;
  onToggle: () => void;
  isLoading: boolean;
  onLoading: (loading: boolean) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  isDarkMode: boolean;
  sortMode?: SortMode;
  onSetSortMode?: (mode: SortMode) => void;
  activeFilters: Set<FilterTag>;
  onToggleFilter: (tag: FilterTag) => void;
  isNormalized: boolean;
  onToggleNormalization: () => void;
  autoSaveEnabled: boolean;
  onToggleAutoSave: () => void;
  autoSaveState: 'idle' | 'saving' | 'saved' | 'error';
  autoSaveLastAt: string | null;
  hasAutoSaveDraft: boolean;
  onRestoreAutoSave: () => void;
  /** Pour filtres « Doc. en ligne / hors ligne ». */
  documentsByIndividualId?: Record<string, SortDocumentRef[]>;
  /** Démo Rois : à l’ouverture du panneau, afficher l’onglet Liste. */
  preferListTabWhenOpening?: boolean;
  /** Liste fusionnée local + base du pair (mode comparaison 2D). */
  compareListMode?: boolean;
  compareRemoteData?: GedcomData | null;
  selectedCompareRemoteId?: string | null;
  /** Pour symétrie des filtres liste local/pair en comparaison. */
  selectedCompareLocalId?: string | null;
  onCompareSelectLocal?: (indi: Individual) => void;
  onCompareSelectRemote?: (indi: Individual) => void;
  compareProcessedLocalIds?: readonly string[];
  compareProcessedRemoteIds?: readonly string[];
  /** Médias du pair (même clés que `compareRemoteData.individuals`) pour les filtres doc en ligne/hors ligne. */
  compareRemoteDocumentsByIndividualId?: Record<string, SortDocumentRef[]>;
  /** Liste fusionnée (local + pair) — même tri/filtres que la grille 2D unifiée. */
  compareMergedIndividuals?: Individual[] | null;
  onCompareSelectUnified?: (indi: Individual) => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
const Sidebar: React.FC<SidebarProps> = ({ 
  onDataLoaded, 
  onImportBundle,
  databaseName,
  onDatabaseNameChange,
  disableProjectRename = false,
  onDownloadGedcom,
  onDownloadBundle,
  onSelectIndividual, 
  data, 
  selectedId, 
  selectedIdsFor2D,
  onToggle2DSelection,
  onClear2DSelection,
  isOpen,
  onToggle,
  isLoading,
  onLoading,
  onMouseEnter,
  onMouseLeave,
  isDarkMode,
  sortMode,
  onSetSortMode,
  activeFilters,
  onToggleFilter,
  isNormalized,
  onToggleNormalization,
  autoSaveEnabled,
  onToggleAutoSave,
  autoSaveState,
  autoSaveLastAt,
  hasAutoSaveDraft,
  onRestoreAutoSave,
  documentsByIndividualId,
  preferListTabWhenOpening = false,
  compareListMode = false,
  compareRemoteData = null,
  selectedCompareRemoteId = null,
  selectedCompareLocalId = null,
  onCompareSelectLocal,
  onCompareSelectRemote,
  compareProcessedLocalIds = [],
  compareProcessedRemoteIds = [],
  compareRemoteDocumentsByIndividualId,
  compareMergedIndividuals = null,
  onCompareSelectUnified,
}) => {
  const { t } = useI18n();
  const [searchTerm, setSearchTerm] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [activePane, setActivePane] = useState<'data' | 'list'>('data');
  const menuRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevSidebarOpenRef = useRef(false);
  const prevCompareListModeRef = useRef(false);

  useEffect(() => {
    if (preferListTabWhenOpening && isOpen && !prevSidebarOpenRef.current) {
      setActivePane('list');
    }
    prevSidebarOpenRef.current = isOpen;
  }, [isOpen, preferListTabWhenOpening]);

  useEffect(() => {
    if (!isOpen) return;
    setTimeout(() => {
      const container = scrollRef.current;
      if (!container) return;
      const scrollToId = (elId: string) => {
        const element = document.getElementById(elId);
        if (!element) return false;
        const containerRect = container.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        const offset = elementRect.top - containerRect.top;
        container.scrollTop =
          container.scrollTop + offset - container.clientHeight / 2 + element.clientHeight / 2;
        return true;
      };
      if (compareListMode) {
        if (compareMergedIndividuals && selectedId && scrollToId(`sidebar-item-unified-${selectedId}`)) return;
        if (selectedId && scrollToId(`sidebar-item-local-${selectedId}`)) return;
        if (selectedCompareRemoteId && scrollToId(`sidebar-item-remote-${selectedCompareRemoteId}`)) return;
      } else if (selectedId) {
        scrollToId(`sidebar-item-${selectedId}`);
      }
    }, 50);
  }, [
    selectedId,
    selectedCompareRemoteId,
    compareListMode,
    compareMergedIndividuals,
    isOpen,
    sortMode,
    searchTerm,
  ]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);
  const hadDataRef = useRef(false);
  useEffect(() => {
    const hasData = !!data;
    if (hasData && !hadDataRef.current) {
      hadDataRef.current = true;
      setActivePane('list');
    } else if (!hasData && hadDataRef.current) {
      hadDataRef.current = false;
      setActivePane('data');
    }
  }, [data]);

  /** À l’entrée en mode comparaison 2D uniquement : ouvrir l’onglet Liste (sans écraser un changement d’onglet manuel). */
  useEffect(() => {
    if (compareListMode && !prevCompareListModeRef.current) {
      setActivePane('list');
    }
    prevCompareListModeRef.current = compareListMode;
  }, [compareListMode]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    onLoading(true);
    setTimeout(async () => {
      try {
        const buffer = await file.arrayBuffer();
        const decoderProbe = new TextDecoder('windows-1252');
        const textProbe = decoderProbe.decode(buffer);
        const charMatch = textProbe.match(/\n1 CHAR (.+)(\r|$)/);
        let encoding = 'utf-8'; 
        if (charMatch) {
          const charType = charMatch[1].trim().toUpperCase();
          if (charType.includes('ANSI') || charType.includes('ANSEL')) encoding = 'windows-1252'; 
          else if (charType.includes('UTF-8')) encoding = 'utf-8';
          else if (charType.includes('UNICODE')) encoding = 'utf-16';
          else if (charType.includes('IBMPC') || charType.includes('IBM')) encoding = 'ibm850';
        } else {
          try {
            new TextDecoder('utf-8', { fatal: true }).decode(buffer);
            encoding = 'utf-8';
          } catch { encoding = 'windows-1252'; }
        }
        const text = new TextDecoder(encoding).decode(buffer);
        const fileName = file.name.replace(/\.ged$/i, '');
        const gedData = parseGedcom(text);
        logGedcomImportDiagnostics('import .ged', text, Object.keys(gedData.individuals).length);
        onDataLoaded(gedData, fileName);
      } catch (err) {
        console.error(err);
        alert(t('sidebar.labels.importReadError'));
      } finally {
        onLoading(false);
        event.target.value = '';
      }
    }, 100);
  };

  const handleLoadDemo = async () => {
    onLoading(true);
    try {
      const url = `${import.meta.env.BASE_URL}royals_wikipedia_enriched.g2.zip`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`demo fetch ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], "Rois et reines d'Europe.g2.zip", { type: 'application/octet-stream' });
      await onImportBundle(file, { royalsDemo: true });
    } catch (e) {
      console.error('Demo load failed', e);
      alert(t('sidebar.labels.demoLoadError'));
    } finally {
      onLoading(false);
    }
  };

  const handleBundleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    onLoading(true);
    try {
      await onImportBundle(file);
    } catch (err) {
      console.error(err);
      alert(t('sidebar.labels.importArchiveError'));
    } finally {
      onLoading(false);
      event.target.value = '';
    }
  };

  /** En comparaison : mêmes règles que les grilles — filtres asc/desc seulement si les deux ancres sont choisies. */
  const effectiveActiveFiltersLocal = useMemo(() => {
    if (!compareListMode) return activeFilters;
    if (!selectedCompareLocalId || !selectedCompareRemoteId) {
      const next = new Set(activeFilters);
      next.delete('selected-ancestors');
      next.delete('selected-descendants');
      return next;
    }
    return activeFilters;
  }, [compareListMode, activeFilters, selectedCompareLocalId, selectedCompareRemoteId]);

  const filteredList = useMemo(() => {
    if (!data) return [];
    let list = Object.values(data.individuals) as Individual[];
    const lineageSets = computeLineageFilterSets(data, selectedId);
    const filters = compareListMode ? effectiveActiveFiltersLocal : activeFilters;

    if (filters.size > 0) {
      list = list.filter(p =>
        matchesFilters(p, filters, { selectedId, lineageSets, documentsByIndividualId }),
      );
    }

    const sorted = applySortMode(list, sortMode || 'name');

    if (!searchTerm) {
        const slice = sorted.slice(0, 200);
        if (selectedId && !slice.find(p => p.id === selectedId)) {
             const selectedItem = data.individuals[selectedId];
             if (selectedItem) slice.unshift(selectedItem);
        }
        return slice;
    }
    
    return sorted.filter((p) => individualMatchesSearchQuery(p, searchTerm));
  }, [data, searchTerm, sortMode, selectedId, activeFilters, effectiveActiveFiltersLocal, compareListMode, documentsByIndividualId]);

  /** Filtres liste pair : symétrie avec la liste locale. */
  const activeFiltersRemote = useMemo(() => {
    if (!selectedCompareRemoteId || !selectedCompareLocalId) {
      const next = new Set(activeFilters);
      next.delete('selected-ancestors');
      next.delete('selected-descendants');
      return next;
    }
    return activeFilters;
  }, [activeFilters, selectedCompareRemoteId, selectedCompareLocalId]);

  const filteredListRemote = useMemo(() => {
    if (!compareListMode || !compareRemoteData) return [];
    let list = Object.values(compareRemoteData.individuals) as Individual[];
    const lineageSets = computeLineageFilterSets(
      compareRemoteData,
      selectedCompareRemoteId ?? undefined,
    );
    if (activeFiltersRemote.size > 0) {
      list = list.filter((p) =>
        matchesFilters(p, activeFiltersRemote, {
          selectedId: selectedCompareRemoteId,
          lineageSets,
          documentsByIndividualId: compareRemoteDocumentsByIndividualId,
        }),
      );
    }
    const sorted = applySortMode(list, sortMode || 'name');
    if (!searchTerm) {
      const slice = sorted.slice(0, 200);
      if (
        selectedCompareRemoteId &&
        !slice.find((p) => p.id === selectedCompareRemoteId)
      ) {
        const selectedItem = compareRemoteData.individuals[selectedCompareRemoteId];
        if (selectedItem) slice.unshift(selectedItem);
      }
      return slice;
    }
    return sorted.filter((p) => individualMatchesSearchQuery(p, searchTerm));
  }, [
    compareListMode,
    compareRemoteData,
    searchTerm,
    sortMode,
    selectedCompareRemoteId,
    activeFiltersRemote,
    compareRemoteDocumentsByIndividualId,
  ]);

  const compareMergedDisplayed = useMemo(() => {
    if (!compareMergedIndividuals || compareMergedIndividuals.length === 0) return [];
    if (!searchTerm) return compareMergedIndividuals.slice(0, 400);
    return compareMergedIndividuals.filter((p) => individualMatchesSearchQuery(p, searchTerm));
  }, [compareMergedIndividuals, searchTerm]);

  // Styles
  const bgClass = isDarkMode ? 'bg-black border-slate-800' : 'bg-slate-50 border-slate-300';
  const textClass = isDarkMode ? 'text-slate-200' : 'text-slate-800';
  const subTextClass = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  const itemHover = isDarkMode ? 'hover:bg-neutral-900' : 'hover:bg-white hover:shadow-sm';
  const inputBg = isDarkMode ? 'bg-neutral-900 border-slate-700' : 'bg-white border-slate-300';
  const buttonImportClass = isDarkMode 
    ? 'bg-neutral-800 hover:bg-neutral-700 border-slate-700' 
    : 'bg-white hover:bg-slate-100 border-slate-300';

  const handleBg = isDarkMode 
    ? 'bg-black text-slate-400 border-slate-800 hover:bg-neutral-900' 
    : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-50';

  const menuBg = isDarkMode ? 'bg-neutral-900 border-slate-700' : 'bg-white border-slate-300';
  const menuItemHover = isDarkMode ? 'hover:bg-slate-800' : 'hover:bg-slate-100';

  const getSourceIcon = (source?: string) => {
      if (source === 'manual') return <span title={t('sidebar.labels.sourceManual')}><UserIcon className="w-3 h-3 text-slate-500" /></span>;
      if (source === 'p2p') return <span title={t('sidebar.labels.sourceP2P')}><Globe className="w-3 h-3 text-emerald-500" /></span>;
      return <span title={t('sidebar.labels.sourceImported')}><FileText className="w-3 h-3 text-slate-500" /></span>;
  };

  const safeYear = (y?: number | null) => {
      return (typeof y === 'number' && !isNaN(y)) ? y : '?';
  };
  
  const scrollbarStyle = isDarkMode ? `
    .custom-scrollbar::-webkit-scrollbar { width: 8px; }
    .custom-scrollbar::-webkit-scrollbar-track { background: #000; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #475569; }
  ` : '';

  const activeSortLabel = (() => {
    const active = SORT_OPTIONS.find(o => o.value === sortMode);
    return active ? t(active.key) : t('sidebar.sort.fallback');
  })();
  const autoSaveStatusText =
    autoSaveState === 'saving'
      ? t('sidebar.labels.autosaveSaving')
      : autoSaveState === 'saved'
      ? `${t('sidebar.labels.autosaveSaved')} • ${autoSaveLastAt ? new Date(autoSaveLastAt).toLocaleTimeString() : t('sidebar.labels.autosaveNever')}`
      : autoSaveState === 'error'
      ? t('sidebar.labels.autosaveError')
      : `${t('sidebar.labels.autosaveSaved')} • ${autoSaveLastAt ? new Date(autoSaveLastAt).toLocaleTimeString() : t('sidebar.labels.autosaveNever')}`;
  const signalDot = (state: 'none' | 'attention' | 'running' | 'error') => {
    if (state === 'none') return null;
    const color =
      state === 'attention' ? 'bg-amber-500'
      : state === 'running' ? 'bg-cyan-500'
      : 'bg-rose-500';
    const pulse = state === 'attention' || state === 'running' ? 'animate-pulse' : '';
    return <span className={`inline-block w-2 h-2 rounded-full ${color} ${pulse}`} />;
  };
  const dataSignal: 'none' | 'attention' | 'running' | 'error' =
    autoSaveState === 'error'
      ? 'error'
      : isLoading || autoSaveState === 'saving'
      ? 'running'
      : (!data && hasAutoSaveDraft)
      ? 'attention'
      : 'none';
  const listSignal: 'none' | 'attention' | 'running' | 'error' = 'none';

  return (
    <div 
      data-no-canvas-wheel-zoom
      className={`absolute left-0 top-0 bottom-0 w-80 ${bgClass} border-r flex flex-col shadow-xl ${isOpen ? 'z-[130]' : 'z-[120]'} transition-transform duration-300 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
      style={{ touchAction: 'pan-y' }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {isDarkMode && <style>{scrollbarStyle}</style>}

      {/* Side Handle (Tab) */}
      <button 
         onClick={onToggle}
         style={{ touchAction: 'manipulation' }}
         className={`absolute top-1/2 left-full -translate-y-1/2 origin-left w-9 py-8 px-0 overflow-hidden rounded-r-xl border-y border-r border-l-0 ${handleBg} flex items-center justify-center shadow-md`}
      >
        <span className="[writing-mode:vertical-rl] rotate-180 text-xs font-bold uppercase tracking-widest whitespace-nowrap">
            {t('sidebar.labels.families')}
        </span>
      </button>

      <div className={`p-2 border-b ${isDarkMode ? 'border-slate-800' : 'border-slate-300'} grid grid-cols-2 gap-1`}>
        {([
          { key: 'data', label: t('sidebar.tabs.data'), signal: dataSignal },
          { key: 'list', label: t('sidebar.tabs.list'), signal: listSignal },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActivePane(tab.key)}
            className={`text-[11px] rounded px-2 py-1.5 border flex items-center justify-center gap-1 ${
              activePane === tab.key
                ? isDarkMode ? 'bg-slate-800 border-slate-600 text-slate-100' : 'bg-slate-200 border-slate-300 text-slate-900'
                : isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-900' : 'border-slate-300 text-slate-700 hover:bg-slate-100'
            }`}
          >
            {signalDot(tab.signal)}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Header (Data actions & Normalization) */}
      {activePane === 'data' && <div className={`p-4 border-b ${isDarkMode ? 'border-slate-800' : 'border-slate-300'} space-y-3`}>
        <div className="space-y-1">
          <div className={`text-[10px] font-bold uppercase tracking-wider ${subTextClass}`}>
            {t('sidebar.labels.projectName')}
          </div>
          <input
            type="text"
            value={databaseName}
            onChange={(e) => onDatabaseNameChange(e.target.value)}
            disabled={disableProjectRename}
            placeholder={t('sidebar.labels.projectNamePlaceholder')}
            spellCheck={false}
            className={`w-full rounded-md border px-2 py-1.5 text-xs ${
              isDarkMode
                ? 'border-slate-600 bg-slate-900/80 text-slate-100 placeholder:text-slate-500 disabled:opacity-50'
                : 'border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 disabled:opacity-50'
            }`}
            title={databaseName}
          />
          <p className={`text-[9px] leading-snug ${subTextClass}`}>{t('sidebar.labels.projectNameHint')}</p>
        </div>
        <div className={`flex items-center justify-between text-[10px] font-bold uppercase tracking-wider ${subTextClass}`}>
          <span>{t('sidebar.labels.data')}</span>
          <button
            type="button"
            onClick={onToggleAutoSave}
            className={`rounded px-2 py-0.5 border text-[10px] ${isDarkMode ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-300 hover:bg-slate-100'}`}
            title={t('sidebar.labels.autosave')}
          >
            {t('sidebar.labels.autosave')}: {autoSaveEnabled ? t('sidebar.labels.autosaveOn') : t('sidebar.labels.autosaveOff')}
          </button>
        </div>
        <div className={`text-[10px] ${subTextClass}`}>{t('sidebar.labels.autosaveScopeHint')}</div>
        <div className="grid grid-cols-2 gap-2">
          {!data ? (
            <>
              <label className={`w-full flex items-center justify-center px-3 py-2 border rounded-md cursor-pointer transition-colors ${buttonImportClass} ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}>
                {isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                <span className={`text-xs font-medium ${textClass}`}>
                  {isLoading ? t('sidebar.labels.importing') : t('sidebar.labels.importGedcom')}
                </span>
                <input type="file" accept=".ged" onChange={handleFileUpload} className="hidden" disabled={isLoading} />
              </label>
              <label className={`w-full flex items-center justify-center px-3 py-2 border rounded-md cursor-pointer transition-colors ${buttonImportClass} ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}>
                {isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                <span className={`text-xs font-medium ${textClass}`}>
                  {isLoading ? t('sidebar.labels.importing') : t('sidebar.labels.importArchive')}
                </span>
                <input
                  type="file"
                  accept=".g2.zip,.lifethread.zip,.zip,application/zip"
                  onChange={handleBundleUpload}
                  className="hidden"
                  disabled={isLoading}
                />
              </label>
            </>
          ) : (
            <>
              <div className="space-y-1">
                <div className={`text-[10px] ${subTextClass}`}>{t('sidebar.labels.autosaveGedcom')}: {autoSaveStatusText}</div>
                <button
                  type="button"
                  onClick={onDownloadGedcom}
                  className={`w-full flex items-center justify-center px-3 py-2 border rounded-md transition-colors ${buttonImportClass}`}
                >
                  <Save className="w-4 h-4 mr-2" />
                  <span className={`text-xs font-medium ${textClass}`}>{t('sidebar.labels.exportGedcom')}</span>
                </button>
              </div>
              <div className="space-y-1">
                <div className={`text-[10px] ${subTextClass}`}>{t('sidebar.labels.autosaveArchive')}: {autoSaveStatusText}</div>
                <button
                  type="button"
                  onClick={onDownloadBundle}
                  className={`w-full flex items-center justify-center px-3 py-2 border rounded-md transition-colors ${buttonImportClass}`}
                >
                  <Save className="w-4 h-4 mr-2" />
                  <span className={`text-xs font-medium ${textClass}`}>{t('sidebar.labels.exportArchive')}</span>
                </button>
              </div>
            </>
          )}
        </div>
        {data && <div className={`text-[10px] ${subTextClass}`}>{t('sidebar.labels.saveToDiskHint')}</div>}

        {!data && hasAutoSaveDraft && (
          <button
            type="button"
            onClick={onRestoreAutoSave}
            className={`w-full flex items-center justify-center px-3 py-2 border rounded-md transition-colors ${buttonImportClass}`}
          >
            <span className={`text-xs font-medium ${textClass}`}>{t('sidebar.labels.restoreAutosave')}</span>
          </button>
        )}
        
        {data && (
            <button 
                onClick={onToggleNormalization}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md border transition-all ${
                    isNormalized 
                    ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-500' 
                    : `${isDarkMode ? 'bg-neutral-900 border-slate-700 text-slate-400' : 'bg-white border-slate-300 text-slate-500'}`
                }`}
                title={isNormalized ? t('sidebar.labels.viewOriginalData') : t('sidebar.labels.calculateMissingDates')}
            >
                <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-wider">
                        {isNormalized ? t('sidebar.labels.normalized') : t('sidebar.labels.originalData')}
                    </span>
                </div>
                <div className={`w-8 h-4 rounded-full p-0.5 flex transition-colors ${isNormalized ? 'bg-yellow-500' : 'bg-slate-600'}`}>
                    <div className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${isNormalized ? 'translate-x-4' : 'translate-x-0'}`} />
                </div>
            </button>
        )}
      </div>}

      {/* Search + Sort/Filter Menu */}
      {activePane === 'list' && (data || compareListMode) && (
        <div className={`flex flex-col border-b ${isDarkMode ? 'border-slate-800' : 'border-slate-300'}`}>
            <div className="p-4 space-y-3 pb-3">
              {/* Search bar */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="text" 
                  placeholder={t('sidebar.labels.searchIndividuals')}
                  className={`w-full rounded-md pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-slate-500 border ${inputBg} ${textClass}`}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  disabled={!data && !compareRemoteData}
                />
              </div>

              {/* Sort/Filter button + dropdown */}
              {onSetSortMode && (
                <div className="relative" ref={menuRef}>
                  <button
                    onClick={() => setMenuOpen(o => !o)}
                    className={`w-full flex items-center justify-between px-3 py-1.5 rounded border text-xs transition-colors ${
                      activeFilters.size > 0
                        ? 'bg-blue-500/20 border-blue-500/50 text-blue-400'
                        : isDarkMode ? 'border-slate-700 hover:bg-slate-800 text-slate-300' : 'border-slate-300 hover:bg-slate-200 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      <span className="font-medium">{activeSortLabel}</span>
                      {activeFilters.size > 0 && (
                        <span className="bg-blue-500 text-white rounded-full px-1.5 py-0 text-[10px] font-bold leading-4">
                          {activeFilters.size}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] opacity-60">{t('sidebar.sort.menu')}</span>
                  </button>

                  {menuOpen && (
                    <div className={`absolute z-50 left-0 right-0 mt-1 rounded-lg border shadow-xl overflow-hidden ${menuBg}`}>
                      {/* Sort section */}
                      <div className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider ${subTextClass} ${isDarkMode ? 'bg-black/40' : 'bg-slate-50'}`}>
                        {t('sidebar.sort.title')}
                      </div>
                      {SORT_OPTIONS.map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => { onSetSortMode(opt.value); }}
                          className={`w-full flex items-center justify-between px-3 py-1.5 text-xs ${menuItemHover} ${
                            sortMode === opt.value ? (isDarkMode ? 'text-white bg-slate-800' : 'text-slate-900 bg-slate-100 font-bold') : textClass
                          }`}
                        >
                          <span>{t(opt.key)}</span>
                          {sortMode === opt.value && <Check className="w-3 h-3 text-blue-500" />}
                        </button>
                      ))}

                      {/* Filter section */}
                      <div className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider ${subTextClass} border-t ${isDarkMode ? 'bg-black/40 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                        {t('sidebar.filters.title')}
                      </div>
                      {FILTER_OPTIONS.map(opt => {
                        const active = activeFilters.has(opt.value);
                        const disabled = !!opt.requiresSelected && !selectedId;
                        return (
                          <button
                            key={opt.value}
                            onClick={() => {
                              if (disabled) return;
                              onToggleFilter(opt.value);
                            }}
                            disabled={disabled}
                            className={`w-full flex items-center justify-between px-3 py-1.5 text-xs ${menuItemHover} ${
                              active ? (isDarkMode ? 'bg-slate-800' : 'bg-slate-100') : ''
                            } ${textClass} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                          >
                            <span className={active ? opt.color : ''}>{t(opt.key)}</span>
                            {active && <Check className={`w-3 h-3 ${opt.color}`} />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Header for Records & Selection */}
            <div className={`px-4 py-2 bg-opacity-50 ${isDarkMode ? 'bg-black/20' : 'bg-slate-100/50'} flex justify-between items-center text-xs font-semibold uppercase tracking-wider ${subTextClass} border-t ${isDarkMode ? 'border-slate-800' : 'border-slate-200'}`}>
                <span className="leading-tight">
                  {compareListMode &&
                  compareMergedIndividuals != null &&
                  onCompareSelectUnified ? (
                    <>
                      {t('app.compare.sidebarLocal')} ({data ? Object.keys(data.individuals).length : 0})
                      <span className="mx-1">·</span>
                      {t('app.compare.sidebarRemote')} (
                      {compareRemoteData ? Object.keys(compareRemoteData.individuals).length : '—'})
                    </>
                  ) : compareListMode ? (
                    <>
                      {t('sidebar.labels.records')}: {t('app.compare.sidebarLocal')} ({data ? Object.keys(data.individuals).length : 0})
                      <span className="mx-1">·</span>
                      {t('app.compare.sidebarRemote')} (
                      {compareRemoteData ? Object.keys(compareRemoteData.individuals).length : '—'})
                    </>
                  ) : (
                    <>{t('sidebar.labels.records')} ({data ? Object.keys(data.individuals).length : 0})</>
                  )}
                </span>
                <div className="flex items-center gap-2">
                  <span title={t('sidebar.labels.visibleIn2D')}>
                    2D:{' '}
                    {!data &&
                    !(
                      compareListMode &&
                      compareMergedIndividuals != null &&
                      onCompareSelectUnified
                    )
                      ? '—'
                      : (() => {
                          const merged =
                            compareListMode &&
                            compareMergedIndividuals != null &&
                            onCompareSelectUnified;
                          const total = merged
                            ? compareMergedIndividuals.length
                            : data
                              ? Object.keys(data.individuals).length
                              : 0;
                          if (
                            merged &&
                            selectedIdsFor2D &&
                            selectedIdsFor2D.size > 0 &&
                            !selectedIdsFor2D.has('__NONE__')
                          ) {
                            return `${selectedIdsFor2D.size}/${total}`;
                          }
                          if (!merged && selectedIdsFor2D && selectedIdsFor2D.size > 0 && !selectedIdsFor2D.has('__NONE__')) {
                            return `${selectedIdsFor2D.size}/${total}`;
                          }
                          if (selectedIdsFor2D?.has('__NONE__')) {
                            return `0/${total}`;
                          }
                          return `${t('sidebar.labels.all')} (${total})`;
                        })()}
                  </span>
                  {onClear2DSelection && onToggle2DSelection && data && (
                      <button 
                          onClick={() => {
                            const isHidingAll = selectedIdsFor2D?.has('__NONE__');
                            const isShowingAll = !selectedIdsFor2D || selectedIdsFor2D.size === 0;
                            
                            if (isHidingAll) {
                              onClear2DSelection();
                            } else if (isShowingAll) {
                              onToggle2DSelection('__NONE__');
                            } else {
                              onClear2DSelection();
                            }
                          }}
                          className={`transition-colors flex items-center gap-1 hover:text-blue-500`}
                          title={selectedIdsFor2D?.has('__NONE__') ? t('sidebar.labels.showAll') : t('sidebar.labels.hideAll')}
                      >
                          {selectedIdsFor2D?.has('__NONE__') ? (
                            <>
                              <EyeOff className="w-3 h-3 text-red-500" />
                              <span className="hidden sm:inline text-[9px] text-red-500">{t('sidebar.labels.none')}</span>
                            </>
                          ) : (
                            <>
                              <Eye className="w-3 h-3 text-blue-500" />
                              <span className="hidden sm:inline text-[9px] text-blue-500">{t('sidebar.labels.all')}</span>
                            </>
                          )}
                      </button>
                  )}
                </div>
            </div>
        </div>
      )}

      {/* Scrollable List */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto custom-scrollbar flex flex-col isolate [overscroll-behavior-y:contain]"
      >
        {activePane === 'data' ? (
          !data ? (
            <div className={`p-4 text-sm ${subTextClass}`}>
              <p>{t('sidebar.labels.noDatabaseLoaded')}</p>
              <div className="mt-2 flex flex-col gap-1">
                <span className="opacity-70 text-xs">{t('sidebar.labels.noGedcom')}</span>
                <div className={`text-xs ${textClass}`}>
                  <div className="font-semibold leading-snug">{t('sidebar.labels.demoTitle')}</div>
                  <div className={`${subTextClass} mt-0.5 leading-snug`}>{t('sidebar.labels.demoSource')}</div>
                </div>
                <button
                  onClick={() => void handleLoadDemo()}
                  className="text-left text-blue-500 hover:text-blue-400 hover:underline font-bold text-xs"
                  disabled={isLoading}
                >
                  {t('sidebar.labels.tryDemo')}
                </button>
              </div>
            </div>
          ) : (
            <div className="p-4">
              <div className={`rounded border p-3 text-xs ${inputBg}`}>
                <div className={subTextClass}>{t('sidebar.labels.records')}: <span className={textClass}>{Object.keys(data.individuals).length}</span></div>
              </div>
            </div>
          )
        ) : !data &&
          !(
            compareListMode &&
            ((compareMergedIndividuals != null && onCompareSelectUnified) ||
              (onCompareSelectLocal && onCompareSelectRemote))
          ) ? (
          <div className={`p-4 text-sm ${subTextClass}`}>
            <p>{t('sidebar.labels.noDatabaseLoaded')}</p>
            <div className="mt-2 flex flex-col gap-1">
                 <span className="opacity-70 text-xs">{t('sidebar.labels.noGedcom')}</span>
                 <div className={`text-xs ${textClass}`}>
                   <div className="font-semibold leading-snug">{t('sidebar.labels.demoTitle')}</div>
                   <div className={`${subTextClass} mt-0.5 leading-snug`}>{t('sidebar.labels.demoSource')}</div>
                 </div>
                 <button
                    type="button"
                    onClick={() => void handleLoadDemo()}
                    className="text-left text-blue-500 hover:text-blue-400 hover:underline font-bold text-xs"
                    disabled={isLoading}
                 >
                    {t('sidebar.labels.tryDemo')}
                 </button>
            </div>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {compareListMode && compareMergedIndividuals != null && onCompareSelectUnified ? (
              <>
                <div
                  className={`sticky top-0 z-[1] -mx-1 px-2 py-1.5 mb-0.5 border-b space-y-1.5 ${
                    isDarkMode
                      ? 'bg-black/95 border-slate-700 text-slate-300'
                      : 'bg-white/95 border-slate-200 text-slate-600'
                  }`}
                >
                  <div className="text-[10px] font-bold uppercase tracking-wider">
                    {t('app.compare.importPairUnifiedListHint')}
                  </div>
                  {onClear2DSelection && (
                    <div className="flex flex-wrap items-center gap-2 normal-case font-normal">
                      <button
                        type="button"
                        onClick={() => onClear2DSelection()}
                        className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${
                          isDarkMode
                            ? 'border-slate-600 bg-slate-800/90 text-sky-200 hover:bg-slate-700'
                            : 'border-sky-400 bg-sky-50 text-sky-900 hover:bg-sky-100'
                        }`}
                      >
                        {t('app.compare.showFullGrid')}
                      </button>
                      <span className={`text-[9px] opacity-75 ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                        {t('app.compare.showFullGridShortcut')}
                      </span>
                    </div>
                  )}
                </div>
                {compareMergedDisplayed.map((indi) => {
                  const isPeer = indi.id.startsWith(PEER_COMPARE_ID_PREFIX);
                  const isNoneMode = selectedIdsFor2D?.has('__NONE__');
                  const isAllMode = !selectedIdsFor2D || selectedIdsFor2D.size === 0;
                  const isSelected2D = isNoneMode
                    ? false
                    : isAllMode
                      ? true
                      : selectedIdsFor2D.has(indi.id);
                  const isCal =
                    indi.birthDate?.isCalculated || indi.deathDate?.isCalculated;
                  const isProcessed =
                    compareProcessedLocalIds.includes(indi.id) ||
                    compareProcessedRemoteIds.includes(indi.id);
                  return (
                    <div
                      key={`merged-${indi.id}`}
                      id={`sidebar-item-unified-${indi.id}`}
                      className={`w-full flex items-center gap-1 rounded-md px-1 transition-colors border-l-4 ${
                        selectedId === indi.id
                          ? isDarkMode
                            ? 'border-l-violet-400 bg-slate-800'
                            : 'border-l-violet-600 bg-violet-100'
                          : isPeer
                            ? isDarkMode
                              ? 'border-l-emerald-500 bg-emerald-950/35'
                              : 'border-l-emerald-500 bg-emerald-50/95'
                            : isDarkMode
                              ? 'border-l-sky-600/80 bg-slate-950/60'
                              : 'border-l-sky-500 bg-sky-50/95'
                      } ${isDarkMode ? 'hover:bg-neutral-900/90' : 'hover:bg-sky-100'}`}
                    >
                      <button
                        type="button"
                        onClick={() => onCompareSelectUnified(indi)}
                        className="flex-1 text-left py-2 flex items-center gap-2 overflow-hidden"
                      >
                        <span
                          className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase ${
                            isPeer
                              ? 'bg-emerald-600 text-white border border-emerald-700'
                              : isDarkMode
                                ? 'bg-sky-800 text-sky-100'
                                : 'bg-sky-500 text-white'
                          }`}
                        >
                          {isPeer ? t('app.compare.sidebarRemote') : t('app.compare.sidebarLocal')}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <div
                              className={`text-sm font-medium truncate flex-1 ${textClass}`}
                            >
                              {(() => {
                                const primary = individualPrimaryListLabel(indi);
                                const sn = (indi.surname || '').trim();
                                if (sn && primary.includes(sn) && primary !== sn) {
                                  const before = primary.split(sn)[0]?.trim() ?? '';
                                  return (
                                    <>
                                      {before ? `${before} ` : null}
                                      <span className="font-bold">{sn}</span>
                                    </>
                                  );
                                }
                                return primary;
                              })()}
                              {isCal && (
                                <span
                                  className="ms-1.5 inline-block w-2 h-2 rounded-full bg-yellow-500 border border-black/40 align-middle"
                                  title={t('sidebar.labels.containsCalculatedDates')}
                                />
                              )}
                            </div>
                            <span
                              className={`shrink-0 inline-flex text-xs leading-none ${isPeer ? 'text-emerald-500' : (isDarkMode ? 'text-slate-300' : 'text-slate-500')}`}
                              title={t('app.compare.listProcessedMarkTitle')}
                              aria-label={t('app.compare.listProcessedMarkTitle')}
                            >
                              {isProcessed ? '●' : '○'}
                            </span>
                            <div className="opacity-70">{getSourceIcon(indi.source)}</div>
                          </div>
                          <div className={`text-xs truncate ${subTextClass}`}>
                            {safeYear(indi.birthDate?.year)} -{' '}
                            {safeYear(indi.deathDate?.year)}
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggle2DSelection?.(indi.id);
                        }}
                        className={`p-2 rounded hover:bg-slate-500/10 ${isSelected2D ? 'text-blue-500' : 'text-slate-600'}`}
                        title={
                          isSelected2D
                            ? t('sidebar.labels.hideAll')
                            : t('sidebar.labels.showAll')
                        }
                      >
                        {isSelected2D ? (
                          <Eye className="w-4 h-4" />
                        ) : (
                          <EyeOff className="w-4 h-4 opacity-30" />
                        )}
                      </button>
                    </div>
                  );
                })}
              </>
            ) : compareListMode && onCompareSelectLocal && onCompareSelectRemote ? (
              <>
                {data && (
                  <>
                <div
                  className={`sticky top-0 z-[1] -mx-1 px-2 py-1.5 mb-0.5 text-[10px] font-bold uppercase tracking-wider border-b ${
                    isDarkMode
                      ? 'bg-black/95 border-slate-700 text-slate-300'
                      : 'bg-white/95 border-slate-200 text-slate-600'
                  }`}
                >
                  {t('app.compare.sidebarLocal')} ({Object.keys(data.individuals).length})
                </div>
                {filteredList.map((indi) => {
                  const isNoneMode = selectedIdsFor2D?.has('__NONE__');
                  const isAllMode = !selectedIdsFor2D || selectedIdsFor2D.size === 0;
                  const isSelected2D = isNoneMode
                    ? false
                    : isAllMode
                      ? true
                      : selectedIdsFor2D.has(indi.id);
                  const isCal =
                    indi.birthDate?.isCalculated || indi.deathDate?.isCalculated;
                  const isProcessed = compareProcessedLocalIds.includes(indi.id);
                  return (
                    <div
                      key={`local-${indi.id}`}
                      id={`sidebar-item-local-${indi.id}`}
                      className={`w-full flex items-center gap-1 rounded-md px-1 transition-colors border-l-4 ${
                        selectedId === indi.id
                          ? isDarkMode
                            ? 'border-l-sky-400 bg-slate-800'
                            : 'border-l-sky-600 bg-sky-100'
                          : isDarkMode
                            ? 'border-l-sky-600/80 bg-slate-950/60'
                            : 'border-l-sky-500 bg-sky-50/95'
                      } ${isDarkMode ? 'hover:bg-neutral-900/90' : 'hover:bg-sky-100'}`}
                    >
                      <button
                        type="button"
                        onClick={() => onCompareSelectLocal(indi)}
                        className="flex-1 text-left py-2 flex items-center gap-2 overflow-hidden"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <div
                              className={`text-sm font-medium truncate flex-1 ${textClass}`}
                            >
                              {indi.givenName}{' '}
                              <span className="font-bold">{indi.surname}</span>
                              {isCal && (
                                <span
                                  className="ms-1.5 inline-block w-2 h-2 rounded-full bg-yellow-500 border border-black/40 align-middle"
                                  title={t('sidebar.labels.containsCalculatedDates')}
                                />
                              )}
                            </div>
                            {isProcessed && (
                              <span
                                className="shrink-0 inline-flex"
                                title={t('app.compare.listProcessedMarkTitle')}
                              >
                                <Check
                                  className="w-3.5 h-3.5 text-emerald-500"
                                  aria-label={t('app.compare.listProcessedMarkTitle')}
                                />
                              </span>
                            )}
                            <div className="opacity-70">{getSourceIcon(indi.source)}</div>
                          </div>
                          <div className={`text-xs truncate ${subTextClass}`}>
                            {safeYear(indi.birthDate?.year)} -{' '}
                            {safeYear(indi.deathDate?.year)}
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggle2DSelection?.(indi.id);
                        }}
                        className={`p-2 rounded hover:bg-slate-500/10 ${isSelected2D ? 'text-blue-500' : 'text-slate-600'}`}
                        title={
                          isSelected2D
                            ? t('sidebar.labels.hideAll')
                            : t('sidebar.labels.showAll')
                        }
                      >
                        {isSelected2D ? (
                          <Eye className="w-4 h-4" />
                        ) : (
                          <EyeOff className="w-4 h-4 opacity-30" />
                        )}
                      </button>
                    </div>
                  );
                })}
                  </>
                )}
                <div
                  className={`sticky top-0 z-[1] -mx-1 px-2 py-1.5 ${data ? 'mt-2' : ''} mb-0.5 text-[10px] font-bold uppercase tracking-wider border-b ${
                    isDarkMode
                      ? 'bg-slate-900/95 border-slate-600 text-slate-300'
                      : 'bg-slate-200/95 border-slate-300 text-slate-700'
                  }`}
                >
                  {t('app.compare.sidebarRemote')} (
                  {compareRemoteData ? Object.keys(compareRemoteData.individuals).length : '—'})
                </div>
                {compareRemoteData ? (
                filteredListRemote.map((indi) => {
                  const isCal =
                    indi.birthDate?.isCalculated || indi.deathDate?.isCalculated;
                  const isProcessed = compareProcessedRemoteIds.includes(indi.id);
                  return (
                    <div
                      key={`remote-${indi.id}`}
                      id={`sidebar-item-remote-${indi.id}`}
                      className={`w-full flex items-center gap-1 rounded-md px-1 border-l-4 motion-reduce:transition-none ${
                        selectedCompareRemoteId === indi.id
                          ? isDarkMode
                            ? 'border-l-amber-400 bg-slate-700'
                            : 'border-l-amber-600 bg-amber-100'
                          : isDarkMode
                            ? 'border-l-slate-500 bg-slate-900/70'
                            : 'border-l-slate-500 bg-slate-200/95'
                      } ${isDarkMode ? 'hover:bg-slate-800' : 'hover:bg-slate-200'}`}
                    >
                      <button
                        type="button"
                        onClick={() => onCompareSelectRemote(indi)}
                        className="flex-1 text-left py-2 flex items-center gap-2 overflow-hidden"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <div
                              className={`text-sm font-medium truncate flex-1 ${textClass}`}
                            >
                              {indi.givenName}{' '}
                              <span className="font-bold">{indi.surname}</span>
                              {isCal && (
                                <span
                                  className="ms-1.5 inline-block w-2 h-2 rounded-full bg-yellow-500 border border-black/40 align-middle"
                                  title={t('sidebar.labels.containsCalculatedDates')}
                                />
                              )}
                            </div>
                            {isProcessed && (
                              <span
                                className="shrink-0 inline-flex"
                                title={t('app.compare.listProcessedMarkTitle')}
                              >
                                <Check
                                  className="w-3.5 h-3.5 text-emerald-500"
                                  aria-label={t('app.compare.listProcessedMarkTitle')}
                                />
                              </span>
                            )}
                            <div className="opacity-70">{getSourceIcon(indi.source)}</div>
                          </div>
                          <div className={`text-xs truncate ${subTextClass}`}>
                            {safeYear(indi.birthDate?.year)} -{' '}
                            {safeYear(indi.deathDate?.year)}
                          </div>
                        </div>
                      </button>
                      <div className="w-10 shrink-0" aria-hidden />
                    </div>
                  );
                })
                ) : (
                  <div className={`px-3 py-4 text-center text-xs leading-snug ${subTextClass}`}>
                    {t('app.compare.waitingPeerGedcom')}
                  </div>
                )}
              </>
            ) : (
              filteredList.map((indi) => {
                const isNoneMode = selectedIdsFor2D?.has('__NONE__');
                const isAllMode = !selectedIdsFor2D || selectedIdsFor2D.size === 0;
                const isSelected2D = isNoneMode
                  ? false
                  : isAllMode
                    ? true
                    : selectedIdsFor2D.has(indi.id);

                const isCal =
                  indi.birthDate?.isCalculated || indi.deathDate?.isCalculated;

                return (
                  <div
                    key={indi.id}
                    id={`sidebar-item-${indi.id}`}
                    className={`w-full flex items-center gap-1 rounded-md px-1 transition-colors ${selectedId === indi.id ? (isDarkMode ? 'bg-slate-800' : 'bg-slate-200') : ''} ${itemHover}`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectIndividual(indi)}
                      className="flex-1 text-left py-2 flex items-center gap-3 overflow-hidden"
                    >
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold bg-opacity-20 shrink-0 relative ${
                          indi.gender === Gender.Female
                            ? 'bg-pink-500 text-pink-500'
                            : indi.gender === Gender.Male
                              ? 'bg-blue-500 text-blue-500'
                              : 'bg-slate-500 text-slate-500'
                        }`}
                      >
                        {indi.givenName?.[0]}
                        {indi.surname?.[0]}
                        {isCal && (
                          <div
                            className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-yellow-500 rounded-full border border-black shadow-sm"
                            title={t('sidebar.labels.containsCalculatedDates')}
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <div
                            className={`text-sm font-medium truncate flex-1 ${textClass}`}
                          >
                            {indi.givenName}{' '}
                            <span className="font-bold">{indi.surname}</span>
                          </div>
                          <div className="opacity-70">{getSourceIcon(indi.source)}</div>
                        </div>
                        <div className={`text-xs truncate ${subTextClass}`}>
                          {safeYear(indi.birthDate?.year)} -{' '}
                          {safeYear(indi.deathDate?.year)}
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggle2DSelection?.(indi.id);
                      }}
                      className={`p-2 rounded hover:bg-slate-500/10 ${isSelected2D ? 'text-blue-500' : 'text-slate-600'}`}
                      title={
                        isSelected2D
                          ? t('sidebar.labels.hideAll')
                          : t('sidebar.labels.showAll')
                      }
                    >
                      {isSelected2D ? (
                        <Eye className="w-4 h-4" />
                      ) : (
                        <EyeOff className="w-4 h-4 opacity-30" />
                      )}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Sidebar;

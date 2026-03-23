import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Upload, Search, Loader2, FileText, User as UserIcon, Globe, Eye, EyeOff, Sparkles, SlidersHorizontal, Check, Save } from 'lucide-react';
import { Individual, GedcomData, Gender, SortMode, FilterTag } from '../types';
import { parseGedcom } from '../services/gedcomParser';
import { getDemoGedcom } from '../services/demoData';
import { useI18n } from '../i18n';

/* ------------------------------------------------------------------ */
/*  Sort & Filter definitions                                          */
/* ------------------------------------------------------------------ */
const SORT_OPTIONS: { value: SortMode; key: string }[] = [
  { value: 'birth-desc', key: 'sidebar.sort.birthDesc' },
  { value: 'birth-asc',  key: 'sidebar.sort.birthAsc' },
  { value: 'death-desc', key: 'sidebar.sort.deathDesc' },
  { value: 'death-asc',  key: 'sidebar.sort.deathAsc' },
  { value: 'lifespan',   key: 'sidebar.sort.lifespan' },
  { value: 'name',       key: 'sidebar.sort.name' },
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

export function matchesFilters(
  indi: Individual,
  filters: Set<FilterTag>,
  context?: {
    selectedId?: string | null;
    lineageSets?: { ancestors: Set<string>; descendants: Set<string> };
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

export function applySortMode(list: Individual[], mode: SortMode): Individual[] {
  const sorted = [...list];
  switch (mode) {
    case 'name':
      return sorted.sort((a, b) => `${a.surname} ${a.givenName}`.localeCompare(`${b.surname} ${b.givenName}`));
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
  onImportBundle: (file: File) => Promise<void> | void;
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
  programUpdateState: 'idle' | 'checking' | 'available' | 'updating' | 'error' | 'unsupported';
  programVersionLabel: string;
  onProgramCheckUpdates: () => void;
  onProgramApplyUpdate: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
const Sidebar: React.FC<SidebarProps> = ({ 
  onDataLoaded, 
  onImportBundle,
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
  programUpdateState,
  programVersionLabel,
  onProgramCheckUpdates,
  onProgramApplyUpdate,
}) => {
  const { t } = useI18n();
  const [searchTerm, setSearchTerm] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [activePane, setActivePane] = useState<'program' | 'data' | 'list'>('data');
  const menuRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedId && isOpen) {
       setTimeout(() => {
           const element = document.getElementById(`sidebar-item-${selectedId}`);
           if (element) {
               element.scrollIntoView({ behavior: 'smooth', block: 'center' });
           }
       }, 50);
    }
  }, [selectedId, isOpen, sortMode, searchTerm]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);
  useEffect(() => {
    if (activePane === 'program') return;
    setActivePane(data ? 'list' : 'data');
  }, [data]);

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
        onDataLoaded(parseGedcom(text), fileName);
      } catch (err) {
        console.error(err);
        alert(t('sidebar.labels.importReadError'));
      } finally {
        onLoading(false);
        event.target.value = '';
      }
    }, 100);
  };

  const handleLoadDemo = () => {
      onLoading(true);
      setTimeout(() => {
          try {
            const demoData = getDemoGedcom();
            onDataLoaded(parseGedcom(demoData), "LifeThread Demo");
          } catch (e) {
            console.error("Demo load failed", e);
          } finally {
            onLoading(false);
          }
      }, 500);
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

  const filteredList = useMemo(() => {
    if (!data) return [];
    let list = Object.values(data.individuals) as Individual[];
    const lineageSets = computeLineageFilterSets(data, selectedId);

    if (activeFilters.size > 0) {
      list = list.filter(p => matchesFilters(p, activeFilters, { selectedId, lineageSets }));
    }

    const sorted = applySortMode(list, sortMode || 'birth-asc');

    if (!searchTerm) {
        const slice = sorted.slice(0, 200);
        if (selectedId && !slice.find(p => p.id === selectedId)) {
             const selectedItem = data.individuals[selectedId];
             if (selectedItem) slice.unshift(selectedItem);
        }
        return slice;
    }
    
    return sorted.filter(p => `${p.givenName} ${p.surname}`.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [data, searchTerm, sortMode, selectedId, activeFilters]);

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
      if (source === 'manual') return <span title={t('sidebar.labels.sourceManual')}><UserIcon className="w-3 h-3 text-green-500" /></span>;
      if (source === 'p2p') return <span title={t('sidebar.labels.sourceP2P')}><Globe className="w-3 h-3 text-purple-500" /></span>;
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
  const getProgramStatusText = (): string => {
    if (programUpdateState === 'available') return t('sidebar.program.available');
    if (programUpdateState === 'checking') return t('sidebar.program.checking');
    if (programUpdateState === 'updating') return t('sidebar.program.updating');
    if (programUpdateState === 'error') return t('sidebar.program.error');
    if (programUpdateState === 'unsupported') return t('sidebar.program.unsupported');
    return t('sidebar.program.upToDate');
  };
  const signalDot = (state: 'none' | 'attention' | 'running' | 'error') => {
    if (state === 'none') return null;
    const color =
      state === 'attention' ? 'bg-amber-500'
      : state === 'running' ? 'bg-cyan-500'
      : 'bg-rose-500';
    const pulse = state === 'attention' || state === 'running' ? 'animate-pulse' : '';
    return <span className={`inline-block w-2 h-2 rounded-full ${color} ${pulse}`} />;
  };
  const programSignal: 'none' | 'attention' | 'running' | 'error' =
    programUpdateState === 'available'
      ? 'attention'
      : programUpdateState === 'checking' || programUpdateState === 'updating'
      ? 'running'
      : programUpdateState === 'error'
      ? 'error'
      : 'none';
  const dataSignal: 'none' | 'attention' | 'running' | 'error' =
    autoSaveState === 'error'
      ? 'error'
      : isLoading || autoSaveState === 'saving'
      ? 'running'
      : (!data && hasAutoSaveDraft)
      ? 'attention'
      : 'none';
  const listSignal: 'none' | 'attention' | 'running' | 'error' = 'none';
  const globalSignal: 'none' | 'attention' | 'running' | 'error' =
    programSignal !== 'none' ? programSignal : dataSignal !== 'none' ? dataSignal : listSignal;

  return (
    <div 
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

      <div className={`p-2 border-b ${isDarkMode ? 'border-slate-800' : 'border-slate-300'} grid grid-cols-3 gap-1`}>
        {([
          { key: 'program', label: t('sidebar.tabs.program'), signal: programSignal },
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
                  accept=".lifethread.zip,.zip,application/zip"
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
      {activePane === 'list' && data && (
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
                  disabled={!data}
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
                <span>{t('sidebar.labels.records')} ({Object.keys(data.individuals).length})</span>
                <div className="flex items-center gap-2">
                  <span title={t('sidebar.labels.visibleIn2D')}>
                    2D: {selectedIdsFor2D && selectedIdsFor2D.size > 0 && !selectedIdsFor2D.has('__NONE__') 
                      ? `${selectedIdsFor2D.size}/${Object.keys(data.individuals).length}` 
                      : selectedIdsFor2D?.has('__NONE__') 
                        ? `0/${Object.keys(data.individuals).length}`
                        : `${t('sidebar.labels.all')} (${Object.keys(data.individuals).length})`}
                  </span>
                  {onClear2DSelection && onToggle2DSelection && data && (
                      <button 
                          onClick={() => {
                            const isHidingAll = selectedIdsFor2D?.has('__NONE__');
                            const hasSelection = selectedIdsFor2D && selectedIdsFor2D.size > 0 && !isHidingAll;
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
      <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar flex flex-col">
        {activePane === 'program' ? (
          <div className="p-4 space-y-3">
            <div className={`text-xs font-bold uppercase tracking-wider ${subTextClass}`}>{t('sidebar.program.title')}</div>
            <div className={`rounded border p-3 space-y-2 ${inputBg}`}>
              <div className={`text-xs ${subTextClass}`}>{t('sidebar.program.version')}: <span className={textClass}>{programVersionLabel}</span></div>
              <div className={`text-xs ${subTextClass}`}>{t('sidebar.program.updateStatus')}: <span className={textClass}>{getProgramStatusText()}</span></div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onProgramCheckUpdates}
                  className={`flex-1 py-1.5 rounded text-xs font-semibold border ${buttonImportClass}`}
                >
                  {t('sidebar.program.check')}
                </button>
                {programUpdateState === 'available' && (
                  <button
                    type="button"
                    onClick={onProgramApplyUpdate}
                    className={`flex-1 py-1.5 rounded text-xs font-semibold border ${buttonImportClass}`}
                  >
                    {t('sidebar.program.apply')}
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : activePane === 'data' ? (
          !data ? (
            <div className={`p-4 text-sm ${subTextClass}`}>
              <p>{t('sidebar.labels.noDatabaseLoaded')}</p>
              <div className="mt-2 flex flex-col gap-1">
                <span className="opacity-70 text-xs">{t('sidebar.labels.noGedcom')}</span>
                <button
                  onClick={handleLoadDemo}
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
        ) : !data ? (
          <div className={`p-4 text-sm ${subTextClass}`}>
            <p>{t('sidebar.labels.noDatabaseLoaded')}</p>
            <div className="mt-2 flex flex-col gap-1">
                 <span className="opacity-70 text-xs">{t('sidebar.labels.noGedcom')}</span>
                 <button 
                    onClick={handleLoadDemo} 
                    className="text-left text-blue-500 hover:text-blue-400 hover:underline font-bold text-xs"
                    disabled={isLoading}
                 >
                    {t('sidebar.labels.tryDemo')}
                 </button>
            </div>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {filteredList.map((indi) => {
              const isNoneMode = selectedIdsFor2D?.has('__NONE__');
              const isAllMode = !selectedIdsFor2D || selectedIdsFor2D.size === 0;
              const isSelected2D = isNoneMode ? false : (isAllMode ? true : selectedIdsFor2D.has(indi.id));
              
              const isCal = indi.birthDate?.isCalculated || indi.deathDate?.isCalculated;

              return (
              <div 
                key={indi.id} 
                id={`sidebar-item-${indi.id}`}
                className={`w-full flex items-center gap-1 rounded-md px-1 transition-colors ${selectedId === indi.id ? (isDarkMode ? 'bg-slate-800' : 'bg-slate-200') : ''} ${itemHover}`}
              >
                  <button
                    onClick={() => onSelectIndividual(indi)}
                    className="flex-1 text-left py-2 flex items-center gap-3 overflow-hidden"
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold bg-opacity-20 shrink-0 relative ${
                      indi.gender === 'F' ? 'bg-pink-500 text-pink-500' : 'bg-blue-500 text-blue-500'
                    }`}>
                      {indi.givenName?.[0]}{indi.surname?.[0]}
                      {isCal && <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-yellow-500 rounded-full border border-black shadow-sm" title={t('sidebar.labels.containsCalculatedDates')} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                          <div className={`text-sm font-medium truncate flex-1 ${textClass}`}>
                            {indi.givenName} <span className="font-bold">{indi.surname}</span>
                          </div>
                          <div className="opacity-70">
                            {getSourceIcon(indi.source)}
                          </div>
                      </div>
                      <div className={`text-xs truncate ${subTextClass}`}>
                        {safeYear(indi.birthDate?.year)} - {safeYear(indi.deathDate?.year)}
                      </div>
                    </div>
                  </button>

                  <button 
                     onClick={(e) => { e.stopPropagation(); onToggle2DSelection?.(indi.id); }}
                     className={`p-2 rounded hover:bg-slate-500/10 ${isSelected2D ? 'text-blue-500' : 'text-slate-600'}`}
                     title={isSelected2D ? t('sidebar.labels.hideAll') : t('sidebar.labels.showAll')}
                  >
                     {isSelected2D ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4 opacity-30" />}
                  </button>
              </div>
            )})}
          </div>
        )}
      </div>
    </div>
  );
};

export default Sidebar;

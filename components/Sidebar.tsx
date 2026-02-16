import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Upload, Search, Loader2, FileText, User as UserIcon, Globe, Calendar, ArrowUpDown, Eye, EyeOff, ArrowUp, ArrowDown, Sparkles } from 'lucide-react';
import { Individual, GedcomData, SortMode } from '../types';
import { parseGedcom } from '../services/gedcomParser';
import { getDemoGedcom } from '../services/demoData';

interface SidebarProps {
  onDataLoaded: (data: GedcomData, name?: string) => void;
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
  
  // Normalization
  isNormalized: boolean;
  onToggleNormalization: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ 
  onDataLoaded, 
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
  isNormalized,
  onToggleNormalization,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to selected item
  useEffect(() => {
    if (selectedId && isOpen) {
       // Small delay to allow rendering if list changed
       setTimeout(() => {
           const element = document.getElementById(`sidebar-item-${selectedId}`);
           if (element) {
               element.scrollIntoView({ behavior: 'smooth', block: 'center' });
           }
       }, 50);
    }
  }, [selectedId, isOpen, sortMode, searchTerm]);

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
        alert("Error reading file.");
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

  const filteredList = useMemo(() => {
    if (!data) return [];
    const list = Object.values(data.individuals) as Individual[];
    
    // Sort logic (Global)
    const sorted = list.sort((a, b) => {
      if (sortMode === 'name') {
        const nameA = `${a.surname} ${a.givenName}`;
        const nameB = `${b.surname} ${b.givenName}`;
        return nameA.localeCompare(nameB);
      } else {
        // Sort logic ALIGNED with Scene2D: Date First, then Generation
        const isAsc = sortMode === 'birth-asc';

        // 1. Date
        const dateA = a.birthDate?.year ?? -99999;
        const dateB = b.birthDate?.year ?? -99999;
        if (dateA !== dateB) {
            return isAsc ? dateA - dateB : dateB - dateA;
        }

        // 2. Generation (Fallback)
        const genA = a.generation ?? 0;
        const genB = b.generation ?? 0;
        if (genA !== genB) {
            return isAsc ? genA - genB : genB - genA;
        }

        return (a.givenName || '').localeCompare(b.givenName || '');
      }
    });

    if (!searchTerm) {
        // Optimization: Render only 200 items max
        // BUG FIX: If the selected ID is beyond 200, we MUST include it otherwise 
        // the list doesn't show the active selection, breaking the visual sync.
        const slice = sorted.slice(0, 200);
        if (selectedId && !slice.find(p => p.id === selectedId)) {
             const selectedItem = data.individuals[selectedId];
             if (selectedItem) slice.unshift(selectedItem); // Force insert at top
        }
        return slice;
    }
    
    return sorted.filter(p => `${p.givenName} ${p.surname}`.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [data, searchTerm, sortMode, selectedId]);

  // Styles
  const bgClass = isDarkMode ? 'bg-black border-slate-800' : 'bg-slate-50 border-slate-300';
  const textClass = isDarkMode ? 'text-slate-200' : 'text-slate-800';
  const subTextClass = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  const itemHover = isDarkMode ? 'hover:bg-neutral-900' : 'hover:bg-white hover:shadow-sm';
  const inputBg = isDarkMode ? 'bg-neutral-900 border-slate-700' : 'bg-white border-slate-300';
  const buttonImportClass = isDarkMode 
    ? 'bg-neutral-800 hover:bg-neutral-700 border-slate-700' 
    : 'bg-white hover:bg-slate-100 border-slate-300';
  
  const sortBtnActive = isDarkMode ? 'bg-slate-700 text-white border-slate-600' : 'bg-slate-300 text-slate-900 border-slate-400';
  const sortBtnDefault = isDarkMode ? 'border-slate-700 hover:bg-slate-800 text-slate-400' : 'border-slate-300 hover:bg-slate-200 text-slate-600';

  // Tab Handle Styles
  const handleBg = isDarkMode 
    ? 'bg-black text-slate-400 border-slate-800 hover:bg-neutral-900' 
    : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-50';

  const getSourceIcon = (source?: string) => {
      if (source === 'manual') return <span title="Manual Entry"><UserIcon className="w-3 h-3 text-green-500" /></span>;
      if (source === 'p2p') return <span title="P2P Network"><Globe className="w-3 h-3 text-purple-500" /></span>;
      return <span title="Imported GEDCOM"><FileText className="w-3 h-3 text-slate-500" /></span>;
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

  const handleSortDateClick = () => {
     if (!onSetSortMode) return;
     if (sortMode === 'birth-desc') {
         onSetSortMode('birth-asc');
     } else {
         // Default or from name -> Descending (Newest first)
         onSetSortMode('birth-desc');
     }
  };

  return (
    <div 
      className={`absolute left-0 top-0 bottom-0 w-80 ${bgClass} border-r flex flex-col shadow-xl ${isOpen ? 'z-[130]' : 'z-[120]'} transition-transform duration-300 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {isDarkMode && <style>{scrollbarStyle}</style>}

      {/* Side Handle (Tab) */}
      <button 
         onClick={onToggle}
         className={`absolute top-1/2 right-0 translate-x-full -translate-y-1/2 origin-left py-8 px-3 rounded-r-xl border-y border-r border-l-0 ${handleBg} flex items-center justify-center shadow-md`}
      >
        <span className="[writing-mode:vertical-rl] rotate-180 text-xs font-bold uppercase tracking-widest whitespace-nowrap">
            Families
        </span>
      </button>

      {/* Header (Import & Normalization) */}
      <div className={`p-4 border-b ${isDarkMode ? 'border-slate-800' : 'border-slate-300'} space-y-3`}>
        <label className={`w-full flex items-center justify-center px-4 py-2 border rounded-md cursor-pointer transition-colors ${buttonImportClass} ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}>
          {isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
          <span className={`text-sm font-medium ${textClass}`}>
            {isLoading ? 'Importing...' : 'Import GEDCOM'}
          </span>
          <input type="file" accept=".ged" onChange={handleFileUpload} className="hidden" disabled={isLoading} />
        </label>
        
        {/* Normalization Toggle */}
        {data && (
            <button 
                onClick={onToggleNormalization}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md border transition-all ${
                    isNormalized 
                    ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-500' 
                    : `${isDarkMode ? 'bg-neutral-900 border-slate-700 text-slate-400' : 'bg-white border-slate-300 text-slate-500'}`
                }`}
                title={isNormalized ? "View Original Data" : "Calculate Missing Dates"}
            >
                <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-wider">
                        {isNormalized ? "Normalized (CAL)" : "Original Data"}
                    </span>
                </div>
                <div className={`w-8 h-4 rounded-full p-0.5 flex transition-colors ${isNormalized ? 'bg-yellow-500' : 'bg-slate-600'}`}>
                    <div className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${isNormalized ? 'translate-x-4' : 'translate-x-0'}`} />
                </div>
            </button>
        )}

        {/* P2P section moved to TopPanel */}
      </div>

      {/* Search & Sort & Header - Fixed at Top */}
      {data && (
        <div className={`flex flex-col border-b ${isDarkMode ? 'border-slate-800' : 'border-slate-300'}`}>
            <div className="p-4 space-y-3 pb-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="text" 
                  placeholder="Search individuals..." 
                  className={`w-full rounded-md pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-slate-500 border ${inputBg} ${textClass}`}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  disabled={!data}
                />
              </div>
              {onSetSortMode && (
                <div className="flex gap-2">
                    <button 
                      onClick={handleSortDateClick}
                      className={`flex-1 flex items-center justify-center gap-2 px-2 py-1.5 rounded text-xs border transition-colors ${sortMode?.includes('birth') ? sortBtnActive : sortBtnDefault}`}
                    >
                      <Calendar className="w-3 h-3" /> 
                      Sort Date
                      {sortMode === 'birth-asc' && <ArrowUp className="w-3 h-3" />}
                      {sortMode === 'birth-desc' && <ArrowDown className="w-3 h-3" />}
                    </button>
                    <button 
                      onClick={() => onSetSortMode('name')}
                      className={`flex-1 flex items-center justify-center gap-2 px-2 py-1.5 rounded text-xs border transition-colors ${sortMode === 'name' ? sortBtnActive : sortBtnDefault}`}
                    >
                      <ArrowUpDown className="w-3 h-3" /> Sort Name
                    </button>
                </div>
              )}
            </div>

            {/* FIXED Header for Records & Selection */}
            <div className={`px-4 py-2 bg-opacity-50 ${isDarkMode ? 'bg-black/20' : 'bg-slate-100/50'} flex justify-between items-center text-xs font-semibold uppercase tracking-wider ${subTextClass} border-t ${isDarkMode ? 'border-slate-800' : 'border-slate-200'}`}>
                <span>Records ({Object.keys(data.individuals).length})</span>
                <div className="flex items-center gap-2">
                  <span title="Visible in 2D View">
                    2D: {selectedIdsFor2D && selectedIdsFor2D.size > 0 && !selectedIdsFor2D.has('__NONE__') 
                      ? `${selectedIdsFor2D.size}/${Object.keys(data.individuals).length}` 
                      : selectedIdsFor2D?.has('__NONE__') 
                        ? `0/${Object.keys(data.individuals).length}`
                        : `All (${Object.keys(data.individuals).length})`}
                  </span>
                  {onClear2DSelection && onToggle2DSelection && data && (
                      <button 
                          onClick={() => {
                            // Detect current state
                            const isHidingAll = selectedIdsFor2D?.has('__NONE__');
                            const hasSelection = selectedIdsFor2D && selectedIdsFor2D.size > 0 && !isHidingAll;
                            const isShowingAll = !selectedIdsFor2D || selectedIdsFor2D.size === 0;
                            
                            if (isHidingAll) {
                              // None mode → Show All
                              onClear2DSelection(); // Clear to show all
                            } else if (isShowingAll) {
                              // All mode → Hide All  
                              onToggle2DSelection('__NONE__');
                            } else {
                              // Filtered mode → Show All
                              onClear2DSelection();
                            }
                          }}
                          className={`transition-colors flex items-center gap-1 hover:text-blue-500`}
                          title={selectedIdsFor2D?.has('__NONE__') ? "Show All" : "Hide All"}
                      >
                          {selectedIdsFor2D?.has('__NONE__') ? (
                            <>
                              <EyeOff className="w-3 h-3 text-red-500" />
                              <span className="hidden sm:inline text-[9px] text-red-500">None</span>
                            </>
                          ) : (
                            <>
                              <Eye className="w-3 h-3 text-blue-500" />
                              <span className="hidden sm:inline text-[9px] text-blue-500">All</span>
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
        {!data ? (
          <div className={`flex-1 flex flex-col items-center justify-center text-sm ${subTextClass}`}>
            <p>No database loaded.</p>
            <div className="mt-4 flex flex-col items-center gap-1">
                 <span className="opacity-70 text-xs">No GEDCOM?</span>
                 <button 
                    onClick={handleLoadDemo} 
                    className="text-blue-500 hover:text-blue-400 hover:underline font-bold text-xs"
                    disabled={isLoading}
                 >
                    try a demo
                 </button>
            </div>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {filteredList.map((indi) => {
              // Determine if individual is visible in 2D
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
                      {isCal && <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-yellow-500 rounded-full border border-black shadow-sm" title="Contains Calculated Dates" />}
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

                  {/* 2D Toggle */}
                  <button 
                     onClick={(e) => { e.stopPropagation(); onToggle2DSelection?.(indi.id); }}
                     className={`p-2 rounded hover:bg-slate-500/10 ${isSelected2D ? 'text-blue-500' : 'text-slate-600'}`}
                     title={isSelected2D ? "Hide in 2D View" : "Show in 2D View"}
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
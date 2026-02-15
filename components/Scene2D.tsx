import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Individual, GedcomData, Gender, SortMode } from '../types';

interface Scene2DProps {
  data: GedcomData | null;
  selectedId?: string | null;
  selectedIds?: Set<string>;
  onIndividualClick: (indi: Individual) => void;
  onToggleSelection?: (id: string) => void;
  onExpandFamily?: (id: string, direction: 'ancestors' | 'descendants') => void;
  isDarkMode: boolean;
  sortMode?: SortMode;
  leftPanelOpen?: boolean;
  rightPanelOpen?: boolean;
}

// Reduced vertical scale by 20% (was 4)
const PIXELS_PER_YEAR = 3.2;
const DEFAULT_LIFESPAN = 80;
const CURRENT_YEAR = new Date().getFullYear();
const DEFAULT_PARENT_AGE_AT_BIRTH = 25;

const Scene2D: React.FC<Scene2DProps> = ({ 
  data, 
  selectedId, 
  selectedIds, 
  onIndividualClick, 
  onToggleSelection, 
  onExpandFamily, 
  isDarkMode, 
  sortMode = 'birth-asc', // Default to Ascending (Old -> New)
  leftPanelOpen = false,
  rightPanelOpen = false
}) => {
  // Pan & Zoom State
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const lastMousePos = useRef({ x: 0, y: 0 });
  const hasCentered = useRef(false);
  
  // Track viewport size for grid culling
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const updateSize = () => {
        if (viewportRef.current) {
            setViewportSize({
                width: viewportRef.current.clientWidth,
                height: viewportRef.current.clientHeight
            });
        }
    };
    window.addEventListener('resize', updateSize);
    updateSize();
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // --- Data Preparation ---
  const { individuals, minYear, maxYear } = useMemo(() => {
    if (!data) return { individuals: [], minYear: 1900, maxYear: 2024 };

    const allIndividuals = Object.values(data.individuals) as Individual[];

    const list = allIndividuals.filter(indi => {
        // If no selection, show ALL
        if (!selectedIds || selectedIds.size === 0) {
          return true;
        }
        // If "__NONE__" is selected, hide all (show nothing)
        if (selectedIds.has('__NONE__')) {
          return false;
        }
        // Otherwise filter by selection
        const isSelectedFor2D = selectedIds.has(indi.id);
        const isManual = indi.source === 'manual';
        return isSelectedFor2D || isManual;
    });
    
    let minY = 2000;
    let maxY = 1800;
    
    if (list.length > 0) {
        list.forEach(i => {
           const b = i.birthDate?.year;
           const d = i.deathDate?.year;
           if (b && b < minY) minY = b;
           if (b && b > maxY) maxY = b; 
           if (d && d > maxY) maxY = d;
        });
        minY -= 10;
        maxY = Math.max(maxY, CURRENT_YEAR) + 10;
    } else {
        minY = 1900;
        maxY = CURRENT_YEAR + 10;
    }

    const sortedList = [...list].sort((a, b) => {
      if (sortMode === 'name') {
        const nameA = `${a.surname} ${a.givenName}`;
        const nameB = `${b.surname} ${b.givenName}`;
        return nameA.localeCompare(nameB);
      } else {
         // Determine Sort Direction
         const isAsc = sortMode === 'birth-asc';
         
         // 1. Primary Sort: Date
         // Treat undefined dates as "Ancient" (-99999) to group them with Ancestors (Left)
         const dateA = a.birthDate?.year ?? -99999;
         const dateB = b.birthDate?.year ?? -99999;
         
         if (dateA !== dateB) {
             return isAsc ? dateA - dateB : dateB - dateA;
         }
         
         // 2. Secondary Sort: Generation (Fallback)
         const genA = a.generation ?? 0;
         const genB = b.generation ?? 0;
         if (genA !== genB) {
             return isAsc ? genA - genB : genB - genA;
         }

         // 3. Tertiary Sort: Name
         return (a.givenName || '').localeCompare(b.givenName || '');
      }
    });

    return { individuals: sortedList, minYear: minY, maxYear: maxY };
  }, [data, sortMode, selectedIds, selectedId]);

  // Reset centering flag when individuals list changes (for re-centering after expansion)
  useEffect(() => {
      hasCentered.current = false;
  }, [individuals.length]);

  // --- Auto Center (WITHOUT changing scale) ---
  useEffect(() => {
      if (individuals.length > 0 && !hasCentered.current && containerRef.current) {
          const wrapperWidth = containerRef.current.parentElement?.clientWidth || 0;
          const wrapperHeight = containerRef.current.parentElement?.clientHeight || 0;
          
          const contentWidth = individuals.length * 28; 
          const totalHeight = (maxYear - minYear) * PIXELS_PER_YEAR;
          
          const startX = (wrapperWidth - contentWidth) / 2 + 50; 
          const startY = -(totalHeight / 2) + (wrapperHeight / 2);
          
          setTranslate({ x: startX, y: startY });
          // DON'T reset scale - keep user's zoom level
          hasCentered.current = true;
      }
  }, [individuals.length, maxYear, minYear]);

  // --- Pan & Zoom Handlers ---
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomIntensity = 0.001;
    const delta = -e.deltaY * zoomIntensity;
    const newScale = Math.min(Math.max(0.1, scale * (1 + delta)), 5);
    
    const worldX = (mouseX) / scale;
    const worldY = (mouseY) / scale;
    
    const newTx = mouseX - worldX * newScale;
    const newTy = mouseY - worldY * newScale;

    const scaleRatio = newScale / scale;
    const finalTx = e.clientX - (e.clientX - translate.x) * scaleRatio;
    const finalTy = e.clientY - (e.clientY - translate.y) * scaleRatio;
    
    setScale(newScale);
    setTranslate({ x: finalTx, y: finalTy });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsPanning(true);
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    const dx = e.clientX - lastMousePos.current.x;
    const dy = e.clientY - lastMousePos.current.y;
    setTranslate(prev => ({ x: prev.x + dx, y: prev.y + dy }));
    lastMousePos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  if (!data) return <div className="flex items-center justify-center h-full opacity-50">No Data</div>;
  
  // Warning for large databases
  const showPerformanceWarning = individuals.length > 5000;

  const totalHeight = (maxYear - minYear) * PIXELS_PER_YEAR;

  // Styles
  const bgClass = isDarkMode ? 'bg-black' : 'bg-slate-50';
  
  // UPDATED COLORS for better visibility
  const gridLineClass = isDarkMode ? 'border-slate-500' : 'border-slate-300';
  const gridOpacity = isDarkMode ? 'opacity-60' : 'opacity-100';
  const yearLabelClass = isDarkMode ? 'text-slate-200' : 'text-slate-500';
  
  const labelBg = isDarkMode ? 'bg-black/80 border-white/20' : 'bg-white/95 border-slate-300 shadow-sm';
  const labelText = isDarkMode ? 'text-white' : 'text-slate-900';
  const labelSubText = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  const containerHover = isDarkMode ? 'hover:bg-white/5' : 'hover:bg-black/5';
  const containerSelected = isDarkMode 
      ? 'bg-white/10 ring-1 ring-white/50' 
      : 'bg-black/5 ring-1 ring-black/30';

  // Dynamic Padding based on Sidebar state
  const leftPad = leftPanelOpen ? 'pl-[340px]' : 'pl-6';
  const rightPad = rightPanelOpen ? 'pr-[340px]' : 'pr-6';

  // Format date helper
  const formatYear = (precise?: number, raw?: number | null) => {
      if (raw !== undefined && raw !== null) return raw.toString();
      if (precise !== undefined) return Math.floor(precise).toString();
      return "?";
  };

  // --- GRID CALCULATION ---
  // We calculate visible years based on scale/translate to render optimization
  const gridLines: React.ReactNode[] = [];
  if (viewportSize.height > 0) {
      // Logic: 
      // visualY = ((maxYear - year) * PIXELS_PER_YEAR * scale) + translate.y
      // We invert this to find the year range visible on screen (0 to height)
      
      const contentYTop = -translate.y / scale;
      const contentYBottom = (viewportSize.height - translate.y) / scale;

      const yearHigh = maxYear - (contentYTop / PIXELS_PER_YEAR);
      const yearLow = maxYear - (contentYBottom / PIXELS_PER_YEAR);

      const startYear = Math.min(maxYear, Math.ceil(yearHigh / 10) * 10 + 10);
      const endYear = Math.max(minYear, Math.floor(yearLow / 10) * 10 - 10);

      for (let y = startYear; y >= endYear; y -= 10) {
          // Calculate visual position directly (Overlay mode)
          const contentTop = (maxYear - y) * PIXELS_PER_YEAR;
          const visualTop = (contentTop * scale) + translate.y;
          
          gridLines.push(
              <div 
                  key={y} 
                  className={`absolute w-full border-t ${gridLineClass} ${gridOpacity} flex justify-between items-center`} 
                  style={{ top: `${visualTop}px` }}
              >
                  <span className={`${leftPad} text-xs font-mono font-bold ${yearLabelClass} transition-all duration-300`}>{y}</span>
                  <span className={`${rightPad} text-xs font-mono font-bold ${yearLabelClass} transition-all duration-300`}>{y}</span>
              </div>
          );
      }
  }

  return (
    <div 
        ref={viewportRef}
        className={`w-full h-full flex flex-col ${bgClass} overflow-hidden relative cursor-${isPanning ? 'grabbing' : 'grab'}`}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
    >
      {/* 1. Grid Overlay (Fixed to Viewport, but synchronized via math) */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
         {gridLines}
      </div>

      {/* 2. Scalable Content (Individuals) */}
      <div 
        ref={containerRef}
        className="flex-1 relative origin-top-left z-10"
        style={{
            transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
            transition: isPanning ? 'none' : 'transform 0.1s ease-out'
        }}
      >
        <div className="absolute top-0 left-0 min-w-full" style={{ height: `${totalHeight + 100}px`, width: '2000px' }}>
           
           {/* REMOVED pt-4 from here to fix 4-year misalignment with grid */}
           <div className="absolute top-0 left-12 right-0 bottom-0 flex px-4 gap-1 pb-20">
              {individuals.map((indi) => {
                 // 1. Dates
                 let realBirth = indi.birthDate?.preciseDate ?? indi.birthDate?.year;
                 let realDeath = indi.deathDate?.preciseDate ?? indi.deathDate?.year;

                 // Ensure we handle explicit nulls or undefined
                 if (realBirth === null) realBirth = undefined;
                 if (realDeath === null) realDeath = undefined;

                 // Fallbacks for display bar ONLY
                 let displayBirth = realBirth;
                 let displayDeath = realDeath;

                 if (displayBirth === undefined && displayDeath === undefined) { 
                     displayBirth = minYear + 10; 
                     displayDeath = minYear + 10 + DEFAULT_LIFESPAN; 
                 }
                 else if (displayBirth === undefined && displayDeath !== undefined) { 
                     displayBirth = displayDeath - DEFAULT_LIFESPAN; 
                 }
                 else if (displayBirth !== undefined && displayDeath === undefined) { 
                     displayDeath = displayBirth + DEFAULT_LIFESPAN; 
                 } 

                 // Bar Coordinates
                 const barTopY = (maxYear - displayDeath!) * PIXELS_PER_YEAR;
                 const barBottomY = (maxYear - displayBirth!) * PIXELS_PER_YEAR;
                 const barHeight = Math.max(barBottomY - barTopY, 2);

                 const isFemale = indi.gender === Gender.Female;
                 const barColor = isFemale ? 'bg-pink-300' : (indi.gender === Gender.Male ? 'bg-blue-300' : 'bg-slate-400');
                 const isSelected = selectedId === indi.id;
                 
                 // Gradient Mask
                 let maskImage = 'none';
                 if (realBirth === undefined && realDeath === undefined) {
                     maskImage = 'linear-gradient(to bottom, transparent 0%, black 20%, black 80%, transparent 100%)';
                 } else if (realBirth === undefined) {
                     maskImage = 'linear-gradient(to bottom, black 0%, black 80%, transparent 100%)';
                 } else if (realDeath === undefined) {
                     maskImage = 'linear-gradient(to bottom, transparent 0%, black 20%, black 100%)';
                 }

                 // --- 2. Markers (Absolute to container, NOT bar) ---
                 const eventMarkers: React.ReactElement[] = [];

                 // Birth Marker (Visual only if known)
                 if (realBirth !== undefined) {
                     const birthTop = (maxYear - realBirth) * PIXELS_PER_YEAR;
                     eventMarkers.push(
                         <div 
                           key="birth" 
                           onClick={(e) => {
                              e.stopPropagation();
                              // Toggle Parents (Ancestors)
                              if (data && indi.familyChildId && onToggleSelection) {
                                  const family = data.families[indi.familyChildId];
                                  if (family) {
                                      if (family.husbandId) onToggleSelection(family.husbandId);
                                      if (family.wifeId) onToggleSelection(family.wifeId);
                                  }
                              }
                           }}
                           title={`Birth: ${formatYear(realBirth, indi.birthDate?.year)}`}
                           // Centered on the exact pixel (-bottom-[2px] relative to position)
                           // CHANGED: Use Pink-500 / Blue-500 to match child traits exactly
                           className={`absolute -left-[4px] -right-[4px] h-[4px] ${isFemale ? 'bg-pink-500' : 'bg-blue-500'} rounded-sm z-20 cursor-pointer`} 
                           style={{ top: `${birthTop}px`, marginTop: '-2px' }}
                         />
                     );
                 }

                 // --- Expansion Arrows (ALWAYS VISIBLE) ---
                 // Position based on estimated displayBirth if realBirth is missing
                 const expansionTop = (maxYear - displayBirth!) * PIXELS_PER_YEAR;
                 eventMarkers.push(
                     <div 
                         key="expand-arrows"
                         className={`absolute w-full flex justify-between z-30 pointer-events-none`}
                         style={{ top: `${expansionTop}px`, marginTop: '3px' }}
                     >
                        <div 
                            onClick={(e) => { e.stopPropagation(); onExpandFamily?.(indi.id, 'ancestors'); }}
                            className="pointer-events-auto cursor-pointer px-1 text-[8px] font-bold text-slate-500 hover:text-blue-500 hover:scale-125 transition-all select-none"
                            title="Show all Ancestors"
                        >
                            &lt;
                        </div>
                        <div 
                            onClick={(e) => { e.stopPropagation(); onExpandFamily?.(indi.id, 'descendants'); }}
                            className="pointer-events-auto cursor-pointer px-1 text-[8px] font-bold text-slate-500 hover:text-blue-500 hover:scale-125 transition-all select-none"
                            title="Show all Descendants"
                        >
                            &gt;
                        </div>
                     </div>
                 );

                 // Death Marker
                 if (realDeath !== undefined) {
                     const deathTop = (maxYear - realDeath) * PIXELS_PER_YEAR;
                     eventMarkers.push(
                         <div 
                           key="death" 
                           title={`Death: ${formatYear(realDeath, indi.deathDate?.year)}`}
                           className={`absolute -left-[2px] -right-[2px] h-[4px] ${isDarkMode ? 'bg-black' : 'bg-slate-800'} z-20 cursor-pointer`} 
                           style={{ top: `${deathTop}px`, marginTop: '-2px' }}
                         />
                     );
                 }

                 if (indi.familySpouseIds) {
                    indi.familySpouseIds.forEach((famId, famIndex) => {
                       const family = data.families[famId];
                       if (family) {
                          let mDate = family.marriageDate?.preciseDate ?? family.marriageDate?.year;
                          if (!mDate) {
                             if (family.childrenIds && family.childrenIds.length > 0) {
                                const firstChild = data.individuals[family.childrenIds[0]];
                                const fcDate = firstChild?.birthDate?.preciseDate ?? firstChild?.birthDate?.year;
                                if (fcDate) mDate = fcDate - 1;
                             }
                             if (!mDate && displayBirth !== undefined) {
                                mDate = displayBirth + 22 + (famIndex * 2);
                             }
                          }
                          
                          if (mDate !== undefined && mDate !== null) {
                              const marrTop = (maxYear - mDate) * PIXELS_PER_YEAR;
                              
                              // Calculate Spouse Name for Tooltip
                              const spouseId = family.husbandId === indi.id ? family.wifeId : family.husbandId;
                              const spouse = spouseId ? data.individuals[spouseId] : null;
                              const spouseName = spouse ? spouse.givenName : '?';
                              
                              eventMarkers.push(
                                 <div 
                                   key={`marr-${famId}`}
                                   className={`absolute -left-[4px] -right-[4px] h-[3px] z-10 ${isDarkMode ? 'bg-white' : 'bg-slate-300'} hover:bg-yellow-400 cursor-pointer`}
                                   style={{ top: `${marrTop}px`, transform: 'translateY(-50%)' }}
                                   title={`Union: ${spouseName} ${formatYear(mDate, family.marriageDate?.year)}`}
                                 />
                              );
                          }

                          if (family.childrenIds) {
                             family.childrenIds.forEach((childId, childIdx) => {
                                const child = data.individuals[childId];
                                if (child) {
                                   let cDate = child.birthDate?.preciseDate ?? child.birthDate?.year;
                                   if (!cDate && displayBirth !== undefined) cDate = displayBirth + DEFAULT_PARENT_AGE_AT_BIRTH + (childIdx * 2);
                                   
                                   if (cDate !== undefined && cDate !== null) {
                                       const childTop = (maxYear - cDate) * PIXELS_PER_YEAR;
                                       const childColor = child.gender === Gender.Female ? 'bg-pink-500' : 'bg-blue-500';
                                       
                                       eventMarkers.push(
                                         <div 
                                            key={`child-${childId}`}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                // Toggle Child (Descendant)
                                                if (onToggleSelection) {
                                                    onToggleSelection(childId);
                                                }
                                            }}
                                            className={`absolute h-[3px] w-[6px] -right-[3px] z-20 ${childColor} border-[0.5px] border-black/20 cursor-pointer`}
                                            style={{ top: `${childTop}px`, transform: 'translateY(-50%)' }}
                                            title={`${child.givenName} ${formatYear(cDate, child.birthDate?.year)}`}
                                         />
                                       );
                                   }
                                }
                             });
                          }
                       }
                    });
                 }

                 return (
                   <div 
                      key={indi.id} 
                      className={`relative w-6 min-w-[1.5rem] h-full group flex flex-col items-center transition-colors rounded ${isSelected ? containerSelected : containerHover}`}
                      onClick={(e) => { e.stopPropagation(); onIndividualClick(indi); }}
                    >
                      {/* Lifespan Bar */}
                      <div 
                        className={`absolute w-full px-1 ${barColor} bg-clip-content opacity-90 group-hover:opacity-100 transition-opacity cursor-pointer ${isSelected ? 'opacity-100 shadow-[0_0_10px_rgba(255,255,255,0.3)]' : ''}`}
                        style={{ 
                            top: `${barTopY}px`, 
                            height: `${barHeight}px`,
                            WebkitMaskImage: maskImage,
                            maskImage: maskImage
                        }}
                      />
                      
                      {/* Markers rendered OUTSIDE masked bar to ensure visibility */}
                      {eventMarkers}

                      {/* Name Label */}
                      <div 
                        className={`absolute left-full ml-1 px-2 py-0.5 rounded ${labelBg} backdrop-blur-sm border whitespace-nowrap z-50 pointer-events-none transition-all duration-200 ${isSelected ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0'}`}
                        style={{ 
                          top: `${barTopY + barHeight/2}px`,
                          transform: 'translateY(-50%)' 
                        }}
                      >
                         <span className={`font-bold text-[10px] ${labelText}`}>{indi.givenName} {indi.surname}</span>
                         <span className={`block text-[8px] ${labelSubText}`}>{formatYear(realBirth, indi.birthDate?.year)} - {formatYear(realDeath, indi.deathDate?.year)}</span>
                      </div>
                   </div>
                 );
              })}
           </div>
        </div>
      </div>
      
      {showPerformanceWarning && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-yellow-500/90 text-black px-4 py-2 rounded text-xs font-bold z-50 max-w-md text-center shadow-lg">
          ⚠️ Large database ({individuals.length} individuals displayed)<br/>
          2D view may be slow. Click "3D" button (top) for better performance with large datasets.
        </div>
      )}
      
      <div className="absolute bottom-4 right-4 flex flex-col gap-2 z-50">
         <div className={`px-2 py-1 rounded text-xs font-bold ${isDarkMode ? 'bg-black/80 text-white' : 'bg-white/80 text-black'} border border-slate-500`}>
             {(scale * 100).toFixed(0)}%
         </div>
      </div>
    </div>
  );
};

export default Scene2D;
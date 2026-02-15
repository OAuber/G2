import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { Individual, GedcomData, Gender, SortMode } from '../types';

interface Scene2DCanvasProps {
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

// Constants (same as Scene2D)
const PIXELS_PER_YEAR = 3.2;
const DEFAULT_LIFESPAN = 80;
const CURRENT_YEAR = new Date().getFullYear();
const DEFAULT_PARENT_AGE_AT_BIRTH = 25;
const INDIVIDUAL_WIDTH = 24;
const INDIVIDUAL_GAP = 4;

interface InteractiveRegion {
  id: string;
  individualId: string;
  type: 'individual' | 'arrow-left' | 'arrow-right' | 'birth' | 'death' | 'marriage' | 'child';
  bounds: { x: number; y: number; width: number; height: number };
  data?: any;
}

const Scene2DCanvas: React.FC<Scene2DCanvasProps> = ({
  data,
  selectedId,
  selectedIds,
  onIndividualClick,
  onToggleSelection,
  onExpandFamily,
  isDarkMode,
  sortMode = 'birth-asc',
  leftPanelOpen = false,
  rightPanelOpen = false
}) => {
  console.log('[Scene2DCanvas] Component rendering', { hasData: !!data, selectedIdsSize: selectedIds?.size });
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Pan & Zoom State
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  
  // Debug scale changes
  useEffect(() => {
    console.log('[Scene2DCanvas] Scale changed to:', scale);
  }, [scale]);
  const lastMousePos = useRef({ x: 0, y: 0 });
  const hasCentered = useRef(false);
  
  // Interaction State
  const [hoveredRegion, setHoveredRegion] = useState<InteractiveRegion | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const interactiveRegionsRef = useRef<InteractiveRegion[]>([]);
  
  // Prepare data
  const { individuals, minYear, maxYear } = useMemo(() => {
    if (!data) return { individuals: [], minYear: 1900, maxYear: 2024 };

    const allIndividuals = Object.values(data.individuals) as Individual[];

    // Filter logic with INTELLIGENT FILTERING for large databases
    const list = allIndividuals.filter(indi => {
      // If "__NONE__" is selected, hide all
      if (selectedIds?.has('__NONE__')) {
        return false;
      }
      
      // If no selection, show intelligently based on database size
      if (!selectedIds || selectedIds.size === 0) {
        // For large databases (>5000), only show individuals with KNOWN dates
        if (allIndividuals.length > 5000) {
          const hasBirth = indi.birthDate?.year !== null && indi.birthDate?.year !== undefined;
          const hasDeath = indi.deathDate?.year !== null && indi.deathDate?.year !== undefined;
          return hasBirth || hasDeath; // At least one known date
        }
        // For small databases, show all
        return true;
      }
      
      // Otherwise, filter based on selection (expansion shows all, including unknown dates)
      const isSelectedFor2D = selectedIds.has(indi.id);
      const isManual = indi.source === 'manual';
      return isSelectedFor2D || isManual;
    });
    
    // Debug logging
    console.log('[Scene2DCanvas] Filter:', {
      totalIndividuals: allIndividuals.length,
      selectedIdsSize: selectedIds?.size ?? 'undefined',
      filteredCount: list.length,
      shouldShowAll: !selectedIds || selectedIds.size === 0
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

    // Sort
    const sortedList = [...list].sort((a, b) => {
      if (sortMode === 'name') {
        const nameA = `${a.surname} ${a.givenName}`;
        const nameB = `${b.surname} ${b.givenName}`;
        return nameA.localeCompare(nameB);
      } else {
        const isAsc = sortMode === 'birth-asc';
        const dateA = a.birthDate?.year ?? -99999;
        const dateB = b.birthDate?.year ?? -99999;
        
        if (dateA !== dateB) {
          return isAsc ? dateA - dateB : dateB - dateA;
        }
        
        const genA = a.generation ?? 0;
        const genB = b.generation ?? 0;
        if (genA !== genB) {
          return isAsc ? genA - genB : genB - genA;
        }

        return (a.givenName || '').localeCompare(b.givenName || '');
      }
    });

    return { individuals: sortedList, minYear: minY, maxYear: maxY };
  }, [data, sortMode, selectedIds, selectedId]);

  // Reset centering and scale when individuals list changes (more reliable trigger)
  useEffect(() => {
    console.log('[Scene2DCanvas] Individuals changed, resetting hasCentered and scale to 1', { count: individuals.length });
    hasCentered.current = false;
    setScale(1); // Force scale to 1 on data load
    
    // Force immediate re-center  
    if (individuals.length > 0 && canvasSize.width > 0 && canvasSize.height > 0) {
      const totalHeight = (maxYear - minYear) * PIXELS_PER_YEAR;
      const leftPad = leftPanelOpen ? 360 : 80;
      const startX = leftPad;
      
      // Show most RECENT dates (near maxYear/2026) at top
      // maxYear is at worldY = 0, we want it at screenY = 50
      const startY = 50;
      
      // BUT if all individuals are old (like 1638), they are at worldY = 1017+
      // Calculate average individual position to center them
      const avgBirthYear = individuals.reduce((sum, ind) => {
        const year = ind.birthDate?.year ?? ind.birthDate?.preciseDate ?? minYear + 50;
        return sum + year;
      }, 0) / individuals.length;
      
      const avgWorldY = (maxYear - avgBirthYear) * PIXELS_PER_YEAR;
      const startYCentered = (canvasSize.height / 2) - avgWorldY;
      
      console.log('[Scene2DCanvas] Force re-center:', { 
        startX, startYSimple: startY, startYCentered, totalHeight, canvasHeight: canvasSize.height, 
        avgBirthYear, avgWorldY, minYear, maxYear, scale: 1
      });
      setTranslate({ x: startX, y: startYCentered });
    }
  }, [individuals.length]);
  
  // Canvas resize
  useEffect(() => {
    const updateSize = () => {
      console.log('[Scene2DCanvas] updateSize called', {
        hasContainer: !!containerRef.current,
        hasCanvas: !!canvasRef.current
      });
      
      if (containerRef.current && canvasRef.current) {
        const dpr = window.devicePixelRatio || 1;
        const rect = containerRef.current.getBoundingClientRect();
        
        console.log('[Scene2DCanvas] Rect:', rect);
        
        canvasRef.current.width = rect.width * dpr;
        canvasRef.current.height = rect.height * dpr;
        canvasRef.current.style.width = `${rect.width}px`;
        canvasRef.current.style.height = `${rect.height}px`;
        
        setCanvasSize({ width: rect.width, height: rect.height });
        
        // Note: We'll apply DPR scaling in the render function, not here
        console.log('[Scene2DCanvas] Canvas sized:', { width: rect.width, height: rect.height, dpr });
      } else {
        console.log('[Scene2DCanvas] Refs not ready - will retry on next render');
      }
    };

    window.addEventListener('resize', updateSize);
    // Delay initial call to ensure refs are mounted
    const timer = setTimeout(updateSize, 0);
    
    return () => {
      window.removeEventListener('resize', updateSize);
      clearTimeout(timer);
    };
  }, []);

  // REMOVED: Duplicate auto-center that was overriding the correct position

  // Helper functions
  const formatYear = (precise?: number, raw?: number | null) => {
    if (raw !== undefined && raw !== null) return raw.toString();
    if (precise !== undefined) return Math.floor(precise).toString();
    return "?";
  };

  const getBarColor = (gender: Gender): string => {
    if (gender === Gender.Female) return '#fbb6ce';
    if (gender === Gender.Male) return '#93c5fd';
    return '#94a3b8';
  };

  // Render function
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) {
      console.log('[Scene2DCanvas] Render skipped:', { hasCanvas: !!canvas, hasData: !!data });
      return;
    }
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.log('[Scene2DCanvas] No context');
      return;
    }

    const width = canvasSize.width;
    const height = canvasSize.height;
    const dpr = window.devicePixelRatio || 1;
    
    console.log('[Scene2DCanvas] Rendering:', { width, height, individualsCount: individuals.length, dpr });

    // Clear with DPR
    ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Apply DPR scaling
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = isDarkMode ? '#000000' : '#f8fafc';
    ctx.fillRect(0, 0, width, height);
    
    // TEST: Draw a big red rectangle to verify canvas is working
    ctx.fillStyle = 'red';
    ctx.fillRect(100, 100, 200, 200);
    console.log('[Scene2DCanvas] Drew test red rectangle at (100,100)');

    // Reset interactive regions
    interactiveRegionsRef.current = [];

    // Save context for transform
    ctx.save();
    ctx.translate(translate.x, translate.y);
    ctx.scale(scale, scale);

    const totalHeight = (maxYear - minYear) * PIXELS_PER_YEAR;

    // Render grid lines
    const gridColor = isDarkMode ? 'rgba(100, 116, 139, 0.6)' : 'rgba(203, 213, 225, 1)';
    const textColor = isDarkMode ? '#cbd5e1' : '#64748b';
    
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1 / scale;
    ctx.font = `${12 / scale}px monospace`;
    ctx.fillStyle = textColor;

    // Calculate visible year range for culling
    const contentYTop = -translate.y / scale;
    const contentYBottom = (height - translate.y) / scale;
    const yearHigh = maxYear - (contentYTop / PIXELS_PER_YEAR);
    const yearLow = maxYear - (contentYBottom / PIXELS_PER_YEAR);
    const startYear = Math.min(maxYear, Math.ceil(yearHigh / 10) * 10 + 10);
    const endYear = Math.max(minYear, Math.floor(yearLow / 10) * 10 - 10);

    const leftPad = leftPanelOpen ? 340 : 24;
    const rightPad = rightPanelOpen ? 340 : 24;

    for (let y = startYear; y >= endYear; y -= 10) {
      const lineY = (maxYear - y) * PIXELS_PER_YEAR;
      
      ctx.beginPath();
      ctx.moveTo(-translate.x / scale, lineY);
      ctx.lineTo((width - translate.x) / scale, lineY);
      ctx.stroke();
      
      // Year labels
      ctx.save();
      ctx.scale(1 / scale, 1 / scale);
      ctx.fillText(y.toString(), (-translate.x / scale + leftPad) * scale, lineY * scale);
      ctx.fillText(y.toString(), ((width - translate.x) / scale - rightPad - 40) * scale, lineY * scale);
      ctx.restore();
    }

    // Render individuals with VIEWPORT CULLING (essential for 40k+ individuals)
    const contentStartX = 48;
    
    // Calculate visible X and Y ranges in world coordinates
    const visibleWorldLeft = -translate.x / scale;
    const visibleWorldRight = (width - translate.x) / scale;
    const visibleWorldTop = -translate.y / scale;
    const visibleWorldBottom = (height - translate.y) / scale;
    
    let renderedCount = 0;
    let culledCount = 0;
    
    console.log('[Scene2DCanvas] Rendering individuals:', {
      count: individuals.length,
      minYear,
      maxYear,
      totalHeight,
      translate,
      scale,
      screenHeight: height,
      visibleRange: { top: visibleWorldTop, bottom: visibleWorldBottom, left: visibleWorldLeft, right: visibleWorldRight }
    });
    
    individuals.forEach((indi, index) => {
      const x = contentStartX + index * (INDIVIDUAL_WIDTH + INDIVIDUAL_GAP);
      
      // Calculate dates
      let realBirth = indi.birthDate?.preciseDate ?? indi.birthDate?.year;
      let realDeath = indi.deathDate?.preciseDate ?? indi.deathDate?.year;

      if (realBirth === null) realBirth = undefined;
      if (realDeath === null) realDeath = undefined;

      let displayBirth = realBirth;
      let displayDeath = realDeath;

      if (displayBirth === undefined && displayDeath === undefined) {
        displayBirth = minYear + 10;
        displayDeath = minYear + 10 + DEFAULT_LIFESPAN;
      } else if (displayBirth === undefined && displayDeath !== undefined) {
        displayBirth = displayDeath - DEFAULT_LIFESPAN;
      } else if (displayBirth !== undefined && displayDeath === undefined) {
        displayDeath = displayBirth + DEFAULT_LIFESPAN;
      }

      const barTopY = (maxYear - displayDeath!) * PIXELS_PER_YEAR;
      const barBottomY = (maxYear - displayBirth!) * PIXELS_PER_YEAR;
      const barHeight = Math.max(barBottomY - barTopY, 2);
      
      // VIEWPORT CULLING: Skip if individual is completely outside visible area
      const isOutsideViewport = (
        x + INDIVIDUAL_WIDTH < visibleWorldLeft ||  // Too far left
        x > visibleWorldRight ||                     // Too far right
        barBottomY < visibleWorldTop ||             // Too far up
        barTopY > visibleWorldBottom                // Too far down
      );
      
      if (isOutsideViewport) {
        culledCount++;
        return; // Skip rendering this individual
      }
      
      renderedCount++;
      
      // Debug first visible individual
      if (renderedCount === 1) {
        console.log('[Scene2DCanvas] First VISIBLE individual:', {
          name: `${indi.givenName} ${indi.surname}`,
          realBirth, realDeath, displayBirth, displayDeath,
          barTopY, barBottomY, barHeight,
          x, isValid: !isNaN(barTopY) && !isNaN(barBottomY)
        });
      }
      
      // Skip if coordinates are invalid
      if (isNaN(barTopY) || isNaN(barBottomY) || isNaN(x)) {
        console.warn('[Scene2DCanvas] Invalid coordinates for', indi.id, { x, barTopY, barBottomY });
        return;
      }

      const isSelected = selectedId === indi.id;
      const isHovered = hoveredRegion?.individualId === indi.id && hoveredRegion.type === 'individual';

      // Draw life bar with gradient mask if needed
      // DON'T use ctx.save()/restore() here - it would cancel the global transform!
      
      // Apply gradient mask
      if (realBirth === undefined || realDeath === undefined) {
        const gradient = ctx.createLinearGradient(x, barTopY, x, barBottomY);
        
        if (realBirth === undefined && realDeath === undefined) {
          gradient.addColorStop(0, 'rgba(255,255,255,0)');
          gradient.addColorStop(0.2, 'rgba(255,255,255,1)');
          gradient.addColorStop(0.8, 'rgba(255,255,255,1)');
          gradient.addColorStop(1, 'rgba(255,255,255,0)');
        } else if (realBirth === undefined) {
          gradient.addColorStop(0, 'rgba(255,255,255,1)');
          gradient.addColorStop(0.8, 'rgba(255,255,255,1)');
          gradient.addColorStop(1, 'rgba(255,255,255,0)');
        } else {
          gradient.addColorStop(0, 'rgba(255,255,255,0)');
          gradient.addColorStop(0.2, 'rgba(255,255,255,1)');
          gradient.addColorStop(1, 'rgba(255,255,255,1)');
        }
        
        const prevOp = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = 'destination-in';
        ctx.fillStyle = gradient;
        ctx.fillRect(x, barTopY, INDIVIDUAL_WIDTH, barHeight);
        ctx.globalCompositeOperation = prevOp;
      }

      // Life bar - SIMPLIFIED for performance
      ctx.fillStyle = getBarColor(indi.gender);
      ctx.globalAlpha = isHovered ? 1 : 0.9;
      ctx.fillRect(x + 2, barTopY, INDIVIDUAL_WIDTH - 4, barHeight);
      ctx.globalAlpha = 1;

      if (isSelected) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2 / scale;
        ctx.strokeRect(x, barTopY, INDIVIDUAL_WIDTH, barHeight);
      }

      // Add interactive region for individual
      interactiveRegionsRef.current.push({
        id: `indi-${indi.id}`,
        individualId: indi.id,
        type: 'individual',
        bounds: { x, y: barTopY, width: INDIVIDUAL_WIDTH, height: barHeight },
        data: indi
      });

      // Only render markers/arrows for visible individuals when zoomed in (scale > 0.5)
      if (scale > 0.5) {
        // Birth marker
        if (realBirth !== undefined) {
          const birthY = (maxYear - realBirth) * PIXELS_PER_YEAR;
          const birthColor = indi.gender === Gender.Female ? '#ef4444' : '#3b82f6';
          
          ctx.fillStyle = birthColor;
          ctx.fillRect(x - 2, birthY - 2, INDIVIDUAL_WIDTH + 4, 4);
        }

        // Death marker
        if (realDeath !== undefined) {
          const deathY = (maxYear - realDeath) * PIXELS_PER_YEAR;
          
          ctx.fillStyle = isDarkMode ? '#000000' : '#1e293b';
          ctx.fillRect(x, deathY - 2, INDIVIDUAL_WIDTH, 4);
        }

        // Expansion arrows
        const expansionY = (maxYear - displayBirth!) * PIXELS_PER_YEAR + 3;
        const arrowSize = 8;
        const arrowHoverLeft = hoveredRegion?.individualId === indi.id && hoveredRegion.type === 'arrow-left';
        const arrowHoverRight = hoveredRegion?.individualId === indi.id && hoveredRegion.type === 'arrow-right';

        ctx.font = `bold ${arrowSize}px monospace`;
        
        // Left arrow (ancestors)
        ctx.fillStyle = arrowHoverLeft ? '#3b82f6' : '#64748b';
        ctx.fillText('<', x + 2, expansionY);
        interactiveRegionsRef.current.push({
          id: `arrow-left-${indi.id}`,
          individualId: indi.id,
          type: 'arrow-left',
          bounds: { x: x + 2, y: expansionY - arrowSize, width: arrowSize, height: arrowSize },
          data: { direction: 'ancestors', individualId: indi.id }
        });

        // Right arrow (descendants)
        ctx.fillStyle = arrowHoverRight ? '#3b82f6' : '#64748b';
        ctx.fillText('>', x + INDIVIDUAL_WIDTH - arrowSize - 2, expansionY);
        interactiveRegionsRef.current.push({
          id: `arrow-right-${indi.id}`,
          individualId: indi.id,
          type: 'arrow-right',
          bounds: { x: x + INDIVIDUAL_WIDTH - arrowSize - 2, y: expansionY - arrowSize, width: arrowSize, height: arrowSize },
          data: { direction: 'descendants', individualId: indi.id }
        });
      }
      
      // Skip marriage and children markers for performance (only show on zoom)

      // Hover/Selected label
      if (isSelected || isHovered) {
        const labelY = barTopY + barHeight / 2;
        const labelX = x + INDIVIDUAL_WIDTH + 4;
        
        const name = `${indi.givenName} ${indi.surname}`;
        const dates = `${formatYear(realBirth, indi.birthDate?.year)} - ${formatYear(realDeath, indi.deathDate?.year)}`;
        
        ctx.save();
        ctx.scale(1 / scale, 1 / scale);
        
        const scaledLabelX = labelX * scale;
        const scaledLabelY = labelY * scale;
        
        ctx.font = 'bold 10px sans-serif';
        const nameWidth = ctx.measureText(name).width;
        ctx.font = '8px sans-serif';
        const datesWidth = ctx.measureText(dates).width;
        const maxWidth = Math.max(nameWidth, datesWidth);
        
        // Background
        ctx.fillStyle = isDarkMode ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.95)';
        ctx.fillRect(scaledLabelX - 4, scaledLabelY - 12, maxWidth + 8, 24);
        
        // Border
        ctx.strokeStyle = isDarkMode ? 'rgba(255,255,255,0.2)' : 'rgba(203,213,225,1)';
        ctx.lineWidth = 1;
        ctx.strokeRect(scaledLabelX - 4, scaledLabelY - 12, maxWidth + 8, 24);
        
        // Text
        ctx.fillStyle = isDarkMode ? '#ffffff' : '#0f172a';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText(name, scaledLabelX, scaledLabelY);
        
        ctx.fillStyle = isDarkMode ? '#94a3b8' : '#64748b';
        ctx.font = '8px sans-serif';
        ctx.fillText(dates, scaledLabelX, scaledLabelY + 10);
        
        ctx.restore();
      }
    });
    
    console.log('[Scene2DCanvas] Culling stats:', {
      total: individuals.length,
      rendered: renderedCount,
      culled: culledCount,
      percentage: ((renderedCount / individuals.length) * 100).toFixed(1) + '%'
    });

    ctx.restore();

    // Zoom indicator
    ctx.fillStyle = isDarkMode ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)';
    ctx.fillRect(width - 70, height - 40, 60, 30);
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1;
    ctx.strokeRect(width - 70, height - 40, 60, 30);
    
    ctx.fillStyle = isDarkMode ? '#ffffff' : '#000000';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(`${(scale * 100).toFixed(0)}%`, width - 60, height - 20);

  }, [data, individuals, minYear, maxYear, translate, scale, isDarkMode, selectedId, hoveredRegion, canvasSize, leftPanelOpen, rightPanelOpen]);

  // Render on changes - REMOVED RENDER DEPENDENCY TO AVOID INFINITE LOOP
  useEffect(() => {
    // Check directly in DOM instead of waiting for state
    const actualWidth = containerRef.current?.getBoundingClientRect().width || 0;
    console.log('[Scene2DCanvas] Triggering render', {
      hasCanvas: !!canvasRef.current,
      hasData: !!data,
      canvasSizeWidth: canvasSize.width,
      actualWidth,
      individualsCount: individuals.length
    });
    if (canvasRef.current && data && actualWidth > 0 && individuals.length > 0) {
      console.log('[Scene2DCanvas] Calling render()');
      render();
    } else {
      console.log('[Scene2DCanvas] Render blocked - conditions not met');
    }
  }, [data, individuals, minYear, maxYear, translate, scale, isDarkMode, selectedId, hoveredRegion, canvasSize, leftPanelOpen, rightPanelOpen]);

  // Interaction handlers
  const getWorldCoords = (clientX: number, clientY: number) => {
    if (!canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const worldX = (x - translate.x) / scale;
    const worldY = (y - translate.y) / scale;
    return { worldX, worldY };
  };

  const getRegionAtPoint = (worldX: number, worldY: number): InteractiveRegion | null => {
    for (let i = interactiveRegionsRef.current.length - 1; i >= 0; i--) {
      const region = interactiveRegionsRef.current[i];
      if (
        worldX >= region.bounds.x &&
        worldX <= region.bounds.x + region.bounds.width &&
        worldY >= region.bounds.y &&
        worldY <= region.bounds.y + region.bounds.height
      ) {
        return region;
      }
    }
    return null;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      setTranslate(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    } else {
      const coords = getWorldCoords(e.clientX, e.clientY);
      if (coords) {
        const region = getRegionAtPoint(coords.worldX, coords.worldY);
        setHoveredRegion(region);
        
        if (region) {
          if (canvasRef.current) canvasRef.current.style.cursor = 'pointer';
        } else {
          if (canvasRef.current) canvasRef.current.style.cursor = isPanning ? 'grabbing' : 'grab';
        }
      }
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      const coords = getWorldCoords(e.clientX, e.clientY);
      if (coords) {
        const region = getRegionAtPoint(coords.worldX, coords.worldY);
        
        if (!region) {
          setIsPanning(true);
          lastMousePos.current = { x: e.clientX, y: e.clientY };
          if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
        }
      }
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (isPanning) {
      setIsPanning(false);
      if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
    } else {
      const coords = getWorldCoords(e.clientX, e.clientY);
      if (coords) {
        const region = getRegionAtPoint(coords.worldX, coords.worldY);
        
        if (region) {
          if (region.type === 'individual') {
            onIndividualClick(region.data);
          } else if (region.type === 'arrow-left') {
            onExpandFamily?.(region.data.individualId, 'ancestors');
          } else if (region.type === 'arrow-right') {
            onExpandFamily?.(region.data.individualId, 'descendants');
          } else if (region.type === 'birth' && data) {
            // Toggle parents
            const indi = region.data as Individual;
            if (indi.familyChildId && onToggleSelection) {
              const family = data.families[indi.familyChildId];
              if (family) {
                if (family.husbandId) onToggleSelection(family.husbandId);
                if (family.wifeId) onToggleSelection(family.wifeId);
              }
            }
          }
        }
      }
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Ignore very small deltas (trackpad noise)
    if (Math.abs(e.deltaY) < 5) return;
    
    console.log('[Scene2DCanvas] handleWheel triggered', { deltaY: e.deltaY, currentScale: scale });
    
    const coords = getWorldCoords(e.clientX, e.clientY);
    if (!coords) return;

    const zoomIntensity = 0.001;
    const delta = -e.deltaY * zoomIntensity;
    const newScale = Math.min(Math.max(0.1, scale * (1 + delta)), 5);
    
    console.log('[Scene2DCanvas] Zoom:', { oldScale: scale, newScale, delta });
    
    const scaleRatio = newScale / scale;
    const finalTx = e.clientX - (e.clientX - translate.x) * scaleRatio;
    const finalTy = e.clientY - (e.clientY - translate.y) * scaleRatio;
    
    setScale(newScale);
    setTranslate({ x: finalTx, y: finalTy });
  };

  // Don't use early returns - they prevent refs from mounting!
  // We'll render the canvas container regardless and show messages inside if needed

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-hidden relative"
      style={{ cursor: isPanning ? 'grabbing' : 'grab', backgroundColor: isDarkMode ? '#000' : '#f8fafc' }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          setIsPanning(false);
          setHoveredRegion(null);
        }}
        onWheel={handleWheel}
        style={{ zIndex: 10 }}
      />
      {/* Debug overlay */}
      <div className="absolute top-4 left-4 bg-red-500 text-white p-2 text-xs" style={{ zIndex: 100 }}>
        Scale: {scale.toFixed(2)} | Individuals: {individuals.length}
      </div>
    </div>
  );
};

export default Scene2DCanvas;

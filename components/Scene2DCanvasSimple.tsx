import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Individual, GedcomData, Gender, SortMode } from '../types';

interface Scene2DCanvasSimpleProps {
  data: GedcomData | null;
  selectedId?: string | null;
  selectedIds?: Set<string>;
  onIndividualClick: (indi: Individual) => void;
  onExpandFamily?: (id: string, direction: 'ancestors' | 'descendants') => void;
  isDarkMode: boolean;
  sortMode?: SortMode;
  leftPanelOpen?: boolean;
  rightPanelOpen?: boolean;
}

const PIXELS_PER_YEAR = 3.2;
const DEFAULT_LIFESPAN = 80;
const CURRENT_YEAR = new Date().getFullYear();
const BAR_WIDTH = 24;
const BAR_GAP = 4;

const Scene2DCanvasSimple: React.FC<Scene2DCanvasSimpleProps> = ({
  data,
  selectedId,
  selectedIds,
  onIndividualClick,
  onExpandFamily,
  isDarkMode,
  sortMode = 'birth-asc',
  leftPanelOpen = false,
  rightPanelOpen = false
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 100, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const lastMousePos = useRef({ x: 0, y: 0 });
  
  // Store individual positions for interaction
  const individualPositionsRef = useRef<Array<{ x: number; y1: number; y2: number; indi: Individual }>>([]);

  // Prepare data with intelligent filtering
  const { individuals, minYear, maxYear } = useMemo(() => {
    if (!data) return { individuals: [], minYear: 1900, maxYear: 2026 };

    const all = Object.values(data.individuals) as Individual[];
    
    // Intelligent filtering
    let list = all;
    if (selectedIds?.has('__NONE__')) {
      list = [];
    } else if (!selectedIds || selectedIds.size === 0) {
      // Large DB: only show individuals with known dates
      if (all.length > 5000) {
        list = all.filter(i => i.birthDate?.year || i.deathDate?.year);
      }
    } else {
      list = all.filter(i => selectedIds.has(i.id) || i.source === 'manual');
    }

    // Calculate year range from individuals with known dates
    let minY = CURRENT_YEAR;
    let maxY = 1600; // Start low
    
    list.forEach(i => {
      const b = i.birthDate?.year;
      const d = i.deathDate?.year;
      if (b && b > 1500) { // Ignore obviously wrong dates
        minY = Math.min(minY, b);
        maxY = Math.max(maxY, b);
      }
      if (d && d > 1500) {
        minY = Math.min(minY, d);
        maxY = Math.max(maxY, d);
      }
    });
    
    // Ensure reasonable range
    if (maxY < minY) maxY = minY + 100;
    
    minY -= 10;
    maxY = Math.max(maxY, CURRENT_YEAR) + 10;

    // Sort
    const sorted = [...list].sort((a, b) => {
      if (sortMode === 'name') {
        return `${a.surname} ${a.givenName}`.localeCompare(`${b.surname} ${b.givenName}`);
      }
      const isAsc = sortMode === 'birth-asc';
      const dateA = a.birthDate?.year ?? -99999;
      const dateB = b.birthDate?.year ?? -99999;
      return isAsc ? dateA - dateB : dateB - dateA;
    });

    return { individuals: sorted, minYear: minY, maxYear: maxY };
  }, [data, sortMode, selectedIds]);

  // Setup canvas
  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const rect = containerRef.current.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
    }
  }, [containerRef.current, canvasRef.current]);

  // Auto-center on data load
  useEffect(() => {
    if (individuals.length > 0 && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const totalHeight = (maxYear - minYear) * PIXELS_PER_YEAR;
      
      // Center vertically
      const startY = (rect.height / 2) - (totalHeight / 2);
      
      setTranslate({ x: 100, y: startY });
      setScale(1);
    }
  }, [individuals.length, minYear, maxYear]);

  // Render
  const render = () => {
    const canvas = canvasRef.current;
    if (!canvas || !data || individuals.length === 0) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    // Clear
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const dpr = window.devicePixelRatio || 1;
    ctx.scale(dpr, dpr);
    
    // Background
    ctx.fillStyle = isDarkMode ? '#000' : '#f8fafc';
    ctx.fillRect(0, 0, rect.width, rect.height);
    
    // Apply transform
    ctx.translate(translate.x, translate.y);
    ctx.scale(scale, scale);
    
    const totalHeight = (maxYear - minYear) * PIXELS_PER_YEAR;
    const totalWidth = individuals.length * (BAR_WIDTH + BAR_GAP) + 200;
    
    // Draw extended background (for content area)
    ctx.fillStyle = isDarkMode ? '#000' : '#f8fafc';
    ctx.fillRect(-100, -100, totalWidth, totalHeight + 200);
    
    // Draw year grid (every 10 years) - CORRECTED scaling
    ctx.strokeStyle = isDarkMode ? 'rgba(100,116,139,0.3)' : 'rgba(203,213,225,0.5)';
    ctx.lineWidth = 1 / scale;
    
    for (let year = Math.floor(minYear / 10) * 10; year <= maxYear; year += 10) {
      const y = (maxYear - year) * PIXELS_PER_YEAR;
      ctx.beginPath();
      ctx.moveTo(-50, y);
      ctx.lineTo(totalWidth, y);
      ctx.stroke();
    }
    
    // Year labels (drawn AFTER reset transform to keep constant size)
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.font = '11px monospace';
    ctx.fillStyle = isDarkMode ? '#64748b' : '#94a3b8';
    
    for (let year = Math.floor(minYear / 10) * 10; year <= maxYear; year += 10) {
      const worldY = (maxYear - year) * PIXELS_PER_YEAR;
      const screenY = worldY * scale + translate.y;
      
      // Only draw labels visible on screen
      if (screenY >= -20 && screenY <= rect.height + 20) {
        ctx.fillText(year.toString(), 10, screenY + 4);
      }
    }
    
    ctx.restore();
    
    // Re-apply transform for individuals
    ctx.translate(translate.x, translate.y);
    ctx.scale(scale, scale);
    
    // Store positions for interaction
    individualPositionsRef.current = [];
    
    // Pass 1: Draw individuals bars and markers
    individuals.forEach((indi, index) => {
      const x = index * (BAR_WIDTH + BAR_GAP);
      
      const birth = indi.birthDate?.year ?? minYear + 10;
      const death = indi.deathDate?.year ?? birth + DEFAULT_LIFESPAN;
      
      const y1 = (maxYear - death) * PIXELS_PER_YEAR;
      const y2 = (maxYear - birth) * PIXELS_PER_YEAR;
      const height = y2 - y1;
      
      // Store for interaction
      individualPositionsRef.current.push({ x, y1, y2, indi });
      
      // Color
      const color = indi.gender === Gender.Female ? '#fbb6ce' : '#93c5fd';
      
      ctx.fillStyle = color;
      ctx.fillRect(x, y1, BAR_WIDTH, height);
      
      // Birth marker (if known)
      if (indi.birthDate?.year) {
        const birthColor = indi.gender === Gender.Female ? '#ef4444' : '#3b82f6';
        ctx.fillStyle = birthColor;
        ctx.fillRect(x - 2, y2 - 2, BAR_WIDTH + 4, 4);
      }
      
      // Death marker (if known)
      if (indi.deathDate?.year) {
        ctx.fillStyle = isDarkMode ? '#000' : '#1e293b';
        ctx.fillRect(x, y1 - 2, BAR_WIDTH, 4);
      }
      
      // Selection
      if (selectedId === indi.id) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2 / scale;
        ctx.strokeRect(x, y1, BAR_WIDTH, height);
      }
      
      // Hover
      if (hoveredIndex === index) {
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2 / scale;
        ctx.strokeRect(x, y1, BAR_WIDTH, height);
      }
    });
    
    // Pass 2: Draw labels and arrows AFTER bars (so they appear on top)
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    
    individuals.forEach((indi, index) => {
      const pos = individualPositionsRef.current[index];
      if (!pos) return;
      
      const screenX = pos.x * scale + translate.x;
      const screenY1 = pos.y1 * scale + translate.y;
      const screenY2 = pos.y2 * scale + translate.y;
      const screenHeight = (pos.y2 - pos.y1) * scale;
      
      // Hover label
      if (hoveredIndex === index || selectedId === indi.id) {
        ctx.fillStyle = isDarkMode ? 'rgba(0,0,0,0.9)' : 'rgba(255,255,255,0.95)';
        ctx.fillRect(screenX + BAR_WIDTH * scale + 5, screenY1 + screenHeight/2 - 12, 150, 26);
        ctx.strokeStyle = isDarkMode ? '#444' : '#ddd';
        ctx.lineWidth = 1;
        ctx.strokeRect(screenX + BAR_WIDTH * scale + 5, screenY1 + screenHeight/2 - 12, 150, 26);
        
        ctx.fillStyle = isDarkMode ? '#fff' : '#000';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText(`${indi.givenName} ${indi.surname}`, screenX + BAR_WIDTH * scale + 10, screenY1 + screenHeight/2);
        ctx.font = '9px sans-serif';
        ctx.fillStyle = isDarkMode ? '#999' : '#666';
        ctx.fillText(`${birth} - ${death}`, screenX + BAR_WIDTH * scale + 10, screenY1 + screenHeight/2 + 12);
      }
      
      // Expansion arrows (constant size)
      if (scale > 0.1) {
        const arrowSize = 10;
        const arrowScreenY = screenY2 + 5;
        
        ctx.fillStyle = '#64748b';
        ctx.font = 'bold 10px monospace';
        ctx.fillText('<', screenX + 2, arrowScreenY);
        ctx.fillText('>', screenX + BAR_WIDTH * scale - arrowSize, arrowScreenY);
      }
    });
    
    ctx.restore();
  };

  // Render on changes
  useEffect(() => {
    render();
  }, [individuals, translate, scale, selectedId, isDarkMode, hoveredIndex]);

  // Interactions
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    
    if (!containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const delta = -e.deltaY * 0.001;
    const newScale = Math.max(0.005, Math.min(5, scale * (1 + delta))); // Min scale: 0.005 (0.5%)
    
    // Zoom centered on mouse cursor
    const scaleRatio = newScale / scale;
    const newTranslateX = mouseX - (mouseX - translate.x) * scaleRatio;
    const newTranslateY = mouseY - (mouseY - translate.y) * scaleRatio;
    
    setScale(newScale);
    setTranslate({ x: newTranslateX, y: newTranslateY });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsPanning(true);
    lastMousePos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      setTranslate(p => ({ x: p.x + dx, y: p.y + dy }));
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    } else {
      // Check hover
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const worldX = (mouseX - translate.x) / scale;
      const worldY = (mouseY - translate.y) / scale;
      
      let found = false;
      for (let i = 0; i < individualPositionsRef.current.length; i++) {
        const pos = individualPositionsRef.current[i];
        if (worldX >= pos.x && worldX <= pos.x + BAR_WIDTH && worldY >= pos.y1 && worldY <= pos.y2) {
          setHoveredIndex(i);
          found = true;
          break;
        }
      }
      if (!found) setHoveredIndex(null);
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (isPanning) {
      setIsPanning(false);
    } else {
      // Click detection
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const worldX = (mouseX - translate.x) / scale;
      const worldY = (mouseY - translate.y) / scale;
      
      for (let i = 0; i < individualPositionsRef.current.length; i++) {
        const pos = individualPositionsRef.current[i];
        
        const screenX = pos.x * scale + translate.x;
        const screenY2 = pos.y2 * scale + translate.y;
        
        // Check if click on arrows (larger hit box)
        if (scale > 0.1) {
          const arrowScreenY = screenY2 + 5;
          const arrowHitSize = 15; // Larger clickable area
          
          // Left arrow (<)
          if (mouseX >= screenX && mouseX <= screenX + arrowHitSize && 
              mouseY >= arrowScreenY - arrowHitSize && mouseY <= arrowScreenY + arrowHitSize) {
            onExpandFamily?.(pos.indi.id, 'ancestors');
            return;
          }
          // Right arrow (>)
          if (mouseX >= screenX + BAR_WIDTH * scale - arrowHitSize && 
              mouseX <= screenX + BAR_WIDTH * scale && 
              mouseY >= arrowScreenY - arrowHitSize && mouseY <= arrowScreenY + arrowHitSize) {
            onExpandFamily?.(pos.indi.id, 'descendants');
            return;
          }
        }
        
        // Check if click on individual bar (use world coordinates)
        if (worldX >= pos.x && worldX <= pos.x + BAR_WIDTH && worldY >= pos.y1 && worldY <= pos.y2) {
          onIndividualClick(pos.indi);
          return;
        }
      }
    }
  };

  if (!data) {
    return <div className="flex items-center justify-center h-full opacity-50">No Data</div>;
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-hidden relative"
      style={{ cursor: isPanning ? 'grabbing' : hoveredIndex !== null ? 'pointer' : 'grab' }}
    >
      <canvas
        ref={canvasRef}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          handleMouseUp(null as any);
          setHoveredIndex(null);
        }}
      />
      <div className="absolute top-4 left-4 bg-black/70 text-white px-2 py-1 text-xs rounded">
        {individuals.length} individuals | Scale: {(scale * 100).toFixed(0)}%
      </div>
      
      {data && Object.keys(data.individuals).length > 5000 && (!selectedIds || selectedIds.size === 0) && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-blue-500/90 text-white px-3 py-1.5 rounded text-xs max-w-lg text-center">
          ℹ️ Large database: Showing only {individuals.length} individuals with known dates. 
          Use arrow buttons ({"<"} {">"}) to explore ancestors/descendants.
        </div>
      )}
    </div>
  );
};

export default Scene2DCanvasSimple;

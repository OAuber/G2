import React, { useMemo, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrthographicCamera, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Individual, GedcomData, Gender, SortMode } from '../types';
import { LayoutNode } from '../services/layoutEngine';
import InstancedGenealogyTree from './InstancedGenealogyTree';

interface Scene2DTimelineProps {
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

const PIXELS_PER_YEAR = 0.032; // Scaled down for 3D units (was 3.2 pixels)
const DEFAULT_LIFESPAN = 80;
const CURRENT_YEAR = new Date().getFullYear();
const BAR_WIDTH = 0.24; // 3D units
const BAR_GAP = 0.04;
const BAR_DEPTH = 0.2;

const Scene2DTimeline: React.FC<Scene2DTimelineProps> = ({
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
  
  // Prepare data and convert to LayoutNodes (like 3D does)
  const { nodes, minYear, maxYear, centerX, centerY } = useMemo(() => {
    if (!data) return { nodes: [], minYear: 1900, maxYear: 2026, centerX: 0, centerY: 0 };

    const all = Object.values(data.individuals) as Individual[];
    
    // Intelligent filtering for large DBs
    let list = all;
    if (selectedIds?.has('__NONE__')) {
      list = [];
    } else if (!selectedIds || selectedIds.size === 0) {
      if (all.length > 5000) {
        list = all.filter(i => i.birthDate?.year || i.deathDate?.year);
      }
    } else {
      list = all.filter(i => selectedIds.has(i.id) || i.source === 'manual');
    }

    // Calculate year range
    let minY = CURRENT_YEAR;
    let maxY = 1600;
    
    list.forEach(i => {
      const b = i.birthDate?.year;
      const d = i.deathDate?.year;
      if (b && b > 1500) { minY = Math.min(minY, b); maxY = Math.max(maxY, b); }
      if (d && d > 1500) { minY = Math.min(minY, d); maxY = Math.max(maxY, d); }
    });
    
    if (maxY < minY) maxY = minY + 100;
    
    // Safety checks
    if (isNaN(minY) || isNaN(maxY) || !isFinite(minY) || !isFinite(maxY)) {
      console.error('[Scene2DTimeline] Invalid year range:', { minY, maxY });
      minY = 1900;
      maxY = CURRENT_YEAR;
    }
    
    minY -= 10;
    maxY = Math.max(maxY, CURRENT_YEAR) + 10;
    
    console.log('[Scene2DTimeline] Year range:', { minY, maxY, totalIndividuals: list.length });

    // LIMIT for safety: Don't try to render more than 10k at once (even with GPU)
    const limitedList = list.length > 10000 ? list.slice(0, 10000) : list;
    
    console.log('[Scene2DTimeline] Processing:', { total: list.length, limited: limitedList.length });
    
    // Sort - ALWAYS by birth date for timeline (oldest left, youngest right)
    const sorted = [...limitedList].sort((a, b) => {
      const dateA = a.birthDate?.year ?? minY + 10;
      const dateB = b.birthDate?.year ?? minY + 10;
      return dateA - dateB; // Ascending: oldest first (left)
    });

    // Convert to LayoutNodes (Timeline layout)
    const layoutNodes: LayoutNode[] = sorted.map((indi, index) => {
      const birth = indi.birthDate?.year ?? minY + 10;
      const death = indi.deathDate?.year ?? birth + DEFAULT_LIFESPAN;
      
      const x = index * (BAR_WIDTH + BAR_GAP);
      const yBottom = (maxY - birth) * PIXELS_PER_YEAR; // Birth at bottom
      const yTop = (maxY - death) * PIXELS_PER_YEAR;    // Death at top
      const height = yBottom - yTop;
      
      const centerY = yTop + height / 2;
      
      // Reduce bar width slightly to make room for child markers on the side
      const barWidthAdjusted = BAR_WIDTH * 0.85;
      
      // Create matrix for this individual
      const matrix = new THREE.Matrix4();
      const position = new THREE.Vector3(x, centerY, 0);
      const scale = new THREE.Vector3(barWidthAdjusted, height, BAR_DEPTH);
      matrix.compose(position, new THREE.Quaternion(), scale);
      
      // Color based on gender (same as Scene2D: pink-300/blue-300)
      const color = new THREE.Color(
        indi.gender === Gender.Female ? '#fbb6ce' : 
        indi.gender === Gender.Male ? '#93c5fd' : '#94a3b8'
      );
      
      // No traits for now - they're rendered by InstancedGenealogyTree but sized for 3D
      // For timeline, we'll add custom markers later
      const traits: any[] = [];
      
      return {
        id: indi.id,
        matrix,
        color,
        gender: indi.gender,
        birthYear: birth,
        hasBirthDate: !!indi.birthDate?.year,
        hasDeathDate: !!indi.deathDate?.year,
        traits: traits,
        generation: indi.generation ?? 0,
        lifespan: death - birth
      };
    });

    // Calculate scene center for camera
    const cX = (sorted.length * (BAR_WIDTH + BAR_GAP)) / 2;
    const cY = ((maxY - minY) * PIXELS_PER_YEAR) / 2;

    return { nodes: layoutNodes, minYear: minY, maxYear: maxY, centerX: cX, centerY: cY };
  }, [data, sortMode, selectedIds, leftPanelOpen]);

  if (!data) {
    return <div className="flex items-center justify-center h-full opacity-50">No Data</div>;
  }

  return (
    <div className="w-full h-full relative" style={{ background: isDarkMode ? '#000000' : '#ffffff' }}>
      <Canvas
        gl={{ 
          antialias: true, 
          alpha: false,
          preserveDrawingBuffer: true
        }}
        dpr={[1, 2]}
        style={{ background: isDarkMode ? '#000000' : '#ffffff' }}
      >
        {/* Orthographic Camera - Fixed view from front */}
        <OrthographicCamera
          makeDefault
          position={[centerX, centerY, 100]}
          zoom={1}
          near={0.1}
          far={10000}
        />
        
        {/* OrbitControls - Only pan and zoom, no rotation */}
        <OrbitControls
          enableRotate={false}
          enablePan={true}
          enableZoom={true}
          mouseButtons={{
            LEFT: THREE.MOUSE.PAN,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN
          }}
          touches={{
            ONE: THREE.TOUCH.PAN,
            TWO: THREE.TOUCH.DOLLY_PAN
          }}
          target={[centerX, centerY, 0]}
          minZoom={0.005}
          maxZoom={50}
          zoomSpeed={1.5}
        />
        
        {/* Background color */}
        <color attach="background" args={[isDarkMode ? '#000000' : '#ffffff']} />
        
        {/* Lights */}
        <ambientLight intensity={isDarkMode ? 0.6 : 1.0} />
        <directionalLight position={[0, 0, 10]} intensity={isDarkMode ? 0.3 : 0.5} />
        
        {/* Time Grid - Simplified, grid lines removed for now (causing render issues) */}
        
        {/* Instanced Rendering (GPU optimized) */}
        <InstancedGenealogyTree
          nodes={nodes}
          data={data}
          showBoxes={false}
          selectedId={selectedId}
          onNodeClick={(id) => {
            const indi = data.individuals[id];
            if (indi) onIndividualClick(indi);
          }}
        />
      </Canvas>
      
      {/* UI Overlays */}
      <div className="absolute top-4 left-4 bg-black/70 text-white px-2 py-1 text-xs rounded pointer-events-none z-50">
        {nodes.length} individuals | WebGL Timeline | Zoom: Use mouse wheel
      </div>
      
      {data && Object.keys(data.individuals).length > 5000 && (!selectedIds || selectedIds.size === 0) && (
        <div className="absolute top-16 left-1/2 transform -translate-x-1/2 bg-blue-500/90 text-white px-3 py-1.5 rounded text-xs max-w-lg text-center pointer-events-none z-50">
          ℹ️ Large database: Showing {nodes.length} individuals with known dates (GPU rendering)
        </div>
      )}
      
      {/* Year Scale Overlay - Left side (Simplified - shows min/mid/max) */}
      <div 
        className={`absolute top-0 bottom-0 w-20 pointer-events-none z-40 flex flex-col justify-between py-12 transition-all duration-300 ${
          leftPanelOpen ? 'left-[340px]' : 'left-2'
        }`}
      >
        <div className={`text-xs font-mono font-bold ${isDarkMode ? 'text-gray-200 bg-black/80' : 'text-gray-800 bg-white/90'} px-2 py-0.5 rounded shadow-md border ${isDarkMode ? 'border-gray-700' : 'border-gray-300'}`}>
          {maxYear}
        </div>
        <div className={`text-xs font-mono font-bold ${isDarkMode ? 'text-gray-200 bg-black/80' : 'text-gray-800 bg-white/90'} px-2 py-0.5 rounded shadow-md border ${isDarkMode ? 'border-gray-700' : 'border-gray-300'}`}>
          {Math.floor((maxYear + minYear) / 2)}
        </div>
        <div className={`text-xs font-mono font-bold ${isDarkMode ? 'text-gray-200 bg-black/80' : 'text-gray-800 bg-white/90'} px-2 py-0.5 rounded shadow-md border ${isDarkMode ? 'border-gray-700' : 'border-gray-300'}`}>
          {minYear}
        </div>
      </div>
    </div>
  );
};

export default Scene2DTimeline;

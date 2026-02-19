import React from 'react';
import { ArrowUpFromLine, ArrowDownToLine, Cuboid, Sun, Moon, LayoutGrid, ArrowDown, Orbit } from 'lucide-react';
import { DragMode, ViewMode, CameraMode } from '../types';

interface BottomPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  dragMode: DragMode;
  onSetDragMode: (mode: DragMode) => void;
  cameraMode: CameraMode;
  onSetCameraMode: (mode: CameraMode) => void;
  viewMode: ViewMode;
  onSetViewMode: (mode: ViewMode) => void;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  hasData: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  autoLayoutMode?: 'none' | 'ancestors' | 'descendants' | 'all';
  onSetAutoLayoutMode?: (mode: 'none' | 'ancestors' | 'descendants' | 'all') => void;
  isAnimating?: boolean;
}

const BottomPanel: React.FC<BottomPanelProps> = ({ 
  isOpen,
  onToggle,
  dragMode, 
  onSetDragMode,
  cameraMode,
  onSetCameraMode,
  viewMode,
  onSetViewMode,
  isDarkMode,
  onToggleTheme,
  hasData,
  onMouseEnter,
  onMouseLeave,
  autoLayoutMode = 'none',
  onSetAutoLayoutMode,
  isAnimating = false
}) => {
  
  const bgClass = isDarkMode ? 'bg-black/95 border-slate-800' : 'bg-white/95 border-slate-300';
  
  const handleBg = isDarkMode 
    ? 'bg-black text-slate-400 border-slate-800 hover:bg-neutral-900' 
    : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-50';

  const btnDefault = isDarkMode 
    ? 'text-slate-400 hover:text-slate-200 hover:bg-neutral-800' 
    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100';
    
  const btnActive = isDarkMode
    ? 'bg-neutral-700 text-white shadow-md'
    : 'bg-slate-200 text-slate-800 shadow-sm hover:bg-slate-300';
    
  const containerBg = isDarkMode ? 'bg-neutral-900 border-slate-800' : 'bg-slate-50 border-slate-200';

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[100] pointer-events-none">
      {/* Handle - Always visible at bottom */}
      <div className="flex justify-center">
        <button 
          onClick={onToggle}
          style={{ touchAction: 'manipulation' }}
          className={`pointer-events-auto ${handleBg} rounded-t-xl px-10 py-3 border-t border-x shadow-md flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest transition-colors cursor-pointer`}
        >
          Visualize
        </button>
      </div>

      {/* Content - collapses via max-height, no transforms */}
      <div
        className="overflow-hidden"
        style={{ maxHeight: isOpen ? '120px' : '0px', transition: 'max-height 300ms ease' }}
      >
        <div 
          className={`pointer-events-auto ${bgClass} backdrop-blur-md border-t px-3 py-2 shadow-2xl`}
          style={{ touchAction: 'pan-y' }}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
        >
        <div className="flex flex-wrap items-center justify-center gap-3 max-w-6xl mx-auto">
          
          {hasData && (
            <>
              {/* View Mode Switcher */}
              <div className={`flex rounded-lg p-0.5 border ${containerBg}`}>
                <button onClick={() => onSetViewMode('2D')} className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-bold transition-all ${viewMode === '2D' ? btnActive : btnDefault}`}>
                  <LayoutGrid className="w-3 h-3" /> 2D
                </button>
                <button onClick={() => onSetViewMode('3D')} className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-bold transition-all ${viewMode === '3D' ? btnActive : btnDefault}`}>
                  <Cuboid className="w-3 h-3" /> 3D
                </button>
              </div>

              {/* 3D Specific Controls */}
              {viewMode === '3D' && (
                <>
                  {/* Drag / Layout Mode */}
                  <div className={`flex rounded-lg p-0.5 border ${containerBg}`}>
                    {autoLayoutMode === 'none' && (
                      <>
                        <button onClick={() => onSetDragMode('ancestors')} className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-bold transition-all ${dragMode === 'ancestors' ? btnActive : btnDefault}`}>
                          <ArrowUpFromLine className="w-3 h-3" /> Anc.
                        </button>
                        <button onClick={() => onSetDragMode('descendants')} className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-bold transition-all ${dragMode === 'descendants' ? btnActive : btnDefault}`}>
                          <ArrowDownToLine className="w-3 h-3" /> Desc.
                        </button>
                      </>
                    )}
                    {onSetAutoLayoutMode && (
                      <>
                        <button 
                          onClick={() => {
                              const ascOn = autoLayoutMode === 'ancestors' || autoLayoutMode === 'all';
                              const descOn = autoLayoutMode === 'descendants' || autoLayoutMode === 'all';
                              const newAsc = !ascOn;
                              if (newAsc && descOn) onSetAutoLayoutMode('all');
                              else if (newAsc) onSetAutoLayoutMode('ancestors');
                              else if (descOn) onSetAutoLayoutMode('descendants');
                              else onSetAutoLayoutMode('none');
                          }}
                          title="Toggle Ancestors"
                          className={`px-2 py-1 rounded-md text-xs font-bold ${autoLayoutMode === 'ancestors' || autoLayoutMode === 'all' ? 'bg-pink-500 text-white' : btnDefault}`}
                        >
                          Asc ↑
                        </button>
                        <button 
                          onClick={() => {
                              const ascOn = autoLayoutMode === 'ancestors' || autoLayoutMode === 'all';
                              const descOn = autoLayoutMode === 'descendants' || autoLayoutMode === 'all';
                              const newDesc = !descOn;
                              if (ascOn && newDesc) onSetAutoLayoutMode('all');
                              else if (newDesc) onSetAutoLayoutMode('descendants');
                              else if (ascOn) onSetAutoLayoutMode('ancestors');
                              else onSetAutoLayoutMode('none');
                          }}
                          title="Toggle Descendants"
                          className={`px-2 py-1 rounded-md text-xs font-bold ${autoLayoutMode === 'descendants' || autoLayoutMode === 'all' ? 'bg-blue-500 text-white' : btnDefault}`}
                        >
                          Desc ↓
                        </button>
                      </>
                    )}
                  </div>

                  {/* Camera Mode Controls */}
                  <div className="flex gap-0.5">
                    {/* Individual view */}
                    <button onClick={() => onSetCameraMode('individual')} disabled={isAnimating} className={`w-7 h-6 flex items-center justify-center rounded border ${containerBg} ${cameraMode === 'individual' ? btnActive : btnDefault}`} title="Individual View">
                       <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                         <rect x="6.5" y="2" width="3" height="12" rx="1" />
                       </svg>
                    </button>
                    {/* Top view */}
                    <button onClick={() => onSetCameraMode('top')} disabled={isAnimating} className={`w-7 h-6 flex items-center justify-center rounded border ${containerBg} ${cameraMode === 'top' ? btnActive : btnDefault}`} title="Top View">
                       <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    {/* Free 3D view */}
                    <button onClick={() => onSetCameraMode('free')} disabled={isAnimating} className={`w-7 h-6 flex items-center justify-center rounded border ${containerBg} ${cameraMode === 'free' ? btnActive : btnDefault}`} title="Free 3D View">
                       <Orbit className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {/* Theme - Always Visible */}
          <button onClick={onToggleTheme} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-colors ${isDarkMode ? 'bg-black border-slate-700 text-slate-200' : 'bg-slate-200 border-slate-300 text-slate-800 hover:bg-slate-300'}`}>
            {isDarkMode ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
            <span className="text-xs font-bold">{isDarkMode ? 'Dark' : 'Light'}</span>
          </button>

        </div>
        </div>
      </div>
    </div>
  );
};

export default BottomPanel;
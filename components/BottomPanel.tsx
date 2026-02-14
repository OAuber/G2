import React from 'react';
import { Box, ArrowUpFromLine, ArrowDownToLine, Cuboid, Move, Sun, Moon, LayoutGrid, MonitorPlay, ArrowDown, User, Network } from 'lucide-react';
import { DragMode, ViewMode, CameraView } from '../types';

interface BottomPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  showBoxes: boolean;
  showAxes: boolean;
  onToggleBoxes: () => void;
  onToggleAxes: () => void;
  dragMode: DragMode;
  onSetDragMode: (mode: DragMode) => void;
  onSetCameraView: (view: CameraView) => void;
  viewMode: ViewMode;
  onSetViewMode: (mode: ViewMode) => void;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  hasData: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  
  // New Prop for Auto Layout
  autoLayoutMode?: 'none' | 'ancestors' | 'descendants' | 'all';
  onSetAutoLayoutMode?: (mode: 'none' | 'ancestors' | 'descendants' | 'all') => void;
}

const BottomPanel: React.FC<BottomPanelProps> = ({ 
  isOpen,
  onToggle,
  showBoxes, 
  showAxes,
  onToggleBoxes, 
  onToggleAxes,
  dragMode, 
  onSetDragMode,
  onSetCameraView,
  viewMode,
  onSetViewMode,
  isDarkMode,
  onToggleTheme,
  hasData,
  onMouseEnter,
  onMouseLeave,
  autoLayoutMode = 'none',
  onSetAutoLayoutMode
}) => {
  
  const bgClass = isDarkMode ? 'bg-black/95 border-slate-800' : 'bg-white/95 border-slate-300';
  const labelText = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  
  // Minimalist Handle Style
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
  const toggleActive = isDarkMode 
    ? 'bg-neutral-700 text-white' 
    : 'bg-slate-200 text-slate-800 border-slate-300 hover:bg-slate-300';

  // Adjusted offset to 36px to match handle height and prevent content leaking
  const translateClass = isOpen ? 'translate-y-0' : 'translate-y-[calc(100%-36px)]';

  return (
    <div 
      className={`absolute bottom-0 left-0 right-0 z-[100] transition-transform duration-300 ${translateClass}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Handle - Styled as Tab Title */}
      <div className="flex justify-center">
        <button 
          onClick={onToggle}
          className={`${handleBg} rounded-t-xl px-10 py-3 border-t border-x shadow-md flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest transition-colors cursor-pointer`}
        >
          Visualize
        </button>
      </div>

      <div className={`${bgClass} backdrop-blur-md border-t p-4 shadow-2xl`}>
        <div className="flex flex-wrap items-center justify-center gap-6 max-w-6xl mx-auto">
          
          {hasData && (
            <>
              {/* View Mode Switcher */}
              <div className="flex flex-col items-center gap-1">
                 <span className={`text-[10px] uppercase font-bold tracking-wider ${labelText}`}>Mode</span>
                 <div className={`flex rounded-lg p-1 border ${containerBg}`}>
                    <button onClick={() => onSetViewMode('3D')} className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${viewMode === '3D' ? btnActive : btnDefault}`}>
                      <Cuboid className="w-3.5 h-3.5" /> 3D View
                    </button>
                    <button onClick={() => onSetViewMode('2D')} className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${viewMode === '2D' ? btnActive : btnDefault}`}>
                      <LayoutGrid className="w-3.5 h-3.5" /> 2D Plan
                    </button>
                 </div>
              </div>

              <div className="w-px h-8 bg-slate-500/20 hidden sm:block"></div>

              {/* 3D Specific Controls */}
              {viewMode === '3D' && (
                <>
                  {/* Drag / Layout Mode */}
                  <div className="flex flex-col items-center gap-1">
                     <span className={`text-[10px] uppercase font-bold tracking-wider ${labelText}`}>Interaction</span>
                     {/* Split into Manual vs Auto */}
                     <div className={`flex rounded-lg p-1 border ${containerBg}`}>
                        {autoLayoutMode === 'none' ? (
                          // Manual Drag Buttons
                          <>
                            <button onClick={() => onSetDragMode('ancestors')} className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${dragMode === 'ancestors' ? btnActive : btnDefault}`}>
                              <ArrowUpFromLine className="w-3.5 h-3.5" /> Drag Ancestors
                            </button>
                            <button onClick={() => onSetDragMode('descendants')} className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${dragMode === 'descendants' ? btnActive : btnDefault}`}>
                              <ArrowDownToLine className="w-3.5 h-3.5" /> Drag Descendants
                            </button>
                          </>
                        ) : (
                          // Auto Layout Status
                          <div className="px-3 py-1.5 text-xs font-bold text-blue-500 flex items-center gap-2">
                             <Network className="w-3.5 h-3.5" /> Auto-Layout Active
                          </div>
                        )}
                        
                        {/* Auto Layout Toggle (Switch between Manual and Engine) */}
                        <div className="w-px h-4 bg-slate-500/20 mx-1 self-center"></div>
                        
                        {onSetAutoLayoutMode && (
                             <div className="flex gap-1">
                                <button 
                                  onClick={() => {
                                      if(autoLayoutMode === 'ancestors') onSetAutoLayoutMode('none');
                                      else {
                                          onSetAutoLayoutMode('ancestors');
                                          onSetCameraView('TOP'); // Auto-switch to TOP for 2D validation
                                      }
                                  }}
                                  title="Auto-Deploy Ancestors"
                                  className={`px-2 py-1.5 rounded-md text-xs font-bold ${autoLayoutMode === 'ancestors' ? 'bg-pink-500 text-white' : btnDefault}`}
                                >
                                    Auto ↑
                                </button>
                                <button 
                                  onClick={() => {
                                      if(autoLayoutMode === 'descendants') onSetAutoLayoutMode('none');
                                      else {
                                          onSetAutoLayoutMode('descendants');
                                          onSetCameraView('TOP'); // Auto-switch to TOP for 2D validation
                                      }
                                  }}
                                  title="Auto-Deploy Descendants"
                                  className={`px-2 py-1.5 rounded-md text-xs font-bold ${autoLayoutMode === 'descendants' ? 'bg-blue-500 text-white' : btnDefault}`}
                                >
                                    Auto ↓
                                </button>
                             </div>
                        )}
                     </div>
                  </div>

                  <div className="w-px h-8 bg-slate-500/20 hidden sm:block"></div>

                  {/* Camera Controls */}
                  <div className="flex flex-col items-center gap-1">
                     <span className={`text-[10px] uppercase font-bold tracking-wider ${labelText}`}>Camera</span>
                     <div className="flex gap-1">
                        {/* Perspective */}
                        <button onClick={() => onSetCameraView(null)} className={`w-8 h-7 flex items-center justify-center rounded border ${containerBg} ${btnDefault}`} title="Perspective">
                           <MonitorPlay className="w-4 h-4" />
                        </button>
                        
                        {/* Top View (Ortho) */}
                        <button onClick={() => onSetCameraView('TOP')} className={`w-8 h-7 flex items-center justify-center rounded border ${containerBg} ${btnDefault}`} title="Top View (Plan)">
                           <ArrowDown className="w-4 h-4" />
                        </button>

                        {/* Isometric Female (Side) */}
                        <button onClick={() => onSetCameraView('ISO_M')} className={`w-12 h-7 flex items-center justify-center gap-1 rounded border ${containerBg} ${btnDefault}`} title="Isometric (Women Side)">
                           <span className="text-[10px] font-bold">Iso</span>
                           <User className="w-3 h-3 text-pink-500" />
                        </button>

                         {/* Isometric Male (Side) */}
                         <button onClick={() => onSetCameraView('ISO_F')} className={`w-12 h-7 flex items-center justify-center gap-1 rounded border ${containerBg} ${btnDefault}`} title="Isometric (Men Side)">
                           <span className="text-[10px] font-bold">Iso</span>
                           <User className="w-3 h-3 text-blue-500" />
                        </button>
                     </div>
                  </div>

                  <div className="w-px h-8 bg-slate-500/20 hidden sm:block"></div>

                  {/* Visibility */}
                  <div className="flex flex-col items-center gap-1">
                     <span className={`text-[10px] uppercase font-bold tracking-wider ${labelText}`}>Visibility</span>
                     <div className="flex gap-2">
                       <button onClick={onToggleBoxes} className={`flex items-center gap-2 px-3 py-1.5 rounded border transition-colors ${showBoxes ? toggleActive : `${containerBg} ${btnDefault}`}`}>
                         <Box className="w-4 h-4" /> <span className="text-xs font-bold hidden sm:inline">Boxes</span>
                       </button>
                       <button onClick={onToggleAxes} className={`flex items-center gap-2 px-3 py-1.5 rounded border transition-colors ${showAxes ? toggleActive : `${containerBg} ${btnDefault}`}`}>
                         <Move className="w-4 h-4" /> <span className="text-xs font-bold hidden sm:inline">Axes</span>
                       </button>
                     </div>
                  </div>

                  <div className="w-px h-8 bg-slate-500/20 hidden sm:block"></div>
                </>
              )}
            </>
          )}

          {/* Theme - Always Visible */}
          <div className="flex flex-col items-center gap-1">
             <span className={`text-[10px] uppercase font-bold tracking-wider ${labelText}`}>Theme</span>
             <button onClick={onToggleTheme} className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-colors ${isDarkMode ? 'bg-black border-slate-700 text-slate-200' : 'bg-slate-200 border-slate-300 text-slate-800 hover:bg-slate-300'}`}>
                {isDarkMode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                <span className="text-xs font-bold">{isDarkMode ? 'Dark' : 'Light'}</span>
             </button>
          </div>

        </div>
      </div>
    </div>
  );
};

export default BottomPanel;
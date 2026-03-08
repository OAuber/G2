import React, { useCallback } from 'react';
import { HelpCircle } from 'lucide-react';
import { DisplayMode, LayoutParams, DEFAULT_LAYOUT_PARAMS } from '../types';

const PINK = '#f9a8d4';
const BLUE = '#93c5fd';

interface SliderDef {
  key: keyof LayoutParams;
  label: string;
  min: number;
  max: number;
  step: number;
}

const SLIDER_DEFS: SliderDef[] = [
  { key: 'generationPitch', label: 'Gen.', min: 20, max: 180, step: 5 },
  { key: 'minGap',          label: 'Gap',  min: 0,  max: 80,  step: 1 },
  { key: 'leafWidthRatio',  label: 'Leaf', min: 0.2, max: 3.0, step: 0.05 },
];

interface BottomPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  displayMode: DisplayMode;
  onSetDisplayMode: (mode: DisplayMode) => void;
  isDarkMode: boolean;
  onOpenHelp: () => void;
  hasData: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  autoLayoutMode?: 'none' | 'ancestors' | 'descendants' | 'all';
  onSetAutoLayoutMode?: (mode: 'none' | 'ancestors' | 'descendants' | 'all') => void;
  layoutParams?: LayoutParams;
  onSetLayoutParams?: (params: LayoutParams) => void;
  isAnimating?: boolean;
}

/* ────────────────────── SVG Icon components ────────────────────── */

const Icon2DIndividual = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
    <rect x="9" y="3" width="6" height="18" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
  </svg>
);

const Icon3DIndividual = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
    <line x1="12" y1="4"  x2="12" y2="20" stroke={PINK} strokeWidth="2.5" strokeLinecap="round"/>
    <line x1="4"  y1="12" x2="20" y2="12" stroke={BLUE} strokeWidth="2.5" strokeLinecap="round"/>
  </svg>
);

const Icon2DGrid = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
    <rect x="5" y="4" width="5" height="16" rx="1" fill={PINK} opacity="0.8"/>
    <rect x="14" y="4" width="5" height="16" rx="1" fill={BLUE} opacity="0.8"/>
  </svg>
);

const Icon3DTop = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
    <rect x="3" y="6"  width="18" height="4" rx="1" fill="none" stroke="currentColor" strokeWidth="0.8"/>
    <rect x="3" y="6"  width="9"  height="4" rx="0" fill={PINK} opacity="0.6"/>
    <rect x="12" y="6" width="9"  height="4" rx="0" fill={BLUE} opacity="0.6"/>
    <rect x="5" y="14" width="18" height="4" rx="1" fill="none" stroke="currentColor" strokeWidth="0.8"/>
    <rect x="5" y="14"  width="9"  height="4" rx="0" fill={PINK} opacity="0.6"/>
    <rect x="14" y="14" width="9"  height="4" rx="0" fill={BLUE} opacity="0.6"/>
  </svg>
);

const Icon3DFree = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
    <line x1="5" y1="19" x2="19" y2="5"  stroke={PINK} strokeWidth="2.5" strokeLinecap="round"/>
    <line x1="19" y1="19" x2="5" y2="5"  stroke={BLUE} strokeWidth="2.5" strokeLinecap="round"/>
  </svg>
);

const IconAsc = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
    <polygon points="12,3 3,21 21,21" fill="white" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
  </svg>
);

const IconDesc = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
    <polygon points="12,21 3,3 21,3" fill="white" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
  </svg>
);

/* ────────────────────── Main component ────────────────────── */

const VIEW_BUTTONS: { mode: DisplayMode; icon: React.FC; title: string }[] = [
  { mode: '2d-individual', icon: Icon2DIndividual, title: 'Individual' },
  { mode: '2d-grid',       icon: Icon2DGrid,       title: 'Grid' },
  { mode: '3d-individual', icon: Icon3DIndividual, title: 'Close-up' },
  { mode: '3d-top',        icon: Icon3DTop,        title: 'Top view' },
  { mode: '3d-free',       icon: Icon3DFree,       title: 'Free view' },
];

const BottomPanel: React.FC<BottomPanelProps> = ({
  isOpen,
  onToggle,
  displayMode,
  onSetDisplayMode,
  isDarkMode,
  onOpenHelp,
  hasData,
  onMouseEnter,
  onMouseLeave,
  autoLayoutMode = 'none',
  onSetAutoLayoutMode,
  layoutParams = DEFAULT_LAYOUT_PARAMS,
  onSetLayoutParams,
  isAnimating = false,
}) => {
  const bgClass = isDarkMode ? 'bg-black/95 border-slate-800' : 'bg-white/95 border-slate-300';
  const handleBg = isDarkMode
    ? 'bg-black text-slate-400 border-slate-800 hover:bg-neutral-900'
    : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-50';

  const btnBase = 'w-9 h-9 flex items-center justify-center rounded-lg border transition-all';
  const btnDefault = isDarkMode
    ? `${btnBase} border-transparent text-slate-400 hover:text-slate-200 hover:bg-neutral-800`
    : `${btnBase} border-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-100`;
  const btnActive = isDarkMode
    ? `${btnBase} bg-neutral-700 border-slate-600 text-white shadow-md`
    : `${btnBase} bg-slate-200 border-slate-300 text-slate-800 shadow-sm`;

  const handleSliderChange = useCallback((key: keyof LayoutParams, value: number) => {
    if (!onSetLayoutParams) return;
    onSetLayoutParams({ ...layoutParams, [key]: value });
  }, [layoutParams, onSetLayoutParams]);

  const handleReset = useCallback(() => {
    if (!onSetLayoutParams) return;
    onSetLayoutParams({ ...DEFAULT_LAYOUT_PARAMS });
  }, [onSetLayoutParams]);

  const isDefault = layoutParams.generationPitch === DEFAULT_LAYOUT_PARAMS.generationPitch
    && layoutParams.minGap === DEFAULT_LAYOUT_PARAMS.minGap
    && layoutParams.leafWidthRatio === DEFAULT_LAYOUT_PARAMS.leafWidthRatio;

  const is3D = displayMode.startsWith('3d');

  const toggleAsc = () => {
    if (!onSetAutoLayoutMode) return;
    const ascOn = autoLayoutMode === 'ancestors' || autoLayoutMode === 'all';
    const descOn = autoLayoutMode === 'descendants' || autoLayoutMode === 'all';
    const newAsc = !ascOn;
    if (newAsc && descOn) onSetAutoLayoutMode('all');
    else if (newAsc) onSetAutoLayoutMode('ancestors');
    else if (descOn) onSetAutoLayoutMode('descendants');
    else onSetAutoLayoutMode('none');
  };

  const toggleDesc = () => {
    if (!onSetAutoLayoutMode) return;
    const ascOn = autoLayoutMode === 'ancestors' || autoLayoutMode === 'all';
    const descOn = autoLayoutMode === 'descendants' || autoLayoutMode === 'all';
    const newDesc = !descOn;
    if (ascOn && newDesc) onSetAutoLayoutMode('all');
    else if (newDesc) onSetAutoLayoutMode('descendants');
    else if (ascOn) onSetAutoLayoutMode('ancestors');
    else onSetAutoLayoutMode('none');
  };

  const ascOn = autoLayoutMode === 'ancestors' || autoLayoutMode === 'all';
  const descOn = autoLayoutMode === 'descendants' || autoLayoutMode === 'all';
  const ascClass = ascOn ? btnActive : btnDefault;
  const descClass = descOn ? btnActive : btnDefault;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[100] pointer-events-none">
      <div className="flex justify-center">
        <button
          onClick={onToggle}
          style={{ touchAction: 'manipulation' }}
          className={`pointer-events-auto ${handleBg} rounded-t-xl px-10 py-3 border-t border-x shadow-md flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest transition-colors cursor-pointer`}
        >
          Visualize
        </button>
      </div>

      <div className="overflow-hidden"
           style={{ maxHeight: isOpen ? '300px' : '0px', transition: 'max-height 300ms ease' }}>
        <div
          className={`pointer-events-auto ${bgClass} backdrop-blur-md border-t px-3 py-2 shadow-2xl`}
          style={{ touchAction: 'pan-y' }}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
        >
          {/* Row 1: view buttons + toggles + help */}
          <div className="flex flex-wrap items-center justify-center gap-1.5 max-w-4xl mx-auto">
            {hasData && (
              <>
                {/* Buttons 1-5: view modes */}
                {VIEW_BUTTONS.map(vb => {
                  const Icon = vb.icon;
                  return (
                    <button
                      key={vb.mode}
                      onClick={() => onSetDisplayMode(vb.mode)}
                      disabled={isAnimating}
                      title={vb.title}
                      className={displayMode === vb.mode ? btnActive : btnDefault}
                    >
                      <Icon />
                    </button>
                  );
                })}

                <div className={`w-px h-6 mx-1 ${isDarkMode ? 'bg-slate-700' : 'bg-slate-300'}`} />

                {/* Buttons 6-7: ancestor/descendant toggles */}
                <button onClick={toggleAsc} disabled={isAnimating} title="Ascendants" className={ascClass}>
                  <IconAsc />
                </button>
                <button onClick={toggleDesc} disabled={isAnimating} title="Descendants" className={descClass}>
                  <IconDesc />
                </button>

                <div className={`w-px h-6 mx-1 ${isDarkMode ? 'bg-slate-700' : 'bg-slate-300'}`} />
              </>
            )}

            <button
              onClick={onOpenHelp}
              title="Help"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-colors ${isDarkMode ? 'bg-black border-slate-700 text-slate-200 hover:bg-neutral-900' : 'bg-slate-200 border-slate-300 text-slate-800 hover:bg-slate-300'}`}
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span className="text-xs font-bold">Help</span>
            </button>
          </div>

          {/* Row 2: sliders (3D only) */}
          {hasData && is3D && onSetLayoutParams && (
            <div className="flex flex-wrap items-center justify-center gap-3 max-w-5xl mx-auto mt-2 pt-2 border-t border-dashed"
                 style={{ borderColor: isDarkMode ? '#334155' : '#cbd5e1' }}>
              {SLIDER_DEFS.map(sd => (
                <label key={sd.key} className="flex items-center gap-1.5 cursor-default" title={sd.key}>
                  <span className={`text-[10px] font-semibold ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                    {sd.label}
                  </span>
                  <input
                    type="range"
                    min={sd.min} max={sd.max} step={sd.step}
                    value={layoutParams[sd.key]}
                    onChange={e => handleSliderChange(sd.key, parseFloat(e.target.value))}
                    className="w-24 h-1 accent-blue-500 cursor-pointer"
                  />
                  <span className={`text-[10px] font-mono w-8 ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                    {layoutParams[sd.key]}
                  </span>
                </label>
              ))}
              {!isDefault && (
                <button onClick={handleReset}
                  className={`text-[10px] px-1.5 py-0.5 rounded border ${isDarkMode ? 'border-slate-700 text-slate-400 hover:text-white hover:border-slate-500' : 'border-slate-300 text-slate-500 hover:text-slate-800 hover:border-slate-400'}`}
                >
                  Reset
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BottomPanel;

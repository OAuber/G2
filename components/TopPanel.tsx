import React from 'react';
import { Save } from 'lucide-react';

interface TopPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  databaseName?: string;
  onDownload: () => void;
  hasData: boolean;
  isDarkMode: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

const TopPanel: React.FC<TopPanelProps> = ({ 
  isOpen, 
  onToggle, 
  databaseName,
  onDownload, 
  hasData,
  isDarkMode,
  onMouseEnter, 
  onMouseLeave 
}) => {
  
  const bgClass = isDarkMode ? 'bg-black/95 border-slate-800' : 'bg-white/95 border-slate-300';
  const textClass = isDarkMode ? 'text-slate-200' : 'text-slate-700';
  const subTextClass = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  
  // Tab Style Handle
  const handleBg = isDarkMode 
    ? 'bg-black text-slate-400 border-slate-800 hover:bg-neutral-900' 
    : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-50';

  const btnAction = isDarkMode
    ? 'bg-neutral-700 hover:bg-neutral-600 text-white'
    : 'bg-slate-200 hover:bg-slate-300 text-slate-800 border border-slate-300';

  // Adjusted offset to 36px to ensure the content background is fully hidden.
  // Previous 41px was causing a white band to appear on some screens.
  const translateClass = isOpen ? 'translate-y-0' : '-translate-y-[calc(100%-36px)]';

  return (
    <div 
      className={`absolute top-0 left-0 right-0 z-[100] transition-transform duration-300 ${translateClass}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className={`${bgClass} backdrop-blur-md border-b p-4 shadow-xl flex flex-col items-center gap-2`}>
        {!hasData ? (
             <span className={`text-xs ${subTextClass} font-medium`}>Nothing to share yet.</span>
        ) : (
          <div className="flex flex-col items-center w-full max-w-lg gap-3">
               
               <h2 className={`text-lg font-bold ${textClass} tracking-tight truncate max-w-full`}>
                   {databaseName || "Unknown Database"}
               </h2>

               <div className="flex items-center gap-4">
                  <button 
                      onClick={onDownload}
                      className={`flex items-center gap-2 px-6 py-2 rounded-md font-bold text-sm transition-colors shadow-md ${btnAction}`}
                  >
                      <Save className="w-4 h-4" /> Save (GED)
                  </button>
                  
                  <div className={`text-xs ${subTextClass} italic hidden sm:block`}>
                      Saves current state to local file.
                  </div>
               </div>
          </div>
        )}
      </div>

      {/* Handle - Styled as Tab Title */}
      <div className="flex justify-center">
        <button 
          onClick={onToggle}
          className={`${handleBg} rounded-b-xl px-10 py-3 border-b border-x shadow-md flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest transition-colors cursor-pointer`}
        >
          Share
        </button>
      </div>
    </div>
  );
};

export default TopPanel;
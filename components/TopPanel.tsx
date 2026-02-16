import React, { useState, useEffect } from 'react';
import { Save, Network, Copy, Check, WifiOff } from 'lucide-react';
import { P2PStatus, P2PMode } from '../types';

interface TopPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  databaseName?: string;
  onDownload: () => void;
  hasData: boolean;
  isDarkMode: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  // P2P Props
  p2pStatus: P2PStatus;
  p2pMode: P2PMode;
  peerId: string | null;
  onInitP2P: () => void;
  onConnectP2P: (hostId: string) => void;
}

const TopPanel: React.FC<TopPanelProps> = ({ 
  isOpen, 
  onToggle, 
  databaseName,
  onDownload, 
  hasData,
  isDarkMode,
  onMouseEnter, 
  onMouseLeave,
  p2pStatus,
  p2pMode,
  peerId,
  onInitP2P,
  onConnectP2P,
}) => {
  const [targetHostId, setTargetHostId] = useState('');
  const [copied, setCopied] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleCopyId = () => {
    if (peerId) {
      navigator.clipboard.writeText(peerId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  
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

  const inputBg = isDarkMode
    ? 'bg-neutral-800 border-slate-700 text-white'
    : 'bg-white border-slate-300 text-slate-800';

  return (
    <div className="absolute top-0 left-0 right-0 z-[100] pointer-events-none">
      {/* Content - collapses via max-height, no transforms */}
      <div
        className="overflow-hidden"
        style={{ maxHeight: isOpen ? '200px' : '0px', transition: 'max-height 300ms ease' }}
      >
        <div 
          className={`pointer-events-auto ${bgClass} backdrop-blur-md border-b px-4 py-2 shadow-xl`}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
        >
          <div className="flex items-stretch gap-3 w-full max-w-3xl mx-auto">
          
          {/* Save Section */}
          <div className={`flex-1 rounded-md px-3 py-2 border flex items-center gap-3 ${isDarkMode ? 'bg-neutral-900/50 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
            <Save className={`w-4 h-4 shrink-0 ${subTextClass}`} />
            <span className={`text-xs font-bold uppercase shrink-0 ${subTextClass}`}>Save</span>
            {!hasData ? (
              <span className={`text-[10px] ${subTextClass}`}>Nothing to save yet.</span>
            ) : (
              <>
                <span className={`text-xs font-bold ${textClass} tracking-tight truncate`}>
                  {databaseName || "Unknown Database"}
                </span>
                <button 
                  onClick={onDownload}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-bold text-xs transition-colors shadow-sm shrink-0 ${btnAction}`}
                >
                  <Save className="w-3 h-3" /> GED
                </button>
              </>
            )}
          </div>

          {/* P2P Network Section */}
          <div className={`flex-1 rounded-md px-3 py-2 border ${isDarkMode ? 'bg-neutral-900/50 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
            <div className="flex items-center gap-3">
              <Network className={`w-4 h-4 shrink-0 ${!isOnline ? 'text-red-500' : (p2pStatus === 'connected' ? 'text-green-500' : 'text-slate-500')}`} />
              <span className={`text-xs font-bold uppercase shrink-0 ${subTextClass}`}>P2P Network</span>
              
              {!isOnline ? (
                <span className="text-[10px] px-2 py-0.5 bg-red-500/20 text-red-500 rounded flex items-center gap-1 shrink-0">
                  <WifiOff className="w-3 h-3" /> Offline
                </span>
              ) : (
                <>
                  {p2pStatus === 'disconnected' && (
                    <button onClick={onInitP2P} className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-bold text-xs transition-colors shadow-sm shrink-0 ${btnAction}`}>
                      Enable
                    </button>
                  )}
                  {p2pStatus !== 'disconnected' && (
                    <span className={`text-[10px] px-2 py-0.5 rounded shrink-0 ${p2pStatus === 'connected' ? 'bg-green-500/20 text-green-500' : 'bg-yellow-500/20 text-yellow-500'}`}>
                      {p2pStatus}
                    </span>
                  )}
                </>
              )}

              {isOnline && p2pStatus !== 'disconnected' && (
                <div className="flex items-center gap-1 flex-1 min-w-0">
                  {peerId ? (
                    <>
                      <input 
                        readOnly 
                        value={peerId} 
                        className={`flex-1 min-w-0 text-[10px] font-mono px-1.5 py-0.5 rounded border ${inputBg} opacity-70`}
                      />
                      <button onClick={handleCopyId} className={`p-0.5 rounded shrink-0 ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-slate-200'} ${textClass}`}>
                        {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </>
                  ) : <span className="text-[10px] opacity-50 animate-pulse">Generating ID...</span>}
                  
                  {p2pStatus !== 'connected' && (
                    <>
                      <input 
                        placeholder="Host ID"
                        value={targetHostId}
                        onChange={e => setTargetHostId(e.target.value)}
                        className={`flex-1 min-w-0 text-[10px] px-1.5 py-0.5 rounded border ${inputBg}`}
                      />
                      <button 
                        onClick={() => onConnectP2P(targetHostId)}
                        disabled={!targetHostId}
                        className={`flex items-center px-2 py-1 rounded-md font-bold text-xs transition-colors shadow-sm shrink-0 ${btnAction} disabled:opacity-50`}
                      >
                        Connect
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
            
            {!isOnline && (
              <div className="text-[10px] opacity-50 italic mt-1">
                Internet required for P2P sync. Local mode active.
              </div>
            )}
          </div>

        </div>
        </div>
      </div>

      {/* Handle - Styled as Tab Title */}
      <div className="flex justify-center">
        <button 
          onClick={onToggle}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          className={`pointer-events-auto ${handleBg} rounded-b-xl px-10 py-3 border-b border-x shadow-md flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest transition-colors cursor-pointer`}
        >
          Share
        </button>
      </div>
    </div>
  );
};

export default TopPanel;
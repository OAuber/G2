import React from 'react';

export interface CompareDualView2DProps {
  isDarkMode: boolean;
  onLocalPaneActivate: () => void;
  onPeerPaneActivate: () => void;
  localEmptyHint: React.ReactNode;
  peerEmptyHint: React.ReactNode;
  localScene: React.ReactNode;
  remoteScene: React.ReactNode;
  mergeBarAriaLabel: string;
  onMergeBarClick: () => void;
}

const CompareDualView2D: React.FC<CompareDualView2DProps> = ({
  isDarkMode,
  onLocalPaneActivate,
  onPeerPaneActivate,
  localEmptyHint,
  peerEmptyHint,
  localScene,
  remoteScene,
  mergeBarAriaLabel,
  onMergeBarClick,
}) => {
  const mergeBar = (
    <button
      type="button"
      onClick={onMergeBarClick}
      className={`shrink-0 flex w-full items-center justify-center py-1 border-y ${
        isDarkMode
          ? 'border-slate-800 bg-slate-950/80 text-slate-300 hover:bg-slate-900/90'
          : 'border-slate-200 bg-white/90 text-slate-700 hover:bg-slate-50'
      }`}
      aria-label={mergeBarAriaLabel}
    >
      <span
        className={`select-none text-[1.35rem] font-light leading-none ${
          isDarkMode ? 'text-sky-400/95' : 'text-sky-600'
        }`}
        aria-hidden
      >
        ^
      </span>
    </button>
  );

  return (
    <div className="absolute inset-0 flex flex-col min-h-0">
      <div className={`flex flex-col flex-1 min-h-0 ${isDarkMode ? 'bg-black' : 'bg-[#f0f9ff]'}`}>
        <div
          role="presentation"
          className={`flex flex-col flex-1 min-h-0 cursor-default ${
            isDarkMode ? 'bg-black' : 'bg-[#f0f9ff]'
          }`}
          onClick={onLocalPaneActivate}
        >
          <div className="flex-1 min-h-0 relative">
            {localEmptyHint ? localEmptyHint : localScene}
          </div>
        </div>

        {mergeBar}

        <div
          role="presentation"
          className={`flex flex-col flex-1 min-h-0 cursor-default ${
            isDarkMode ? 'bg-slate-800' : 'bg-slate-300'
          }`}
          onClick={onPeerPaneActivate}
        >
          <div className="flex-1 min-h-0 relative">
            {peerEmptyHint ? peerEmptyHint : remoteScene}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CompareDualView2D;

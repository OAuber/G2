import React, { useState, useEffect } from 'react';

/** Import depuis le pair : fiche complète ou blocs cochés (panneau Détails, à venir). */
export type CompareImportMode = 'full' | 'partial';

type Props = {
  isOpen: boolean;
  isDarkMode: boolean;
  title: string;
  optionFull: string;
  optionPartial: string;
  validateLabel: string;
  cancelLabel: string;
  ignoreLabel?: string;
  onCancel: () => void;
  onConfirm: (mode: CompareImportMode) => void;
  onIgnorePair?: () => void;
  /** Aperçu indicatif périmètre ascendance/descendance (Phase E). */
  branchImportHint?: string | null;
};

const CompareMergeModal: React.FC<Props> = ({
  isOpen,
  isDarkMode,
  title,
  optionFull,
  optionPartial,
  validateLabel,
  cancelLabel,
  ignoreLabel,
  onCancel,
  onConfirm,
  onIgnorePair,
  branchImportHint,
}) => {
  const [mode, setMode] = useState<CompareImportMode>('full');

  useEffect(() => {
    if (isOpen) setMode('full');
  }, [isOpen]);

  if (!isOpen) return null;

  const panel = isDarkMode ? 'bg-slate-900 border-slate-600 text-slate-100' : 'bg-white border-slate-300 text-slate-900';
  const inputCls = isDarkMode ? 'border-slate-600 text-slate-100' : 'border-slate-300 text-slate-900';

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="compare-merge-title"
    >
      <div className={`max-w-md w-full rounded-lg border shadow-xl p-4 ${panel}`}>
        <h2 id="compare-merge-title" className="text-sm font-semibold mb-3">
          {title}
        </h2>
        {branchImportHint ? (
          <p
            className={`text-[11px] leading-snug mb-3 ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}
          >
            {branchImportHint}
          </p>
        ) : null}
        <div className="space-y-2 mb-4">
          <label className={`flex items-start gap-2 cursor-pointer text-sm p-2 rounded border ${inputCls}`}>
            <input
              type="radio"
              name="compare-import-mode"
              checked={mode === 'full'}
              onChange={() => setMode('full')}
              className="shrink-0 mt-0.5"
            />
            <span>{optionFull}</span>
          </label>
          <label className={`flex items-start gap-2 cursor-pointer text-sm p-2 rounded border ${inputCls}`}>
            <input
              type="radio"
              name="compare-import-mode"
              checked={mode === 'partial'}
              onChange={() => setMode('partial')}
              className="shrink-0 mt-0.5"
            />
            <span>{optionPartial}</span>
          </label>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {onIgnorePair && ignoreLabel && (
            <button
              type="button"
              onClick={() => {
                onIgnorePair();
                onCancel();
              }}
              className={`text-xs px-3 py-1.5 rounded border mr-auto ${
                isDarkMode ? 'border-amber-700 text-amber-200 hover:bg-slate-800' : 'border-amber-400 text-amber-900 hover:bg-amber-50'
              }`}
            >
              {ignoreLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className={`text-xs px-3 py-1.5 rounded border ${
              isDarkMode ? 'border-slate-600 hover:bg-slate-800' : 'border-slate-300 hover:bg-slate-50'
            }`}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(mode)}
            className={`text-xs px-3 py-1.5 rounded font-semibold ${
              isDarkMode ? 'bg-sky-700 text-white hover:bg-sky-600' : 'bg-sky-600 text-white hover:bg-sky-500'
            }`}
          >
            {validateLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CompareMergeModal;

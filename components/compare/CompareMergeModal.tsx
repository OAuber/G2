import React, { useState, useEffect } from 'react';

export type CompareMergeMode = 'all' | 'selection';

type Props = {
  isOpen: boolean;
  isDarkMode: boolean;
  title: string;
  optionAll: string;
  optionSelection: string;
  validateLabel: string;
  cancelLabel: string;
  onCancel: () => void;
  onConfirm: (mode: CompareMergeMode) => void;
};

const CompareMergeModal: React.FC<Props> = ({
  isOpen,
  isDarkMode,
  title,
  optionAll,
  optionSelection,
  validateLabel,
  cancelLabel,
  onCancel,
  onConfirm,
}) => {
  const [mode, setMode] = useState<CompareMergeMode>('selection');

  useEffect(() => {
    if (isOpen) setMode('selection');
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
        <div className="space-y-2 mb-4">
          <label className={`flex items-center gap-2 cursor-pointer text-sm p-2 rounded border ${inputCls}`}>
            <input
              type="radio"
              name="compare-merge-mode"
              checked={mode === 'all'}
              onChange={() => setMode('all')}
              className="shrink-0"
            />
            <span>{optionAll}</span>
          </label>
          <label className={`flex items-center gap-2 cursor-pointer text-sm p-2 rounded border ${inputCls}`}>
            <input
              type="radio"
              name="compare-merge-mode"
              checked={mode === 'selection'}
              onChange={() => setMode('selection')}
              className="shrink-0"
            />
            <span>{optionSelection}</span>
          </label>
        </div>
        <div className="flex justify-end gap-2">
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

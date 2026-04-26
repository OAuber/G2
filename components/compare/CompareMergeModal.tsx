import React, { useState, useEffect } from 'react';

export type CompareImportScope = 'single' | 'ancestors' | 'descendants';
export type CompareImportDataMode = 'all' | 'custom';
export type CompareImportRequest = {
  scope: CompareImportScope;
  depth: number;
  dataMode: CompareImportDataMode;
  includeFields: boolean;
  includeDocuments: boolean;
};

type Props = {
  isOpen: boolean;
  isDarkMode: boolean;
  title: string;
  scopeSingleLabel: string;
  scopeAncestorsLabel: string;
  scopeDescendantsLabel: string;
  depthLabel: string;
  depthHelp: string;
  dataModeAllLabel: string;
  dataModeCustomLabel: string;
  dataOptionsTitle: string;
  dataOptionFields: string;
  dataOptionDocuments: string;
  validateLabel: string;
  cancelLabel: string;
  ignoreLabel?: string;
  invalidSelectionHint: string;
  allowBranchScopes?: boolean;
  onCancel: () => void;
  onConfirm: (request: CompareImportRequest) => void;
  onIgnorePair?: () => void;
  branchImportHint?: string | null;
  maxAncestorsDepth: number;
  maxDescendantsDepth: number;
};

const CompareMergeModal: React.FC<Props> = ({
  isOpen,
  isDarkMode,
  title,
  scopeSingleLabel,
  scopeAncestorsLabel,
  scopeDescendantsLabel,
  depthLabel,
  depthHelp,
  dataModeAllLabel,
  dataModeCustomLabel,
  dataOptionsTitle,
  dataOptionFields,
  dataOptionDocuments,
  validateLabel,
  cancelLabel,
  ignoreLabel,
  invalidSelectionHint,
  allowBranchScopes = true,
  onCancel,
  onConfirm,
  onIgnorePair,
  branchImportHint,
  maxAncestorsDepth,
  maxDescendantsDepth,
}) => {
  const [scope, setScope] = useState<CompareImportScope>('single');
  const [dataMode, setDataMode] = useState<CompareImportDataMode>('all');
  const [includeFields, setIncludeFields] = useState(true);
  const [includeDocuments, setIncludeDocuments] = useState(true);
  const [depth, setDepth] = useState(1);
  const [selectionError, setSelectionError] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setScope('single');
      setDataMode('all');
      setIncludeFields(true);
      setIncludeDocuments(true);
      setDepth(1);
      setSelectionError(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!allowBranchScopes && scope !== 'single') setScope('single');
  }, [allowBranchScopes, scope]);

  if (!isOpen) return null;

  const panel = isDarkMode ? 'bg-slate-900 border-slate-600 text-slate-100' : 'bg-white border-slate-300 text-slate-900';
  const inputCls = isDarkMode ? 'border-slate-600 text-slate-100 bg-slate-950/60' : 'border-slate-300 text-slate-900 bg-white';
  const currentDepthMax = scope === 'ancestors' ? maxAncestorsDepth : scope === 'descendants' ? maxDescendantsDepth : 1;
  const depthOptions = Array.from({ length: Math.max(1, currentDepthMax) }, (_, i) => i + 1);

  const submit = () => {
    const hasAnyData = dataMode === 'all' || includeFields || includeDocuments;
    if (!hasAnyData) {
      setSelectionError(true);
      return;
    }
    setSelectionError(false);
    onConfirm({
      scope,
      depth: scope === 'single' ? 1 : Math.min(depth, Math.max(1, currentDepthMax)),
      dataMode,
      includeFields: dataMode === 'all' ? true : includeFields,
      includeDocuments: dataMode === 'all' ? true : includeDocuments,
    });
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="compare-merge-title"
    >
      <div className={`max-w-md w-full max-h-[min(92vh,720px)] overflow-y-auto rounded-lg border shadow-xl p-4 space-y-3 ${panel}`}>
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <label className={`flex items-start gap-2 cursor-pointer text-sm p-2 rounded border ${inputCls}`}>
            <input
              type="radio"
              name="compare-import-scope"
              checked={scope === 'single'}
              onChange={() => setScope('single')}
              className="shrink-0 mt-0.5"
            />
            <span className="text-xs leading-snug">{scopeSingleLabel}</span>
          </label>
          <label className={`flex items-start gap-2 cursor-pointer text-sm p-2 rounded border ${inputCls}`}>
            <input
              type="radio"
              name="compare-import-scope"
              checked={scope === 'ancestors'}
              onChange={() => setScope('ancestors')}
              disabled={!allowBranchScopes}
              className="shrink-0 mt-0.5"
            />
            <span className={`text-xs leading-snug ${!allowBranchScopes ? 'opacity-50' : ''}`}>{scopeAncestorsLabel}</span>
          </label>
          <label className={`flex items-start gap-2 cursor-pointer text-sm p-2 rounded border ${inputCls}`}>
            <input
              type="radio"
              name="compare-import-scope"
              checked={scope === 'descendants'}
              onChange={() => setScope('descendants')}
              disabled={!allowBranchScopes}
              className="shrink-0 mt-0.5"
            />
            <span className={`text-xs leading-snug ${!allowBranchScopes ? 'opacity-50' : ''}`}>{scopeDescendantsLabel}</span>
          </label>
        </div>

        {scope !== 'single' && (
          <div className={`rounded-lg border p-2.5 ${inputCls}`}>
            <label className="text-[11px] font-semibold block mb-1.5">{depthLabel}</label>
            <select
              value={Math.min(depth, Math.max(1, currentDepthMax))}
              onChange={(e) => setDepth(Number(e.target.value))}
              className={`w-full rounded border px-2 py-1.5 text-xs ${inputCls}`}
            >
              {depthOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <p className={`text-[10px] mt-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>{depthHelp}</p>
          </div>
        )}

        <div className={`rounded-lg border p-2.5 space-y-2 ${inputCls}`}>
          <div className="text-[11px] font-semibold">{dataOptionsTitle}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="flex items-start gap-2 cursor-pointer text-xs">
              <input
                type="radio"
                name="compare-import-data-mode"
                checked={dataMode === 'all'}
                onChange={() => setDataMode('all')}
                className="shrink-0 mt-0.5"
              />
              <span>{dataModeAllLabel}</span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer text-xs">
              <input
                type="radio"
                name="compare-import-data-mode"
                checked={dataMode === 'custom'}
                onChange={() => setDataMode('custom')}
                className="shrink-0 mt-0.5"
              />
              <span>{dataModeCustomLabel}</span>
            </label>
          </div>
          {dataMode === 'custom' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="flex items-center gap-2 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={includeFields}
                  onChange={(e) => setIncludeFields(e.target.checked)}
                  className="h-3.5 w-3.5 shrink-0"
                />
                <span>{dataOptionFields}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={includeDocuments}
                  onChange={(e) => setIncludeDocuments(e.target.checked)}
                  className="h-3.5 w-3.5 shrink-0"
                />
                <span>{dataOptionDocuments}</span>
              </label>
            </div>
          )}
          {selectionError && (
            <div className={`text-[10px] font-medium ${isDarkMode ? 'text-rose-300' : 'text-rose-700'}`}>
              {invalidSelectionHint}
            </div>
          )}
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
            onClick={submit}
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

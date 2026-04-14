import React, { useCallback, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { InviteExchangeScope } from '../app/p2pAppTypes';
import { useI18n } from '../i18n';

const MAX_GEN = 50;
const MAX_ROOT_RESULTS = 200;

type RootCandidate = { id: string; label: string; lifeSpanLine?: string };

const ExchangeRootCombobox: React.FC<{
  value: string | undefined;
  onChangeRoot: (id: string | undefined) => void;
  rootCandidates: RootCandidate[];
  disabled: boolean;
  inputBg: string;
  textClass: string;
  subTextClass: string;
}> = ({ value, onChangeRoot, rootCandidates, disabled, inputBg, textClass, subTextClass }) => {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const selectedLabel = useMemo(() => {
    if (!value) return '';
    return rootCandidates.find((c) => c.id === value)?.label ?? value;
  }, [value, rootCandidates]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return rootCandidates.slice(0, MAX_ROOT_RESULTS);
    return rootCandidates
      .filter(
        (c) =>
          c.label.toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q) ||
          (c.lifeSpanLine && c.lifeSpanLine.toLowerCase().includes(q)),
      )
      .slice(0, MAX_ROOT_RESULTS);
  }, [rootCandidates, query]);

  const handleFocus = useCallback(() => {
    if (disabled) return;
    setOpen(true);
    setQuery('');
  }, [disabled]);

  const handleBlur = useCallback(() => {
    window.setTimeout(() => setOpen(false), 160);
  }, []);

  const pickDefault = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onChangeRoot(undefined);
      setOpen(false);
      setQuery('');
    },
    [onChangeRoot],
  );

  const pickOne = useCallback(
    (id: string) => (e: React.MouseEvent) => {
      e.preventDefault();
      onChangeRoot(id);
      setOpen(false);
      setQuery('');
    },
    [onChangeRoot],
  );

  return (
    <div className="relative">
      <input
        type="text"
        disabled={disabled}
        className={`w-full rounded border px-2 py-1 pr-7 text-sm outline-none focus:ring-1 focus:ring-blue-500/40 ${inputBg}`}
        placeholder={t('topPanel.exchangeScopeRootSearchPlaceholder')}
        value={open ? query : selectedLabel}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
      {value && !open && !disabled && (
        <button
          type="button"
          onClick={() => onChangeRoot(undefined)}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-rose-400 hover:text-rose-300"
          aria-label={t('topPanel.exchangeScopeRootClear')}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
      {open && !disabled && (
        <div
          className={`absolute z-[100] left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded border shadow-lg ${inputBg}`}
          role="listbox"
        >
          <div
            className={`px-2 py-1.5 text-xs cursor-pointer hover:bg-blue-500/20 ${subTextClass}`}
            onMouseDown={pickDefault}
          >
            {t('topPanel.exchangeScopeRootDefault')}
          </div>
          {filtered.map((c) => (
            <div
              key={c.id}
              role="option"
              className={`px-2 py-1.5 text-xs cursor-pointer hover:bg-blue-500/20 ${textClass} ${
                c.id === value ? 'bg-blue-500/25 font-semibold' : ''
              }`}
              onMouseDown={pickOne(c.id)}
            >
              <span className="break-words">{c.label}</span>
              {c.lifeSpanLine ? (
                <span className={`block text-[10px] opacity-70 ${subTextClass}`}>{c.lifeSpanLine}</span>
              ) : null}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className={`px-2 py-1.5 text-xs italic ${subTextClass}`}>{t('details.noMatch')}</div>
          )}
        </div>
      )}
    </div>
  );
};

type Props = {
  value: InviteExchangeScope;
  onChange: (next: InviteExchangeScope) => void;
  isDarkMode: boolean;
  disabled?: boolean;
  /** Fiches du GEDCOM local pour désigner la racine du périmètre (optionnel). */
  rootCandidates?: RootCandidate[];
};

export const InviteExchangeScopeForm: React.FC<Props> = ({
  value,
  onChange,
  isDarkMode,
  disabled = false,
  rootCandidates = [],
}) => {
  const { t } = useI18n();
  const inputBg = isDarkMode ? 'bg-slate-800 border-slate-600' : 'bg-white border-slate-300';
  const textClass = isDarkMode ? 'text-slate-200' : 'text-slate-800';
  const subTextClass = isDarkMode ? 'text-slate-400' : 'text-slate-600';

  const clampGen = (n: number) => Math.max(0, Math.min(MAX_GEN, Math.round(n)));

  const patchData = (partial: Partial<InviteExchangeScope['data']>) => {
    onChange({ ...value, data: { ...value.data, ...partial } });
  };

  return (
    <div className="space-y-3 text-left">
      <div>
        <h4 className={`text-xs font-bold uppercase tracking-wide mb-1 ${textClass}`}>
          {t('topPanel.exchangeScopeTitle')}
        </h4>
        <p className={`text-[11px] leading-relaxed ${subTextClass}`}>{t('topPanel.exchangeScopeIntro')}</p>
      </div>
      <label className={`flex flex-col gap-0.5 text-[11px] ${subTextClass}`}>
        <span>{t('topPanel.exchangeScopeRootIndividual')}</span>
        {rootCandidates.length > 0 ? (
          <ExchangeRootCombobox
            value={value.rootIndividualId}
            onChangeRoot={(id) => onChange({ ...value, rootIndividualId: id })}
            rootCandidates={rootCandidates}
            disabled={disabled}
            inputBg={inputBg}
            textClass={textClass}
            subTextClass={subTextClass}
          />
        ) : (
          <p className={`text-[11px] rounded border px-2 py-1.5 ${inputBg} ${subTextClass}`}>
            {t('topPanel.exchangeScopeRootNoCandidates')}
          </p>
        )}
        <span className={`text-[10px] italic mt-0.5 ${subTextClass}`}>{t('topPanel.exchangeScopeRootHint')}</span>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className={`flex flex-col gap-0.5 text-[11px] ${subTextClass}`}>
          <span>{t('topPanel.exchangeScopeMaxGenDown')}</span>
          <input
            type="number"
            min={0}
            max={MAX_GEN}
            disabled={disabled}
            value={value.maxGenDown}
            onChange={(e) =>
              onChange({ ...value, maxGenDown: clampGen(Number(e.target.value) || 0) })
            }
            className={`text-sm rounded border px-2 py-1 ${inputBg}`}
          />
        </label>
        <label className={`flex flex-col gap-0.5 text-[11px] ${subTextClass}`}>
          <span>{t('topPanel.exchangeScopeMaxGenUp')}</span>
          <input
            type="number"
            min={0}
            max={MAX_GEN}
            disabled={disabled}
            value={value.maxGenUp}
            onChange={(e) =>
              onChange({ ...value, maxGenUp: clampGen(Number(e.target.value) || 0) })
            }
            className={`text-sm rounded border px-2 py-1 ${inputBg}`}
          />
        </label>
      </div>
      <label className={`flex items-center gap-2 text-[11px] cursor-pointer ${subTextClass}`}>
        <input
          type="checkbox"
          disabled={disabled}
          checked={value.includeSpouses}
          onChange={(e) => onChange({ ...value, includeSpouses: e.target.checked })}
          className="rounded border-slate-400"
        />
        <span>{t('topPanel.exchangeScopeIncludeSpouses')}</span>
      </label>
      <div className={`text-[11px] font-semibold uppercase tracking-wide ${textClass}`}>
        {t('topPanel.exchangeScopeDataSection')}
      </div>
      <div className="space-y-1.5">
        <label className={`flex items-center gap-2 text-[11px] cursor-pointer ${subTextClass}`}>
          <input
            type="checkbox"
            disabled={disabled}
            checked={value.data.vital}
            onChange={(e) => patchData({ vital: e.target.checked })}
            className="rounded border-slate-400"
          />
          <span>{t('topPanel.exchangeScopeDataVital')}</span>
        </label>
        <label className={`flex items-center gap-2 text-[11px] cursor-pointer ${subTextClass}`}>
          <input
            type="checkbox"
            disabled={disabled}
            checked={value.data.relations}
            onChange={(e) => patchData({ relations: e.target.checked })}
            className="rounded border-slate-400"
          />
          <span>{t('topPanel.exchangeScopeDataRelations')}</span>
        </label>
        <label className={`flex items-center gap-2 text-[11px] cursor-pointer ${subTextClass}`}>
          <input
            type="checkbox"
            disabled={disabled}
            checked={value.data.media}
            onChange={(e) => patchData({ media: e.target.checked })}
            className="rounded border-slate-400"
          />
          <span>{t('topPanel.exchangeScopeDataMedia')}</span>
        </label>
        <label className={`flex items-center gap-2 text-[11px] cursor-pointer ${subTextClass}`}>
          <input
            type="checkbox"
            disabled={disabled}
            checked={value.data.notes}
            onChange={(e) => patchData({ notes: e.target.checked })}
            className="rounded border-slate-400"
          />
          <span>{t('topPanel.exchangeScopeDataNotes')}</span>
        </label>
      </div>
    </div>
  );
};

import { useCallback, useEffect, useState } from 'react';
import {
  daysInMonth,
  parseDateParts,
  partsToDocDateString,
  partsToGedcomString,
} from '../services/genealogyDate';

export type GenealogyDateFieldProps = {
  /** Chaîne actuelle (GEDCOM / année / ISO selon le mode). */
  value: string;
  onChange: (next: string) => void;
  /** `gedcom` : chaîne pour `parseDate` (fiches). `isoDoc` : yyyy / yyyy-mm / yyyy-mm-dd pour documents. */
  mode: 'gedcom' | 'isoDoc';
  inputBg: string;
  textClass: string;
  subTextClass: string;
  language: 'fr' | 'en';
  labels: {
    year: string;
    refine: string;
    hideRefine: string;
    month: string;
    day: string;
    monthPlaceholder: string;
    dayPlaceholder: string;
  };
  disabled?: boolean;
};

function monthLabel(m: number, lang: 'fr' | 'en'): string {
  const d = new Date(2000, m - 1, 1);
  return d.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { month: 'short' });
}

export function GenealogyDateField({
  value,
  onChange,
  mode,
  inputBg,
  textClass,
  subTextClass,
  language,
  labels,
  disabled = false,
}: GenealogyDateFieldProps) {
  const parsed = parseDateParts(value);
  const [yearText, setYearText] = useState(() => (parsed.year != null ? String(parsed.year) : ''));
  const [month, setMonth] = useState<number | ''>(parsed.month ?? '');
  const [day, setDay] = useState<number | ''>(parsed.day ?? '');
  const [showRefine, setShowRefine] = useState(() => parsed.month != null || parsed.day != null);

  useEffect(() => {
    const p = parseDateParts(value);
    setYearText(p.year != null ? String(p.year) : '');
    setMonth(p.month ?? '');
    setDay(p.day ?? '');
    if (p.month != null || p.day != null) setShowRefine(true);
  }, [value]);

  const emit = useCallback(
    (y: number | null, m: number | null, d: number | null) => {
      if (y == null || !Number.isFinite(y)) {
        onChange('');
        return;
      }
      let dd = d;
      const mm = m;
      if (mm != null && dd != null) {
        const dim = daysInMonth(y, mm);
        dd = Math.min(dd, dim);
      }
      const parts = { year: y, month: mm, day: dd };
      onChange(mode === 'gedcom' ? partsToGedcomString(parts) : partsToDocDateString(parts));
    },
    [mode, onChange],
  );

  const commitYear = useCallback(() => {
    const trimmed = yearText.trim();
    if (!trimmed) {
      onChange('');
      return;
    }
    const y = parseInt(trimmed, 10);
    if (!Number.isFinite(y) || y < 1 || y > 9999) {
      const p = parseDateParts(value);
      setYearText(p.year != null ? String(p.year) : '');
      return;
    }
    if (!showRefine) {
      emit(y, null, null);
      return;
    }
    const m = month === '' ? null : month;
    const d = day === '' ? null : day;
    emit(y, m, d);
  }, [yearText, showRefine, month, day, emit, onChange, value]);

  const onMonthChange = (v: string) => {
    const m = v === '' ? '' : parseInt(v, 10);
    setMonth(m);
    const y = parseInt(yearText.trim(), 10);
    if (!Number.isFinite(y)) return;
    let d = day === '' ? null : day;
    if (m !== '' && d != null) {
      const dim = daysInMonth(y, m);
      if (d > dim) {
        d = dim;
        setDay(dim);
      }
    }
    if (!showRefine) return;
    emit(y, m === '' ? null : m, d);
  };

  const onDayChange = (v: string) => {
    const d = v === '' ? '' : parseInt(v, 10);
    setDay(d);
    const y = parseInt(yearText.trim(), 10);
    if (!Number.isFinite(y)) return;
    const m = month === '' ? null : month;
    if (!showRefine) return;
    emit(y, m, d === '' ? null : d);
  };

  const maxDay =
    month !== '' && Number.isFinite(parseInt(yearText.trim(), 10))
      ? daysInMonth(parseInt(yearText.trim(), 10), month as number)
      : 31;

  return (
    <div className="space-y-1.5">
      <label className={`block text-[10px] ${subTextClass}`}>{labels.year}</label>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        className={`w-full max-w-[8.5rem] rounded px-2 py-1 text-sm border outline-none ${inputBg} ${textClass}`}
        value={yearText}
        onChange={(e) => setYearText(e.target.value.replace(/\D/g, '').slice(0, 4))}
        onBlur={commitYear}
        placeholder="1652"
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (showRefine) {
            setShowRefine(false);
            setMonth('');
            setDay('');
            const y = parseInt(yearText.trim(), 10);
            if (Number.isFinite(y)) emit(y, null, null);
            else onChange('');
          } else {
            setShowRefine(true);
          }
        }}
        className={`text-[10px] underline-offset-2 hover:underline ${subTextClass}`}
      >
        {showRefine ? labels.hideRefine : labels.refine}
      </button>
      {showRefine && (
        <div className="flex flex-wrap items-end gap-2 pt-0.5">
          <div className="min-w-0 flex-1">
            <label className={`block text-[9px] mb-0.5 ${subTextClass}`}>{labels.month}</label>
            <select
              disabled={disabled}
              className={`w-full min-w-0 rounded px-1.5 py-1 text-xs border outline-none ${inputBg} ${textClass}`}
              value={month === '' ? '' : String(month)}
              onChange={(e) => onMonthChange(e.target.value)}
            >
              <option value="">{labels.monthPlaceholder}</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={String(m)}>
                  {monthLabel(m, language)}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0 flex-1">
            <label className={`block text-[9px] mb-0.5 ${subTextClass}`}>{labels.day}</label>
            <select
              disabled={disabled || month === ''}
              className={`w-full min-w-0 rounded px-1.5 py-1 text-xs border outline-none ${inputBg} ${textClass}`}
              value={day === '' ? '' : String(day)}
              onChange={(e) => onDayChange(e.target.value)}
            >
              <option value="">{labels.dayPlaceholder}</option>
              {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
                <option key={d} value={String(d)}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

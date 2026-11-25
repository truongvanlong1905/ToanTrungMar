'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { StandardDatePreset } from './StandardDateRangeDropdown';

export interface GoogleAdsDateApplyPayload {
  preset: StandardDatePreset;
  from: string;
  to: string;
  label?: string;
}

export interface GoogleAdsDateRangePickerProps {
  preset: string;
  from?: string;
  to?: string;
  allowAll?: boolean;
  showCompareToggle?: boolean;
  compareEnabled?: boolean;
  onToggleCompare?: (checked: boolean) => void;
  onApply: (next: GoogleAdsDateApplyPayload) => void;
  size?: 'sm' | 'md';
  align?: 'left' | 'right';
  showStepButtons?: boolean;
  className?: string;
}

type PresetMenuKey =
  | 'CUSTOM'
  | 'TODAY'
  | 'YESTERDAY'
  | 'THIS_WEEK'
  | '7D'
  | 'LAST_WEEK'
  | '14D'
  | 'THIS_MONTH'
  | '30D'
  | 'LAST_MONTH'
  | 'ALL_TIME'
  | 'N_TO_TODAY'
  | 'N_TO_YESTERDAY';

const MONTH_SHORT_VI = [
  'THG 1',
  'THG 2',
  'THG 3',
  'THG 4',
  'THG 5',
  'THG 6',
  'THG 7',
  'THG 8',
  'THG 9',
  'THG 10',
  'THG 11',
  'THG 12',
];

function formatVnYmd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function addDaysYmd(ymd: string, deltaDays: number): string {
  const noon = new Date(`${ymd}T12:00:00+07:00`);
  noon.setDate(noon.getDate() + deltaDays);
  return formatVnYmd(noon);
}

function getMondayOfWeekYmd(ymd: string): string {
  const noon = new Date(`${ymd}T12:00:00+07:00`);
  const dow = noon.getDay(); // 0=Sun, 1=Mon...
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  noon.setDate(noon.getDate() + diffToMon);
  return formatVnYmd(noon);
}

function getLastMonthRange(todayYmd: string): { from: string; to: string } {
  const [yStr, mStr] = todayYmd.split('-');
  let y = Number(yStr);
  let m = Number(mStr) - 1;
  if (m === 0) {
    m = 12;
    y -= 1;
  }
  const mm = String(m).padStart(2, '0');
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    from: `${y}-${mm}-01`,
    to: `${y}-${mm}-${String(lastDay).padStart(2, '0')}`,
  };
}

function countInclusiveDays(from: string, to: string): number {
  if (!from || !to) return 0;
  const s = Date.parse(`${from}T00:00:00Z`);
  const e = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return 0;
  return Math.round((e - s) / 86_400_000) + 1;
}

function formatDisplayDate(ymd: string): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '—';
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

function formatShortViTitleDate(ymd: string): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '';
  const [y, m, d] = ymd.split('-');
  return `${Number(d)} thg ${Number(m)}, ${y}`;
}

function parseUserDateInput(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dm = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (!dm) return null;
  const dd = Number(dm[1]);
  const mm = Number(dm[2]);
  const yyyy = Number(dm[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const test = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (
    test.getUTCFullYear() !== yyyy ||
    test.getUTCMonth() !== mm - 1 ||
    test.getUTCDate() !== dd
  ) {
    return null;
  }
  return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

interface MonthGrid {
  year: number;
  month: number; // 1..12
  key: string;
  cells: Array<{ ymd: string; day: number } | null>;
}

function buildMonthGrid(year: number, month: number): MonthGrid {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0=Sun..6=Sat
  const offset = firstDow === 0 ? 6 : firstDow - 1; // T2=0..CN=6
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: Array<{ ymd: string; day: number } | null> = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  const mm = String(month).padStart(2, '0');
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      ymd: `${year}-${mm}-${String(d).padStart(2, '0')}`,
      day: d,
    });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return { year, month, key: `${year}-${mm}`, cells };
}

function shiftYearMonth(year: number, month: number, deltaMonths: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + deltaMonths;
  return {
    year: Math.floor(total / 12),
    month: (total % 12 + 12) % 12 + 1,
  };
}

export function GoogleAdsDateRangePicker({
  preset,
  from = '',
  to = '',
  allowAll = false,
  showCompareToggle = false,
  compareEnabled = false,
  onToggleCompare,
  onApply,
  size = 'sm',
  align = 'right',
  showStepButtons = false,
  className = '',
}: GoogleAdsDateRangePickerProps) {
  const todayStr = useMemo(() => formatVnYmd(new Date()), []);
  const yesterdayStr = useMemo(() => addDaysYmd(todayStr, -1), [todayStr]);

  const computeRangeForPreset = useCallback(
    (
      key: PresetMenuKey,
      nToday: number,
      nYest: number,
    ): { from: string; to: string; outPreset: StandardDatePreset } => {
      switch (key) {
        case 'TODAY':
          return { from: todayStr, to: todayStr, outPreset: 'TODAY' };
        case 'YESTERDAY':
          return { from: yesterdayStr, to: yesterdayStr, outPreset: 'YESTERDAY' };
        case 'THIS_WEEK':
          return { from: getMondayOfWeekYmd(todayStr), to: todayStr, outPreset: 'CUSTOM' };
        case '7D':
          return { from: addDaysYmd(todayStr, -6), to: todayStr, outPreset: '7D' };
        case 'LAST_WEEK': {
          const thisMon = getMondayOfWeekYmd(todayStr);
          return {
            from: addDaysYmd(thisMon, -7),
            to: addDaysYmd(thisMon, -1),
            outPreset: 'CUSTOM',
          };
        }
        case '14D':
          return { from: addDaysYmd(todayStr, -13), to: todayStr, outPreset: 'CUSTOM' };
        case 'THIS_MONTH':
          return { from: `${todayStr.slice(0, 7)}-01`, to: todayStr, outPreset: 'THIS_MONTH' };
        case '30D':
          return { from: addDaysYmd(todayStr, -29), to: todayStr, outPreset: '30D' };
        case 'LAST_MONTH': {
          const lm = getLastMonthRange(todayStr);
          return { ...lm, outPreset: 'CUSTOM' };
        }
        case 'ALL_TIME':
          if (allowAll) {
            return { from: '', to: '', outPreset: 'ALL' };
          }
          return { from: addDaysYmd(todayStr, -364), to: todayStr, outPreset: 'CUSTOM' };
        case 'N_TO_TODAY': {
          const safeN = Math.max(1, Math.min(365, Math.round(nToday || 30)));
          return { from: addDaysYmd(todayStr, -(safeN - 1)), to: todayStr, outPreset: 'CUSTOM' };
        }
        case 'N_TO_YESTERDAY': {
          const safeN = Math.max(1, Math.min(365, Math.round(nYest || 30)));
          return { from: addDaysYmd(yesterdayStr, -(safeN - 1)), to: yesterdayStr, outPreset: 'CUSTOM' };
        }
        case 'CUSTOM':
        default:
          return {
            from: from || addDaysYmd(todayStr, -6),
            to: to || todayStr,
            outPreset: 'CUSTOM',
          };
      }
    },
    [allowAll, from, to, todayStr, yesterdayStr],
  );

  const resolveCurrentRange = useCallback((): {
    menuKey: PresetMenuKey;
    startDate: string;
    endDate: string;
  } => {
    const p = String(preset || (allowAll ? 'ALL' : '7D')).toUpperCase();
    if (p === 'ALL') return { menuKey: 'ALL_TIME', startDate: '', endDate: '' };
    if (p === 'TODAY') return { menuKey: 'TODAY', startDate: todayStr, endDate: todayStr };
    if (p === 'YESTERDAY') return { menuKey: 'YESTERDAY', startDate: yesterdayStr, endDate: yesterdayStr };
    if (p === '7D') return { menuKey: '7D', startDate: addDaysYmd(todayStr, -6), endDate: todayStr };
    if (p === '30D') return { menuKey: '30D', startDate: addDaysYmd(todayStr, -29), endDate: todayStr };
    if (p === '90D') return { menuKey: 'CUSTOM', startDate: addDaysYmd(todayStr, -89), endDate: todayStr };
    if (p === 'THIS_MONTH') return { menuKey: 'THIS_MONTH', startDate: `${todayStr.slice(0, 7)}-01`, endDate: todayStr };
    if (from || to) {
      const s = from || to;
      const e = to || from;
      return s <= e
        ? { menuKey: 'CUSTOM', startDate: s, endDate: e }
        : { menuKey: 'CUSTOM', startDate: e, endDate: s };
    }
    return { menuKey: '7D', startDate: addDaysYmd(todayStr, -6), endDate: todayStr };
  }, [allowAll, from, preset, to, todayStr, yesterdayStr]);

  const [open, setOpen] = useState(false);
  const [menuKey, setMenuKey] = useState<PresetMenuKey>('7D');
  const [draftStart, setDraftStart] = useState<string>(() => addDaysYmd(todayStr, -6));
  const [draftEnd, setDraftEnd] = useState<string>(() => todayStr);
  const [startInputText, setStartInputText] = useState('');
  const [endInputText, setEndInputText] = useState('');
  const [nDaysToday, setNDaysToday] = useState(30);
  const [nDaysYesterday, setNDaysYesterday] = useState(30);
  const [viewBaseYm, setViewBaseYm] = useState<{ year: number; month: number }>(() => {
    const [y, m] = todayStr.split('-').map(Number);
    return shiftYearMonth(y, m, -2);
  });

  // Drag & 2-Click Selection state
  const [clickStage, setClickStage] = useState<'start' | 'end'>('start');
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const isDraggingRef = useRef(false);
  const dragAnchorRef = useRef<string | null>(null);
  const didDragMoveRef = useRef(false);
  const stageAtMouseDownRef = useRef<'start' | 'end'>('start');
  const scrollPaneRef = useRef<HTMLDivElement | null>(null);

  const syncDraftFromProps = useCallback(() => {
    const cur = resolveCurrentRange();
    setMenuKey(cur.menuKey);
    const s = cur.startDate || addDaysYmd(todayStr, -29);
    const e = cur.endDate || todayStr;
    setDraftStart(cur.menuKey === 'ALL_TIME' && allowAll ? '' : s);
    setDraftEnd(cur.menuKey === 'ALL_TIME' && allowAll ? '' : e);
    setStartInputText(cur.menuKey === 'ALL_TIME' && allowAll ? '' : formatDisplayDate(s));
    setEndInputText(cur.menuKey === 'ALL_TIME' && allowAll ? '' : formatDisplayDate(e));
    const refEnd = e || todayStr;
    const [y, m] = refEnd.split('-').map(Number);
    setViewBaseYm(shiftYearMonth(y, m, -2));
    setClickStage('start');
    setHoverDate(null);
  }, [allowAll, resolveCurrentRange, todayStr]);

  useEffect(() => {
    if (open) {
      syncDraftFromProps();
      requestAnimationFrame(() => {
        if (scrollPaneRef.current) {
          scrollPaneRef.current.scrollTop = scrollPaneRef.current.scrollHeight;
        }
      });
    }
  }, [open, syncDraftFromProps]);

  useEffect(() => {
    const onGlobalMouseUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      if (didDragMoveRef.current) {
        setClickStage('start');
        setHoverDate(null);
      } else {
        setClickStage(stageAtMouseDownRef.current === 'start' ? 'end' : 'start');
        if (stageAtMouseDownRef.current === 'end') {
          setHoverDate(null);
        }
      }
      didDragMoveRef.current = false;
    };
    window.addEventListener('mouseup', onGlobalMouseUp);
    return () => window.removeEventListener('mouseup', onGlobalMouseUp);
  }, []);

  const months = useMemo(() => {
    const list: MonthGrid[] = [];
    for (let i = 0; i < 3; i++) {
      const ym = shiftYearMonth(viewBaseYm.year, viewBaseYm.month, i);
      list.push(buildMonthGrid(ym.year, ym.month));
    }
    return list;
  }, [viewBaseYm]);

  const monthSelectOptions = useMemo(() => {
    const opts: Array<{ year: number; month: number; label: string; value: string }> = [];
    const [curY, curM] = todayStr.split('-').map(Number);
    for (let i = -24; i <= 0; i++) {
      const ym = shiftYearMonth(curY, curM, i);
      opts.push({
        year: ym.year,
        month: ym.month,
        label: `${MONTH_SHORT_VI[ym.month - 1]} ${ym.year}`,
        value: `${ym.year}-${String(ym.month).padStart(2, '0')}`,
      });
    }
    return opts;
  }, [todayStr]);

  const activeVisualRange = useMemo(() => {
    if (clickStage === 'end' && dragAnchorRef.current && hoverDate) {
      const a = dragAnchorRef.current;
      const b = hoverDate;
      return a <= b ? { s: a, e: b } : { s: b, e: a };
    }
    if (!draftStart && !draftEnd) return { s: '', e: '' };
    const s = draftStart || draftEnd;
    const e = draftEnd || draftStart;
    return s <= e ? { s, e } : { s: e, e: s };
  }, [clickStage, draftEnd, draftStart, hoverDate]);

  const selectLeftPreset = (key: PresetMenuKey, autoApply = false) => {
    setMenuKey(key);
    setClickStage('start');
    setHoverDate(null);
    const r = computeRangeForPreset(key, nDaysToday, nDaysYesterday);
    setDraftStart(r.from);
    setDraftEnd(r.to);
    setStartInputText(r.from ? formatDisplayDate(r.from) : '');
    setEndInputText(r.to ? formatDisplayDate(r.to) : '');
    if (r.to) {
      const [y, m] = r.to.split('-').map(Number);
      setViewBaseYm(shiftYearMonth(y, m, -2));
      requestAnimationFrame(() => {
        if (scrollPaneRef.current) {
          scrollPaneRef.current.scrollTop = scrollPaneRef.current.scrollHeight;
        }
      });
    }
    if (autoApply) {
      onApply({ preset: r.outPreset, from: r.from, to: r.to });
      setOpen(false);
    }
  };

  const handleCellMouseDown = (ymd: string) => {
    if (ymd > todayStr) return;
    stageAtMouseDownRef.current = clickStage;
    isDraggingRef.current = true;
    didDragMoveRef.current = false;
    setMenuKey('CUSTOM');

    if (clickStage === 'end' && dragAnchorRef.current) {
      const a = dragAnchorRef.current;
      const [s, e] = a <= ymd ? [a, ymd] : [ymd, a];
      setDraftStart(s);
      setDraftEnd(e);
      setStartInputText(formatDisplayDate(s));
      setEndInputText(formatDisplayDate(e));
    } else {
      dragAnchorRef.current = ymd;
      setDraftStart(ymd);
      setDraftEnd(ymd);
      setStartInputText(formatDisplayDate(ymd));
      setEndInputText(formatDisplayDate(ymd));
    }
  };

  const handleCellMouseEnter = (ymd: string) => {
    if (ymd > todayStr) return;
    if (isDraggingRef.current && dragAnchorRef.current) {
      const anchor = dragAnchorRef.current;
      if (ymd !== anchor) {
        didDragMoveRef.current = true;
      }
      const [s, e] = anchor <= ymd ? [anchor, ymd] : [ymd, anchor];
      setDraftStart(s);
      setDraftEnd(e);
      setStartInputText(formatDisplayDate(s));
      setEndInputText(formatDisplayDate(e));
    } else if (clickStage === 'end') {
      setHoverDate(ymd);
    }
  };

  const commitTextInputs = (which: 'start' | 'end', val: string) => {
    const parsed = parseUserDateInput(val);
    if (!parsed || parsed > todayStr) return;
    setMenuKey('CUSTOM');
    if (which === 'start') {
      const nextEnd = draftEnd && parsed > draftEnd ? parsed : draftEnd || parsed;
      setDraftStart(parsed);
      setDraftEnd(nextEnd);
      setStartInputText(formatDisplayDate(parsed));
      setEndInputText(formatDisplayDate(nextEnd));
    } else {
      const nextStart = draftStart && parsed < draftStart ? parsed : draftStart || parsed;
      setDraftStart(nextStart);
      setDraftEnd(parsed);
      setStartInputText(formatDisplayDate(nextStart));
      setEndInputText(formatDisplayDate(parsed));
    }
  };

  const handleApplyClick = () => {
    if (menuKey === 'ALL_TIME' && allowAll) {
      onApply({ preset: 'ALL', from: '', to: '' });
      setOpen(false);
      return;
    }
    const r = computeRangeForPreset(menuKey, nDaysToday, nDaysYesterday);
    if (menuKey === 'CUSTOM' || menuKey === 'N_TO_TODAY' || menuKey === 'N_TO_YESTERDAY') {
      const s = draftStart || r.from;
      const e = draftEnd || r.to;
      const [minS, maxE] = s <= e ? [s, e] : [e, s];
      onApply({ preset: 'CUSTOM', from: minS, to: maxE });
    } else {
      onApply({ preset: r.outPreset, from: r.from, to: r.to });
    }
    setOpen(false);
  };

  const currentInfo = resolveCurrentRange();
  const buttonLabel = useMemo(() => {
    if (currentInfo.menuKey === 'ALL_TIME') return 'Từ trước đến nay';
    if (currentInfo.menuKey === 'TODAY') return `Hôm nay (${formatDisplayDate(todayStr)})`;
    if (currentInfo.menuKey === 'YESTERDAY') return `Hôm qua (${formatDisplayDate(yesterdayStr)})`;
    if (currentInfo.menuKey === '7D') return '7 ngày qua';
    if (currentInfo.menuKey === '30D') return '30 ngày qua';
    if (currentInfo.menuKey === 'THIS_MONTH') return 'Tháng này';
    if (currentInfo.startDate && currentInfo.endDate) {
      const days = countInclusiveDays(currentInfo.startDate, currentInfo.endDate);
      return `${formatDisplayDate(currentInfo.startDate)} – ${formatDisplayDate(currentInfo.endDate)} (${days} ngày)`;
    }
    return 'Chọn ngày';
  }, [currentInfo, todayStr, yesterdayStr]);

  const draftDaysCount = useMemo(() => {
    if (menuKey === 'ALL_TIME' && allowAll) return null;
    if (!draftStart || !draftEnd) return 0;
    return countInclusiveDays(
      draftStart <= draftEnd ? draftStart : draftEnd,
      draftStart <= draftEnd ? draftEnd : draftStart,
    );
  }, [allowAll, draftEnd, draftStart, menuKey]);

  const focusYmValue = `${months[1]?.year || viewBaseYm.year}-${String(months[1]?.month || viewBaseYm.month).padStart(2, '0')}`;
  const currentStepDays =
    currentInfo.menuKey !== 'ALL_TIME' && currentInfo.startDate && currentInfo.endDate
      ? Math.max(1, countInclusiveDays(currentInfo.startDate, currentInfo.endDate))
      : 0;
  const canStepForward =
    currentStepDays > 0 && Boolean(currentInfo.endDate && currentInfo.endDate < todayStr);

  const handleStepRange = (direction: -1 | 1) => {
    if (!currentStepDays || !currentInfo.startDate || !currentInfo.endDate) return;
    if (direction === -1) {
      const nextFrom = addDaysYmd(currentInfo.startDate, -currentStepDays);
      const nextTo = addDaysYmd(currentInfo.endDate, -currentStepDays);
      onApply({ preset: 'CUSTOM', from: nextFrom, to: nextTo });
      return;
    }
    if (currentInfo.endDate >= todayStr) return;
    const rawTo = addDaysYmd(currentInfo.endDate, currentStepDays);
    const nextTo = rawTo > todayStr ? todayStr : rawTo;
    const nextFrom = addDaysYmd(nextTo, -(currentStepDays - 1));
    onApply({ preset: 'CUSTOM', from: nextFrom, to: nextTo });
  };

  return (
    <div
      className={`relative inline-block text-left ${className}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) setOpen(false);
      }}
    >
      <div className="inline-flex items-center gap-1">
        <div className="inline-flex items-center rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 transition shadow-2xs">
          <button
            type="button"
            aria-expanded={open}
            aria-haspopup="dialog"
            title={
              currentInfo.startDate && currentInfo.endDate
                ? `${formatShortViTitleDate(currentInfo.startDate)} – ${formatShortViTitleDate(currentInfo.endDate)}`
                : undefined
            }
            onClick={() => setOpen((p) => !p)}
            className={`${
              size === 'md' ? 'h-10 px-3.5 text-xs sm:text-sm' : 'h-8 px-3 text-xs'
            } font-semibold inline-flex items-center gap-2 text-slate-800 rounded-xl`}
          >
            <Calendar className="w-3.5 h-3.5 text-[#1E3A8A] shrink-0" />
            <span className="truncate max-w-[260px]">{buttonLabel}</span>
            <ChevronDown
              className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? 'rotate-180 text-[#1E3A8A]' : ''}`}
            />
          </button>

          {allowAll && preset !== 'ALL' && (
            <button
              type="button"
              onClick={() => onApply({ preset: 'ALL', from: '', to: '' })}
              title="Đặt lại tất cả thời gian"
              className="h-8 px-2 text-slate-400 hover:text-rose-600 border-l border-slate-200/80 transition"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {showStepButtons && currentStepDays > 0 && (
          <div className="inline-flex items-center rounded-xl border border-slate-200/90 bg-white shadow-2xs overflow-hidden">
            <button
              type="button"
              onClick={() => handleStepRange(-1)}
              title={`Kỳ trước (${currentStepDays} ngày)`}
              aria-label={`Lùi ${currentStepDays} ngày`}
              className={`${size === 'md' ? 'h-10 w-8' : 'h-8 w-7'} grid place-items-center text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition`}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              disabled={!canStepForward}
              onClick={() => handleStepRange(1)}
              title={canStepForward ? `Kỳ sau (${currentStepDays} ngày)` : 'Đã đến ngày hôm nay'}
              aria-label={`Tiến ${currentStepDays} ngày`}
              className={`${size === 'md' ? 'h-10 w-8' : 'h-8 w-7'} grid place-items-center border-l border-slate-200/80 text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-35 disabled:hover:bg-white transition`}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label="Chọn khoảng ngày theo dõi"
            className={`absolute ${
              align === 'left' ? 'left-0' : 'right-0'
            } mt-2 z-50 w-[min(96vw,595px)] bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden text-xs text-slate-700`}
          >
            <div className="flex flex-col sm:flex-row">
              {/* Cột trái: Presets giống Google Ads + N ngày tính đến hôm nay/hôm qua + So sánh */}
              <div className="w-full sm:w-[235px] shrink-0 border-b sm:border-b-0 sm:border-r border-slate-200 bg-white flex flex-col justify-between py-2">
                <div className="space-y-0.5 max-h-[310px] overflow-y-auto px-1.5">
                  <button
                    type="button"
                    onClick={() => setMenuKey('CUSTOM')}
                    className={`w-full text-left px-3 py-1.5 rounded-lg transition ${
                      menuKey === 'CUSTOM'
                        ? 'bg-blue-50 text-[#1E3A8A] font-semibold'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Tuỳ chỉnh
                  </button>

                  <div className="my-1 border-t border-slate-100" />

                  {(
                    [
                      { id: 'TODAY', label: 'Hôm nay' },
                      { id: 'YESTERDAY', label: 'Hôm qua' },
                      { id: 'THIS_WEEK', label: 'Tuần này (Thứ 2 – Hôm nay)', arrow: true },
                      { id: '7D', label: '7 ngày qua' },
                      { id: 'LAST_WEEK', label: 'Tuần trước (Thứ 2 – CN)', arrow: true },
                      { id: '14D', label: '14 ngày qua' },
                      { id: 'THIS_MONTH', label: 'Tháng này' },
                      { id: '30D', label: '30 ngày qua' },
                      { id: 'LAST_MONTH', label: 'Tháng trước' },
                      { id: 'ALL_TIME', label: 'Từ trước đến nay' },
                    ] as Array<{ id: PresetMenuKey; label: string; arrow?: boolean }>
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => selectLeftPreset(opt.id, true)}
                      className={`w-full text-left px-3 py-1.5 rounded-lg flex items-center justify-between transition ${
                        menuKey === opt.id
                          ? 'bg-blue-50 text-[#1E3A8A] font-semibold'
                          : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span>{opt.label}</span>
                      {opt.arrow && <ChevronRight className="w-3 h-3 text-slate-400" />}
                    </button>
                  ))}

                  {/* 2 ô nhập nhanh "[N] ngày tính đến hôm nay / hôm qua" */}
                  <div className="pt-1.5 mt-1.5 border-t border-slate-100 space-y-1.5 px-1.5 pb-1">
                    <div
                      onClick={() => selectLeftPreset('N_TO_TODAY')}
                      className={`flex items-center gap-2 px-1.5 py-1 rounded-lg cursor-pointer ${
                        menuKey === 'N_TO_TODAY' ? 'bg-blue-50 text-[#1E3A8A] font-semibold' : 'hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={nDaysToday}
                        onFocus={() => selectLeftPreset('N_TO_TODAY')}
                        onChange={(e) => {
                          const n = Math.max(1, Math.min(365, Number(e.target.value) || 1));
                          setNDaysToday(n);
                          setMenuKey('N_TO_TODAY');
                          const f = addDaysYmd(todayStr, -(n - 1));
                          setDraftStart(f);
                          setDraftEnd(todayStr);
                          setStartInputText(formatDisplayDate(f));
                          setEndInputText(formatDisplayDate(todayStr));
                        }}
                        className="w-12 h-7 px-1.5 text-center rounded-md border border-slate-300 bg-white text-slate-900 font-semibold focus:border-[#1A73E8] focus:outline-none"
                      />
                      <span className="text-[11px] leading-tight">ngày tính đến hôm nay</span>
                    </div>

                    <div
                      onClick={() => selectLeftPreset('N_TO_YESTERDAY')}
                      className={`flex items-center gap-2 px-1.5 py-1 rounded-lg cursor-pointer ${
                        menuKey === 'N_TO_YESTERDAY' ? 'bg-blue-50 text-[#1E3A8A] font-semibold' : 'hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={nDaysYesterday}
                        onFocus={() => selectLeftPreset('N_TO_YESTERDAY')}
                        onChange={(e) => {
                          const n = Math.max(1, Math.min(365, Number(e.target.value) || 1));
                          setNDaysYesterday(n);
                          setMenuKey('N_TO_YESTERDAY');
                          const f = addDaysYmd(yesterdayStr, -(n - 1));
                          setDraftStart(f);
                          setDraftEnd(yesterdayStr);
                          setStartInputText(formatDisplayDate(f));
                          setEndInputText(formatDisplayDate(yesterdayStr));
                        }}
                        className="w-12 h-7 px-1.5 text-center rounded-md border border-slate-300 bg-white text-slate-900 font-semibold focus:border-[#1A73E8] focus:outline-none"
                      />
                      <span className="text-[11px] leading-tight">ngày tính đến hôm qua</span>
                    </div>
                  </div>
                </div>

                {showCompareToggle && onToggleCompare && (
                  <div className="pt-2 mt-1 border-t border-slate-200 px-3 flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-700">So sánh kỳ trước</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={compareEnabled}
                      onClick={() => onToggleCompare(!compareEnabled)}
                      className={`w-9 h-5 rounded-full transition-colors p-0.5 ${
                        compareEnabled ? 'bg-[#1A73E8]' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`block w-4 h-4 rounded-full bg-white shadow-xs transition-transform ${
                          compareEnabled ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                )}
              </div>

              {/* Cột phải: Ô Ngày bắt đầu / Ngày kết thúc + Lịch cuộn T2..CN kéo chọn ngày */}
              <div className="flex-1 flex flex-col min-w-0 bg-white">
                {/* Hàng 2 ô nhập Ngày bắt đầu* — Ngày kết thúc* */}
                <div className="p-3 pb-2 flex items-center gap-2 border-b border-slate-100">
                  <div className="flex-1">
                    <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                      Ngày bắt đầu*
                    </label>
                    <input
                      type="text"
                      value={startInputText}
                      onChange={(e) => setStartInputText(e.target.value)}
                      onBlur={() => commitTextInputs('start', startInputText)}
                      onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                        if (e.key === 'Enter') commitTextInputs('start', startInputText);
                      }}
                      placeholder="dd/mm/yyyy"
                      className="w-full h-8 px-2.5 rounded-lg border border-slate-400 focus:border-[#1A73E8] focus:outline-none text-xs font-medium text-slate-900 tabular-nums"
                    />
                  </div>
                  <span className="text-slate-400 mt-4">–</span>
                  <div className="flex-1">
                    <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                      Ngày kết thúc*
                    </label>
                    <input
                      type="text"
                      value={endInputText}
                      onChange={(e) => setEndInputText(e.target.value)}
                      onBlur={() => commitTextInputs('end', endInputText)}
                      onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                        if (e.key === 'Enter') commitTextInputs('end', endInputText);
                      }}
                      placeholder="dd/mm/yyyy"
                      className="w-full h-8 px-2.5 rounded-lg border border-slate-300 focus:border-[#1A73E8] focus:outline-none text-xs font-medium text-slate-900 tabular-nums"
                    />
                  </div>
                </div>

                {/* Thanh điều hướng Tháng + < > */}
                <div className="px-3 py-2 flex items-center justify-between">
                  <select
                    aria-label="Chọn tháng hiển thị"
                    value={focusYmValue}
                    onChange={(e) => {
                      const [y, m] = e.target.value.split('-').map(Number);
                      setViewBaseYm(shiftYearMonth(y, m, -1));
                    }}
                    className="text-xs font-bold text-slate-700 bg-transparent border border-transparent hover:border-slate-200 rounded-md px-1.5 py-1 cursor-pointer focus:outline-none"
                  >
                    {monthSelectOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Tháng trước"
                      onClick={() => setViewBaseYm((prev) => shiftYearMonth(prev.year, prev.month, -1))}
                      className="w-7 h-7 rounded-full hover:bg-slate-100 grid place-items-center text-slate-600"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Tháng sau"
                      onClick={() => {
                        const [curY, curM] = todayStr.split('-').map(Number);
                        const nextBase = shiftYearMonth(viewBaseYm.year, viewBaseYm.month, 1);
                        const lastShown = shiftYearMonth(nextBase.year, nextBase.month, 2);
                        if (lastShown.year * 12 + lastShown.month <= curY * 12 + curM) {
                          setViewBaseYm(nextBase);
                        }
                      }}
                      className="w-7 h-7 rounded-full hover:bg-slate-100 grid place-items-center text-slate-600"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Đầu tuần cố định T2 -> CN */}
                <div className="grid grid-cols-7 px-3 pb-1 border-b border-slate-100 text-center text-[11px] font-semibold text-slate-500">
                  {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((w) => (
                    <div key={w} className="py-1">
                      {w}
                    </div>
                  ))}
                </div>

                {/* Lịch cuộn 3 tháng liền kề — Hỗ trợ bấm kéo (Drag) hoặc chọn 2 đầu ngày */}
                <div
                  ref={scrollPaneRef}
                  className="h-[255px] overflow-y-auto px-3 py-2 space-y-3 select-none"
                >
                  {months.map((mg) => {
                    const rows: Array<Array<{ ymd: string; day: number } | null>> = [];
                    for (let i = 0; i < mg.cells.length; i += 7) {
                      rows.push(mg.cells.slice(i, i + 7));
                    }
                    return (
                      <div key={mg.key} className="space-y-1">
                        {rows.map((week, wIdx) => (
                          <div key={`${mg.key}-w-${wIdx}`} className="grid grid-cols-7 items-center">
                            {week.map((cell, cIdx) => {
                              if (!cell) {
                                return <div key={`empty-${wIdx}-${cIdx}`} className="h-8" />;
                              }
                              const isFuture = cell.ymd > todayStr;
                              const isToday = cell.ymd === todayStr;
                              const isStart = Boolean(activeVisualRange.s && cell.ymd === activeVisualRange.s);
                              const isEnd = Boolean(activeVisualRange.e && cell.ymd === activeVisualRange.e);
                              const inRange = Boolean(
                                activeVisualRange.s &&
                                  activeVisualRange.e &&
                                  cell.ymd >= activeVisualRange.s &&
                                  cell.ymd <= activeVisualRange.e,
                              );
                              const isFirstOfMonth = cell.day === 1;

                              return (
                                <div
                                  key={cell.ymd}
                                  className={`h-8 flex items-center justify-center relative ${
                                    inRange && !(isStart && isEnd)
                                      ? isStart
                                        ? 'bg-gradient-to-r from-transparent via-blue-50 to-blue-50 rounded-l-full'
                                        : isEnd
                                          ? 'bg-gradient-to-l from-transparent via-blue-50 to-blue-50 rounded-r-full'
                                          : 'bg-blue-50'
                                      : ''
                                  }`}
                                >
                                  {isFirstOfMonth && cIdx <= 4 && (
                                    <span className="sr-only">
                                      {MONTH_SHORT_VI[mg.month - 1]} {mg.year}
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    disabled={isFuture}
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      handleCellMouseDown(cell.ymd);
                                    }}
                                    onMouseEnter={() => handleCellMouseEnter(cell.ymd)}
                                    title={formatDisplayDate(cell.ymd)}
                                    className={`w-8 h-8 rounded-full text-xs flex items-center justify-center transition-colors ${
                                      isFuture
                                        ? 'text-slate-300 cursor-not-allowed'
                                        : isStart || isEnd
                                          ? 'bg-[#1A73E8] text-white font-bold shadow-xs cursor-pointer'
                                          : inRange
                                            ? 'text-[#1E3A8A] font-semibold hover:bg-blue-100 cursor-pointer'
                                            : isToday
                                              ? 'border border-slate-300 text-slate-900 font-bold hover:bg-slate-100 cursor-pointer'
                                              : 'text-slate-700 hover:bg-slate-100 cursor-pointer'
                                    }`}
                                  >
                                    {cell.day}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        ))}
                        <div className="flex items-center justify-between pt-0.5 px-1 text-[10px] font-bold text-slate-400">
                          <span>
                            {MONTH_SHORT_VI[mg.month - 1]} {mg.year}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Chân hộp lịch: tóm tắt số ngày + Huỷ / Áp dụng */}
                <div className="px-3 py-2.5 border-t border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-500">
                    {menuKey === 'ALL_TIME' && allowAll
                      ? 'Toàn bộ dữ liệu từ trước đến nay'
                      : clickStage === 'end'
                        ? `Đang chọn từ ${formatShortViTitleDate(draftStart)} — bấm chọn ngày kết thúc (hoặc kéo chuột)`
                        : draftDaysCount
                          ? `Đã chọn ${draftDaysCount} ngày · Kéo hoặc bấm 2 ngày trên lịch`
                          : 'Kéo chuột hoặc bấm 2 ngày để chọn'}
                  </span>
                  <div className="flex items-center gap-2 ml-auto">
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="h-8 px-3 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-200/70 transition"
                    >
                      Huỷ
                    </button>
                    <button
                      type="button"
                      onClick={handleApplyClick}
                      className="h-8 px-4 rounded-lg bg-[#1A73E8] hover:bg-[#1557B0] text-white text-xs font-bold shadow-xs transition"
                    >
                      Áp dụng
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

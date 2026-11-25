'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { Calculator, RotateCcw } from 'lucide-react';

export interface ExcelSelectedCell {
  id: string;
  label: string;
  value: number;
}

export function useMktExcelSelection() {
  const [excelMode, setExcelMode] = useState(false);
  const [selectedCells, setSelectedCells] = useState<ExcelSelectedCell[]>([]);

  const toggleCell = useCallback(
    (id: string, label: string, value: number | null | undefined) => {
      if (!excelMode || value === null || value === undefined || !Number.isFinite(value)) return;
      setSelectedCells((prev) => {
        const exists = prev.some((c) => c.id === id);
        if (exists) return prev.filter((c) => c.id !== id);
        return [...prev, { id, label, value }];
      });
    },
    [excelMode],
  );

  const clearSelection = useCallback(() => setSelectedCells([]), []);

  const toggleExcelMode = useCallback(() => {
    setExcelMode((prev) => {
      if (prev) setSelectedCells([]);
      return !prev;
    });
  }, []);

  const isSelected = useCallback(
    (id: string) => selectedCells.some((c) => c.id === id),
    [selectedCells],
  );

  const cellClass = useCallback(
    (id: string) => {
      if (!excelMode) return '';
      return selectedCells.some((c) => c.id === id)
        ? 'ring-2 ring-inset ring-[#1A73E8] bg-blue-100/85 cursor-cell font-bold'
        : 'cursor-cell hover:bg-blue-50/70';
    },
    [excelMode, selectedCells],
  );

  const stats = useMemo(() => {
    if (selectedCells.length === 0) return null;
    const vals = selectedCells.map((c) => c.value);
    const sum = vals.reduce((a, b) => a + b, 0);
    const avg = sum / vals.length;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const ratio =
      selectedCells.length === 2 && selectedCells[1].value !== 0
        ? selectedCells[0].value / selectedCells[1].value
        : null;
    return {
      count: vals.length,
      sum,
      avg,
      min,
      max,
      ratio,
      ratioPct: ratio !== null ? ratio * 100 : null,
      first: selectedCells[0],
      second: selectedCells[1] ?? null,
    };
  }, [selectedCells]);

  return {
    excelMode,
    toggleExcelMode,
    selectedCells,
    toggleCell,
    clearSelection,
    isSelected,
    cellClass,
    stats,
  };
}

interface MktSpreadsheetCalcBarProps {
  title?: string;
  excelMode: boolean;
  onToggleExcelMode: () => void;
  stats: ReturnType<typeof useMktExcelSelection>['stats'];
  onClear: () => void;
}

export function MktSpreadsheetCalcBar({
  title,
  excelMode,
  onToggleExcelMode,
  stats,
  onClear,
}: MktSpreadsheetCalcBarProps) {
  return (
    <div className="px-4 py-2.5 bg-slate-50/90 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {title && <span className="font-bold text-slate-800">{title}</span>}
        <button
          type="button"
          aria-pressed={excelMode}
          onClick={onToggleExcelMode}
          className={`h-7 px-3 rounded-lg border text-[11px] font-semibold inline-flex items-center gap-1.5 transition ${
            excelMode
              ? 'bg-emerald-600 border-emerald-600 text-white shadow-2xs'
              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
          }`}
        >
          <Calculator className="w-3.5 h-3.5" />
          <span>{excelMode ? 'Đang bật Tính Nhanh' : 'Tính Nhanh'}</span>
        </button>
      </div>

      {excelMode && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {stats ? (
            <>
              <span className="px-2 py-0.5 rounded-md bg-blue-100 text-[#0F275C] font-bold tabular-nums">
                Đã chọn: {stats.count} ô
              </span>
              <span className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-800 tabular-nums">
                Tổng: <strong>{stats.sum.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}</strong>
              </span>
              <span className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-800 tabular-nums">
                TB: <strong>{stats.avg.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}</strong>
              </span>
              <span className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600 tabular-nums">
                Min/Max: {stats.min.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} /{' '}
                {stats.max.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}
              </span>
              {stats.ratio !== null && stats.ratioPct !== null && (
                <span className="px-2.5 py-0.5 rounded-md bg-[#0F275C] text-white font-bold tabular-nums">
                  Ô1 ÷ Ô2 = {stats.ratio.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ({stats.ratioPct.toFixed(1)}%)
                </span>
              )}
              <button
                type="button"
                onClick={onClear}
                className="px-2 py-0.5 rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 inline-flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                Xóa chọn
              </button>
            </>
          ) : (
            <span className="text-emerald-800 font-medium">
              Bấm chọn các ô số bất kỳ trên bảng để tính nhanh Tổng · TB · Min/Max · Tỷ lệ Ô1 ÷ Ô2
            </span>
          )}
        </div>
      )}
    </div>
  );
}

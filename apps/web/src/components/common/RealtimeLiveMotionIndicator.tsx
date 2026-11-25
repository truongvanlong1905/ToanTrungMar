'use client';

import React from 'react';
import { RefreshCw } from 'lucide-react';

interface Props {
  isPolling?: boolean;
  lastUpdated?: string | Date | null;
  intervalSec?: number;
  onRefresh?: () => void | Promise<void>;
  label?: string;
  subLabel?: string;
  size?: 'sm' | 'md' | 'lg';
  showEqualizer?: boolean;
  className?: string;
  hasError?: boolean;
}

/**
 * Trạng thái đồng bộ gọn nhẹ (U06 + Modern Web Guidance: motion & content-first-noise-reduction).
 * - Không phát hoạt ảnh nhấp nháy/equalizer liên tục hay đếm ngược từng giây gây nhiễu.
 * - Dùng `aria-live="off"` cho lượt polling định kỳ để không đọc lặp trên trình đọc màn hình.
 */
export function RealtimeLiveMotionIndicator({
  isPolling = false,
  lastUpdated,
  onRefresh,
  label = 'Đồng bộ nền',
  subLabel,
  size = 'md',
  className = '',
  hasError = false,
}: Props) {
  const formattedLastUpdated = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : null;

  const statusText = isPolling
    ? 'Đang kiểm tra...'
    : hasError
      ? 'Có lỗi đồng bộ'
      : label;

  if (size === 'sm') {
    return (
      <div
        aria-live="off"
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-[11px] font-semibold ${
          hasError
            ? 'bg-rose-50 border-rose-200 text-rose-800'
            : 'bg-slate-50 border-slate-200 text-slate-700'
        } ${className}`}
        title={formattedLastUpdated ? `Cập nhật gần nhất: ${formattedLastUpdated}` : statusText}
      >
        <span
          aria-hidden="true"
          className={`h-2 w-2 rounded-full shrink-0 ${
            hasError ? 'bg-rose-500' : isPolling ? 'bg-blue-500' : 'bg-emerald-500'
          }`}
        />
        <span className="truncate">{statusText}</span>
      </div>
    );
  }

  return (
    <div
      aria-live="off"
      className={`inline-flex items-center gap-2.5 px-3 py-1.5 rounded-xl border text-xs ${
        hasError
          ? 'bg-rose-50/80 border-rose-200 text-rose-900'
          : 'bg-white border-slate-200 text-slate-700'
      } shadow-2xs ${className}`}
    >
      <span
        aria-hidden="true"
        className={`h-2.5 w-2.5 rounded-full shrink-0 ${
          hasError ? 'bg-rose-500' : isPolling ? 'bg-blue-500' : 'bg-emerald-500'
        }`}
      />
      <div className="flex flex-col min-w-0 leading-tight">
        <span className="font-bold text-slate-800 truncate">{statusText}</span>
        {(subLabel || formattedLastUpdated) && (
          <span className="text-[11px] text-slate-500 truncate">
            {formattedLastUpdated ? `Lần cuối: ${formattedLastUpdated}` : subLabel}
          </span>
        )}
      </div>
      {onRefresh && (
        <button
          type="button"
          onClick={() => void onRefresh()}
          disabled={isPolling}
          aria-label="Kiểm tra dữ liệu mới ngay"
          className="ml-1 p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-50 transition-colors"
          title="Kiểm tra dữ liệu mới ngay"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${isPolling ? 'motion-safe:animate-spin' : ''}`}
          />
        </button>
      )}
    </div>
  );
}

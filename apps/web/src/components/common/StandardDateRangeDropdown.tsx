'use client';

import React from 'react';
import { GoogleAdsDateRangePicker } from './GoogleAdsDateRangePicker';

export type StandardDatePreset =
  | 'ALL'
  | 'TODAY'
  | 'YESTERDAY'
  | '7D'
  | '30D'
  | '90D'
  | 'THIS_MONTH'
  | 'CUSTOM';

function formatVnYmd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function resolvePresetDatesClient(
  preset: StandardDatePreset,
  customStartDate = '',
  customEndDate = '',
): { startDate: string; endDate: string; includesToday: boolean } | null {
  const now = new Date();
  const todayStr = formatVnYmd(now);
  const noon = new Date(`${todayStr}T12:00:00+07:00`);
  if (preset === 'ALL') return null;
  if (preset === 'TODAY') return { startDate: todayStr, endDate: todayStr, includesToday: true };
  if (preset === 'YESTERDAY') {
    const yStr = formatVnYmd(new Date(noon.getTime() - 24 * 60 * 60 * 1000));
    return { startDate: yStr, endDate: yStr, includesToday: false };
  }
  if (preset === '7D' || preset === '30D' || preset === '90D') {
    const days = preset === '7D' ? 7 : preset === '30D' ? 30 : 90;
    const sStr = formatVnYmd(new Date(noon.getTime() - (days - 1) * 24 * 60 * 60 * 1000));
    return { startDate: sStr, endDate: todayStr, includesToday: true };
  }
  if (preset === 'THIS_MONTH') {
    return { startDate: `${todayStr.slice(0, 7)}-01`, endDate: todayStr, includesToday: true };
  }
  if (preset === 'CUSTOM' && (customStartDate || customEndDate)) {
    const s = customStartDate || customEndDate;
    const e = customEndDate || customStartDate;
    return { startDate: s, endDate: e, includesToday: e >= todayStr };
  }
  return null;
}

export interface StandardDateRangeDropdownProps {
  preset: StandardDatePreset;
  customStartDate?: string;
  customEndDate?: string;
  onChangePreset: (preset: StandardDatePreset) => void;
  onChangeCustomRange?: (startDate: string, endDate: string) => void;
  include90Days?: boolean;
  className?: string;
  size?: 'sm' | 'md';
}

export function StandardDateRangeDropdown({
  preset,
  customStartDate = '',
  customEndDate = '',
  onChangePreset,
  onChangeCustomRange,
  className = '',
  size = 'md',
}: StandardDateRangeDropdownProps) {
  return (
    <GoogleAdsDateRangePicker
      preset={preset}
      from={customStartDate}
      to={customEndDate}
      allowAll={true}
      align="right"
      size={size}
      className={className}
      onApply={(next) => {
        if (next.preset === 'CUSTOM' && onChangeCustomRange) {
          onChangeCustomRange(next.from, next.to);
        }
        onChangePreset(next.preset);
      }}
    />
  );
}


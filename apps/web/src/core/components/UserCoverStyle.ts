import type React from 'react';

export interface CoverPresetOption {
  id: string;
  label: string;
  cssBackground: string;
}

export const COVER_PRESET_OPTIONS: CoverPresetOption[] = [
  {
    id: 'preset:navy_led',
    label: 'Xanh LED Toàn Trung',
    cssBackground: 'linear-gradient(125deg, #071330 0%, #103278 52%, #0284C7 100%)',
  },
  {
    id: 'preset:emerald_matrix',
    label: 'Ngọc Lục Bảo Matrix',
    cssBackground: 'linear-gradient(125deg, #052E24 0%, #047857 55%, #10B981 100%)',
  },
  {
    id: 'preset:royal_violet',
    label: 'Tím Studio Sáng Tạo',
    cssBackground: 'linear-gradient(125deg, #1E1B4B 0%, #4338CA 55%, #7C3AED 100%)',
  },
  {
    id: 'preset:amber_sunset',
    label: 'Hổ Phách Năng Lượng',
    cssBackground: 'linear-gradient(125deg, #451A03 0%, #B45309 55%, #F59E0B 100%)',
  },
  {
    id: 'preset:crimson_exec',
    label: 'Đỏ Ruby Điều Hành',
    cssBackground: 'linear-gradient(125deg, #4C0519 0%, #BE123C 55%, #F43F5E 100%)',
  },
  {
    id: 'preset:slate_carbon',
    label: 'Carbon Đen Tinh Tế',
    cssBackground: 'linear-gradient(125deg, #090D16 0%, #1E293B 58%, #475569 100%)',
  },
];

export function resolveCoverBackgroundStyle(coverUrl?: string | null): React.CSSProperties {
  if (!coverUrl) {
    return {
      backgroundImage: COVER_PRESET_OPTIONS[0].cssBackground,
    };
  }
  const preset = COVER_PRESET_OPTIONS.find((p) => p.id === coverUrl);
  if (preset) {
    return {
      backgroundImage: preset.cssBackground,
    };
  }
  return {
    backgroundImage: `linear-gradient(180deg, rgba(8,18,44,0.18) 0%, rgba(8,18,44,0.48) 100%), url("${coverUrl}")`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  };
}

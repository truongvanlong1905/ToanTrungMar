'use client';

import React from 'react';
import { Check, Clock, Globe } from 'lucide-react';
import {
  UI_VOCABULARY,
  resolveWebsiteScopeDisplay,
  type DashboardDatePreset,
  type WebsiteConfigItemDto,
} from '@toantrung/contracts';
import type { DashboardScopeState } from '@/core/dashboard/useDashboardScope';
import { GoogleAdsDateRangePicker } from './GoogleAdsDateRangePicker';

interface WebsiteDashboardHeaderProps {
  title?: string;
  subtitle?: string;
  scope: DashboardScopeState;
  availableWebsites: WebsiteConfigItemDto[];
  selectedWebsiteLabel?: string;
  comparisonLabel?: string | null;
  freshnessMessage?: string;
  freshnessDetail?: {
    checkedAt?: string | null;
    lastSyncedAt?: string | null;
    latestSourceDataAt?: string | null;
  };
  freshnessTone?: 'ok' | 'warning' | 'error' | 'updating';
  hideWebsiteTabs?: boolean;
  websiteSelectorStyle?: 'tabs' | 'dropdown';
  showCompareToggle?: boolean;
  compareEnabled?: boolean;
  onToggleCompare?: (checked: boolean) => void;
  actions?: React.ReactNode;
  onChangeScope: (patch: Partial<DashboardScopeState>) => void;
}

export function WebsiteDashboardHeader({
  title,
  subtitle,
  scope,
  availableWebsites,
  comparisonLabel,
  freshnessMessage,
  freshnessDetail,
  freshnessTone = 'ok',
  hideWebsiteTabs = false,
  websiteSelectorStyle = 'tabs',
  showCompareToggle = false,
  compareEnabled = false,
  onToggleCompare,
  actions,
  onChangeScope,
}: WebsiteDashboardHeaderProps) {
  // Nhãn "Đang xem" tính đồng bộ từ scope.websiteId hiện tại
  const activeWebsiteDisplay = hideWebsiteTabs
    ? 'Toàn hệ thống (Tất cả website)'
    : resolveWebsiteScopeDisplay(scope.websiteId, availableWebsites);

  const formatHm = (iso?: string | null) => {
    if (!iso) return null;
    try {
      return new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  };

  const freshnessTooltip = freshnessDetail
    ? [
        freshnessDetail.checkedAt ? `Kiểm tra lúc: ${formatHm(freshnessDetail.checkedAt)}` : null,
        freshnessDetail.lastSyncedAt ? `Đồng bộ thành công: ${formatHm(freshnessDetail.lastSyncedAt)}` : null,
        freshnessDetail.latestSourceDataAt ? `Dữ liệu mới nhất nguồn: ${formatHm(freshnessDetail.latestSourceDataAt)}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined;

  const statusDotClass =
    freshnessTone === 'error'
      ? 'bg-red-500'
      : freshnessTone === 'warning'
        ? 'bg-amber-500'
        : freshnessTone === 'updating'
          ? 'bg-blue-500 animate-pulse'
          : 'bg-emerald-500';

  const mapToDashboardPreset = (nextPreset: string): DashboardDatePreset => {
    if (
      nextPreset === 'TODAY' ||
      nextPreset === 'YESTERDAY' ||
      nextPreset === '7D' ||
      nextPreset === '30D' ||
      nextPreset === 'CUSTOM'
    ) {
      return nextPreset;
    }
    return 'CUSTOM';
  };

  const timeSelectorEl = (
    <GoogleAdsDateRangePicker
      preset={scope.preset}
      from={scope.from}
      to={scope.to}
      allowAll={false}
      showCompareToggle={showCompareToggle}
      compareEnabled={compareEnabled}
      onToggleCompare={onToggleCompare}
      align="right"
      size="sm"
      showStepButtons={true}
      onApply={(next) => {
        onChangeScope({
          preset: mapToDashboardPreset(next.preset),
          from: next.from,
          to: next.to,
        });
      }}
    />
  );

  const compactSiteLabel = (site: WebsiteConfigItemDto) => {
    const s = site.shortName
      .replace(/^Chuyên trang\s+/i, '')
      .replace(/^Website\s+/i, '')
      .replace(/^Toàn Trung\s*-\s*/i, '')
      .trim();
    return s || site.shortName;
  };

  if (!hideWebsiteTabs && websiteSelectorStyle === 'dropdown') {
    return (
      <section
        aria-label="Thanh ngữ cảnh website và thời gian"
        className="w-full rounded-2xl bg-white border border-slate-200/90 px-4 py-2.5 shadow-2xs"
      >
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-2.5">
          <div className="min-w-0 flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1
                tabIndex={-1}
                className="text-base sm:text-lg font-bold text-slate-900 tracking-tight focus:outline-none"
              >
                {title || 'Phân tích website'}
              </h1>

              <div className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200/90 bg-slate-50/80 hover:bg-slate-100/80 px-2.5 h-8 transition">
                <Globe aria-hidden="true" className="w-3.5 h-3.5 shrink-0 text-[#1A73E8]" />
                <select
                  aria-label="Chọn website nguồn"
                  value={scope.websiteId}
                  onChange={(e) => onChangeScope({ websiteId: e.target.value })}
                  className="bg-transparent text-xs font-semibold text-slate-800 focus:outline-none pr-1 cursor-pointer max-w-[230px]"
                >
                  <option value="all">Tất cả website</option>
                  {availableWebsites.map((site) => {
                    const shortLabel = compactSiteLabel(site);
                    const showDomainSuffix =
                      site.domain &&
                      !site.domain.startsWith('ga4-') &&
                      shortLabel.toLowerCase() !== site.domain.toLowerCase();
                    return (
                      <option key={site.websiteId} value={site.websiteId}>
                        {showDomainSuffix ? `${shortLabel} (${site.domain})` : shortLabel}
                      </option>
                    );
                  })}
                </select>
              </div>

              {comparisonLabel && (
                <span className="inline-flex items-center min-h-6 rounded-full bg-emerald-50/80 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800 border border-emerald-200/70">
                  {comparisonLabel}
                </span>
              )}
            </div>

            {(subtitle || freshnessMessage) && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                {subtitle && <span>{subtitle}</span>}
                {freshnessMessage && (
                  <span
                    aria-live="off"
                    title={freshnessTooltip}
                    className="inline-flex items-center gap-1.5 text-slate-600"
                  >
                    <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDotClass}`} />
                    <Clock aria-hidden="true" className="w-3 h-3 text-slate-400 shrink-0" />
                    <span>{freshnessMessage}</span>
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {timeSelectorEl}
            {actions}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Thanh ngữ cảnh website và thời gian"
      className="w-full rounded-2xl bg-white border border-slate-200/90 px-4 py-3 shadow-2xs space-y-2.5"
    >
      {/* Hàng 1: Tiêu đề trang + Đang xem + Trạng thái dữ liệu + Thao tác */}
      <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1
              tabIndex={-1}
              className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight focus:outline-none"
            >
              {title || 'Phân tích website'}
            </h1>
            {!hideWebsiteTabs && (
              <span className="inline-flex items-center gap-1.5 min-h-6 rounded-full bg-gradient-to-r from-blue-50 to-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-[#0F275C] border border-blue-200/80">
                <Globe aria-hidden="true" className="w-3.5 h-3.5 shrink-0 text-[#1E3A8A]" />
                <span>{`Đang xem: ${activeWebsiteDisplay}`}</span>
              </span>
            )}
            {comparisonLabel && (
              <span className="inline-flex items-center min-h-6 rounded-full bg-emerald-50/80 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 border border-emerald-200/70">
                {comparisonLabel}
              </span>
            )}
          </div>
          {(subtitle || freshnessMessage) && (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              {subtitle && <span>{subtitle}</span>}
              {freshnessMessage && (
                <span
                  aria-live="off"
                  title={freshnessTooltip}
                  className="inline-flex items-center gap-1.5 text-slate-600"
                >
                  <span aria-hidden="true" className={`w-2 h-2 rounded-full shrink-0 ${statusDotClass}`} />
                  <Clock aria-hidden="true" className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span>{freshnessMessage}</span>
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {hideWebsiteTabs && timeSelectorEl}
          {actions}
        </div>
      </div>

      {/* Hàng 2: Thanh điều hướng Website dạng Segmented Dock 1 dòng mượt & bắt mắt + Thời gian */}
      {!hideWebsiteTabs && (
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-2.5 pt-2.5 border-t border-slate-100">
          <div
            role="group"
            aria-label="Chọn website nguồn"
            className="flex items-center gap-1 overflow-x-auto max-w-full rounded-xl bg-slate-100/85 p-1 border border-slate-200/80 [scrollbar-width:none]"
          >
            <button
              type="button"
              aria-pressed={scope.websiteId === 'all'}
              onClick={() => onChangeScope({ websiteId: 'all' })}
              className={`flex-none inline-flex items-center gap-1.5 min-h-8 px-3 py-1 rounded-lg text-xs transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1E3A8A] ${
                scope.websiteId === 'all'
                  ? 'bg-gradient-to-r from-[#0F275C] to-[#1E3A8A] text-white font-semibold shadow-xs'
                  : 'text-slate-700 hover:bg-white/90 font-medium'
              }`}
            >
              {scope.websiteId === 'all' ? (
                <Check aria-hidden="true" className="w-3.5 h-3.5 shrink-0 text-sky-300" />
              ) : (
                <Globe aria-hidden="true" className="w-3.5 h-3.5 shrink-0 text-slate-500" />
              )}
              <span>Tất cả website</span>
            </button>

            {availableWebsites.map((site) => {
              const active = scope.websiteId === site.websiteId;
              const shortLabel = compactSiteLabel(site);
              const showDomainSuffix =
                site.domain &&
                !site.domain.startsWith('ga4-') &&
                shortLabel.toLowerCase() !== site.domain.toLowerCase();
              return (
                <button
                  key={site.websiteId}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onChangeScope({ websiteId: site.websiteId })}
                  title={`${site.shortName} (${site.domain})`}
                  className={`flex-none inline-flex items-center gap-1.5 min-h-8 px-3 py-1 rounded-lg text-xs transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1E3A8A] ${
                    active
                      ? 'bg-gradient-to-r from-[#0F275C] to-[#1E3A8A] text-white font-semibold shadow-xs'
                      : 'text-slate-700 hover:bg-white/90 font-medium'
                  }`}
                >
                  {active && <Check aria-hidden="true" className="w-3.5 h-3.5 shrink-0 text-sky-300" />}
                  <span>{shortLabel}</span>
                  {showDomainSuffix && (
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                        active ? 'bg-white/15 text-sky-100' : 'bg-white/80 text-slate-500 border border-slate-200/70'
                      }`}
                    >
                      {site.domain}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {timeSelectorEl}
        </div>
      )}
    </section>
  );
}

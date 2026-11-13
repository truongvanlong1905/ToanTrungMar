'use client';

import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Database,
  RefreshCw,
  Search,
  TrendingUp,
} from 'lucide-react';
import type { PlatformDailyMetricDto } from '../types';

interface LiveCampaignsTableProps {
  metrics: PlatformDailyMetricDto[];
  isLoading: boolean;
  onRefresh: () => void;
  className?: string;
}

function formatVnd(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0 ₫';
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.round(value)) + ' ₫';
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0.00%';
  return (value * 100).toFixed(2) + '%';
}

export function LiveCampaignsTable({
  metrics,
  isLoading,
  onRefresh,
  className = '',
}: LiveCampaignsTableProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Group metrics by campaignExternalId
  const aggregatedCampaigns = useMemo(() => {
    const map = new Map<
      string,
      {
        code: string;
        name: string;
        platform: string;
        dailyBudgetVnd: number;
        totalSpendVnd: number;
        impressions: number;
        clicks: number;
        conversions: number;
        recordCount: number;
      }
    >();

    for (const m of metrics) {
      const code = m.campaignExternalId || 'UNKNOWN_CAMPAIGN';
      const existing = map.get(code);
      const spendNum = Number(m.spend?.formattedDecimal || 0);
      const budgetNum = Number(m.dailyBudget?.formattedDecimal || 0);

      if (!existing) {
        map.set(code, {
          code,
          name: m.campaignName || code,
          platform: m.platform,
          dailyBudgetVnd: budgetNum,
          totalSpendVnd: spendNum,
          impressions: m.impressions,
          clicks: m.clicks,
          conversions: m.conversions,
          recordCount: 1,
        });
      } else {
        existing.totalSpendVnd += spendNum;
        existing.impressions += m.impressions;
        existing.clicks += m.clicks;
        existing.conversions += m.conversions;
        existing.recordCount += 1;
        if (budgetNum > 0) existing.dailyBudgetVnd = budgetNum;
      }
    }

    return Array.from(map.values()).sort((a, b) => b.totalSpendVnd - a.totalSpendVnd);
  }, [metrics]);

  const filteredCampaigns = useMemo(() => {
    if (!searchQuery.trim()) return aggregatedCampaigns;
    const q = searchQuery.toLowerCase().trim();
    return aggregatedCampaigns.filter(
      (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q),
    );
  }, [aggregatedCampaigns, searchQuery]);

  const totals = useMemo(() => {
    return filteredCampaigns.reduce(
      (acc, c) => ({
        spend: acc.spend + c.totalSpendVnd,
        impressions: acc.impressions + c.impressions,
        clicks: acc.clicks + c.clicks,
        conversions: acc.conversions + c.conversions,
      }),
      { spend: 0, impressions: 0, clicks: 0, conversions: 0 },
    );
  }, [filteredCampaigns]);

  const overallCtr = totals.impressions > 0 ? totals.clicks / totals.impressions : 0;
  const overallCpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;

  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-900">Chiến dịch Google Ads trực tiếp</h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700">
              <Database className="h-3 w-3" />
              Đã kết nối Database ({metrics.length} bản ghi ngày)
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Số liệu chi phí, lượt hiển thị, click và chuyển đổi đã chuẩn hóa từ Google Ads API vào kho platform_daily_metrics
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Tìm theo tên/mã chiến dịch..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-48 sm:w-60 rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs focus:border-blue-500 focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            title="Tải lại số liệu từ máy chủ"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin text-blue-600' : ''}`} />
            Làm mới
          </button>
        </div>
      </div>

      {filteredCampaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <AlertCircle className="h-8 w-8 text-slate-400" />
          <p className="mt-2 text-xs font-medium text-slate-600">
            {metrics.length === 0
              ? 'Chưa có số liệu chiến dịch trong cơ sở dữ liệu. Nhấn "Chạy đồng bộ" ở tab Đồng bộ để nạp dữ liệu.'
              : 'Không tìm thấy chiến dịch phù hợp với từ khóa.'}
          </p>
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs" style={{ minWidth: '920px' }}>
            <thead className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2.5">Chiến dịch Google Ads</th>
                <th className="px-3 py-2.5 text-right">Ngân sách/ngày</th>
                <th className="px-3 py-2.5 text-right">Tổng chi phí</th>
                <th className="px-3 py-2.5 text-right">Lượt hiển thị</th>
                <th className="px-3 py-2.5 text-right">Lượt click</th>
                <th className="px-3 py-2.5 text-right">CTR</th>
                <th className="px-3 py-2.5 text-right">CPC trung bình</th>
                <th className="px-3 py-2.5 text-right">Chuyển đổi</th>
                <th className="px-3 py-2.5 text-center">Số ngày</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredCampaigns.map((c) => {
                const ctr = c.impressions > 0 ? c.clicks / c.impressions : 0;
                const cpc = c.clicks > 0 ? c.totalSpendVnd / c.clicks : 0;

                return (
                  <tr key={c.code} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-3 py-3">
                      <p className="font-semibold text-slate-900">{c.name}</p>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span className="font-mono text-[10px] text-slate-500">{c.code}</span>
                        <span className="rounded bg-blue-50 px-1.5 py-0.2 text-[9px] font-semibold text-blue-700">
                          Google Ads
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-slate-600">
                      {c.dailyBudgetVnd > 0 ? formatVnd(c.dailyBudgetVnd) : '—'}
                    </td>
                    <td className="px-3 py-3 text-right font-mono font-bold text-slate-900">
                      {formatVnd(c.totalSpendVnd)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-slate-700">
                      {c.impressions.toLocaleString('vi-VN')}
                    </td>
                    <td className="px-3 py-3 text-right font-mono font-semibold text-blue-700">
                      {c.clicks.toLocaleString('vi-VN')}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-slate-700">
                      {formatPercent(ctr)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-slate-600">
                      {formatVnd(cpc)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono font-bold text-emerald-700">
                      {c.conversions.toLocaleString('vi-VN')}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                        {c.recordCount} ngày
                      </span>
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-slate-50/90 font-bold text-slate-900 border-t border-slate-300">
                <td className="px-3 py-3">
                  Tổng cộng ({filteredCampaigns.length} chiến dịch)
                </td>
                <td className="px-3 py-3 text-right font-mono text-slate-500">—</td>
                <td className="px-3 py-3 text-right font-mono text-blue-800">
                  {formatVnd(totals.spend)}
                </td>
                <td className="px-3 py-3 text-right font-mono">
                  {totals.impressions.toLocaleString('vi-VN')}
                </td>
                <td className="px-3 py-3 text-right font-mono text-blue-800">
                  {totals.clicks.toLocaleString('vi-VN')}
                </td>
                <td className="px-3 py-3 text-right font-mono">
                  {formatPercent(overallCtr)}
                </td>
                <td className="px-3 py-3 text-right font-mono">
                  {formatVnd(overallCpc)}
                </td>
                <td className="px-3 py-3 text-right font-mono text-emerald-700">
                  {totals.conversions.toLocaleString('vi-VN')}
                </td>
                <td className="px-3 py-3 text-center text-slate-500">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

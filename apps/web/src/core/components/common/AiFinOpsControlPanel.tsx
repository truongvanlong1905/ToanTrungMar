'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Coins, Cpu, History, RefreshCw, Save, Sparkles, UserCheck } from 'lucide-react';
import { hasBaPermission, type SessionUserDto } from '@toantrung/contracts';
import { apiRequest } from '@/core/http/client';
import { subscribeDataSync } from '@/core/http/data-sync-bus';

export interface FinOpsResponse {
  moduleFilter: 'all' | '05-ai-design' | '03-keywords-ads';
  budget: {
    dailyLimitMicrosUsd: number;
    monthlyLimitMicrosUsd: number;
    updatedAt: string | null;
  };
  myStats: {
    todayCalls: number;
    todayTokens: number;
    todayCostUsdFormatted: string;
    monthCalls: number;
    monthPromptTokens: number;
    monthCompletionTokens: number;
    monthTokens: number;
    monthCostMicrosUsd: number;
    monthCostUsdFormatted: string;
  };
  summary: {
    totalCallsMonth: number;
    todayCalls: number;
    todayPromptTokens: number;
    todayCompletionTokens: number;
    todayTokens: number;
    monthPromptTokens: number;
    monthCompletionTokens: number;
    monthTokens: number;
    tokenTrackedCallsMonth: number;
    successRatePct: number | null;
    avgDurationMs: number | null;
    todayCostMicrosUsd: number;
    todayCostUsdFormatted: string;
    monthCostMicrosUsd: number;
    monthCostUsdFormatted: string;
  };
  byModel: Array<{
    modelName: string;
    moduleCode: string;
    calls: number;
    successRatePct: number;
    avgDurationMs: number;
    tokenReportingCalls: number;
    isLocalZeroCost: boolean;
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    costMicrosUsd: number;
    costUsdFormatted: string;
  }>;
  recentLogs: Array<{
    id: number;
    createdAt: string;
    moduleCode: string;
    taskType: string;
    modelName: string;
    actorLabel: string;
    isCurrentUser: boolean;
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    durationMs: number | null;
    status: string;
    costUsdFormatted: string;
  }>;
}

const TASK_LABELS_VI: Record<string, string> = {
  '3d_perspective': 'Phối cảnh LED 3D',
  perspective_compose: 'Phối cảnh LED 3D',
  banner: 'Thiết kế Banner/Poster',
  banner_generate: 'Thiết kế Banner/Poster',
  design_edit: 'Chỉnh sửa phiên bản AI',
  brief_analyze: 'Phân tích Brief & Tư vấn',
  quick_install_led: 'Gắn màn LED nhanh',
  seo_outline: 'Dàn ý bài viết SEO',
  seo_draft: 'Soạn bài viết SEO',
};

function formatTokenValue(val: number | null | undefined): string {
  if (val === null || val === undefined) return '—';
  return val.toLocaleString('vi-VN');
}

export function AiFinOpsControlPanel({
  user,
  defaultModule = 'all',
  showRecentLogs = false,
  onSummaryLoaded,
}: {
  user: SessionUserDto | null;
  defaultModule?: 'all' | '05-ai-design' | '03-keywords-ads';
  showRecentLogs?: boolean;
  onSummaryLoaded?: (data: FinOpsResponse) => void;
}) {
  const [moduleScope, setModuleScope] = useState<'all' | '05-ai-design' | '03-keywords-ads'>(
    defaultModule,
  );
  const [data, setData] = useState<FinOpsResponse | null>(null);
  const [dailyUsd, setDailyUsd] = useState('5');
  const [monthlyUsd, setMonthlyUsd] = useState('100');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState<boolean>(showRecentLogs);

  const canView = Boolean(
    user &&
      (user.roleCode === 'ADMIN' ||
        user.roleCode === 'BOD' ||
        hasBaPermission(user.roleCode, 'AI_DESIGN') ||
        hasBaPermission(user.roleCode, 'AI_MARKETING_SEO')),
  );
  const canEdit = user?.roleCode === 'ADMIN';

  const loadFinOps = useCallback(
    async (skipCache = false) => {
      if (!canView) return;
      if (skipCache) setRefreshing(true);
      try {
        const res = await apiRequest<FinOpsResponse>(
          `/api/v1/ai/copilot?mode=finops&module=${encodeURIComponent(moduleScope)}`,
          { skipCache },
        );
        setData(res);
        setDailyUsd(String(Number((res.budget.dailyLimitMicrosUsd / 1_000_000).toFixed(2))));
        setMonthlyUsd(String(Number((res.budget.monthlyLimitMicrosUsd / 1_000_000).toFixed(2))));
        onSummaryLoaded?.(res);
      } catch {
        // silent
      } finally {
        setRefreshing(false);
      }
    },
    [canView, moduleScope, onSummaryLoaded],
  );

  useEffect(() => {
    void loadFinOps(false);
    let timer: number | null = null;
    const unsub = subscribeDataSync(['design', 'ads', 'seo_articles'], () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void loadFinOps(true);
      }, 800);
    });
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      unsub();
    };
  }, [loadFinOps]);

  if (!canView || !data) return null;

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !canEdit || saving) return;
    setSaving(true);
    setSavedMsg(null);
    try {
      await apiRequest('/api/v1/ai/copilot', {
        method: 'POST',
        csrfToken: user.csrfToken,
        body: {
          action: 'update_finops_budget',
          dailyLimitUsd: Number(dailyUsd),
          monthlyLimitUsd: Number(monthlyUsd),
        },
      });
      setSavedMsg('Đã lưu định mức ngân sách AI FinOps.');
      await loadFinOps(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs space-y-3.5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-700 border border-purple-200/70 grid place-items-center shrink-0">
            <Coins className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-sm">
              Theo Dõi Tiêu Thụ Token &amp; Định Mức Chi Phí AI (AI Token &amp; FinOps)
            </h3>
            <p className="text-[11px] text-slate-500">
              Thống kê thực tế từ nhật ký AiUsageLog — hiển thị rõ Prompt Token, Output Token và chi phí micro-USD theo từng model
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Module filter pills */}
          <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5 gap-0.5">
            {(
              [
                { id: 'all', label: 'Toàn hệ thống' },
                { id: '05-ai-design', label: 'M05 Thiết kế AI' },
                { id: '03-keywords-ads', label: 'M03 SEO AI' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setModuleScope(tab.id)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${
                  moduleScope === tab.id
                    ? 'bg-[#0F275C] text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void loadFinOps(true)}
            disabled={refreshing}
            className="h-7 px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold inline-flex items-center gap-1"
            title="Làm mới số liệu Token vừa tiêu thụ"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Làm mới</span>
          </button>

          {canEdit && (
            <form onSubmit={(e) => void handleSaveBudget(e)} className="flex flex-wrap items-center gap-1.5">
              <label className="inline-flex items-center gap-1 text-[11px] text-slate-600">
                <span>Hạn mức ngày ($):</span>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  value={dailyUsd}
                  onChange={(e) => setDailyUsd(e.target.value)}
                  className="w-16 h-7 px-2 rounded-lg border border-slate-200 font-bold text-slate-900"
                />
              </label>
              <label className="inline-flex items-center gap-1 text-[11px] text-slate-600">
                <span>Tháng ($):</span>
                <input
                  type="number"
                  step="5"
                  min="1"
                  value={monthlyUsd}
                  onChange={(e) => setMonthlyUsd(e.target.value)}
                  className="w-20 h-7 px-2 rounded-lg border border-slate-200 font-bold text-slate-900"
                />
              </label>
              <button
                type="submit"
                disabled={saving}
                className="h-7 px-2.5 rounded-lg bg-[#0F275C] hover:bg-[#1E3A8A] text-white font-bold inline-flex items-center gap-1"
              >
                <Save className="w-3 h-3" />
                <span>Lưu hạn mức</span>
              </button>
            </form>
          )}
        </div>
      </div>

      {savedMsg && (
        <div className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold">
          {savedMsg}
        </div>
      )}

      {/* 6 KPI Cards: Personal Tokens + Team Tokens + Costs + Calls + Latency */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
        <div className="p-3 rounded-xl bg-gradient-to-br from-indigo-50/90 to-purple-50/60 border border-indigo-200/80">
          <div className="text-[11px] font-bold text-indigo-900 inline-flex items-center gap-1">
            <UserCheck className="w-3.5 h-3.5 text-indigo-600" />
            <span>Token của bạn (Tháng)</span>
          </div>
          <div className="text-base font-extrabold text-indigo-950 tabular-nums mt-0.5">
            {data.myStats.monthTokens.toLocaleString('vi-VN')} <span className="text-[11px] font-semibold">tok</span>
          </div>
          <div className="text-[10.5px] text-indigo-700 font-medium">
            Hôm nay: {data.myStats.todayTokens.toLocaleString('vi-VN')} tok · {data.myStats.monthCalls} lượt ({data.myStats.monthCostUsdFormatted})
          </div>
        </div>

        <div className="p-3 rounded-xl bg-blue-50/60 border border-blue-200/70">
          <div className="text-[11px] font-bold text-[#0F275C] inline-flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-blue-600" />
            <span>Tổng Token hệ thống</span>
          </div>
          <div className="text-base font-extrabold text-[#0F275C] tabular-nums mt-0.5">
            {data.summary.monthTokens.toLocaleString('vi-VN')} <span className="text-[11px] font-semibold">tok</span>
          </div>
          <div className="text-[10.5px] text-slate-600">
            In: {data.summary.monthPromptTokens.toLocaleString('vi-VN')} · Out:{' '}
            {data.summary.monthCompletionTokens.toLocaleString('vi-VN')}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
          <div className="text-[11px] text-slate-500">Chi phí hôm nay</div>
          <div className="text-base font-extrabold text-slate-900 tabular-nums mt-0.5">
            {data.summary.todayCostUsdFormatted}
          </div>
          <div className="text-[10.5px] text-slate-500">
            Trần ngày: ${(data.budget.dailyLimitMicrosUsd / 1_000_000).toFixed(2)} · {data.summary.todayTokens.toLocaleString('vi-VN')} tok
          </div>
        </div>

        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
          <div className="text-[11px] text-slate-500">Chi phí trong tháng</div>
          <div className="text-base font-extrabold text-[#0F275C] tabular-nums mt-0.5">
            {data.summary.monthCostUsdFormatted}
          </div>
          <div className="text-[10.5px] text-slate-500">
            Trần tháng: ${(data.budget.monthlyLimitMicrosUsd / 1_000_000).toFixed(2)}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
          <div className="text-[11px] text-slate-500">Tổng lượt gọi tháng</div>
          <div className="text-base font-extrabold text-slate-900 tabular-nums mt-0.5">
            {data.summary.totalCallsMonth.toLocaleString('vi-VN')}
          </div>
          <div className="text-[10.5px] text-emerald-700 font-semibold">
            Tỷ lệ thành công:{' '}
            {data.summary.successRatePct !== null ? `${data.summary.successRatePct}%` : 'Chưa phát sinh'}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
          <div className="text-[11px] text-slate-500">Độ trễ xử lý TB</div>
          <div className="text-base font-extrabold text-slate-900 tabular-nums mt-0.5">
            {data.summary.avgDurationMs !== null ? `${data.summary.avgDurationMs} ms` : '—'}
          </div>
          <div className="text-[10.5px] text-slate-400">Theo lượt phản hồi thật</div>
        </div>
      </div>

      {/* Model Breakdown Table with Prompt / Output / Total Tokens */}
      {data.byModel.length > 0 && (
        <div className="border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="py-2 px-3 font-bold">Mô hình AI</th>
                <th className="py-2 px-3 font-bold">Phân hệ</th>
                <th className="py-2 px-3 font-bold text-right">Lượt gọi</th>
                <th className="py-2 px-3 font-bold text-right">Prompt Token</th>
                <th className="py-2 px-3 font-bold text-right">Output Token</th>
                <th className="py-2 px-3 font-bold text-right">Tổng Token</th>
                <th className="py-2 px-3 font-bold text-right">Thành công</th>
                <th className="py-2 px-3 font-bold text-right">TB (ms)</th>
                <th className="py-2 px-3 font-bold text-right">Chi phí thực</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.byModel.map((m) => (
                <tr key={`${m.modelName}-${m.moduleCode}`} className="hover:bg-slate-50/70">
                  <td className="py-2 px-3 font-mono font-bold text-slate-900">
                    <span className="inline-flex items-center gap-1.5">
                      <Cpu className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                      <span>{m.modelName}</span>
                    </span>
                  </td>
                  <td className="py-2 px-3 text-slate-600">{m.moduleCode}</td>
                  <td className="py-2 px-3 text-right font-semibold tabular-nums">
                    {m.calls.toLocaleString('vi-VN')}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-slate-600">
                    {m.totalTokens !== null ? (
                      formatTokenValue(m.promptTokens)
                    ) : (
                      <span className="text-[11px] text-slate-400">
                        {m.isLocalZeroCost ? 'Nội bộ ($0)' : 'Tính theo ảnh'}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-slate-600">
                    {m.totalTokens !== null ? formatTokenValue(m.completionTokens) : '—'}
                  </td>
                  <td className="py-2 px-3 text-right font-bold tabular-nums text-indigo-900">
                    {m.totalTokens !== null ? (
                      `${formatTokenValue(m.totalTokens)} tok`
                    ) : (
                      <span className="text-[11px] font-medium text-slate-500">
                        {m.isLocalZeroCost ? '0 tok (Local)' : `${m.calls} ảnh`}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right text-emerald-700 font-semibold tabular-nums">
                    {m.successRatePct}%
                  </td>
                  <td className="py-2 px-3 text-right text-slate-600 tabular-nums">
                    {m.avgDurationMs} ms
                  </td>
                  <td className="py-2 px-3 text-right font-bold text-[#0F275C] tabular-nums">
                    {m.costUsdFormatted}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Toggleable Recent AI Calls Log */}
      <div className="pt-1">
        <button
          type="button"
          onClick={() => setShowLogs((v) => !v)}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-[#1E3A8A] hover:underline"
        >
          <History className="w-3.5 h-3.5" />
          <span>
            {showLogs
              ? 'Ẩn nhật ký tiêu thụ Token từng lượt gần nhất'
              : `Xem 15 lượt gọi AI & tiêu thụ Token gần nhất (${data.recentLogs.length})`}
          </span>
        </button>

        {showLogs && data.recentLogs.length > 0 && (
          <div className="mt-2 border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-left border-collapse text-[11px]">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="py-1.5 px-2.5 font-bold">Thời điểm</th>
                  <th className="py-1.5 px-2.5 font-bold">Người dùng</th>
                  <th className="py-1.5 px-2.5 font-bold">Tác vụ</th>
                  <th className="py-1.5 px-2.5 font-bold">Model</th>
                  <th className="py-1.5 px-2.5 font-bold text-right">Prompt / Output / Tổng Token</th>
                  <th className="py-1.5 px-2.5 font-bold text-right">Độ trễ</th>
                  <th className="py-1.5 px-2.5 font-bold text-right">Chi phí</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.recentLogs.map((r) => (
                  <tr key={r.id} className={r.isCurrentUser ? 'bg-indigo-50/30' : ''}>
                    <td className="py-1.5 px-2.5 text-slate-500 whitespace-nowrap">
                      {new Date(r.createdAt).toLocaleString('vi-VN')}
                    </td>
                    <td className="py-1.5 px-2.5 font-semibold text-slate-800">{r.actorLabel}</td>
                    <td className="py-1.5 px-2.5 text-slate-700">
                      {TASK_LABELS_VI[r.taskType] || r.taskType}
                    </td>
                    <td className="py-1.5 px-2.5 font-mono text-slate-800">{r.modelName}</td>
                    <td className="py-1.5 px-2.5 text-right font-semibold tabular-nums text-indigo-900">
                      {r.totalTokens !== null
                        ? `${formatTokenValue(r.promptTokens)} / ${formatTokenValue(r.completionTokens)} / ${formatTokenValue(r.totalTokens)} tok`
                        : 'Tính theo lượt ảnh'}
                    </td>
                    <td className="py-1.5 px-2.5 text-right tabular-nums text-slate-500">
                      {r.durationMs ? `${r.durationMs} ms` : '—'}
                    </td>
                    <td className="py-1.5 px-2.5 text-right font-bold tabular-nums text-[#0F275C]">
                      {r.costUsdFormatted}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
export default AiFinOpsControlPanel;

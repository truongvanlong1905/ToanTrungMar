'use client';

import React, { useState } from 'react';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock3,
  Loader2,
  Play,
  RefreshCw,
  Timer,
  XCircle,
} from 'lucide-react';
import { apiRequest } from '@/core/http/client';
import type {
  PlatformSyncLogDto,
  SyncExecutionResultDto,
  SyncRunType,
  GoogleAdsConnectionInfoDto,
} from '../types';

interface LiveSyncManagerProps {
  logs: PlatformSyncLogDto[];
  isLoadingLogs: boolean;
  onRefreshLogs: () => void;
  onSyncCompleted: () => void;
  csrfToken?: string;
  className?: string;
  connection?: GoogleAdsConnectionInfoDto;
}

export function LiveSyncManager({
  logs,
  isLoadingLogs,
  onRefreshLogs,
  onSyncCompleted,
  csrfToken,
  className = '',
  connection,
}: LiveSyncManagerProps) {
  const [selectedRunType, setSelectedRunType] = useState<SyncRunType>('light');
  const [replayStartDate, setReplayStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [replayEndDate, setReplayEndDate] = useState(() => {
    return new Date().toISOString().slice(0, 10);
  });

  const [isExecuting, setIsExecuting] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
    details?: string;
  } | null>(null);

  async function handleTriggerSync(e: React.FormEvent) {
    e.preventDefault();
    setIsExecuting(true);
    setSyncFeedback(null);

    try {
      const payload: {
        runType: SyncRunType;
        forceMock: boolean;
        startDate?: string;
        endDate?: string;
      } = {
        runType: selectedRunType,
        forceMock: false, // Kết nối trực tiếp Google Ads API thật
      };

      if (selectedRunType === 'replay') {
        payload.startDate = replayStartDate;
        payload.endDate = replayEndDate;
      }

      const result = await apiRequest<SyncExecutionResultDto>('/api/v1/tracking/sync', {
        method: 'POST',
        body: payload,
        csrfToken,
      });

      setSyncFeedback({
        type: 'success',
        message: `Đồng bộ trực tiếp thành công! Đã xử lý ${result.recordsSynced} bản ghi số liệu nền tảng trong ${result.durationMs}ms.`,
        details: `Cửa sổ ngày: ${result.windowStartDate} đến ${result.windowEndDate} · Run ID: #${result.logId}`,
      });

      // Refresh both sync logs and dashboard metrics
      onSyncCompleted();
      onRefreshLogs();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Lỗi không xác định khi thực thi đồng bộ.';
      setSyncFeedback({
        type: 'error',
        message: 'Đồng bộ trực tiếp Google Ads thất bại:',
        details: message,
      });
      // Tải lại nhật ký để người dùng xem chi tiết lỗi lưu trong hệ thống
      onRefreshLogs();
    } finally {
      setIsExecuting(false);
    }
  }

  function formatTime(isoString: string): string {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      return d.toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Schedule Summary Banner */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50/70 p-4">
          <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
          <div>
            <p className="text-xs font-bold text-slate-900">02:00 hàng ngày · Đồng bộ đầy đủ (Full)</p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
              Quét toàn diện cửa sổ 30 ngày gần nhất qua Google Ads API để chốt số liệu đối soát (isFinalized: true).
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-xl border border-violet-200 bg-violet-50/70 p-4">
          <Timer className="mt-0.5 h-5 w-5 shrink-0 text-violet-700" />
          <div>
            <p className="text-xs font-bold text-slate-900">11:00 &amp; 17:00 · Đồng bộ nhanh (Light)</p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
              Cập nhật tức thời số liệu chi phí và click hôm nay và hôm qua, hỗ trợ đội Ads tối ưu chiến dịch kịp thời.
            </p>
          </div>
        </div>
      </div>

      {/* Interactive Trigger Panel */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Kích hoạt tiến trình đồng bộ nền tảng</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Gọi trực tiếp worker đồng bộ BE với cơ chế chống ghi đè lũy đẳng (Idempotent Upsert)
            </p>
          </div>
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-semibold text-blue-700">
            Worker: Google Ads Sync
          </span>
        </div>

        <form onSubmit={handleTriggerSync} className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label
              className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors ${
                selectedRunType === 'light'
                  ? 'border-blue-500 bg-blue-50/60'
                  : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                name="runType"
                value="light"
                checked={selectedRunType === 'light'}
                onChange={() => setSelectedRunType('light')}
                className="mt-0.5 text-blue-600 focus:ring-blue-500"
              />
              <div className="text-xs">
                <p className="font-semibold text-slate-900">Đồng bộ nhanh (Light)</p>
                <p className="mt-0.5 text-[10px] text-slate-500">Hôm nay &amp; hôm qua (2 ngày)</p>
              </div>
            </label>

            <label
              className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors ${
                selectedRunType === 'full'
                  ? 'border-blue-500 bg-blue-50/60'
                  : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                name="runType"
                value="full"
                checked={selectedRunType === 'full'}
                onChange={() => setSelectedRunType('full')}
                className="mt-0.5 text-blue-600 focus:ring-blue-500"
              />
              <div className="text-xs">
                <p className="font-semibold text-slate-900">Đồng bộ đầy đủ (Full)</p>
                <p className="mt-0.5 text-[10px] text-slate-500">Toàn bộ 30 ngày gần nhất</p>
              </div>
            </label>

            <label
              className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors ${
                selectedRunType === 'replay'
                  ? 'border-blue-500 bg-blue-50/60'
                  : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                name="runType"
                value="replay"
                checked={selectedRunType === 'replay'}
                onChange={() => setSelectedRunType('replay')}
                className="mt-0.5 text-blue-600 focus:ring-blue-500"
              />
              <div className="text-xs">
                <p className="font-semibold text-slate-900">Phát lại lịch sử (Replay)</p>
                <p className="mt-0.5 text-[10px] text-slate-500">Tự chọn khoảng ngày bất kỳ</p>
              </div>
            </label>
          </div>

          {selectedRunType === 'replay' && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center gap-1.5 text-xs text-slate-600 font-medium">
                <Calendar className="h-4 w-4 text-slate-500" />
                Khoảng ngày replay:
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[11px] text-slate-500">
                  Từ ngày:
                  <input
                    type="date"
                    value={replayStartDate}
                    onChange={(e) => setReplayStartDate(e.target.value)}
                    className="ml-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
                    required
                  />
                </label>
                <label className="text-[11px] text-slate-500">
                  Đến ngày:
                  <input
                    type="date"
                    value={replayEndDate}
                    onChange={(e) => setReplayEndDate(e.target.value)}
                    className="ml-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
                    required
                  />
                </label>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <p className="text-[11px] text-slate-500">
              * Kích hoạt gọi trực tiếp Google Ads API v26 với tài khoản <span className="font-mono font-bold text-slate-700">{connection?.targetCustomerId || '239-578-6025'}</span> (MCC <span className="font-mono font-bold text-slate-700">{connection?.loginCustomerId || '517-243-4578'}</span>).
            </p>
            <button
              type="submit"
              disabled={isExecuting}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-800 disabled:opacity-50"
            >
              {isExecuting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Đang đồng bộ trực tiếp Google Ads...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  Đồng bộ trực tiếp ngay
                </>
              )}
            </button>
          </div>
        </form>

        {syncFeedback && (
          <div
            className={`mt-4 rounded-lg p-3 text-xs ${
              syncFeedback.type === 'success'
                ? 'border border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border border-rose-200 bg-rose-50 text-rose-900'
            }`}
          >
            <div className="flex items-start gap-2">
              {syncFeedback.type === 'success' ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
              )}
              <div>
                <p className="font-semibold">{syncFeedback.message}</p>
                {syncFeedback.details && (
                  <p className="mt-0.5 text-[11px] opacity-90">{syncFeedback.details}</p>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Live Sync Logs Audit Table */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Lịch sử thực thi đồng bộ (platform_sync_logs)</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Nhật ký kiểm toán mọi phiên chạy của worker theo đúng quy định kiểm toán UC03
            </p>
          </div>
          <button
            type="button"
            onClick={onRefreshLogs}
            disabled={isLoadingLogs}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${isLoadingLogs ? 'animate-spin text-blue-600' : ''}`} />
            Làm mới nhật ký
          </button>
        </div>

        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <AlertCircle className="h-7 w-7 text-slate-400" />
            <p className="mt-2 text-xs font-medium text-slate-600">
              Chưa có phiên đồng bộ nào được ghi nhận. Hãy nhấn "Chạy đồng bộ ngay" ở trên.
            </p>
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs" style={{ minWidth: '760px' }}>
              <thead className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">Nền tảng</th>
                  <th className="px-3 py-2">Loại chạy</th>
                  <th className="px-3 py-2">Cửa sổ ngày</th>
                  <th className="px-3 py-2 text-right">Bản ghi nạp</th>
                  <th className="px-3 py-2">Thời điểm bắt đầu</th>
                  <th className="px-3 py-2 text-right">Thời lượng</th>
                  <th className="px-3 py-2 text-center">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {logs.map((log) => {
                  const isSuccess = log.status === 'success';
                  return (
                    <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-2.5 text-slate-500">#{log.id}</td>
                      <td className="px-3 py-2.5 font-sans font-medium text-slate-800">
                        {log.platform === 'google_ads' ? 'Google Ads API' : log.platform}
                      </td>
                      <td className="px-3 py-2.5 font-sans">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            log.runType === 'full'
                              ? 'bg-purple-100 text-purple-800'
                              : log.runType === 'light'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {log.runType.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 text-[11px]">
                        {log.windowStartDate && log.windowEndDate
                          ? `${log.windowStartDate} → ${log.windowEndDate}`
                          : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold text-slate-900">
                        {log.recordsSynced} dòng
                      </td>
                      <td className="px-3 py-2.5 font-sans text-slate-600 text-[11px]">
                        {formatTime(log.startedAt)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-600">
                        {log.durationMs !== null ? `${log.durationMs}ms` : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-center font-sans">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            isSuccess
                              ? 'bg-emerald-50 text-emerald-700'
                              : log.status === 'running'
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-rose-50 text-rose-700'
                          }`}
                        >
                          {isSuccess ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : log.status === 'running' ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <XCircle className="h-3 w-3" />
                          )}
                          {isSuccess ? 'Hoàn tất' : log.status === 'running' ? 'Đang chạy' : 'Lỗi'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Mail,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { apiRequest } from '@/core/http/client';

type GmailIntakeClassification =
  | 'VALID_FORM'
  | 'DIRECT_INQUIRY'
  | 'NEEDS_REVIEW'
  | 'DUPLICATE'
  | 'IRRELEVANT'
  | 'PROCESSING_ERROR';

interface GmailIntakeAuditEntry {
  messageId: string;
  fromEmail: string | null;
  subject: string;
  classification: GmailIntakeClassification;
  reasonCode: string;
  reasonDetail: string;
  leadCode: string | null;
  sourceWebsite: string | null;
  processedAt: string;
}

interface GmailSyncSummary {
  scanned: number;
  created: number;
  deduplicated: number;
  skippedNoise: number;
  failed: number;
  error: string | null;
  classificationCounts?: Record<GmailIntakeClassification, number>;
  pagesFetched?: number;
}

interface GmailSyncStatusPayload {
  connected: boolean;
  connectedEmail: string | null;
  isSandboxDemo: boolean;
  hasGmailScope: boolean;
  needsAuth?: boolean;
  tokenExpired?: boolean;
  serverStatus?: 'RUNNING' | 'PAUSED' | 'ERROR';
  serverStatusReason?: string;
  checkpoint?: {
    lastError?: string | null;
    consecutiveFailures?: number;
    lastSuccessAt?: string | null;
  } | null;
  syncMode?: 'GMAIL_PUSH_WITH_RECONCILIATION' | 'POLLING_WITH_RECONCILIATION';
  pushConfigured?: boolean;
  pushLimitationReason?: string | null;
  recentAuditLogs?: GmailIntakeAuditEntry[];
  config: {
    enabled: boolean;
    query: string;
    maxMessages: number;
    pollIntervalSec?: number;
    onlyLeadKeywords: boolean;
    lastSyncAt: string | null;
    lastSyncSummary: GmailSyncSummary | null;
  };
}

interface GmailCreatedLeadPreview {
  id: number;
  leadCode: string;
  contactName: string | null;
  email: string | null;
  phone: string;
  projectName: string | null;
  classification?: GmailIntakeClassification;
  sourceWebsite?: string | null;
}

interface GmailSyncRunPayload {
  ok: boolean;
  needsAuth?: boolean;
  needsReauth?: boolean;
  isSandboxDemo?: boolean;
  connectedEmail: string | null;
  message: string;
  summary: GmailSyncSummary;
  createdLeads: GmailCreatedLeadPreview[];
  status?: GmailSyncStatusPayload;
}

interface GmailSyncModalProps {
  open: boolean;
  onClose: () => void;
  csrfToken?: string;
  onSynced: () => void;
}

const CLASSIFICATION_LABELS: Record<GmailIntakeClassification, { label: string; cls: string }> = {
  VALID_FORM: { label: 'Form hợp lệ', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  DIRECT_INQUIRY: { label: 'Khách hỏi trực tiếp', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  NEEDS_REVIEW: { label: 'Cần kiểm tra', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  DUPLICATE: { label: 'Thư trùng', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  IRRELEVANT: { label: 'Không liên quan', cls: 'bg-slate-50 text-slate-500 border-slate-200' },
  PROCESSING_ERROR: { label: 'Lỗi xử lý', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
};

export function GmailSyncModal({
  open,
  onClose,
  csrfToken,
  onSynced,
}: GmailSyncModalProps) {
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const [status, setStatus] = useState<GmailSyncStatusPayload | null>(null);
  const [query, setQuery] = useState('newer_than:14d -category:promotions -category:social');
  const [onlyLeadKeywords, setOnlyLeadKeywords] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [maxMessages, setMaxMessages] = useState(40);
  const [pollIntervalSec, setPollIntervalSec] = useState(30);
  const [runResult, setRunResult] = useState<GmailSyncRunPayload | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await apiRequest<GmailSyncStatusPayload>('/api/v1/leads/gmail-sync');
      setStatus(data);
      setQuery(data.config.query);
      setOnlyLeadKeywords(data.config.onlyLeadKeywords);
      setEnabled(data.config.enabled);
      setMaxMessages(data.config.maxMessages);
      setPollIntervalSec(data.config.pollIntervalSec || 30);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể tải cấu hình Gmail.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setRunResult(null);
      void loadStatus();
    }
  }, [open, loadStatus]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleAuthorizeGmail = async () => {
    setAuthorizing(true);
    setErrorMsg(null);
    try {
      const res = await apiRequest<{
        needsConfig?: boolean;
        authUrl?: string | null;
        message?: string | null;
      }>('/api/v1/auth/google/authorize?returnPath=/leads');
      if (res.authUrl) {
        window.location.href = res.authUrl;
        return;
      }
      setErrorMsg(res.message || 'Chưa cấu hình Google Client ID & Client Secret.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể mở trang cấp quyền Google.');
    } finally {
      setAuthorizing(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    setErrorMsg(null);
    setRunResult(null);
    try {
      const res = await apiRequest<GmailSyncRunPayload>('/api/v1/leads/gmail-sync', {
        method: 'POST',
        csrfToken,
        body: {
          action: 'sync_now',
          enabled,
          query,
          maxMessages,
          pollIntervalSec,
          onlyLeadKeywords,
        },
      });
      setRunResult(res);
      if (res.status) setStatus(res.status);
      if (res.ok && res.summary.created > 0) {
        onSynced();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi khi quét Gmail.');
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveConfig = async (overrideEnabled?: boolean) => {
    setSaving(true);
    setErrorMsg(null);
    const nextEnabled = typeof overrideEnabled === 'boolean' ? overrideEnabled : enabled;
    if (typeof overrideEnabled === 'boolean') setEnabled(overrideEnabled);
    try {
      const res = await apiRequest<GmailSyncStatusPayload>('/api/v1/leads/gmail-sync', {
        method: 'POST',
        csrfToken,
        body: {
          action: 'save_config',
          enabled: nextEnabled,
          query,
          maxMessages,
          pollIntervalSec,
          onlyLeadKeywords,
        },
      });
      setStatus(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể lưu cấu hình.');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const needsReauth = Boolean(
    (status && status.connected && !status.isSandboxDemo && !status.hasGmailScope) ||
      runResult?.needsReauth,
  );
  const needsAuth = Boolean(
    (status &&
      (!status.connected ||
        status.needsAuth ||
        status.tokenExpired ||
        status.checkpoint?.lastError === 'HTTP_401' ||
        status.checkpoint?.lastError === 'TOKEN_EXPIRED')) ||
      runResult?.needsAuth,
  );
  const serverStatus = status?.serverStatus || (enabled ? 'RUNNING' : 'PAUSED');
  const recentLogs = status?.recentAuditLogs || [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gmail-sync-modal-title"
    >
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h3 id="gmail-sync-modal-title" className="text-base font-bold text-slate-900">
                Tiếp nhận Lead Tự Động Từ Gmail
              </h3>
              <p className="text-xs text-slate-500">
                Chạy nền tại máy chủ (hoạt động cả khi đóng trình duyệt), sàng lọc form và chống trùng lặp
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng hộp thoại Gmail"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {loading ? (
            <div className="py-8 flex items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="w-4 h-4 motion-safe:animate-spin" />
              <span>Đang kiểm tra kết nối Google / Gmail...</span>
            </div>
          ) : (
            <>
              {/* 1. Server Runtime Status + Sync Mode (U01 + U06) */}
              <div
                className={`rounded-xl border p-3.5 flex flex-wrap items-center justify-between gap-3 ${
                  serverStatus === 'RUNNING'
                    ? 'bg-emerald-50/70 border-emerald-200'
                    : serverStatus === 'PAUSED'
                      ? 'bg-slate-50 border-slate-200'
                      : 'bg-amber-50/80 border-amber-200'
                }`}
              >
                <div className="flex items-start gap-2.5 min-w-0 flex-1">
                  {serverStatus === 'RUNNING' ? (
                    <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  ) : serverStatus === 'PAUSED' ? (
                    <PauseCircle className="w-5 h-5 text-slate-500 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  )}
                  <div className="text-xs space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-slate-900">
                        {status?.connected
                          ? `Hộp thư: ${status.connectedEmail}`
                          : 'Chưa kết nối tài khoản Google / Gmail'}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                          serverStatus === 'RUNNING'
                            ? 'bg-emerald-100 text-emerald-800'
                            : serverStatus === 'PAUSED'
                              ? 'bg-slate-200 text-slate-700'
                              : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {serverStatus === 'RUNNING'
                          ? 'Đang chạy'
                          : serverStatus === 'PAUSED'
                            ? 'Tạm dừng'
                            : 'Có lỗi'}
                      </span>
                    </div>
                    <div className="text-slate-600">
                      {status?.serverStatusReason || 'Sẵn sàng đồng bộ từ máy chủ.'}
                    </div>
                    {status?.pushLimitationReason && (
                      <div className="text-[11px] text-slate-500">
                        <strong>Chế độ:</strong> {status.pushLimitationReason}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {(needsAuth || needsReauth || status?.isSandboxDemo) ? (
                    <button
                      type="button"
                      disabled={authorizing}
                      onClick={handleAuthorizeGmail}
                      className="h-8 px-3 rounded-lg bg-[#1E3A8A] hover:bg-blue-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
                    >
                      <Mail className="w-3.5 h-3.5" />
                      <span>
                        {needsReauth
                          ? 'Cấp quyền đọc Gmail'
                          : status?.tokenExpired || (status?.connected && needsAuth)
                            ? 'Kết nối lại Google'
                            : 'Kết nối Google'}
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleSaveConfig(!enabled)}
                      className={`h-8 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 border ${
                        enabled
                          ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
                          : 'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700'
                      }`}
                    >
                      {enabled ? (
                        <>
                          <PauseCircle className="w-3.5 h-3.5" />
                          <span>Tạm dừng</span>
                        </>
                      ) : (
                        <>
                          <PlayCircle className="w-3.5 h-3.5" />
                          <span>Bật tự động</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* 2. Latest Sync Summary & Screening Results */}
              {(runResult || status?.config.lastSyncAt) && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 text-xs space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-slate-800">
                      Kết quả đồng bộ gần nhất
                    </span>
                    {status?.config.lastSyncAt && (
                      <span className="text-[11px] text-slate-500">
                        {new Date(status.config.lastSyncAt).toLocaleString('vi-VN')}
                      </span>
                    )}
                  </div>

                  {runResult && (
                    <div
                      className={`flex items-start gap-2 font-semibold ${
                        runResult.ok ? 'text-emerald-800' : 'text-amber-800'
                      }`}
                    >
                      {runResult.ok ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      )}
                      <span>{runResult.message}</span>
                    </div>
                  )}

                  {status?.config.lastSyncSummary?.classificationCounts && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {(Object.keys(CLASSIFICATION_LABELS) as GmailIntakeClassification[]).map((k) => {
                        const cnt = status.config.lastSyncSummary?.classificationCounts?.[k] || 0;
                        return (
                          <span
                            key={k}
                            className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold ${CLASSIFICATION_LABELS[k].cls}`}
                          >
                            {CLASSIFICATION_LABELS[k].label}: {cnt}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {errorMsg && (
                <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                  {errorMsg}
                </div>
              )}

              {/* 3. Recent Screening Audit Reasons (U01 reconciliation) */}
              {recentLogs.length > 0 && (
                <details className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
                  <summary className="cursor-pointer font-semibold text-slate-700 flex items-center justify-between">
                    <span>Nhật ký sàng lọc & lý do xử lý gần đây ({recentLogs.length} thư)</span>
                    <span className="text-[11px] text-blue-700">Xem đối soát ▾</span>
                  </summary>
                  <div className="mt-2.5 max-h-44 overflow-y-auto divide-y divide-slate-100">
                    {recentLogs.slice(0, 12).map((entry) => {
                      const meta = CLASSIFICATION_LABELS[entry.classification];
                      return (
                        <div key={`${entry.messageId}-${entry.processedAt}`} className="py-2 space-y-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-800 truncate">{entry.subject}</span>
                            <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold shrink-0 ${meta.cls}`}>
                              {meta.label}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-600">{entry.reasonDetail}</div>
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}

              {/* 4. Advanced Technical Settings (U06: Collapsed behind details) */}
              <details className="rounded-xl border border-slate-200 bg-slate-50/40 p-3 text-xs">
                <summary className="cursor-pointer font-semibold text-slate-700 flex items-center justify-between">
                  <span>Cấu hình nâng cao (Gmail query, batch size, chu kỳ quét)</span>
                  <span className="text-[11px] text-slate-500">Mở rộng ▾</span>
                </summary>
                <div className="mt-3 space-y-3">
                  <div>
                    <label htmlFor="gmail-query-input" className="block text-xs font-semibold text-slate-700 mb-1">
                      Bộ lọc tìm kiếm Gmail (Gmail Query)
                    </label>
                    <input
                      id="gmail-query-input"
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="newer_than:14d -category:promotions -category:social"
                      className="w-full h-9 px-3 rounded-lg border border-slate-300 text-xs font-mono text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="gmail-batch-select" className="block text-xs font-semibold text-slate-700 mb-1">
                        Kích thước mỗi trang (phân trang tự động)
                      </label>
                      <select
                        id="gmail-batch-select"
                        value={maxMessages}
                        onChange={(e) => setMaxMessages(Number(e.target.value))}
                        className="w-full h-9 px-2.5 rounded-lg border border-slate-300 text-xs text-slate-800 bg-white"
                      >
                        <option value={20}>20 thư / trang</option>
                        <option value={40}>40 thư / trang</option>
                        <option value={50}>50 thư / trang (tối đa 250 thư/lượt)</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor="gmail-interval-select" className="block text-xs font-semibold text-slate-700 mb-1">
                        Chu kỳ Poller backend
                      </label>
                      <select
                        id="gmail-interval-select"
                        value={pollIntervalSec}
                        onChange={(e) => setPollIntervalSec(Number(e.target.value))}
                        className="w-full h-9 px-2.5 rounded-lg border border-slate-300 text-xs text-slate-800 bg-white"
                      >
                        <option value={15}>15 giây</option>
                        <option value={30}>30 giây (khuyến nghị)</option>
                        <option value={60}>60 giây</option>
                      </select>
                    </div>
                  </div>

                  <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={onlyLeadKeywords}
                      onChange={(e) => setOnlyLeadKeywords(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600"
                    />
                    <span>Sàng lọc nghiêm ngặt theo cấu trúc form hoặc từ khóa nhu cầu sản phẩm</span>
                  </label>
                </div>
              </details>
            </>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50/70 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => void handleSaveConfig()}
            disabled={loading || syncing || saving}
            className="h-9 px-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700"
          >
            {saving ? 'Đang lưu...' : 'Lưu cấu hình'}
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-3.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700"
            >
              Đóng
            </button>
            <button
              type="button"
              onClick={handleSyncNow}
              disabled={loading || syncing}
              className="h-9 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60 shadow-2xs"
            >
              {syncing ? (
                <Loader2 className="w-4 h-4 motion-safe:animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              <span>{syncing ? 'Đang quét Gmail...' : 'Quét & Tạo Lead ngay'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

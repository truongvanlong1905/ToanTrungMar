'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Key,
  Link as LinkIcon,
  Loader2,
  Lock,
  RefreshCw,
  Unlink,
} from 'lucide-react';
import type { GoogleOAuthStatusDto, GoogleOAuthClientConfigDto } from '@toantrung/contracts';
import { apiRequest } from '@/core/http/client';
import { useSession } from '@/core/session/SessionContext';

interface GoogleOAuthManagerProps {
  compact?: boolean;
  returnPath?: string;
  onSyncCompleted?: () => void;
}

export function GoogleOAuthManager({
  compact = false,
  returnPath = '/tracking',
  onSyncCompleted,
}: GoogleOAuthManagerProps) {
  const { user } = useSession();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<GoogleOAuthStatusDto | null>(null);
  const [clientConfig, setClientConfig] = useState<GoogleOAuthClientConfigDto | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Config modal
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [clientIdInput, setClientIdInput] = useState('');
  const [clientSecretInput, setClientSecretInput] = useState('');

  // Google Ads API Config state
  const [adsConfig, setAdsConfig] = useState<{
    hasDeveloperToken: boolean;
    developerTokenMasked: string | null;
    customerId: string | null;
    loginCustomerId: string | null;
  } | null>(null);
  const [devTokenInput, setDevTokenInput] = useState('');
  const [adsCustomerIdInput, setAdsCustomerIdInput] = useState('');
  const [adsMccIdInput, setAdsMccIdInput] = useState('');

  const fetchStatus = useCallback(async () => {
    try {
      const res = await apiRequest<{
        status: GoogleOAuthStatusDto;
        clientConfig: GoogleOAuthClientConfigDto;
        adsConfig?: {
          hasDeveloperToken: boolean;
          developerTokenMasked: string | null;
          customerId: string | null;
          loginCustomerId: string | null;
        };
      }>('/api/v1/auth/google/status');
      setStatus(res.status);
      setClientConfig(res.clientConfig);
      if (res.adsConfig) {
        setAdsConfig(res.adsConfig);
        setAdsCustomerIdInput((prev) => prev || res.adsConfig?.customerId || '');
        setAdsMccIdInput((prev) => prev || res.adsConfig?.loginCustomerId || '');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi lấy trạng thái kết nối Google.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();

    // Check if redirected from Google OAuth callback
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const authState = params.get('google_auth');
      if (authState === 'success') {
        const email = params.get('email') || 'tài khoản Google';
        setFeedbackMsg(`Đã kết nối Google OAuth 2.0 thành công với email: ${email}!`);
        // Remove query params cleanly
        window.history.replaceState({}, document.title, window.location.pathname);
        void fetchStatus();
      } else if (authState === 'error') {
        const msg = params.get('msg') || 'Xác thực Google không thành công.';
        setErrorMsg(`Lỗi Google OAuth: ${msg}`);
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
  }, [fetchStatus]);

  const handleStartOAuth = async () => {
    setBusy(true);
    setErrorMsg(null);
    setFeedbackMsg(null);
    try {
      const res = await apiRequest<{
        needsConfig: boolean;
        authUrl: string | null;
        message: string | null;
      }>(`/api/v1/auth/google/authorize?returnPath=${encodeURIComponent(returnPath)}`);

      if (res.needsConfig || !res.authUrl) {
        setShowConfigModal(true);
        return;
      }

      // Redirect browser directly to Google OAuth Consent screen
      window.location.href = res.authUrl;
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể khởi động kết nối Google.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveClientConfig = async () => {
    if (!clientIdInput.trim() || !clientSecretInput.trim()) {
      setErrorMsg('Vui lòng điền đầy đủ cả Google Client ID và Client Secret.');
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await apiRequest<{
        message: string;
        status: GoogleOAuthStatusDto;
        clientConfig: GoogleOAuthClientConfigDto;
      }>('/api/v1/auth/google/status', {
        method: 'POST',
        csrfToken: user?.csrfToken,
        body: {
          action: 'save_client_config',
          clientId: clientIdInput.trim(),
          clientSecret: clientSecretInput.trim(),
        },
      });
      setStatus(res.status);
      setClientConfig(res.clientConfig);
      setShowConfigModal(false);
      setFeedbackMsg(res.message);
      // Immediately start OAuth flow with saved credentials
      const authRes = await apiRequest<{
        needsConfig: boolean;
        authUrl: string | null;
      }>(`/api/v1/auth/google/authorize?returnPath=${encodeURIComponent(returnPath)}`);
      if (authRes.authUrl) {
        window.location.href = authRes.authUrl;
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi lưu cấu hình Google Client.');
    } finally {
      setBusy(false);
    }
  };

  const handleDemoConnect = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await apiRequest<{
        message: string;
        status: GoogleOAuthStatusDto;
      }>('/api/v1/auth/google/status', {
        method: 'POST',
        csrfToken: user?.csrfToken,
        body: { action: 'demo_connect' },
      });
      setStatus(res.status);
      setShowConfigModal(false);
      setFeedbackMsg(res.message);
      if (onSyncCompleted) onSyncCompleted();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi kích hoạt kết nối mẫu.');
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Bạn có chắc chắn muốn ngắt kết nối tài khoản Google khỏi hệ thống?')) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await apiRequest<{
        message: string;
        status: GoogleOAuthStatusDto;
      }>('/api/v1/auth/google/status', {
        method: 'POST',
        csrfToken: user?.csrfToken,
        body: { action: 'disconnect' },
      });
      setStatus(res.status);
      setFeedbackMsg(res.message);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi ngắt kết nối Google.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveAdsConfig = async () => {
    setBusy(true);
    setErrorMsg(null);
    setFeedbackMsg(null);
    try {
      const res = await apiRequest<{
        message: string;
        status: GoogleOAuthStatusDto;
        adsConfig: {
          hasDeveloperToken: boolean;
          developerTokenMasked: string | null;
          customerId: string | null;
          loginCustomerId: string | null;
        };
      }>('/api/v1/auth/google/status', {
        method: 'POST',
        csrfToken: user?.csrfToken,
        body: {
          action: 'save_ads_config',
          developerToken: devTokenInput.trim() || undefined,
          customerId: adsCustomerIdInput.trim(),
          loginCustomerId: adsMccIdInput.trim(),
        },
      });
      setStatus(res.status);
      setAdsConfig(res.adsConfig);
      setDevTokenInput('');
      setFeedbackMsg(res.message);
      if (onSyncCompleted) onSyncCompleted();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi lưu cấu hình Google Ads API.');
    } finally {
      setBusy(false);
    }
  };

  const handleSyncAllNow = async () => {
    setBusy(true);
    setErrorMsg(null);
    setFeedbackMsg(null);
    try {
      const res = await apiRequest<{
        message: string;
        status: GoogleOAuthStatusDto;
      }>('/api/v1/auth/google/sync', {
        method: 'POST',
        csrfToken: user?.csrfToken,
        body: { slot: 'MANUAL_RETRY' },
      });
      setStatus(res.status);
      setFeedbackMsg(res.message);
      if (onSyncCompleted) onSyncCompleted();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi đồng bộ dữ liệu Google.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-3 text-xs text-slate-500 bg-slate-50 rounded-xl border border-slate-200">
        <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
        <span>Đang kiểm tra kết nối Google OAuth...</span>
      </div>
    );
  }

  // COMPACT MODE: Top bar banner in Module 02 & Module 03 (Enhanced large legible design)
  if (compact) {
    const isExpiredOrErr =
      status?.connectionStatus === 'EXPIRED' ||
      status?.connectionStatus === 'PERMISSION_ERROR' ||
      status?.connectionStatus === 'SYNC_ERROR';

    if (status?.connected && !isExpiredOrErr) {
      return (
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-emerald-50/70 border border-emerald-200 shadow-2xs">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
              G
            </div>
            <div>
              <div className="flex items-center gap-2 font-bold text-xs sm:text-sm text-emerald-950 flex-wrap">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span>Google đã kết nối:</span>
                <span className="font-mono text-emerald-900">{status.connectedEmail || 'Tài khoản Công ty'}</span>
                {status.isSandboxDemo && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-semibold border border-amber-300">
                    Demo Sandbox
                  </span>
                )}
              </div>
              <div className="text-[11px] text-emerald-800 mt-0.5 flex items-center gap-2 flex-wrap">
                <span>Chốt dữ liệu 02:00 · 11:00 · 17:00</span>
                <span>·</span>
                <span>Gần nhất: {status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleTimeString('vi-VN') : 'Vừa xong'}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleSyncAllNow()}
              className="h-9 px-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 shadow-2xs transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
              <span>{busy ? 'Đang đồng bộ...' : 'Đồng bộ ngay'}</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleDisconnect()}
              className="h-9 px-2.5 rounded-xl bg-white border border-slate-300 hover:bg-rose-50 hover:text-rose-700 text-slate-700 font-semibold inline-flex items-center transition shadow-2xs"
              title="Ngắt kết nối Google"
            >
              <Unlink className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      );
    }

    if (status?.connected && isExpiredOrErr) {
      return (
        <div className="flex flex-wrap items-center justify-between gap-2.5 p-3 rounded-2xl bg-rose-50/80 border border-rose-200 text-xs shadow-2xs">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <div>
              <div className="font-bold text-rose-950">
                Phiên kết nối Google ({status.connectedEmail}) đã hết hạn
              </div>
              <div className="text-[11px] text-rose-800 mt-0.5">
                Vui lòng kết nối lại để tiếp tục đồng bộ GA4, Google Ads và Search Console.
              </div>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleStartOAuth()}
            className="h-8 px-3.5 rounded-xl bg-[#1E3A8A] hover:bg-blue-900 text-white font-semibold inline-flex items-center gap-1.5 shadow-2xs transition"
          >
            <LinkIcon className="w-3.5 h-3.5" />
            <span>Kết nối lại Google</span>
          </button>
        </div>
      );
    }

    return (
      <div className="flex flex-wrap items-center justify-between gap-2.5 p-3 rounded-2xl bg-gradient-to-r from-blue-50/90 to-indigo-50/70 border border-blue-200 text-xs shadow-2xs">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs">
            G
          </div>
          <div>
            <div className="font-bold text-slate-900 flex items-center gap-1.5">
              <span>Kết nối dữ liệu Google Analytics 4 &amp; Google Ads</span>
            </div>
            <div className="text-[11px] text-slate-600 mt-0.5">
              1-Click Đăng nhập &amp; Cấp quyền OAuth 2.0 để hệ thống tự động tải số liệu về mỗi ngày (02:00, 11:00, 17:00).
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleStartOAuth()}
            className="h-8 px-3.5 rounded-xl bg-[#1E3A8A] hover:bg-blue-900 text-white font-bold inline-flex items-center gap-1.5 shadow-2xs transition"
          >
            <LinkIcon className="w-3.5 h-3.5" />
            <span>Đăng nhập Google (OAuth 2.0)</span>
          </button>
        </div>
      </div>
    );
  }

  // FULL HUB MODE: Settings Page
  return (
    <div className="space-y-6">
      {/* Notifications */}
      {feedbackMsg && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm flex items-start gap-2.5 animate-in fade-in">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="flex-1 font-medium">{feedbackMsg}</div>
          <button
            type="button"
            onClick={() => setFeedbackMsg(null)}
            className="text-xs text-emerald-700 hover:underline font-bold"
          >
            Đóng
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 text-sm flex items-start gap-2.5 animate-in fade-in">
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1 font-medium">{errorMsg}</div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-xs text-rose-700 hover:underline font-bold"
          >
            Đóng
          </button>
        </div>
      )}

      {/* Main Connection Status Card */}
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-2xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4 bg-slate-50/50">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-white border border-slate-200 shadow-2xs flex items-center justify-center shrink-0">
              <svg className="w-6 h-6" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 flex-wrap">
                <span>Tài khoản Google kết nối</span>
                {status?.connectionStatus === 'EXPIRED' ? (
                  <span className="px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 text-xs font-bold inline-flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Hết hạn kết nối
                  </span>
                ) : status?.connectionStatus === 'PERMISSION_ERROR' || status?.connectionStatus === 'SYNC_ERROR' ? (
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-bold inline-flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Cần kết nối lại
                  </span>
                ) : status?.connected ? (
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold inline-flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Đã kết nối
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold">
                    Chưa kết nối
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {status?.lastErrorMessage && (status?.connectionStatus === 'EXPIRED' || status?.connectionStatus === 'PERMISSION_ERROR' || status?.connectionStatus === 'SYNC_ERROR')
                  ? status.lastErrorMessage
                  : 'Dùng chung cho Gmail Lead, Google Analytics 4, Google Ads và Search Console.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {status?.connected ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleStartOAuth()}
                  className={`h-9 px-3.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 shadow-2xs transition ${
                    status.connectionStatus === 'EXPIRED' || status.connectionStatus === 'PERMISSION_ERROR'
                      ? 'bg-[#1E3A8A] hover:bg-blue-900 text-white'
                      : 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <LinkIcon className="w-3.5 h-3.5" />
                  <span>Kết nối lại Google</span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleDisconnect()}
                  className="h-9 px-3 rounded-xl bg-white border border-rose-200 hover:bg-rose-50 text-rose-700 text-xs font-semibold inline-flex items-center gap-1.5 shadow-2xs transition"
                >
                  <Unlink className="w-3.5 h-3.5" />
                  <span>Ngắt kết nối</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleStartOAuth()}
                className="h-9 px-4 rounded-xl bg-[#1E3A8A] hover:bg-blue-900 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-2xs transition"
              >
                <LinkIcon className="w-3.5 h-3.5" />
                <span>Đăng nhập Google</span>
              </button>
            )}
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Box 1: Account Info */}
            <div className="p-4 rounded-2xl bg-slate-50/70 border border-slate-200/80">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Email liên kết
              </div>
              {status?.connected ? (
                <div>
                  <div className="font-bold text-slate-900 text-sm">{status.connectedName || 'Toàn Trung'}</div>
                  <div className="font-mono text-xs text-blue-700 mt-0.5 break-all">{status.connectedEmail}</div>
                  <div className="text-[11px] text-slate-500 mt-1.5">
                    Kết nối lúc: {status.connectedAt ? new Date(status.connectedAt).toLocaleString('vi-VN') : '—'}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-400">
                  Chưa có tài khoản Google nào được liên kết.
                </div>
              )}
            </div>

            {/* Box 2: Automated Schedules */}
            <div className="p-4 rounded-2xl bg-slate-50/70 border border-slate-200/80">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-blue-600" />
                <span>Lịch chốt dữ liệu tự động</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
                <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-1 rounded">02:00</span>
                <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-1 rounded">11:00</span>
                <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-1 rounded">17:00</span>
              </div>
              <div className="text-[11px] text-slate-500 mt-2">
                Nếu Google Cloud ở chế độ Testing, token hết hạn sau 7 ngày và cần bấm Kết nối lại.
              </div>
            </div>
          </div>

          {/* Client ID Config Trigger */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs text-slate-500">
            <div className="flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-slate-400" />
              <span>Google Client ID: </span>
              {clientConfig?.hasClientId ? (
                <span className="font-mono text-slate-700 font-semibold">{clientConfig.clientIdMasked}</span>
              ) : (
                <span className="text-amber-700 font-semibold">Chưa cấu hình</span>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setShowConfigModal(true);
              }}
              className="text-blue-700 hover:underline font-semibold"
            >
              Đổi Client ID / Secret →
            </button>
          </div>
        </div>
      </div>

      {/* Khối Cấu hình Google Ads API */}
      <form
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSaveAdsConfig();
        }}
        className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 flex-wrap">
              <span>Cấu hình Google Ads</span>
              {(status?.selectedGadsCustomerId || adsConfig?.customerId) && (
                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[11px] font-mono font-semibold">
                  ID: {status?.selectedGadsCustomerId || adsConfig?.customerId}
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Nhập Customer ID (10 số) hoặc MCC ID để lấy số liệu chiến dịch và cụm từ tìm kiếm.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label htmlFor="gads-dev-token-input" className="block text-xs font-semibold text-slate-700 mb-1">
              Developer Token (tùy chọn)
            </label>
            <input
              id="gads-dev-token-input"
              name="google_ads_developer_token"
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              data-lpignore="true"
              value={devTokenInput}
              onChange={(e) => setDevTokenInput(e.target.value)}
              placeholder={
                adsConfig?.hasDeveloperToken
                  ? `Đang lưu: ${adsConfig.developerTokenMasked}`
                  : 'Nhập nếu tài khoản yêu cầu'
              }
              className="w-full min-h-9 px-3 rounded-xl border border-slate-300 text-xs font-mono focus:border-[#1E3A8A] outline-none"
            />
          </div>

          <div>
            <label htmlFor="gads-customer-id-input" className="block text-xs font-semibold text-slate-700 mb-1">
              Customer ID (10 số)
            </label>
            <input
              id="gads-customer-id-input"
              name="google_ads_customer_id"
              type="text"
              autoComplete="off"
              spellCheck={false}
              data-lpignore="true"
              value={adsCustomerIdInput}
              onChange={(e) => setAdsCustomerIdInput(e.target.value)}
              placeholder="VD: 123-456-7890"
              className="w-full min-h-9 px-3 rounded-xl border border-slate-300 text-xs font-mono focus:border-[#1E3A8A] outline-none"
            />
          </div>

          <div>
            <label htmlFor="gads-mcc-id-input" className="block text-xs font-semibold text-slate-700 mb-1">
              MCC ID (tùy chọn)
            </label>
            <input
              id="gads-mcc-id-input"
              name="google_ads_mcc_id"
              type="text"
              autoComplete="off"
              spellCheck={false}
              data-lpignore="true"
              value={adsMccIdInput}
              onChange={(e) => setAdsMccIdInput(e.target.value)}
              placeholder="VD: 987-654-3210"
              className="w-full min-h-9 px-3 rounded-xl border border-slate-300 text-xs font-mono focus:border-[#1E3A8A] outline-none"
            />
          </div>
        </div>

        <div className="flex justify-end pt-1">
          <button
            type="submit"
            disabled={busy}
            className="min-h-9 px-4 rounded-xl bg-[#0F275C] hover:bg-[#1E3A8A] text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-2xs transition disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            <span>Lưu &amp; Đồng bộ Ads</span>
          </button>
        </div>
      </form>

      {/* Config Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSaveClientConfig();
            }}
            className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <Key className="w-5 h-5 text-blue-600" />
                <span>Cấu hình Google OAuth Client</span>
              </h3>
              <button
                type="button"
                aria-label="Đóng cấu hình OAuth Client"
                onClick={() => setShowConfigModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Để dùng tài khoản Google thật của công ty, bạn cần tạo OAuth Client ID trên{' '}
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 underline font-semibold inline-flex items-center gap-0.5"
              >
                Google Cloud Console <ExternalLink className="w-3 h-3" />
              </a>
              . Thêm đường dẫn Callback sau vào mục <strong>Authorized redirect URIs</strong>:
            </p>

            <div className="p-2.5 rounded-xl bg-slate-100 font-mono text-[11px] text-slate-800 break-all select-all border border-slate-200">
              {typeof window !== 'undefined' ? `${window.location.origin}/api/v1/auth/google/callback` : 'http://localhost:3000/api/v1/auth/google/callback'}
            </div>

            <div className="space-y-3">
              <div>
                <label htmlFor="oauth-client-id-input" className="block text-xs font-bold text-slate-700 mb-1">Google Client ID</label>
                <input
                  id="oauth-client-id-input"
                  name="google_oauth_client_id"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="xxxx.apps.googleusercontent.com"
                  value={clientIdInput}
                  onChange={(e) => setClientIdInput(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 text-xs font-mono focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="oauth-client-secret-input" className="block text-xs font-bold text-slate-700 mb-1">Google Client Secret</label>
                <input
                  id="oauth-client-secret-input"
                  name="google_oauth_client_secret"
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  placeholder="GOCSPX-xxxxxx"
                  value={clientSecretInput}
                  onChange={(e) => setClientSecretInput(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 text-xs font-mono focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-700 space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-emerald-800">
                <Lock className="w-3.5 h-3.5 text-emerald-600" />
                <span>Bảo mật &amp; Quyền riêng tư tuyệt đối</span>
              </div>
              <p className="text-slate-600">
                Mã này được lưu trữ riêng biệt trên máy tính của bạn và không bao giờ hiển thị công khai. Bạn cũng có thể mở file <code>.env</code> trực tiếp trong mã nguồn để dán vào biến <code>GOOGLE_CLIENT_ID</code> và <code>GOOGLE_CLIENT_SECRET</code> nếu không muốn thao tác trên giao diện.
              </p>
            </div>

            <div className="flex items-center justify-end pt-3 border-t border-slate-100">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowConfigModal(false)}
                  className="h-9 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="h-9 px-4 rounded-xl bg-[#1E3A8A] hover:bg-blue-900 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-2xs transition"
                >
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  <span>Lưu &amp; Đăng nhập ngay</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}


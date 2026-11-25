'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  FlaskConical,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  X,
  AlertCircle,
} from 'lucide-react';
import {
  DESIGN_TASK_LABELS,
  type AiModelRegistrySnapshotDto,
  type AiProviderId,
  type AiTaskValidationStatus,
  type DesignTaskCode,
} from '@toantrung/contracts';
import { apiRequest } from '@/core/http/client';
import { useSession } from '@/core/session/SessionContext';

interface ModelRegistryModalProps {
  open: boolean;
  onClose: () => void;
  snapshot: AiModelRegistrySnapshotDto | undefined;
  canAdminRefresh: boolean;
  canProbe: boolean;
  onRegistryUpdated: (next: AiModelRegistrySnapshotDto) => void;
}

const STATUS_BADGE: Record<AiTaskValidationStatus, { label: string; cls: string }> = {
  verified: { label: 'Đã xác minh', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  listed_unverified: { label: 'Có trong catalog (chưa probe)', cls: 'bg-blue-50 text-blue-800 border-blue-200' },
  blocked_permission: { label: 'Bị từ chối quyền', cls: 'bg-red-50 text-red-800 border-red-200' },
  blocked_quota_billing: { label: 'Hết quota / Billing 0', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  deprecated: { label: 'Ngừng hỗ trợ (404)', cls: 'bg-slate-100 text-slate-600 border-slate-200 line-through' },
  unsupported: { label: 'Không hỗ trợ tác vụ', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
  failed_error: { label: 'Lỗi kết nối', cls: 'bg-rose-50 text-rose-800 border-rose-200' },
};

const TASK_KEYS: DesignTaskCode[] = [
  'banner_generate',
  'design_edit',
  'perspective_compose',
  'brief_analyze',
];

export function ModelRegistryModal({
  open,
  onClose,
  snapshot,
  canAdminRefresh,
  canProbe,
  onRegistryUpdated,
}: ModelRegistryModalProps) {
  const { user } = useSession();
  const [refreshing, setRefreshing] = useState(false);
  const [probingKey, setProbingKey] = useState<string | null>(null);
  const [providerFilter, setProviderFilter] = useState<string>('all');
  const [probeMessage, setProbeMessage] = useState<string | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || typeof HTMLDialogElement === 'undefined') return;
    if ('closedBy' in HTMLDialogElement.prototype) return;

    const handleBackdropClick = (event: MouseEvent) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const isDialogContent =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (isDialogContent) return;
      dialog.close();
    };
    dialog.addEventListener('click', handleBackdropClick);
    return () => dialog.removeEventListener('click', handleBackdropClick);
  }, []);

  const handleRefreshRegistry = async () => {
    setRefreshing(true);
    setProbeError(null);
    setProbeMessage(null);
    try {
      const res = await apiRequest<{ ok: boolean; modelRegistry: AiModelRegistrySnapshotDto }>(
        '/api/v1/design',
        {
          method: 'POST',
          csrfToken: user?.csrfToken,
          body: {
            action: 'refresh_model_registry',
            ...(providerFilter !== 'all' ? { providerId: providerFilter } : {}),
          },
        },
      );
      if (res.modelRegistry) {
        onRegistryUpdated(res.modelRegistry);
        setProbeMessage('Đã làm mới danh mục Model từ các endpoint đã cấu hình.');
      }
    } catch (err) {
      setProbeError(err instanceof Error ? err.message : 'Không thể làm mới registry.');
    } finally {
      setRefreshing(false);
    }
  };

  const handleProbeTask = async (
    providerId: AiProviderId,
    modelId: string,
    taskCode: DesignTaskCode,
  ) => {
    const pKey = `${providerId}::${modelId}::${taskCode}`;
    setProbingKey(pKey);
    setProbeError(null);
    setProbeMessage(null);
    try {
      const res = await apiRequest<{
        ok: boolean;
        taskStatus: AiTaskValidationStatus;
        detail: string;
        reportedModel: string | null;
        snapshot: AiModelRegistrySnapshotDto;
      }>('/api/v1/design', {
        method: 'POST',
        csrfToken: user?.csrfToken,
        body: {
          action: 'probe_model_capability',
          providerId,
          modelId,
          taskCode,
        },
      });
      if (res.snapshot) {
        onRegistryUpdated(res.snapshot);
      }
      if (res.ok) {
        setProbeMessage(`Probe ${modelId} (${taskCode}): ${res.detail}`);
      } else {
        setProbeError(`Probe ${modelId} (${taskCode}) [${res.taskStatus}]: ${res.detail}`);
      }
    } catch (err) {
      setProbeError(err instanceof Error ? err.message : 'Probe thất bại.');
    } finally {
      setProbingKey(null);
    }
  };

  const filteredModels = (snapshot?.models || []).filter(
    (m) => providerFilter === 'all' || m.providerId === providerFilter,
  );

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="model-registry-dialog-title"
      onClose={onClose}
      {...({ closedby: 'any' } as Record<string, unknown>)}
      className="w-full max-w-5xl max-h-[88vh] rounded-2xl bg-white border border-slate-200 shadow-2xl p-0 overflow-hidden backdrop:bg-slate-900/50 backdrop:backdrop-blur-xs overscroll-contain"
    >
      <div className="flex flex-col max-h-[88vh]">
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 bg-slate-50">
          <div>
            <h2 id="model-registry-dialog-title" className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#1E3A8A]" />
              <span>Quản lý Provider &amp; Năng lực Model AI (Server Registry)</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Phân tách rạch ròi khả năng Tạo ảnh / Sửa ảnh / Phối cảnh / Phân tích brief · Cache{' '}
              {snapshot?.cacheTtlMinutes ?? 30} phút · Ngân sách probe:{' '}
              <strong>
                ${snapshot?.probeBudgetSpentUsd?.toFixed(2) ?? '0.00'} / $
                {snapshot?.probeBudgetMaxUsd?.toFixed(2) ?? '0.08'}
              </strong>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canAdminRefresh && (
              <button
                type="button"
                disabled={refreshing}
                onClick={handleRefreshRegistry}
                className="h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                <span>Làm mới danh mục Model</span>
              </button>
            )}
            <button
              type="button"
              autoFocus
              onClick={() => dialogRef.current?.close()}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200"
              aria-label="Đóng"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto flex-1 text-xs">
          {/* Connections summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {(snapshot?.connections || []).map((c) => (
              <div
                key={c.providerId}
                className={`rounded-xl border p-2.5 cursor-pointer transition ${
                  providerFilter === c.providerId
                    ? 'border-[#1E3A8A] bg-blue-50/50'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
                onClick={() =>
                  setProviderFilter((prev) => (prev === c.providerId ? 'all' : c.providerId))
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-900">{c.providerName}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                      c.listApiStatus === 'ok'
                        ? 'bg-emerald-50 text-emerald-700'
                        : c.listApiStatus === 'error'
                          ? 'bg-rose-50 text-rose-700'
                          : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {c.discoveredModelCount} model
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 truncate mt-1">
                  {c.connectionKind} · Key: {c.maskedCredential || 'Chưa cấu hình'}
                </div>
                <div className="text-[11px] text-slate-600 mt-1 line-clamp-2">{c.listApiDetail}</div>
              </div>
            ))}
          </div>

          {probeMessage && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{probeMessage}</span>
            </div>
          )}
          {probeError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-rose-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{probeError}</span>
            </div>
          )}

          {/* Model Capabilities Table */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <span id="model-registry-table-title" className="font-bold text-slate-800">
                Danh sách Model khả dụng ({filteredModels.length})
              </span>
              {providerFilter !== 'all' && (
                <button
                  type="button"
                  onClick={() => setProviderFilter('all')}
                  className="text-[#1E3A8A] font-semibold hover:underline"
                >
                  Hiện tất cả provider
                </button>
              )}
            </div>
            <div
              tabIndex={0}
              role="region"
              aria-labelledby="model-registry-table-title"
              className="overflow-auto max-h-[48vh]"
            >
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] uppercase text-slate-600 border-b border-slate-200">
                  <tr>
                    <th scope="col" className="py-2 px-3">Provider / Model</th>
                    <th scope="col" className="py-2 px-2">Tác vụ hỗ trợ &amp; Trạng thái kiểm chứng</th>
                    <th scope="col" className="py-2 px-3">Bằng chứng &amp; Ghi chú</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredModels.map((m) => (
                    <tr key={`${m.providerId}-${m.modelId}`} className="hover:bg-slate-50/70">
                      <th scope="row" className="py-2.5 px-3 align-top min-w-[200px] font-normal sticky left-0 bg-white">
                        <div className="font-bold text-slate-900">{m.modelId}</div>
                        <div className="text-[11px] text-slate-500">
                          {m.providerId} · {m.listedInCatalog ? 'Catalog API' : 'Manual/Local'}
                        </div>
                        {m.reportedAliasWarning && (
                          <div className="mt-1 text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 flex items-start gap-1">
                            <ShieldAlert className="w-3 h-3 shrink-0 mt-0.5" />
                            <span>{m.reportedAliasWarning}</span>
                          </div>
                        )}
                      </th>
                      <td className="py-2.5 px-2 align-top">
                        <div className="flex flex-wrap gap-1.5">
                          {TASK_KEYS.map((tk) => {
                            const st = m.taskStatuses?.[tk] || 'listed_unverified';
                            const badge = STATUS_BADGE[st] || STATUS_BADGE.listed_unverified;
                            const pKey = `${m.providerId}::${m.modelId}::${tk}`;
                            const isProbing = probingKey === pKey;
                            const canTryProbe = canProbe && st !== 'unsupported' && m.providerId !== 'local_sandbox';
                            return (
                              <div
                                key={tk}
                                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] ${badge.cls}`}
                              >
                                <span className="font-semibold">
                                  {(DESIGN_TASK_LABELS[tk]?.title || tk).replace(/^\d+\.\s*/, '')}:
                                </span>
                                <span>{badge.label}</span>
                                {canTryProbe && (
                                  <button
                                    type="button"
                                    disabled={Boolean(probingKey)}
                                    onClick={() => handleProbeTask(m.providerId, m.modelId, tk)}
                                    className="ml-1 px-1 py-0.5 rounded bg-white/80 hover:bg-white border border-current text-[10px] font-bold inline-flex items-center gap-0.5"
                                    title={`Chạy 1 request kiểm tra thực tế ${m.modelId} cho tác vụ ${tk}`}
                                  >
                                    <FlaskConical className={`w-2.5 h-2.5 ${isProbing ? 'animate-pulse' : ''}`} />
                                    <span>{isProbing ? '...' : 'Probe'}</span>
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 align-top text-[11px] text-slate-600 max-w-xs">
                        <div>
                          Bằng chứng: <strong>{m.capabilityEvidence}</strong>
                          {m.lastCheckedAt
                            ? ` · ${new Date(m.lastCheckedAt).toLocaleString('vi-VN')}`
                            : ''}
                        </div>
                        <div className="mt-0.5 text-slate-500">{m.statusDetail}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </dialog>
  );
}

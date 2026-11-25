'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Cpu,
  Database,
  FileSearch,
  Lock,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Zap,
} from 'lucide-react';
import { apiRequest } from '@/core/http/client';
import { useSession } from '@/core/session/SessionContext';

interface DiagnosticsPayload {
  checkedAt: string;
  dbPingMs: number;
  databaseProvider: string;
  cacheDiagnostics: {
    epoch: number;
    cachedEntryCount: number;
    inflightCount: number;
    sseSubscriberCount: number;
  };
  vault: {
    healthy: boolean;
    algorithm: string;
    hasExplicitMasterKey: boolean;
  };
  activeReceivingSalesCount: number;
  workers: Array<{ code: string; name: string; active: boolean }>;
  backupGovernance: {
    retentionKeepN: number;
    totalBackupsOnDisk: number;
    backups: Array<{
      backupId: string;
      fileName: string;
      fileSizeBytes: number;
      sha256: string;
      verifiedDiskHashMatch: boolean;
      businessFilesCount?: number;
      recordCounts: {
        leads: number;
        designRequests: number;
        seoArticles: number;
        users: number;
        auditLogs: number;
      };
      createdBy: string;
      createdAt: string;
    }>;
  };
}

interface AuditTrailItem {
  id: string;
  source: 'audit_log' | 'lead_activity';
  action: string;
  actionLabelVi: string;
  targetType: string;
  targetId: string | null;
  actorId: number | null;
  actorName: string;
  actorRole: string;
  ipAddress: string | null;
  createdAt: string;
  summary: string;
  diffs: Array<{ field: string; before: string; after: string }>;
}

export function EnterpriseGovernancePanel() {
  const { user } = useSession();
  const [diag, setDiag] = useState<DiagnosticsPayload | null>(null);
  const [audits, setAudits] = useState<AuditTrailItem[]>([]);
  const [actors, setActors] = useState<Array<{ id: number; fullName: string; roleName: string }>>(
    [],
  );
  const [actorFilter, setActorFilter] = useState<string>('0');
  const [searchText, setSearchText] = useState<string>('');
  const [keepLatestN, setKeepLatestN] = useState<number>(10);
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [sandboxNotice, setSandboxNotice] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ mode: 'audit' });
      if (Number(actorFilter) > 0) qs.set('actorId', actorFilter);
      if (searchText.trim()) qs.set('q', searchText.trim());

      const [diagRes, auditRes] = await Promise.all([
        apiRequest<DiagnosticsPayload>('/api/v1/admin/governance?mode=diagnostics', {
          skipCache: true,
        }),
        apiRequest<{
          items: AuditTrailItem[];
          actors: Array<{ id: number; fullName: string; roleName: string }>;
        }>(`/api/v1/admin/governance?${qs.toString()}`, { skipCache: true }),
      ]);
      setDiag(diagRes);
      setKeepLatestN(diagRes.backupGovernance.retentionKeepN || 10);
      setAudits(auditRes.items || []);
      setActors(auditRes.actors || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [actorFilter, searchText]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleSimulateWebhook = async (params: {
    website: 'toantrung.com.vn' | 'bangled.vn';
    productGroup: 'led_screen' | 'electronic_board';
    duplicateTest?: boolean;
  }) => {
    if (!user || simulating) return;
    setSimulating(true);
    setSandboxNotice(null);
    try {
      const res = await apiRequest<{
        website: string;
        phone: string;
        ingestResult: {
          leadId?: number;
          leadCode?: string;
          assignedSalesName?: string | null;
          deduplicated?: boolean;
        };
      }>('/api/v1/admin/governance', {
        method: 'POST',
        csrfToken: user.csrfToken,
        body: {
          action: 'simulate_webhook',
          ...params,
        },
      });
      const code = res.ingestResult?.leadCode || 'Lead mới';
      const sales = res.ingestResult?.assignedSalesName || 'Hàng đợi quản lý';
      setSandboxNotice(
        `✅ Đã bắn thành công Webhook mẫu từ ${res.website} (SĐT ${res.phone}) → Tạo mã ${code} · Phân công tự động cho: ${sales} · Đã đẩy thông báo SSE tức thì!`,
      );
      await loadAll();
    } catch (err) {
      setSandboxNotice(
        `❌ Lỗi giả lập Webhook: ${err instanceof Error ? err.message : 'Không xác định'}`,
      );
    } finally {
      setSimulating(false);
    }
  };

  const handlePruneBackups = async () => {
    if (!user || pruning) return;
    setPruning(true);
    try {
      const res = await apiRequest<{ prunedCount: number; keepLatest: number }>(
        '/api/v1/admin/governance',
        {
          method: 'POST',
          csrfToken: user.csrfToken,
          body: {
            action: 'prune_backups',
            keepLatestCount: keepLatestN,
          },
        },
      );
      setSandboxNotice(
        `Đã lưu chính sách giữ lại ${res.keepLatest} bản sao lưu mới nhất (đã dọn ${res.prunedCount} bản cũ).`,
      );
      await loadAll();
    } finally {
      setPruning(false);
    }
  };

  return (
    <div className="space-y-6 text-xs">
      {sandboxNotice && (
        <div className="p-3.5 rounded-xl bg-blue-50 border border-blue-200 text-[#0F275C] font-semibold flex items-center justify-between gap-2">
          <span>{sandboxNotice}</span>
          <div className="flex items-center gap-2 shrink-0">
            <Link href="/leads" className="underline font-bold">
              Mở bảng Lead kiểm tra →
            </Link>
            <button type="button" onClick={() => setSandboxNotice(null)} className="font-bold px-1">
              ×
            </button>
          </div>
        </div>
      )}

      {/* 1. Local Control & Diagnostics + Webhook Sandbox */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0F275C] text-white grid place-items-center">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display font-bold text-base text-slate-900">
                Trạm Chẩn Đoán Sức Khỏe &amp; Giả Lập Luồng Nghiệp Vụ Local
              </h2>
              <p className="text-slate-500">
                Đo tốc độ CSDL, trạng thái 5 tiến trình ngầm, khóa Vault AES-256-GCM và kiểm thử chia Lead 1-click
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadAll()}
            className="h-8 px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 font-semibold text-slate-700 inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Đo lại tức thì</span>
          </button>
        </div>

        {diag && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
                <span className="text-[11px] text-slate-500 inline-flex items-center gap-1">
                  <Database className="w-3.5 h-3.5 text-[#1E3A8A]" /> Tốc độ phản hồi DB
                </span>
                <div className="text-lg font-extrabold text-emerald-700 mt-0.5 tabular-nums">
                  {diag.dbPingMs} ms
                </div>
                <span className="text-[10.5px] text-slate-400 uppercase">
                  Engine: {diag.databaseProvider}
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
                <span className="text-[11px] text-slate-500 inline-flex items-center gap-1">
                  <Zap className="w-3.5 h-3.5 text-amber-500" /> Luồng Realtime SSE
                </span>
                <div className="text-lg font-extrabold text-[#0F275C] mt-0.5 tabular-nums">
                  {diag.cacheDiagnostics.sseSubscriberCount} kết nối mở
                </div>
                <span className="text-[10.5px] text-slate-400">
                  Cache epoch #{diag.cacheDiagnostics.epoch} ({diag.cacheDiagnostics.cachedEntryCount} mục)
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
                <span className="text-[11px] text-slate-500 inline-flex items-center gap-1">
                  <Lock className="w-3.5 h-3.5 text-emerald-600" /> Mã hóa Vault API Key
                </span>
                <div className="text-sm font-extrabold text-slate-900 mt-1">
                  {diag.vault.healthy ? '✅ Chuẩn AES-256-GCM' : '⚠️ Lỗi tự kiểm'}
                </div>
                <span className="text-[10.5px] text-slate-400">{diag.vault.algorithm}</span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
                <span className="text-[11px] text-slate-500 inline-flex items-center gap-1">
                  <Cpu className="w-3.5 h-3.5 text-indigo-600" /> Sales đang mở nhận Lead
                </span>
                <div className="text-lg font-extrabold text-slate-900 mt-0.5 tabular-nums">
                  {diag.activeReceivingSalesCount} NVKD
                </div>
                <span className="text-[10.5px] text-slate-400">Sẵn sàng nhận chia tự động</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {diag.workers.map((w) => (
                <span
                  key={w.code}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] font-semibold"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{w.name}</span>
                </span>
              ))}
            </div>
          </>
        )}

        {/* Webhook Sandbox */}
        <div className="p-4 rounded-xl bg-gradient-to-r from-slate-50 via-blue-50/40 to-indigo-50/40 border border-blue-200/80 space-y-2.5">
          <div className="font-bold text-slate-900">
            ⚡ Bộ Giả Lập Webhook &amp; Kiểm Thử Chia Lead Tự Động 1-Click (Local Sandbox)
          </div>
          <p className="text-slate-600">
            Bấm nút bên dưới để giả lập khách hàng vừa điền form trên website (kèm mã GCLID &amp; chiến dịch mẫu) nhằm kiểm chứng thuật toán chia Lead tự động, phát hiện trùng SĐT và thông báo nhảy tức thì (&lt; 50ms).
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              disabled={simulating}
              onClick={() =>
                void handleSimulateWebhook({
                  website: 'toantrung.com.vn',
                  productGroup: 'led_screen',
                })
              }
              className="h-9 px-3.5 rounded-xl bg-[#0F275C] hover:bg-[#1E3A8A] text-white font-bold inline-flex items-center gap-1.5 transition"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Bắn Lead mẫu toantrung.com.vn (Màn hình LED)</span>
            </button>
            <button
              type="button"
              disabled={simulating}
              onClick={() =>
                void handleSimulateWebhook({
                  website: 'bangled.vn',
                  productGroup: 'electronic_board',
                })
              }
              className="h-9 px-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold inline-flex items-center gap-1.5 transition"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Bắn Lead mẫu bangled.vn (Bảng điện tử)</span>
            </button>
            <button
              type="button"
              disabled={simulating}
              onClick={() =>
                void handleSimulateWebhook({
                  website: 'toantrung.com.vn',
                  productGroup: 'led_screen',
                  duplicateTest: true,
                })
              }
              className="h-9 px-3.5 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-950 font-bold inline-flex items-center gap-1.5 transition"
            >
              <span>🔁 Bắn lặp cùng SĐT (Kiểm thử Chống trùng UC01 1.5)</span>
            </button>
          </div>
        </div>
      </section>

      {/* 2. SHA-256 Backup Integrity & Keep-N Retention */}
      {diag && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
              <div>
                <h3 className="font-bold text-slate-900 text-sm">
                  Đối Kiểm Toàn Vẹn Bản Sao Lưu SHA-256 &amp; Cơ Chế Giữ Lại N Bản Gần Nhất
                </h3>
                <p className="text-slate-500 text-[11px]">
                  Hiện có {diag.backupGovernance.totalBackupsOnDisk} bản sao lưu trên ổ đĩa Local
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-1.5 text-slate-700 font-semibold">
                <span>Giữ lại tối đa:</span>
                <input
                  type="number"
                  min={2}
                  max={50}
                  value={keepLatestN}
                  onChange={(e) => setKeepLatestN(Number(e.target.value) || 10)}
                  className="w-16 h-8 px-2 rounded-lg border border-slate-200 font-bold text-center"
                />
                <span>bản mới nhất</span>
              </label>
              <button
                type="button"
                disabled={pruning}
                onClick={() => void handlePruneBackups()}
                className="h-8 px-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 font-bold text-slate-800 inline-flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5 text-slate-500" />
                <span>Áp dụng &amp; Dọn bản cũ</span>
              </button>
            </div>
          </div>

          {diag.backupGovernance.backups.length === 0 ? (
            <div className="py-6 text-center text-slate-400">
              Chưa có bản sao lưu nào trong thư mục dự phòng. Bạn có thể bấm &ldquo;Tạo bản sao lưu&rdquo; ở tab Lưu trữ &amp; Sao lưu.
            </div>
          ) : (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="py-2 px-3 font-bold">Mã Bản Sao Lưu</th>
                    <th className="py-2 px-3 font-bold">Số bản ghi bảo vệ</th>
                    <th className="py-2 px-3 font-bold">Tệp đính kèm</th>
                    <th className="py-2 px-3 font-bold">Đối kiểm SHA-256 trên đĩa</th>
                    <th className="py-2 px-3 font-bold text-right">Thời điểm</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {diag.backupGovernance.backups.slice(0, 8).map((b) => (
                    <tr key={b.backupId}>
                      <td className="py-2 px-3 font-mono font-bold text-[#0F275C]">{b.backupId}</td>
                      <td className="py-2 px-3 text-slate-700">
                        {b.recordCounts.leads} Lead · {b.recordCounts.designRequests} TK ·{' '}
                        {b.recordCounts.seoArticles} SEO · {b.recordCounts.users} User
                      </td>
                      <td className="py-2 px-3 font-semibold text-slate-700">
                        {b.businessFilesCount ?? 0} tệp
                      </td>
                      <td className="py-2 px-3">
                        {b.verifiedDiskHashMatch ? (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold text-[11px]">
                            ✓ Khớp SHA-256 ({b.sha256.slice(0, 10)}...)
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-700 font-bold text-[11px]">
                            Lệch mã băm
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-500 tabular-nums">
                        {new Date(b.createdAt).toLocaleString('vi-VN')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* 3. Immutable Audit Log Explorer (Old -> New Comparison) */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <FileSearch className="w-5 h-5 text-[#1E3A8A]" />
            <div>
              <h3 className="font-bold text-slate-900 text-sm">
                Trình Khám Phá Nhật Ký Kiểm Toán Bất Biến (Giá trị cũ → Giá trị mới)
              </h3>
              <p className="text-slate-500 text-[11px]">
                Tra cứu toàn diện lịch sử đăng nhập, xuất dữ liệu, gắn cờ Spam, chuyển giao Lead và cấu hình hệ thống
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={actorFilter}
              onChange={(e) => setActorFilter(e.target.value)}
              className="h-8 px-2.5 rounded-xl border border-slate-200 bg-white font-semibold text-slate-700"
            >
              <option value="0">Tất cả nhân sự thực hiện</option>
              {actors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.fullName} ({a.roleName})
                </option>
              ))}
            </select>

            <div className="relative w-56">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Tìm mã TT-..., hành động..."
                className="w-full h-8 pl-8 pr-2.5 rounded-xl border border-slate-200"
              />
            </div>
          </div>
        </div>

        <div className="border border-slate-200 rounded-xl overflow-hidden max-h-[520px] overflow-y-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-slate-100 text-slate-700 sticky top-0 z-10">
              <tr>
                <th className="py-2.5 px-3 font-bold">Thời gian</th>
                <th className="py-2.5 px-3 font-bold">Người thực hiện</th>
                <th className="py-2.5 px-3 font-bold">Hành động &amp; Đối tượng</th>
                <th className="py-2.5 px-3 font-bold">Đối chiếu Giá trị cũ → Giá trị mới</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {audits.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-slate-400">
                    Không có bản ghi kiểm toán nào khớp điều kiện lọc.
                  </td>
                </tr>
              ) : (
                audits.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/70 align-top">
                    <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap tabular-nums">
                      <div>{new Date(item.createdAt).toLocaleString('vi-VN')}</div>
                      {item.ipAddress && (
                        <div className="font-mono text-[10px] text-slate-400">IP: {item.ipAddress}</div>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-bold text-slate-900">{item.actorName}</div>
                      <div className="text-[10.5px] text-slate-500">{item.actorRole}</div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-bold text-[#0F275C]">{item.actionLabelVi}</div>
                      <div className="text-[11px] text-slate-600 mt-0.5">{item.summary}</div>
                    </td>
                    <td className="py-2.5 px-3">
                      {item.diffs.length === 0 ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <div className="space-y-1">
                          {item.diffs.map((d, idx) => (
                            <div
                              key={`${d.field}-${idx}`}
                              className="inline-flex flex-wrap items-center gap-1 bg-slate-50 border border-slate-200/80 rounded-md px-2 py-0.5 mr-1 text-[11px]"
                            >
                              <strong className="text-slate-700">{d.field}:</strong>
                              <span className="text-rose-700 line-through">{d.before}</span>
                              <ArrowRight className="w-3 h-3 text-slate-400" />
                              <span className="text-emerald-800 font-semibold">{d.after}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
export default EnterpriseGovernancePanel;

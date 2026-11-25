'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BarChart3,
  Calculator,
  Clock,
  Command,
  Columns2,
  Crosshair,
  FileSpreadsheet,
  FolderPlus,
  LayoutGrid,
  Megaphone,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { hasBaPermission, type BaPermissionKey, type SessionUserDto } from '@toantrung/contracts';
import { apiRequest } from '../../http/client';

interface SearchResultItem {
  id: string;
  group: 'leads' | 'campaigns' | 'seo' | 'design';
  title: string;
  subtitle: string;
  badge?: string;
  href: string;
}

interface QuickCommandDef {
  id: string;
  label: string;
  description: string;
  keywords: string;
  shortcut?: string;
  icon: React.ComponentType<{ className?: string }>;
  requiredPermission?: BaPermissionKey;
  adminOnly?: boolean;
  onExecute: () => void;
}

const GROUP_LABELS: Record<SearchResultItem['group'], string> = {
  leads: 'Hồ sơ Lead & Khách hàng',
  campaigns: 'Chiến dịch Quảng cáo (M02)',
  seo: 'Bài viết & Từ khóa SEO (M03)',
  design: 'Dự án Thiết kế Phối cảnh LED (M05)',
};

export function GlobalCommandPalette({
  open,
  onClose,
  user,
}: {
  open: boolean;
  onClose: () => void;
  user: SessionUserDto;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const navigateAndDispatch = useCallback(
    (href: string, customEventName?: string, detail?: Record<string, unknown>) => {
      onClose();
      router.push(href);
      if (customEventName && typeof window !== 'undefined') {
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent(customEventName, { detail: detail || {} }));
        }, 120);
      }
    },
    [onClose, router],
  );

  const quickCommands = useMemo<QuickCommandDef[]>(() => {
    const all: QuickCommandDef[] = [
      {
        id: 'cmd-create-lead',
        label: 'Tạo hồ sơ Lead mới',
        description: 'Mở nhanh biểu mẫu tiếp nhận Lead mới tại M01',
        keywords: 'tao lead moi khach hang nhap tay intake',
        shortcut: 'M01',
        icon: FolderPlus,
        requiredPermission: 'LEAD_CREATE',
        onExecute: () =>
          navigateAndDispatch('/leads?quickAction=create-lead', 'tt-command-action', {
            action: 'create-lead',
          }),
      },
      {
        id: 'cmd-split-view',
        label: 'Chế độ Duyệt Liên Hoàn 2 Cột (Split-View)',
        description: 'Duyệt nhanh danh sách Lead bên trái + Hồ sơ chi tiết cố định bên phải bằng phím ↑/↓',
        keywords: 'split view duyet nhanh 2 cot triage lead',
        shortcut: 'Split',
        icon: Columns2,
        requiredPermission: 'LEAD_VIEW_OWN',
        onExecute: () =>
          navigateAndDispatch('/leads?view=split', 'tt-command-action', {
            action: 'split-view',
          }),
      },
      {
        id: 'cmd-led-spec',
        label: 'Bảng tính Cabinet & Xuất Phiếu Kỹ thuật LED',
        description: 'Tính Pixel Pitch, số lượng Cabinet, độ phân giải & công suất điện kW chuẩn Toàn Trung',
        keywords: 'bang tinh cabinet led pixel pitch p2 p2.5 p3 p4 phieu ky thuat pdf',
        shortcut: 'LED Spec',
        icon: Calculator,
        requiredPermission: 'LEAD_VIEW_OWN',
        onExecute: () =>
          navigateAndDispatch('/leads?quickAction=led-spec', 'tt-command-action', {
            action: 'led-spec',
          }),
      },
      {
        id: 'cmd-overdue-leads',
        label: 'Lọc Lead quá hạn báo giá / Chưa tiếp nhận',
        description: 'Mở ngay danh sách các hồ sơ cần xử lý gấp trong ngày',
        keywords: 'lead qua han bao gia chua tiep nhan sla',
        shortcut: 'SLA',
        icon: Clock,
        requiredPermission: 'LEAD_VIEW_OWN',
        onExecute: () =>
          navigateAndDispatch('/leads?quickFilter=overdue', 'tt-command-action', {
            action: 'overdue-leads',
          }),
      },
      {
        id: 'cmd-export-reports',
        label: 'Xuất báo cáo Excel điều hành',
        description: 'Chuyển tới phân hệ Báo cáo M04 và tải báo cáo Excel chuẩn công thức',
        keywords: 'xuat bao cao excel m04 thong ke kpi',
        shortcut: 'Excel',
        icon: FileSpreadsheet,
        requiredPermission: 'DASHBOARD_VIEW',
        onExecute: () => navigateAndDispatch('/reports?quickAction=export'),
      },
      {
        id: 'cmd-open-design',
        label: 'Chuyển sang Studio Thiết kế Phối cảnh AI',
        description: 'Mở không gian dựng phối cảnh 3D màn hình LED & so sánh Trước/Sau',
        keywords: 'thiet ke ai studio phoi canh 3d banner m05',
        shortcut: 'M05',
        icon: Sparkles,
        requiredPermission: 'AI_DESIGN',
        onExecute: () => navigateAndDispatch('/design'),
      },
      {
        id: 'cmd-open-tracking',
        label: 'Mở Quản lý Chiến dịch & Kiểm toán Tracking',
        description: 'Theo dõi Google Ads, GA4, CPL và cảnh báo phễu thu thập M02',
        keywords: 'chien dich google ads tracking ga4 cpl m02',
        shortcut: 'M02',
        icon: Crosshair,
        requiredPermission: 'TRACKING_ADS_OPTIMIZE',
        onExecute: () => navigateAndDispatch('/tracking'),
      },
      {
        id: 'cmd-open-seo',
        label: 'Mở Từ khóa & Kiểm định Bài viết SEO ngành LED',
        description: 'Phân tích Search Console & chấm điểm kỹ thuật B2B bài viết M03',
        keywords: 'seo tu khoa bai viet search console m03',
        shortcut: 'M03',
        icon: Megaphone,
        requiredPermission: 'AI_MARKETING_SEO',
        onExecute: () => navigateAndDispatch('/ads'),
      },
      {
        id: 'cmd-open-dashboard',
        label: 'Về Trang Tổng Quan Điều Hành',
        description: 'Xem KPI thời gian thực, bàn giao Lead và cảnh báo phễu',
        keywords: 'tong quan dashboard trang chu',
        shortcut: 'Home',
        icon: LayoutGrid,
        requiredPermission: 'DASHBOARD_VIEW',
        onExecute: () => navigateAndDispatch('/dashboard'),
      },
      {
        id: 'cmd-admin-governance',
        label: 'Nhật ký Kiểm toán & Trạm Chẩn đoán Local (Admin)',
        description: 'Tra cứu Audit Log Trước → Sau, sức khỏe DB và giả lập Webhook 1-click',
        keywords: 'audit log nhat ky kiem toan chan doan webhook sandbox backup admin',
        shortcut: 'Admin',
        icon: ShieldCheck,
        adminOnly: true,
        requiredPermission: 'SYSTEM_USER_ADMIN',
        onExecute: () => navigateAndDispatch('/settings?tab=governance'),
      },
      {
        id: 'cmd-admin-users',
        label: 'Quản lý Nhân sự & Phân quyền 8 Vai trò',
        description: 'Mở danh sách tài khoản, trạng thái nhận Lead tự động và khóa phiên',
        keywords: 'nhan su tai khoan user phan quyen admin',
        shortcut: 'Users',
        icon: Users,
        adminOnly: true,
        requiredPermission: 'SYSTEM_USER_ADMIN',
        onExecute: () => navigateAndDispatch('/admin/users'),
      },
      {
        id: 'cmd-reports-hub',
        label: 'Mở Báo cáo Hiệu suất Liên phòng ban',
        description: 'Đối chiếu số liệu Kinh doanh – Marketing – Thiết kế minh bạch',
        keywords: 'bao cao hieu suat phong ban m04',
        shortcut: 'M04',
        icon: BarChart3,
        requiredPermission: 'DASHBOARD_VIEW',
        onExecute: () => navigateAndDispatch('/reports'),
      },
    ];

    return all.filter(
      (cmd) =>
        (!cmd.adminOnly || user.roleCode === 'ADMIN') &&
        (!cmd.requiredPermission || hasBaPermission(user.roleCode, cmd.requiredPermission)),
    );
  }, [user.roleCode, navigateAndDispatch]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setActiveIndex(0);
      return;
    }
    const t = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(t);
  }, [open]);

  const isCommandOnlyMode = query.trim().startsWith('>');
  const normalizedCommandFilter = isCommandOnlyMode
    ? query.trim().slice(1).trim().toLowerCase()
    : query.trim().toLowerCase();

  const filteredCommands = useMemo(() => {
    if (!normalizedCommandFilter) return quickCommands.slice(0, 7);
    return quickCommands.filter((c) => {
      const hay = `${c.label} ${c.description} ${c.keywords}`.toLowerCase();
      return hay.includes(normalizedCommandFilter);
    });
  }, [quickCommands, normalizedCommandFilter]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!trimmed || isCommandOnlyMode) {
      setResults([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await apiRequest<{ items: SearchResultItem[] }>(
          `/api/v1/system/command-search?q=${encodeURIComponent(trimmed)}`,
          { skipCache: true },
        );
        if (!cancelled) {
          setResults(res.items || []);
        }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, isCommandOnlyMode]);

  const flatSelectable = useMemo(() => {
    const entries: Array<
      | { kind: 'command'; cmd: QuickCommandDef }
      | { kind: 'result'; item: SearchResultItem }
    > = [];
    for (const cmd of filteredCommands) {
      entries.push({ kind: 'command', cmd });
    }
    if (!isCommandOnlyMode) {
      for (const item of results) {
        entries.push({ kind: 'result', item });
      }
    }
    return entries;
  }, [filteredCommands, results, isCommandOnlyMode]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, results.length, filteredCommands.length]);

  if (!open) return null;

  const executeEntryAt = (idx: number) => {
    const target = flatSelectable[idx];
    if (!target) return;
    if (target.kind === 'command') {
      target.cmd.onExecute();
    } else {
      navigateAndDispatch(target.item.href);
    }
  };

  let runningIdx = -1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Thanh lệnh và tìm kiếm toàn cục"
      className="fixed inset-0 z-[80] bg-slate-950/45 backdrop-blur-xs flex items-start justify-center pt-[10vh] px-3 sm:px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-white border border-slate-200/95 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex((prev) =>
              flatSelectable.length > 0 ? (prev + 1) % flatSelectable.length : 0,
            );
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((prev) =>
              flatSelectable.length > 0
                ? (prev - 1 + flatSelectable.length) % flatSelectable.length
                : 0,
            );
          } else if (e.key === 'Enter') {
            e.preventDefault();
            executeEntryAt(activeIndex);
          }
        }}
      >
        {/* Input bar */}
        <div className="px-4 py-3.5 border-b border-slate-200/80 flex items-center gap-3 bg-white">
          <div className="w-8 h-8 rounded-xl bg-blue-50 text-[#1E3A8A] grid place-items-center shrink-0">
            {isCommandOnlyMode ? (
              <Command className="w-4 h-4" />
            ) : (
              <Search className="w-4 h-4" />
            )}
          </div>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Tìm mã TT-..., công ty, SĐT, chiến dịch hoặc gõ ">" để gọi lệnh nhanh...'
            className="flex-1 bg-transparent text-sm font-medium text-slate-900 placeholder:text-slate-400 outline-none"
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-600"
            >
              Xóa
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng bảng lệnh"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results & Commands */}
        <div className="max-h-[62vh] overflow-y-auto p-2 space-y-2">
          {filteredCommands.length > 0 && (
            <div>
              <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
                <span>Lệnh thao tác nhanh ({filteredCommands.length})</span>
                <span className="font-normal normal-case text-slate-400">
                  Gõ <kbd className="px-1 py-0.5 bg-slate-100 rounded text-[10px]">&gt;</kbd> để chỉ lọc lệnh
                </span>
              </div>
              <div className="space-y-0.5">
                {filteredCommands.map((cmd) => {
                  runningIdx += 1;
                  const itemIdx = runningIdx;
                  const active = itemIdx === activeIndex;
                  const Icon = cmd.icon;
                  return (
                    <button
                      key={cmd.id}
                      type="button"
                      onMouseEnter={() => setActiveIndex(itemIdx)}
                      onClick={() => cmd.onExecute()}
                      className={`w-full px-3 py-2.5 rounded-xl flex items-center justify-between gap-3 text-left transition ${
                        active ? 'bg-blue-50/95 text-[#0F275C]' : 'hover:bg-slate-50 text-slate-800'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className={`w-8 h-8 rounded-lg grid place-items-center shrink-0 ${
                            active
                              ? 'bg-[#1E3A8A] text-white'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                        </span>
                        <div className="min-w-0">
                          <div className="text-xs sm:text-[13px] font-bold truncate">
                            {cmd.label}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">
                            {cmd.description}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {cmd.shortcut && (
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-bold">
                            {cmd.shortcut}
                          </span>
                        )}
                        <ArrowRight
                          className={`w-3.5 h-3.5 ${
                            active ? 'text-[#1E3A8A]' : 'text-slate-300'
                          }`}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {!isCommandOnlyMode && query.trim().length > 0 && (
            <div className="pt-1 border-t border-slate-100">
              {loading ? (
                <div className="px-3 py-4 text-xs text-slate-400 text-center">
                  Đang tra cứu dữ liệu theo phân quyền {user.roleName}...
                </div>
              ) : results.length === 0 ? (
                <div className="px-3 py-5 text-xs text-slate-400 text-center">
                  Không tìm thấy kết quả dữ liệu khớp với &ldquo;{query.trim()}&rdquo; trong phạm vi quyền của bạn.
                </div>
              ) : (
                (['leads', 'campaigns', 'seo', 'design'] as const).map((grp) => {
                  const grpItems = results.filter((r) => r.group === grp);
                  if (grpItems.length === 0) return null;
                  return (
                    <div key={grp} className="mb-2">
                      <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        {GROUP_LABELS[grp]} ({grpItems.length})
                      </div>
                      <div className="space-y-0.5">
                        {grpItems.map((item) => {
                          runningIdx += 1;
                          const itemIdx = runningIdx;
                          const active = itemIdx === activeIndex;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onMouseEnter={() => setActiveIndex(itemIdx)}
                              onClick={() => navigateAndDispatch(item.href)}
                              className={`w-full px-3 py-2.5 rounded-xl flex items-center justify-between gap-3 text-left transition ${
                                active
                                  ? 'bg-blue-50/95 text-[#0F275C]'
                                  : 'hover:bg-slate-50 text-slate-800'
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="text-xs sm:text-[13px] font-bold truncate">
                                  {item.title}
                                </div>
                                <div className="text-[11px] text-slate-500 truncate">
                                  {item.subtitle}
                                </div>
                              </div>
                              {item.badge && (
                                <span className="px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-700 text-[10px] font-semibold shrink-0">
                                  {item.badge}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Footer hints */}
        <div className="px-4 py-2 bg-slate-50 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-white border border-slate-200 font-mono text-[10px]">
                ↑↓
              </kbd>{' '}
              Di chuyển
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-white border border-slate-200 font-mono text-[10px]">
                Enter
              </kbd>{' '}
              Thực thi
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-white border border-slate-200 font-mono text-[10px]">
                Esc
              </kbd>{' '}
              Đóng
            </span>
          </div>
          <span className="text-[10.5px] text-slate-400">
            Bảo mật ma trận BA · Vai trò: <strong className="text-slate-600">{user.roleName}</strong>
          </span>
        </div>
      </div>
    </div>
  );
}
export default GlobalCommandPalette;

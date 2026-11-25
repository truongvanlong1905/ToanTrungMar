'use client';

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  UI_VOCABULARY,
  formatSafePeriodComparison,
  hasBaPermission,
  type DashboardDatePreset,
  type ReportsDashboardDto,
} from '@toantrung/contracts';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowRightLeft,
  ArrowUpRight,
  BarChart3,
  BellRing,
  CalendarClock,
  CheckCircle2,
  Clock,
  FolderOpen,
  Globe,
  Megaphone,
  PieChart,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react';
import { useSession } from '@/core/session/SessionContext';
import { apiRequest, peekApiCacheEntry } from '@/core/http/client';
import { publishDataSync, subscribeDataSync } from '@/core/http/data-sync-bus';
import { loadRouteState, saveRouteState } from '@/core/http/route-state';
import { useDashboardScope } from '@/core/dashboard/useDashboardScope';
import { GoogleAdsDateRangePicker } from '@/components/common/GoogleAdsDateRangePicker';
import { AnimatedMetricNumber } from '@/components/common/AnimatedMetricNumber';
import { formatWaitingDuration, getInitials } from '@/core/layout/WorkspaceShell';
import { formatCompactLeadCode } from '@/modules/01-leads/leads-helpers';
import {
  FunnelAnomalyGuardStrip,
  KpiAuditLineageDrawer,
  type LineageMetricType,
} from '@/core/components/common/KpiAuditLineageDrawer';

interface PersonalHandoverItem {
  leadId: number;
  leadCode: string;
  version: number;
  customerLabel: string;
  projectName: string | null;
  phone: string;
  pipelineStatus: string;
  fromSalesName: string | null;
  toSalesName: string | null;
  transferReason: string | null;
  transferredAt: string;
  waitingMinutes: number;
  slaLevel: 'normal' | 'warning' | 'overdue';
  nudgedRecently: boolean;
}

interface PersonalPriorityLead {
  leadId: number;
  leadCode: string;
  customerLabel: string;
  projectName: string | null;
  scheduledDate: string | null;
  waitingDays: number;
  pipelineStatus: string;
}

interface PersonalDesignItem {
  id: number;
  projectName: string;
  designStatus: string;
  requestType: string;
  leadCode: string | null;
  updatedAt: string;
}

interface RecentTeamActivity {
  id: number;
  leadId: number;
  leadCode: string;
  customerLabel: string;
  actionType: string;
  actorName: string;
  summary: string;
  createdAt: string;
}

interface PersonalDashboardPayload {
  generatedAt: string;
  vnDateToday: string;
  roleCode: string;
  isAnonymized: boolean;
  canManageLeads: boolean;
  canViewAllLeads: boolean;
  incomingHandovers: PersonalHandoverItem[];
  outgoingHandovers: PersonalHandoverItem[];
  overdueTeamHandovers: PersonalHandoverItem[];
  todayCallbacks: PersonalPriorityLead[];
  overdueQuotes7d: PersonalPriorityLead[];
  overdueQuotesTotal: number;
  myDesignItems: PersonalDesignItem[];
  designCompletedRecentCount: number;
  designPendingCount: number;
  todayStats: {
    newLeadsToday: number;
    pendingIncomingCount: number;
    pendingOutgoingCount: number;
    overdueQuotesCount: number;
    designPendingCount: number;
  };
  recentActivities: RecentTeamActivity[];
}

const DONUT_COLORS = ['#1E3A8A', '#0EA5E9', '#10B981', '#F59E0B', '#8B5CF6', '#94A3B8'];

function buildDashboardApiPath(scope: {
  preset: string;
  from: string;
  to: string;
}): string {
  const qs = new URLSearchParams({
    websiteId: 'all',
    preset: scope.preset || '7D',
    compact: '1',
  });
  if (scope.preset === 'CUSTOM' && scope.from && scope.to) {
    qs.set('from', scope.from);
    qs.set('to', scope.to);
  }
  return `/api/v1/dashboard/overview?${qs.toString()}`;
}

function getSlaAccentBar(level: 'normal' | 'warning' | 'overdue') {
  if (level === 'overdue') return 'bg-rose-500';
  if (level === 'warning') return 'bg-amber-500';
  return 'bg-blue-500';
}

function getSlaTextTone(level: 'normal' | 'warning' | 'overdue') {
  if (level === 'overdue') return 'text-rose-700 bg-rose-50';
  if (level === 'warning') return 'text-amber-800 bg-amber-50';
  return 'text-[#1E3A8A] bg-blue-50/80';
}

function getActivityDotColor(actionType: string) {
  if (actionType === 'status_change' || actionType === 'confirm_receive') return 'bg-emerald-500';
  if (actionType === 'reassign_sales') return 'bg-blue-500';
  if (actionType === 'quote_version') return 'bg-amber-500';
  if (actionType === 'design_completed') return 'bg-violet-500';
  return 'bg-slate-400';
}

function mapToDashboardPreset(nextPreset: string): DashboardDatePreset {
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
}

export default function DashboardPage() {
  const { user } = useSession();
  const [auditLineageMetric, setAuditLineageMetric] = useState<LineageMetricType | null>(null);
  const { scope, hydrated, updateScope } = useDashboardScope({ includeWebsiteInUrl: false });
  const apiPath = useMemo(() => buildDashboardApiPath(scope), [scope]);

  const [reportState, setReportState] = useState<{
    path: string;
    data: ReportsDashboardDto;
  } | null>(() => {
    const cached = peekApiCacheEntry<ReportsDashboardDto>(apiPath);
    return cached ? { path: apiPath, data: cached.data } : null;
  });
  const report = reportState && reportState.path === apiPath ? reportState.data : null;

  const [personal, setPersonal] = useState<PersonalDashboardPayload | null>(() => {
    const cached = peekApiCacheEntry<PersonalDashboardPayload>('/api/v1/dashboard/personal');
    return cached ? cached.data : null;
  });
  const [personalLoading, setPersonalLoading] = useState<boolean>(
    () => !peekApiCacheEntry<PersonalDashboardPayload>('/api/v1/dashboard/personal'),
  );
  const [handoverTab, setHandoverTab] = useState<'incoming' | 'outgoing'>('incoming');
  const [handoverFeedback, setHandoverFeedback] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [nudgingId, setNudgingId] = useState<number | null>(null);
  const [rightCardTab, setRightCardTab] = useState<'activity' | 'team'>('activity');
  const [hoveredDayIdx, setHoveredDayIdx] = useState<number | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(
    () => !peekApiCacheEntry<ReportsDashboardDto>(apiPath),
  );
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const reqSeqRef = useRef<number>(0);
  const activePathRef = useRef<string>(apiPath);
  activePathRef.current = apiPath;

  useEffect(() => {
    const entry = peekApiCacheEntry<ReportsDashboardDto>(apiPath);
    if (entry) {
      setReportState({ path: apiPath, data: entry.data });
      setIsLoading(false);
    } else {
      setReportState(null);
      setIsLoading(true);
    }
  }, [apiPath]);

  const fetchPersonal = useCallback(async (opts?: { skipCache?: boolean }) => {
    try {
      const res = await apiRequest<PersonalDashboardPayload>('/api/v1/dashboard/personal', {
        skipCache: Boolean(opts?.skipCache),
      });
      setPersonal(res);
    } catch {
      // keep existing personal view
    } finally {
      setPersonalLoading(false);
    }
  }, []);

  const fetchDashboard = useCallback(
    async (opts?: { manual?: boolean; silent?: boolean; signal?: AbortSignal }) => {
      const requestPath = apiPath;
      const seq = ++reqSeqRef.current;
      if (opts?.manual) setIsRefreshing(true);
      if (!opts?.silent) setFetchError(null);
      try {
        const res = await apiRequest<ReportsDashboardDto>(requestPath, {
          signal: opts?.signal,
          skipCache: Boolean(opts?.manual || opts?.silent),
          onRevalidated: (fresh) => {
            if (activePathRef.current !== requestPath) return;
            setReportState({ path: requestPath, data: fresh });
          },
        });
        if (opts?.signal?.aborted || seq !== reqSeqRef.current || activePathRef.current !== requestPath) {
          return;
        }
        setReportState({ path: requestPath, data: res });
      } catch (err) {
        if (opts?.signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
          return;
        }
        if (seq === reqSeqRef.current && !opts?.silent) {
          setFetchError(
            err instanceof Error ? err.message : UI_VOCABULARY.fallbacks.loadError,
          );
        }
      } finally {
        if (!opts?.signal?.aborted && seq === reqSeqRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [apiPath],
  );

  useEffect(() => {
    if (!hydrated || !user) return;
    if (scope.preset === 'CUSTOM' && (!scope.from || !scope.to)) return;

    const controller = new AbortController();
    const cached = peekApiCacheEntry<ReportsDashboardDto>(apiPath);
    if (!cached || !cached.isFresh) {
      void fetchDashboard({ silent: Boolean(cached), signal: controller.signal });
    }
    void fetchPersonal({ skipCache: true });

    let syncDebounceTimer: number | null = null;
    const unsubscribe = subscribeDataSync(
      ['reports', 'leads', 'tracking', 'ads', 'design', 'websites', 'notifications'],
      (ev) => {
        const needsPersonal = ev.domains.some(
          (d) => d === 'leads' || d === 'notifications' || d === 'design',
        );
        if (syncDebounceTimer !== null) window.clearTimeout(syncDebounceTimer);
        syncDebounceTimer = window.setTimeout(
          () => {
            syncDebounceTimer = null;
            void fetchDashboard({ silent: true });
            if (needsPersonal) {
              void fetchPersonal({ skipCache: true });
            }
          },
          needsPersonal ? 120 : 900,
        );
      },
    );

    return () => {
      controller.abort();
      if (syncDebounceTimer !== null) window.clearTimeout(syncDebounceTimer);
      unsubscribe();
    };
  }, [hydrated, user, apiPath, scope.preset, scope.from, scope.to, fetchDashboard, fetchPersonal]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const scroller = document.getElementById('main-workspace-content');
    if (!scroller) return;
    const saved = loadRouteState<{ scrollTop?: number }>('dashboard');
    if (saved?.scrollTop && saved.scrollTop > 0) {
      requestAnimationFrame(() => {
        scroller.scrollTop = saved.scrollTop ?? 0;
      });
    }
    return () => {
      saveRouteState('dashboard', { scrollTop: scroller.scrollTop });
    };
  }, []);

  useEffect(() => {
    const handleGlobalSearch = (ev: Event) => {
      const detail = (ev as CustomEvent<string>).detail;
      setSearchTerm(typeof detail === 'string' ? detail.trim().toLowerCase() : '');
    };
    window.addEventListener('tt-global-search', handleGlobalSearch as EventListener);
    return () =>
      window.removeEventListener('tt-global-search', handleGlobalSearch as EventListener);
  }, []);

  const handleConfirmReceive = async (item: PersonalHandoverItem) => {
    if (!user || confirmingId !== null) return;
    setConfirmingId(item.leadId);
    setHandoverFeedback(null);
    try {
      await apiRequest(`/api/v1/leads/${item.leadId}`, {
        method: 'PATCH',
        csrfToken: user.csrfToken,
        body: {
          action: 'confirm_receive',
          expectedVersion: item.version,
        },
      });
      setHandoverFeedback(
        `Đã xác nhận tiếp nhận ${formatCompactLeadCode(item.leadCode)} · ${item.customerLabel}.`,
      );
      setPersonal((prev) =>
        prev
          ? {
              ...prev,
              incomingHandovers: prev.incomingHandovers.filter((x) => x.leadId !== item.leadId),
              todayStats: {
                ...prev.todayStats,
                pendingIncomingCount: Math.max(0, (prev.todayStats?.pendingIncomingCount ?? 1) - 1),
              },
            }
          : prev,
      );
      publishDataSync(['leads', 'reports', 'notifications'], 'mutation:confirm_receive');
    } catch (err) {
      setHandoverFeedback(
        err instanceof Error ? err.message : 'Không thể xác nhận tiếp nhận hồ sơ lúc này.',
      );
    } finally {
      setConfirmingId(null);
    }
  };

  const handleNudgeOutgoing = async (item: PersonalHandoverItem) => {
    if (!user || nudgingId !== null) return;
    setNudgingId(item.leadId);
    setHandoverFeedback(null);
    try {
      await apiRequest(`/api/v1/leads/${item.leadId}`, {
        method: 'PATCH',
        csrfToken: user.csrfToken,
        body: {
          action: 'send_reminder_nudge',
          reminderLabel: 'Nhắc tiếp nhận Lead chuyển giao',
          message: `Nhờ ${item.toSalesName || 'bạn'} xác nhận tiếp nhận sớm hồ sơ ${formatCompactLeadCode(item.leadCode)} (${item.customerLabel}).`,
        },
      });
      setHandoverFeedback(
        `Đã gửi nhắc nhẹ tới ${item.toSalesName || 'NVKD nhận'} (${formatCompactLeadCode(item.leadCode)}).`,
      );
      setPersonal((prev) =>
        prev
          ? {
              ...prev,
              outgoingHandovers: prev.outgoingHandovers.map((x) =>
                x.leadId === item.leadId ? { ...x, nudgedRecently: true } : x,
              ),
            }
          : prev,
      );
      publishDataSync(['notifications'], 'mutation:send_reminder_nudge');
    } catch (err) {
      setHandoverFeedback(
        err instanceof Error ? err.message : 'Không thể gửi nhắc nhẹ lúc này.',
      );
    } finally {
      setNudgingId(null);
    }
  };

  const scopeQueryForLinks = useMemo(() => {
    const qs = new URLSearchParams();
    qs.set('preset', scope.preset);
    if (scope.preset === 'CUSTOM' && scope.from && scope.to) {
      qs.set('from', scope.from);
      qs.set('to', scope.to);
    }
    return qs.toString();
  }, [scope.preset, scope.from, scope.to]);

  const periodComp = useMemo(() => {
    if (!report || !report.previousOverview) return null;
    return formatSafePeriodComparison(
      report.overview.totalLeadsL1,
      report.previousOverview.totalLeadsL1,
    );
  }, [report]);

  const websiteRows = useMemo(() => {
    const list = report?.websiteSummaries || [];
    if (!searchTerm) return list;
    return list.filter(
      (w) =>
        w.shortName.toLowerCase().includes(searchTerm) ||
        w.domain.toLowerCase().includes(searchTerm),
    );
  }, [report?.websiteSummaries, searchTerm]);

  const salesRows = useMemo(() => {
    const list = report?.salesPerformance || [];
    if (!searchTerm) return list;
    return list.filter((s) => s.salesFullName.toLowerCase().includes(searchTerm));
  }, [report?.salesPerformance, searchTerm]);

  const totalSystemPageViews = useMemo(() => {
    const rows = report?.websiteSummaries || [];
    let hasAny = false;
    let sum = 0;
    for (const r of rows) {
      if (r.pageViews !== null) {
        hasAny = true;
        sum += r.pageViews;
      }
    }
    return hasAny ? sum : null;
  }, [report?.websiteSummaries]);

  const totalSystemGscClicks = useMemo(() => {
    const rows = report?.websiteSummaries || [];
    let hasAny = false;
    let sum = 0;
    for (const r of rows) {
      if (r.gscClicks !== null) {
        hasAny = true;
        sum += r.gscClicks;
      }
    }
    return hasAny ? sum : null;
  }, [report?.websiteSummaries]);

  // Biểu đồ vùng (Interactive Area Chart)
  const chartPoints = report?.leadTrend || [];
  const areaChart = useMemo(() => {
    if (chartPoints.length === 0) return null;
    const W = 560;
    const H = 164;
    const padL = 28;
    const padR = 16;
    const padT = 22;
    const padB = 26;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const maxV = Math.max(4, ...chartPoints.map((p) => p.totalL1));
    const gridTicks = [0, Math.round(maxV / 2), maxV];

    const pts = chartPoints.map((p, i) => {
      const x =
        chartPoints.length === 1
          ? padL + innerW / 2
          : padL + (i / (chartPoints.length - 1)) * innerW;
      const y = padT + innerH - (p.totalL1 / maxV) * innerH;
      return { ...p, x, y, index: i };
    });

    const linePath = pts
      .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
      .join(' ');
    const areaPath = `${linePath} L ${pts[pts.length - 1].x.toFixed(1)} ${(padT + innerH).toFixed(1)} L ${pts[0].x.toFixed(1)} ${(padT + innerH).toFixed(1)} Z`;

    return { W, H, padL, padR, padT, padB, innerH, maxV, gridTicks, pts, linePath, areaPath };
  }, [chartPoints]);

  // Biểu đồ vòng Donut tỷ trọng nguồn Lead (byChannel)
  const channelDonut = useMemo(() => {
    const raw = (report?.byChannel || []).filter((c) => c.count > 0);
    const total = raw.reduce((s, c) => s + c.count, 0);
    if (total === 0) return { total: 0, slices: [] as Array<{ label: string; count: number; pct: number; color: string; dashArray: string; dashOffset: number }> };
    const top = raw.slice(0, 5);
    const restCount = raw.slice(5).reduce((s, c) => s + c.count, 0);
    const merged = restCount > 0 ? [...top, { channel: 'other', label: 'Kênh khác', count: restCount }] : top;
    const r = 44;
    const circ = 2 * Math.PI * r;
    let offset = 0;
    const slices = merged.map((c, idx) => {
      const frac = c.count / total;
      const len = frac * circ;
      const slice = {
        label: c.label,
        count: c.count,
        pct: Math.round(frac * 100),
        color: DONUT_COLORS[idx % DONUT_COLORS.length],
        dashArray: `${Math.max(2, len - 1.5)} ${circ}`,
        dashOffset: -offset,
      };
      offset += len;
      return slice;
    });
    return { total, slices };
  }, [report?.byChannel]);

  const funnelStages = useMemo(() => {
    const ov = report?.overview;
    if (!ov) return [];
    const total = Math.max(1, ov.totalLeadsL1);
    const newCount = Math.max(
      0,
      ov.validLeadsL2 - ov.quotingCount - ov.quoteSentCount - ov.wonCount - ov.lostCount,
    );
    return [
      { key: 'new_lead', label: 'Vừa nhận', count: newCount, pct: Math.round((newCount / total) * 100), color: 'bg-violet-500', dot: 'bg-violet-500' },
      { key: 'quoting', label: 'Đang báo giá', count: ov.quotingCount, pct: Math.round((ov.quotingCount / total) * 100), color: 'bg-blue-500', dot: 'bg-blue-500' },
      { key: 'quote_sent', label: 'Đã gửi BG', count: ov.quoteSentCount, pct: Math.round((ov.quoteSentCount / total) * 100), color: 'bg-amber-500', dot: 'bg-amber-500' },
      { key: 'won', label: 'Chốt đơn', count: ov.wonCount, pct: Math.round((ov.wonCount / total) * 100), color: 'bg-emerald-500', dot: 'bg-emerald-500' },
      { key: 'lost', label: 'Thất bại', count: ov.lostCount, pct: Math.round((ov.lostCount / total) * 100), color: 'bg-slate-300', dot: 'bg-slate-400' },
    ];
  }, [report?.overview]);

  const dq = report?.dataQualitySummary;
  const pulseGradId = useId();
  const canViewLeads = user ? hasBaPermission(user.roleCode, 'LEAD_VIEW_OWN') : false;
  const canCreateLead = user ? hasBaPermission(user.roleCode, 'LEAD_CREATE') : false;
  const canViewSeo = user
    ? hasBaPermission(user.roleCode, 'AI_MARKETING_SEO') ||
      hasBaPermission(user.roleCode, 'TRACKING_ADS_OPTIMIZE')
    : false;
  const canViewTracking = user
    ? hasBaPermission(user.roleCode, 'TRACKING_ADS_OPTIMIZE') || user.roleCode === 'BOD'
    : false;
  const canViewDesign = user ? hasBaPermission(user.roleCode, 'AI_DESIGN') : false;
  const canViewSettings = user ? hasBaPermission(user.roleCode, 'SYSTEM_USER_ADMIN') : false;

  const greetingLabel = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Chào buổi sáng';
    if (h < 18) return 'Chào buổi chiều';
    return 'Chào buổi tối';
  }, []);

  const todayFormattedVi = useMemo(() => {
    try {
      return new Intl.DateTimeFormat('vi-VN', {
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(new Date());
    } catch {
      return personal?.vnDateToday || '';
    }
  }, [personal?.vnDateToday]);

  const incomingHandovers = personal?.incomingHandovers || [];
  const outgoingHandovers = personal?.outgoingHandovers || [];
  const overdueTeamHandovers = personal?.overdueTeamHandovers || [];
  const activeHandoverList = handoverTab === 'incoming' ? incomingHandovers : outgoingHandovers;

  const hoveredPoint =
    areaChart && hoveredDayIdx !== null && areaChart.pts[hoveredDayIdx]
      ? areaChart.pts[hoveredDayIdx]
      : null;

  const maxSalesLeads = Math.max(1, ...salesRows.map((s) => s.totalLeads));

  return (
    <div className="max-w-[1600px] mx-auto space-y-5">
      {/* ===================================================================== */}
      {/* TẦNG 1: EXECUTIVE HERO STRIP (Sạch, sang trọng, không hộp lồng hộp)   */}
      {/* ===================================================================== */}
      <section className="relative overflow-hidden rounded-2xl bg-white border border-slate-200/75 px-5 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.03)]">
        {/* Ánh sáng thương hiệu xanh dịu ở góc trên phải */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-20 -right-20 w-72 h-72 rounded-full bg-gradient-to-br from-blue-100/60 via-sky-50/40 to-transparent blur-2xl"
        />

        <div className="relative flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-display text-lg sm:text-xl font-extrabold tracking-tight text-slate-900">
                {greetingLabel}, {user?.fullName || 'Thành viên'}
              </h1>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-100/90 text-slate-600 text-[11px] font-semibold">
                <span className={`w-1.5 h-1.5 rounded-full ${fetchError ? 'bg-rose-500' : isRefreshing ? 'bg-blue-500 animate-pulse' : 'bg-emerald-500'}`} />
                <span>{user?.roleName}</span>
              </span>
            </div>
            <p className="text-xs text-slate-500 flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <span className="capitalize">{todayFormattedVi}</span>
              <span className="text-slate-300">•</span>
              <span>
                Lead mới hôm nay:{' '}
                <strong className="text-slate-800 tabular-nums">
                  {personal?.todayStats?.newLeadsToday ?? 0}
                </strong>
              </span>
              {report?.lastSyncedAt && (
                <>
                  <span className="text-slate-300">•</span>
                  <span>
                    Đồng bộ lúc{' '}
                    {new Date(report.lastSyncedAt).toLocaleTimeString('vi-VN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </>
              )}
            </p>
          </div>

          {/* Bộ chọn kỳ ngày + 3 nút hành động sắc nét */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <GoogleAdsDateRangePicker
              preset={scope.preset}
              from={scope.from}
              to={scope.to}
              allowAll={false}
              align="right"
              size="sm"
              showStepButtons={true}
              onApply={(next) => {
                updateScope({
                  preset: mapToDashboardPreset(next.preset),
                  from: next.from,
                  to: next.to,
                });
              }}
            />

            <span className="hidden sm:block h-5 w-px bg-slate-200/80 mx-0.5" aria-hidden="true" />

            {canCreateLead && (
              <Link
                href="/leads?create=1"
                className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-xl bg-[#0F275C] hover:bg-[#1E3A8A] text-white text-xs font-semibold shadow-xs transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Tạo Lead</span>
              </Link>
            )}
            {canViewDesign && (
              <Link
                href="/design"
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-xl bg-slate-100/80 hover:bg-violet-50 text-slate-700 hover:text-violet-800 text-xs font-semibold transition"
              >
                <Sparkles className="w-3.5 h-3.5 text-violet-600" />
                <span>Brief AI</span>
              </Link>
            )}
            <Link
              href={`/reports?tab=shared_files&${scopeQueryForLinks}`}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-xl bg-slate-100/80 hover:bg-blue-50 text-slate-700 hover:text-[#1E3A8A] text-xs font-semibold transition"
            >
              <FolderOpen className="w-3.5 h-3.5 text-[#1E3A8A]" />
              <span className="hidden sm:inline">Kho dữ liệu</span>
            </Link>
            <button
              type="button"
              onClick={() => {
                void fetchDashboard({ manual: true });
                void fetchPersonal({ skipCache: true });
              }}
              disabled={isRefreshing}
              aria-label="Làm mới dữ liệu"
              title="Làm mới dữ liệu"
              className="w-8 h-8 rounded-xl bg-slate-100/80 hover:bg-slate-200/70 text-slate-600 grid place-items-center transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-[#1E3A8A]' : ''}`} />
            </button>
          </div>
        </div>
      </section>

      {fetchError && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50/90 px-4 py-2.5 text-xs text-rose-800 flex items-center justify-between gap-3"
        >
          <span>{fetchError}</span>
          <button
            type="button"
            onClick={() => void fetchDashboard({ manual: true })}
            className="font-semibold underline shrink-0"
          >
            Thử tải lại
          </button>
        </div>
      )}

      {handoverFeedback && (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50/90 px-4 py-2.5 text-xs font-medium text-emerald-900 flex items-center justify-between gap-2"
        >
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{handoverFeedback}</span>
          </span>
          <button
            type="button"
            onClick={() => setHandoverFeedback(null)}
            className="text-emerald-700 hover:text-emerald-950 font-bold px-1.5"
          >
            ×
          </button>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 4 THẺ KPI XU HƯỚNG (Bento Metric Cards chuẩn Executive)               */}
      {/* ===================================================================== */}
      <FunnelAnomalyGuardStrip />

      {canViewLeads && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/80 border border-slate-200/80 px-3.5 py-2 text-xs">
          <span className="font-semibold text-slate-600">
            🔍 Kiểm toán &amp; Đối chứng gốc từng con số KPI:
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { m: 'received_leads', label: 'Tổng Lead (L1)' },
                { m: 'valid_leads', label: 'Lead hợp lệ (L2)' },
                { m: 'ad_attributed_leads', label: 'Lead từ Quảng cáo (L3)' },
                { m: 'won_leads', label: 'Đơn đã chốt' },
              ] as const
            ).map((btn) => (
              <button
                key={btn.m}
                type="button"
                onClick={() => setAuditLineageMetric(btn.m)}
                className="h-7 px-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-[#0F275C] hover:text-white text-[11px] font-semibold text-slate-700 transition"
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <section aria-label="4 chỉ số điều hành chính" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
        {/* KPI 1: Phễu Lead & Chốt đơn */}
        <Link
          href={canViewLeads ? `/leads?${scopeQueryForLinks}` : `/reports?${scopeQueryForLinks}`}
          className="group rounded-2xl bg-white border border-slate-200/75 hover:border-[#1E3A8A]/35 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] hover:shadow-[0_8px_24px_-8px_rgba(15,39,92,0.12)] transition-all flex flex-col justify-between gap-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Tổng Lead &amp; Chốt đơn
            </span>
            <span className="w-8 h-8 rounded-xl bg-blue-50 text-[#1E3A8A] grid place-items-center shrink-0">
              <BarChart3 className="w-4 h-4" />
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-[28px] leading-none font-extrabold text-slate-900 tabular-nums tracking-tight">
                <AnimatedMetricNumber value={report?.overview?.totalLeadsL1 ?? null} />
              </span>
              <span className="text-xs text-slate-500">
                hợp lệ <strong className="text-slate-700">{report?.overview?.validLeadsL2 ?? 0}</strong>
              </span>
            </div>
            {periodComp && (
              <span
                className={`px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums ${
                  periodComp.tone === 'positive'
                    ? 'bg-emerald-50 text-emerald-700'
                    : periodComp.tone === 'negative'
                      ? 'bg-rose-50 text-rose-700'
                      : 'bg-slate-100 text-slate-600'
                }`}
              >
                {periodComp.label.replace(/\s*so với kỳ trước.*$/i, '')}
              </span>
            )}
          </div>
          <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>
              Tỷ lệ chốt <strong className="text-emerald-700">{report?.overview?.winRateText || '—'}</strong> ·{' '}
              <strong className="text-slate-800">{report?.overview?.wonCount ?? 0}</strong> đơn
            </span>
            <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#1E3A8A] transition" />
          </div>
        </Link>

        {/* KPI 2: Chi phí Ads & Kênh */}
        <Link
          href={canViewTracking ? `/tracking?${scopeQueryForLinks}` : `/reports?${scopeQueryForLinks}`}
          className="group rounded-2xl bg-white border border-slate-200/75 hover:border-[#1E3A8A]/35 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] hover:shadow-[0_8px_24px_-8px_rgba(15,39,92,0.12)] transition-all flex flex-col justify-between gap-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Chi phí Ads &amp; Kênh
            </span>
            <span className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 grid place-items-center shrink-0">
              <Megaphone className="w-4 h-4" />
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-2xl 2xl:text-[26px] leading-none font-extrabold text-slate-900 tabular-nums tracking-tight whitespace-nowrap">
              {report?.marketingSummary?.totalAdsSpend
                ? `${Math.round(Number(report.marketingSummary.totalAdsSpend.formattedDecimal || 0)).toLocaleString('vi-VN')}\u00A0₫`
                : `${report?.marketingSummary?.effectiveLeadsFromAds ?? 0} Lead`}
            </span>
            <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[11px] font-semibold shrink-0">
              {report?.byChannel?.filter((c) => c.count > 0).length || 0} kênh
            </span>
          </div>
          <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span className="truncate">
              Lead Ads hợp lệ: <strong className="text-slate-800">{report?.marketingSummary?.effectiveLeadsFromAds ?? 0}</strong>
            </span>
            <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-600 transition shrink-0" />
          </div>
        </Link>

        {/* KPI 3: Lưu lượng Web & Click SEO */}
        <Link
          href={canViewSeo ? `/ads?${scopeQueryForLinks}` : `/reports?${scopeQueryForLinks}`}
          className="group rounded-2xl bg-white border border-slate-200/75 hover:border-[#1E3A8A]/35 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] hover:shadow-[0_8px_24px_-8px_rgba(15,39,92,0.12)] transition-all flex flex-col justify-between gap-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Lưu lượng &amp; SEO
            </span>
            <span className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 grid place-items-center shrink-0">
              <Globe className="w-4 h-4" />
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-[28px] leading-none font-extrabold text-slate-900 tabular-nums tracking-tight">
                <AnimatedMetricNumber value={totalSystemPageViews} />
              </span>
              <span className="text-xs text-slate-500">lượt xem</span>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-bold tabular-nums">
              {totalSystemGscClicks?.toLocaleString('vi-VN') ?? '—'} SEO
            </span>
          </div>
          <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>
              Bài đăng <strong className="text-slate-800">{report?.marketingSummary?.publishedSeoArticles ?? 0}</strong> · Nháp{' '}
              <strong className="text-amber-700">{report?.marketingSummary?.draftSeoArticles ?? 0}</strong>
            </span>
            <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-600 transition" />
          </div>
        </Link>

        {/* KPI 4: Thiết kế AI 3D & Banner */}
        <Link
          href={canViewDesign ? '/design' : `/reports?${scopeQueryForLinks}`}
          className="group rounded-2xl bg-white border border-slate-200/75 hover:border-[#1E3A8A]/35 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] hover:shadow-[0_8px_24px_-8px_rgba(15,39,92,0.12)] transition-all flex flex-col justify-between gap-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Thiết kế AI 3D
            </span>
            <span className="w-8 h-8 rounded-xl bg-violet-50 text-violet-600 grid place-items-center shrink-0">
              <Sparkles className="w-4 h-4" />
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-[28px] leading-none font-extrabold text-slate-900 tabular-nums tracking-tight">
                <AnimatedMetricNumber value={report?.designSummary?.totalRequests ?? 0} />
              </span>
              <span className="text-xs text-slate-500">yêu cầu</span>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 text-[11px] font-semibold">
              Chờ {report?.designSummary?.pendingCount ?? 0}
            </span>
          </div>
          <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>
              Hoàn tất{' '}
              <strong className="text-slate-800">
                {(report?.designSummary?.completed3dCount ?? 0) + (report?.designSummary?.completedBannerCount ?? 0)}
              </strong>{' '}
              bản vẽ
            </span>
            <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-violet-600 transition" />
          </div>
        </Link>
      </section>

      {/* ===================================================================== */}
      {/* TẦNG 2: KHÔNG GIAN CÁ NHÂN — BENTO 8 / 4 (Gọn gàng, tinh tế)          */}
      {/* ===================================================================== */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
        {/* TRÁI (8/12): Trung tâm Bàn giao Lead 2 chiều dạng Tab gọn */}
        <section
          aria-labelledby="personal-handover-heading"
          className="xl:col-span-8 rounded-2xl bg-white border border-slate-200/75 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="w-7 h-7 rounded-lg bg-amber-50 text-amber-700 grid place-items-center shrink-0">
                <ArrowRightLeft className="w-4 h-4" />
              </span>
              <div>
                <h2 id="personal-handover-heading" className="text-sm font-bold text-slate-900">
                  Chuyển giao Lead 2 chiều
                </h2>
              </div>
            </div>

            {personal?.canManageLeads ? (
              <div className="inline-flex rounded-xl bg-slate-100/90 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setHandoverTab('incoming')}
                  className={`px-3 py-1.5 rounded-lg font-semibold inline-flex items-center gap-1.5 transition ${
                    handoverTab === 'incoming'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <span>Chờ bạn nhận</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold tabular-nums ${
                      incomingHandovers.length > 0
                        ? 'bg-amber-500/15 text-amber-800'
                        : 'bg-slate-200/80 text-slate-600'
                    }`}
                  >
                    {incomingHandovers.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setHandoverTab('outgoing')}
                  className={`px-3 py-1.5 rounded-lg font-semibold inline-flex items-center gap-1.5 transition ${
                    handoverTab === 'outgoing'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <span>Bạn đã chuyển</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold tabular-nums ${
                      outgoingHandovers.length > 0
                        ? 'bg-blue-500/15 text-[#1E3A8A]'
                        : 'bg-slate-200/80 text-slate-600'
                    }`}
                  >
                    {outgoingHandovers.length}
                  </span>
                </button>
              </div>
            ) : (
              <span className="text-xs text-slate-400">Chế độ xem tổng hợp theo vai trò</span>
            )}
          </div>

          <div className="p-4 flex-1 flex flex-col justify-between gap-3">
            {!personal?.canManageLeads ? (
              <div className="rounded-xl bg-slate-50/70 border border-slate-100 p-4 text-xs text-slate-600 flex items-center justify-between gap-3">
                <span>
                  Tài khoản <strong>{user?.roleName}</strong> xem số liệu điều hành ẩn danh thông tin khách hàng theo quy định nội bộ.
                </span>
                <Link
                  href="/reports"
                  className="text-[#1E3A8A] font-semibold hover:underline shrink-0"
                >
                  Mở Báo cáo →
                </Link>
              </div>
            ) : personalLoading ? (
              <div className="space-y-2">
                {[1, 2].map((i) => (
                  <div key={i} className="h-14 rounded-xl bg-slate-50 animate-pulse" />
                ))}
              </div>
            ) : activeHandoverList.length === 0 ? (
              <div className="rounded-xl bg-emerald-50/45 border border-emerald-100 px-4 py-5 flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2.5 text-emerald-900">
                  <span className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center shrink-0">
                    {handoverTab === 'incoming' ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : (
                      <UserCheck className="w-4 h-4" />
                    )}
                  </span>
                  <div>
                    <p className="font-semibold">
                      {handoverTab === 'incoming'
                        ? 'Bạn đã xác nhận tiếp nhận toàn bộ Lead được giao.'
                        : 'Toàn bộ Lead bạn chuyển đi đều đã được đồng nghiệp tiếp nhận.'}
                    </p>
                    <p className="text-[11px] text-emerald-700/80 mt-0.5">
                      Khi có hồ sơ mới chuyển đến, hệ thống sẽ báo im lặng ngay tại đây.
                    </p>
                  </div>
                </div>
                <Link
                  href="/leads"
                  className="px-3 py-1.5 rounded-lg bg-white border border-emerald-200 text-emerald-800 font-semibold hover:bg-emerald-50 shrink-0 transition"
                >
                  Danh sách Lead
                </Link>
              </div>
            ) : (
              <div className="space-y-2 max-h-[245px] overflow-y-auto pr-1">
                {activeHandoverList.slice(0, 6).map((item) => (
                  <div
                    key={item.leadId}
                    className="group relative overflow-hidden rounded-xl border border-slate-200/80 bg-white hover:border-slate-300 hover:bg-slate-50/40 pl-3.5 pr-3 py-2.5 flex flex-wrap items-center justify-between gap-3 transition"
                  >
                    <span
                      aria-hidden="true"
                      className={`absolute inset-y-0 left-0 w-[3px] ${getSlaAccentBar(item.slaLevel)}`}
                    />

                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 font-bold text-[11px] grid place-items-center shrink-0">
                        {getInitials(
                          handoverTab === 'incoming'
                            ? item.fromSalesName || item.customerLabel
                            : item.toSalesName || item.customerLabel,
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/leads?highlight=${item.leadId}`}
                            className="text-xs font-bold text-slate-900 hover:text-[#1E3A8A] truncate"
                          >
                            {item.customerLabel}
                          </Link>
                          <span
                            className="font-mono text-[11px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-md"
                            title={item.leadCode}
                          >
                            {formatCompactLeadCode(item.leadCode)}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${getSlaTextTone(
                              item.slaLevel,
                            )}`}
                          >
                            {formatWaitingDuration(item.waitingMinutes)}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 truncate mt-0.5">
                          {handoverTab === 'incoming' ? (
                            <>
                              Từ <strong className="text-slate-700">{item.fromSalesName || 'Điều phối CRM'}</strong>
                              {item.transferReason ? ` · ${item.transferReason}` : ''}
                            </>
                          ) : (
                            <>
                              Đang chờ <strong className="text-slate-700">{item.toSalesName}</strong> xác nhận
                              {item.transferReason ? ` · ${item.transferReason}` : ''}
                            </>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <Link
                        href={`/leads?highlight=${item.leadId}`}
                        className="h-8 px-2.5 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-100 inline-flex items-center transition"
                      >
                        Chi tiết
                      </Link>
                      {handoverTab === 'incoming' ? (
                        <button
                          type="button"
                          disabled={confirmingId === item.leadId}
                          onClick={() => void handleConfirmReceive(item)}
                          className="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1 shadow-2xs transition disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{confirmingId === item.leadId ? 'Đang lưu...' : 'Xác nhận'}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={item.nudgedRecently || nudgingId === item.leadId}
                          onClick={() => void handleNudgeOutgoing(item)}
                          className={`h-8 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition ${
                            item.nudgedRecently
                              ? 'bg-emerald-50 text-emerald-700 cursor-default'
                              : 'bg-blue-50 hover:bg-blue-100 text-[#1E3A8A]'
                          }`}
                        >
                          {item.nudgedRecently ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Đã nhắc</span>
                            </>
                          ) : (
                            <>
                              <Send className="w-3 h-3" />
                              <span>{nudgingId === item.leadId ? 'Đang gửi...' : 'Nhắc nhẹ'}</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {overdueTeamHandovers.length > 0 && (
              <div className="rounded-xl bg-rose-50/75 border border-rose-200/80 px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 text-rose-900 min-w-0">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                  <span className="truncate">
                    <strong>{overdueTeamHandovers.length} hồ sơ</strong> toàn phòng quá 4 giờ chưa tiếp nhận:{' '}
                    {overdueTeamHandovers
                      .slice(0, 2)
                      .map((h) => `${formatCompactLeadCode(h.leadCode)} (${h.toSalesName})`)
                      .join(', ')}
                  </span>
                </div>
                <Link
                  href="/leads"
                  className="text-rose-700 font-bold hover:underline shrink-0"
                >
                  Điều phối →
                </Link>
              </div>
            )}
          </div>
        </section>

        {/* PHẢI (4/12): Checklist Việc ưu tiên cá nhân (Gọn sắc nét, 0 hộp trống trải) */}
        <section
          aria-labelledby="personal-checklist-heading"
          className="xl:col-span-4 rounded-2xl bg-white border border-slate-200/75 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between overflow-hidden"
        >
          <div>
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
              <h2 id="personal-checklist-heading" className="text-sm font-bold text-slate-900">
                Nhắc việc của riêng bạn
              </h2>
              <span className="text-[11px] font-medium text-slate-400">Cá nhân hóa</span>
            </div>

            <div className="divide-y divide-slate-100">
              {/* Mục 1: Lịch hẹn gọi lại */}
              <Link
                href={
                  personal?.todayCallbacks?.[0]
                    ? `/leads?highlight=${personal.todayCallbacks[0].leadId}`
                    : '/leads'
                }
                className="group px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50/80 transition"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-9 h-9 rounded-xl bg-amber-50 text-amber-700 grid place-items-center shrink-0">
                    <CalendarClock className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 group-hover:text-[#1E3A8A]">
                      Lịch hẹn gọi lại hôm nay
                    </p>
                    <p className="text-[11px] text-slate-500 truncate mt-0.5">
                      {personal?.todayCallbacks?.[0]
                        ? `${personal.todayCallbacks[0].customerLabel} · ${personal.todayCallbacks[0].scheduledDate}`
                        : 'Chưa có lịch hẹn đến hạn hôm nay'}
                    </p>
                  </div>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-extrabold tabular-nums shrink-0 ${
                    (personal?.todayCallbacks?.length ?? 0) > 0
                      ? 'bg-amber-100 text-amber-900'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {personal?.todayCallbacks?.length ?? 0}
                </span>
              </Link>

              {/* Mục 2: Báo giá quá 7 ngày */}
              <Link
                href={canViewLeads ? `/leads?overdue7d=1&${scopeQueryForLinks}` : '/reports'}
                className="group px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50/80 transition"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 grid place-items-center shrink-0">
                    <BellRing className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 group-hover:text-[#1E3A8A]">
                      Báo giá quá 7 ngày chưa phản hồi
                    </p>
                    <p className="text-[11px] text-slate-500 truncate mt-0.5">
                      {personal?.overdueQuotes7d?.[0]
                        ? `${personal.overdueQuotes7d[0].customerLabel} (${personal.overdueQuotes7d[0].waitingDays} ngày)`
                        : 'Không có báo giá quá hạn phản hồi'}
                    </p>
                  </div>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-extrabold tabular-nums shrink-0 ${
                    (personal?.overdueQuotesTotal ?? 0) > 0
                      ? 'bg-rose-100 text-rose-800'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {personal?.overdueQuotesTotal ?? 0}
                </span>
              </Link>

              {/* Mục 3: Thiết kế AI của bạn */}
              <Link
                href={canViewDesign ? '/design' : '/reports'}
                className="group px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50/80 transition"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-9 h-9 rounded-xl bg-violet-50 text-violet-600 grid place-items-center shrink-0">
                    <Sparkles className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 group-hover:text-[#1E3A8A]">
                      Thiết kế AI của bạn
                    </p>
                    <p className="text-[11px] text-slate-500 truncate mt-0.5">
                      {personal?.myDesignItems?.[0]
                        ? `${personal.myDesignItems[0].projectName} · Hoàn tất 7 ngày: ${personal.designCompletedRecentCount}`
                        : `Đang chờ: ${personal?.designPendingCount ?? 0} · Hoàn tất 7 ngày: ${personal?.designCompletedRecentCount ?? 0}`}
                    </p>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-violet-50 text-violet-700 text-xs font-extrabold tabular-nums shrink-0">
                  {personal?.myDesignItems?.length ?? 0}
                </span>
              </Link>
            </div>
          </div>

          {/* Dải kiểm tra chất lượng dữ liệu tinh gọn ở chân thẻ */}
          {dq && (
            <div className="px-4 py-2.5 bg-slate-50/70 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
              <div className="flex items-center gap-2.5">
                <Link
                  href={canViewLeads ? `/leads?missingProduct=1&${scopeQueryForLinks}` : '/reports'}
                  className="hover:text-[#1E3A8A] transition"
                >
                  Thiếu SP: <strong className="text-slate-700 tabular-nums">{dq.missingProductCount}</strong>
                </Link>
                <span className="text-slate-300">·</span>
                <Link
                  href={canViewLeads ? `/leads?missingWebsite=1&${scopeQueryForLinks}` : '/reports'}
                  className="hover:text-[#1E3A8A] transition"
                >
                  Thiếu web: <strong className="text-slate-700 tabular-nums">{dq.missingWebsiteCount}</strong>
                </Link>
              </div>
              <Link
                href={canViewSettings ? '/settings?tab=sync' : `/reports?${scopeQueryForLinks}`}
                className={`inline-flex items-center gap-1 font-semibold ${
                  dq.failingConnectionsCount > 0 ? 'text-rose-600' : 'text-emerald-600'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    dq.failingConnectionsCount > 0 ? 'bg-rose-500' : 'bg-emerald-500'
                  }`}
                />
                <span>
                  {dq.failingConnectionsCount > 0
                    ? `${dq.failingConnectionsCount} lỗi kết nối`
                    : 'Đồng bộ ổn định'}
                </span>
              </Link>
            </div>
          )}
        </section>
      </div>

      {/* ===================================================================== */}
      {/* TẦNG 3A: BIỂU ĐỒ TƯƠNG TÁC + PHỄU CHUYỂN ĐỔI (7/12) & DONUT NGUỒN (5/12) */}
      {/* ===================================================================== */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
        {/* TRÁI (7/12): Biểu đồ Lead theo ngày có hover tooltip + Thanh phễu chuyển đổi */}
        <section
          aria-labelledby="analytics-trend-heading"
          className="xl:col-span-7 rounded-2xl bg-white border border-slate-200/75 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between gap-4"
        >
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#1E3A8A]" />
                <h2 id="analytics-trend-heading" className="text-sm font-bold text-slate-900">
                  Nhịp Lead theo ngày &amp; Phễu chuyển đổi
                </h2>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-500">
                {hoveredPoint ? (
                  <span className="px-2.5 py-0.5 rounded-full bg-[#0F275C] text-white font-semibold tabular-nums">
                    {hoveredPoint.label}: {hoveredPoint.totalL1} Lead
                  </span>
                ) : (
                  <span>
                    Đỉnh kỳ:{' '}
                    <strong className="text-slate-800 tabular-nums">
                      {Math.max(0, ...chartPoints.map((p) => p.totalL1))}
                    </strong>
                    /ngày
                  </span>
                )}
              </div>
            </div>

            {areaChart ? (
              <div className="relative">
                <svg
                  viewBox={`0 0 ${areaChart.W} ${areaChart.H}`}
                  className="w-full h-[165px] overflow-visible select-none"
                  role="img"
                  aria-label="Biểu đồ Lead mới theo ngày"
                  onMouseLeave={() => setHoveredDayIdx(null)}
                >
                  <defs>
                    <linearGradient id={pulseGradId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2563EB" stopOpacity="0.22" />
                      <stop offset="100%" stopColor="#2563EB" stopOpacity="0.01" />
                    </linearGradient>
                  </defs>

                  {/* Đường lưới ngang mảnh */}
                  {areaChart.gridTicks.map((tick) => {
                    const y = areaChart.padT + areaChart.innerH - (tick / areaChart.maxV) * areaChart.innerH;
                    return (
                      <g key={`grid-${tick}`}>
                        <line
                          x1={areaChart.padL}
                          y1={y}
                          x2={areaChart.W - areaChart.padR}
                          y2={y}
                          stroke="#F1F5F9"
                          strokeWidth="1"
                        />
                        <text
                          x={areaChart.padL - 6}
                          y={y + 3}
                          textAnchor="end"
                          className="fill-slate-400 text-[9px] tabular-nums"
                        >
                          {tick}
                        </text>
                      </g>
                    );
                  })}

                  <path d={areaChart.areaPath} fill={`url(#${pulseGradId})`} />
                  <path
                    d={areaChart.linePath}
                    fill="none"
                    stroke="#1E3A8A"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />

                  {/* Đường gióng dọc khi rê chuột */}
                  {hoveredPoint && (
                    <line
                      x1={hoveredPoint.x}
                      y1={areaChart.padT}
                      x2={hoveredPoint.x}
                      y2={areaChart.padT + areaChart.innerH}
                      stroke="#93C5FD"
                      strokeDasharray="3 3"
                      strokeWidth="1.2"
                    />
                  )}

                  {areaChart.pts.map((pt) => {
                    const isHovered = hoveredDayIdx === pt.index;
                    return (
                      <g
                        key={pt.date}
                        onMouseEnter={() => setHoveredDayIdx(pt.index)}
                        className="cursor-pointer"
                      >
                        <rect
                          x={pt.x - 12}
                          y={areaChart.padT}
                          width="24"
                          height={areaChart.innerH}
                          fill="transparent"
                        />
                        {(pt.totalL1 > 0 || isHovered) && (
                          <circle
                            cx={pt.x}
                            cy={pt.y}
                            r={isHovered ? 5 : 3.5}
                            fill={isHovered ? '#1E3A8A' : '#FFFFFF'}
                            stroke="#1E3A8A"
                            strokeWidth="2"
                          />
                        )}
                      </g>
                    );
                  })}
                </svg>

                <div className="flex items-center justify-between text-[11px] text-slate-400 pl-7 pr-4 -mt-3 tabular-nums">
                  <span>{chartPoints[0]?.label}</span>
                  <span>{chartPoints[Math.floor(chartPoints.length / 2)]?.label}</span>
                  <span>{chartPoints[chartPoints.length - 1]?.label}</span>
                </div>
              </div>
            ) : (
              <div className="h-[160px] grid place-items-center text-xs text-slate-400">
                Chưa có dữ liệu biểu đồ trong kỳ đang chọn.
              </div>
            )}
          </div>

          {/* Thanh phễu chuyển đổi 5 bước nằm gọn dưới biểu đồ */}
          {funnelStages.length > 0 && (
            <div className="pt-3 border-t border-slate-100 space-y-2.5">
              <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden flex gap-0.5">
                {funnelStages.map((st) =>
                  st.count > 0 ? (
                    <Link
                      key={st.key}
                      href={canViewLeads ? `/leads?status=${st.key}&${scopeQueryForLinks}` : '/reports'}
                      title={`${st.label}: ${st.count} Lead (${st.pct}%)`}
                      style={{ width: `${Math.max(4, st.pct)}%` }}
                      className={`h-full ${st.color} hover:opacity-85 transition-opacity`}
                    />
                  ) : null,
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                {funnelStages.map((st) => (
                  <Link
                    key={`leg-${st.key}`}
                    href={canViewLeads ? `/leads?status=${st.key}&${scopeQueryForLinks}` : '/reports'}
                    className="inline-flex items-center gap-1.5 text-slate-600 hover:text-slate-950 transition"
                  >
                    <span className={`w-2 h-2 rounded-full ${st.dot}`} />
                    <span className="text-[11px]">{st.label}</span>
                    <strong className="text-xs font-bold text-slate-900 tabular-nums">{st.count}</strong>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* PHẢI (5/12): Biểu đồ vòng Donut Tỷ trọng Nguồn Lead */}
        <section
          aria-labelledby="channel-donut-heading"
          className="xl:col-span-5 rounded-2xl bg-white border border-slate-200/75 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between"
        >
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <PieChart className="w-4 h-4 text-[#1E3A8A]" />
              <h2 id="channel-donut-heading" className="text-sm font-bold text-slate-900">
                Tỷ trọng nguồn Lead
              </h2>
            </div>
            <Link
              href={canViewTracking ? `/tracking?${scopeQueryForLinks}` : `/reports?${scopeQueryForLinks}`}
              className="text-xs font-semibold text-[#1E3A8A] hover:underline"
            >
              Phân tích kênh →
            </Link>
          </div>

          {channelDonut.total === 0 ? (
            <div className="flex-1 grid place-items-center py-8 text-xs text-slate-400">
              Chưa có dữ liệu nguồn Lead trong kỳ lọc.
            </div>
          ) : (
            <div className="flex-1 flex flex-col sm:flex-row items-center gap-5 my-auto">
              <div className="relative w-36 h-36 shrink-0">
                <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90" role="img" aria-label="Biểu đồ tỷ trọng nguồn Lead">
                  <circle cx="60" cy="60" r="44" fill="none" stroke="#F1F5F9" strokeWidth="14" />
                  {channelDonut.slices.map((sl) => (
                    <circle
                      key={sl.label}
                      cx="60"
                      cy="60"
                      r="44"
                      fill="none"
                      stroke={sl.color}
                      strokeWidth="14"
                      strokeDasharray={sl.dashArray}
                      strokeDashoffset={sl.dashOffset}
                      strokeLinecap="butt"
                    />
                  ))}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
                  <span className="text-2xl font-extrabold text-slate-900 tabular-nums leading-none">
                    {channelDonut.total}
                  </span>
                  <span className="text-[10px] font-medium text-slate-400 mt-1">Tổng Lead</span>
                </div>
              </div>

              <div className="flex-1 w-full space-y-2">
                {channelDonut.slices.map((sl) => (
                  <div key={sl.label} className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: sl.color }}
                      />
                      <span className="text-slate-700 font-medium truncate">{sl.label}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 tabular-nums">
                      <strong className="text-slate-900">{sl.count}</strong>
                      <span className="text-[11px] text-slate-400 w-8 text-right">{sl.pct}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* ===================================================================== */}
      {/* TẦNG 3B: MA TRẬN 4 WEBSITE (7/12) + HOẠT ĐỘNG / ĐỘI NGŨ SALES (5/12) */}
      {/* ===================================================================== */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
        <section
          aria-labelledby="dashboard-websites-matrix-heading"
          className="xl:col-span-7 rounded-2xl bg-white border border-slate-200/75 shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-hidden flex flex-col justify-between"
        >
          <div>
            <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Globe aria-hidden="true" className="w-4 h-4 text-[#1E3A8A]" />
                <h2 id="dashboard-websites-matrix-heading" className="text-sm font-bold text-slate-900">
                  Hiệu suất 4 Website &amp; Mạch Ads ↔ Lead
                </h2>
              </div>
              <Link
                href={`/reports?${scopeQueryForLinks}`}
                className="text-xs font-semibold text-[#1E3A8A] hover:underline inline-flex items-center gap-1"
              >
                <span>Báo cáo chi tiết</span>
                <ArrowRight aria-hidden="true" className="w-3.5 h-3.5" />
              </Link>
            </div>

            {isLoading && !report ? (
              <div className="p-4 space-y-2.5">
                {[1, 2, 3, 4].map((k) => (
                  <div key={k} className="h-12 rounded-xl bg-slate-50 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[11px] text-slate-400 uppercase tracking-wider border-b border-slate-100 bg-slate-50/40">
                    <tr>
                      <th className="py-2.5 pl-4 pr-3 font-semibold">Website</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Xem trang</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Click SEO</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Lead</th>
                      <th className="py-2.5 pl-3 pr-4 font-semibold text-right">Đi nhanh</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {websiteRows.map((ws) => {
                      const showDomain =
                        ws.domain &&
                        ws.shortName.toLowerCase().trim() !== ws.domain.toLowerCase().trim();
                      return (
                        <tr key={ws.websiteId} className="hover:bg-slate-50/75 transition-colors">
                          <td className="py-3 pl-4 pr-3">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-900">{ws.shortName}</span>
                              {showDomain && (
                                <span className="text-[11px] font-mono text-slate-400 hidden sm:inline">
                                  {ws.domain}
                                </span>
                              )}
                            </div>
                            <div className="mt-1 flex items-center gap-2">
                              <div className="w-24 h-1 rounded-full bg-slate-100 overflow-hidden">
                                {ws.sharePct > 0 && (
                                  <div
                                    style={{ width: `${Math.min(100, ws.sharePct)}%` }}
                                    className="h-full rounded-full bg-gradient-to-r from-[#1E3A8A] to-sky-400"
                                  />
                                )}
                              </div>
                              <span className="text-[10px] text-slate-400 tabular-nums">
                                {ws.sharePct}%
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right font-semibold text-slate-700 tabular-nums">
                            {ws.pageViews !== null ? ws.pageViews.toLocaleString('vi-VN') : '—'}
                          </td>
                          <td className="py-3 px-3 text-right font-semibold text-emerald-700 tabular-nums">
                            {ws.gscClicks !== null ? ws.gscClicks.toLocaleString('vi-VN') : '—'}
                          </td>
                          <td className="py-3 px-3 text-right font-extrabold text-[#0F275C] tabular-nums">
                            {ws.totalLeadsL1}
                          </td>
                          <td className="py-3 pl-3 pr-4 text-right whitespace-nowrap">
                            {!ws.isDirectOrUnmapped ? (
                              <div className="inline-flex items-center gap-1">
                                <Link
                                  href={`/tracking?websiteId=${encodeURIComponent(ws.websiteId)}&${scopeQueryForLinks}`}
                                  className="px-2 py-1 rounded-lg bg-slate-100/80 hover:bg-blue-50 text-slate-600 hover:text-[#1E3A8A] text-[11px] font-semibold transition"
                                >
                                  Ads/GA4
                                </Link>
                                <Link
                                  href={`/ads?websiteId=${encodeURIComponent(ws.websiteId)}&${scopeQueryForLinks}`}
                                  className="px-2 py-1 rounded-lg bg-slate-100/80 hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 text-[11px] font-semibold transition"
                                >
                                  SEO
                                </Link>
                              </div>
                            ) : (
                              <Link
                                href={canViewLeads ? `/leads?missingWebsite=1&${scopeQueryForLinks}` : '/reports'}
                                className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 text-[11px] font-semibold transition"
                              >
                                Gắn web
                              </Link>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="px-4 py-2.5 bg-slate-50/60 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>
              Tổng lượt xem:{' '}
              <strong className="text-slate-900 tabular-nums">
                {totalSystemPageViews !== null ? totalSystemPageViews.toLocaleString('vi-VN') : '—'}
              </strong>
            </span>
            <span>
              Tổng Click SEO:{' '}
              <strong className="text-emerald-700 tabular-nums">
                {totalSystemGscClicks !== null ? totalSystemGscClicks.toLocaleString('vi-VN') : '—'}
              </strong>
            </span>
          </div>
        </section>

        {/* PHẢI (5/12): Hoạt động mới toàn phòng (Timeline tinh tế) / Đội ngũ Sales */}
        <section
          aria-labelledby="dashboard-team-activity-heading"
          className="xl:col-span-5 rounded-2xl bg-white border border-slate-200/75 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col"
        >
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="inline-flex rounded-xl bg-slate-100/90 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setRightCardTab('activity')}
                className={`px-3 py-1 rounded-lg font-semibold inline-flex items-center gap-1.5 transition ${
                  rightCardTab === 'activity'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Hoạt động mới</span>
              </button>
              <button
                type="button"
                onClick={() => setRightCardTab('team')}
                className={`px-3 py-1 rounded-lg font-semibold inline-flex items-center gap-1.5 transition ${
                  rightCardTab === 'team'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Đội ngũ Sales</span>
              </button>
            </div>
            <h2 id="dashboard-team-activity-heading" className="sr-only">
              Hoạt động mới và Đội ngũ Kinh doanh
            </h2>
            <Link
              href={rightCardTab === 'activity' ? '/leads' : '/profile'}
              className="text-xs font-semibold text-[#1E3A8A] hover:underline"
            >
              {rightCardTab === 'activity' ? 'Xem tất cả →' : 'Thành viên →'}
            </Link>
          </div>

          {rightCardTab === 'activity' ? (
            <div className="relative flex-1 min-h-0 space-y-2 max-h-[380px] overflow-y-auto [scrollbar-width:thin] pr-1 before:content-[''] before:absolute before:left-[11px] before:top-3 before:bottom-3 before:w-px before:bg-slate-100">
              {(personal?.recentActivities || []).length === 0 ? (
                <p className="text-xs text-slate-400 py-8 text-center">
                  Chưa có hoạt động gần đây.
                </p>
              ) : (
                (personal?.recentActivities || []).slice(0, 8).map((act) => {
                  const hasDistinctCustomer =
                    Boolean(act.customerLabel) &&
                    act.customerLabel.trim() !== act.leadCode.trim() &&
                    !act.customerLabel.includes(act.leadCode);
                  return (
                    <Link
                      key={act.id}
                      href={canViewLeads ? `/leads?highlight=${act.leadId}` : '/reports'}
                      className="relative pl-7 pr-2 py-1.5 rounded-xl hover:bg-slate-50/90 flex items-start justify-between gap-2 transition"
                    >
                      <span
                        aria-hidden="true"
                        className={`absolute left-[7px] top-3 w-2.5 h-2.5 rounded-full ring-4 ring-white ${getActivityDotColor(
                          act.actionType,
                        )}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-slate-800 leading-snug truncate">
                          <strong className="font-semibold text-slate-900">{act.actorName}</strong>{' '}
                          <span className="text-slate-500">{act.summary}</span>
                        </p>
                        <p className="text-[11px] text-slate-400 truncate mt-0.5">
                          <span
                            className="font-mono text-[#1E3A8A] font-medium"
                            title={act.leadCode}
                          >
                            {formatCompactLeadCode(act.leadCode)}
                          </span>
                          {hasDistinctCustomer ? ` · ${act.customerLabel}` : ''}
                        </p>
                      </div>
                      <span className="text-[10px] text-slate-400 whitespace-nowrap inline-flex items-center gap-0.5 shrink-0 pt-0.5 tabular-nums">
                        <Clock className="w-3 h-3" />
                        {new Date(act.createdAt).toLocaleTimeString('vi-VN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </Link>
                  );
                })
              )}
            </div>
          ) : (
            <div className="flex-1 min-h-0 space-y-2.5 max-h-[380px] overflow-y-auto [scrollbar-width:thin] pr-1">
              {salesRows.slice(0, 6).map((sp) => (
                <div
                  key={sp.salesUserId}
                  className="p-2.5 rounded-xl hover:bg-slate-50/90 transition space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {sp.avatarUrl ? (
                        <img
                          src={sp.avatarUrl}
                          alt={sp.salesFullName}
                          className="w-7 h-7 rounded-full object-cover ring-1 ring-slate-200 shrink-0"
                        />
                      ) : (
                        <span className="w-7 h-7 rounded-full bg-blue-50 text-[#0F275C] font-bold text-[10px] grid place-items-center shrink-0">
                          {getInitials(sp.salesFullName)}
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900 truncate">
                          {sp.salesFullName}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          Báo giá {sp.quotingLeads + sp.quoteSentLeads} · Chốt{' '}
                          <strong className="text-emerald-700">{sp.wonLeads}</strong>
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-extrabold text-slate-900 tabular-nums shrink-0">
                      {sp.totalLeads} hồ sơ
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      style={{ width: `${Math.max(6, Math.round((sp.totalLeads / maxSalesLeads) * 100))}%` }}
                      className="h-full rounded-full bg-gradient-to-r from-[#1E3A8A] to-sky-400"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <KpiAuditLineageDrawer
        open={Boolean(auditLineageMetric)}
        onClose={() => setAuditLineageMetric(null)}
        metric={auditLineageMetric}
      />
    </div>
  );
}

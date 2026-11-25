'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  CalendarDays,
  ChevronDown,
  Download,
  ExternalLink,
  FileText,
  Layers,
  LayoutDashboard,
  Link2,
  Megaphone,
  MonitorSmartphone,
  MousePointerClick,
  RefreshCw,
  Search,
  Share2,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  UI_VOCABULARY,
  formatSafePeriodComparison,
  hasBaPermission,
  type M02CampaignRowDto,
  type M02TrafficInteractionDto,
  type WebsiteConfigItemDto,
} from '@toantrung/contracts';
import { apiRequest, peekApiCacheEntry } from '@/core/http/client';
import { subscribeDataSync } from '@/core/http/data-sync-bus';
import { loadRouteState, saveRouteState } from '@/core/http/route-state';
import { useSession } from '@/core/session/SessionContext';
import { useDashboardScope } from '@/core/dashboard/useDashboardScope';
import { WebsiteDashboardHeader } from '@/components/common/WebsiteDashboardHeader';
import { AnimatedMetricNumber } from '@/components/common/AnimatedMetricNumber';
import { VerticalSectionNav } from '@/components/common/VerticalSectionNav';
import { MktSpreadsheetCalcBar, useMktExcelSelection } from '@/components/common/MktSpreadsheetCalcBar';
import { AdsExcelTableSection } from './AdsExcelTableSection';
import {
  FunnelAnomalyGuardStrip,
  KpiAuditLineageDrawer,
  type LineageMetricType,
} from '@/core/components/common/KpiAuditLineageDrawer';

const MarketingTrafficChart = dynamic(
  () => import('./MarketingTrafficChart').then((m) => m.MarketingTrafficChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-[296px] rounded-xl bg-slate-50 border border-slate-100 animate-pulse" />
    ),
  },
);

const MarketingChannelMixCard = dynamic(
  () => import('./MarketingTrafficChart').then((m) => m.MarketingChannelMixCard),
  {
    ssr: false,
    loading: () => (
      <div className="h-[260px] rounded-xl bg-slate-50 border border-slate-100 animate-pulse" />
    ),
  },
);

const GoogleAdsDualMetricChart = dynamic(
  () => import('./GoogleAdsDualMetricChart').then((m) => m.GoogleAdsDualMetricChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-[280px] rounded-xl bg-slate-50 border border-slate-100 animate-pulse" />
    ),
  },
);

const Ga4RealtimeBarCard = dynamic(
  () => import('./Ga4RealtimeBarCard').then((m) => m.Ga4RealtimeBarCard),
  {
    ssr: false,
    loading: () => (
      <div className="h-[180px] rounded-xl bg-slate-50 border border-slate-100 animate-pulse" />
    ),
  },
);

type MainBusinessTab = 'traffic' | 'ads';
type TrafficTableSubTab = 'channels' | 'landing_pages' | 'actions';
type TrackingSectionId =
  | 'overview'
  | 'landing_pages'
  | 'channels'
  | 'actions'
  | 'devices_geo'
  | 'ads_campaigns'
  | 'ads_daily'
  | 'ads_landing_pages'
  | 'ads_search_terms'
  | 'ads_breakdowns';

const VALID_TRACKING_SECTIONS: ReadonlySet<string> = new Set([
  'overview',
  'landing_pages',
  'channels',
  'actions',
  'devices_geo',
  'ads_campaigns',
  'ads_daily',
  'ads_landing_pages',
  'ads_search_terms',
  'ads_breakdowns',
]);

const SECTION_META: Record<TrackingSectionId, { title: string; subtitle: string }> = {
  overview: {
    title: 'Lưu lượng truy cập (GA4)',
    subtitle: 'Người dùng mới, phiên truy cập và kênh thu hút',
  },
  landing_pages: {
    title: 'Trang đích',
    subtitle: 'Lưu lượng khách mới theo từng nhóm trang',
  },
  channels: {
    title: 'Hiệu suất kênh',
    subtitle: 'Kênh tiếp thị, nguồn truy cập và Lead đối soát',
  },
  actions: {
    title: 'Sự kiện & Realtime 30 phút',
    subtitle: 'Hoạt động trong 30 phút qua và lượt tương tác trong kỳ',
  },
  devices_geo: {
    title: 'Thiết bị & Khu vực',
    subtitle: 'Phân bổ theo thiết bị và tỉnh thành truy cập',
  },
  ads_campaigns: {
    title: 'Chiến dịch Google Ads',
    subtitle: 'Hiệu suất chiến dịch, link đích và chi phí trên mỗi Lead',
  },
  ads_daily: {
    title: 'Chi phí theo ngày',
    subtitle: 'Theo dõi chi phí, CTR, CPC theo từng ngày',
  },
  ads_landing_pages: {
    title: 'Trang đích quảng cáo',
    subtitle: 'Hiệu suất từng URL đích từ Google Ads',
  },
  ads_search_terms: {
    title: 'Cụm từ tìm kiếm',
    subtitle: 'Truy vấn thực tế khách tìm trước khi nhấp quảng cáo',
  },
  ads_breakdowns: {
    title: 'Nhóm QC & Từ khóa',
    subtitle: 'Nhóm quảng cáo, từ khóa, thiết bị và khung giờ',
  },
};

const SELECTED_EVENTS_STORAGE_KEY = 'tt_m02_selected_events_v1';
const DEFAULT_TRACKED_EVENTS = [
  'GA4_Form',
  'GA4_Phone_713',
  'GA4_Zalo_713',
  'GA4_Zalo_800',
  'click',
  'form_submit',
  'generate_lead',
];

function buildM02ApiPath(
  scope: { websiteId: string; preset: string; from: string; to: string },
  page: number,
  adsPage: number,
  adsScope: 'all' | 'website',
  compare: boolean,
): string {
  const qs = new URLSearchParams({
    view: 'spec',
    websiteId: scope.websiteId || 'all',
    preset: scope.preset || '7D',
    page: String(page),
    pageSize: '60',
    adsPage: String(adsPage),
    adsPageSize: '100',
    adsScope,
  });
  if (compare) qs.set('compare', '1');
  if (scope.preset === 'CUSTOM' && scope.from && scope.to) {
    qs.set('from', scope.from);
    qs.set('to', scope.to);
  }
  return `/api/v1/tracking?${qs.toString()}`;
}

export function TrackingWorkspace() {
  const { user } = useSession();
  const [auditLineageMetric, setAuditLineageMetric] = useState<LineageMetricType | null>(null);
  const canDirectDesign = Boolean(user && hasBaPermission(user.roleCode, 'AI_DESIGN'));
  const { scope, hydrated, updateScope } = useDashboardScope();
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [activeSection, setActiveSection] = useState<TrackingSectionId>(() => {
    if (typeof window !== 'undefined') {
      const qs = new URLSearchParams(window.location.search);
      const sec = qs.get('section');
      if (sec && VALID_TRACKING_SECTIONS.has(sec)) return sec as TrackingSectionId;
      const t = qs.get('tab');
      if (t === 'ads') return 'ads_campaigns';
      if (t === 'traffic') return 'overview';
      const saved = loadRouteState<{
        activeSection?: string;
        businessTab?: MainBusinessTab;
        trafficSubTab?: TrafficTableSubTab;
      }>('tracking');
      if (saved?.activeSection && VALID_TRACKING_SECTIONS.has(saved.activeSection)) {
        return saved.activeSection as TrackingSectionId;
      }
      if (saved?.businessTab === 'ads') return 'ads_campaigns';
      if (saved?.trafficSubTab && VALID_TRACKING_SECTIONS.has(saved.trafficSubTab)) {
        return saved.trafficSubTab;
      }
    }
    return 'overview';
  });
  const [adsScopeMode, setAdsScopeMode] = useState<'all' | 'website'>(() => {
    const saved = loadRouteState<{ adsScopeMode?: 'all' | 'website' }>('tracking');
    return saved?.adsScopeMode || 'all';
  });
  const [lpCategoryFilter, setLpCategoryFilter] = useState<string>('all');
  const [hideNoiseLp, setHideNoiseLp] = useState<boolean>(true);
  const ga4ExcelCalc = useMktExcelSelection();
  const [showRealtimePicker, setShowRealtimePicker] = useState<boolean>(false);
  const [showOnlySelectedEvents, setShowOnlySelectedEvents] = useState<boolean>(false);
  const [selectedEvents, setSelectedEvents] = useState<string[]>(() => {
    if (typeof window === 'undefined') return DEFAULT_TRACKED_EVENTS;
    try {
      const saved = window.localStorage.getItem(SELECTED_EVENTS_STORAGE_KEY);
      if (saved) {
        const arr = JSON.parse(saved) as string[];
        if (Array.isArray(arr) && arr.length > 0) return arr;
      }
    } catch {
      // ignore
    }
    return DEFAULT_TRACKED_EVENTS;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(SELECTED_EVENTS_STORAGE_KEY, JSON.stringify(selectedEvents));
    } catch {
      // ignore
    }
  }, [selectedEvents]);

  const [page, setPage] = useState(() => loadRouteState<{ page?: number }>('tracking')?.page || 1);
  const [adsPage, setAdsPage] = useState(() => loadRouteState<{ adsPage?: number }>('tracking')?.adsPage || 1);
  const [searchTerm, setSearchTerm] = useState('');
  const [drawerCampaign, setDrawerCampaign] = useState<M02CampaignRowDto | null>(null);
  const [briefSubmittingId, setBriefSubmittingId] = useState<string | null>(null);
  const [briefNotice, setBriefNotice] = useState<string | null>(null);
  const reqSeqRef = useRef<number>(0);
  const prevScopeSigRef = useRef<string>(`${scope.websiteId}|${scope.preset}|${scope.from}|${scope.to}`);
  const scrollRestoredRef = useRef<boolean>(false);

  const handleCreateCampaignBrief = async (c: M02CampaignRowDto) => {
    setBriefSubmittingId(c.campaignId);
    setBriefNotice(null);
    try {
      const domain =
        data?.scope.domain ||
        (scope.websiteId && scope.websiteId !== 'all' ? scope.websiteId : 'toantrung.com.vn');
      const res = await apiRequest<{ ok: boolean; projectId: number; message: string }>('/api/v1/design', {
        method: 'POST',
        csrfToken: user?.csrfToken,
        body: {
          action: 'submit_marketing_brief',
          projectName: `Banner chiến dịch ${c.campaignName}`,
          taskCode: 'banner_generate',
          designType: 'banner',
          sourceModule: 'tracking',
          designBrief: {
            objective: `Tối ưu hiệu quả quảng cáo & CPL cho chiến dịch ${c.campaignName}`,
            websiteId: scope.websiteId !== 'all' ? scope.websiteId : domain,
            websiteDomain: domain,
            campaignId: c.campaignId,
            campaignName: c.campaignName,
            targetChannel: 'Google Ads Display / Search Landing',
            outputFormat: 'Banner 16:9 (1536×1024 px)',
            outputWidthPx: 1536,
            outputHeightPx: 1024,
            headlineText: `${c.campaignName} · Giải pháp LED Toàn Trung`,
            ctaText: 'Nhận báo giá ngay',
            baselineSnapshot: data
              ? {
                capturedAt: new Date().toISOString(),
                sourceModule: 'tracking',
                scopeLabel: `${c.campaignName} (${data.scope.startDate} → ${data.scope.endDate})`,
                dateFrom: data.scope.startDate,
                dateTo: data.scope.endDate,
                websiteId: scope.websiteId || 'all',
                websiteDomain: domain,
                campaignId: c.campaignId,
                campaignName: c.campaignName,
                metrics: {
                  adCost: c.cost,
                  receivedLeadCount: c.attributedLeadCount,
                  validLeadCount: c.validAttributedLeadCount,
                  costPerValidAdLead: c.costPerValidLead,
                  wonLeadCount: c.wonAttributedLeadCount,
                },
              }
              : null,
          },
        },
      });
      setBriefNotice(
        res.message || `Đã gửi Brief thiết kế #${res.projectId} cho chiến dịch "${c.campaignName}" sang Studio.`,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể gửi Brief thiết kế.');
    } finally {
      setBriefSubmittingId(null);
    }
  };

  const apiPath = useMemo(
    () => buildM02ApiPath(scope, page, adsPage, adsScopeMode, compareEnabled),
    [scope, page, adsPage, adsScopeMode, compareEnabled],
  );

  useEffect(() => {
    const onPlatformSwitch = (e: Event) => {
      const key = (e as CustomEvent<string>).detail;
      if (key === 'ga4') setActiveSection('overview');
      if (key === 'ads') setActiveSection('ads_campaigns');
    };
    window.addEventListener('tt-google-platform-click', onPlatformSwitch as EventListener);
    return () =>
      window.removeEventListener('tt-google-platform-click', onPlatformSwitch as EventListener);
  }, []);
  const activePathRef = useRef<string>(apiPath);
  activePathRef.current = apiPath;

  const [dataState, setDataState] = useState<{
    path: string;
    data: M02TrafficInteractionDto;
  } | null>(() => {
    const cached = peekApiCacheEntry<M02TrafficInteractionDto>(apiPath);
    return cached ? { path: apiPath, data: cached.data } : null;
  });
  const data = dataState && dataState.path === apiPath ? dataState.data : null;

  const [knownWebsites, setKnownWebsites] = useState<WebsiteConfigItemDto[]>(
    () => peekApiCacheEntry<M02TrafficInteractionDto>(apiPath)?.data.coverage.availableWebsites || [],
  );
  const [loading, setLoading] = useState<boolean>(
    () => !peekApiCacheEntry<M02TrafficInteractionDto>(apiPath),
  );
  const [refreshing, setRefreshing] = useState(false);
  const [checkedAtIso, setCheckedAtIso] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const nextSig = `${scope.websiteId}|${scope.preset}|${scope.from}|${scope.to}`;
    if (prevScopeSigRef.current !== nextSig) {
      prevScopeSigRef.current = nextSig;
      setPage(1);
      setAdsPage(1);
      setDrawerCampaign(null);
    }
  }, [scope.websiteId, scope.preset, scope.from, scope.to]);

  useEffect(() => {
    const cached = peekApiCacheEntry<M02TrafficInteractionDto>(apiPath);
    if (cached) {
      setDataState({ path: apiPath, data: cached.data });
      if (cached.data.coverage.availableWebsites?.length) {
        setKnownWebsites(cached.data.coverage.availableWebsites);
      }
      setCheckedAtIso(new Date(cached.timestamp).toISOString());
      setLoading(false);
      setRefreshing(false);
    } else {
      // Tuyệt đối không hiển thị dữ liệu phạm vi cũ dưới nhãn website/ngày mới
      setDataState(null);
      setLoading(true);
    }
  }, [apiPath]);

  const loadData = useCallback(
    async (opts?: { manual?: boolean; silent?: boolean; signal?: AbortSignal }) => {
      const requestPath = apiPath;
      const seq = ++reqSeqRef.current;
      if (opts?.manual) setRefreshing(true);
      if (!opts?.silent) setErrorMsg(null);
      try {
        const res = await apiRequest<M02TrafficInteractionDto>(requestPath, {
          signal: opts?.signal,
          skipCache: Boolean(opts?.manual || opts?.silent),
          onRevalidated: (fresh) => {
            if (activePathRef.current !== requestPath) return;
            setDataState({ path: requestPath, data: fresh });
            if (fresh.coverage.availableWebsites?.length) {
              setKnownWebsites(fresh.coverage.availableWebsites);
            }
            setCheckedAtIso(new Date().toISOString());
          },
        });
        if (opts?.signal?.aborted || seq !== reqSeqRef.current || activePathRef.current !== requestPath) {
          return;
        }
        setDataState({ path: requestPath, data: res });
        if (res.coverage.availableWebsites?.length) {
          setKnownWebsites(res.coverage.availableWebsites);
        }
        setCheckedAtIso(new Date().toISOString());
      } catch (err) {
        if (opts?.signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
          return;
        }
        if (seq === reqSeqRef.current && !opts?.silent) {
          setErrorMsg(err instanceof Error ? err.message : UI_VOCABULARY.fallbacks.loadError);
        }
      } finally {
        if (!opts?.signal?.aborted && seq === reqSeqRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [apiPath],
  );

  useEffect(() => {
    if (!hydrated) return;
    if (scope.preset === 'CUSTOM' && (!scope.from || !scope.to)) return;

    const controller = new AbortController();
    const cached = peekApiCacheEntry<M02TrafficInteractionDto>(apiPath);
    if (!cached || !cached.isFresh) {
      void loadData({ silent: Boolean(cached), signal: controller.signal });
    }

    const unsubscribe = subscribeDataSync(
      ['tracking', 'ads', 'leads', 'websites'],
      () => {
        void loadData({ silent: true });
      },
    );

    return () => {
      controller.abort();
      unsubscribe();
    };
  }, [hydrated, apiPath, scope.preset, scope.from, scope.to, loadData]);

  useEffect(() => {
    const isAds =
      activeSection === 'ads_campaigns' ||
      activeSection === 'ads_daily' ||
      activeSection === 'ads_landing_pages' ||
      activeSection === 'ads_search_terms' ||
      activeSection === 'ads_breakdowns';
    saveRouteState('tracking', {
      activeSection,
      businessTab: isAds ? 'ads' : 'traffic',
      trafficSubTab:
        activeSection === 'landing_pages' ||
        activeSection === 'channels' ||
        activeSection === 'actions' ||
        activeSection === 'devices_geo'
          ? activeSection
          : 'landing_pages',
      adsScopeMode,
      page,
      adsPage,
    });
  }, [activeSection, adsScopeMode, page, adsPage]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const scroller = document.getElementById('main-workspace-content');
    if (!scroller) return;
    if (!scrollRestoredRef.current && data) {
      scrollRestoredRef.current = true;
      const saved = loadRouteState<{ scrollTop?: number }>('tracking_scroll');
      if (saved?.scrollTop && saved.scrollTop > 0) {
        requestAnimationFrame(() => {
          scroller.scrollTop = saved.scrollTop ?? 0;
        });
      }
    }
    return () => {
      saveRouteState('tracking_scroll', { scrollTop: scroller.scrollTop });
    };
  }, [data]);

  useEffect(() => {
    const onSearch = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      setSearchTerm(typeof detail === 'string' ? detail.trim().toLowerCase() : '');
    };
    window.addEventListener('tt-global-search', onSearch as EventListener);
    return () => window.removeEventListener('tt-global-search', onSearch as EventListener);
  }, []);

  const m = data?.metrics;
  const ads = data?.ads;
  const adsConnected = ads?.status === 'CONNECTED';
  const adsFallbackText = adsConnected
    ? UI_VOCABULARY.fallbacks.insufficientData
    : UI_VOCABULARY.fallbacks.unconnected;

  const sessionComp = useMemo(() => {
    if (!m) return null;
    return formatSafePeriodComparison(m.sessions, m.previousSessions);
  }, [m]);

  const trafficPoints = data?.charts.trafficSeries || [];
  const channelRows = data?.charts.channelRows || [];
  const lpTable = data?.tables.landingPageRows;
  const lpTotalPages = lpTable ? Math.max(1, Math.ceil(lpTable.totalRows / lpTable.pageSize)) : 1;

  const adsSeries = ads?.series || [];

  const campTable = ads?.campaigns;

  const visibleLandingPageCount = useMemo(
    () =>
      (lpTable?.rows || []).filter(
        (r) => !hideNoiseLp || r.categoryKey !== 'technical_noise',
      ).length,
    [lpTable?.rows, hideNoiseLp],
  );

  const adsBreakdownCount =
    (ads?.breakdowns.adGroups.length || 0) + (ads?.breakdowns.keywords.length || 0);

  const currentSectionMeta = SECTION_META[activeSection];
  const isAdsSection =
    activeSection === 'ads_campaigns' ||
    activeSection === 'ads_daily' ||
    activeSection === 'ads_landing_pages' ||
    activeSection === 'ads_search_terms' ||
    activeSection === 'ads_breakdowns';

  return (
    <div className="space-y-4 text-sm">
      <WebsiteDashboardHeader
        title={UI_VOCABULARY.menu.campaigns}
        scope={scope}
        availableWebsites={data?.coverage.availableWebsites || knownWebsites}
        websiteSelectorStyle="dropdown"
        showCompareToggle={true}
        compareEnabled={compareEnabled}
        onToggleCompare={setCompareEnabled}
        comparisonLabel={sessionComp && sessionComp.pctChange !== null ? sessionComp.label : null}
        freshnessMessage={
          loading && !data
            ? UI_VOCABULARY.freshness.updating
            : refreshing
              ? UI_VOCABULARY.freshness.updating
              : errorMsg
                ? UI_VOCABULARY.fallbacks.loadError
                : data?.freshness.statusMessage
        }
        freshnessDetail={{
          checkedAt: checkedAtIso,
          lastSyncedAt: data?.freshness.lastSyncedAt || data?.freshness.lastSuccessAt || null,
          latestSourceDataAt:
            data?.freshness.latestSourceDataAt ||
            data?.freshness.dataThrough ||
            data?.scope.endDate ||
            null,
        }}
        freshnessTone={
          errorMsg
            ? 'error'
            : refreshing
              ? 'updating'
              : data?.freshness.state === 'PRELIMINARY'
                ? 'warning'
                : 'ok'
        }
        onChangeScope={updateScope}
        actions={
          <>
            <a
              href={`/api/v1/tracking/export?websiteId=${encodeURIComponent(scope.websiteId)}&preset=${encodeURIComponent(scope.preset)}${scope.preset === 'CUSTOM' && scope.from && scope.to
                ? `&from=${encodeURIComponent(scope.from)}&to=${encodeURIComponent(scope.to)}`
                : ''
                }`}
              className="min-h-8 px-3 rounded-[10px] bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
            >
              <Download aria-hidden="true" className="w-3.5 h-3.5" />
              <span>{UI_VOCABULARY.actions.exportExcel}</span>
            </a>
            <button
              type="button"
              onClick={() => void loadData({ manual: true })}
              disabled={refreshing}
              className="min-h-8 px-3.5 rounded-[10px] bg-[#0F275C] hover:bg-[#1E3A8A] text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-60"
            >
              <RefreshCw aria-hidden="true" className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>{UI_VOCABULARY.actions.refresh}</span>
            </button>
          </>
        }
      />

      {briefNotice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800 flex items-center justify-between gap-2">
          <span>{briefNotice}</span>
          <button
            type="button"
            onClick={() => setBriefNotice(null)}
            className="text-emerald-700 hover:text-emerald-950 font-semibold"
          >
            Đóng
          </button>
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="rounded-[12px] border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800 flex items-center justify-between"
        >
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => void loadData({ manual: true })}
            className="font-semibold underline"
          >
            Thử lại
          </button>
        </div>
      )}

      <FunnelAnomalyGuardStrip />

      {user && hasBaPermission(user.roleCode, 'LEAD_VIEW_OWN') && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white border border-slate-200 px-3.5 py-2 text-xs">
          <span className="text-slate-600 font-medium">
            Đối chiếu minh bạch hồ sơ Lead thực tế gắn với Chiến dịch quảng cáo:
          </span>
          <button
            type="button"
            onClick={() => setAuditLineageMetric('ad_attributed_leads')}
            className="h-7 px-3 rounded-lg bg-[#0F275C] hover:bg-[#1E3A8A] text-white text-[11px] font-bold transition"
          >
            🔍 Mở Danh sách Đối chứng Lead Quảng cáo (L3)
          </button>
        </div>
      )}

      {/* Bố cục menu dọc bên trái chuẩn Google Ads + vùng nội dung rộng bên phải */}
      <div className="flex flex-col lg:flex-row items-start gap-4">
        <VerticalSectionNav
          ariaLabel="Điều hướng phân mục Chiến dịch & Truy cập"
          activeId={activeSection}
          onSelect={(id) => {
            if (VALID_TRACKING_SECTIONS.has(id)) {
              setActiveSection(id as TrackingSectionId);
            }
          }}
          topItems={[]}
          groups={[
            {
              id: 'ga4_traffic',
              label: 'Thông tin truy cập (GA4)',
              defaultOpen: true,
              items: [
                {
                  id: 'overview',
                  label: 'Lưu lượng GA4',
                  icon: LayoutDashboard,
                },
                {
                  id: 'landing_pages',
                  label: 'Trang đích',
                  icon: FileText,
                  badge: lpTable ? (lpTable.totalRows > 0 ? lpTable.totalRows : visibleLandingPageCount) : null,
                },
                {
                  id: 'channels',
                  label: 'Hiệu suất kênh',
                  icon: Share2,
                  badge: channelRows.length > 0 ? channelRows.length : null,
                },
                {
                  id: 'actions',
                  label: 'Sự kiện & Click',
                  icon: MousePointerClick,
                  badge: data?.allGa4Events?.length ? data.allGa4Events.length : null,
                },
                {
                  id: 'devices_geo',
                  label: 'Thiết bị & Khu vực',
                  icon: MonitorSmartphone,
                  badge: data?.charts.deviceRows?.length ? data.charts.deviceRows.length : null,
                },
              ],
            },
            {
              id: 'google_ads',
              label: 'Quảng cáo (Google Ads)',
              defaultOpen: true,
              items: [
                {
                  id: 'ads_campaigns',
                  label: 'Tất cả chiến dịch',
                  icon: Megaphone,
                  badge: adsConnected
                    ? campTable?.rows?.length ?? 0
                    : UI_VOCABULARY.fallbacks.unconnected,
                  badgeTone: adsConnected ? 'default' : 'warning',
                },
                {
                  id: 'ads_daily',
                  label: 'Chi phí theo ngày',
                  icon: CalendarDays,
                },
                {
                  id: 'ads_landing_pages',
                  label: 'Trang đích Ads',
                  icon: Link2,
                  badge: ads?.breakdowns.landingPages?.length
                    ? ads.breakdowns.landingPages.length
                    : null,
                },
                {
                  id: 'ads_search_terms',
                  label: 'Cụm từ tìm kiếm',
                  icon: Search,
                  badge: ads?.breakdowns.searchTerms?.length
                    ? ads.breakdowns.searchTerms.length
                    : null,
                },
                {
                  id: 'ads_breakdowns',
                  label: 'Nhóm QC & Từ khóa',
                  icon: Layers,
                  badge: adsBreakdownCount > 0 ? adsBreakdownCount : null,
                },
              ],
            },
          ]}
        />

        <div className="flex-1 min-w-0 w-full space-y-4">
          {/* Thanh tiêu đề phân mục hiện tại + Realtime 30 phút & Tuỳ chọn Event/Click */}
          <div className="bg-white border border-slate-200/90 rounded-2xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900 leading-tight">
                {currentSectionMeta.title}
              </h2>
              <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                {currentSectionMeta.subtitle}
              </p>
            </div>

            {/* Ô phụ bộ đếm 30 phút + Tuỳ chọn Event & Click Realtime/Kỳ (C07 & C10) */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 relative">
              <div className="inline-flex items-center gap-1.5">
                <Activity aria-hidden="true" className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>30 phút qua:</span>
                <strong className="text-slate-900 font-bold tabular-nums">
                  <AnimatedMetricNumber
                    value={m?.activeUsers30m}
                    emptyText={UI_VOCABULARY.fallbacks.insufficientData}
                  />
                </strong>
                <span>user</span>
              </div>

              {(data?.realtimeEvents || [])
                .filter((ev) => selectedEvents.includes(ev.eventName))
                .slice(0, 3)
                .map((ev) => (
                  <span
                    key={`rt-${ev.eventName}`}
                    className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-semibold tabular-nums"
                  >
                    {ev.eventName}: {ev.eventCount}
                  </span>
                ))}

              <button
                type="button"
                onClick={() => setShowRealtimePicker((p) => !p)}
                className="h-7 px-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-[11px] font-semibold text-[#1E3A8A] inline-flex items-center gap-1"
              >
                <SlidersHorizontal className="w-3 h-3" />
                <span>Tuỳ chọn Event &amp; Click</span>
                <ChevronDown className="w-3 h-3 text-slate-400" />
              </button>

              {showRealtimePicker && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowRealtimePicker(false)} />
                  <div className="absolute right-0 top-full mt-1.5 z-40 w-80 rounded-xl border border-slate-200 bg-white shadow-xl p-3 space-y-2 text-xs">
                    <div className="flex items-center justify-between pb-1.5 border-b border-slate-100">
                      <span className="font-bold text-slate-800">Chọn Event &amp; Click hiển thị (30p &amp; Kỳ)</span>
                      <button
                        type="button"
                        onClick={() => setSelectedEvents(DEFAULT_TRACKED_EVENTS)}
                        className="text-[11px] text-[#1E3A8A] hover:underline"
                      >
                        Mặc định
                      </button>
                    </div>
                    <div className="max-h-64 overflow-y-auto space-y-1">
                      {Array.from(
                        new Map(
                          [
                            ...(data?.realtimeEvents || []).map((e) => [
                              e.eventName,
                              { eventName: e.eventName, rt: e.eventCount, period: 0 },
                            ]),
                            ...(data?.allGa4Events || []).map((e) => [
                              e.eventName,
                              { eventName: e.eventName, rt: 0, period: e.eventCount },
                            ]),
                          ].map(([name, item]) => {
                            const prevRt =
                              (data?.realtimeEvents || []).find((x) => x.eventName === name)?.eventCount || 0;
                            const prevPer =
                              (data?.allGa4Events || []).find((x) => x.eventName === name)?.eventCount || 0;
                            return [
                              String(name),
                              {
                                eventName: String(name),
                                rt: prevRt || (item as { rt: number }).rt,
                                period: prevPer || (item as { period: number }).period,
                              },
                            ];
                          }),
                        ).values(),
                      ).map((ev) => {
                        const checked = selectedEvents.includes(ev.eventName);
                        return (
                          <label
                            key={ev.eventName}
                            className="flex items-center justify-between gap-2 py-1 px-2 rounded-md hover:bg-slate-50 cursor-pointer"
                          >
                            <span className="inline-flex items-center gap-2 min-w-0">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  setSelectedEvents((prev) =>
                                    prev.includes(ev.eventName)
                                      ? prev.filter((x) => x !== ev.eventName)
                                      : [...prev, ev.eventName],
                                  )
                                }
                                className="rounded border-slate-300 text-[#1E3A8A]"
                              />
                              <span className="font-mono text-[11px] text-slate-800 truncate">
                                {ev.eventName}
                              </span>
                            </span>
                            <span className="text-[10px] text-slate-500 tabular-nums shrink-0">
                              {ev.rt > 0 ? `30p: ${ev.rt} · ` : ''}Kỳ: {ev.period.toLocaleString('vi-VN')}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* =============================================================== */}
          {/* SECTION 1: TỔNG QUAN TRUY CẬP                                   */}
          {/* =============================================================== */}
          {activeSection === 'overview' && (
            <div className="space-y-4">
              {data?.coverage.note && (
                <div className="rounded-[10px] bg-blue-50/70 border border-blue-200/80 px-3.5 py-2 text-xs text-slate-700">
                  {data.coverage.note}
                </div>
              )}

              {/* 6 KPI Truy cập (~108px) */}
              {loading && !data ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[1, 2, 3, 4, 5, 6].map((k) => (
                    <div
                      key={k}
                      className="min-h-[108px] rounded-[12px] bg-white border border-slate-200/90 p-4 shadow-2xs space-y-2.5 animate-pulse"
                    >
                      <div className="h-3 w-28 rounded bg-slate-200" />
                      <div className="h-7 w-24 rounded bg-slate-200" />
                      <div className="h-3 w-44 rounded bg-slate-100" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {/* Card 1: Ưu tiên User mới từ GA4 để tránh lẫn nhân viên vào đi vào lại */}
                  <div className="min-h-[108px] bg-white border border-emerald-200/90 rounded-[12px] p-4 shadow-2xs flex flex-col justify-between">
                    <span className="text-xs font-semibold text-emerald-800">
                      Người dùng mới (Khách mới)
                    </span>
                    <div className="text-2xl font-bold text-slate-900 mt-1">
                      <AnimatedMetricNumber
                        value={m?.newUsers}
                        emptyText={UI_VOCABULARY.fallbacks.insufficientData}
                      />
                    </div>
                    <span className="text-xs text-slate-500 mt-1">
                      {m?.users !== null && m?.users !== undefined && m?.newUsers !== null && m?.newUsers !== undefined && m.users > 0
                        ? `Tổng user: ${m.users.toLocaleString('vi-VN')} · Tỷ lệ khách mới: ${((m.newUsers / m.users) * 100).toFixed(1)}%`
                        : 'Tách biệt khách truy cập mới khỏi lượt vào lặp của nhân viên'}
                    </span>
                  </div>

                  <div className="min-h-[108px] bg-white border border-slate-200/90 rounded-[12px] p-4 shadow-2xs flex flex-col justify-between">
                    <span className="text-xs font-medium text-slate-600">Phiên truy cập</span>
                    <div className="text-2xl font-bold text-slate-900 mt-1">
                      <AnimatedMetricNumber value={m?.sessions} />
                    </div>
                    <span className="text-xs text-slate-500 mt-1">
                      Phiên có tương tác:{' '}
                      <strong className="text-slate-700 tabular-nums">
                        {m?.engagedSessions !== null && m?.engagedSessions !== undefined
                          ? m.engagedSessions.toLocaleString('vi-VN')
                          : UI_VOCABULARY.fallbacks.insufficientData}
                      </strong>
                    </span>
                  </div>

                  <div className="min-h-[108px] bg-white border border-slate-200/90 rounded-[12px] p-4 shadow-2xs flex flex-col justify-between">
                    <span className="text-xs font-medium text-slate-600">Tỷ lệ tương tác trang đích</span>
                    <div className="text-2xl font-bold text-slate-900 mt-1">
                      <AnimatedMetricNumber
                        value={m?.engagementRatePct}
                        format={(v) => `${v.toFixed(1)}%`}
                      />
                    </div>
                    <span className="text-xs text-slate-500 mt-1">Phiên có tương tác / tổng phiên</span>
                  </div>

                  <div className="min-h-[108px] bg-white border border-slate-200/90 rounded-[12px] p-4 shadow-2xs flex flex-col justify-between">
                    <span className="text-xs font-medium text-slate-600">
                      Thời gian tương tác trung bình
                    </span>
                    <div className="text-2xl font-bold text-slate-900 mt-1">
                      <AnimatedMetricNumber
                        value={m?.averageEngagementSeconds}
                        format={(v) => `${v.toFixed(0)} giây`}
                        emptyText={
                          scope.websiteId === 'all'
                            ? 'Chọn 1 website'
                            : UI_VOCABULARY.fallbacks.insufficientData
                        }
                      />
                    </div>
                    <span className="text-xs text-slate-500 mt-1">
                      Thời lượng tương tác trung bình trên mỗi người dùng
                    </span>
                  </div>

                  <div className="min-h-[108px] bg-white border border-slate-200/90 rounded-[12px] p-4 shadow-2xs flex flex-col justify-between">
                    <span className="text-xs font-medium text-slate-600">Yêu cầu biểu mẫu &amp; Lead Web</span>
                    <div className="text-2xl font-bold text-[#0F275C] mt-1">
                      <AnimatedMetricNumber
                        value={
                          m?.formEventCount !== null && m?.formEventCount !== undefined
                            ? m.formEventCount
                            : m?.validFormLeadCount
                        }
                      />
                    </div>
                    <span className="text-xs text-slate-500 mt-1">
                      {m?.formEventCount !== null && m?.formEventCount !== undefined
                        ? `Sự kiện form GA4 · Đối soát CRM: ${m.validFormLeadCount} Lead hợp lệ`
                        : `CRM ghi nhận ${m?.validFormLeadCount ?? 0} Lead form hợp lệ`}
                    </span>
                  </div>

                  <div className="min-h-[108px] bg-slate-50/70 border border-slate-200/80 rounded-[12px] p-4 flex flex-col justify-between">
                    <span className="text-xs font-medium text-slate-500">
                      Lượt xem trang
                    </span>
                    <div className="text-xl font-bold text-slate-700 mt-1">
                      <AnimatedMetricNumber value={m?.pageViews} />
                    </div>
                    <span className="text-[11px] text-slate-500 mt-1">
                      Chỉ số tham khảo phụ
                    </span>
                  </div>
                </div>
              )}

              {/* Biểu đồ Marketing Spline 8/12 + Cơ cấu Kênh thu hút 4/12 */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                <section
                  aria-labelledby="m02-traffic-chart-heading"
                  className="lg:col-span-8 bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs flex flex-col gap-3"
                >
                  <div>
                    <h3 id="m02-traffic-chart-heading" className="text-sm sm:text-base font-bold text-slate-900">
                      Lưu lượng truy cập theo ngày
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Phiên truy cập, lượt xem và người dùng mới theo ngày
                    </p>
                  </div>

                  <MarketingTrafficChart
                    points={trafficPoints}
                    previousPoints={data?.charts.previousTrafficSeries}
                    compareEnabled={compareEnabled}
                    loading={loading && !data}
                  />
                </section>

                <section
                  aria-labelledby="m02-top-channels-heading"
                  className="lg:col-span-4 bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs flex flex-col"
                >
                  <div>
                    <h3 id="m02-top-channels-heading" className="text-sm sm:text-base font-bold text-slate-900">
                      Cơ cấu Kênh Marketing &amp; Thu hút Lead
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5 mb-3">
                      Tỷ trọng đóng góp phiên, tỷ lệ tương tác và số Lead hợp lệ theo từng nguồn
                    </p>
                    <MarketingChannelMixCard channels={channelRows} />
                  </div>
                </section>
              </div>

              {/* 2 Thẻ chuyển nhanh sang Trang đích & Tất cả chiến dịch Ads */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setActiveSection('landing_pages')}
                  className="text-left rounded-2xl bg-white border border-slate-200/90 hover:border-[#1A73E8]/50 p-4 shadow-2xs transition flex items-center justify-between gap-3 group"
                >
                  <div>
                    <div className="text-xs font-bold text-slate-900 group-hover:text-[#1A73E8]">
                      Xem bảng Trang đích theo User mới
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Phân loại nhóm trang sản phẩm, dự án, tin tức và lọc bỏ trang nội bộ
                    </p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-[#1A73E8] shrink-0" />
                </button>

                <button
                  type="button"
                  onClick={() => setActiveSection('ads_campaigns')}
                  className="text-left rounded-2xl bg-white border border-slate-200/90 hover:border-[#1A73E8]/50 p-4 shadow-2xs transition flex items-center justify-between gap-3 group"
                >
                  <div>
                    <div className="text-xs font-bold text-slate-900 group-hover:text-[#1A73E8]">
                      Mở Tất cả chiến dịch Google Ads &amp; Chia ô Excel
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Gom toàn bộ chiến dịch đang chạy kèm Link đích, chi phí ngày và đối soát CRM
                    </p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-[#1A73E8] shrink-0" />
                </button>
              </div>
            </div>
          )}

          {/* =============================================================== */}
          {/* SECTION 2: TRANG ĐÍCH (USER MỚI & PHÂN LOẠI)                    */}
          {/* =============================================================== */}
          {activeSection === 'landing_pages' && (
            <div className="space-y-4">
              {data?.coverage.note && (
                <div className="rounded-[10px] bg-blue-50/70 border border-blue-200/80 px-3.5 py-2 text-xs text-slate-700">
                  {data.coverage.note}
                </div>
              )}

              <section className="bg-white border border-slate-200/90 rounded-[12px] shadow-2xs overflow-hidden">
                {/* Bộ lọc phân loại trang đích + Ẩn trang kỹ thuật/nhân viên */}
                <div className="px-4 py-2.5 bg-slate-50/70 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setLpCategoryFilter('all')}
                      className={`px-2.5 py-1 rounded-lg font-semibold transition ${
                        lpCategoryFilter === 'all'
                          ? 'bg-[#1A73E8] text-white'
                          : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      Tất cả ({visibleLandingPageCount})
                    </button>
                    {(data?.tables.landingPageCategories || [])
                      .filter((cat) => !hideNoiseLp || cat.categoryKey !== 'technical_noise')
                      .map((cat) => (
                        <button
                          key={cat.categoryKey}
                          type="button"
                          onClick={() => setLpCategoryFilter(cat.categoryKey)}
                          className={`px-2.5 py-1 rounded-lg font-semibold transition inline-flex items-center gap-1.5 ${
                            lpCategoryFilter === cat.categoryKey
                              ? 'bg-[#1A73E8] text-white'
                              : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          <span>{cat.categoryLabel}</span>
                          <span
                            className={`tabular-nums text-[10px] px-1 rounded ${
                              lpCategoryFilter === cat.categoryKey ? 'bg-white/20 text-white' : 'bg-emerald-50 text-emerald-700'
                            }`}
                          >
                            {cat.newUsers !== null ? `${cat.newUsers} mới` : `${cat.sessions} phiên`}
                          </span>
                        </button>
                      ))}
                  </div>

                  <label className="inline-flex items-center gap-1.5 text-slate-600 font-medium cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={hideNoiseLp}
                      onChange={(e) => setHideNoiseLp(e.target.checked)}
                      className="rounded border-slate-300 text-[#1E3A8A]"
                    />
                    <span>Ẩn trang kỹ thuật / (not set)</span>
                  </label>
                </div>

                <MktSpreadsheetCalcBar
                  title="Bảng Trang đích GA4"
                  excelMode={ga4ExcelCalc.excelMode}
                  onToggleExcelMode={ga4ExcelCalc.toggleExcelMode}
                  stats={ga4ExcelCalc.stats}
                  onClear={ga4ExcelCalc.clearSelection}
                />

                <div tabIndex={0} role="region" aria-label="Bảng trang đích theo user mới" className="overflow-x-auto max-h-[68vh]">
                  <table className="w-full text-left border-separate border-spacing-0 text-xs [&_td]:border-r [&_td]:border-b [&_td]:border-slate-200/80 [&_th]:border-r [&_th]:border-b [&_th]:border-slate-200">
                    <thead className="bg-slate-100 text-slate-700 border-b border-slate-200 sticky top-0 z-10">
                      <tr className="bg-slate-200/75 text-[10px] font-mono font-bold text-slate-500 select-none">
                        {['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((l) => (
                          <th key={`lp-col-${l}`} scope="col" className="py-1 px-2 text-center">{l}</th>
                        ))}
                      </tr>
                      <tr>
                        <th scope="col" className="py-2.5 px-4 font-semibold">Trang đích (Landing Page)</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold">Phân loại</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold text-right">User mới</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold text-right">Tỷ lệ khách mới</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold text-right">Phiên truy cập</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold text-right">Tỷ lệ tương tác</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold text-right">Sự kiện biểu mẫu</th>
                        <th scope="col" className="py-2.5 px-4 font-semibold text-right">Lead CRM hợp lệ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(() => {
                        const filteredLp = (lpTable?.rows || []).filter((row) => {
                          if (hideNoiseLp && row.categoryKey === 'technical_noise') return false;
                          if (lpCategoryFilter !== 'all' && row.categoryKey !== lpCategoryFilter) return false;
                          if (searchTerm && !row.landingPage.toLowerCase().includes(searchTerm)) return false;
                          return true;
                        });
                        if (filteredLp.length === 0) {
                          return (
                            <tr>
                              <td colSpan={8} className="py-8 text-center text-slate-500">
                                Chưa có dữ liệu trang đích phù hợp trong kỳ đang chọn.
                              </td>
                            </tr>
                          );
                        }
                        return filteredLp.map((row) => (
                          <tr key={row.landingPage} className="odd:bg-white even:bg-slate-50/40 hover:bg-blue-50/30">
                            <th
                              scope="row"
                              className="py-2.5 px-4 font-mono font-medium text-slate-800 max-w-[380px] break-words"
                            >
                              {row.landingPage}
                            </th>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[11px] font-medium">
                                {row.categoryLabel || 'Trang khác'}
                              </span>
                            </td>
                            <td
                              onClick={() => ga4ExcelCalc.toggleCell(`lp:${row.landingPage}:nu`, 'User mới', row.newUsers)}
                              className={`py-2.5 px-3 text-right font-bold text-emerald-700 tabular-nums ${ga4ExcelCalc.cellClass(`lp:${row.landingPage}:nu`)}`}
                            >
                              {row.newUsers !== null && row.newUsers !== undefined
                                ? row.newUsers.toLocaleString('vi-VN')
                                : '—'}
                            </td>
                            <td
                              onClick={() => ga4ExcelCalc.toggleCell(`lp:${row.landingPage}:nur`, 'Tỷ lệ khách mới', row.newUserRatePct)}
                              className={`py-2.5 px-3 text-right text-slate-600 tabular-nums ${ga4ExcelCalc.cellClass(`lp:${row.landingPage}:nur`)}`}
                            >
                              {row.newUserRatePct !== null && row.newUserRatePct !== undefined
                                ? `${row.newUserRatePct}%`
                                : '—'}
                            </td>
                            <td
                              onClick={() => ga4ExcelCalc.toggleCell(`lp:${row.landingPage}:sess`, 'Phiên', row.sessions)}
                              className={`py-2.5 px-3 text-right font-semibold tabular-nums ${ga4ExcelCalc.cellClass(`lp:${row.landingPage}:sess`)}`}
                            >
                              {row.sessions.toLocaleString('vi-VN')}
                            </td>
                            <td
                              onClick={() => ga4ExcelCalc.toggleCell(`lp:${row.landingPage}:eng`, 'Tỷ lệ tương tác', row.engagementRatePct)}
                              className={`py-2.5 px-3 text-right text-slate-600 tabular-nums ${ga4ExcelCalc.cellClass(`lp:${row.landingPage}:eng`)}`}
                            >
                              {row.engagementRatePct !== null ? `${row.engagementRatePct}%` : '—'}
                            </td>
                            <td
                              onClick={() => ga4ExcelCalc.toggleCell(`lp:${row.landingPage}:form`, 'Sự kiện form', row.successfulFormCount)}
                              className={`py-2.5 px-3 text-right text-slate-600 tabular-nums ${ga4ExcelCalc.cellClass(`lp:${row.landingPage}:form`)}`}
                            >
                              {row.successfulFormCount !== null
                                ? row.successfulFormCount.toLocaleString('vi-VN')
                                : '—'}
                            </td>
                            <td
                              onClick={() => ga4ExcelCalc.toggleCell(`lp:${row.landingPage}:lead`, 'Lead CRM', row.validLeadCount)}
                              className={`py-2.5 px-4 text-right font-bold text-[#0F275C] tabular-nums ${ga4ExcelCalc.cellClass(`lp:${row.landingPage}:lead`)}`}
                            >
                              {row.validLeadCount}
                            </td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                    {(() => {
                      const filteredLp = (lpTable?.rows || []).filter((row) => {
                        if (hideNoiseLp && row.categoryKey === 'technical_noise') return false;
                        if (lpCategoryFilter !== 'all' && row.categoryKey !== lpCategoryFilter) return false;
                        if (searchTerm && !row.landingPage.toLowerCase().includes(searchTerm)) return false;
                        return true;
                      });
                      if (filteredLp.length === 0) return null;
                      const sumNu = filteredLp.reduce((s, r) => s + (r.newUsers || 0), 0);
                      const sumSess = filteredLp.reduce((s, r) => s + (r.sessions || 0), 0);
                      const sumForm = filteredLp.reduce((s, r) => s + (r.successfulFormCount || 0), 0);
                      const sumLead = filteredLp.reduce((s, r) => s + (r.validLeadCount || 0), 0);
                      return (
                        <tfoot className="bg-blue-50/90 border-t-2 border-[#1E3A8A]/40 font-bold text-[#0F275C] sticky bottom-0">
                          <tr>
                            <td className="py-2.5 px-4">Σ TỔNG ({filteredLp.length} trang đích)</td>
                            <td className="py-2.5 px-3 text-slate-400 font-normal">—</td>
                            <td className="py-2.5 px-3 text-right tabular-nums">{sumNu.toLocaleString('vi-VN')}</td>
                            <td className="py-2.5 px-3 text-right tabular-nums">—</td>
                            <td className="py-2.5 px-3 text-right tabular-nums">{sumSess.toLocaleString('vi-VN')}</td>
                            <td className="py-2.5 px-3 text-right tabular-nums">—</td>
                            <td className="py-2.5 px-3 text-right tabular-nums">{sumForm.toLocaleString('vi-VN')}</td>
                            <td className="py-2.5 px-4 text-right tabular-nums">{sumLead.toLocaleString('vi-VN')}</td>
                          </tr>
                        </tfoot>
                      );
                    })()}
                  </table>
                </div>

                {lpTotalPages > 1 && (
                  <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
                    <span>
                      Trang <strong className="tabular-nums">{page}</strong> /{' '}
                      <strong className="tabular-nums">{lpTotalPages}</strong> ({lpTable?.totalRows || 0}{' '}
                      trang)
                    </span>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        className="min-h-8 px-3 rounded-lg border border-slate-200 bg-white disabled:opacity-40 font-semibold"
                      >
                        Trang trước
                      </button>
                      <button
                        type="button"
                        disabled={page >= lpTotalPages}
                        onClick={() => setPage((p) => Math.min(lpTotalPages, p + 1))}
                        className="min-h-8 px-3 rounded-lg border border-slate-200 bg-white disabled:opacity-40 font-semibold"
                      >
                        Trang sau
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}

          {/* =============================================================== */}
          {/* SECTION 3: HIỆU SUẤT KÊNH                                       */}
          {/* =============================================================== */}
          {activeSection === 'channels' && (
            <div className="space-y-4">
              {channelRows.length > 0 && (
                <section className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs">
                  <MarketingChannelMixCard channels={channelRows} />
                </section>
              )}

              <section className="bg-white border border-slate-200/90 rounded-[12px] shadow-2xs overflow-hidden">
                <MktSpreadsheetCalcBar
                  title="Bảng Hiệu suất kênh GA4"
                  excelMode={ga4ExcelCalc.excelMode}
                  onToggleExcelMode={ga4ExcelCalc.toggleExcelMode}
                  stats={ga4ExcelCalc.stats}
                  onClear={ga4ExcelCalc.clearSelection}
                />
                <div tabIndex={0} role="region" aria-label="Bảng theo kênh" className="overflow-x-auto">
                  <table className="w-full text-left border-separate border-spacing-0 text-xs [&_td]:border-r [&_td]:border-b [&_td]:border-slate-200/80 [&_th]:border-r [&_th]:border-b [&_th]:border-slate-200">
                    <thead className="bg-slate-100 text-slate-700 border-b border-slate-200 sticky top-0">
                      <tr className="bg-slate-200/75 text-[10px] font-mono font-bold text-slate-500 select-none">
                        {['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((l) => (
                          <th key={`ch-col-${l}`} scope="col" className="py-1 px-2 text-center">{l}</th>
                        ))}
                      </tr>
                      <tr>
                        <th scope="col" className="py-2.5 px-4 font-semibold">Kênh marketing</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold">Nguồn / phương thức</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold text-right">Phiên truy cập</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold text-right">Phiên có tương tác</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold text-right">Tỷ lệ tương tác</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold text-right">Sự kiện biểu mẫu</th>
                        <th scope="col" className="py-2.5 px-4 font-semibold text-right">Lead CRM hợp lệ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {channelRows.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-slate-500">
                            Chưa có dữ liệu kênh trong kỳ đang chọn.
                          </td>
                        </tr>
                      ) : (
                        channelRows
                          .filter(
                            (r) => !searchTerm || r.channelLabel.toLowerCase().includes(searchTerm),
                          )
                          .map((r) => (
                            <tr key={r.channelKey} className="odd:bg-white even:bg-slate-50/40 hover:bg-blue-50/30">
                              <th scope="row" className="py-3 px-4 font-semibold text-slate-900">
                                {r.channelLabel}
                              </th>
                              <td className="py-3 px-3 text-slate-600">
                                {r.source || '—'} / {r.medium || '—'}
                              </td>
                              <td
                                onClick={() => ga4ExcelCalc.toggleCell(`ch:${r.channelKey}:sess`, 'Phiên', r.sessions)}
                                className={`py-3 px-3 text-right font-semibold tabular-nums ${ga4ExcelCalc.cellClass(`ch:${r.channelKey}:sess`)}`}
                              >
                                {r.sessions.toLocaleString('vi-VN')}
                              </td>
                              <td
                                onClick={() => ga4ExcelCalc.toggleCell(`ch:${r.channelKey}:engS`, 'Phiên tương tác', r.engagedSessions)}
                                className={`py-3 px-3 text-right text-slate-600 tabular-nums ${ga4ExcelCalc.cellClass(`ch:${r.channelKey}:engS`)}`}
                              >
                                {r.engagedSessions !== null
                                  ? r.engagedSessions.toLocaleString('vi-VN')
                                  : '—'}
                              </td>
                              <td
                                onClick={() => ga4ExcelCalc.toggleCell(`ch:${r.channelKey}:engR`, 'Tỷ lệ tương tác', r.engagementRatePct)}
                                className={`py-3 px-3 text-right text-slate-600 tabular-nums ${ga4ExcelCalc.cellClass(`ch:${r.channelKey}:engR`)}`}
                              >
                                {r.engagementRatePct !== null ? `${r.engagementRatePct}%` : '—'}
                              </td>
                              <td
                                onClick={() => ga4ExcelCalc.toggleCell(`ch:${r.channelKey}:form`, 'Sự kiện form', r.formEvents)}
                                className={`py-3 px-3 text-right text-slate-600 tabular-nums ${ga4ExcelCalc.cellClass(`ch:${r.channelKey}:form`)}`}
                              >
                                {r.formEvents !== null && r.formEvents !== undefined
                                  ? r.formEvents.toLocaleString('vi-VN')
                                  : '—'}
                              </td>
                              <td
                                onClick={() => ga4ExcelCalc.toggleCell(`ch:${r.channelKey}:lead`, 'Lead CRM', r.validLeadCount)}
                                className={`py-3 px-4 text-right font-bold text-[#0F275C] tabular-nums ${ga4ExcelCalc.cellClass(`ch:${r.channelKey}:lead`)}`}
                              >
                                {r.validLeadCount}
                              </td>
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {(data?.charts.sourceMediumRows?.length || 0) > 0 && (
                <section className="bg-white border border-slate-200/90 rounded-[12px] shadow-2xs overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200">
                    <h3 className="text-sm font-bold text-slate-900">
                      Chi tiết nguồn truy cập
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Phân tích theo cặp nguồn và phương thức truy cập
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                        <tr>
                          <th scope="col" className="py-2.5 px-4 font-semibold">Nguồn / Phương thức</th>
                          <th scope="col" className="py-2.5 px-3 font-semibold text-right">User mới</th>
                          <th scope="col" className="py-2.5 px-3 font-semibold text-right">Phiên</th>
                          <th scope="col" className="py-2.5 px-3 font-semibold text-right">Phiên tương tác</th>
                          <th scope="col" className="py-2.5 px-4 font-semibold text-right">Tỷ lệ tương tác</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(data?.charts.sourceMediumRows || [])
                          .filter(
                            (sm) => !searchTerm || sm.sourceMedium.toLowerCase().includes(searchTerm),
                          )
                          .map((sm) => (
                            <tr key={sm.sourceMedium} className="hover:bg-slate-50/70">
                              <th scope="row" className="py-2.5 px-4 font-mono font-semibold text-slate-900">
                                {sm.sourceMedium}
                              </th>
                              <td className="py-2.5 px-3 text-right font-semibold text-emerald-700 tabular-nums">
                                {sm.newUsers.toLocaleString('vi-VN')}
                              </td>
                              <td className="py-2.5 px-3 text-right font-semibold tabular-nums">
                                {sm.sessions.toLocaleString('vi-VN')}
                              </td>
                              <td className="py-2.5 px-3 text-right text-slate-600 tabular-nums">
                                {sm.engagedSessions.toLocaleString('vi-VN')}
                              </td>
                              <td className="py-2.5 px-4 text-right text-slate-600 tabular-nums">
                                {sm.engagementRatePct !== null ? `${sm.engagementRatePct}%` : '—'}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </div>
          )}

          {/* =============================================================== */}
          {/* SECTION 4: SỰ KIỆN & CLICK (REALTIME 30P & TRONG KỲ)            */}
          {/* =============================================================== */}
          {activeSection === 'actions' && (
            <div className="space-y-4">
              <Ga4RealtimeBarCard
                activeUsers30m={m?.activeUsers30m ?? null}
                minutesSeries={data?.realtimeMinutesSeries || []}
                activePages={data?.realtimeActivePages || []}
                realtimeEvents={data?.realtimeEvents || []}
                checkedAt={m?.activeWindowCheckedAt || checkedAtIso}
              />

              <section className="bg-white border border-slate-200/90 rounded-[12px] shadow-2xs overflow-hidden space-y-4">
                <div tabIndex={0} role="region" aria-label="Bảng hành động tương tác" className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 sticky top-0">
                      <tr>
                        <th scope="col" className="py-2.5 px-4 font-semibold">Hành động</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold">Tên sự kiện</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold text-right">Số lượt</th>
                        <th scope="col" className="py-2.5 px-4 font-semibold">Mô tả</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(data?.tables.interactionRows || []).map((row) => (
                        <tr key={row.actionKey} className="hover:bg-slate-50/70">
                          <th scope="row" className="py-3 px-4 font-semibold text-slate-900">
                            {row.actionLabel}
                          </th>
                          <td className="py-3 px-3 font-mono text-slate-600">
                            {row.mappedEventName || 'Chưa cài đặt'}
                          </td>
                          <td className="py-3 px-3 text-right font-semibold tabular-nums">
                            {row.count !== null ? (
                              row.count.toLocaleString('vi-VN')
                            ) : (
                              <span className="text-amber-700 font-medium">Chưa đo</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-slate-600">{row.meaning}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="border-t border-slate-200 pt-3 px-4 pb-4 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div>
                      <strong className="text-slate-900">
                        Sự kiện &amp; Lượt nhấp
                      </strong>
                      <p className="text-[11px] text-slate-500">
                        Chọn sự kiện cần ghim theo dõi nhanh 30 phút qua
                      </p>
                    </div>
                    <label className="inline-flex items-center gap-1.5 text-slate-700 font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showOnlySelectedEvents}
                        onChange={(e) => setShowOnlySelectedEvents(e.target.checked)}
                        className="rounded border-slate-300 text-[#1E3A8A]"
                      />
                      <span>Chỉ xem đã chọn ({selectedEvents.length})</span>
                    </label>
                  </div>

                  <div className="overflow-x-auto border border-slate-200 rounded-xl">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                        <tr>
                          <th className="py-2 px-3 w-10">Ghim</th>
                          <th className="py-2 px-3 font-semibold">Tên sự kiện</th>
                          <th className="py-2 px-3 font-semibold text-right">30 phút qua</th>
                          <th className="py-2 px-3 font-semibold text-right">Trong kỳ</th>
                          <th className="py-2 px-3 font-semibold text-right">Người dùng</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(data?.allGa4Events || [])
                          .filter((ev) => !showOnlySelectedEvents || selectedEvents.includes(ev.eventName))
                          .filter((ev) => !searchTerm || ev.eventName.toLowerCase().includes(searchTerm))
                          .map((ev) => {
                            const rtCount =
                              (data?.realtimeEvents || []).find((r) => r.eventName === ev.eventName)?.eventCount || 0;
                            const checked = selectedEvents.includes(ev.eventName);
                            return (
                              <tr key={ev.eventName} className="hover:bg-slate-50/70">
                                <td className="py-2 px-3 text-center">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() =>
                                      setSelectedEvents((prev) =>
                                        prev.includes(ev.eventName)
                                          ? prev.filter((x) => x !== ev.eventName)
                                          : [...prev, ev.eventName],
                                      )
                                    }
                                    className="rounded border-slate-300 text-[#1E3A8A]"
                                  />
                                </td>
                                <td className="py-2 px-3 font-mono font-semibold text-slate-800">
                                  {ev.eventName}
                                </td>
                                <td className="py-2 px-3 text-right tabular-nums">
                                  {rtCount > 0 ? (
                                    <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold">
                                      {rtCount}
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">0</span>
                                  )}
                                </td>
                                <td className="py-2 px-3 text-right font-semibold tabular-nums">
                                  {ev.eventCount.toLocaleString('vi-VN')}
                                </td>
                                <td className="py-2 px-3 text-right text-slate-600 tabular-nums">
                                  {ev.totalUsers !== null && ev.totalUsers !== undefined
                                    ? ev.totalUsers.toLocaleString('vi-VN')
                                    : '—'}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* =============================================================== */}
          {/* SECTION 4B: THIẾT BỊ & KHU VỰC                                  */}
          {/* =============================================================== */}
          {activeSection === 'devices_geo' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <section className="bg-white border border-slate-200/90 rounded-[12px] p-4 shadow-2xs space-y-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Thiết bị truy cập
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Phân bổ phiên theo thiết bị
                  </p>
                </div>
                {(() => {
                  const devRows = data?.charts.deviceRows || [];
                  const totalDev = devRows.reduce((acc, r) => acc + r.sessions, 0) || 1;
                  if (devRows.length === 0) {
                    return (
                      <div className="py-8 text-center text-xs text-slate-400">
                        Chưa có dữ liệu thiết bị trong kỳ đang chọn.
                      </div>
                    );
                  }
                  return (
                    <div className="space-y-2.5">
                      {devRows.map((d) => {
                        const pct = Math.round((d.sessions / totalDev) * 100);
                        return (
                          <div key={d.deviceCategory} className="space-y-1 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-slate-800 capitalize">
                                {d.deviceCategory || 'Không xác định'}
                              </span>
                              <span className="tabular-nums text-slate-600">
                                <strong className="text-slate-900">{d.sessions.toLocaleString('vi-VN')}</strong>{' '}
                                phiên ({pct}%)
                              </span>
                            </div>
                            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-[#1A73E8]"
                                style={{ width: `${Math.max(4, pct)}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </section>

              <section className="bg-white border border-slate-200/90 rounded-[12px] shadow-2xs overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200">
                  <h3 className="text-sm font-bold text-slate-900">
                    Khu vực địa lý
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Tỉnh, thành phố có lượng truy cập cao nhất
                  </p>
                </div>
                <div className="overflow-x-auto max-h-[360px]">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 sticky top-0">
                      <tr>
                        <th scope="col" className="py-2.5 px-4 font-semibold">Tỉnh / Thành phố</th>
                        <th scope="col" className="py-2.5 px-4 font-semibold text-right">Phiên truy cập</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(data?.charts.geoRows || []).length === 0 ? (
                        <tr>
                          <td colSpan={2} className="py-8 text-center text-slate-400">
                            Chưa có dữ liệu địa lý trong kỳ đang chọn.
                          </td>
                        </tr>
                      ) : (
                        (data?.charts.geoRows || [])
                          .filter(
                            (g) => !searchTerm || g.locationLabel.toLowerCase().includes(searchTerm),
                          )
                          .map((g) => (
                            <tr key={g.locationLabel} className="hover:bg-slate-50/70">
                              <th scope="row" className="py-2.5 px-4 font-medium text-slate-900">
                                {g.locationLabel}
                              </th>
                              <td className="py-2.5 px-4 text-right font-semibold tabular-nums">
                                {g.sessions.toLocaleString('vi-VN')}
                              </td>
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}

          {/* =============================================================== */}
          {/* SECTION 5: TẤT CẢ CHIẾN DỊCH GOOGLE ADS (SUMMARY MODE)          */}
          {/* =============================================================== */}
          {activeSection === 'ads_campaigns' && (
            <div className="space-y-4">
              {ads && (
                <div
                  className={`rounded-[12px] border px-4 py-3 text-xs flex flex-wrap items-center justify-between gap-2 ${ads.status === 'CONNECTED'
                    ? 'bg-blue-50/70 border-blue-200 text-slate-800'
                    : 'bg-amber-50/80 border-amber-200 text-amber-900'
                    }`}
                >
                  <div className="flex items-start gap-2">
                    <AlertCircle aria-hidden="true" className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">{ads.statusMessage}</p>
                      <p className="mt-0.5 text-slate-600">{ads.metrics.reconciliationNote}</p>
                    </div>
                  </div>
                  <Link
                    href="/settings"
                    className="inline-flex items-center gap-1 font-semibold text-[#1E3A8A] hover:underline shrink-0"
                  >
                    <span>Kiểm tra kết nối</span>
                    <ExternalLink aria-hidden="true" className="w-3.5 h-3.5" />
                  </Link>
                </div>
              )}

              {/* 6 KPI Quảng cáo (~108px) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="min-h-[108px] bg-white border border-slate-200/90 rounded-[12px] p-4 shadow-2xs flex flex-col justify-between">
                  <span className="text-xs font-medium text-slate-600">Chi phí quảng cáo</span>
                  <div className="text-2xl font-bold text-slate-900 mt-1">
                    <AnimatedMetricNumber
                      value={ads?.metrics.cost}
                      format={(v) => `${Math.round(v).toLocaleString('vi-VN')} ₫`}
                      emptyText={adsFallbackText}
                    />
                  </div>
                  <span className="text-xs text-slate-500 mt-1">
                    Đơn vị {ads?.currencyCode || 'VND'}
                  </span>
                </div>

                <div className="min-h-[108px] bg-white border border-slate-200/90 rounded-[12px] p-4 shadow-2xs flex flex-col justify-between">
                  <span className="text-xs font-medium text-slate-600">Hiển thị</span>
                  <div className="text-2xl font-bold text-slate-900 mt-1">
                    <AnimatedMetricNumber
                      value={ads?.metrics.impressions}
                      emptyText={adsFallbackText}
                    />
                  </div>
                  <span className="text-xs text-slate-500 mt-1">Lượt hiển thị</span>
                </div>

                <div className="min-h-[108px] bg-white border border-slate-200/90 rounded-[12px] p-4 shadow-2xs flex flex-col justify-between">
                  <span className="text-xs font-medium text-slate-600">Click</span>
                  <div className="text-2xl font-bold text-slate-900 mt-1">
                    <AnimatedMetricNumber value={ads?.metrics.clicks} emptyText={adsFallbackText} />
                  </div>
                  <span className="text-xs text-slate-500 mt-1">
                    CPC trung bình:{' '}
                    <strong className="text-slate-700 tabular-nums">
                      {ads?.metrics.avgCpc !== null && ads?.metrics.avgCpc !== undefined
                        ? `${ads.metrics.avgCpc.toLocaleString('vi-VN')} ₫`
                        : adsFallbackText}
                    </strong>
                  </span>
                </div>

                <div className="min-h-[108px] bg-white border border-slate-200/90 rounded-[12px] p-4 shadow-2xs flex flex-col justify-between">
                  <span className="text-xs font-medium text-slate-600">CTR</span>
                  <div className="text-2xl font-bold text-slate-900 mt-1">
                    <AnimatedMetricNumber
                      value={ads?.metrics.ctrPct}
                      format={(v) => `${v.toFixed(2)}%`}
                      emptyText={adsFallbackText}
                    />
                  </div>
                  <span className="text-xs text-slate-500 mt-1">Lượt nhấp / Hiển thị</span>
                </div>

                <div className="min-h-[108px] bg-white border border-slate-200/90 rounded-[12px] p-4 shadow-2xs flex flex-col justify-between">
                  <span className="text-xs font-medium text-slate-600">Chuyển đổi quảng cáo</span>
                  <div className="text-2xl font-bold text-slate-900 mt-1">
                    <AnimatedMetricNumber
                      value={ads?.metrics.conversions}
                      format={(v) =>
                        Number.isInteger(v) ? v.toLocaleString('vi-VN') : v.toFixed(2)
                      }
                      emptyText={adsFallbackText}
                    />
                  </div>
                  <span className="text-xs text-slate-500 mt-1">
                    Ghi nhận từ Google Ads
                  </span>
                </div>

                <div className="min-h-[108px] bg-white border border-slate-200/90 rounded-[12px] p-4 shadow-2xs flex flex-col justify-between">
                  <span className="text-xs font-medium text-slate-600">Chi phí / chuyển đổi</span>
                  <div className="text-2xl font-bold text-slate-900 mt-1">
                    <AnimatedMetricNumber
                      value={ads?.metrics.costPerConversion}
                      format={(v) => `${Math.round(v).toLocaleString('vi-VN')} ₫`}
                      emptyText={adsFallbackText}
                    />
                  </div>
                  <span className="text-xs text-slate-500 mt-1">
                    CPL hợp lệ:{' '}
                    <strong className="text-[#0F275C] tabular-nums">
                      {ads?.metrics.costPerValidLead !== null &&
                        ads?.metrics.costPerValidLead !== undefined
                        ? `${ads.metrics.costPerValidLead.toLocaleString('vi-VN')} ₫`
                        : UI_VOCABULARY.fallbacks.insufficientData}
                    </strong>
                  </span>
                </div>
              </div>

              {/* Đối soát CRM */}
              <div className="rounded-[12px] bg-white border border-slate-200/90 p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex flex-wrap items-center gap-4">
                  <span>
                    Lead từ quảng cáo:{' '}
                    <strong className="text-slate-900 tabular-nums">
                      {ads?.metrics.attributedLeadCount ?? 0}
                    </strong>
                  </span>
                  <span>
                    Lead quảng cáo hợp lệ:{' '}
                    <strong className="text-[#0F275C] tabular-nums">
                      {ads?.metrics.validAttributedLeadCount ?? 0}
                    </strong>
                  </span>
                  <span>
                    Chốt từ quảng cáo:{' '}
                    <strong className="text-emerald-700 tabular-nums">
                      {ads?.metrics.wonAttributedLeadCount ?? 0}
                    </strong>
                  </span>
                </div>
                <Link
                  href={`/leads?websiteId=${encodeURIComponent(scope.websiteId)}`}
                  className="text-[#1E3A8A] font-semibold hover:underline"
                >
                  Xem danh sách Lead →
                </Link>
              </div>

              {/* Biểu đồ 2 chỉ số chuẩn Google Ads */}
              <GoogleAdsDualMetricChart
                series={adsSeries}
                previousSeries={ads?.previousSeries}
                compareEnabled={compareEnabled}
                adsConnected={adsConnected}
                loading={loading && !data}
              />

              <AdsExcelTableSection
                campaigns={campTable?.rows || []}
                adsConnected={adsConnected}
                scopeWebsiteId={scope.websiteId || 'all'}
                scopeDateLabel={data ? `${data.scope.startDate} → ${data.scope.endDate}` : scope.preset}
                adsScopeMode={adsScopeMode}
                onChangeAdsScopeMode={(mode) => {
                  setAdsScopeMode(mode);
                  setAdsPage(1);
                }}
                searchTerm={searchTerm}
                canDirectDesign={canDirectDesign}
                briefSubmittingId={briefSubmittingId}
                onCreateBrief={(c) => void handleCreateCampaignBrief(c)}
                onOpenDrawer={(c) => setDrawerCampaign(c)}
                dateFrom={data?.scope.startDate}
                dateTo={data?.scope.endDate}
                controlledViewMode="summary"
                onChangeViewMode={(mode) =>
                  setActiveSection(mode === 'daily' ? 'ads_daily' : 'ads_campaigns')
                }
              />
            </div>
          )}

          {/* =============================================================== */}
          {/* SECTION 6: CHI PHÍ THEO NGÀY (DAILY MODE TRỰC TIẾP)             */}
          {/* =============================================================== */}
          {activeSection === 'ads_daily' && (
            <div className="space-y-4">
              {ads && ads.status !== 'CONNECTED' && (
                <div className="rounded-[12px] border bg-amber-50/80 border-amber-200 px-4 py-3 text-xs text-amber-900 flex items-center justify-between gap-2">
                  <span>{ads.statusMessage}</span>
                  <Link href="/settings" className="font-semibold text-[#1E3A8A] hover:underline shrink-0">
                    Kiểm tra kết nối →
                  </Link>
                </div>
              )}

              <div className="rounded-[12px] bg-white border border-slate-200/90 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex flex-wrap items-center gap-4">
                  <span>
                    Tổng chi phí kỳ:{' '}
                    <strong className="text-slate-900 tabular-nums">
                      {ads?.metrics.cost !== null && ads?.metrics.cost !== undefined
                        ? `${Math.round(ads.metrics.cost).toLocaleString('vi-VN')} ₫`
                        : adsFallbackText}
                    </strong>
                  </span>
                  <span>
                    Click:{' '}
                    <strong className="text-slate-900 tabular-nums">
                      {ads?.metrics.clicks !== null && ads?.metrics.clicks !== undefined
                        ? ads.metrics.clicks.toLocaleString('vi-VN')
                        : adsFallbackText}
                    </strong>
                  </span>
                  <span>
                    Lead quảng cáo hợp lệ:{' '}
                    <strong className="text-[#0F275C] tabular-nums">
                      {ads?.metrics.validAttributedLeadCount ?? 0}
                    </strong>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveSection('ads_campaigns')}
                  className="text-[#1E3A8A] font-semibold hover:underline"
                >
                  Xem chi phí &amp; hiệu suất Ads →
                </button>
              </div>

              <AdsExcelTableSection
                campaigns={campTable?.rows || []}
                adsConnected={adsConnected}
                scopeWebsiteId={scope.websiteId || 'all'}
                scopeDateLabel={data ? `${data.scope.startDate} → ${data.scope.endDate}` : scope.preset}
                adsScopeMode={adsScopeMode}
                onChangeAdsScopeMode={(mode) => {
                  setAdsScopeMode(mode);
                  setAdsPage(1);
                }}
                searchTerm={searchTerm}
                canDirectDesign={canDirectDesign}
                briefSubmittingId={briefSubmittingId}
                onCreateBrief={(c) => void handleCreateCampaignBrief(c)}
                onOpenDrawer={(c) => setDrawerCampaign(c)}
                dateFrom={data?.scope.startDate}
                dateTo={data?.scope.endDate}
                controlledViewMode="daily"
                onChangeViewMode={(mode) =>
                  setActiveSection(mode === 'summary' ? 'ads_campaigns' : 'ads_daily')
                }
              />
            </div>
          )}

          {/* =============================================================== */}
          {/* SECTION 6B: TRANG ĐÍCH QUẢNG CÁO                                */}
          {/* =============================================================== */}
          {activeSection === 'ads_landing_pages' && (
            <div className="space-y-4">
              {ads && ads.status !== 'CONNECTED' && (
                <div className="rounded-[12px] border bg-amber-50/80 border-amber-200 px-4 py-3 text-xs text-amber-900 flex items-center justify-between gap-2">
                  <span>{ads.statusMessage}</span>
                  <Link href="/settings" className="font-semibold text-[#1E3A8A] hover:underline shrink-0">
                    Kiểm tra kết nối →
                  </Link>
                </div>
              )}

              <section className="bg-white border border-slate-200/90 rounded-[12px] shadow-2xs overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200">
                  <h3 className="text-sm font-bold text-slate-900">
                    Trang đích quảng cáo ({ads?.breakdowns.landingPages?.length ?? 0})
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Hiệu suất từng URL đích chạy Google Ads
                  </p>
                </div>
                <div tabIndex={0} role="region" aria-label="Bảng Trang đích Google Ads" className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <tr>
                        <th scope="col" className="py-2.5 px-4 font-semibold">URL trang đích</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold">Chiến dịch</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold text-right">Lượt nhấp</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold text-right">Hiển thị</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold text-right">CTR</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold text-right">CPC TB</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold text-right">Chi phí</th>
                        <th scope="col" className="py-2.5 px-4 font-semibold text-right">Chuyển đổi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(ads?.breakdowns.landingPages || []).length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-slate-500">
                            {ads?.breakdowns.keywordAvailabilityNote ||
                              'Chưa có dữ liệu trang đích Google Ads trong phạm vi đang chọn.'}
                          </td>
                        </tr>
                      ) : (
                        (ads?.breakdowns.landingPages || [])
                          .filter(
                            (lp) =>
                              !searchTerm ||
                              lp.url.toLowerCase().includes(searchTerm) ||
                              lp.campaignName.toLowerCase().includes(searchTerm),
                          )
                          .map((lp, idx) => (
                            <tr key={`${lp.url}-${lp.campaignName}-${idx}`} className="hover:bg-slate-50/70">
                              <th scope="row" className="py-2.5 px-4 font-mono text-[11px] font-medium text-slate-900 max-w-[340px]">
                                <a
                                  href={lp.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[#1A73E8] hover:underline inline-flex items-center gap-1 max-w-full"
                                  title={lp.url}
                                >
                                  <span className="truncate">{lp.url}</span>
                                  <ExternalLink className="w-3 h-3 shrink-0" />
                                </a>
                              </th>
                              <td className="py-2.5 px-3 text-slate-600 max-w-[220px] truncate" title={lp.campaignName}>
                                {lp.campaignName}
                              </td>
                              <td className="py-2.5 px-3 text-right font-semibold tabular-nums">
                                {lp.clicks.toLocaleString('vi-VN')}
                              </td>
                              <td className="py-2.5 px-3 text-right text-slate-600 tabular-nums">
                                {lp.impressions.toLocaleString('vi-VN')}
                              </td>
                              <td className="py-2.5 px-3 text-right text-slate-600 tabular-nums">
                                {lp.ctrPct !== null ? `${lp.ctrPct.toFixed(2)}%` : '—'}
                              </td>
                              <td className="py-2.5 px-3 text-right text-slate-600 tabular-nums">
                                {lp.avgCpc !== null ? `${Math.round(lp.avgCpc).toLocaleString('vi-VN')} ₫` : '—'}
                              </td>
                              <td className="py-2.5 px-3 text-right font-semibold text-slate-900 tabular-nums">
                                {Math.round(lp.cost).toLocaleString('vi-VN')} ₫
                              </td>
                              <td className="py-2.5 px-4 text-right text-slate-700 tabular-nums">
                                {Number.isInteger(lp.conversions)
                                  ? lp.conversions.toLocaleString('vi-VN')
                                  : lp.conversions.toFixed(2)}
                              </td>
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}

          {/* =============================================================== */}
          {/* SECTION 6C: CỤM TỪ TÌM KIẾM THỰC TẾ                             */}
          {/* =============================================================== */}
          {activeSection === 'ads_search_terms' && (
            <div className="space-y-4">
              {ads && ads.status !== 'CONNECTED' && (
                <div className="rounded-[12px] border bg-amber-50/80 border-amber-200 px-4 py-3 text-xs text-amber-900 flex items-center justify-between gap-2">
                  <span>{ads.statusMessage}</span>
                  <Link href="/settings" className="font-semibold text-[#1E3A8A] hover:underline shrink-0">
                    Kiểm tra kết nối →
                  </Link>
                </div>
              )}

              <section className="bg-white border border-slate-200/90 rounded-[12px] shadow-2xs overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200">
                  <h3 className="text-sm font-bold text-slate-900">
                    Cụm từ tìm kiếm ({ads?.breakdowns.searchTerms?.length ?? 0})
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Truy vấn thực tế người dùng tìm trên Google dẫn tới nhấp quảng cáo
                  </p>
                </div>
                <div tabIndex={0} role="region" aria-label="Bảng Cụm từ tìm kiếm Google Ads" className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <tr>
                        <th scope="col" className="py-2.5 px-4 font-semibold">Cụm từ tìm kiếm</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold">Trạng thái</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold">Nhóm QC / Chiến dịch</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold text-right">Hiển thị</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold text-right">Lượt nhấp</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold text-right">CTR</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold text-right">Chi phí</th>
                        <th scope="col" className="py-2.5 px-4 font-semibold text-right">Chuyển đổi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(ads?.breakdowns.searchTerms || []).length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-slate-500">
                            {ads?.breakdowns.keywordAvailabilityNote ||
                              'Chưa có dữ liệu cụm từ tìm kiếm Google Ads trong phạm vi đang chọn.'}
                          </td>
                        </tr>
                      ) : (
                        (ads?.breakdowns.searchTerms || [])
                          .filter(
                            (st) =>
                              !searchTerm ||
                              st.searchTerm.toLowerCase().includes(searchTerm) ||
                              st.campaignName.toLowerCase().includes(searchTerm),
                          )
                          .map((st, idx) => (
                            <tr key={`${st.searchTerm}-${st.campaignName}-${idx}`} className="hover:bg-slate-50/70">
                              <th scope="row" className="py-2.5 px-4 font-semibold text-slate-900">
                                {st.searchTerm}
                              </th>
                              <td className="py-2.5 px-3">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                    st.status === 'ADDED'
                                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                      : st.status === 'EXCLUDED'
                                        ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                        : 'bg-slate-100 text-slate-600'
                                  }`}
                                >
                                  {st.status || 'Chưa thêm'}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-slate-600">
                                <div className="font-medium text-slate-800">{st.adGroupName}</div>
                                <div className="text-[11px] text-slate-500">{st.campaignName}</div>
                              </td>
                              <td className="py-2.5 px-3 text-right text-slate-600 tabular-nums">
                                {st.impressions.toLocaleString('vi-VN')}
                              </td>
                              <td className="py-2.5 px-3 text-right font-semibold tabular-nums">
                                {st.clicks.toLocaleString('vi-VN')}
                              </td>
                              <td className="py-2.5 px-3 text-right text-slate-600 tabular-nums">
                                {st.ctrPct !== null ? `${st.ctrPct.toFixed(2)}%` : '—'}
                              </td>
                              <td className="py-2.5 px-3 text-right font-semibold text-slate-900 tabular-nums">
                                {Math.round(st.cost).toLocaleString('vi-VN')} ₫
                              </td>
                              <td className="py-2.5 px-4 text-right tabular-nums">
                                {Number.isInteger(st.conversions)
                                  ? st.conversions.toLocaleString('vi-VN')
                                  : st.conversions.toFixed(2)}
                              </td>
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}

          {/* =============================================================== */}
          {/* SECTION 7: NHÓM QUẢNG CÁO & TỪ KHÓA (BREAKDOWNS)                */}
          {/* =============================================================== */}
          {activeSection === 'ads_breakdowns' && (
            <div className="space-y-4">
              {ads && ads.status !== 'CONNECTED' && (
                <div className="rounded-[12px] border bg-amber-50/80 border-amber-200 px-4 py-3 text-xs text-amber-900 flex items-center justify-between gap-2">
                  <span>{ads.statusMessage}</span>
                  <Link href="/settings" className="font-semibold text-[#1E3A8A] hover:underline shrink-0">
                    Kiểm tra kết nối →
                  </Link>
                </div>
              )}

              {/* Bảng Nhóm quảng cáo */}
              <section className="bg-white border border-slate-200/90 rounded-[12px] shadow-2xs overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-slate-900">
                    Nhóm quảng cáo ({ads?.breakdowns.adGroups.length ?? 0})
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <tr>
                        <th scope="col" className="py-2.5 px-4 font-semibold">Nhóm quảng cáo</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold">Chiến dịch</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold text-right">Chi phí</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold text-right">Hiển thị</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold text-right">Click</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold text-right">Chuyển đổi</th>
                        <th scope="col" className="py-2.5 px-4 font-semibold text-right">CPA</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(ads?.breakdowns.adGroups || []).length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-slate-500">
                            {ads?.breakdowns.keywordAvailabilityNote ||
                              'Chưa có dữ liệu nhóm quảng cáo chi tiết trong phạm vi đang chọn.'}
                          </td>
                        </tr>
                      ) : (
                        (ads?.breakdowns.adGroups || [])
                          .filter(
                            (ag) =>
                              !searchTerm ||
                              ag.adGroupName.toLowerCase().includes(searchTerm) ||
                              ag.campaignName.toLowerCase().includes(searchTerm),
                          )
                          .map((ag) => (
                            <tr key={ag.adGroupId} className="hover:bg-slate-50/70">
                              <th scope="row" className="py-2.5 px-4 font-semibold text-slate-900">
                                {ag.adGroupName}
                              </th>
                              <td className="py-2.5 px-3 text-slate-600">{ag.campaignName}</td>
                              <td className="py-2.5 px-3 text-right font-semibold tabular-nums">
                                {Math.round(ag.cost).toLocaleString('vi-VN')} ₫
                              </td>
                              <td className="py-2.5 px-3 text-right text-slate-600 tabular-nums">
                                {ag.impressions.toLocaleString('vi-VN')}
                              </td>
                              <td className="py-2.5 px-3 text-right text-slate-700 font-medium tabular-nums">
                                {ag.clicks.toLocaleString('vi-VN')}
                              </td>
                              <td className="py-2.5 px-3 text-right text-slate-700 tabular-nums">
                                {Number.isInteger(ag.conversions)
                                  ? ag.conversions.toLocaleString('vi-VN')
                                  : ag.conversions.toFixed(2)}
                              </td>
                              <td className="py-2.5 px-4 text-right text-slate-700 tabular-nums">
                                {ag.cpa !== null ? `${Math.round(ag.cpa).toLocaleString('vi-VN')} ₫` : '—'}
                              </td>
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Bảng Từ khóa quảng cáo */}
              <section className="bg-white border border-slate-200/90 rounded-[12px] shadow-2xs overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-slate-900">
                    Từ khóa quảng cáo ({ads?.breakdowns.keywords.length ?? 0})
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <tr>
                        <th scope="col" className="py-2.5 px-4 font-semibold">Từ khóa</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold">Đối sánh</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold">Nhóm QC / Chiến dịch</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold text-right">Hiển thị</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold text-right">Click</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold text-right">CTR</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold text-right">Chi phí</th>
                        <th scope="col" className="py-2.5 px-4 font-semibold text-right">Chuyển đổi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(ads?.breakdowns.keywords || []).length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-slate-500">
                            {ads?.breakdowns.keywordAvailabilityNote ||
                              'Chưa có dữ liệu từ khóa chi tiết trong phạm vi đang chọn.'}
                          </td>
                        </tr>
                      ) : (
                        (ads?.breakdowns.keywords || [])
                          .filter(
                            (kw) =>
                              !searchTerm ||
                              kw.keywordText.toLowerCase().includes(searchTerm) ||
                              kw.campaignName.toLowerCase().includes(searchTerm),
                          )
                          .map((kw, idx) => (
                            <tr key={`${kw.campaignName}-${kw.adGroupName}-${kw.keywordText}-${idx}`} className="hover:bg-slate-50/70">
                              <th scope="row" className="py-2.5 px-4 font-semibold text-slate-900">
                                {kw.keywordText}
                              </th>
                              <td className="py-2.5 px-3 text-slate-600">
                                <span className="px-2 py-0.5 rounded bg-slate-100 text-[11px] font-medium">
                                  {kw.matchType}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-slate-600">
                                <div className="font-medium text-slate-800">{kw.adGroupName}</div>
                                <div className="text-[11px] text-slate-500">{kw.campaignName}</div>
                              </td>
                              <td className="py-2.5 px-3 text-right text-slate-600 tabular-nums">
                                {kw.impressions.toLocaleString('vi-VN')}
                              </td>
                              <td className="py-2.5 px-3 text-right font-semibold tabular-nums">
                                {kw.clicks.toLocaleString('vi-VN')}
                              </td>
                              <td className="py-2.5 px-3 text-right text-slate-600 tabular-nums">
                                {kw.ctrPct !== null ? `${kw.ctrPct.toFixed(2)}%` : '—'}
                              </td>
                              <td className="py-2.5 px-3 text-right font-semibold tabular-nums">
                                {Math.round(kw.cost).toLocaleString('vi-VN')} ₫
                              </td>
                              <td className="py-2.5 px-4 text-right tabular-nums">
                                {Number.isInteger(kw.conversions)
                                  ? kw.conversions.toLocaleString('vi-VN')
                                  : kw.conversions.toFixed(2)}
                              </td>
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-slate-900">Thiết bị Google Ads</h3>
                    <span className="text-[11px] font-semibold text-slate-500">
                      {(ads?.breakdowns.devices || []).length} loại thiết bị
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-slate-50 border-b border-slate-100 text-[11px] font-bold text-slate-500 uppercase">
                        <tr>
                          <th className="px-4 py-2.5">Thiết bị</th>
                          <th className="px-3 py-2.5 text-right">Hiển thị</th>
                          <th className="px-3 py-2.5 text-right">Nhấp chuột</th>
                          <th className="px-4 py-2.5 text-right">Chi phí</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {(ads?.breakdowns.devices || []).length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                              Chưa có dữ liệu thiết bị Google Ads.
                            </td>
                          </tr>
                        ) : (
                          (ads?.breakdowns.devices || []).map((dev, idx) => {
                            const deviceLabels: Record<string, string> = {
                              MOBILE: 'Di động',
                              DESKTOP: 'Máy tính',
                              TABLET: 'Máy tính bảng',
                              CONNECTED_TV: 'TV kết nối',
                            };
                            const label =
                              deviceLabels[String(dev.device || '').toUpperCase()] ||
                              dev.device ||
                              'Khác';
                            return (
                              <tr key={`${dev.device}-${idx}`} className="hover:bg-slate-50/70">
                                <td className="px-4 py-2.5 font-semibold text-slate-800">{label}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                                  {Number(dev.impressions || 0).toLocaleString('vi-VN')}
                                </td>
                                <td className="px-3 py-2.5 text-right tabular-nums font-medium text-slate-800">
                                  {Number(dev.clicks || 0).toLocaleString('vi-VN')}
                                </td>
                                <td className="px-4 py-2.5 text-right tabular-nums font-bold text-slate-900">
                                  {Math.round(Number(dev.cost || 0)).toLocaleString('vi-VN')} ₫
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-slate-900">Khung giờ hiệu quả</h3>
                    <span className="text-[11px] font-semibold text-slate-500">
                      {(ads?.breakdowns.timeSchedule || []).length} khung giờ
                    </span>
                  </div>
                  <div className="overflow-auto max-h-[320px]">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-slate-50 border-b border-slate-100 text-[11px] font-bold text-slate-500 uppercase sticky top-0">
                        <tr>
                          <th className="px-4 py-2.5">Thời điểm</th>
                          <th className="px-3 py-2.5 text-right">Hiển thị</th>
                          <th className="px-3 py-2.5 text-right">Nhấp chuột</th>
                          <th className="px-3 py-2.5 text-right">Chi phí</th>
                          <th className="px-4 py-2.5 text-right">Chuyển đổi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {(ads?.breakdowns.timeSchedule || []).length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                              Chưa có dữ liệu khung giờ Google Ads.
                            </td>
                          </tr>
                        ) : (
                          (ads?.breakdowns.timeSchedule || []).map((slot, idx) => {
                            const dayMap: Record<string, string> = {
                              MONDAY: 'Thứ 2',
                              TUESDAY: 'Thứ 3',
                              WEDNESDAY: 'Thứ 4',
                              THURSDAY: 'Thứ 5',
                              FRIDAY: 'Thứ 6',
                              SATURDAY: 'Thứ 7',
                              SUNDAY: 'CN',
                            };
                            const dayLabel =
                              dayMap[String(slot.dayOfWeek || '').toUpperCase()] ||
                              slot.dayOfWeek ||
                              '—';
                            const conv = Number(slot.conversions || 0);
                            return (
                              <tr
                                key={`${slot.dayOfWeek}-${slot.hour}-${idx}`}
                                className="hover:bg-slate-50/70"
                              >
                                <td className="px-4 py-2.5 font-semibold text-slate-800 whitespace-nowrap">
                                  {dayLabel} · {String(slot.hour ?? 0).padStart(2, '0')}:00
                                </td>
                                <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                                  {Number(slot.impressions || 0).toLocaleString('vi-VN')}
                                </td>
                                <td className="px-3 py-2.5 text-right tabular-nums font-medium text-slate-800">
                                  {Number(slot.clicks || 0).toLocaleString('vi-VN')}
                                </td>
                                <td className="px-3 py-2.5 text-right tabular-nums font-bold text-slate-900">
                                  {Math.round(Number(slot.cost || 0)).toLocaleString('vi-VN')} ₫
                                </td>
                                <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-700">
                                  {Number.isInteger(conv) ? conv.toLocaleString('vi-VN') : conv.toFixed(2)}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Hộp thoại giữa màn hình chi tiết chiến dịch (giống Tạo Lead) */}
      {drawerCampaign && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
          onClick={() => setDrawerCampaign(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Chi tiết chiến dịch ${drawerCampaign.campaignName}`}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl max-h-[88vh] rounded-2xl bg-white shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="px-5 py-4 bg-slate-50/80 border-b border-slate-200 flex items-start justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 truncate">
                    {drawerCampaign.campaignName}
                  </h2>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                      drawerCampaign.status === 'ENABLED'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                    }`}
                  >
                    {drawerCampaign.status === 'ENABLED' ? 'Đang chạy' : 'Tạm dừng'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">{drawerCampaign.attributionNote}</p>
              </div>
              <button
                type="button"
                aria-label="Đóng chi tiết chiến dịch"
                onClick={() => setDrawerCampaign(null)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 shrink-0"
              >
                <X aria-hidden="true" className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5">
                  <div className="text-slate-500">Chi phí thực tế</div>
                  <div className="text-base sm:text-lg font-extrabold text-slate-900 mt-1 tabular-nums">
                    {drawerCampaign.cost.toLocaleString('vi-VN')} ₫
                  </div>
                </div>
                <div className="rounded-xl bg-blue-50/60 border border-blue-200/80 p-3.5">
                  <div className="text-slate-600">Lead CRM hợp lệ</div>
                  <div className="text-base sm:text-lg font-extrabold text-[#0F275C] mt-1 tabular-nums">
                    {drawerCampaign.validAttributedLeadCount}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5">
                  <div className="text-slate-500">CPL thực tế</div>
                  <div className="text-base sm:text-lg font-extrabold text-slate-900 mt-1 tabular-nums">
                    {drawerCampaign.costPerValidLead !== null
                      ? `${drawerCampaign.costPerValidLead.toLocaleString('vi-VN')} ₫`
                      : 'Chưa đủ đối soát'}
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-bold text-slate-900 mb-2 flex items-center gap-1.5">
                  <ExternalLink aria-hidden="true" className="w-4 h-4 text-[#1E3A8A]" />
                  Link đích chiến dịch ({drawerCampaign.finalUrls?.length || (drawerCampaign.primaryDestinationUrl ? 1 : 0)})
                </h3>
                {(drawerCampaign.finalUrls && drawerCampaign.finalUrls.length > 0) ? (
                  <div className="space-y-1.5 rounded-xl bg-blue-50/50 border border-blue-200/80 p-3.5 max-h-52 overflow-y-auto">
                    {drawerCampaign.finalUrls.map((u) => (
                      <a
                        key={u}
                        href={u}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between gap-2 text-[#1E3A8A] font-mono text-[11px] hover:underline break-all"
                      >
                        <span>{u}</span>
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    ))}
                  </div>
                ) : drawerCampaign.primaryDestinationUrl ? (
                  <a
                    href={drawerCampaign.primaryDestinationUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-slate-700 font-mono text-[11px] hover:underline"
                  >
                    <span>{drawerCampaign.primaryDestinationUrl}</span>
                    <ExternalLink className="w-3 h-3 shrink-0" />
                  </a>
                ) : (
                  <p className="text-slate-500 bg-slate-50 border border-slate-200 rounded-xl p-3">
                    Chưa có URL đích chi tiết từ chiến dịch này.
                  </p>
                )}
              </div>

              <div>
                <h3 className="font-bold text-slate-900 mb-2 flex items-center gap-1.5">
                  <Layers aria-hidden="true" className="w-4 h-4 text-[#1E3A8A]" />
                  Nhóm quảng cáo &amp; từ khóa
                </h3>
                {(ads?.breakdowns.adGroups || []).filter(
                  (ag) => ag.campaignName === drawerCampaign.campaignName,
                ).length === 0 ? (
                  <p className="text-slate-500 bg-slate-50 border border-slate-200 rounded-xl p-3">
                    {ads?.breakdowns.keywordAvailabilityNote ||
                      'Nguồn hiện chưa trả dữ liệu phân rã nhóm quảng cáo / từ khóa / thiết bị / khu vực cho chiến dịch này.'}
                  </p>
                ) : (
                  <ul role="list" className="space-y-2">
                    {(ads?.breakdowns.adGroups || [])
                      .filter((ag) => ag.campaignName === drawerCampaign.campaignName)
                      .map((ag) => (
                        <li
                          key={ag.adGroupId}
                          className="rounded-xl border border-slate-200 p-3 flex items-center justify-between hover:bg-slate-50/70 transition"
                        >
                          <span className="font-semibold text-slate-800">{ag.adGroupName}</span>
                          <span className="tabular-nums text-slate-600 font-medium">
                            {ag.clicks} click · {ag.cost.toLocaleString('vi-VN')} ₫
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end shrink-0">
              <button
                type="button"
                onClick={() => setDrawerCampaign(null)}
                className="h-9 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold transition"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
      <KpiAuditLineageDrawer
        open={Boolean(auditLineageMetric)}
        onClose={() => setAuditLineageMetric(null)}
        metric={auditLineageMetric}
        websiteId={scope.websiteId || 'all'}
      />
    </div>
  );
}

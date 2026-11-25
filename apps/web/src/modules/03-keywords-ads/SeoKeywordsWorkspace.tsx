'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Download,
  ExternalLink,
  FilePlus2,
  FileText,
  Globe,
  LayoutDashboard,
  MonitorSmartphone,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  SEO_ARTICLE_STATUS_LABELS,
  UI_VOCABULARY,
  formatSafePeriodComparison,
  type M03AdsSeoDashboardDto,
  type SeoArticleStatus,
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
import { useVirtualRows } from '@/core/components/common/VirtualizedExcelGrid';
import { LedSeoQualityScorerModal } from './LedSeoQualityScorerModal';

const GscPerformanceChart = dynamic(
  () => import('./GscPerformanceChart').then((m) => m.GscPerformanceChart),
  {
    ssr: false,
    loading: () => <div className="h-[340px] rounded-2xl bg-slate-50 animate-pulse" />,
  },
);

const GoogleTrendsExplorePanel = dynamic(
  () => import('./GoogleTrendsExplorePanel').then((m) => m.GoogleTrendsExplorePanel),
  {
    ssr: false,
    loading: () => <div className="h-[360px] rounded-2xl bg-slate-50 animate-pulse" />,
  },
);

const SeoAiReportPanel = dynamic(
  () => import('./SeoAiReportPanel').then((m) => m.SeoAiReportPanel),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-2xl bg-white p-8 border border-slate-200 shadow-lg text-xs text-slate-500">
        Đang mở trình phân tích SEO AI...
      </div>
    ),
  },
);

type SeoWorkspaceTab =
  | 'overview'
  | 'queries'
  | 'pages'
  | 'devices_countries'
  | 'content'
  | 'trends';

const VALID_SEO_TABS: ReadonlySet<string> = new Set([
  'overview',
  'queries',
  'pages',
  'devices_countries',
  'content',
  'trends',
]);

const SEO_SECTION_META: Record<SeoWorkspaceTab, { title: string; subtitle: string }> = {
  overview: {
    title: 'Hiệu suất tìm kiếm (GSC)',
    subtitle: 'Hiệu suất Google Search Console và đối soát Lead SEO',
  },
  queries: {
    title: 'Từ khóa tìm kiếm',
    subtitle: 'Lượt nhấp, hiển thị, CTR và thứ hạng từ khóa',
  },
  pages: {
    title: 'Trang đích SEO',
    subtitle: 'Hiệu suất từng trang và tình trạng lập chỉ mục Google',
  },
  devices_countries: {
    title: 'Thiết bị & Quốc gia',
    subtitle: 'Phân bổ tìm kiếm theo thiết bị và khu vực',
  },
  content: {
    title: 'Kế hoạch nội dung',
    subtitle: 'Bài viết SEO, bản nháp và tiến độ xuất bản',
  },
  trends: {
    title: 'Xu hướng thị trường',
    subtitle: 'So sánh từ khóa và chủ đề quan tâm tại Việt Nam',
  },
};

function buildM03ApiPath(
  scope: { websiteId: string; preset: string; from: string; to: string },
  page: number,
  contentPage: number,
  minImpr: number,
  maxCtr: number,
  compare: boolean,
): string {
  const qs = new URLSearchParams({
    view: 'spec',
    websiteId: scope.websiteId || 'all',
    preset: scope.preset || '7D',
    page: String(page),
    pageSize: '60',
    contentPage: String(contentPage),
    minImpr: String(minImpr),
    maxCtr: String(maxCtr),
  });
  if (compare) qs.set('compare', '1');
  if (scope.preset === 'CUSTOM' && scope.from && scope.to) {
    qs.set('from', scope.from);
    qs.set('to', scope.to);
  }
  return `/api/v1/ads?${qs.toString()}`;
}

function formatWorkflowStatus(raw: string): string {
  const upper = raw.toUpperCase() as SeoArticleStatus;
  if (upper in SEO_ARTICLE_STATUS_LABELS) {
    return SEO_ARTICLE_STATUS_LABELS[upper];
  }
  if (raw === 'published') return 'Đã đăng';
  if (raw === 'approved_scheduled') return 'Đã duyệt - chờ đăng';
  return 'Bản nháp';
}

export function SeoKeywordsWorkspace() {
  const { user } = useSession();
  const [scoringArticleId, setScoringArticleId] = useState<number | null>(null);
  const { scope, hydrated, updateScope } = useDashboardScope();
  const canEditContent = user?.roleCode !== 'ADS';

  const [activeTab, setActiveTab] = useState<SeoWorkspaceTab>(() => {
    if (typeof window !== 'undefined') {
      const t = new URLSearchParams(window.location.search).get('tab');
      if (t && VALID_SEO_TABS.has(t)) return t as SeoWorkspaceTab;
      const saved = loadRouteState<{ activeTab?: string }>('ads');
      if (saved?.activeTab && VALID_SEO_TABS.has(saved.activeTab)) {
        return saved.activeTab as SeoWorkspaceTab;
      }
    }
    return 'overview';
  });
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [crossFilterPage, setCrossFilterPage] = useState<string | null>(null);
  const [crossFilterQuery, setCrossFilterQuery] = useState<string | null>(null);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [showUrlInspect, setShowUrlInspect] = useState(false);
  const [showCreateContentForm, setShowCreateContentForm] = useState(false);

  const [queriesPage, setQueriesPage] = useState(
    () => loadRouteState<{ queriesPage?: number }>('ads')?.queriesPage || 1,
  );
  const [pagesPage, setPagesPage] = useState(
    () => loadRouteState<{ pagesPage?: number }>('ads')?.pagesPage || 1,
  );
  const [contentPage, setContentPage] = useState(
    () => loadRouteState<{ contentPage?: number }>('ads')?.contentPage || 1,
  );
  const [searchTerm, setSearchTerm] = useState('');
  const seoExcelCalc = useMktExcelSelection();

  // Ngưỡng gợi ý cơ hội cấu hình được (không hardcode cố định)
  const [draftMinImpr, setDraftMinImpr] = useState('30');
  const [draftMaxCtr, setDraftMaxCtr] = useState('3');
  const [appliedMinImpr, setAppliedMinImpr] = useState(30);
  const [appliedMaxCtr, setAppliedMaxCtr] = useState(3);

  // Form thêm bài vào kế hoạch nội dung
  const [newKeywordText, setNewKeywordText] = useState('');
  const [newTargetWebsite, setNewTargetWebsite] = useState<'toantrung.com.vn' | 'bangled.vn' | 'manhinhled.net.vn'>('toantrung.com.vn');
  const [newTopicFocus, setNewTopicFocus] = useState('');
  const [creatingContent, setCreatingContent] = useState(false);
  const [contentStatusMsg, setContentStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    const onPlatformSwitch = (e: Event) => {
      const key = (e as CustomEvent<string>).detail;
      if (key === 'gsc') setActiveTab('overview');
      if (key === 'trends') setActiveTab('trends');
    };
    window.addEventListener('tt-google-platform-click', onPlatformSwitch as EventListener);
    return () =>
      window.removeEventListener('tt-google-platform-click', onPlatformSwitch as EventListener);
  }, []);

  const activeGscPage = activeTab === 'pages' ? pagesPage : queriesPage;
  const apiPath = useMemo(
    () =>
      buildM03ApiPath(
        scope,
        activeGscPage,
        contentPage,
        appliedMinImpr,
        appliedMaxCtr,
        compareEnabled,
      ),
    [scope, activeGscPage, contentPage, appliedMinImpr, appliedMaxCtr, compareEnabled],
  );
  const activePathRef = useRef<string>(apiPath);
  activePathRef.current = apiPath;
  const reqSeqRef = useRef<number>(0);
  const prevScopeSigRef = useRef<string>(`${scope.websiteId}|${scope.preset}|${scope.from}|${scope.to}`);
  const scrollRestoredRef = useRef<boolean>(false);

  const [dataState, setDataState] = useState<{
    path: string;
    data: M03AdsSeoDashboardDto;
  } | null>(() => {
    const cached = peekApiCacheEntry<M03AdsSeoDashboardDto>(apiPath);
    return cached ? { path: apiPath, data: cached.data } : null;
  });
  const data = dataState && dataState.path === apiPath ? dataState.data : null;

  const [knownWebsites, setKnownWebsites] = useState<WebsiteConfigItemDto[]>(
    () => peekApiCacheEntry<M03AdsSeoDashboardDto>(apiPath)?.data.coverage.availableWebsites || [],
  );
  const [loading, setLoading] = useState<boolean>(
    () => !peekApiCacheEntry<M03AdsSeoDashboardDto>(apiPath),
  );
  const [refreshing, setRefreshing] = useState(false);
  const [checkedAtIso, setCheckedAtIso] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const nextSig = `${scope.websiteId}|${scope.preset}|${scope.from}|${scope.to}`;
    if (prevScopeSigRef.current !== nextSig) {
      prevScopeSigRef.current = nextSig;
      setQueriesPage(1);
      setPagesPage(1);
      setContentPage(1);
    }
  }, [scope.websiteId, scope.preset, scope.from, scope.to]);

  useEffect(() => {
    const entry = peekApiCacheEntry<M03AdsSeoDashboardDto>(apiPath);
    if (entry) {
      setDataState({ path: apiPath, data: entry.data });
      if (entry.data.coverage.availableWebsites?.length) {
        setKnownWebsites(entry.data.coverage.availableWebsites);
      }
      setCheckedAtIso(new Date(entry.timestamp).toISOString());
      setLoading(false);
      setRefreshing(false);
    } else {
      // Xóa trạng thái cũ ngay lập tức khi sang website/khoảng ngày chưa cache
      setDataState(null);
      setLoading(true);
    }
  }, [apiPath]);

  const fetchDashboard = useCallback(
    async (opts?: { forceFresh?: boolean; silent?: boolean; signal?: AbortSignal } | boolean) => {
      const normalized =
        typeof opts === 'boolean' ? { forceFresh: opts } : opts || {};
      if (!hydrated) return;
      if (scope.preset === 'CUSTOM' && (!scope.from || !scope.to)) return;

      const requestPath = apiPath;
      const seq = ++reqSeqRef.current;
      if (normalized.forceFresh && !normalized.silent) {
        setRefreshing(true);
      }
      if (!normalized.silent) setErrorMsg(null);
      try {
        const res = await apiRequest<M03AdsSeoDashboardDto>(requestPath, {
          skipCache: Boolean(normalized.forceFresh || normalized.silent),
          signal: normalized.signal,
          onRevalidated: (fresh) => {
            if (activePathRef.current !== requestPath) return;
            setDataState({ path: requestPath, data: fresh });
            if (fresh.coverage.availableWebsites?.length) {
              setKnownWebsites(fresh.coverage.availableWebsites);
            }
            setCheckedAtIso(new Date().toISOString());
          },
        });
        if (
          normalized.signal?.aborted ||
          seq !== reqSeqRef.current ||
          activePathRef.current !== requestPath
        ) {
          return;
        }
        setDataState({ path: requestPath, data: res });
        if (res.coverage.availableWebsites?.length) {
          setKnownWebsites(res.coverage.availableWebsites);
        }
        setCheckedAtIso(new Date().toISOString());
      } catch (err) {
        if (
          normalized.signal?.aborted ||
          (err instanceof DOMException && err.name === 'AbortError')
        ) {
          return;
        }
        if (seq === reqSeqRef.current && !normalized.silent) {
          setErrorMsg(err instanceof Error ? err.message : UI_VOCABULARY.fallbacks.loadError);
        }
      } finally {
        if (!normalized.signal?.aborted && seq === reqSeqRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [apiPath, hydrated, scope.preset, scope.from, scope.to],
  );

  useEffect(() => {
    if (!hydrated) return;
    if (scope.preset === 'CUSTOM' && (!scope.from || !scope.to)) return;

    const controller = new AbortController();
    const cached = peekApiCacheEntry<M03AdsSeoDashboardDto>(apiPath);
    if (!cached || !cached.isFresh) {
      void fetchDashboard({ forceFresh: false, silent: Boolean(cached), signal: controller.signal });
    }

    const unsubscribe = subscribeDataSync(
      ['ads', 'seo_articles', 'seo_reports', 'tracking', 'websites'],
      () => {
        void fetchDashboard({ forceFresh: true, silent: true });
      },
    );

    return () => {
      controller.abort();
      unsubscribe();
    };
  }, [hydrated, apiPath, scope.preset, scope.from, scope.to, fetchDashboard]);

  useEffect(() => {
    saveRouteState('ads', { activeTab, queriesPage, pagesPage, contentPage });
  }, [activeTab, queriesPage, pagesPage, contentPage]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const scroller = document.getElementById('main-workspace-content');
    if (!scroller) return;
    if (!scrollRestoredRef.current && data) {
      scrollRestoredRef.current = true;
      const saved = loadRouteState<{ scrollTop?: number }>('ads_scroll');
      if (saved?.scrollTop && saved.scrollTop > 0) {
        requestAnimationFrame(() => {
          scroller.scrollTop = saved.scrollTop ?? 0;
        });
      }
    }
    return () => {
      saveRouteState('ads_scroll', { scrollTop: scroller.scrollTop });
    };
  }, [data]);

  const seo = data?.seo;

  const handleQuickPlanKeyword = (queryText: string) => {
    const inferredDomain =
      scope.websiteId === 'bangled.vn' || scope.websiteId === 'manhinhled.net.vn'
        ? scope.websiteId
        : 'toantrung.com.vn';
    setNewKeywordText(queryText);
    setNewTargetWebsite(inferredDomain);
    setNewTopicFocus(`Tư vấn giải pháp và thông số kỹ thuật ${queryText} thực tế`);
    setActiveTab('content');
    setShowCreateContentForm(true);
  };

  const handleSubmitNewContent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditContent || creatingContent) return;
    if (newKeywordText.trim().length < 2 || newTopicFocus.trim().length < 5) return;
    setCreatingContent(true);
    setContentStatusMsg(null);
    setErrorMsg(null);
    try {
      const kwRes = await apiRequest<{ id: number; keyword: string }>('/api/v1/ads', {
        method: 'POST',
        csrfToken: user?.csrfToken,
        body: {
          action: 'create_keyword',
          keywordText: newKeywordText.trim(),
          targetWebsite: newTargetWebsite,
        },
      });
      const artRes = await apiRequest<{ id: number; title: string }>('/api/v1/ads', {
        method: 'POST',
        csrfToken: user?.csrfToken,
        body: {
          action: 'generate_ai_draft',
          keywordId: kwRes.id,
          targetWebsite: newTargetWebsite,
          topicFocus: newTopicFocus.trim(),
        },
      });
      setContentStatusMsg(`Đã tạo bản nháp nội dung: "${artRes.title}"`);
      setNewKeywordText('');
      setNewTopicFocus('');
      setShowCreateContentForm(false);
      await fetchDashboard(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể tạo bản nháp nội dung.');
    } finally {
      setCreatingContent(false);
    }
  };

  const queryPageLinks = seo?.tables.queryPageLinks || [];

  const crossMatchedQueriesSet = useMemo(() => {
    if (!crossFilterPage) return null;
    const target = crossFilterPage.toLowerCase();
    return new Set(
      queryPageLinks
        .filter((ln) => ln.page.toLowerCase() === target)
        .map((ln) => ln.query.toLowerCase()),
    );
  }, [crossFilterPage, queryPageLinks]);

  const crossMatchedPagesSet = useMemo(() => {
    if (!crossFilterQuery) return null;
    const target = crossFilterQuery.toLowerCase();
    return new Set(
      queryPageLinks
        .filter((ln) => ln.query.toLowerCase() === target)
        .map((ln) => ln.page.toLowerCase()),
    );
  }, [crossFilterQuery, queryPageLinks]);

  const queryRowsFiltered = useMemo(() => {
    let list = seo?.tables.queries.rows || [];
    if (crossMatchedQueriesSet) {
      list = list.filter((r) => crossMatchedQueriesSet.has(r.key.toLowerCase()));
    }
    if (!searchTerm.trim()) return list;
    const kw = searchTerm.trim().toLowerCase();
    return list.filter((r) => r.key.toLowerCase().includes(kw));
  }, [seo?.tables.queries.rows, crossMatchedQueriesSet, searchTerm]);

  const queryVirtualGrid = useVirtualRows({
    totalCount: queryRowsFiltered.length,
    rowHeight: 42,
    overscan: 14,
    enabledThreshold: 60,
  });
  const visibleQueryRows = queryVirtualGrid.isVirtualized
    ? queryRowsFiltered.slice(queryVirtualGrid.startIndex, queryVirtualGrid.endIndex)
    : queryRowsFiltered;

  const pageRowsFiltered = useMemo(() => {
    let list = seo?.tables.pages.rows || [];
    if (crossMatchedPagesSet) {
      list = list.filter((r) => crossMatchedPagesSet.has(r.key.toLowerCase()));
    }
    if (!searchTerm.trim()) return list;
    const kw = searchTerm.trim().toLowerCase();
    return list.filter((r) => r.key.toLowerCase().includes(kw));
  }, [seo?.tables.pages.rows, crossMatchedPagesSet, searchTerm]);

  const contentRowsFiltered = useMemo(() => {
    const list = seo?.tables.content?.rows || [];
    if (!searchTerm.trim()) return list;
    const kw = searchTerm.trim().toLowerCase();
    return list.filter(
      (r) =>
        r.title.toLowerCase().includes(kw) ||
        r.targetQuery.toLowerCase().includes(kw) ||
        (r.targetWebsite || '').toLowerCase().includes(kw),
    );
  }, [seo?.tables.content?.rows, searchTerm]);

  const activeTotalRows =
    activeTab === 'queries'
      ? seo?.tables.queries.totalRows || 0
      : activeTab === 'pages'
        ? seo?.tables.pages.totalRows || 0
        : activeTab === 'content'
          ? seo?.tables.content?.totalRows || 0
          : 0;
  const currentPageNum =
    activeTab === 'content'
      ? contentPage
      : activeTab === 'pages'
        ? pagesPage
        : queriesPage;
  const totalPages = Math.max(1, Math.ceil(activeTotalRows / 20));

  return (
    <div className="space-y-4 pb-8">
      <WebsiteDashboardHeader
        title="Từ khóa & SEO"
        scope={scope}
        availableWebsites={data?.coverage.availableWebsites || knownWebsites}
        websiteSelectorStyle="dropdown"
        showCompareToggle={true}
        compareEnabled={compareEnabled}
        onToggleCompare={setCompareEnabled}
        freshnessMessage={
          loading && !data
            ? UI_VOCABULARY.freshness.updating
            : refreshing
              ? UI_VOCABULARY.freshness.updating
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
          errorMsg || data?.freshness.state === 'ERROR'
            ? 'error'
            : refreshing || loading
              ? 'updating'
              : 'ok'
        }
        onChangeScope={updateScope}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={refreshing}
              onClick={() => void fetchDashboard(true)}
              className="h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              {UI_VOCABULARY.actions.refresh}
            </button>
            <a
              href="/api/v1/ads/export"
              className="h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              {UI_VOCABULARY.actions.exportExcel}
            </a>
            <button
              type="button"
              onClick={() => setShowAiPanel((prev) => !prev)}
              className="h-8 px-3.5 rounded-lg bg-[#0B1D48] text-white hover:bg-[#172D6E] text-xs font-semibold inline-flex items-center gap-1.5 shadow-2xs"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {showAiPanel ? 'Đóng báo cáo SEO' : 'Tạo báo cáo SEO'}
            </button>
          </div>
        }
      />

      {errorMsg && (
        <div
          role="alert"
          className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-xs text-rose-800 flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {contentStatusMsg && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-xs text-emerald-800 font-medium">
          {contentStatusMsg}
        </div>
      )}

      {showAiPanel && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Báo cáo Phân tích SEO bằng AI"
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
          onClick={() => setShowAiPanel(false)}
        >
          <div
            className="w-full max-w-5xl my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <SeoAiReportPanel
              csrfToken={user?.csrfToken}
              initialWebsite={scope.websiteId}
              initialPeriodDays={scope.preset === '7D' ? 7 : 30}
              availableWebsites={data?.coverage.availableWebsites || knownWebsites}
              canEditContent={canEditContent}
              onClose={() => setShowAiPanel(false)}
              onSelectKeyword={(kw) => {
                setSearchTerm(kw);
                setActiveTab('queries');
                setShowAiPanel(false);
              }}
              onContentCreated={() => {
                void fetchDashboard(true);
              }}
            />
          </div>
        </div>
      )}

      {/* Bố cục menu dọc bên trái chuẩn Google Ads + vùng nội dung rộng bên phải */}
      <div className="flex flex-col lg:flex-row items-start gap-4">
        <VerticalSectionNav
          ariaLabel="Điều hướng phân mục Từ khóa & SEO"
          activeId={activeTab}
          onSelect={(id) => {
            if (VALID_SEO_TABS.has(id)) {
              setActiveTab(id as SeoWorkspaceTab);
            }
          }}
          topItems={[]}
          groups={[
            {
              id: 'seo_gsc',
              label: 'Tìm kiếm tự nhiên (GSC)',
              defaultOpen: true,
              items: [
                {
                  id: 'overview',
                  label: 'Hiệu suất tìm kiếm',
                  icon: LayoutDashboard,
                },
                {
                  id: 'queries',
                  label: 'Từ khóa tìm kiếm',
                  icon: Search,
                  badge: seo?.tables.queries.totalRows ?? null,
                },
                {
                  id: 'pages',
                  label: 'Trang đích SEO',
                  icon: FileText,
                  badge: seo?.tables.pages.totalRows ?? null,
                },
                {
                  id: 'devices_countries',
                  label: 'Thiết bị & Quốc gia',
                  icon: MonitorSmartphone,
                  badge: seo?.tables.deviceCountry?.length ?? null,
                },
              ],
            },
            {
              id: 'seo_plan',
              label: 'Nội dung & Xu hướng',
              defaultOpen: true,
              items: [
                {
                  id: 'content',
                  label: 'Kế hoạch nội dung',
                  icon: FilePlus2,
                  badge: seo?.tables.content?.totalRows ?? null,
                },
                {
                  id: 'trends',
                  label: 'Xu hướng thị trường',
                  icon: TrendingUp,
                  badge: data?.trends.rows.length ?? null,
                },
              ],
            },
          ]}
        />

        <div className="flex-1 min-w-0 w-full space-y-4">
          {/* Thanh tiêu đề phân mục hiện tại + tìm kiếm nhanh + nút thao tác mục */}
          <div className="bg-white border border-slate-200/90 rounded-2xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900 leading-tight">
                {SEO_SECTION_META[activeTab].title}
              </h2>
              <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                {SEO_SECTION_META[activeTab].subtitle}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(activeTab === 'queries' || activeTab === 'pages' || activeTab === 'content') && (
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="search"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Tìm từ khóa, URL hoặc tiêu đề..."
                    className="h-8 pl-8 pr-3 rounded-lg border border-slate-200 text-xs text-slate-800 w-56 focus:outline-2 focus:outline-[#1E3A8A]"
                  />
                </div>
              )}
              {activeTab === 'pages' && (
                <button
                  type="button"
                  onClick={() => setShowUrlInspect((prev) => !prev)}
                  className="h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5"
                >
                  <Globe className="w-3.5 h-3.5 text-slate-500" />
                  <span>
                    {showUrlInspect
                      ? 'Ẩn trạng thái lập chỉ mục'
                      : `Trạng thái trang trên Google (${data?.siteStatus.rows.length || 0})`}
                  </span>
                </button>
              )}
              {activeTab === 'content' && canEditContent && (
                <button
                  type="button"
                  onClick={() => setShowCreateContentForm((prev) => !prev)}
                  className="h-8 px-3 rounded-lg bg-[#0B1D48] text-white text-xs font-semibold hover:bg-[#172D6E] inline-flex items-center gap-1.5"
                >
                  <FilePlus2 className="w-3.5 h-3.5" />
                  Thêm kế hoạch bài viết
                </button>
              )}
            </div>
          </div>

          {activeTab === 'overview' && (
            <div className="space-y-4">
              <GscPerformanceChart
                clicks={seo?.metrics.organicSearchClicks ?? null}
                impressions={seo?.metrics.organicSearchImpressions ?? null}
                ctrPct={seo?.metrics.organicSearchCtrPct ?? null}
                avgPosition={seo?.metrics.averageSearchPosition ?? null}
                previousClicks={seo?.comparison.previousClicks ?? null}
                previousImpressions={seo?.comparison.previousImpressions ?? null}
                series={seo?.charts.seoDailySeries || []}
                previousSeries={seo?.charts.previousSeoDailySeries}
                compareEnabled={compareEnabled}
                loading={loading && !data}
              />

              {/* Phiên tự nhiên + Lead SEO (5 cột) + Biến động trang đích (7 cột) */}
              <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
                  <div className="rounded-[12px] bg-white border border-slate-200 p-4 shadow-2xs flex flex-col justify-between">
                    <div className="text-xs font-medium text-slate-600">
                      Phiên tìm kiếm tự nhiên
                    </div>
                    <div className="text-2xl font-bold text-slate-900 tabular-nums mt-1">
                      <AnimatedMetricNumber value={seo?.metrics.organicSessions ?? null} />
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      {seo?.metrics.organicEngagementRatePct !== null &&
                      seo?.metrics.organicEngagementRatePct !== undefined
                        ? `Tỷ lệ tương tác: ${seo.metrics.organicEngagementRatePct}%`
                        : 'Truy cập tự nhiên từ Google'}
                    </div>
                  </div>

                  <div className="rounded-[12px] bg-white border border-slate-200 p-4 shadow-2xs flex flex-col justify-between">
                    <div className="text-xs font-medium text-slate-600">
                      Lead từ tìm kiếm tự nhiên
                    </div>
                    <div className="text-2xl font-bold text-[#0B1D48] tabular-nums mt-1">
                      <AnimatedMetricNumber value={seo?.metrics.organicValidLeadCount ?? 0} />
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      {seo?.metrics.organicLeadVerificationState === 'VERIFIED'
                        ? 'Đối soát theo phiên truy cập'
                        : 'Lead có nguồn tìm kiếm tự nhiên'}
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-7 bg-white border border-slate-200 rounded-[12px] p-4 shadow-2xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-sm font-bold text-slate-900">Biến động trang đích so kỳ trước</h2>
                      <button
                        type="button"
                        onClick={() => setActiveTab('pages')}
                        className="text-xs font-semibold text-[#1E3A8A] hover:underline"
                      >
                        Xem bảng Trang
                      </button>
                    </div>

                    <div className="mt-3 space-y-2.5 max-h-[210px] overflow-y-auto pr-1">
                      {(seo?.charts.pagesDeltaSummary?.risingPages.length || 0) === 0 &&
                      (seo?.charts.pagesDeltaSummary?.decliningPages.length || 0) === 0 ? (
                        <div className="py-8 text-center text-xs text-slate-400">
                          Chưa có biến động lớn giữa hai kỳ đối chiếu trong phạm vi đang chọn.
                        </div>
                      ) : (
                        <>
                          {(seo?.charts.pagesDeltaSummary?.risingPages || []).slice(0, 3).map((row) => (
                            <div
                              key={`up-${row.key}`}
                              className="rounded-lg border border-emerald-100 bg-emerald-50/40 px-2.5 py-2 text-xs"
                            >
                              <div className="font-mono text-[11px] text-slate-800 truncate" title={row.key}>
                                {row.key}
                              </div>
                              <div className="mt-0.5 flex items-center justify-between text-[11px]">
                                <span className="text-slate-600">{row.clicks} click kỳ này</span>
                                <span className="font-semibold text-emerald-700 inline-flex items-center gap-0.5">
                                  <ArrowUpRight className="w-3 h-3" />+{row.clickChange ?? 0} click
                                </span>
                              </div>
                            </div>
                          ))}
                          {(seo?.charts.pagesDeltaSummary?.decliningPages || []).slice(0, 3).map((row) => (
                            <div
                              key={`down-${row.key}`}
                              className="rounded-lg border border-amber-100 bg-amber-50/50 px-2.5 py-2 text-xs"
                            >
                              <div className="font-mono text-[11px] text-slate-800 truncate" title={row.key}>
                                {row.key}
                              </div>
                              <div className="mt-0.5 flex items-center justify-between text-[11px]">
                                <span className="text-slate-600">{row.clicks} click kỳ này</span>
                                <span className="font-semibold text-amber-800 inline-flex items-center gap-0.5">
                                  <ArrowDownRight className="w-3 h-3" />
                                  {row.clickChange ?? 0} click
                                </span>
                              </div>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  </div>

                  <div className="pt-2.5 mt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                    <span>Quảng cáo trả phí</span>
                    <Link href="/tracking?section=ads_campaigns" className="font-semibold text-[#1E3A8A] hover:underline inline-flex items-center gap-1">
                      Mở Google Ads
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                  </div>
                </div>
              </section>

      {/* Từ khóa cơ hội */}
      <section
        aria-labelledby="seo-quick-win-heading"
        className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs space-y-3.5"
      >
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="seo-quick-win-heading" className="text-sm sm:text-base font-bold text-slate-900">
                Từ khóa cơ hội
              </h2>
              <span className="px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-xs font-bold tabular-nums">
                {seo?.charts.opportunityQueries.length || 0} từ khóa
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Hiển thị nhiều nhưng tỷ lệ nhấp còn thấp — nên tối ưu lại tiêu đề hoặc nội dung.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Gói gọn ngưỡng kỹ thuật vào thẻ mở rộng để không gây rối mắt */}
            <details className="relative">
              <summary className="cursor-pointer list-none h-8 px-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 select-none">
                <SlidersHorizontal className="w-3.5 h-3.5 text-[#1E3A8A]" />
                <span>Lọc điều kiện (≥{appliedMinImpr} lượt thấy · ≤{appliedMaxCtr}%)</span>
              </summary>
              <div className="mt-2 lg:absolute lg:right-0 lg:z-20 lg:w-72 rounded-xl border border-slate-200 bg-white p-3.5 shadow-xl space-y-2.5 text-xs">
                <div className="font-bold text-slate-800">Tùy chỉnh điều kiện gợi ý</div>
                <label className="flex items-center justify-between gap-2 text-slate-600">
                  <span>Số lượt xuất hiện tối thiểu:</span>
                  <input
                    type="number"
                    min={1}
                    value={draftMinImpr}
                    onChange={(e) => setDraftMinImpr(e.target.value)}
                    className="w-20 h-7 px-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-900"
                  />
                </label>
                <label className="flex items-center justify-between gap-2 text-slate-600">
                  <span>Tỷ lệ khách nhấp tối đa (%):</span>
                  <input
                    type="number"
                    min={0.1}
                    step={0.5}
                    value={draftMaxCtr}
                    onChange={(e) => setDraftMaxCtr(e.target.value)}
                    className="w-20 h-7 px-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-900"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setAppliedMinImpr(Math.max(1, Number(draftMinImpr) || 30));
                    setAppliedMaxCtr(Math.max(0.1, Number(draftMaxCtr) || 3));
                  }}
                  className="w-full h-8 rounded-lg bg-[#0F275C] hover:bg-[#1E3A8A] text-white text-xs font-semibold"
                >
                  Áp dụng bộ lọc
                </button>
              </div>
            </details>

            <button
              type="button"
              onClick={() => setShowUrlInspect((prev) => !prev)}
              className="h-8 px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5"
            >
              <Globe className="w-3.5 h-3.5 text-slate-500" />
              <span>
                {showUrlInspect
                  ? 'Ẩn trạng thái lập chỉ mục'
                  : `Trạng thái trang trên Google (${data?.siteStatus.rows.length || 0})`}
              </span>
            </button>
          </div>
        </div>

        {(seo?.charts.opportunityQueries.length || 0) === 0 ? (
          <div className="rounded-xl bg-slate-50 border border-slate-200/70 px-4 py-3 text-xs text-slate-500">
            Chưa có từ khóa nào rơi vào vùng tỷ lệ nhấp thấp theo điều kiện lọc hiện tại.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
            {seo!.charts.opportunityQueries.slice(0, 6).map((q) => {
              const pos = q.averagePosition;
              const rankBadge =
                pos !== null && pos <= 3
                  ? { label: `Top ${pos} Google`, cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
                  : pos !== null && pos <= 10
                    ? { label: `Trang 1 (Hạng #${pos})`, cls: 'bg-blue-50 text-[#1E3A8A] border-blue-200' }
                    : pos !== null
                      ? { label: `Hạng #${pos}`, cls: 'bg-slate-100 text-slate-700 border-slate-200' }
                      : { label: 'Đang đo hạng', cls: 'bg-slate-100 text-slate-600 border-slate-200' };

              return (
                <div
                  key={q.query}
                  className="rounded-xl border border-slate-200/90 bg-slate-50/40 hover:bg-white hover:border-[#1E3A8A]/40 p-3 flex flex-col justify-between gap-2.5 transition"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-[11px] text-slate-400 block">Từ khóa khách tìm kiếm</span>
                      <strong className="text-xs sm:text-sm font-bold text-slate-900 block truncate" title={q.query}>
                        {q.query}
                      </strong>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold shrink-0 tabular-nums ${rankBadge.cls}`}>
                      {rankBadge.label}
                    </span>
                  </div>

                  <div className="pt-2 border-t border-slate-200/70 flex items-center justify-between gap-2 text-xs">
                    <div className="text-slate-600 tabular-nums">
                      <strong className="text-slate-900">{q.impressions.toLocaleString('vi-VN')}</strong> lượt thấy · Tỷ lệ nhấp:{' '}
                      <strong className="text-amber-700">{q.ctrPct ?? 0}%</strong>
                    </div>
                    {canEditContent && (
                      <button
                        type="button"
                        onClick={() => handleQuickPlanKeyword(q.query)}
                        className="h-7 px-2.5 rounded-lg bg-[#0F275C] hover:bg-[#1E3A8A] text-white text-[11px] font-semibold shrink-0 transition"
                      >
                        Viết bài tối ưu
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'overview' && showUrlInspect && (
          <div className="pt-2 border-t border-slate-100 space-y-2">
            <div className="text-[11px] text-slate-500">
              Lưu ý kỹ thuật: {data?.siteStatus.statusMessage || 'Dữ liệu URL Inspection kiểm tra từng URL cụ thể, không đại diện toàn bộ lỗi thu thập toàn trang.'}
            </div>
            {(data?.siteStatus.rows.length || 0) === 0 ? (
              <div className="text-xs text-slate-500 py-2">Chưa có bản ghi kiểm tra URL đơn lẻ trong phạm vi này.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 text-left">
                      <th className="py-2 pr-3 font-semibold">URL kiểm tra</th>
                      <th className="py-2 px-3 font-semibold">Kết luận lập chỉ mục</th>
                      <th className="py-2 px-3 font-semibold">Trạng thái thu thập</th>
                      <th className="py-2 pl-3 font-semibold">Lần Google thu thập gần nhất</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data!.siteStatus.rows.slice(0, 10).map((u) => (
                      <tr key={u.url}>
                        <td className="py-2 pr-3 font-mono text-[11px] text-slate-800 max-w-[360px] truncate" title={u.url}>
                          {u.url}
                        </td>
                        <td className="py-2 px-3 font-medium text-slate-700">{u.verdict}</td>
                        <td className="py-2 px-3 text-slate-600">{u.coverageState}</td>
                        <td className="py-2 pl-3 text-slate-500">
                          {u.lastCrawlTime ? new Date(u.lastCrawlTime).toLocaleString('vi-VN') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>
          </div>
          )}

      {activeTab === 'pages' && showUrlInspect && (
        <section className="bg-white border border-slate-200 rounded-[12px] p-4 shadow-2xs space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold text-slate-900">
              Trạng thái trang trên Google ({data?.siteStatus.rows.length || 0})
            </h3>
            <span className="text-[11px] text-slate-500">
              {data?.siteStatus.statusMessage || 'Dữ liệu URL Inspection kiểm tra từng URL cụ thể.'}
            </span>
          </div>
          {(data?.siteStatus.rows.length || 0) === 0 ? (
            <div className="text-xs text-slate-500 py-2">Chưa có bản ghi kiểm tra URL đơn lẻ trong phạm vi này.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 text-left">
                    <th className="py-2 pr-3 font-semibold">URL kiểm tra</th>
                    <th className="py-2 px-3 font-semibold">Kết luận lập chỉ mục</th>
                    <th className="py-2 px-3 font-semibold">Trạng thái thu thập</th>
                    <th className="py-2 pl-3 font-semibold">Lần Google thu thập gần nhất</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data!.siteStatus.rows.slice(0, 10).map((u) => (
                    <tr key={u.url}>
                      <td className="py-2 pr-3 font-mono text-[11px] text-slate-800 max-w-[360px] truncate" title={u.url}>
                        {u.url}
                      </td>
                      <td className="py-2 px-3 font-medium text-slate-700">{u.verdict}</td>
                      <td className="py-2 px-3 text-slate-600">{u.coverageState}</td>
                      <td className="py-2 pl-3 text-slate-500">
                        {u.lastCrawlTime ? new Date(u.lastCrawlTime).toLocaleString('vi-VN') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Bảng dữ liệu chính theo mục đã chọn trên thanh dọc */}
      {activeTab !== 'overview' && (
      <section
        className="bg-white border border-slate-200 rounded-[12px] shadow-2xs overflow-hidden"
        style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 380px' }}
      >

        {activeTab === 'content' && showCreateContentForm && canEditContent && (
          <form
            onSubmit={(e) => void handleSubmitNewContent(e)}
            className="p-4 bg-slate-50 border-b border-slate-200 grid grid-cols-1 md:grid-cols-12 gap-3 items-end"
          >
            <div className="md:col-span-3">
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Từ khóa mục tiêu
              </label>
              <input
                type="text"
                required
                minLength={2}
                value={newKeywordText}
                onChange={(e) => setNewKeywordText(e.target.value)}
                placeholder="VD: màn hình led p2.5 hội trường"
                className="w-full h-9 px-3 rounded-lg border border-slate-200 bg-white text-xs"
              />
            </div>
            <div className="md:col-span-3">
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Website đích
              </label>
              <select
                value={newTargetWebsite}
                onChange={(e) => setNewTargetWebsite(e.target.value as typeof newTargetWebsite)}
                className="w-full h-9 px-3 rounded-lg border border-slate-200 bg-white text-xs font-medium"
              >
                <option value="toantrung.com.vn">Website Toàn Trung (toantrung.com.vn)</option>
                <option value="bangled.vn">Chuyên trang Bảng LED (bangled.vn)</option>
                <option value="manhinhled.net.vn">Chuyên trang Màn hình LED (manhinhled.net.vn)</option>
              </select>
            </div>
            <div className="md:col-span-4">
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Chủ đề bài viết dự kiến
              </label>
              <input
                type="text"
                required
                minLength={5}
                value={newTopicFocus}
                onChange={(e) => setNewTopicFocus(e.target.value)}
                placeholder="VD: Báo giá kỹ thuật và tiêu chuẩn lắp đặt màn hình LED hội trường"
                className="w-full h-9 px-3 rounded-lg border border-slate-200 bg-white text-xs"
              />
            </div>
            <div className="md:col-span-2 flex items-center gap-2">
              <button
                type="submit"
                disabled={creatingContent}
                className="h-9 px-3.5 rounded-lg bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 disabled:opacity-50 w-full"
              >
                {creatingContent ? 'Đang tạo...' : 'Tạo bản nháp'}
              </button>
            </div>
          </form>
        )}

        {activeTab === 'queries' && (
          <div className="space-y-0">
            {crossFilterPage && (
              <div className="px-4 py-2.5 bg-blue-50/80 border-b border-blue-200 flex flex-wrap items-center justify-between gap-2 text-xs text-blue-900">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold shrink-0">Đang lọc từ khóa thuộc URL:</span>
                  <span className="font-mono text-[11px] bg-white px-2 py-0.5 rounded border border-blue-200 truncate max-w-[460px]" title={crossFilterPage}>
                    {crossFilterPage}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setCrossFilterPage(null)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white border border-blue-200 hover:bg-blue-100 text-[11px] font-semibold text-blue-900 shrink-0"
                >
                  <X className="w-3 h-3" />
                  <span>Xóa lọc</span>
                </button>
              </div>
            )}
            <MktSpreadsheetCalcBar
              title="Bảng Từ khóa tìm kiếm"
              excelMode={seoExcelCalc.excelMode}
              onToggleExcelMode={seoExcelCalc.toggleExcelMode}
              stats={seoExcelCalc.stats}
              onClear={seoExcelCalc.clearSelection}
            />
            <div
              ref={queryVirtualGrid.containerRef}
              onScroll={queryVirtualGrid.handleScroll}
              tabIndex={0}
              role="region"
              aria-label="Bảng từ khóa tìm kiếm kiểu Excel"
              className="overflow-x-auto overflow-y-auto max-h-[68vh]"
            >
              <table className="w-full text-xs border-separate border-spacing-0 [&_td]:border-r [&_td]:border-b [&_td]:border-slate-200/80 [&_th]:border-r [&_th]:border-b [&_th]:border-slate-200">
                <thead className="bg-slate-100 text-slate-700 sticky top-0 z-10">
                  <tr className="bg-slate-200/75 text-[10px] font-mono font-bold text-slate-500 select-none">
                    {['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((l) => (
                      <th key={`kw-col-${l}`} scope="col" className="py-1 px-2 text-center">{l}</th>
                    ))}
                  </tr>
                  <tr className="border-b border-slate-200">
                    <th scope="col" className="py-2.5 px-4 text-left font-semibold">Từ khóa tìm kiếm</th>
                    <th scope="col" className="py-2.5 px-3 text-right font-semibold">Click tìm kiếm</th>
                    <th scope="col" className="py-2.5 px-3 text-right font-semibold">Hiển thị tìm kiếm</th>
                    <th scope="col" className="py-2.5 px-3 text-right font-semibold">CTR</th>
                    <th scope="col" className="py-2.5 px-3 text-right font-semibold">Vị trí trung bình</th>
                    <th scope="col" className="py-2.5 px-3 text-right font-semibold">So kỳ trước</th>
                    <th scope="col" className="py-2.5 px-4 text-right font-semibold">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {queryRowsFiltered.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-slate-400">
                        Không có truy vấn tìm kiếm trong phạm vi đang chọn.
                      </td>
                    </tr>
                  ) : (
                    <>
                      {queryVirtualGrid.topSpacerHeight > 0 && (
                        <tr aria-hidden="true">
                          <td
                            colSpan={7}
                            style={{ height: queryVirtualGrid.topSpacerHeight, padding: 0, border: 0 }}
                          />
                        </tr>
                      )}
                      {visibleQueryRows.map((r) => {
                        const cmp = formatSafePeriodComparison(r.clicks, r.previousClicks);
                      return (
                        <tr key={r.key} className="odd:bg-white even:bg-slate-50/40 hover:bg-blue-50/30">
                          <td className="py-2.5 px-4 font-medium text-slate-900 max-w-[320px] truncate" title={r.key}>
                            {r.key}
                          </td>
                          <td
                            onClick={() => seoExcelCalc.toggleCell(`q:${r.key}:clicks`, 'Click', r.clicks)}
                            className={`py-2.5 px-3 text-right font-semibold text-slate-900 tabular-nums ${seoExcelCalc.cellClass(`q:${r.key}:clicks`)}`}
                          >
                            {r.clicks.toLocaleString('vi-VN')}
                          </td>
                          <td
                            onClick={() => seoExcelCalc.toggleCell(`q:${r.key}:impr`, 'Hiển thị', r.impressions)}
                            className={`py-2.5 px-3 text-right text-slate-600 tabular-nums ${seoExcelCalc.cellClass(`q:${r.key}:impr`)}`}
                          >
                            {r.impressions.toLocaleString('vi-VN')}
                          </td>
                          <td
                            onClick={() => seoExcelCalc.toggleCell(`q:${r.key}:ctr`, 'CTR', r.ctrPct)}
                            className={`py-2.5 px-3 text-right text-slate-600 tabular-nums ${seoExcelCalc.cellClass(`q:${r.key}:ctr`)}`}
                          >
                            {r.ctrPct !== null ? `${r.ctrPct}%` : '—'}
                          </td>
                          <td
                            onClick={() => seoExcelCalc.toggleCell(`q:${r.key}:pos`, 'Vị trí TB', r.averagePosition)}
                            className={`py-2.5 px-3 text-right text-slate-600 tabular-nums ${seoExcelCalc.cellClass(`q:${r.key}:pos`)}`}
                          >
                            {r.averagePosition !== null ? r.averagePosition : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right text-[11px] text-slate-600 tabular-nums">
                            {cmp.label}
                          </td>
                          <td className="py-2.5 px-4 text-right space-x-2 whitespace-nowrap">
                            {queryPageLinks.length > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setCrossFilterQuery(r.key);
                                  setCrossFilterPage(null);
                                  setActiveTab('pages');
                                }}
                                className="text-[11px] font-semibold text-emerald-700 hover:underline"
                                title="Xem trang đích của từ khóa này"
                              >
                                Xem trang →
                              </button>
                            )}
                            {canEditContent && (
                              <button
                                type="button"
                                onClick={() => handleQuickPlanKeyword(r.key)}
                                className="text-[11px] font-semibold text-[#1E3A8A] hover:underline"
                              >
                                Đưa vào nội dung
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                      {queryVirtualGrid.bottomSpacerHeight > 0 && (
                        <tr aria-hidden="true">
                          <td
                            colSpan={7}
                            style={{ height: queryVirtualGrid.bottomSpacerHeight, padding: 0, border: 0 }}
                          />
                        </tr>
                      )}
                    </>
                  )}
                </tbody>
                {queryRowsFiltered.length > 0 && (() => {
                  const totalClicks = queryRowsFiltered.reduce((s, r) => s + r.clicks, 0);
                  const totalImpr = queryRowsFiltered.reduce((s, r) => s + r.impressions, 0);
                  const aggCtr = totalImpr > 0 ? ((totalClicks / totalImpr) * 100).toFixed(2) : null;
                  const posRows = queryRowsFiltered.filter((r) => r.averagePosition !== null);
                  const avgPos =
                    posRows.length > 0
                      ? (posRows.reduce((s, r) => s + (r.averagePosition || 0), 0) / posRows.length).toFixed(1)
                      : null;
                  return (
                    <tfoot className="bg-blue-50/90 border-t-2 border-[#1E3A8A]/40 font-bold text-[#0F275C] sticky bottom-0">
                      <tr>
                        <td className="py-2.5 px-4">Σ TỔNG ({queryRowsFiltered.length} từ khóa)</td>
                        <td className="py-2.5 px-3 text-right tabular-nums">{totalClicks.toLocaleString('vi-VN')}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums">{totalImpr.toLocaleString('vi-VN')}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums">{aggCtr !== null ? `${aggCtr}%` : '—'}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums">{avgPos ?? '—'}</td>
                        <td className="py-2.5 px-3 text-right text-slate-400 font-normal">—</td>
                        <td className="py-2.5 px-4" />
                      </tr>
                    </tfoot>
                  );
                })()}
              </table>
            </div>
          </div>
        )}

        {activeTab === 'pages' && (
          <div className="space-y-0">
            {crossFilterQuery && (
              <div className="px-4 py-2.5 bg-emerald-50/80 border-b border-emerald-200 flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-900">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold shrink-0">Đang lọc trang đích cho từ khóa:</span>
                  <span className="font-semibold bg-white px-2 py-0.5 rounded border border-emerald-200 truncate max-w-[460px]">
                    &ldquo;{crossFilterQuery}&rdquo;
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setCrossFilterQuery(null)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white border border-emerald-200 hover:bg-emerald-100 text-[11px] font-semibold text-emerald-900 shrink-0"
                >
                  <X className="w-3 h-3" />
                  <span>Xóa lọc</span>
                </button>
              </div>
            )}
            <MktSpreadsheetCalcBar
              title="Bảng Trang đích SEO"
              excelMode={seoExcelCalc.excelMode}
              onToggleExcelMode={seoExcelCalc.toggleExcelMode}
              stats={seoExcelCalc.stats}
              onClear={seoExcelCalc.clearSelection}
            />
            <div tabIndex={0} role="region" aria-label="Bảng trang đích SEO" className="overflow-x-auto max-h-[68vh]">
              <table className="w-full text-xs border-separate border-spacing-0 [&_td]:border-r [&_td]:border-b [&_td]:border-slate-200/80 [&_th]:border-r [&_th]:border-b [&_th]:border-slate-200">
                <thead className="bg-slate-100 text-slate-700 sticky top-0 z-10">
                  <tr className="bg-slate-200/75 text-[10px] font-mono font-bold text-slate-500 select-none">
                    {(queryPageLinks.length > 0 ? ['A', 'B', 'C', 'D', 'E', 'F', 'G'] : ['A', 'B', 'C', 'D', 'E', 'F']).map((l) => (
                      <th key={`pg-col-${l}`} scope="col" className="py-1 px-2 text-center">{l}</th>
                    ))}
                  </tr>
                  <tr className="border-b border-slate-200">
                    <th scope="col" className="py-2.5 px-4 text-left font-semibold">URL trang đích</th>
                    <th scope="col" className="py-2.5 px-3 text-right font-semibold">Click tìm kiếm</th>
                    <th scope="col" className="py-2.5 px-3 text-right font-semibold">Hiển thị tìm kiếm</th>
                    <th scope="col" className="py-2.5 px-3 text-right font-semibold">CTR</th>
                    <th scope="col" className="py-2.5 px-3 text-right font-semibold">Vị trí trung bình</th>
                    <th scope="col" className="py-2.5 px-3 text-right font-semibold">So kỳ trước</th>
                    {queryPageLinks.length > 0 && (
                      <th scope="col" className="py-2.5 px-4 text-right font-semibold">Từ khóa</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageRowsFiltered.length === 0 ? (
                    <tr>
                      <td colSpan={queryPageLinks.length > 0 ? 7 : 6} className="py-10 text-center text-slate-400">
                        Không có dữ liệu trang đích trong phạm vi đang chọn.
                      </td>
                    </tr>
                  ) : (
                    pageRowsFiltered.map((r) => {
                      const cmp = formatSafePeriodComparison(r.clicks, r.previousClicks);
                      return (
                        <tr key={r.key} className="odd:bg-white even:bg-slate-50/40 hover:bg-blue-50/30">
                          <td className="py-2.5 px-4 font-mono text-[11px] text-slate-800 max-w-[420px] truncate" title={r.key}>
                            {r.key}
                          </td>
                          <td
                            onClick={() => seoExcelCalc.toggleCell(`p:${r.key}:clicks`, 'Click', r.clicks)}
                            className={`py-2.5 px-3 text-right font-semibold text-slate-900 tabular-nums ${seoExcelCalc.cellClass(`p:${r.key}:clicks`)}`}
                          >
                            {r.clicks.toLocaleString('vi-VN')}
                          </td>
                          <td
                            onClick={() => seoExcelCalc.toggleCell(`p:${r.key}:impr`, 'Hiển thị', r.impressions)}
                            className={`py-2.5 px-3 text-right text-slate-600 tabular-nums ${seoExcelCalc.cellClass(`p:${r.key}:impr`)}`}
                          >
                            {r.impressions.toLocaleString('vi-VN')}
                          </td>
                          <td
                            onClick={() => seoExcelCalc.toggleCell(`p:${r.key}:ctr`, 'CTR', r.ctrPct)}
                            className={`py-2.5 px-3 text-right text-slate-600 tabular-nums ${seoExcelCalc.cellClass(`p:${r.key}:ctr`)}`}
                          >
                            {r.ctrPct !== null ? `${r.ctrPct}%` : '—'}
                          </td>
                          <td
                            onClick={() => seoExcelCalc.toggleCell(`p:${r.key}:pos`, 'Vị trí TB', r.averagePosition)}
                            className={`py-2.5 px-3 text-right text-slate-600 tabular-nums ${seoExcelCalc.cellClass(`p:${r.key}:pos`)}`}
                          >
                            {r.averagePosition !== null ? r.averagePosition : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right text-[11px] text-slate-600 tabular-nums">
                            {cmp.label}
                          </td>
                          {queryPageLinks.length > 0 && (
                            <td className="py-2.5 px-4 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => {
                                  setCrossFilterPage(r.key);
                                  setCrossFilterQuery(null);
                                  setActiveTab('queries');
                                }}
                                className="text-[11px] font-semibold text-[#1E3A8A] hover:underline"
                                title="Xem từ khóa kéo traffic vào trang này"
                              >
                                Từ khóa →
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
                {pageRowsFiltered.length > 0 && (() => {
                  const totalClicks = pageRowsFiltered.reduce((s, r) => s + r.clicks, 0);
                  const totalImpr = pageRowsFiltered.reduce((s, r) => s + r.impressions, 0);
                  const aggCtr = totalImpr > 0 ? ((totalClicks / totalImpr) * 100).toFixed(2) : null;
                  const posRows = pageRowsFiltered.filter((r) => r.averagePosition !== null);
                  const avgPos =
                    posRows.length > 0
                      ? (posRows.reduce((s, r) => s + (r.averagePosition || 0), 0) / posRows.length).toFixed(1)
                      : null;
                  return (
                    <tfoot className="bg-blue-50/90 border-t-2 border-[#1E3A8A]/40 font-bold text-[#0F275C] sticky bottom-0">
                      <tr>
                        <td className="py-2.5 px-4">Σ TỔNG ({pageRowsFiltered.length} trang đích)</td>
                        <td className="py-2.5 px-3 text-right tabular-nums">{totalClicks.toLocaleString('vi-VN')}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums">{totalImpr.toLocaleString('vi-VN')}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums">{aggCtr !== null ? `${aggCtr}%` : '—'}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums">{avgPos ?? '—'}</td>
                        <td className="py-2.5 px-3 text-right text-slate-400 font-normal">—</td>
                        {queryPageLinks.length > 0 && <td className="py-2.5 px-4" />}
                      </tr>
                    </tfoot>
                  );
                })()}
              </table>
            </div>
          </div>
        )}

        {activeTab === 'content' && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <th scope="col" className="py-2.5 px-4 text-left font-semibold">Tiêu đề bài viết</th>
                  <th scope="col" className="py-2.5 px-3 text-left font-semibold">Từ khóa mục tiêu</th>
                  <th scope="col" className="py-2.5 px-3 text-left font-semibold">Website nguồn</th>
                  <th scope="col" className="py-2.5 px-3 text-left font-semibold">Người phụ trách</th>
                  <th scope="col" className="py-2.5 px-3 text-left font-semibold">Trạng thái bài viết</th>
                  <th scope="col" className="py-2.5 px-4 text-right font-semibold">Cập nhật gần nhất</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {contentRowsFiltered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-400">
                      Chưa có bài viết SEO nào trong danh sách cho phạm vi website đang chọn.
                    </td>
                  </tr>
                ) : (
                  contentRowsFiltered.map((art) => (
                    <tr key={art.contentId} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-4 font-medium text-slate-900 max-w-[340px]">
                        <div className="truncate" title={art.title}>
                          {art.title}
                        </div>
                        {art.targetUrl && (
                          <div className="text-[11px] font-mono text-slate-400 truncate" title={art.targetUrl}>
                            {art.targetUrl}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-700">{art.targetQuery}</td>
                      <td className="py-2.5 px-3 text-slate-600">{art.targetWebsite || 'Chưa phân loại'}</td>
                      <td className="py-2.5 px-3 text-slate-600">{art.owner}</td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            art.workflowStatus === 'published'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : art.publishError
                                ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                : 'bg-slate-100 text-slate-700 border border-slate-200'
                          }`}
                        >
                          {formatWorkflowStatus(art.workflowStatus)}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right text-slate-500 tabular-nums">
                        <div className="inline-flex items-center justify-end gap-2">
                          <span>{new Date(art.updatedAt).toLocaleDateString('vi-VN')}</span>
                          <button
                            type="button"
                            onClick={() => setScoringArticleId(art.contentId)}
                            className="px-2 py-1 rounded-lg border border-blue-200 bg-blue-50 hover:bg-[#0F275C] hover:text-white text-[11px] font-bold text-[#0F275C] transition"
                          >
                            Chấm điểm B2B
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'devices_countries' && (() => {
          const allRows = seo?.tables.deviceCountry || [];
          const deviceRows = allRows.filter((r) => r.dimensionType === 'DEVICE');
          const countryRows = allRows.filter((r) => r.dimensionType === 'COUNTRY');
          const renderDimTable = (
            title: string,
            subtitle: string,
            rows: typeof allRows,
            emptyMsg: string,
          ) => (
            <section className="rounded-xl border border-slate-200 overflow-hidden bg-white">
              <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70">
                <h3 className="text-xs font-bold text-slate-900">{title}</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>
              </div>
              <div className="overflow-x-auto max-h-[380px]">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 sticky top-0">
                      <th scope="col" className="py-2 px-4 text-left font-semibold">Phân loại</th>
                      <th scope="col" className="py-2 px-3 text-right font-semibold">Click</th>
                      <th scope="col" className="py-2 px-3 text-right font-semibold">Hiển thị</th>
                      <th scope="col" className="py-2 px-3 text-right font-semibold">CTR</th>
                      <th scope="col" className="py-2 px-4 text-right font-semibold">Vị trí TB</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-400">
                          {emptyMsg}
                        </td>
                      </tr>
                    ) : (
                      rows.map((r) => (
                        <tr key={`${r.dimensionType}-${r.dimensionKey}`} className="hover:bg-slate-50/70">
                          <th scope="row" className="py-2.5 px-4 font-semibold text-slate-900 text-left">
                            {r.dimensionKey}
                          </th>
                          <td className="py-2.5 px-3 text-right font-semibold text-slate-900 tabular-nums">
                            {r.clicks.toLocaleString('vi-VN')}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-600 tabular-nums">
                            {r.impressions.toLocaleString('vi-VN')}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-600 tabular-nums">
                            {r.ctrPct !== null ? `${r.ctrPct}%` : '—'}
                          </td>
                          <td className="py-2.5 px-4 text-right text-slate-600 tabular-nums">
                            {r.averagePosition !== null ? r.averagePosition : '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          );

          return (
            <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
              {renderDimTable(
                `Theo Thiết bị (${deviceRows.length})`,
                'Tìm kiếm theo Desktop, Mobile, Tablet',
                deviceRows,
                'Chưa có dữ liệu thiết bị trong kỳ đang chọn.',
              )}
              {renderDimTable(
                `Theo Quốc gia (${countryRows.length})`,
                'Quốc gia phát sinh lượt tìm kiếm',
                countryRows,
                'Chưa có dữ liệu quốc gia trong kỳ đang chọn.',
              )}
            </div>
          );
        })()}

        {activeTab === 'trends' && (
          <GoogleTrendsExplorePanel
            trends={data?.trends}
            csrfToken={user?.csrfToken}
            canEditContent={canEditContent}
            onQuickPlanKeyword={handleQuickPlanKeyword}
            onRefreshed={async () => {
              await fetchDashboard(true);
            }}
            onError={(msg) => setErrorMsg(msg)}
            onSuccess={(msg) => setContentStatusMsg(msg)}
          />
        )}

        {(activeTab === 'queries' || activeTab === 'pages' || activeTab === 'content') &&
          totalPages > 1 && (
          <div className="px-4 py-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
            <span>
              Trang {currentPageNum} / {totalPages} ({activeTotalRows.toLocaleString('vi-VN')} dòng)
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={currentPageNum <= 1}
                onClick={() =>
                  activeTab === 'content'
                    ? setContentPage((p) => Math.max(1, p - 1))
                    : activeTab === 'pages'
                      ? setPagesPage((p) => Math.max(1, p - 1))
                      : setQueriesPage((p) => Math.max(1, p - 1))
                }
                className="px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 font-medium"
              >
                Trước
              </button>
              <button
                type="button"
                disabled={currentPageNum >= totalPages}
                onClick={() =>
                  activeTab === 'content'
                    ? setContentPage((p) => Math.min(totalPages, p + 1))
                    : activeTab === 'pages'
                      ? setPagesPage((p) => Math.min(totalPages, p + 1))
                      : setQueriesPage((p) => Math.min(totalPages, p + 1))
                }
                className="px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 font-medium"
              >
                Sau
              </button>
            </div>
          </div>
        )}
      </section>
      )}
        </div>
      </div>
      <LedSeoQualityScorerModal
        articleId={scoringArticleId}
        onClose={() => setScoringArticleId(null)}
        user={user}
      />
    </div>
  );
}
